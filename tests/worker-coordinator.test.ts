import { describe, expect, it, vi } from "vitest";
import {
  createCoordinatorDeps,
  decide,
  type UpstreamResult,
  type CoordinatorConfig,
  type CoordinatorDeps,
} from "../worker/src/coordinator";
import { InMemoryStore } from "../worker/src/store";
import type { WireRequest } from "../worker/src/validate";
import type { CanonicalResult } from "../worker/src/catalog";

/**
 * Koordinatorens fulde beslutningskæde (TASK-002/003/004 + sikkerhedsrunde
 * 2, punkt 2/3), testet med en hukommelsesattrap i stedet for en Durable
 * Object — se `worker/src/store.ts`'s `KeyValueStore`-grænseflade.
 *
 * Sikkerhedsrunde 2, punkt 3 gjorde ledningsformen smallere (kun
 * `aId`/`bId`/`verdict`/`needId?`/`summer?`) og flyttede selve
 * navn/kind/stuff/traits-opslaget til `catalog.ts`. Denne testfil kender
 * ikke spillets rigtige indhold og skal ikke behøve at gøre det — derfor
 * injiceres en `resolveCanonical`-attrap, der accepterer ETHVERT
 * (ikke-tomt) id-par, præcis som `callUpstream` allerede blev injiceret.
 * Ægte id-validering (afvisning af ukendte id'er) er testet direkte mod
 * `catalog.ts` i `tests/worker-security.test.ts` — den test skal IKKE
 * gentages her, kun BRUGEN af resultatet i selve beslutningskæden.
 */

function gyldigTing(id: string) {
  return { id, name: id, traits: [] as string[] };
}

function nyBody(verdict = "inert", aId = "baer", bId = "ler"): { aId: string; bId: string; verdict: string } {
  return { aId, bId, verdict };
}

/** En 64-tegns hex-lignende streng, unik pr. `n` — nok til at give hver test-IP sin egen rate-limit-/budget-spand. */
function ipN(n: number): string {
  return n.toString(16).padStart(64, "0");
}

/** Accepterer ethvert id-par — kender intet til rigtigt spilindhold. */
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
    ...overrides,
  };
}

function nyeDeps(partial: {
  callUpstream: CoordinatorDeps["callUpstream"];
  config: CoordinatorConfig;
  resolveCanonical?: CoordinatorDeps["resolveCanonical"];
}): CoordinatorDeps {
  return createCoordinatorDeps({
    store: new InMemoryStore(),
    callUpstream: partial.callUpstream,
    config: partial.config,
    resolveCanonical: partial.resolveCanonical ?? fakeResolveCanonical,
  });
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
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration({ dailyMax: 2 }) });

    const first = await decide(nyBody(), ipN(1), deps);
    expect(first.status).toBe(200);
    expect(upstreamCalls).toBe(1);

    // Andet opslag på PRÆCIS samme par+dom er et cache-hit og må ikke bruge
    // endnu en af de to daglige pladser.
    const second = await decide(nyBody(), ipN(2), deps);
    expect(second.status).toBe(200);
    expect(upstreamCalls).toBe(1);

    // Budgettet har stadig én plads tilbage: et NYT par (anden nøgle) kan
    // bruge den — hvis "second" fejlagtigt havde brugt den, ville dette fejle.
    const third = await decide(nyBody("clash"), ipN(3), deps);
    expect(third.status).toBe(200);
    expect(upstreamCalls).toBe(2);

    // Og et FJERDE nyt par rammer nu det udtømte loft (2 brugt af 2).
    const fourth = await decide(nyBody("absurd"), ipN(4), deps);
    expect(fourth.status).toBe(503);
  });

  it("nøglen er uafhængig af parrets rækkefølge, også gennem hele kæden", async () => {
    const callUpstream = vi.fn(
      async (): Promise<UpstreamResult> => ({ ok: true, text: "The berries met the clay quietly." }),
    );
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration() });
    await decide(nyBody("inert", "baer", "ler"), ipN(1), deps);
    const swapped = await decide(nyBody("inert", "ler", "baer"), ipN(2), deps);
    expect(swapped.status).toBe(200);
    expect(callUpstream).toHaveBeenCalledTimes(1);
  });

  it("cacher aldrig en fejl fra opstrøms", async () => {
    const callUpstream = vi
      .fn<() => Promise<UpstreamResult>>()
      .mockResolvedValueOnce({ ok: false, status: 502, reason: "upstream" })
      .mockResolvedValueOnce({ ok: true, text: "The berries met the clay and nothing happened." });
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration() });

    const first = await decide(nyBody(), ipN(1), deps);
    expect(first.status).toBe(502);

    // Andet forsøg på SAMME par skal forsøge opstrøms IGEN — en fejl blev
    // ikke gemt som om den var et gyldigt svar.
    const second = await decide(nyBody(), ipN(2), deps);
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
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration({ dailyMax: 1 }) });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => decide(nyBody(), ipN(100 + i), deps)),
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
    const deps = nyeDeps({
      callUpstream,
      // Højt rate-limit-loft og pr.-IP-loft: denne test måler KUN det
      // globale budget, ikke rate limit eller pr.-IP-loftet.
      config: ryddeligKonfiguration({ dailyMax, rateLimitMax: attempted * 2, dailyMaxPerIp: attempted * 2 }),
    });

    // 20 FORSKELLIGE par, fra 20 forskellige IP-hashes, samtidigt — ingen af
    // dem deler cache-nøgle, så ingen bliver deduplikeret som en stime.
    const results = await Promise.all(
      Array.from({ length: attempted }, (_, i) =>
        decide(nyBody("inert", `a${i}`, `b${i}`), ipN(200 + i), deps),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    const exhausted = results.filter((r) => r.status === 503).length;
    expect(succeeded).toBe(dailyMax);
    expect(exhausted).toBe(attempted - dailyMax);
    expect(callUpstream).toHaveBeenCalledTimes(dailyMax);
  });
});

describe("koordinator: pr.-IP dagligt loft (sikkerhedsrunde 2, punkt 2)", () => {
  it("afviser MED 429 (ikke 503) når kun denne ene IP-hashs andel er brugt op, mens andre IP'er stadig kan få svar", async () => {
    const callUpstream = vi.fn(
      async (): Promise<UpstreamResult> => ({ ok: true, text: "A line about two different things." }),
    );
    const deps = nyeDeps({
      callUpstream,
      // Globalt loft rigeligt, pr.-IP-loft stramt: kun DENNE ips egen andel
      // skal kunne løbe tør, ikke det fælles budget.
      config: ryddeligKonfiguration({ dailyMax: 1000, dailyMaxPerIp: 2 }),
    });
    const ip = ipN(5);

    // To FORSKELLIGE par fra samme IP-hash — ingen cache-deling, så begge
    // rammer opstrøms og bruger hver sin af de to pr.-IP-pladser.
    const first = await decide(nyBody("inert", "a1", "b1"), ip, deps);
    const second = await decide(nyBody("inert", "a2", "b2"), ip, deps);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Et TREDJE nyt par fra SAMME IP-hash: denne ips egen andel (2) er brugt,
    // men det globale loft (1000) er det langt fra — 429, ikke 503.
    const third = await decide(nyBody("inert", "a3", "b3"), ip, deps);
    expect(third.status).toBe(429);
    if (third.status === 429) {
      expect(third.retryAfterSeconds).toBeGreaterThan(0);
    }

    // En HELT ANDEN IP-hash kan stadig få et svar — kun DENNE ips andel var brugt op.
    const fourth = await decide(nyBody("inert", "a4", "b4"), ipN(6), deps);
    expect(fourth.status).toBe(200);
    expect(callUpstream).toHaveBeenCalledTimes(3);
  });

  it("et afvist pr.-IP-forsøg dræner IKKE det globale budget — næste IP kan stadig bruge samme plads", async () => {
    const callUpstream = vi.fn(
      async (): Promise<UpstreamResult> => ({ ok: true, text: "A line about two different things." }),
    );
    // Globalt loft på PRÆCIS 1: hvis et afvist pr.-IP-forsøg fejlagtigt
    // havde skrevet den globale reservation igennem, ville denne ene plads
    // være brugt op af en IP, der aldrig fik et rigtigt svar — og den
    // NÆSTE, uafhængige IP ville uretfærdigt blive mødt med 503.
    const deps = nyeDeps({
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 1, dailyMaxPerIp: 0 }),
    });

    // Denne IP har INGEN egen andel (dailyMaxPerIp: 0) — afvises altid 429,
    // og må ALDRIG nå at skrive den globale reservation.
    const blocked = await decide(nyBody("inert", "a1", "b1"), ipN(7), deps);
    expect(blocked.status).toBe(429);
    expect(callUpstream).not.toHaveBeenCalled();

    // En anden test-instans med en NY, rigelig pr.-IP-konfiguration skal
    // stadig kunne bruge budgettets ene plads — det globale loft må ikke
    // være blevet fejlagtigt dekrementeret af det blokerede forsøg ovenfor,
    // for de deler samme `deps.store`.
    const deps2: CoordinatorDeps = { ...deps, config: { ...deps.config, dailyMaxPerIp: 1000 } };
    const allowed = await decide(nyBody("inert", "a2", "b2"), ipN(8), deps2);
    expect(allowed.status).toBe(200);
    expect(callUpstream).toHaveBeenCalledTimes(1);
  });

  it("samtidige reservationer fra samme IP-hash overskrider aldrig dens egen andel", async () => {
    const dailyMaxPerIp = 4;
    const attempted = 15;
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => {
      await new Promise((r) => setTimeout(r, 1));
      return { ok: true, text: "A line about two different things, always unique enough." };
    });
    const deps = nyeDeps({
      callUpstream,
      // Globalt loft rigeligt over det denne ene IP kan nå: testen måler
      // kun pr.-IP-loftet under samtidighed.
      config: ryddeligKonfiguration({ dailyMax: 1000, rateLimitMax: attempted * 2, dailyMaxPerIp }),
    });
    const sammeIp = ipN(9);

    // 15 samtidige, FORSKELLIGE par fra SAMME IP-hash.
    const results = await Promise.all(
      Array.from({ length: attempted }, (_, i) => decide(nyBody("inert", `p${i}`, `q${i}`), sammeIp, deps)),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 429).length;
    expect(succeeded).toBe(dailyMaxPerIp);
    expect(rejected).toBe(attempted - dailyMaxPerIp);
    expect(callUpstream).toHaveBeenCalledTimes(dailyMaxPerIp);
  });
});

describe("koordinator: kanonisering afviser ukendte id'er FØR budget (sikkerhedsrunde 2, punkt 3)", () => {
  it("når resolveCanonical afviser, får klienten 400 og intet opstrømskald eller budget røres", async () => {
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const afvisendeResolveCanonical = (): CanonicalResult => ({ ok: false, reason: "ukendt aId" });
    const deps = nyeDeps({
      callUpstream,
      config: ryddeligKonfiguration({ dailyMax: 1 }),
      resolveCanonical: afvisendeResolveCanonical,
    });

    const result = await decide(nyBody("inert", "opdigtet-id", "ler"), ipN(10), deps);
    expect(result.status).toBe(400);
    expect(callUpstream).not.toHaveBeenCalled();

    // Budgettet er urørt: et efterfølgende kald med en ACCEPTERENDE
    // kanonisering kan stadig bruge sin ene plads.
    const okDeps: CoordinatorDeps = { ...deps, resolveCanonical: fakeResolveCanonical };
    const ok = await decide(nyBody(), ipN(11), okDeps);
    expect(ok.status).toBe(200);
  });

  it("klientfelter uden for den smalle ledningsform kan ikke snige sig ind i den kanoniserede krop", async () => {
    // Selv hvis en klient sender ekstra, opdigtede felter (fx `name`,
    // `flavor`) i selve JSON-kroppen, ser `resolveCanonical` KUN den
    // validerede, smalle `WireRequest` — ikke det rå objekt. Denne test
    // beviser at `decide()` aldrig videresender andet end det validerede
    // `WireRequest` til `resolveCanonical`.
    let modtagetWire: WireRequest | undefined;
    const sporendeResolveCanonical = (wire: WireRequest): CanonicalResult => {
      modtagetWire = wire;
      return fakeResolveCanonical(wire);
    };
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration(), resolveCanonical: sporendeResolveCanonical });

    const rawMedEkstraFelter = {
      aId: "baer",
      bId: "ler",
      verdict: "inert",
      name: "opdigtet navn",
      flavor: "en forfalsket smagsprøve, som ikke burde nå prompten",
    };
    await decide(rawMedEkstraFelter, ipN(12), deps);
    expect(modtagetWire).toEqual({ aId: "baer", bId: "ler", verdict: "inert", needId: undefined, summer: undefined });
    expect(modtagetWire).not.toHaveProperty("name");
    expect(modtagetWire).not.toHaveProperty("flavor");
  });
});

describe("koordinator: rækkefølgen af kontroller", () => {
  it("rate limit rammer FØR validering og budget nogensinde røres", async () => {
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration({ rateLimitMax: 1 }) });
    const sammeIp = ipN(13);

    const first = await decide(nyBody(), sammeIp, deps);
    expect(first.status).toBe(200);

    // Andet kald fra SAMME ip, selv med en fuldstændig ugyldig krop, skal
    // stoppes af rate limit (429), ikke af validering (400).
    const second = await decide({ not: "valid" }, sammeIp, deps);
    expect(second.status).toBe(429);
  });

  it("ugyldigt input afvises med 400 uden at røre det daglige budget", async () => {
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: true, text: "unused" }));
    const deps = nyeDeps({ callUpstream, config: ryddeligKonfiguration({ dailyMax: 1 }) });

    const invalid = await decide({ aId: "baer" }, ipN(14), deps); // mangler bId og verdict
    expect(invalid.status).toBe(400);
    expect(callUpstream).not.toHaveBeenCalled();

    // Loftet er urørt: et efterfølgende GYLDIGT kald kan stadig bruge sin ene plads.
    const valid = await decide(nyBody(), ipN(14), deps);
    expect(valid.status).toBe(200);
  });
});
