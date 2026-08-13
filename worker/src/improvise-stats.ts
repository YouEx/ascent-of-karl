/** Smal efterspørgselsstatistik og autentificeret eksport for improvisationer. */

import type { ImproviseCopy } from "./improvise-output";

export const IMPROVISE_STATS_KEY_PREFIX = "improv-stats:";
export const IMPROVISE_STATS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const IMPROVISE_EXPORT_SCHEMA_VERSION = 3;

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
  act: number;
  count: number;
  cacheHits: number;
  upstreamCalls: number;
  firstSeen: number;
  lastSeen: number;
}

export function improviseStatsKey(aId: string, bId: string, act: number): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${IMPROVISE_STATS_KEY_PREFIX}${first}+${second}:act:${act}`;
}

function nextStats(
  existing: ImproviseStatsRecord | undefined,
  now: number,
  outcome: ImproviseStatsOutcome,
  aId: string,
  bId: string,
  act: number,
): ImproviseStatsRecord {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  const base = existing ?? {
    aId: first,
    bId: second,
    act,
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
  act: number,
  outcome: ImproviseStatsOutcome,
): Promise<void> {
  try {
    const key = improviseStatsKey(aId, bId, act);
    const existing = await store.get<ImproviseStatsRecord>(key);
    await store.put(key, nextStats(existing, now, outcome, aId, bId, act));
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
  snapshotVersion: string;
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

async function snapshotVersion(
  promptNamespace: string,
  all: ReadonlyArray<{ cursorKey: string; entry: ImproviseExportEntry }>,
): Promise<string> {
  const material = JSON.stringify({
    schemaVersion: IMPROVISE_EXPORT_SCHEMA_VERSION,
    promptNamespace,
    entries: all.map(({ cursorKey, entry }) => ({ cursorKey, entry })),
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildImproviseExport(
  cachedEntries: ReadonlyMap<string, CachedImprovisation>,
  statsEntries: ReadonlyMap<string, ImproviseStatsRecord>,
  opts: { promptNamespace: string; now: number; limit: number; cursor: string | null },
): Promise<ImproviseExportPayload> {
  const all = [...cachedEntries.values()]
    .map((cached) => {
      const stats = statsEntries.get(
        improviseStatsKey(cached.aId, cached.bId, cached.act),
      );
      const cursorKey = `${cached.aId}~${cached.bId}~${cached.act}`;
      const entry: ImproviseExportEntry = {
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
      return { cursorKey, entry };
    })
    .sort((a, b) => {
      return a.cursorKey < b.cursorKey ? -1 : a.cursorKey > b.cursorKey ? 1 : 0;
    });

  const remaining = opts.cursor
    ? all.filter((item) => item.cursorKey > opts.cursor!)
    : all;
  const page = remaining.slice(0, opts.limit);
  const nextCursor =
    page.length < remaining.length ? page.at(-1)?.cursorKey ?? null : null;

  return {
    schemaVersion: IMPROVISE_EXPORT_SCHEMA_VERSION,
    promptNamespace: opts.promptNamespace,
    snapshotVersion: await snapshotVersion(opts.promptNamespace, all),
    generatedAt: opts.now,
    total: all.length,
    counts: {
      cached: all.length,
      requests: all.reduce((sum, item) => sum + item.entry.count, 0),
      cacheHits: all.reduce((sum, item) => sum + item.entry.cacheHits, 0),
      upstreamCalls: all.reduce((sum, item) => sum + item.entry.upstreamCalls, 0),
    },
    entries: page.map((item) => item.entry),
    nextCursor,
  };
}
