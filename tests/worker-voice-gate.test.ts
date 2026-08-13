import { afterEach, describe, expect, it, vi } from "vitest";
import { callUpstreamOpenAI } from "../worker/src/model";
import type { CanonicalBody, CanonicalThing } from "../worker/src/catalog";
import {
  judgeLiveLine,
  passesVoiceGate,
  VOICE_PROFILE_HASH,
  VOICE_PROFILE_VERSION,
  VOICE_THRESHOLD,
} from "../worker/src/voice/gate";
import { pairCacheKey, promptNamespace } from "../worker/src/cache-key";
import {
  CACHE_KEY_PREFIX,
  createCoordinatorDeps,
  decide,
  BUDGET_KEY,
  IP_BUDGET_KEY_PREFIX,
  type CoordinatorConfig,
  type UpstreamResult,
} from "../worker/src/coordinator";
import type { BudgetRecord } from "../worker/src/budget";
import { InMemoryStore } from "../worker/src/store";
import type { WireRequest } from "../worker/src/validate";
import type { CanonicalResult } from "../worker/src/catalog";

/**
 * Runtime-stemmeporten (TASK-007): hver bestået modellinje skal dømmes af
 * SAMME stemmepolitik som Python (tools/voice/judge.py) håndhæver over
 * grammatik/bagte par — se tests/worker-voice-parity.test.ts for selve
 * tal-for-tal-paritetsbeviset. DENNE fil beviser i stedet ADFÆRDEN: at en
 * lav-stemme linje reelt bliver afvist FØR cache/svar, at en god linje
 * består, at reason-strengen aldrig afslører den underkendte tekst eller
 * dens specifikke hård-afvisnings-kategori (coordinator-do.ts videresender
 * `reason` ordret til klienten — se dens `responseFor()`), at cachen aldrig
 * gemmer en afvist linje, og at cache-navnerummet ændrer sig med profilen.
 *
 * Kandidatteksterne herunder er IKKE gættet — hver er verificeret direkte
 * mod den ægte Python-dommer (tools/voice/judge.py) før den blev skrevet
 * her, præcis som tests/fixtures/voice-parity-fixture.json's syntetiske
 * cases. Se sessionens verifikationslog for de eksakte `judge()`-kald.
 */

function ting(id: string): CanonicalThing {
  return { id, name: id, traits: [] };
}

function testBody(overrides: Partial<CanonicalBody> = {}): CanonicalBody {
  return {
    a: ting("stone"),
    b: ting("stick"),
    verdict: "inert",
    need: undefined,
    summer: undefined,
    ...overrides,
  };
}

/** En god linje — INGEN hårde afvisninger, overall 1.0 mod den ægte profil
 * (verificeret direkte mod tools/voice/judge.py). */
const GOD_LINJE = "The stone met the stick, and nothing between them changed at all.";

/** Moderne ordforråd ("internet", "phone") — begge stone/stick nævnt, så
 * cleanModelText() selv ville lade den passere; kun stemmeporten skal
 * fælde den. */
const MODERNE_ORDFORRAAD_LINJE =
  "Karl checks his phone and the internet, but the stone and the stick do nothing at all.";

function stubUpstream(content: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
  );
}

describe("voice/gate.ts + voice/scorer.ts: direkte porttests (TASK-007)", () => {
  it("en god linje består BÅDE de hårde regler og tærsklen", () => {
    const result = judgeLiveLine(GOD_LINJE);
    expect(result.hardRejects).toEqual([]);
    expect(result.overall).toBeGreaterThanOrEqual(VOICE_THRESHOLD);
    expect(passesVoiceGate(GOD_LINJE)).toBe(true);
  });

  it("hård regel — for mange sætninger (grænse 3)", () => {
    const text = "The stone falls. The stick breaks. Karl stares. Nothing else happens tonight at all.";
    const result = judgeLiveLine(text);
    expect(result.hardRejects).toEqual(["4 sætninger (grænse 3)"]);
    expect(passesVoiceGate(text)).toBe(false);
  });

  it("hård regel — for mange ord (grænse 32)", () => {
    const fillerWords =
      "stone stick water fire bone branch claw ash river dust smoke leaf root vine wing tusk shell scale flame ember".split(
        " ",
      );
    const text = `The ${fillerWords.join(" and the ")} all shift quietly tonight.`;
    const result = judgeLiveLine(text);
    expect(result.hardRejects).toEqual(["63 ord (grænse 32)"]);
    expect(passesVoiceGate(text)).toBe(false);
  });

  it("hård regel — fejlmeddelelse-register", () => {
    const text = "Invalid input received for the stone and the stick again.";
    const result = judgeLiveLine(text);
    expect(result.hardRejects).toEqual(['fejlmeddelelse-register: "invalid input"']);
    expect(passesVoiceGate(text)).toBe(false);
  });

  it("hård regel — moderne ordforråd (kan finde FLERE overtrædelser i samme linje)", () => {
    const result = judgeLiveLine(MODERNE_ORDFORRAAD_LINJE);
    expect(result.hardRejects).toEqual(['moderne ordforråd: "internet"', 'moderne ordforråd: "phone"']);
    expect(passesVoiceGate(MODERNE_ORDFORRAAD_LINJE)).toBe(false);
  });

  it("hård regel — genbrugt punchline (en ægte, ikke-undtaget korpus-punchline)", () => {
    const text = "Karl looks at the stone and the stick. A complete set.";
    const result = judgeLiveLine(text);
    expect(result.hardRejects).toEqual(['genbrugt punchline: "a complete set"']);
    expect(passesVoiceGate(text)).toBe(false);
  });

  it("under tærsklen UDEN nogen hård afvisning afvises stadig af passesVoiceGate", () => {
    // "Bronze!" — samme case som tests/fixtures/voice-parity-fixture.json's
    // synthetic:single-word-exclaim: 0 hardRejects, overall 0.7587 < 0.8871.
    const result = judgeLiveLine("Bronze!");
    expect(result.hardRejects).toEqual([]);
    expect(result.overall).toBeLessThan(VOICE_THRESHOLD);
    expect(passesVoiceGate("Bronze!")).toBe(false);
  });

  it("profilen eksporterer en tærskel/hash/version, ingen af dem hardcodet i denne fil", () => {
    expect(VOICE_THRESHOLD).toBeGreaterThan(0);
    expect(VOICE_THRESHOLD).toBeLessThan(1);
    expect(typeof VOICE_PROFILE_HASH).toBe("string");
    expect(VOICE_PROFILE_HASH.length).toBeGreaterThan(0);
    expect(typeof VOICE_PROFILE_VERSION).toBe("number");
  });
});

describe("model.ts: callUpstreamOpenAI kalder stemmeporten FØR den returnerer ok:true (TASK-007)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("en lav-stemme linje afvises som upstream-fejl, ALDRIG som et bestået svar", async () => {
    stubUpstream(MODERNE_ORDFORRAAD_LINJE);
    const result = await callUpstreamOpenAI(testBody(), { OPENAI_API_KEY: "test-key-ikke-rigtig" });
    expect(result.ok).toBe(false);
  });

  it("reason er en KORT, generisk streng — aldrig den afviste tekst eller dens hård-afvisnings-kategori", async () => {
    stubUpstream(MODERNE_ORDFORRAAD_LINJE);
    const result = await callUpstreamOpenAI(testBody(), { OPENAI_API_KEY: "test-key-ikke-rigtig" });
    if (result.ok) throw new Error("forventede en afvisning, fik ok:true");
    expect(result.status).toBe(502);
    expect(result.reason).toBe("voice");
    expect(result.reason).not.toContain("internet");
    expect(result.reason).not.toContain("phone");
    expect(result.reason).not.toContain("moderne ordforråd");
    expect(result.reason.length).toBeLessThan(20);
  });

  it("en god linje slipper igennem som ok:true med teksten uændret", async () => {
    stubUpstream(GOD_LINJE);
    const result = await callUpstreamOpenAI(testBody(), { OPENAI_API_KEY: "test-key-ikke-rigtig" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe(GOD_LINJE);
  });

  it("en hård-afvist linje (for mange sætninger) afvises også via den fulde model.ts-vej", async () => {
    // Fire sætninger, begge navne nævnt, 20-320 tegn — består cleanModelText,
    // skal fældes af stemmeporten alene.
    const text = "The stone falls. The stick breaks. Karl stares. Nothing else happens tonight at all.";
    stubUpstream(text);
    const result = await callUpstreamOpenAI(testBody(), { OPENAI_API_KEY: "test-key-ikke-rigtig" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("voice");
  });
});

describe("cache-key.ts: promptNamespace() folder stemmeprofilens hash ind (TASK-007)", () => {
  it("samme prompt+model+profil-hash giver samme navnerum", () => {
    const a = promptNamespace("prompt", "model", "hash-a");
    const b = promptNamespace("prompt", "model", "hash-a");
    expect(a).toBe(b);
  });

  it("en ÆNDRET stemmeprofil-hash ændrer navnerummet — selv med UÆNDRET prompt og model", () => {
    const a = promptNamespace("prompt", "model", "hash-a");
    const b = promptNamespace("prompt", "model", "hash-b");
    expect(a).not.toBe(b);
  });

  it("den rigtige, eksporterede VOICE_PROFILE_HASH giver et andet navnerum end en tom/udeladt hash", () => {
    const uden = promptNamespace("prompt", "model");
    const med = promptNamespace("prompt", "model", VOICE_PROFILE_HASH);
    expect(uden).not.toBe(med);
  });

  it("eksisterende to-argument-opkald (uden profil-hash) er UÆNDRET bagudkompatible", () => {
    // Alle eksisterende kald i tests/worker-security.test.ts og
    // tests/worker-edge.test.ts bruger fortsat den to-argument-form — de må
    // ikke knække af at et tredje, valgfrit argument blev tilføjet.
    const a = promptNamespace("Du er fortælleren.", "gpt-4o-mini");
    const b = promptNamespace("Du er fortælleren.", "gpt-4o-mini");
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
  });
});

const fakeResolveCanonical = (wire: WireRequest): CanonicalResult => ({
  ok: true,
  body: {
    a: ting(wire.aId),
    b: ting(wire.bId),
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
    cacheNamespace: "test-namespace-voice-gate",
    ...overrides,
  };
}

describe("koordinator: en stemme-afvist linje bliver ALDRIG gemt i cachen (TASK-007)", () => {
  it("cache-nøglen for parret forbliver tom efter en stemme-afvisning", async () => {
    const store = new InMemoryStore();
    const config = ryddeligKonfiguration();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: false, status: 502, reason: "voice" }));
    const deps = createCoordinatorDeps({
      store,
      callUpstream,
      config,
      resolveCanonical: fakeResolveCanonical,
    });

    const wire: WireRequest = { aId: "stone", bId: "stick", verdict: "inert" };
    const result = await decide(wire, "0".repeat(64), deps);

    expect(result.status).toBe(502);
    expect(callUpstream).toHaveBeenCalledTimes(1);

    const cacheKey = CACHE_KEY_PREFIX + pairCacheKey("stone", "stick", "inert", config.cacheNamespace);
    const cached = await store.get(cacheKey);
    expect(cached).toBeUndefined();
  });

  it("et EFTERFØLGENDE identisk kald forsøger upstream IGEN — beviser at intet blev cachet af den første afvisning", async () => {
    const store = new InMemoryStore();
    const config = ryddeligKonfiguration();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: false, status: 502, reason: "voice" }));
    const deps = createCoordinatorDeps({
      store,
      callUpstream,
      config,
      resolveCanonical: fakeResolveCanonical,
    });

    const wire: WireRequest = { aId: "stone", bId: "stick", verdict: "inert" };
    await decide(wire, "0".repeat(64), deps);
    await decide(wire, "0".repeat(64), deps);

    expect(callUpstream).toHaveBeenCalledTimes(2);
  });

  it("budgettet er ALLEREDE reserveret og forbliver brugt, selvom modellen ender med en stemme-afvisning", async () => {
    // Kravet ordret fra opgaven: "spend their already-reserved budget
    // (model was called)". `coordinator.ts`s `decide()` skriver BEGGE
    // budget-reservationer FØR `callUpstream()` overhovedet kaldes (se
    // dens kommentar "de tæller, selv hvis opstrømskaldet bagefter
    // fejler") — en stemme-afvisning er blot én af de måder det
    // efterfølgende kald kan fejle på. Dette er IKKE en gentagelse af
    // cache-testen ovenfor: den beviser cachen forbliver tom, denne
    // beviser at budget-tælleren steg, uafhængigt af hinanden.
    const store = new InMemoryStore();
    const ipHash = "1".repeat(64);
    const config = ryddeligKonfiguration();
    const callUpstream = vi.fn(async (): Promise<UpstreamResult> => ({ ok: false, status: 502, reason: "voice" }));
    const deps = createCoordinatorDeps({
      store,
      callUpstream,
      config,
      resolveCanonical: fakeResolveCanonical,
    });

    expect(await store.get(BUDGET_KEY)).toBeUndefined();
    expect(await store.get(IP_BUDGET_KEY_PREFIX + ipHash)).toBeUndefined();

    const wire: WireRequest = { aId: "stone", bId: "stick", verdict: "inert" };
    const result = await decide(wire, ipHash, deps);

    expect(result.status).toBe(502);
    const globalRecord = await store.get<BudgetRecord>(BUDGET_KEY);
    const ipRecord = await store.get<BudgetRecord>(IP_BUDGET_KEY_PREFIX + ipHash);
    expect(globalRecord?.count).toBe(1);
    expect(ipRecord?.count).toBe(1);
  });
});
