import { describe, expect, it, vi } from "vitest";
import {
  createCoordinatorDeps,
  decide,
  type UpstreamResult,
  type CoordinatorConfig,
  type CoordinatorDeps,
} from "../worker/src/coordinator";
import { InMemoryStore } from "../worker/src/store";
import { statsKey, type PairStatsRecord } from "../worker/src/stats";
import type { WireRequest } from "../worker/src/validate";
import type { CanonicalResult } from "../worker/src/catalog";

/**
 * TASK-008: `decide()` tæller nu hver GYLDIG kanonisk par+dom-forespørgsel
 * (cache-hit ELLER -miss, inklusive et budget-afvist forsøg) i
 * `worker/src/stats.ts`s lager — se den fils fil-kommentar for den fulde
 * begrundelse for hvilke udfald der tæller som hvad. Denne fil beviser
 * KUN selve INTEGRATIONEN (at `decide()` rent faktisk kalder
 * `recordPairStats` med det rigtige udfald, på det rigtige tidspunkt,
 * atomisk inden i den eksisterende gate) — selve reducer-/eksport-logikken
 * er allerede bevist i `tests/worker-stats.test.ts`.
 *
 * Samme hjælpere/konventioner som `tests/worker-coordinator.test.ts`.
 */

function gyldigTing(id: string) {
  return { id, name: id, traits: [] as string[] };
}

function nyBody(verdict = "inert", aId = "baer", bId = "ler"): { aId: string; bId: string; verdict: string } {
  return { aId, bId, verdict };
}

function ipN(n: number): string {
  return n.toString(16).padStart(64, "0");
}

const fakeResolveCanonical = (wire: WireRequest): CanonicalResult => ({
  ok: true,
  body: {
    a: gyldigTing(wire.aId),
    b: gyldigTing(wire.bId),
    verdict: wire.verdict,
    need: undefined,
    summer: wire.summer,
  },
});

function ryddeligKonfiguration(overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig {
  return {
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1000,
    dailyMax: 1000,
    dailyMaxPerIp: 1000,
    cacheNamespace: "test-namespace",
    ...overrides,
  };
}

function nyeDeps(
  store: InMemoryStore,
  partial: {
    callUpstream: CoordinatorDeps["callUpstream"];
    config: CoordinatorConfig;
    resolveCanonical?: CoordinatorDeps["resolveCanonical"];
  },
): CoordinatorDeps {
  return createCoordinatorDeps({
    store,
    callUpstream: partial.callUpstream,
    config: partial.config,
    resolveCanonical: partial.resolveCanonical ?? fakeResolveCanonical,
  });
}

async function getStats(store: InMemoryStore, aId: string, bId: string, verdict: string) {
  return store.get<PairStatsRecord>(statsKey(aId, bId, verdict));
}

describe("decide(): tæller et NYT opstrømskald som 'upstream', FØR svaret kendes", () => {
  it("et enkelt cache-miss, nyt par, registrerer count=1/upstreamCalls=1/cacheHits=0", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "A line, always unique." }));
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration() });

    const result = await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    expect(result.status).toBe(200);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(1);
    expect(stats?.upstreamCalls).toBe(1);
    expect(stats?.cacheHits).toBe(0);
  });

  it("tæller SELVOM opstrømskaldet bagefter fejler (502) — det NYE forsøg blev stadig gjort", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(
      async (): Promise<UpstreamResult> => ({ ok: false, status: 502, reason: "voice" }),
    );
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration() });

    const result = await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    expect(result.status).toBe(502);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(1);
    expect(stats?.upstreamCalls).toBe(1);
  });
});

describe("decide(): et cache-hit registreres som 'hit', ikke som endnu et 'upstream'", () => {
  it("to kald på samme par: første er upstream, andet er hit — én post, to forskellige tællere øget", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "A line, always unique." }));
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration() });

    await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    await decide(nyBody("inert", "baer", "ler"), ipN(2), deps);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(2);
    expect(stats?.upstreamCalls).toBe(1);
    expect(stats?.cacheHits).toBe(1);
    expect(callUpstream).toHaveBeenCalledTimes(1);
  });
});

describe("decide(): et tilsluttet i-gang-værende kald tæller som 'other', ikke som endnu et 'upstream'", () => {
  it("ti samtidige forespørgsler på samme NYE par: én post, count=10, men upstreamCalls=1", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, text: "A line, always unique." };
    });
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration({ dailyMax: 1 }) });

    await Promise.all(Array.from({ length: 10 }, (_, i) => decide(nyBody("inert", "baer", "ler"), ipN(100 + i), deps)));

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(10);
    expect(stats?.upstreamCalls).toBe(1);
    expect(stats?.cacheHits).toBe(0);
  });
});

describe("decide(): et budget-afvist forsøg tæller STADIG (er ægte efterspørgsel), som 'other'", () => {
  it("globalt loft udtømt (503): forsøget tæller, men hverken som hit eller upstream", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration({ dailyMax: 0 }) });

    const result = await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    expect(result.status).toBe(503);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(1);
    expect(stats?.cacheHits).toBe(0);
    expect(stats?.upstreamCalls).toBe(0);
    expect(callUpstream).not.toHaveBeenCalled();
  });

  it("pr.-IP-loft udtømt (429): forsøget tæller også", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps(store, {
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 1000, dailyMaxPerIp: 0 }),
    });

    const result = await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    expect(result.status).toBe(429);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats?.count).toBe(1);
    expect(stats?.cacheHits).toBe(0);
    expect(stats?.upstreamCalls).toBe(0);
  });
});

describe("decide(): en 400-afvisning (ugyldig form/ukendt id) tæller IKKE — når aldrig et kanonisk par", () => {
  it("ugyldig form registrerer ingen stats-post overhovedet", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration() });

    const result = await decide({ aId: "baer" }, ipN(1), deps); // mangler bId/verdict
    expect(result.status).toBe(400);

    const entries = await store.list<PairStatsRecord>({ prefix: "stats:" });
    expect(entries.size).toBe(0);
  });

  it("ukendt id (kanonisering afviser) registrerer ingen stats-post", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const afvisendeResolveCanonical = (): CanonicalResult => ({ ok: false, reason: "ukendt aId" });
    const deps = nyeDeps(store, {
      callUpstream,
      config: ryddeligKonfiguration(),
      resolveCanonical: afvisendeResolveCanonical,
    });

    const result = await decide(nyBody("inert", "opdigtet-id", "ler"), ipN(1), deps);
    expect(result.status).toBe(400);

    const entries = await store.list<PairStatsRecord>({ prefix: "stats:" });
    expect(entries.size).toBe(0);
  });
});

describe("decide(): stats-posten indeholder ALDRIG en IP eller rå tekst", () => {
  it("posten har kun de dokumenterede felter — ingen ipHash, intet text-felt", async () => {
    const store = new InMemoryStore();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "Hemmelig linje, aldrig gemt her." }));
    const deps = nyeDeps(store, { callUpstream, config: ryddeligKonfiguration() });

    await decide(nyBody("inert", "baer", "ler"), ipN(42), deps);

    const stats = await getStats(store, "baer", "ler", "inert");
    expect(stats).toBeDefined();
    expect(Object.keys(stats!).sort()).toEqual(
      ["aId", "bId", "cacheHits", "count", "firstSeen", "lastSeen", "upstreamCalls", "verdict"].sort(),
    );
    const serialized = JSON.stringify(stats);
    expect(serialized).not.toContain(ipN(42));
    expect(serialized).not.toContain("Hemmelig linje");
  });
});
