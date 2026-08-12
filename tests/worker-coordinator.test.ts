import { describe, expect, it, vi } from "vitest";
import {
  createCoordinatorDeps,
  decide,
  type UpstreamResult,
  type CoordinatorConfig,
} from "../worker/src/coordinator";
import { InMemoryStore } from "../worker/src/store";

/**
 * Koordinatorens fulde beslutningskæde (TASK-002/003/004), testet med en
 * hukommelsesattrap i stedet for en Durable Object — se
 * `worker/src/store.ts`'s `KeyValueStore`-grænseflade.
 */

const gyldigTing = (id: string) => ({ id, name: id, traits: [] as string[] });

function nyBody(verdict = "inert", aId = "baer", bId = "ler") {
  return { a: gyldigTing(aId), b: gyldigTing(bId), verdict };
}

function ryddeligKonfiguration(overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig {
  return { rateLimitWindowMs: 60_000, rateLimitMax: 1000, dailyMax: 1000, ...overrides };
}

describe("koordinator: delt cache (TASK-004)", () => {
  it("et cache-hit reserverer intet budget", async () => {
    let upstreamCalls = 0;
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => {
      upstreamCalls++;
      return { ok: true, text: "The berries met the clay and nothing happened." };
    });
    // Loft på 2: præcis nok til parret (miss) og "clash"-varianten (miss),
    // men IKKE nok til en fjerde forespørgsel — hvis gentagelsen af parret
    // (samme nøgle) fejlagtigt brugte en plads, ville "clash" i stedet blive
    // afvist her, og testen ville vise det.
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 2 }),
    });

    const first = await decide(nyBody(), "ip-a", deps);
    expect(first.status).toBe(200);
    expect(upstreamCalls).toBe(1);

    // Andet opslag på PRÆCIS samme par+dom er et cache-hit og må ikke bruge
    // endnu en af de to daglige pladser.
    const second = await decide(nyBody(), "ip-b", deps);
    expect(second.status).toBe(200);
    expect(upstreamCalls).toBe(1);

    // Budgettet har stadig én plads tilbage: et NYT par (anden nøgle) kan
    // bruge den — hvis "second" fejlagtigt havde brugt den, ville dette fejle.
    const third = await decide(nyBody("clash"), "ip-c", deps);
    expect(third.status).toBe(200);
    expect(upstreamCalls).toBe(2);

    // Og et FJERDE nyt par rammer nu det udtømte loft (2 brugt af 2).
    const fourth = await decide(nyBody("absurd"), "ip-d", deps);
    expect(fourth.status).toBe(503);
  });

  it("nøglen er uafhængig af parrets rækkefølge, også gennem hele kæden", async () => {
    const callUpstream = vi.fn(
      async (): Promise<UpstreamResult> => ({ ok: true, text: "The berries met the clay quietly." }),
    );
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration(),
    });
    await decide(nyBody("inert", "baer", "ler"), "ip-a", deps);
    const swapped = await decide(nyBody("inert", "ler", "baer"), "ip-b", deps);
    expect(swapped.status).toBe(200);
    expect(callUpstream).toHaveBeenCalledTimes(1);
  });

  it("cacher aldrig en fejl fra opstrøms", async () => {
    const callUpstream = vi
      .fn<() => Promise<UpstreamResult>>()
      .mockResolvedValueOnce({ ok: false, status: 502, reason: "upstream" })
      .mockResolvedValueOnce({ ok: true, text: "The berries met the clay and nothing happened." });
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration(),
    });

    const first = await decide(nyBody(), "ip-a", deps);
    expect(first.status).toBe(502);

    // Andet forsøg på SAMME par skal forsøge opstrøms IGEN — en fejl blev
    // ikke gemt som om den var et gyldigt svar.
    const second = await decide(nyBody(), "ip-b", deps);
    expect(second.status).toBe(200);
    expect(callUpstream).toHaveBeenCalledTimes(2);
  });
});

describe("koordinator: samtidige misses deler ét opstrømskald (TASK-004 stime)", () => {
  it("ti samtidige forespørgsler på samme nye par koster præcis ét opstrømskald", async () => {
    let upstreamCalls = 0;
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => {
      upstreamCalls++;
      // Simulerer netværkstid, så flere forespørgsler når at samle sig, før
      // den første er færdig.
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, text: "The berries met the clay and nothing happened." };
    });
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 1 }),
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => decide(nyBody(), `ip-${i}`, deps)),
    );
    expect(upstreamCalls).toBe(1);
    for (const r of results) expect(r.status).toBe(200);
  });
});

describe("koordinator: dagligt loft under samtidighed (TASK-003)", () => {
  it("reserverer nøjagtigt op til loftet, selv når reservationerne sker samtidigt", async () => {
    const dailyMax = 5;
    const attempted = 20;
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => {
      await new Promise((r) => setTimeout(r, 1));
      return { ok: true, text: "A line about two different things, always unique." };
    });
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      // Højt rate-limit-loft: denne test måler KUN budgettet, ikke rate limit.
      config: ryddeligKonfiguration({ dailyMax, rateLimitMax: attempted * 2 }),
    });

    // 20 FORSKELLIGE par, fra 20 forskellige IP'er, samtidigt — ingen af dem
    // deler cache-nøgle, så ingen bliver deduplikeret som en stime.
    const results = await Promise.all(
      Array.from({ length: attempted }, (_, i) => decide(nyBody("inert", `a${i}`, `b${i}`), `ip-${i}`, deps)),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    const exhausted = results.filter((r) => r.status === 503).length;
    expect(succeeded).toBe(dailyMax);
    expect(exhausted).toBe(attempted - dailyMax);
    expect(callUpstream).toHaveBeenCalledTimes(dailyMax);
  });
});

describe("koordinator: rækkefølgen af kontroller", () => {
  it("rate limit rammer FØR validering og budget nogensinde røres", async () => {
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration({ rateLimitMax: 1 }),
    });

    const first = await decide(nyBody(), "samme-ip", deps);
    expect(first.status).toBe(200);

    // Andet kald fra SAMME ip, selv med en fuldstændig ugyldig krop, skal
    // stoppes af rate limit (429), ikke af validering (400).
    const second = await decide({ not: "valid" }, "samme-ip", deps);
    expect(second.status).toBe(429);
  });

  it("ugyldigt input afvises med 400 uden at røre det daglige budget", async () => {
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = createCoordinatorDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 1 }),
    });

    const invalid = await decide({ a: gyldigTing("baer") }, "ip-a", deps); // mangler b og verdict
    expect(invalid.status).toBe(400);
    expect(callUpstream).not.toHaveBeenCalled();

    // Loftet er urørt: et efterfølgende GYLDIGT kald kan stadig bruge sin ene plads.
    const valid = await decide(nyBody(), "ip-a", deps);
    expect(valid.status).toBe(200);
  });
});
