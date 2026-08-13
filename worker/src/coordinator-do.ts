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
import { isBodyTooLarge, isJsonContentType } from "./validate";
import { promptNamespace } from "./cache-key";
import { callUpstreamOpenAI, DEFAULT_MODEL, PROMPT_VERSION_INPUT, type ModelEnv } from "./model";
import { VOICE_PROFILE_HASH, VOICE_PROFILE_VERSION } from "./voice/gate";
import { ADMIN_VERIFIED_HEADER } from "./admin";
import { STATS_KEY_PREFIX, STATS_MAX_AGE_MS, buildStatsExport, clampExportLimit, findStaleStatsKeys, type PairStatsRecord } from "./stats";
import {
  createImproviseDeps,
  decideImprovise,
  reserveImproviseRateLimitSlot,
  IMPROVISE_CACHE_KEY_PREFIX,
  IMPROVISE_IP_BUDGET_KEY_PREFIX,
  IMPROVISE_RATE_LIMIT_KEY_PREFIX,
  type ImproviseDeps,
  type ImproviseResponse,
} from "./improvise";
import {
  callImproviseOpenAI,
  IMPROVISE_PROMPT_VERSION_INPUT,
} from "./improvise-model";
import {
  IMPROVISE_STATS_KEY_PREFIX,
  buildImproviseExport,
  findStaleImproviseStatsKeys,
  type CachedImprovisation,
  type ImproviseStatsRecord,
} from "./improvise-stats";

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
  /** Improvisation har egne kvoter og lager-nøgler, uafhængigt af fortælleren. */
  IMPROVISE_RATE_LIMIT_WINDOW_SECONDS?: string;
  IMPROVISE_RATE_LIMIT_MAX?: string;
  IMPROVISE_DAILY_MAX_UPSTREAM_CALLS?: string;
  IMPROVISE_DAILY_MAX_UPSTREAM_CALLS_PER_IP?: string;
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
const DEFAULT_IMPROVISE_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_IMPROVISE_RATE_LIMIT_MAX = 10;
const DEFAULT_IMPROVISE_DAILY_MAX_UPSTREAM_CALLS = 100;
const DEFAULT_IMPROVISE_DAILY_MAX_UPSTREAM_CALLS_PER_IP = 25;

/**
 * Hvor længe en cache-post må ligge, før oprydningen fjerner den
 * (sikkerhedsrunde 2, punkt 4). Indholdet BLIVER ikke forkert med tiden —
 * samme par+dom+navnerum giver stadig samme kategori af fiasko — men et
 * ubegrænset lager er en ubegrænset regning. En ændring i prompt-
 * kontrakten (SYSTEM, en DOMME-forklaring, brugerprompt-skabelonen) eller
 * modellen rammes IKKE af denne grænse og behøver ikke vente på den:
 * cache-navnerummet (sikkerhedsrunde 3, punkt 3, udvidet i en opfølgning,
 * se `cache-key.ts`s `promptNamespace()` og `model.ts`s
 * `PROMPT_VERSION_INPUT`) udledes AUTOMATISK af hele prompt-kontrakten og
 * modellen, så en ændring i én af dem gør gamle nøgler uopslåelige med det
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

/**
 * Rate-limitens nøgle for admin-eksporten (TASK-008): genbruger PRÆCIS
 * samme mekanisme som narrator-strømmens IP-hash-baserede rullende vindue
 * (`reserveRateLimitSlot`, `coordinator.ts`), men med en FAST,
 * menneskelæselig sentinel-streng i stedet for en rigtig ipHash — en helt
 * ny rate-limiter for ét enkelt endpoint ville være unødvendig
 * kompleksitet. Kan aldrig kollidere med en ægte ipHash: en gyldig ipHash
 * er ALTID præcis 64 små hex-tegn (`ip.ts`s `isValidIpHash`), og denne
 * streng er hverken 64 tegn lang eller ren hex.
 */
const ADMIN_RATE_LIMIT_SENTINEL = "admin:pairs-export";
const ADMIN_IMPROVISE_RATE_LIMIT_SENTINEL = "admin:improvisations-export";

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

function responseForImprovise(result: ImproviseResponse): AdapterResponse {
  if (result.status === 200) return { status: 200, body: result.value };
  if (result.status === 400) {
    return { status: 400, body: { error: "bad request", reason: result.reason } };
  }
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
  private improviseDeps: ImproviseDeps | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CoordinatorEnv,
  ) {}

  private getDeps(): CoordinatorDeps {
    if (!this.deps) {
      // Udledt ÉN gang pr. objekt-instans (ikke pr. forespørgsel) — hele
      // prompt-kontrakten (SYSTEM+DOMME+skabelon, `PROMPT_VERSION_INPUT`),
      // modellen OG stemmeprofilen (`VOICE_PROFILE_HASH`, TASK-007) ændrer
      // sig kun ved en gendeploy, som skaber en FRISK instans alligevel
      // (sikkerhedsrunde 3, punkt 3; udvidet i en opfølgning til at dække
      // DOMME og brugerprompt-skabelonen, ikke kun SYSTEM; udvidet igen af
      // TASK-007 til også at dække stemmepolitikken — en strammet/løsnet
      // stemmegate skal ikke blive ved med at servere gamle cache-linjer
      // dømt efter GÅRSDAGENS politik).
      const cacheNamespace = promptNamespace(PROMPT_VERSION_INPUT, this.env.MODEL ?? DEFAULT_MODEL, VOICE_PROFILE_HASH);
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

  private getImproviseDeps(): ImproviseDeps {
    if (!this.improviseDeps) {
      const cacheNamespace = promptNamespace(
        IMPROVISE_PROMPT_VERSION_INPUT,
        this.env.MODEL ?? DEFAULT_MODEL,
      );
      this.improviseDeps = createImproviseDeps({
        store: this.state.storage,
        callUpstream: (body) => callImproviseOpenAI(body, this.env),
        config: {
          rateLimitWindowMs:
            toPositiveInt(
              this.env.IMPROVISE_RATE_LIMIT_WINDOW_SECONDS,
              DEFAULT_IMPROVISE_RATE_LIMIT_WINDOW_SECONDS,
            ) * 1000,
          rateLimitMax: toPositiveInt(
            this.env.IMPROVISE_RATE_LIMIT_MAX,
            DEFAULT_IMPROVISE_RATE_LIMIT_MAX,
          ),
          dailyMax: toNonNegativeInt(
            this.env.IMPROVISE_DAILY_MAX_UPSTREAM_CALLS,
            DEFAULT_IMPROVISE_DAILY_MAX_UPSTREAM_CALLS,
          ),
          dailyMaxPerIp: toNonNegativeInt(
            this.env.IMPROVISE_DAILY_MAX_UPSTREAM_CALLS_PER_IP,
            DEFAULT_IMPROVISE_DAILY_MAX_UPSTREAM_CALLS_PER_IP,
          ),
          cacheNamespace,
        },
      });
    }
    return this.improviseDeps;
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
   * rate-limit-poster, for gamle cache-poster, (sikkerhedsrunde 3, punkt 2)
   * pr.-IP-budgetposter hvis gemte UTC-dato hverken er i dag eller i går,
   * og (TASK-008) stats-poster uden aktivitet i `STATS_MAX_AGE_MS` —
   * planlægger så næste omgang, uanset om denne omgang selv gik helt godt.
   */
  async alarm(): Promise<void> {
    const deps = this.getDeps();
    const now = deps.now();
    try {
      const allRateLimitEntries = await this.state.storage.list<number[]>({
        prefix: RATE_LIMIT_KEY_PREFIX,
      });
      const rlEntries = new Map(
        [...allRateLimitEntries].filter(
          ([key]) => !key.startsWith(IMPROVISE_RATE_LIMIT_KEY_PREFIX),
        ),
      );
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

      // TASK-008: efterspørgselssignalet ryddes UAFHÆNGIGT af cachen (se
      // `stats.ts`s fil-kommentar — de har hver sin levetid) og baseret på
      // SENEST set, ikke oprettet, så et par der stadig aktivt bliver
      // spurgt om, aldrig forsvinder midt i en lang bagerundes gennemgang.
      const statsEntries = await this.state.storage.list<PairStatsRecord>({ prefix: STATS_KEY_PREFIX });
      for (const key of findStaleStatsKeys(statsEntries, now, STATS_MAX_AGE_MS)) {
        await this.state.storage.delete(key);
      }

      const improviseDeps = this.getImproviseDeps();
      const improviseRateEntries = await this.state.storage.list<number[]>({
        prefix: IMPROVISE_RATE_LIMIT_KEY_PREFIX,
      });
      for (
        const key of findStaleRateLimitKeys(
          improviseRateEntries,
          now,
          improviseDeps.config.rateLimitWindowMs,
        )
      ) {
        await this.state.storage.delete(key);
      }

      const improviseCacheEntries = await this.state.storage.list<CachedImprovisation>({
        prefix: IMPROVISE_CACHE_KEY_PREFIX,
      });
      for (const key of findExpiredCacheKeys(improviseCacheEntries, now, CACHE_MAX_AGE_MS)) {
        await this.state.storage.delete(key);
      }

      const improviseIpBudgets = await this.state.storage.list<{ date: string }>({
        prefix: IMPROVISE_IP_BUDGET_KEY_PREFIX,
      });
      for (const key of findStaleIpBudgetKeys(improviseIpBudgets, now)) {
        await this.state.storage.delete(key);
      }

      const improviseStats = await this.state.storage.list<ImproviseStatsRecord>({
        prefix: IMPROVISE_STATS_KEY_PREFIX,
      });
      for (const key of findStaleImproviseStatsKeys(improviseStats, now)) {
        await this.state.storage.delete(key);
      }
    } finally {
      // Planlæg NÆSTE oprydning, selvom denne omgang fejlede halvvejs — én
      // dårlig omgang må ikke stoppe alle fremtidige for evigt.
      await this.state.storage.setAlarm(now + CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * `GET /admin/pairs` (TASK-008): den høstede-efterspørgsel-eksport. Egen
   * metode, adskilt fra narrator-strømmen i `fetch()` nedenfor — helt
   * anden godkendelsesform, og skal ALDRIG kunne nå `decide()`, modellen
   * eller budgettet.
   *
   * Tjekker `ADMIN_VERIFIED_HEADER` som forsvar-i-dybde: selve
   * bearer-token-kontrollen er allerede sket i `index.ts` (det RÅ token
   * når aldrig herind) — men dette objekt stoler ALDRIG blindt på at kun
   * `index.ts` arkitektonisk kan kalde det, præcis som det aldrig stoler
   * blindt på `INTERNAL_IP_HASH_HEADER`s blotte tilstedeværelse i
   * narrator-strømmen.
   */
  private async handleAdminExport(req: Request, url: URL): Promise<Response> {
    if (req.method !== "GET") {
      return this.toHttpResponse(405, { error: "GET only" });
    }
    if (req.headers.get(ADMIN_VERIFIED_HEADER) !== "1") {
      return this.toHttpResponse(401, { error: "unauthorized" });
    }

    const deps = this.getDeps();
    const rateLimit = await reserveRateLimitSlot(ADMIN_RATE_LIMIT_SENTINEL, deps);
    if (!rateLimit.allowed) {
      return this.toHttpResponse(429, { error: "rate limited" }, rateLimit.retryAfterSeconds);
    }

    const entries = await this.state.storage.list<PairStatsRecord>({ prefix: STATS_KEY_PREFIX });
    const payload = buildStatsExport(entries, {
      limit: clampExportLimit(url.searchParams.get("limit")),
      cursor: url.searchParams.get("cursor"),
      now: deps.now(),
      cacheNamespace: deps.config.cacheNamespace,
      voiceProfileVersion: VOICE_PROFILE_VERSION,
      voiceProfileHash: VOICE_PROFILE_HASH,
    });
    return this.toHttpResponse(200, payload);
  }

  private async handleAdminImproviseExport(req: Request, url: URL): Promise<Response> {
    if (req.method !== "GET") {
      return this.toHttpResponse(405, { error: "GET only" });
    }
    if (req.headers.get(ADMIN_VERIFIED_HEADER) !== "1") {
      return this.toHttpResponse(401, { error: "unauthorized" });
    }

    const deps = this.getDeps();
    const rateLimit = await reserveRateLimitSlot(
      ADMIN_IMPROVISE_RATE_LIMIT_SENTINEL,
      deps,
    );
    if (!rateLimit.allowed) {
      return this.toHttpResponse(
        429,
        { error: "rate limited" },
        rateLimit.retryAfterSeconds,
      );
    }

    const cursor = url.searchParams.get("cursor");
    const requestedSnapshot = url.searchParams.get("snapshot");
    if (cursor !== null && requestedSnapshot === null) {
      return this.toHttpResponse(400, { error: "snapshot required with cursor" });
    }
    if (
      requestedSnapshot !== null &&
      !/^[0-9a-f]{64}$/.test(requestedSnapshot)
    ) {
      return this.toHttpResponse(400, { error: "invalid snapshot" });
    }

    const improviseDeps = this.getImproviseDeps();
    const cachePrefix =
      IMPROVISE_CACHE_KEY_PREFIX + improviseDeps.config.cacheNamespace + ":";
    const [cachedEntries, statsEntries] = await Promise.all([
      this.state.storage.list<CachedImprovisation>({ prefix: cachePrefix }),
      this.state.storage.list<ImproviseStatsRecord>({
        prefix: IMPROVISE_STATS_KEY_PREFIX,
      }),
    ]);
    const payload = await buildImproviseExport(cachedEntries, statsEntries, {
      promptNamespace: improviseDeps.config.cacheNamespace,
      now: improviseDeps.now(),
      limit: clampExportLimit(url.searchParams.get("limit")),
      cursor,
    });
    if (
      requestedSnapshot !== null &&
      requestedSnapshot !== payload.snapshotVersion
    ) {
      return this.toHttpResponse(409, { error: "snapshot changed" });
    }
    return this.toHttpResponse(200, payload);
  }

  private async handleImprovise(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return this.toHttpResponse(405, { error: "POST only" });
    }

    const ipHash = req.headers.get(INTERNAL_IP_HASH_HEADER);
    if (!isValidIpHash(ipHash)) {
      return this.toHttpResponse(503, { error: "missing or invalid identity" });
    }

    const rateLimit = await reserveImproviseRateLimitSlot(
      ipHash,
      this.getImproviseDeps(),
    );
    if (!rateLimit.allowed) {
      return this.toHttpResponse(
        429,
        { error: "rate limited", reason: "rate limit" },
        rateLimit.retryAfterSeconds,
      );
    }

    if (!isJsonContentType(req.headers.get("content-type"))) {
      return this.toHttpResponse(415, {
        error: "content type must be application/json",
      });
    }

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

    const result = await decideImprovise(
      parsed,
      ipHash,
      this.getImproviseDeps(),
    );
    const { status, body, retryAfterSeconds } = responseForImprovise(result);
    return this.toHttpResponse(status, body, retryAfterSeconds);
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

    // TASK-008: `/admin/pairs` er en HELT ANDEN sti end narrator-strømmen
    // nedenfor — tjekkes derfor FØRST, før det generelle "POST only"-krav
    // (admin-eksporten er bevidst GET, se `handleAdminExport`s egen
    // dokumentation), og rører ALDRIG `decide()`, modellen eller budgettet.
    const url = new URL(req.url);
    if (url.pathname === "/admin/pairs") {
      return this.handleAdminExport(req, url);
    }
    if (url.pathname === "/admin/improvisations") {
      return this.handleAdminImproviseExport(req, url);
    }
    if (url.pathname === "/improvise") {
      return this.handleImprovise(req);
    }

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

    if (!isJsonContentType(req.headers.get("content-type"))) {
      return this.toHttpResponse(415, {
        error: "content type must be application/json",
      });
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
