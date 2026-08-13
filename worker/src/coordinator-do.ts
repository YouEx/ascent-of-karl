/**
 * Den tynde Cloudflare-tilpasning: forbinder Durable Object'ens rigtige
 * `storage` til den rene beslutning i `coordinator.ts`, og oversætter
 * resultatet til et rigtigt `Response`-objekt. Al LOGIK bor andre steder —
 * denne klasse pakker anmodningen ud, kalder `decide()`, pakker svaret ind.
 *
 * Én navngivet, global instans er hele koordinatoren (SEC-003/TASK-002-004):
 * lav spiltrafik gør ét globalt Durable Object til den simpleste pålidelige
 * løsning — ingen sharding, ingen KV ved siden af, ét stateful binding.
 *
 * Sikkerhedsrunde 2, punkt 1: IP-identiteten er IKKE længere denne klasses
 * ansvar. `index.ts` kører ved selve Cloudflare-kanten, læser den
 * troværdige `cf-connecting-ip` og hasher den, FØR anmodningen når herind —
 * dette objekt læser KUN den allerede-hashede interne header og validerer
 * dens FORM (64 hex-tegn). Det stoler aldrig på headerens blotte
 * tilstedeværelse: mangler den, eller er den forkert formet, fejler
 * objektet LUKKET (503) frem for at gætte en identitet.
 */

import type { DurableObjectState } from "./cf-types";
import {
  createCoordinatorDeps,
  decide,
  reserveRateLimitSlot,
  RATE_LIMIT_KEY_PREFIX,
  CACHE_KEY_PREFIX,
  IP_BUDGET_KEY_PREFIX,
  type CachedLine,
  type CoordinatorDeps,
  type CoordinatorResponse,
} from "./coordinator";
import { toNonNegativeInt, toPositiveInt } from "./env";
import { INTERNAL_IP_HASH_HEADER, isValidIpHash } from "./ip";
import { findExpiredCacheKeys, findStaleIpBudgetKeys, findStaleRateLimitKeys } from "./cleanup";
import { isBodyTooLarge } from "./validate";
import { promptNamespace } from "./cache-key";
import { callUpstreamOpenAI, DEFAULT_MODEL, SYSTEM, type ModelEnv } from "./model";

export interface CoordinatorEnv extends ModelEnv {
  /** Sekunder i det rullende vindue (TASK-002). Se wrangler.toml for den målte default. */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** Kald tilladt pr. IP-hash pr. vindue (TASK-002). */
  RATE_LIMIT_MAX?: string;
  /** Globalt UTC-døgnloft over kald der når opstrøms (TASK-003). */
  DAILY_MAX_UPSTREAM_CALLS?: string;
  /**
   * Én IP-hashs egen andel af samme døgn (sikkerhedsrunde 2, punkt 2). Skal
   * være meningsfuldt mindre end `DAILY_MAX_UPSTREAM_CALLS` — se
   * wrangler.toml for begrundelsen bag det målte tal.
   */
  DAILY_MAX_UPSTREAM_CALLS_PER_IP?: string;
}

// Konservative defaults, brugt hvis en var mangler i wrangler.toml. De
// RIGTIGE, målte tal bor i wrangler.toml's kommentarer og i
// plan/feature-live-narrator-1.md — disse er kun et sikkerhedsnet, og er
// med vilje strammere end de målte produktionstal (en manglende var skal
// aldrig åbne døren bredere end tilsigtet).
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_DAILY_MAX_UPSTREAM_CALLS = 350;
// 165 = målt p95 (33 distinkte par+dom-nøgler/run) × 5 antagede fulde
// gennemspilninger for ÉN spiller på én dag — se wrangler.toml for hele
// udregningen (sikkerhedsrunde 2, punkt 2 og 5).
const DEFAULT_DAILY_MAX_UPSTREAM_CALLS_PER_IP = 165;

/**
 * Hvor længe en cache-post må ligge, før oprydningen fjerner den
 * (sikkerhedsrunde 2, punkt 4). Indholdet BLIVER ikke forkert med tiden —
 * samme par+dom+navnerum giver stadig samme kategori af fiasko — men et
 * ubegrænset lager er en ubegrænset regning. En prompt- eller
 * modelændring rammes IKKE af denne grænse og behøver ikke vente på den:
 * cache-navnerummet (sikkerhedsrunde 3, punkt 3, se `cache-key.ts`s
 * `promptNamespace()`) udledes AUTOMATISK af selve prompten og modellen, så
 * en ændring i den ene eller den anden gør gamle nøgler uopslåelige med det
 * samme, uden at nogen skal huske at bumpe noget som helst.
 *
 * Eksporteret (ikke kun en modul-privat konstant), så tests kan sætte en
 * gammel post PRÆCIS uden for grænsen uden at gætte tallet.
 */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dage

/**
 * Hvor ofte oprydningsalarmen ringer. Lav spiltrafik betyder få nye poster
 * pr. dag — et døgns mellemrum er rigeligt hyppigt uden at koste noget
 * nævneværdigt.
 */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 døgn

interface AdapterResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

/** Oversætter den rene beslutning til det HTTP-svar workeren skal give. */
function responseFor(result: CoordinatorResponse): AdapterResponse {
  if (result.status === 200) return { status: 200, body: { text: result.text } };
  if (result.status === 400) return { status: 400, body: { error: "bad request", reason: result.reason } };
  if (result.status === 429) {
    return {
      status: 429,
      body: { error: "rate limited", reason: result.reason },
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  if (result.status === 503) {
    return {
      status: 503,
      body: { error: "daily budget exhausted", reason: result.reason },
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  return { status: 502, body: { error: "upstream", reason: result.reason } };
}

export class Coordinator {
  private deps: CoordinatorDeps | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CoordinatorEnv,
  ) {}

  private getDeps(): CoordinatorDeps {
    if (!this.deps) {
      // Udledt ÉN gang pr. objekt-instans (ikke pr. forespørgsel) —
      // prompten og modellen ændrer sig kun ved en gendeploy, som skaber en
      // FRISK instans alligevel (sikkerhedsrunde 3, punkt 3).
      const cacheNamespace = promptNamespace(SYSTEM, this.env.MODEL ?? DEFAULT_MODEL);
      this.deps = createCoordinatorDeps({
        store: this.state.storage,
        callUpstream: (body) => callUpstreamOpenAI(body, this.env),
        config: {
          rateLimitWindowMs:
            toPositiveInt(this.env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS) * 1000,
          rateLimitMax: toPositiveInt(this.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
          dailyMax: toNonNegativeInt(this.env.DAILY_MAX_UPSTREAM_CALLS, DEFAULT_DAILY_MAX_UPSTREAM_CALLS),
          dailyMaxPerIp: toNonNegativeInt(
            this.env.DAILY_MAX_UPSTREAM_CALLS_PER_IP,
            DEFAULT_DAILY_MAX_UPSTREAM_CALLS_PER_IP,
          ),
          cacheNamespace,
        },
      });
    }
    return this.deps;
  }

  /**
   * Sikrer at en oprydningsalarm er sat, uden at genplante en der allerede
   * tikker. Kaldes ved hver forespørgsel, men er selv-helbredende og billig
   * (én læsning) — går den galt (fx en attrap i en test uden alarm-støtte),
   * skal det ALDRIG vælte selve svaret til spilleren, derfor fanges fejlen
   * her og ikke længere oppe.
   */
  private async ensureCleanupScheduled(): Promise<void> {
    try {
      const existing = await this.state.storage.getAlarm();
      if (existing === null) {
        await this.state.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
      }
    } catch {
      // Oprydningsplanlægning er hygiejne, ikke svaret selv.
    }
  }

  /**
   * Kaldes af Cloudflare, når den planlagte alarm ringer (sikkerhedsrunde
   * 2, punkt 4: "Durable Object storage has no magic TTL" — dette ER den
   * eksplicitte sletning/alarm, kravet beder om). Rydder døde
   * rate-limit-poster, for gamle cache-poster, og (sikkerhedsrunde 3,
   * punkt 2) pr.-IP-budgetposter hvis gemte UTC-dato hverken er i dag eller
   * i går — planlægger så næste omgang, uanset om denne omgang selv gik
   * helt godt.
   */
  async alarm(): Promise<void> {
    const deps = this.getDeps();
    const now = deps.now();
    try {
      const rlEntries = await this.state.storage.list<number[]>({ prefix: RATE_LIMIT_KEY_PREFIX });
      for (const key of findStaleRateLimitKeys(rlEntries, now, deps.config.rateLimitWindowMs)) {
        await this.state.storage.delete(key);
      }

      const cacheEntries = await this.state.storage.list<CachedLine>({ prefix: CACHE_KEY_PREFIX });
      for (const key of findExpiredCacheKeys(cacheEntries, now, CACHE_MAX_AGE_MS)) {
        await this.state.storage.delete(key);
      }

      const ipBudgetEntries = await this.state.storage.list<{ date: string }>({ prefix: IP_BUDGET_KEY_PREFIX });
      for (const key of findStaleIpBudgetKeys(ipBudgetEntries, now)) {
        await this.state.storage.delete(key);
      }
    } finally {
      // Planlæg NÆSTE oprydning, selvom denne omgang fejlede halvvejs — én
      // dårlig omgang må ikke stoppe alle fremtidige for evigt.
      await this.state.storage.setAlarm(now + CLEANUP_INTERVAL_MS);
    }
  }

  /** Bygger det færdige HTTP-svar — ét sted, så `fetch()`s tidlige
   * afvisninger (405/503/429 før kroppen overhovedet læses) og den sene,
   * `decide()`-afledte afvisning bygger deres `Response` PRÆCIS ens. */
  private toHttpResponse(status: number, body: unknown, retryAfterSeconds?: number): Response {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);
    return new Response(JSON.stringify(body), { status, headers });
  }

  async fetch(req: Request): Promise<Response> {
    await this.ensureCleanupScheduled();

    if (req.method !== "POST") {
      return this.toHttpResponse(405, { error: "POST only" });
    }

    // Identiteten er allerede fastslået ved kanten (`index.ts`) — her læses
    // KUN den færdige hash, og KUN hvis den har rigtig form. En manglende
    // eller forkert formet header betyder tilliden mellem kant og objekt er
    // brudt (fx et forsøg på at kalde dette objekt uden om `index.ts`), og
    // objektet gætter ALDRIG en identitet i stedet — det fejler lukket.
    const ipHash = req.headers.get(INTERNAL_IP_HASH_HEADER);
    if (!isValidIpHash(ipHash)) {
      return this.toHttpResponse(503, { error: "missing or invalid identity" });
    }

    // Rate limit reserveres FØR noget som helst af kroppen læses/parses
    // (sikkerhedsrunde 3, punkt 1). Ellers kunne en for stor eller
    // misdannet krop undgå rate-limiten fuldstændig — den ville blive
    // afvist (400) LÆNGE før noget rate-limit-tjek nogensinde så
    // forespørgslen, og en angriber kunne sende ubegrænset mange sådanne
    // uden at ramme noget loft. Se `coordinator.ts`s `reserveRateLimitSlot`.
    const rateLimit = await reserveRateLimitSlot(ipHash, this.getDeps());
    if (!rateLimit.allowed) {
      return this.toHttpResponse(429, { error: "rate limited", reason: "rate limit" }, rateLimit.retryAfterSeconds);
    }

    // Størrelsen tjekkes på råteksten, FØR parsing — et kæmpe body skal
    // ikke engang JSON.parse'es, endsige røre budgettet. Rate-limit-slottet
    // ovenfor er ALLEREDE brugt af netop dette forsøg — der reserveres IKKE
    // endnu et slot her eller længere nede, uanset hvad der sker herfra.
    const rawText = await req.text();
    if (isBodyTooLarge(rawText)) {
      return this.toHttpResponse(400, { error: "body too large" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return this.toHttpResponse(400, { error: "bad json" });
    }

    const result = await decide(parsed, ipHash, this.getDeps());
    const { status, body, retryAfterSeconds } = responseFor(result);
    return this.toHttpResponse(status, body, retryAfterSeconds);
  }
}
