/** Smal efterspørgselsstatistik og autentificeret eksport for improvisationer. */

import type { ImproviseCopy } from "./improvise-output";

export const IMPROVISE_STATS_KEY_PREFIX = "improv-stats:";
export const IMPROVISE_STATS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const IMPROVISE_EXPORT_SCHEMA_VERSION = 1;

export type ImproviseStatsOutcome = "hit" | "upstream" | "other";

export interface CachedImprovisation {
  aId: string;
  bId: string;
  act: number;
  value: ImproviseCopy;
  createdAt: number;
}

export interface ImproviseStatsRecord {
  aId: string;
  bId: string;
  count: number;
  cacheHits: number;
  upstreamCalls: number;
  firstSeen: number;
  lastSeen: number;
}

export function improviseStatsKey(aId: string, bId: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${IMPROVISE_STATS_KEY_PREFIX}${first}+${second}`;
}

function nextStats(
  existing: ImproviseStatsRecord | undefined,
  now: number,
  outcome: ImproviseStatsOutcome,
  aId: string,
  bId: string,
): ImproviseStatsRecord {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  const base = existing ?? {
    aId: first,
    bId: second,
    count: 0,
    cacheHits: 0,
    upstreamCalls: 0,
    firstSeen: now,
    lastSeen: now,
  };
  return {
    ...base,
    count: base.count + 1,
    cacheHits: base.cacheHits + (outcome === "hit" ? 1 : 0),
    upstreamCalls: base.upstreamCalls + (outcome === "upstream" ? 1 : 0),
    lastSeen: now,
  };
}

interface MinimalStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export async function recordImproviseStats(
  store: MinimalStore,
  now: number,
  aId: string,
  bId: string,
  outcome: ImproviseStatsOutcome,
): Promise<void> {
  try {
    const key = improviseStatsKey(aId, bId);
    const existing = await store.get<ImproviseStatsRecord>(key);
    await store.put(key, nextStats(existing, now, outcome, aId, bId));
  } catch {
    // Statistik må aldrig vælte spillerens svar.
  }
}

export function findStaleImproviseStatsKeys(
  entries: ReadonlyMap<string, { readonly lastSeen: number }>,
  now: number,
): string[] {
  const stale: string[] = [];
  for (const [key, entry] of entries) {
    if (now - entry.lastSeen > IMPROVISE_STATS_MAX_AGE_MS) stale.push(key);
  }
  return stale;
}

export interface ImproviseExportEntry {
  aId: string;
  bId: string;
  act: number;
  name: string;
  flavor: string;
  createdAt: number;
  count: number;
  cacheHits: number;
  upstreamCalls: number;
  firstSeen: number;
  lastSeen: number;
}

export interface ImproviseExportPayload {
  schemaVersion: number;
  promptNamespace: string;
  generatedAt: number;
  total: number;
  counts: {
    cached: number;
    requests: number;
    cacheHits: number;
    upstreamCalls: number;
  };
  entries: ImproviseExportEntry[];
  nextCursor: string | null;
}

export function buildImproviseExport(
  cachedEntries: ReadonlyMap<string, CachedImprovisation>,
  statsEntries: ReadonlyMap<string, ImproviseStatsRecord>,
  opts: { promptNamespace: string; now: number; limit: number; cursor: string | null },
): ImproviseExportPayload {
  const all = [...cachedEntries.values()]
    .map((cached): ImproviseExportEntry => {
      const stats = statsEntries.get(improviseStatsKey(cached.aId, cached.bId));
      return {
        aId: cached.aId,
        bId: cached.bId,
        act: cached.act,
        name: cached.value.name,
        flavor: cached.value.flavor,
        createdAt: cached.createdAt,
        count: stats?.count ?? 0,
        cacheHits: stats?.cacheHits ?? 0,
        upstreamCalls: stats?.upstreamCalls ?? 0,
        firstSeen: stats?.firstSeen ?? cached.createdAt,
        lastSeen: stats?.lastSeen ?? cached.createdAt,
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
      if (a.aId !== b.aId) return a.aId < b.aId ? -1 : 1;
      return a.bId < b.bId ? -1 : a.bId > b.bId ? 1 : 0;
    });

  const parsedCursor = opts.cursor ? Number.parseInt(opts.cursor, 10) : 0;
  const start = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const page = all.slice(start, start + opts.limit);
  const nextCursor = start + opts.limit < all.length ? String(start + opts.limit) : null;

  return {
    schemaVersion: IMPROVISE_EXPORT_SCHEMA_VERSION,
    promptNamespace: opts.promptNamespace,
    generatedAt: opts.now,
    total: all.length,
    counts: {
      cached: all.length,
      requests: all.reduce((sum, entry) => sum + entry.count, 0),
      cacheHits: all.reduce((sum, entry) => sum + entry.cacheHits, 0),
      upstreamCalls: all.reduce((sum, entry) => sum + entry.upstreamCalls, 0),
    },
    entries: page,
    nextCursor,
  };
}
