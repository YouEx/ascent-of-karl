/**
 * Selve beslutningen (TASK-002/003/004 + sikkerhedsrunde 2 punkt 2/3
 * samlet): rullende vindue → validering → kanonisering → delt cache →
 * (kun ved cache-miss) globalt+pr.-IP dagligt loft → opstrømskald.
 *
 * Ren nok til at teste uden Cloudflare: `deps.store` kan være Durable
 * Object'ens rigtige `storage`, eller en `InMemoryStore` i en test —
 * funktionen her ved ikke hvilken. Det er selve pointen med at "fatte rene
 * beslutnings-/nøgle-/loft-hjælpere ud i workermoduler, så rod-Vitest kan
 * teste dem uden at installere en Cloudflare-testpool".
 *
 * Rækkefølgen er bevidst:
 *   1. Rate limit FØRST — også foran cachen, for et cache-hit koster stadig
 *      workerressourcer, og misbrug skal stoppes før noget som helst andet
 *      arbejde (kravet: "Apply the rate limit before serving even cached
 *      responses").
 *   2. Formvalidering (`validateBody`), uden at røre budgettet.
 *   3. Kanonisering (`resolveCanonical`): et ukendt aId/bId/needId afvises
 *      her med 400 — FØR cache-opslag og budget, jf. sikkerhedsrunde 2's
 *      krav om at et opdigtet id ikke må koste noget som helst, og ikke må
 *      kunne skabe uendeligt mange unikke cache-nøgler.
 *   4. Cache-opslag — et hit reserverer ALDRIG budget.
 *   5. Kun ved miss: tilslut et kald allerede i luften, ELLER reservér
 *      BÅDE det globale og pr.-IP daglige budget, og start selv
 *      opstrømskaldet.
 *
 * Låsen (`deps.gate`) holder kun trin 1-5 sammen — den slippes, FØR det
 * langsomme netværkskald til modellen afventes, jf. kravet om aldrig at
 * holde en global lås hen over opstrømskaldet.
 *
 * Budget-rækkefølgen i trin 5 er bevidst globalt-FØR-pr.-IP: er det
 * GLOBALE loft allerede tømt, er 503 den rigtige besked uanset hvilken IP
 * der spørger — alle ville blive afvist lige nu. Er der derimod plads
 * globalt, men DENNE ips egen andel er brugt, er 429 rigtigt — andre IP'er
 * kan stadig få et svar. Og vigtigst: fejler pr.-IP-tjekket, er det GLOBALE
 * loft IKKE skrevet endnu (kun udregnet) — et afvist forsøg fra én IP må
 * aldrig kunne opbruge resten af verdens globale budget for dagen.
 */

import { checkRollingWindow } from "./limiter";
import { reserveBudget, type BudgetRecord } from "./budget";
import { pairCacheKey } from "./cache-key";
import { validateBody, type WireRequest } from "./validate";
import { resolveCanonicalBody, type CanonicalBody, type CanonicalResult } from "./catalog";
import { SerialGate, InFlightRegistry } from "./concurrency";
import type { KeyValueStore } from "./store";

export interface CachedLine {
  text: string;
  createdAt: number;
}

export type UpstreamResult =
  | { ok: true; text: string }
  | { ok: false; status: number; reason: string };

export interface CoordinatorConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  /** Globalt UTC-døgnloft over kald der når opstrøms (TASK-003). */
  dailyMax: number;
  /**
   * Én IP-hashs egen andel af samme døgn (sikkerhedsrunde 2, punkt 2) —
   * forhindrer at én spiller (eller ét misbrugt endpoint) alene kan opbruge
   * HELE dagens globale loft. Skal være meningsfuldt MINDRE end `dailyMax`.
   */
  dailyMaxPerIp: number;
}

export interface CoordinatorDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (body: CanonicalBody) => Promise<UpstreamResult>;
  /**
   * Oversætter en valideret, men stadig klient-oplyst, ledningskrop til
   * spillets egne id'er og tekster. Injiceret (som `callUpstream`), så
   * koordinator-tests kan bruge opdigtede test-id'er uden at kende
   * `content/elements.json` — produktion bruger `resolveCanonicalBody` fra
   * `catalog.ts` som default (se `createCoordinatorDeps`).
   */
  resolveCanonical: (wire: WireRequest) => CanonicalResult;
  config: CoordinatorConfig;
  gate: SerialGate;
  inFlight: InFlightRegistry<UpstreamResult>;
}

export type CoordinatorResponse =
  | { status: 200; text: string }
  | { status: 400; reason: string }
  | { status: 429; retryAfterSeconds: number; reason: string }
  | { status: 503; retryAfterSeconds: number; reason: string }
  | { status: 502; reason: string };

// Eksporteret, så `coordinator-do.ts`s oprydningsalarm kan liste præcis de
// samme præfikser — to steder der begge selv opfandt "rl:" ville før eller
// siden drive fra hinanden.
export const RATE_LIMIT_KEY_PREFIX = "rl:";
const BUDGET_KEY = "budget";
const IP_BUDGET_KEY_PREFIX = "budget:ip:";
export const CACHE_KEY_PREFIX = "cache:";

/** Bekvemmelighed: bygger de to samtidighedsobjekter, så kaldstedet ikke skal huske det. */
export function createCoordinatorDeps(partial: {
  store: KeyValueStore;
  callUpstream: CoordinatorDeps["callUpstream"];
  config: CoordinatorConfig;
  now?: () => number;
  resolveCanonical?: CoordinatorDeps["resolveCanonical"];
}): CoordinatorDeps {
  return {
    store: partial.store,
    now: partial.now ?? (() => Date.now()),
    callUpstream: partial.callUpstream,
    resolveCanonical: partial.resolveCanonical ?? resolveCanonicalBody,
    config: partial.config,
    gate: new SerialGate(),
    inFlight: new InFlightRegistry<UpstreamResult>(),
  };
}

type Decision =
  | { kind: "reject"; response: CoordinatorResponse }
  | { kind: "hit"; text: string }
  | { kind: "pending"; promise: Promise<UpstreamResult> };

export async function decide(
  rawBody: unknown,
  ipHash: string,
  deps: CoordinatorDeps,
): Promise<CoordinatorResponse> {
  const decision: Decision = await deps.gate.run(async () => {
    // 1. Rullende vindue pr. IP-hash — før alt andet.
    const rlKey = RATE_LIMIT_KEY_PREFIX + ipHash;
    const existingTimestamps = (await deps.store.get<number[]>(rlKey)) ?? [];
    const rl = checkRollingWindow(
      existingTimestamps,
      deps.now(),
      deps.config.rateLimitWindowMs,
      deps.config.rateLimitMax,
    );
    if (!rl.allowed) {
      return {
        kind: "reject",
        response: { status: 429, retryAfterSeconds: rl.retryAfterSeconds, reason: "rate limit" },
      };
    }
    await deps.store.put(rlKey, rl.timestamps);

    // 2. Form og grænser — ingen budget rørt.
    const validated = validateBody(rawBody);
    if (!validated.ok) {
      return { kind: "reject", response: { status: 400, reason: validated.reason } };
    }

    // 3. Kanoniser id'er til rigtigt indhold. Et ukendt id er enten en fejl
    // i klienten eller et forsøg på at proxye vilkårlig tekst/skabe
    // uendeligt mange cache-nøgler — begge afvises her, FØR budgettet.
    const canonical = deps.resolveCanonical(validated.body);
    if (!canonical.ok) {
      return { kind: "reject", response: { status: 400, reason: canonical.reason } };
    }

    // 4. Delt cache — et hit koster intet budget.
    const key = pairCacheKey(canonical.body.a.id, canonical.body.b.id, canonical.body.verdict);
    const cached = await deps.store.get<CachedLine>(CACHE_KEY_PREFIX + key);
    if (cached) {
      return { kind: "hit", text: cached.text };
    }

    // 5. Miss: tilslut en stime i gang, eller reservér og start selv.
    const existingInFlight = deps.inFlight.get(key);
    if (existingInFlight) {
      return { kind: "pending", promise: existingInFlight };
    }

    // 5a. Globalt UTC-døgnloft (TASK-003) — den deterministiske omkostningsloft.
    const globalRecord = await deps.store.get<BudgetRecord>(BUDGET_KEY);
    const globalReservation = reserveBudget(globalRecord, deps.now(), deps.config.dailyMax);
    if (!globalReservation.ok) {
      return {
        kind: "reject",
        response: {
          status: 503,
          retryAfterSeconds: globalReservation.retryAfterSeconds,
          reason: "daily budget",
        },
      };
    }

    // 5b. Denne IP-hashs egen andel af samme døgn (sikkerhedsrunde 2, punkt
    // 2). Tjekkes FØR noget skrives til lager: fejler dette, må det
    // (endnu kun UDREGNEDE, ikke skrevne) globale forsøg kasseres helt —
    // ellers kunne én afvist IP stadig dræne verdens fælles budget ved at
    // blive ved med at spørge.
    const ipBudgetKey = IP_BUDGET_KEY_PREFIX + ipHash;
    const ipRecord = await deps.store.get<BudgetRecord>(ipBudgetKey);
    const ipReservation = reserveBudget(ipRecord, deps.now(), deps.config.dailyMaxPerIp);
    if (!ipReservation.ok) {
      return {
        kind: "reject",
        response: {
          status: 429,
          retryAfterSeconds: ipReservation.retryAfterSeconds,
          reason: "per-ip daily budget",
        },
      };
    }

    // Begge reservationer lykkedes: skriv BEGGE FØR opstrømskaldet — de
    // tæller, selv hvis opstrømskaldet bagefter fejler.
    await deps.store.put(BUDGET_KEY, globalReservation.record);
    await deps.store.put(ipBudgetKey, ipReservation.record);

    const body = canonical.body;
    const promise = deps.inFlight.start(key, async () => {
      const result = await deps.callUpstream(body);
      if (result.ok) {
        // Cache ALDRIG en fejl — kun et resultat der bestod clean().
        await deps.store.put<CachedLine>(CACHE_KEY_PREFIX + key, {
          text: result.text,
          createdAt: deps.now(),
        });
      }
      return result;
    });
    return { kind: "pending", promise };
  });

  if (decision.kind === "reject") return decision.response;
  if (decision.kind === "hit") return { status: 200, text: decision.text };

  // Ventetiden på netværket sker HERUDE — uden for gate'en.
  const result = await decision.promise;
  return result.ok ? { status: 200, text: result.text } : { status: 502, reason: result.reason };
}
