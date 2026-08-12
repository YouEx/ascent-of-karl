import { describe, expect, it } from "vitest";
import { checkRollingWindow, pruneWindow } from "../worker/src/limiter";
import { reserveBudget, secondsUntilNextUtcMidnight, utcDateKey } from "../worker/src/budget";
import { pairCacheKey } from "../worker/src/cache-key";
import { corsHeaders, isOriginAllowed, parseAllowedOrigins } from "../worker/src/origin";
import { isBodyTooLarge, validateBody, LIMITS } from "../worker/src/validate";
import { toNonNegativeInt, toPositiveInt } from "../worker/src/env";

/**
 * De rene workermoduler bag koordinatoren (TASK-002/003/004), testet uden
 * nogen Cloudflare-runtime — se `plan/feature-live-narrator-1.md` for
 * hvorfor rate limit, budget, cache og oprindelse er adskilt sådan.
 */

describe("limiter (rullende vindue, TASK-002)", () => {
  it("tillader op til grænsen, afviser det næste, og tillader igen når det ældste er faldet ud", () => {
    const windowMs = 60_000;
    const max = 3;
    let timestamps: number[] = [];
    let now = 1_000_000;

    // Tre kald, samme sekund — alle tre skal slippe igennem.
    for (let i = 0; i < max; i++) {
      const r = checkRollingWindow(timestamps, now, windowMs, max);
      expect(r.allowed).toBe(true);
      timestamps = r.timestamps;
    }
    expect(timestamps).toHaveLength(3);

    // Det fjerde, stadig inden for vinduet, skal afvises.
    const rejected = checkRollingWindow(timestamps, now, windowMs, max);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);

    // Efter det ældste tidsstempel er faldet ud af vinduet, er der plads igen.
    const later = now + windowMs + 1;
    const allowedAgain = checkRollingWindow(timestamps, later, windowMs, max);
    expect(allowedAgain.allowed).toBe(true);
  });

  it("beskærer tidsstempler uden for vinduet", () => {
    const pruned = pruneWindow([0, 100, 59_999, 60_000], 60_000, 60_000);
    // 0 er præcis 60000ms gammel (60000-0=60000, ikke < 60000) -> ude.
    // 100 -> 60000-100=59900 < 60000 -> inde. 59999 -> 1 < 60000 -> inde.
    // 60000 -> 0 < 60000 -> inde.
    expect(pruned).toEqual([100, 59_999, 60_000]);
  });

  it("giver en sandfærdig retry-after: nul ved tilladelse, positiv ved afvisning", () => {
    const allowed = checkRollingWindow([], 0, 1000, 1);
    expect(allowed.retryAfterSeconds).toBe(0);
    const denied = checkRollingWindow(allowed.timestamps, 500, 1000, 1);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // Vinduet lukker 1000ms efter det ældste (0), vi spørger ved 500 -> ~500ms tilbage -> 1s rundet op.
    expect(denied.retryAfterSeconds).toBe(1);
  });
});

describe("budget (dagligt UTC-loft, TASK-003)", () => {
  it("reserverer nøjagtigt op til loftet, så nummer loft+1 afvises", () => {
    const max = 5;
    let record: ReturnType<typeof reserveBudget>["record"] | undefined;
    const now = Date.UTC(2026, 0, 15, 12, 0, 0);
    for (let i = 0; i < max; i++) {
      const r = reserveBudget(record, now, max);
      expect(r.ok).toBe(true);
      record = r.record;
    }
    expect(record?.count).toBe(max);
    const overLimit = reserveBudget(record, now, max);
    expect(overLimit.ok).toBe(false);
    expect(overLimit.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("nulstiller automatisk når UTC-datoen skifter", () => {
    const max = 2;
    const day1 = Date.UTC(2026, 0, 15, 23, 59, 0);
    const r1 = reserveBudget(undefined, day1, max);
    const r2 = reserveBudget(r1.record, day1, max);
    expect(r2.ok).toBe(true);
    const exhausted = reserveBudget(r2.record, day1, max);
    expect(exhausted.ok).toBe(false);

    const day2 = Date.UTC(2026, 0, 16, 0, 0, 1);
    const freshDay = reserveBudget(exhausted.record, day2, max);
    expect(freshDay.ok).toBe(true);
    expect(freshDay.record.count).toBe(1);
  });

  it("udregner UTC-datonøgle og sekunder til midnat korrekt", () => {
    expect(utcDateKey(Date.UTC(2026, 5, 1, 13, 30))).toBe("2026-06-01");
    const nearMidnight = Date.UTC(2026, 5, 1, 23, 59, 30);
    expect(secondsUntilNextUtcMidnight(nearMidnight)).toBe(30);
  });
});

describe("cache-key (delt cache, TASK-004)", () => {
  it("er uafhængig af parrets rækkefølge", () => {
    expect(pairCacheKey("baer", "ler", "inert")).toBe(pairCacheKey("ler", "baer", "inert"));
  });

  it("er følsom over for dommen — samme par, forskellig dom, forskellig nøgle", () => {
    expect(pairCacheKey("baer", "ler", "inert")).not.toBe(pairCacheKey("baer", "ler", "clash"));
  });
});

describe("origin (SEC-002/RISK-001)", () => {
  it("afviser manglende origin når en allowlist er sat", () => {
    const allowed = parseAllowedOrigins("https://youex.github.io");
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it("afviser en origin der ikke står på listen", () => {
    const allowed = parseAllowedOrigins("https://youex.github.io");
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it("tillader alt når listen er tom (kun til lokal brug)", () => {
    expect(isOriginAllowed(null, parseAllowedOrigins(undefined))).toBe(true);
    expect(isOriginAllowed("https://anything.example", parseAllowedOrigins(""))).toBe(true);
  });

  it("eksponerer Retry-After, så browserens JS må læse den (ellers virker klientens ro-periode ikke)", () => {
    const headers = corsHeaders("https://youex.github.io", ["https://youex.github.io"]);
    expect(headers["access-control-expose-headers"]).toContain("retry-after");
  });
});

describe("validate (form og grænser, TASK-002)", () => {
  const gyldigTing = { id: "baer", name: "Berries", traits: ["sour"] };

  it("godkender en velformet krop", () => {
    const r = validateBody({ a: gyldigTing, b: { id: "ler", name: "Clay" }, verdict: "inert" });
    expect(r.ok).toBe(true);
  });

  it("afviser en krop uden gyldigt verdikt", () => {
    const r = validateBody({ a: gyldigTing, b: { id: "ler", name: "Clay" }, verdict: "not-a-real-verdict" });
    expect(r.ok).toBe(false);
  });

  it("afviser når id eller name overskrider de målte grænser", () => {
    const forLangt = "x".repeat(LIMITS.id + 1);
    const r = validateBody({ a: { ...gyldigTing, id: forLangt }, b: { id: "ler", name: "Clay" }, verdict: "inert" });
    expect(r.ok).toBe(false);
  });

  it("afviser for mange traits", () => {
    const r = validateBody({
      a: { ...gyldigTing, traits: Array.from({ length: LIMITS.traitCount + 1 }, (_, i) => `t${i}`) },
      b: { id: "ler", name: "Clay" },
      verdict: "inert",
    });
    expect(r.ok).toBe(false);
  });

  it("afviser en krop der ikke er et objekt", () => {
    expect(validateBody(null).ok).toBe(false);
    expect(validateBody("hej").ok).toBe(false);
    expect(validateBody(42).ok).toBe(false);
  });

  it("markerer for stor råtekst som for stor, før nogen parsing sker", () => {
    expect(isBodyTooLarge("x".repeat(LIMITS.bodyBytes + 1))).toBe(true);
    expect(isBodyTooLarge("{}")).toBe(false);
  });
});

describe("env (fortolkning af Wrangler-vars, TASK-005 nødstop)", () => {
  it("toPositiveInt bruger fallback ved manglende, ugyldig eller ikke-positiv værdi", () => {
    expect(toPositiveInt(undefined, 20)).toBe(20);
    expect(toPositiveInt("", 20)).toBe(20);
    expect(toPositiveInt("abe", 20)).toBe(20);
    expect(toPositiveInt("0", 20)).toBe(20);
    expect(toPositiveInt("-5", 20)).toBe(20);
  });

  it("toPositiveInt lader en gyldig positiv værdi passere", () => {
    expect(toPositiveInt("60", 20)).toBe(60);
  });

  it("toNonNegativeInt bruger fallback ved manglende, ugyldig eller negativ værdi", () => {
    expect(toNonNegativeInt(undefined, 350)).toBe(350);
    expect(toNonNegativeInt("", 350)).toBe(350);
    expect(toNonNegativeInt("abe", 350)).toBe(350);
    expect(toNonNegativeInt("-1", 350)).toBe(350);
  });

  it("toNonNegativeInt lader en tilsigtet 0 passere uændret (nødstop, TASK-005)", () => {
    // Dette er selve nødstoppet: sæt DAILY_MAX_UPSTREAM_CALLS="0" i
    // Wrangler, og opstrømskald skal stoppe helt — IKKE falde tilbage til
    // defaulten, fordi "0" fejlagtigt tolkes som "ingen værdi angivet".
    expect(toNonNegativeInt("0", 350)).toBe(0);
  });

  it("toNonNegativeInt lader en gyldig positiv værdi passere", () => {
    expect(toNonNegativeInt("500", 350)).toBe(500);
  });
});
