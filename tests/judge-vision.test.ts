// Vision-laget: pakker regionsdata til en model, kræver et STRENGT JSON-svar,
// og genforespørger præcis én gang ved ugyldigt output før den fejler
// højlydt. INGEN af disse tests kalder et rigtigt netværk eller en betalt
// model — `callModel` er altid injiceret, og `--fixture`-stien læser en
// statisk fil. Se plan/architecture-visual-judge-1.md TASK-019/020.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration.
import { buildPrompt, buildRegionPayload, getFindings, SYSTEM_PROMPT } from "../tools/judge/judge.mjs";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Scratch-mappe under den allerede-ignorerede .judge/ — ALDRIG i systemets
// /tmp. .judge/ er dokumenteret som regenereret kørselsmappe.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

const REGIONS = new Set(["grid", "chip"]);
const TOKENS = new Map([["--chronicle", "#eee0cd"]]);
const ctx = () => ({ knownRegions: REGIONS, knownTokens: TOKENS });

describe("SYSTEM_PROMPT — anti-prosa-kontrakten (TASK-020)", () => {
  it("kræver JSON-kun-svar uden prosa", () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON/);
    expect(/no prose/i.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("kræver den mindste ændring der lukker afstanden", () => {
    expect(/smallest/i.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("kræver numerisk evidence", () => {
    expect(/evidence/i.test(SYSTEM_PROMPT)).toBe(true);
    expect(/number/i.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("kræver from/to med enheder", () => {
    expect(/from/.test(SYSTEM_PROMPT)).toBe(true);
    expect(/\bto\b/.test(SYSTEM_PROMPT)).toBe(true);
    expect(/unit/i.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("kræver missing-asset frem for en CSS-efterligning af malet kunst", () => {
    expect(/missing-asset/.test(SYSTEM_PROMPT)).toBe(true);
    expect(/css/i.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("giver DESIGN.md/allowedDeviations autoritet over rå referencepixels", () => {
    expect(/DESIGN\.md/.test(SYSTEM_PROMPT)).toBe(true);
    expect(/allowedDeviations/.test(SYSTEM_PROMPT)).toBe(true);
  });

  it("forbyder automatiske rettelser uden for tokens", () => {
    expect(/structure/i.test(SYSTEM_PROMPT)).toBe(true);
    expect(/never.*applied automatically|never be applied automatically/i.test(SYSTEM_PROMPT)).toBe(true);
  });
});

describe("buildPrompt", () => {
  it("bærer systempromten uændret videre", () => {
    const { system } = buildPrompt("game", [], {});
    expect(system).toBe(SYSTEM_PROMPT);
  });

  it("indlejrer regionsdata og afviste nøgler i brugerbeskeden som JSON", () => {
    const payload = { id: "grid", metrics: { overall: 0.6 } };
    const { user } = buildPrompt("game", [payload], { rejectedKeys: ["grid:color:--tile"] });
    const parsed = JSON.parse(user);
    expect(parsed.screen).toBe("game");
    expect(parsed.regions).toEqual([payload]);
    expect(parsed.rejectedKeys).toEqual(["grid:color:--tile"]);
  });
});

describe("buildRegionPayload — ren funktion, ingen disk-adgang", () => {
  it("pakker metrikker, DOM og billeder fra allerede indlæste data", () => {
    const region = { id: "grid", rect: [1, 2, 3, 4], weight: 4, threshold: 0.75, note: "vigtigst" };
    const out = buildRegionPayload({
      region,
      images: { ref: "AAA", render: "BBB", blend: "CCC", heat: "DDD" },
      metrics: { box: { x: 1, y: 2, width: 3, height: 4 }, styles: { color: "red" }, missing: false },
      score: { structure: 0.5, tone: 0.6, ink: 0.7, geometry: 0.8, materiality: 0.9, overall: 0.7, raw: { deltaE: 9 } },
      allowedDeviations: [{ aspect: "tone", reason: "x", authority: "DESIGN.md" }],
    });
    expect(out.id).toBe("grid");
    expect(out.rect).toEqual([1, 2, 3, 4]);
    expect(out.weight).toBe(4);
    expect(out.threshold).toBe(0.75);
    expect(out.note).toBe("vigtigst");
    expect(out.images).toEqual({ reference: "AAA", render: "BBB", blend: "CCC", heat: "DDD" });
    expect(out.metrics.overall).toBe(0.7);
    expect(out.metrics.raw.deltaE).toBe(9);
    expect(out.dom.box).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(out.dom.styles.color).toBe("red");
    expect(out.allowedDeviations).toHaveLength(1);
  });

  it("markerer et manglende anker uden at kaste", () => {
    const region = { id: "combine", rect: [0, 0, 1, 1], weight: 1, threshold: 0.5 };
    const out = buildRegionPayload({
      region, images: { ref: null, render: null, blend: null, heat: null },
      metrics: { missing: true }, score: null, allowedDeviations: [],
    });
    expect(out.dom.missing).toBe(true);
    expect(out.metrics).toBeNull();
    expect(out.note).toBeNull();
  });
});

describe("getFindings — --fixture (netværksfri)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(SCRATCH_ROOT, "judge-fixture-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const validDoc = {
    screen: "game",
    findings: [{
      region: "grid", defect: "color", severity: 3,
      evidence: "tone 0.6 mod tærskel 0.75, ΔE 9.1 målt på median",
      fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" },
    }],
  };

  it("returnerer dokumentet uændret når det er gyldigt", async () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify(validDoc));
    const out = await getFindings({ fixture: p, context: ctx() });
    expect(out).toEqual(validDoc);
  });

  it("fejler højlydt (kaster) uden retry når fixturen er ugyldig", async () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, JSON.stringify({ screen: "game", findings: [{ ...validDoc.findings[0], region: "nope" }] }));
    const callModel = vi.fn();
    await expect(getFindings({ fixture: p, context: ctx(), callModel })).rejects.toThrow();
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("getFindings — rigtig model-sti (altid injiceret callModel, aldrig et rigtigt netværkskald)", () => {
  const validDoc = {
    screen: "game",
    findings: [{
      region: "grid", defect: "color", severity: 3,
      evidence: "tone 0.6 mod tærskel 0.75, ΔE 9.1 målt på median",
      fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" },
    }],
  };

  it("fejler klart uden VISUAL_JUDGE_API_KEY/MODEL og rører aldrig callModel", async () => {
    const callModel = vi.fn();
    await expect(
      getFindings({ screen: "game", context: ctx(), callModel, env: {}, regionPayloads: [] }),
    ).rejects.toThrow(/VISUAL_JUDGE_API_KEY|VISUAL_JUDGE_MODEL/);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("accepterer gyldig JSON på første forsøg uden retry", async () => {
    const callModel = vi.fn().mockResolvedValue(JSON.stringify(validDoc));
    const out = await getFindings({
      screen: "game", context: ctx(), callModel, regionPayloads: [],
      env: { VISUAL_JUDGE_API_KEY: "k", VISUAL_JUDGE_MODEL: "m" },
    });
    expect(out).toEqual(validDoc);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("genforespørger PRÆCIS én gang ved ugyldig JSON, og lykkes på forsøg to", async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce("dette er ikke json {{{")
      .mockResolvedValueOnce(JSON.stringify(validDoc));
    const out = await getFindings({
      screen: "game", context: ctx(), callModel, regionPayloads: [],
      env: { VISUAL_JUDGE_API_KEY: "k", VISUAL_JUDGE_MODEL: "m" },
    });
    expect(out).toEqual(validDoc);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("genforespørger PRÆCIS én gang ved skema-ugyldigt output, og lykkes på forsøg to", async () => {
    const invalidSchema = { screen: "game", findings: [{ ...validDoc.findings[0], region: "does-not-exist" }] };
    const callModel = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(invalidSchema))
      .mockResolvedValueOnce(JSON.stringify(validDoc));
    const out = await getFindings({
      screen: "game", context: ctx(), callModel, regionPayloads: [],
      env: { VISUAL_JUDGE_API_KEY: "k", VISUAL_JUDGE_MODEL: "m" },
    });
    expect(out).toEqual(validDoc);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("fejler ikke-nul (kaster) efter to ugyldige svar i træk — ALDRIG et tomt success-resultat", async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce("stadig ikke json")
      .mockResolvedValueOnce("heller ikke denne gang");
    await expect(
      getFindings({
        screen: "game", context: ctx(), callModel, regionPayloads: [],
        env: { VISUAL_JUDGE_API_KEY: "k", VISUAL_JUDGE_MODEL: "m" },
      }),
    ).rejects.toThrow();
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("sender valideringsfejlene med i den anden forespørgsel, så modellen kan rette sig selv", async () => {
    const invalidSchema = { screen: "game", findings: [{ ...validDoc.findings[0], region: "does-not-exist" }] };
    const callModel = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(invalidSchema))
      .mockResolvedValueOnce(JSON.stringify(validDoc));
    await getFindings({
      screen: "game", context: ctx(), callModel, regionPayloads: [],
      env: { VISUAL_JUDGE_API_KEY: "k", VISUAL_JUDGE_MODEL: "m" },
    });
    const secondCallArgs = callModel.mock.calls[1]![0];
    expect(secondCallArgs.user).toMatch(/does-not-exist/);
  });
});
