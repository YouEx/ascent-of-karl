/**
 * Selve beslutningen (TASK-002/003/004 samlet): rullende vindue → validering
 * → delt cache → (kun ved cache-miss) dagligt loft + opstrømskald.
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
 *   2. Validering, uden at røre budgettet.
 *   3. Cache-opslag — et hit reserverer ALDRIG budget.
 *   4. Kun ved miss: tilslut et kald allerede i luften, ELLER reservér
 *      budget og start selv opstrømskaldet.
 *
 * Låsen (`deps.gate`) holder kun trin 1-4 sammen — den slippes, FØR det
 * langsomme netværkskald til modellen afventes, jf. kravet om aldrig at
 * holde en global lås hen over opstrømskaldet.
 */

import { checkRollingWindow } from "./limiter";
import { reserveBudget, type BudgetRecord } from "./budget";
import { pairCacheKey } from "./cache-key";
import { validateBody, type ValidatedBody } from "./validate";
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
  dailyMax: number;
}

export interface CoordinatorDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (body: ValidatedBody) => Promise<UpstreamResult>;
  config: CoordinatorConfig;
  gate: SerialGate;
  inFlight: InFlightRegistry<UpstreamResult>;
}

export type CoordinatorResponse =
  | { status: 200; text: string }
  | { status: 400; reason: string }
  | { status: 429; retryAfterSeconds: number }
  | { status: 503; retryAfterSeconds: number }
  | { status: 502; reason: string };

const RATE_LIMIT_KEY_PREFIX = "rl:";
const BUDGET_KEY = "budget";
const CACHE_KEY_PREFIX = "cache:";

/** Bekvemmelighed: bygger de to samtidighedsobjekter, så kaldstedet ikke skal huske det. */
export function createCoordinatorDeps(partial: {
  store: KeyValueStore;
  callUpstream: CoordinatorDeps["callUpstream"];
  config: CoordinatorConfig;
  now?: () => number;
}): CoordinatorDeps {
  return {
    store: partial.store,
    now: partial.now ?? (() => Date.now()),
    callUpstream: partial.callUpstream,
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
        response: { status: 429, retryAfterSeconds: rl.retryAfterSeconds },
      };
    }
    await deps.store.put(rlKey, rl.timestamps);

    // 2. Form og grænser — ingen budget rørt.
    const validated = validateBody(rawBody);
    if (!validated.ok) {
      return { kind: "reject", response: { status: 400, reason: validated.reason } };
    }

    // 3. Delt cache — et hit koster intet budget.
    const key = pairCacheKey(validated.body.a.id, validated.body.b.id, validated.body.verdict);
    const cached = await deps.store.get<CachedLine>(CACHE_KEY_PREFIX + key);
    if (cached) {
      return { kind: "hit", text: cached.text };
    }

    // 4. Miss: tilslut en stime i gang, eller reservér og start selv.
    const existingInFlight = deps.inFlight.get(key);
    if (existingInFlight) {
      return { kind: "pending", promise: existingInFlight };
    }

    const budgetRecord = await deps.store.get<BudgetRecord>(BUDGET_KEY);
    const reservation = reserveBudget(budgetRecord, deps.now(), deps.config.dailyMax);
    if (!reservation.ok) {
      return {
        kind: "reject",
        response: { status: 503, retryAfterSeconds: reservation.retryAfterSeconds },
      };
    }
    // Reservationen skrives FØR opstrømskaldet — den tæller, selv hvis
    // opstrømskaldet bagefter fejler.
    await deps.store.put(BUDGET_KEY, reservation.record);

    const body = validated.body;
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
