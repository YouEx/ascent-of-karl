/**
 * TASK-008: tæller ÆGTE efterspørgsel — hvilke par+dom spillerne rent
 * faktisk støder på i DENNE PRODUKTION, ikke kun i simuleringen — uden
 * NOGENSINDE at gemme en IP eller den genererede tekst. Formålet er at
 * give `tools/prepare_pairs.ts` et ægte, høstet signal ved siden af det
 * simulerede (`tools/pair_frequency.ts`), til den NÆSTE
 * menneske-gennemgåede bagerunde — se `plan/feature-live-narrator-1.md`,
 * TASK-008.
 *
 * Nøglen er BEVIDST UAFHÆNGIG af cache-navnerummet
 * (`cache-key.ts`s `promptNamespace()`): en almindelig prompt-, model-
 * eller stemmepolitik-ændring nulstiller cachen med vilje (TASK-007), men
 * efterspørgselssignalet "hvilke par bliver spurgt om" er en helt anden
 * akse og skal IKKE nulstilles, bare fordi prompten fik en rettelse. Samme
 * par+dom bliver ved med at tælle på tværs af den slags ændringer — kun en
 * ny udgivelse af selve SPILLET (nye elementer/opskrifter) gør et
 * par+dom-nøgle irrelevant, og det er ikke noget denne fil kan eller skal
 * afgøre.
 *
 * Følger samme mønster som `cleanup.ts`: RENE funktioner her (intet
 * `fs`/`storage`-kald). Selve `storage.get/put`-kaldet for tælling sker i
 * `coordinator.ts`s `decide()` (inde i dens eksisterende atomiske
 * `gate.run(...)`), og `storage.list/delete`-kaldene for eksport og
 * oprydning sker udelukkende i `coordinator-do.ts`.
 *
 * "Tælling" her betyder: en anmodning der bestod validering OG kanonisering
 * (`resolveCanonical` lykkedes) — cache-hit, cache-miss der starter et nyt
 * opstrømskald, cache-miss der tilslutter et allerede i gang værende kald,
 * ELLER et budget-afvist forsøg (503/429) tæller ALLE med. Et
 * budget-afvist forsøg er stadig ægte efterspørgsel — arguably det
 * STÆRKESTE bage-signal, fordi det viser et par, der bliver spurgt om
 * hyppigt nok til at ramme et loft. Kun 400-afvisninger (ugyldig form eller
 * ukendt id) tæller IKKE, fordi de aldrig når et kanonisk par+dom.
 *
 * `cacheHits`/`upstreamCalls` er IKKE en udtømmende opdeling af `count` —
 * de er to illustrative delmængde-tællere fra kravets tekst ("cache-hit/
 * upstream counters"), ikke et krav om en fuldt udtømmende
 * udfalds-taksonomi. Et tilsluttet-i-gang-værende kald eller et
 * budget-afvist forsøg øger `count`, men INGEN af de to deltællere.
 */

import type { KnownVerdict } from "./validate";

/** Præfiks for stats-nøgler i Durable Object-lageret — adskilt fra `cache:`, `rl:`, `budget:ip:`. */
export const STATS_KEY_PREFIX = "stats:";

/**
 * Hvor længe en stats-post overlever UDEN at være blevet spurgt om igen
 * (bruges af `coordinator-do.ts`s oprydningsalarm, samme mønster som
 * `coordinator-do.ts`s `CACHE_MAX_AGE_MS`). Baseret på `lastSeen`, IKKE
 * `firstSeen` — et par der stadig aktivt bliver spurgt om, må ALDRIG blive
 * ryddet væk, uanset hvor gammel den første forekomst er. 90 dage er
 * rigeligt til at dække en hel bagerundes gennemgangs-cyklus (skriv om
 * bage-kandidat → gennemgå → bage → gendeploy) uden at lageret vokser
 * ubegrænset.
 */
export const STATS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Bumpes hvis eksportens JSON-form ændrer sig — `tools/live_pair_export.mjs` afviser en uventet version. */
export const STATS_EXPORT_SCHEMA_VERSION = 1;

/** Standard antal poster pr. eksport-kald, hvis `limit`-parameteren mangler. */
export const DEFAULT_ADMIN_EXPORT_LIMIT = 200;

/** Absolut loft — ingen forespørgsel, uanset hvad den selv beder om, kan få flere end dette. */
export const MAX_ADMIN_EXPORT_LIMIT = 500;

/**
 * Hvordan endte denne (allerede kanoniske) forespørgsel?
 *   "hit"      — cache-hit, intet opstrømskald.
 *   "upstream" — et NYT opstrømskald blev startet (ikke et tilsluttet i
 *                gang værende, se `coordinator.ts`s `decide()`).
 *   "other"    — tilsluttede et allerede i gang værende kald, ELLER blev
 *                budget-afvist (globalt eller pr.-IP).
 */
export type PairStatsOutcome = "hit" | "upstream" | "other";

/**
 * ÉN post pr. par+dom. Bevidst SMAL: kun de to canoniske id'er, dommen, tre
 * tællere og to tidsstempler — ingen IP (hverken rå eller hashet), intet
 * tekstfelt, ingen model/prompt-detalje. Det er selve garantien for
 * "no IP/raw text in stats/export".
 */
export interface PairStatsRecord {
  aId: string;
  bId: string;
  verdict: KnownVerdict;
  count: number;
  cacheHits: number;
  upstreamCalls: number;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Kanonisk (par-sorteret, dom-følsom) nøgle — samme sorteringsregel som
 * `cache-key.ts`s `pairCacheKey`, men UDEN navnerum (se fil-kommentaren
 * ovenfor for hvorfor).
 */
export function statsKey(aId: string, bId: string, verdict: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${STATS_KEY_PREFIX}${first}+${second}:${verdict}`;
}

/**
 * Ren reducer: næste tilstand for ÉN post, givet ét udfald. Ingen I/O —
 * testbar uden noget lager overhovedet.
 */
export function nextPairStatsRecord(
  existing: PairStatsRecord | undefined,
  now: number,
  outcome: PairStatsOutcome,
  aId: string,
  bId: string,
  verdict: KnownVerdict,
): PairStatsRecord {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  const base: PairStatsRecord = existing ?? {
    aId: first,
    bId: second,
    verdict,
    count: 0,
    cacheHits: 0,
    upstreamCalls: 0,
    firstSeen: now,
    lastSeen: now,
  };
  return {
    aId: base.aId,
    bId: base.bId,
    verdict: base.verdict,
    count: base.count + 1,
    cacheHits: base.cacheHits + (outcome === "hit" ? 1 : 0),
    upstreamCalls: base.upstreamCalls + (outcome === "upstream" ? 1 : 0),
    firstSeen: base.firstSeen,
    lastSeen: now,
  };
}

/** Den mindste lager-grænseflade denne fil selv har brug for — opfyldt af `KeyValueStore` og `DurableObjectStorage` begge. */
interface MinimalStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/**
 * I/O-indpakningen: læser den eksisterende post, regner den næste tilstand
 * (`nextPairStatsRecord`), skriver den tilbage. Fejler ALDRIG synligt —
 * statistik er hygiejne, ikke selve svaret til spilleren (samme
 * konvention som `coordinator-do.ts`s `ensureCleanupScheduled()`s bare
 * `catch {}`).
 */
export async function recordPairStats(
  store: MinimalStore,
  now: number,
  aId: string,
  bId: string,
  verdict: KnownVerdict,
  outcome: PairStatsOutcome,
): Promise<void> {
  try {
    const key = statsKey(aId, bId, verdict);
    const existing = await store.get<PairStatsRecord>(key);
    const next = nextPairStatsRecord(existing, now, outcome, aId, bId, verdict);
    await store.put(key, next);
  } catch {
    // Tælling må aldrig vælte det rigtige svar — se fil-kommentaren.
  }
}

/**
 * Hvilke stats-nøgler er IKKE blevet spurgt om i `maxAgeMs`? Samme mønster
 * som `cleanup.ts`s `findExpiredCacheKeys` — ren funktion, det faktiske
 * `storage.delete()`-kald sker i `coordinator-do.ts`s `alarm()`.
 */
export function findStaleStatsKeys(
  entries: ReadonlyMap<string, { readonly lastSeen: number }>,
  now: number,
  maxAgeMs: number = STATS_MAX_AGE_MS,
): string[] {
  const stale: string[] = [];
  for (const [key, entry] of entries) {
    if (now - entry.lastSeen > maxAgeMs) stale.push(key);
  }
  return stale;
}

/**
 * Fortolker `limit`-forespørgselsparameteren (altid en streng eller
 * `null`, ligesom Wrangler-vars — se `env.ts`s `toPositiveInt`/
 * `toNonNegativeInt` for samme mønster): falder tilbage til
 * `DEFAULT_ADMIN_EXPORT_LIMIT` ved mangel/ugyldig værdi, klamper altid til
 * `MAX_ADMIN_EXPORT_LIMIT` — en forespørgsel kan aldrig bede om flere
 * poster end loftet, uanset hvad den selv skriver.
 */
export function clampExportLimit(
  raw: string | null,
  fallback: number = DEFAULT_ADMIN_EXPORT_LIMIT,
  max: number = MAX_ADMIN_EXPORT_LIMIT,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export interface StatsExportPayload {
  schemaVersion: number;
  /** Så et eksport-forbrugende værktøj kan se, hvilken cache-generation tallene stammer fra. */
  cacheNamespace: string;
  voiceProfileVersion: number;
  voiceProfileHash: string;
  generatedAt: number;
  /** Samlet antal poster, FØR sideinddeling — til at vise fremdrift, ikke kun denne sides længde. */
  total: number;
  entries: PairStatsRecord[];
  /** `null` når dette var sidste side. Ellers en ugennemsigtig streng, givet tilbage som `cursor` i næste kald. */
  nextCursor: string | null;
}

/**
 * Bygger den stabile eksport-JSON, sorteret DETERMINISTISK (count faldende,
 * dernæst lastSeen faldende, dernæst aId/bId/verdict stigende) — to
 * eksporter af SAMME underliggende data giver altid samme rækkefølge,
 * uanset hvilken rækkefølge `storage.list()` tilfældigvis returnerede dem
 * i. Sideinddeling er en simpel offset-cursor over den (allerede
 * indlæste) liste — det mulige antal par+dom-nøgler er lille nok (antal
 * par × højst 7 domme) til at holde hele listen i hukommelsen ét øjeblik.
 */
export function buildStatsExport(
  entries: ReadonlyMap<string, PairStatsRecord>,
  opts: {
    limit?: number;
    cursor?: string | null;
    now: number;
    cacheNamespace: string;
    voiceProfileVersion: number;
    voiceProfileHash: string;
  },
): StatsExportPayload {
  const all = [...entries.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
    if (a.aId !== b.aId) return a.aId < b.aId ? -1 : 1;
    if (a.bId !== b.bId) return a.bId < b.bId ? -1 : 1;
    return a.verdict < b.verdict ? -1 : a.verdict > b.verdict ? 1 : 0;
  });

  const limit = Math.min(opts.limit ?? DEFAULT_ADMIN_EXPORT_LIMIT, MAX_ADMIN_EXPORT_LIMIT);
  const parsedCursor = opts.cursor ? Number.parseInt(opts.cursor, 10) : 0;
  const start = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const page = all.slice(start, start + limit);
  const nextCursor = start + limit < all.length ? String(start + limit) : null;

  return {
    schemaVersion: STATS_EXPORT_SCHEMA_VERSION,
    cacheNamespace: opts.cacheNamespace,
    voiceProfileVersion: opts.voiceProfileVersion,
    voiceProfileHash: opts.voiceProfileHash,
    generatedAt: opts.now,
    total: all.length,
    entries: page,
    nextCursor,
  };
}
