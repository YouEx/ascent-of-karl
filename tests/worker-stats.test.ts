import { describe, expect, it } from "vitest";
import {
  STATS_KEY_PREFIX,
  STATS_MAX_AGE_MS,
  STATS_EXPORT_SCHEMA_VERSION,
  DEFAULT_ADMIN_EXPORT_LIMIT,
  MAX_ADMIN_EXPORT_LIMIT,
  statsKey,
  nextPairStatsRecord,
  recordPairStats,
  findStaleStatsKeys,
  clampExportLimit,
  buildStatsExport,
  type PairStatsRecord,
} from "../worker/src/stats";
import { InMemoryStore } from "../worker/src/store";

/**
 * TASK-008: høstet efterspørgsel, uden IP eller rå tekst — se
 * `worker/src/stats.ts`s fil-kommentar for den fulde begrundelse
 * (nøglen er BEVIDST uafhængig af cache-navnerummet, og kun `lastSeen`,
 * ikke `firstSeen`, afgør om en post ryddes).
 *
 * Rene funktioner testet direkte her (RED først, jf. TDD-kravet) — selve
 * kaldene fra `coordinator.ts`/`coordinator-do.ts` er testet i
 * `tests/worker-coordinator.test.ts` og `tests/worker-edge.test.ts`.
 */

describe("statsKey: kanonisk, par-sorteret, dom-følsom (samme regel som cache-key.ts, uden navnerum)", () => {
  it("er uafhængig af parrets rækkefølge", () => {
    expect(statsKey("baer", "ler", "plausible")).toBe(statsKey("ler", "baer", "plausible"));
  });

  it("er følsom over for dommen", () => {
    expect(statsKey("baer", "ler", "plausible")).not.toBe(statsKey("baer", "ler", "near-miss"));
  });

  it("bruger STATS_KEY_PREFIX, adskilt fra cache: og andre præfikser", () => {
    expect(statsKey("baer", "ler", "plausible").startsWith(STATS_KEY_PREFIX)).toBe(true);
    expect(STATS_KEY_PREFIX).not.toBe("cache:");
  });

  it("indeholder ALDRIG mere end de to id'er og dommen — ingen plads til rå tekst eller IP", () => {
    const key = statsKey("baer", "ler", "plausible");
    expect(key).toBe("stats:baer+ler:plausible");
  });
});

describe("nextPairStatsRecord: ren reducer, ét udfald ad gangen", () => {
  it("initialiserer en frisk post ved første møde", () => {
    const rec = nextPairStatsRecord(undefined, 1000, "hit", "baer", "ler", "plausible");
    expect(rec).toEqual<PairStatsRecord>({
      aId: "baer",
      bId: "ler",
      verdict: "plausible",
      count: 1,
      cacheHits: 1,
      upstreamCalls: 0,
      firstSeen: 1000,
      lastSeen: 1000,
    });
  });

  it("sorterer aId/bId kanonisk, selv ved første møde med parret i omvendt rækkefølge", () => {
    const rec = nextPairStatsRecord(undefined, 1000, "other", "ler", "baer", "plausible");
    expect(rec.aId).toBe("baer");
    expect(rec.bId).toBe("ler");
  });

  it("øger count og opdaterer lastSeen ved gentagne møder, men bevarer firstSeen", () => {
    const first = nextPairStatsRecord(undefined, 1000, "hit", "baer", "ler", "plausible");
    const second = nextPairStatsRecord(first, 5000, "hit", "baer", "ler", "plausible");
    expect(second.count).toBe(2);
    expect(second.firstSeen).toBe(1000);
    expect(second.lastSeen).toBe(5000);
  });

  it('"upstream"-udfald øger upstreamCalls, ikke cacheHits', () => {
    const rec = nextPairStatsRecord(undefined, 1000, "upstream", "baer", "ler", "plausible");
    expect(rec.upstreamCalls).toBe(1);
    expect(rec.cacheHits).toBe(0);
    expect(rec.count).toBe(1);
  });

  it('"other"-udfald øger hverken cacheHits eller upstreamCalls, kun count', () => {
    const rec = nextPairStatsRecord(undefined, 1000, "other", "baer", "ler", "plausible");
    expect(rec.count).toBe(1);
    expect(rec.cacheHits).toBe(0);
    expect(rec.upstreamCalls).toBe(0);
  });

  it("kombinerer forskellige udfald korrekt over flere møder", () => {
    let rec = nextPairStatsRecord(undefined, 1, "upstream", "baer", "ler", "plausible");
    rec = nextPairStatsRecord(rec, 2, "hit", "baer", "ler", "plausible");
    rec = nextPairStatsRecord(rec, 3, "hit", "baer", "ler", "plausible");
    rec = nextPairStatsRecord(rec, 4, "other", "baer", "ler", "plausible");
    expect(rec.count).toBe(4);
    expect(rec.cacheHits).toBe(2);
    expect(rec.upstreamCalls).toBe(1);
    expect(rec.firstSeen).toBe(1);
    expect(rec.lastSeen).toBe(4);
  });

  it("posten har ALDRIG andre felter end de dokumenterede — ingen IP, intet tekstfelt", () => {
    const rec = nextPairStatsRecord(undefined, 1000, "hit", "baer", "ler", "plausible");
    expect(Object.keys(rec).sort()).toEqual(
      ["aId", "bId", "cacheHits", "count", "firstSeen", "lastSeen", "upstreamCalls", "verdict"].sort(),
    );
  });
});

describe("recordPairStats: I/O-indpakningen, aldrig synligt fejlende", () => {
  it("skriver en ny post ved første kald, og opdaterer den ved næste", async () => {
    const store = new InMemoryStore();
    await recordPairStats(store, 1000, "baer", "ler", "plausible", "hit");
    const first = await store.get<PairStatsRecord>(statsKey("baer", "ler", "plausible"));
    expect(first?.count).toBe(1);

    await recordPairStats(store, 2000, "baer", "ler", "plausible", "hit");
    const second = await store.get<PairStatsRecord>(statsKey("baer", "ler", "plausible"));
    expect(second?.count).toBe(2);
    expect(second?.lastSeen).toBe(2000);
  });

  it("holder forskellige par+dom-kombinationer i hver sin post", async () => {
    const store = new InMemoryStore();
    await recordPairStats(store, 1000, "baer", "ler", "plausible", "hit");
    await recordPairStats(store, 1000, "baer", "ler", "near-miss", "hit");
    await recordPairStats(store, 1000, "graes", "vand", "clash", "hit");

    expect((await store.get<PairStatsRecord>(statsKey("baer", "ler", "plausible")))?.count).toBe(1);
    expect((await store.get<PairStatsRecord>(statsKey("baer", "ler", "near-miss")))?.count).toBe(1);
    expect((await store.get<PairStatsRecord>(statsKey("graes", "vand", "clash")))?.count).toBe(1);
  });

  it("kaster ALDRIG, selv når det underliggende lager fejler (tælling er hygiejne, ikke svaret)", async () => {
    const explodingStore = {
      get: async () => {
        throw new Error("lager er nede");
      },
      put: async () => {
        throw new Error("lager er nede");
      },
    };
    await expect(recordPairStats(explodingStore, 1000, "baer", "ler", "plausible", "hit")).resolves.toBeUndefined();
  });
});

describe("findStaleStatsKeys: retention baseret på SENEST set, ikke oprettet", () => {
  it("en post uden fersk aktivitet er forældet efter maxAgeMs", () => {
    const now = 100_000_000;
    const entries = new Map([["stats:a+b:plausible", { lastSeen: now - STATS_MAX_AGE_MS - 1 }]]);
    expect(findStaleStatsKeys(entries, now, STATS_MAX_AGE_MS)).toEqual(["stats:a+b:plausible"]);
  });

  it("en fersk post overlever, selvom den (hypotetisk) blev oprettet for længe siden — kun lastSeen tæller", () => {
    const now = 100_000_000;
    const entries = new Map([["stats:a+b:plausible", { lastSeen: now - 1000 }]]);
    expect(findStaleStatsKeys(entries, now, STATS_MAX_AGE_MS)).toEqual([]);
  });

  it("bruger STATS_MAX_AGE_MS som standard, hvis intet andet gives", () => {
    const now = 100_000_000;
    const entries = new Map([
      ["frisk", { lastSeen: now - 1000 }],
      ["gammel", { lastSeen: now - STATS_MAX_AGE_MS - 1 }],
    ]);
    expect(findStaleStatsKeys(entries, now)).toEqual(["gammel"]);
  });
});

describe("clampExportLimit: aldrig over MAX_ADMIN_EXPORT_LIMIT, aldrig 0/negativ/NaN", () => {
  it("falder tilbage til DEFAULT_ADMIN_EXPORT_LIMIT hvis parameteren mangler", () => {
    expect(clampExportLimit(null)).toBe(DEFAULT_ADMIN_EXPORT_LIMIT);
  });

  it("falder tilbage ved en ugyldig (ikke-numerisk) værdi", () => {
    expect(clampExportLimit("abe")).toBe(DEFAULT_ADMIN_EXPORT_LIMIT);
  });

  it("falder tilbage ved 0 eller negativ", () => {
    expect(clampExportLimit("0")).toBe(DEFAULT_ADMIN_EXPORT_LIMIT);
    expect(clampExportLimit("-5")).toBe(DEFAULT_ADMIN_EXPORT_LIMIT);
  });

  it("lader en gyldig værdi under loftet passere uændret", () => {
    expect(clampExportLimit("50")).toBe(50);
  });

  it("klamper til MAX_ADMIN_EXPORT_LIMIT, uanset hvor stort tallet er", () => {
    expect(clampExportLimit("999999")).toBe(MAX_ADMIN_EXPORT_LIMIT);
  });
});

function rec(overrides: Partial<PairStatsRecord>): PairStatsRecord {
  return {
    aId: "baer",
    bId: "ler",
    verdict: "plausible",
    count: 1,
    cacheHits: 0,
    upstreamCalls: 0,
    firstSeen: 1,
    lastSeen: 1,
    ...overrides,
  };
}

describe("buildStatsExport: stabilt skema, deterministisk sortering, sideinddeling", () => {
  const commonOpts = {
    now: 123456,
    cacheNamespace: "ns-abc",
    voiceProfileVersion: 3,
    voiceProfileHash: "hash-xyz",
  };

  it("indeholder alle de dokumenterede skema-felter", () => {
    const entries = new Map([["stats:baer+ler:plausible", rec({})]]);
    const payload = buildStatsExport(entries, commonOpts);
    expect(payload).toEqual({
      schemaVersion: STATS_EXPORT_SCHEMA_VERSION,
      cacheNamespace: "ns-abc",
      voiceProfileVersion: 3,
      voiceProfileHash: "hash-xyz",
      generatedAt: 123456,
      total: 1,
      entries: [rec({})],
      nextCursor: null,
    });
  });

  it("sorterer efter count faldende som primær nøgle", () => {
    const entries = new Map([
      ["a", rec({ aId: "a1", count: 5 })],
      ["b", rec({ aId: "a2", count: 50 })],
      ["c", rec({ aId: "a3", count: 20 })],
    ]);
    const payload = buildStatsExport(entries, commonOpts);
    expect(payload.entries.map((e) => e.aId)).toEqual(["a2", "a3", "a1"]);
  });

  it("bruger lastSeen som sekundær tie-break (nyest først) ved samme count", () => {
    const entries = new Map([
      ["a", rec({ aId: "a1", count: 10, lastSeen: 100 })],
      ["b", rec({ aId: "a2", count: 10, lastSeen: 300 })],
      ["c", rec({ aId: "a3", count: 10, lastSeen: 200 })],
    ]);
    const payload = buildStatsExport(entries, commonOpts);
    expect(payload.entries.map((e) => e.aId)).toEqual(["a2", "a3", "a1"]);
  });

  it("er deterministisk ved fuldstændig lige count og lastSeen (nøgle-tie-break)", () => {
    const entries = new Map([
      ["a", rec({ aId: "zzz", bId: "a", count: 1, lastSeen: 1 })],
      ["b", rec({ aId: "aaa", bId: "z", count: 1, lastSeen: 1 })],
    ]);
    const first = buildStatsExport(entries, commonOpts).entries.map((e) => e.aId);
    const second = buildStatsExport(entries, commonOpts).entries.map((e) => e.aId);
    expect(first).toEqual(second);
    expect(first).toEqual(["aaa", "zzz"]);
  });

  it("sideinddeler med limit og returnerer en brugbar nextCursor", () => {
    const entries = new Map(
      Array.from({ length: 5 }, (_, i) => [`k${i}`, rec({ aId: `a${i}`, count: 10 - i })] as const),
    );
    const firstPage = buildStatsExport(entries, { ...commonOpts, limit: 2 });
    expect(firstPage.entries.map((e) => e.aId)).toEqual(["a0", "a1"]);
    expect(firstPage.total).toBe(5);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = buildStatsExport(entries, { ...commonOpts, limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.entries.map((e) => e.aId)).toEqual(["a2", "a3"]);
    expect(secondPage.nextCursor).not.toBeNull();

    const thirdPage = buildStatsExport(entries, { ...commonOpts, limit: 2, cursor: secondPage.nextCursor });
    expect(thirdPage.entries.map((e) => e.aId)).toEqual(["a4"]);
    expect(thirdPage.nextCursor).toBeNull();
  });

  it("klamper limit til MAX_ADMIN_EXPORT_LIMIT, selv hvis kaldstedet beder om mere", () => {
    const entries = new Map(
      Array.from({ length: 3 }, (_, i) => [`k${i}`, rec({ aId: `a${i}` })] as const),
    );
    const payload = buildStatsExport(entries, { ...commonOpts, limit: 10_000 });
    expect(payload.entries.length).toBe(3); // færre poster end selv det klampede loft
  });

  it("indeholder ALDRIG andre felter end PairStatsRecords egne — ingen IP, ingen rå tekst", () => {
    const entries = new Map([["stats:baer+ler:plausible", rec({})]]);
    const payload = buildStatsExport(entries, commonOpts);
    for (const entry of payload.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["aId", "bId", "cacheHits", "count", "firstSeen", "lastSeen", "upstreamCalls", "verdict"].sort(),
      );
    }
  });
});
