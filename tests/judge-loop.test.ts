// Selve sløjfen: fund → rute → anvend token → optag igen → accept-port →
// journalpost → stopbetingelse. INGEN af disse tests rører en rigtig browser,
// et rigtigt netværk eller de virkelige tuning.css/kø-stier — `captureAndScore`
// og `getFindingsFn` er altid injicerede, og `tuningPath`/`assetQueuePath`/
// `humanQueuePath`/`ledgerPath` peger altid på en midlertidig testmappe.
// Se plan/architecture-visual-judge-1.md TASK-024/025/026, CON-001/002/003.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration.
import { STOP, allRegionsPassing, resolveMaxIterations, decideStop, runJudgeLoop, createCapture, safeDispose } from "../tools/judge/loop.mjs";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Scratch-mapper lever under den allerede-ignorerede .judge/ — ALDRIG i
// systemets /tmp. .judge/ er dokumenteret som regenereret kørselsmappe, så
// den er det rigtige sted for engangs-testmapper.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

function scoresFor(screenId: string, overall: number, regions: any) {
  return { overall, screens: { [screenId]: { screen: screenId, overall, regions } } };
}

/** Flerskærms-udgave til blokerer 1 (fortynding): `topOverall` er det, en
 *  ægte metrics.py ville have sat i det GLOBALE topniveau-felt — vægtet af
 *  regionsantal pr. skærm, ikke af regionernes egne værdier. Bruges til at
 *  reproducere, at en ikke-optaget skærms nul-stub fortynder en ægte
 *  forbedring, medmindre accept-porten scopes til de efterspurgte skærme. */
function scoresForScreens(topOverall: number, screens: Record<string, { overall: number; regions: any }>) {
  return {
    overall: topOverall,
    screens: Object.fromEntries(
      Object.entries(screens).map(([sid, s]) => [sid, { screen: sid, overall: s.overall, regions: s.regions }]),
    ),
  };
}

/** metrics.py's stub for en skærm, denne kørsel slet ikke optog: hver region
 *  får overall 0 og missing:true, men tæller stadig med i det globale
 *  regionsantal (og dermed i den globale overall's nævner). */
function missingRegion(weight = 1, threshold = 0.9) {
  return { structure: 0, tone: 0, ink: 0, geometry: 0, materiality: 0, overall: 0, missing: true, raw: {}, weight, threshold };
}

function region(overall: number, threshold: number) {
  return { structure: overall, tone: overall, ink: overall, geometry: overall, materiality: overall, overall, threshold, weight: 1, missing: false, raw: {} };
}

const REGISTRY = {
  screens: [{ id: "title", regions: [{ id: "chip", rect: [0, 0, 1, 1], weight: 1, threshold: 0.9 }] }],
  allowedDeviations: [],
};

function tokenFinding(token = "--chronicle", severity = 3, key: string | undefined = undefined) {
  return {
    region: "chip", defect: "color", severity,
    evidence: "tone 0.6 mod tærskel 0.9, målt ΔE 9",
    fix: { kind: "token", token, from: "#eee0cd", to: "#d8ba9b" },
    key: key ?? `chip:color:${token}`,
  };
}

function assetFinding() {
  return {
    region: "chip", defect: "missing-asset", severity: 4,
    evidence: "intet malet aktiv fundet, 0 af 1 forventede lag",
    fix: { kind: "asset", assetId: "UI-chip-glow", spec: "Malet glød-effekt bag chip-ikonet, se DESIGN.md §4" },
  };
}

describe("allRegionsPassing", () => {
  it("er sand når alle regioner er over deres tærskel", () => {
    const scores = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
    expect(allRegionsPassing(scores, ["title"])).toBe(true);
  });
  it("er falsk når én region er under sin tærskel", () => {
    const scores = scoresFor("title", 0.8, { chip: region(0.8, 0.9) });
    expect(allRegionsPassing(scores, ["title"])).toBe(false);
  });
  it("er falsk når en efterspurgt skærm slet ikke er i scores", () => {
    const scores = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
    expect(allRegionsPassing(scores, ["title", "game"])).toBe(false);
  });
});

describe("resolveMaxIterations", () => {
  it("giver 12 som standard", () => {
    expect(resolveMaxIterations(undefined)).toBe(12);
  });
  it("kan kun SÆNKES af --max, aldrig hæves over det hårde loft (CON-001)", () => {
    expect(resolveMaxIterations(999)).toBe(12);
    expect(resolveMaxIterations(3)).toBe(3);
  });
  it("klamper til mindst 1", () => {
    expect(resolveMaxIterations(0)).toBe(1);
    expect(resolveMaxIterations(-5)).toBe(1);
  });
});

describe("decideStop", () => {
  const passing = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
  const failing = scoresFor("title", 0.8, { chip: region(0.8, 0.9) });

  it("stopper med success når alle regioner består, selv hvis der er styrke tilbage", () => {
    expect(decideStop({ scores: passing, screenIds: ["title"], noAcceptStreak: 0, iteration: 1, maxIterations: 12 })).toBe(STOP.SUCCESS);
  });
  it("success tjekkes FØR streak/max — en sløjfe i mål fortsætter ikke bare fordi den også har forsøg tilbage", () => {
    expect(decideStop({ scores: passing, screenIds: ["title"], noAcceptStreak: 3, iteration: 12, maxIterations: 12 })).toBe(STOP.SUCCESS);
  });
  it("stopper med no-accept-streak ved 3 i træk uden accept", () => {
    expect(decideStop({ scores: failing, screenIds: ["title"], noAcceptStreak: 3, iteration: 4, maxIterations: 12 })).toBe(STOP.NO_ACCEPT_STREAK);
  });
  it("stopper med max-iterations ved det hårde loft", () => {
    expect(decideStop({ scores: failing, screenIds: ["title"], noAcceptStreak: 0, iteration: 12, maxIterations: 12 })).toBe(STOP.MAX_ITERATIONS);
  });
  it("fortsætter (returnerer null) når intet stopkriterie er nået", () => {
    expect(decideStop({ scores: failing, screenIds: ["title"], noAcceptStreak: 1, iteration: 2, maxIterations: 12 })).toBeNull();
  });
});

describe("runJudgeLoop — fuld orkestrering, altid injicerede afhængigheder", () => {
  let dir: string;
  let tuningPath: string;
  let assetQueuePath: string;
  let humanQueuePath: string;
  let ledgerPath: string;
  let tick: number;
  const now = () => `2026-08-13T00:00:${String((tick++)).padStart(2, "0")}.000Z`;

  beforeEach(() => {
    dir = mkdtempSync(join(SCRATCH_ROOT, "judge-loop-"));
    tuningPath = join(dir, "tuning.css");
    writeFileSync(tuningPath, ":root {\n  --chronicle: #eee0cd;\n}\n");
    assetQueuePath = join(dir, "asset-queue.json");
    humanQueuePath = join(dir, "human-queue.json");
    ledgerPath = join(dir, "ledger.json");
    tick = 0;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function baseOptions(overrides = {}) {
    return {
      runDir: dir, screens: ["title"], registry: REGISTRY,
      tuningPath, assetQueuePath, humanQueuePath, ledgerPath, now,
      ...overrides,
    };
  }

  it("registrerer en ACCEPTERET iteration med fuld før/efter-score, fund, anvendt token, verdikt, iteration og tidsstempel", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const after = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
    const captureAndScore = vi.fn()
      .mockResolvedValueOnce(before) // baseline
      .mockResolvedValueOnce(after); // efter anvendelse
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));

    expect(ledger.iterations).toHaveLength(1);
    const it0 = ledger.iterations[0];
    expect(it0.verdict).toBe("accepted");
    expect(it0.n).toBe(1);
    expect(it0.before).toEqual(before);
    expect(it0.after).toEqual(after);
    expect(it0.applied).toHaveLength(1);
    expect(it0.applied[0].fix.token).toBe("--chronicle");
    expect(it0.at).toMatch(/^2026-08-13T/);
    expect(ledger.stopReason).toBe(STOP.SUCCESS);
    expect(ledger.outcome).toBe("success");
  });

  it("registrerer en AFVIST iteration: tuning.css genskabes byte-for-byte, konsoliderede nøgler tilføjes hukommelsen, før/efter bevares", async () => {
    const pristine = readFileSync(tuningPath, "utf8");
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    // Regression: chip falder mere end 0,02 → porten afviser.
    const after = scoresFor("title", 0.72, { chip: region(0.6, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding("--chronicle", 3, "chip:color:--chronicle")] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1 }));

    const it0 = ledger.iterations[0];
    expect(it0.verdict).toBe("rejected");
    expect(it0.before).toEqual(before);
    expect(it0.after).toEqual(after);
    expect(readFileSync(tuningPath, "utf8")).toBe(pristine);
    expect(ledger.rejected.map((r: any) => r.key)).toContain("chip:color:--chronicle");
  });

  it("konsoliderede nøgler (flere regioner samme token) lander ALLE i den afviste hukommelse", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const after = scoresFor("title", 0.65, { chip: region(0.6, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    // To fund fra FORSKELLIGE regioner, der begge peger på samme token —
    // route() beregner selv nøglen som region:defect:token (ignorerer et
    // evt. forudsat .key-felt), så to ægte forskellige regioner er
    // nødvendige for at udløse consolidateTokens()'s sammenlægning.
    const f1 = { ...tokenFinding("--chronicle", 3), region: "chip" };
    const f2 = { ...tokenFinding("--chronicle", 5), region: "tools" };
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [f1, f2] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1 }));
    const keys = ledger.rejected.map((r: any) => r.key);
    const consolidated = ledger.rejected.flatMap((r: any) => r.consolidatedFrom ?? []);
    expect([...keys, ...consolidated]).toEqual(expect.arrayContaining(["chip:color:--chronicle", "tools:color:--chronicle"]));
  });

  it("stopper med SUCCESS uden en eneste iteration når baseline allerede består", async () => {
    const passing = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(passing);
    const getFindingsFn = vi.fn();

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    expect(ledger.iterations).toHaveLength(0);
    expect(ledger.stopReason).toBe(STOP.SUCCESS);
    expect(getFindingsFn).not.toHaveBeenCalled();
  });

  it("stopper efter 3 PÅ HINANDEN FØLGENDE afviste iterationer (streak nulstilles af en accept)", async () => {
    const s0 = scoresFor("title", 0.5, { chip: region(0.5, 0.9) });
    const sAcceptedUp = scoresFor("title", 0.6, { chip: region(0.6, 0.9) });
    const sReject = scoresFor("title", 0.55, { chip: region(0.5, 0.9) }); // ingen fremgang → afvist
    const captureAndScore = vi.fn()
      .mockResolvedValueOnce(s0)            // baseline
      .mockResolvedValueOnce(sAcceptedUp)    // iter 1 → accepteret
      .mockResolvedValueOnce(sReject)        // iter 2 → afvist (1)
      .mockResolvedValueOnce(sReject)        // iter 3 → afvist (2)
      .mockResolvedValueOnce(sReject);       // iter 4 → afvist (3) → stop
    let n = 0;
    const getFindingsFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return { screen: "title", findings: [tokenFinding(`--t${n}`, 3, `chip:color:--t${n}`)] };
    });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    expect(ledger.iterations.map((i: any) => i.verdict)).toEqual(["accepted", "rejected", "rejected", "rejected"]);
    expect(ledger.stopReason).toBe(STOP.NO_ACCEPT_STREAK);
    expect(ledger.outcome).toBe("defeat");
  });

  it("stopper ved det hårde loft på 12 iterationer, selv når hver iteration accepteres", async () => {
    const scoresAt = (v: number) => scoresFor("title", v, { chip: region(v, 0.99) }); // tærsklen holdes urealistisk høj, så success aldrig nås
    let calls = 0;
    const captureAndScore = vi.fn().mockImplementation(async () => {
      calls += 1;
      // +0,01 pr. kald — komfortabelt over epsilon (0,002), så hver
      // iteration reelt accepteres, uden nogensinde at nå tærsklen 0,99.
      return scoresAt(0.5 + calls * 0.01);
    });
    let n = 0;
    const getFindingsFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return { screen: "title", findings: [tokenFinding(`--t${n}`, 3, `chip:color:--t${n}`)] };
    });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 999 }));
    expect(ledger.iterations).toHaveLength(12);
    expect(ledger.iterations.every((i: any) => i.verdict === "accepted")).toBe(true);
    expect(ledger.stopReason).toBe(STOP.MAX_ITERATIONS);
    // 2. anmeldelse, blokerer 4: 12 ÆGTE fremskridt, der løber tør for loft,
    // er IKKE et nederlag — det er et delvist udfald. "defeat" her ville
    // skjule reel, bevaret fremgang bag samme dom som "intet virkede".
    expect(ledger.outcome).toBe("partial");
  });

  it("blokerer i stedet for at spinde når en iteration kun har asset/struktur-fund (ingen anvendelige tokens)", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before);
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [assetFinding()] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    expect(ledger.iterations).toHaveLength(1);
    expect(ledger.iterations[0].verdict).toBe("blocked");
    expect(ledger.stopReason).toBe(STOP.NO_ACTIONABLE_TOKENS);
    expect(ledger.outcome).toBe("defeat");
    // kun ét kald: baseline. Der blev ALDRIG genoptaget, fordi der intet var at anvende.
    expect(captureAndScore).toHaveBeenCalledTimes(1);
    const q = JSON.parse(readFileSync(assetQueuePath, "utf8"));
    expect(q.items).toHaveLength(1);
    expect(q.items[0].fix.assetId).toBe("UI-chip-glow");
  });

  it("delvist udfald, ikke nederlag: en tidligere accept bevares, selvom sløjfen BAGEFTER blokerer på kun-asset/struktur-fund (2. anmeldelse, opfølgning)", async () => {
    const s0 = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const sAcceptedUp = scoresFor("title", 0.8, { chip: region(0.8, 0.9) });
    const captureAndScore = vi.fn()
      .mockResolvedValueOnce(s0)           // baseline
      .mockResolvedValueOnce(sAcceptedUp); // iter 1 → accepteret
    let n = 0;
    const getFindingsFn = vi.fn().mockImplementation(async () => {
      n += 1;
      // iter 1: et rigtigt token-fund, der accepteres. iter 2: kun et
      // asset-fund — intet at anvende, sløjfen blokerer i stedet for at
      // spinde. Modsat testen ovenfor er der her ALLEREDE reel fremgang.
      if (n === 1) return { screen: "title", findings: [tokenFinding("--t1", 3)] };
      return { screen: "title", findings: [assetFinding()] };
    });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    expect(ledger.iterations.map((i: any) => i.verdict)).toEqual(["accepted", "blocked"]);
    expect(ledger.stopReason).toBe(STOP.NO_ACTIONABLE_TOKENS);
    // Kernen i denne test: NO_ACTIONABLE_TOKENS med mindst én accept er
    // "partial", nøjagtig som MAX_ITERATIONS med mindst én accept — begge
    // bevarede reel fremgang, og "defeat" ville skjule den bag samme dom
    // som "intet virkede nogensinde" (se udfalds-matrixen i loop.mjs).
    expect(ledger.outcome).toBe("partial");
    // blokerer-iterationen genoptager ALDRIG — kun baseline + iter 1's after.
    expect(captureAndScore).toHaveBeenCalledTimes(2);
  });

  it("samme afviste fund foreslået igen næste iteration bliver sprunget over af ruteren og udløser no-actionable-tokens (den statiske fixture-vej)", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const afterReject = scoresFor("title", 0.6, { chip: region(0.6, 0.9) }); // regression → afvist
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(afterReject);
    // Samme statiske fund hver gang — simulerer --fixture-vejen, hvor modellen
    // ikke opdaterer sig mellem iterationer.
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding("--chronicle", 3, "chip:color:--chronicle")] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    expect(ledger.iterations.map((i: any) => i.verdict)).toEqual(["rejected", "blocked"]);
    expect(ledger.stopReason).toBe(STOP.NO_ACTIONABLE_TOKENS);
  });

  it("bevarer den bedste accepterede tilstand: accept, så afvis, tuning.css ender i den accepterede tilstand — ikke pristine, ikke den afviste", async () => {
    const s0 = scoresFor("title", 0.5, { chip: region(0.5, 0.9) });
    const s1 = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const s2reject = scoresFor("title", 0.6, { chip: region(0.55, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(s0).mockResolvedValueOnce(s1).mockResolvedValueOnce(s2reject);
    let n = 0;
    const getFindingsFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return n === 1
        ? { screen: "title", findings: [{ ...tokenFinding("--chronicle", 3, "chip:color:--chronicle"), fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" } }] }
        : { screen: "title", findings: [{ ...tokenFinding("--other", 3, "chip:font:--other"), defect: "font", fix: { kind: "token", token: "--other", from: "#000", to: "#111" } }] };
    });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 2 }));
    expect(ledger.iterations.map((i: any) => i.verdict)).toEqual(["accepted", "rejected"]);
    const finalTuning = readFileSync(tuningPath, "utf8");
    expect(finalTuning).toContain("#d8ba9b"); // fra den accepterede iteration
    expect(finalTuning).not.toContain("#111"); // den afviste værdi må ALDRIG overleve
    expect(ledger.bestTuning).toBe(finalTuning);
    expect(ledger.bestScores).toEqual(s1);
  });

  it("skriver ALDRIG uden for de injicerede stier — kun tuningPath, assetQueuePath, humanQueuePath og ledgerPath berøres", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const after = scoresFor("title", 0.95, { chip: region(0.95, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding(), assetFinding()] });

    await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }));
    const filesAfter = new Set(readdirSync(dir));
    // Kun kendte artefakter i testmappen — intet uventet er dukket op.
    for (const f of filesAfter) {
      expect(["tuning.css", "tuning.prev.css", "asset-queue.json", "human-queue.json", "ledger.json"]).toContain(f);
    }
  });

  it("kaster (skriver aldrig en usikker værdi) hvis et fund nogensinde skulle indeholde en farlig CSS-værdi i to — forsvar i dybden på sløjfe-niveau", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before);
    const dangerous = { ...tokenFinding(), fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "red; } body { display:none" } };
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [dangerous] });

    await expect(runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn }))).rejects.toThrow();
    // tuning.css skal stadig være urørt, fordi writeTuning kastede FØR skrivning.
    expect(readFileSync(tuningPath, "utf8")).toBe(":root {\n  --chronicle: #eee0cd;\n}\n");
  });

  it("scoper accept-gevinsten til de efterspurgte skærme (2. anmeldelse, blokerer 1) — game's uoptagne nul-stub fortynder IKKE en ægte title-forbedring", async () => {
    // Nøjagtig samme konstruktion som defekt 1's reproduktion i judge-gate.test.ts:
    // title (1 region) forbedres ægte +0,006 — langt over epsilon 0,002 —
    // men game (4 regioner, ALDRIG i baseOptions().screens=["title"]) sidder
    // uændret på overall 0 i begge scores og tæller stadig med i det globale
    // topniveau-felt. Uden scoping ville gevinsten fortyndes ned til
    // epsilon-grænsen (0,002) og afvises.
    const gameStub = { a: missingRegion(), b: missingRegion(), c: missingRegion(), d: missingRegion() };
    const before = scoresForScreens(1.4 / 6, {
      title: { overall: 0.7, regions: { chip: region(0.7, 0.9) } },
      game: { overall: 0, regions: gameStub },
    });
    const after = scoresForScreens(1.412 / 6, {
      title: { overall: 0.706, regions: { chip: region(0.706, 0.9) } },
      game: { overall: 0, regions: gameStub },
    });
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1 }));
    expect(ledger.iterations[0].verdict).toBe("accepted");
    expect(ledger.iterations[0].gain).toBeCloseTo(0.006, 4);
  });

  describe("nedbrud EFTER tuning.css er skrevet (2. anmeldelse, blokerer 2) — ALDRIG en fil, ingen har dømt", () => {
    it("genskaber tuning.css byte-for-byte, journalfører nedbruddet, og lader den oprindelige fejl boble videre, når genoptagelsen styrter", async () => {
      const pristine = readFileSync(tuningPath, "utf8");
      const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
      const captureAndScore = vi.fn()
        .mockResolvedValueOnce(before) // baseline
        .mockRejectedValueOnce(new Error("optagelsen styrtede efter writeTuning")); // genoptagelse
      const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

      await expect(
        runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1, ledgerPath })),
      ).rejects.toThrow("optagelsen styrtede efter writeTuning");

      expect(readFileSync(tuningPath, "utf8")).toBe(pristine);
      const persisted = JSON.parse(readFileSync(ledgerPath, "utf8"));
      expect(persisted.iterations).toHaveLength(1);
      expect(persisted.iterations[0].verdict).toBe("crashed");
      expect(persisted.iterations[0].reason).toContain("optagelsen styrtede");
      expect(persisted.stopReason).toBe(STOP.CRASHED);
      expect(persisted.outcome).toBe("crashed");
    });

    it("genskaber og kaster videre, når accept-porten selv fejler EFTER en lykkedes genoptagelse (dækker HELE vinduet, ikke kun capture)", async () => {
      const pristine = readFileSync(tuningPath, "utf8");
      const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
      // Mangler et topniveau .overall-felt → acceptGate selv kaster.
      const malformedAfter = { screens: { title: { screen: "title", overall: 0.9, regions: { chip: region(0.9, 0.9) } } } };
      const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(malformedAfter);
      const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

      await expect(
        runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1 })),
      ).rejects.toThrow(/overall mangler/);
      expect(readFileSync(tuningPath, "utf8")).toBe(pristine);
    });

    it("journalfører stadig nedbruddet og kaster den oprindelige fejl videre, selvom ledgerPath IKKE er givet", async () => {
      const pristine = readFileSync(tuningPath, "utf8");
      const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
      const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockRejectedValueOnce(new Error("uden ledgerPath"));
      const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

      await expect(
        runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1, ledgerPath: undefined })),
      ).rejects.toThrow("uden ledgerPath");
      expect(readFileSync(tuningPath, "utf8")).toBe(pristine);
    });
  });

  it("skelner et delvist udfald fra nederlag (2. anmeldelse, blokerer 4): --max 1 der ACCEPTERER er 'partial', ikke 'defeat'", async () => {
    const before = scoresFor("title", 0.7, { chip: region(0.7, 0.9) });
    const after = scoresFor("title", 0.8, { chip: region(0.8, 0.9) }); // ægte fremgang, men chip er stadig under 0,9 → ikke success
    const captureAndScore = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const getFindingsFn = vi.fn().mockResolvedValue({ screen: "title", findings: [tokenFinding()] });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 1 }));
    expect(ledger.iterations.map((i: any) => i.verdict)).toEqual(["accepted"]);
    expect(ledger.stopReason).toBe(STOP.MAX_ITERATIONS);
    expect(ledger.outcome).toBe("partial");
  });

  it("nul accepterede iterationer forbliver 'defeat', selv når loftet er nået (kontrasten til 'partial')", async () => {
    const scoresAt = (v: number) => scoresFor("title", v, { chip: region(v, 0.9) });
    const s0 = scoresAt(0.7);
    const captureAndScore = vi.fn().mockResolvedValueOnce(s0).mockResolvedValue(scoresAt(0.7)); // aldrig fremgang
    let n = 0;
    const getFindingsFn = vi.fn().mockImplementation(async () => {
      n += 1;
      return { screen: "title", findings: [tokenFinding(`--t${n}`, 3, `chip:color:--t${n}`)] };
    });

    const ledger = await runJudgeLoop(baseOptions({ captureAndScore, getFindingsFn, maxIterations: 2 }));
    expect(ledger.iterations.every((i: any) => i.verdict === "rejected")).toBe(true);
    expect(ledger.stopReason).toBe(STOP.MAX_ITERATIONS);
    expect(ledger.outcome).toBe("defeat");
  });
});

describe("createCapture — opsætning og oprydning ved fejl (2. anmeldelse, blokerer 3)", () => {
  it("dræber allerede-startet server, hvis browser-opstart fejler EFTER serveren allerede er startet", async () => {
    const killed = vi.fn();
    const startServerFn = vi.fn().mockResolvedValue({ kill: killed });
    const launchBrowser = vi.fn().mockRejectedValue(new Error("browseren kunne ikke starte"));
    const loadRegistryFn = vi.fn();

    await expect(
      createCapture({ runDir: "x", screenIds: ["title"], startServerFn, launchBrowser, loadRegistryFn }),
    ).rejects.toThrow("browseren kunne ikke starte");
    expect(killed).toHaveBeenCalledTimes(1);
    expect(loadRegistryFn).not.toHaveBeenCalled();
  });

  it("lukker browseren OG dræber serveren, hvis registry-indlæsning fejler EFTER browseren allerede er åbnet", async () => {
    const killed = vi.fn();
    const closed = vi.fn().mockResolvedValue(undefined);
    const startServerFn = vi.fn().mockResolvedValue({ kill: killed });
    const launchBrowser = vi.fn().mockResolvedValue({ close: closed });
    const loadRegistryFn = vi.fn().mockRejectedValue(new Error("registry.json ugyldig"));

    await expect(
      createCapture({ runDir: "x", screenIds: ["title"], startServerFn, launchBrowser, loadRegistryFn }),
    ).rejects.toThrow("registry.json ugyldig");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("en fejlende browser.close() under oprydning sluger IKKE den oprindelige registry-fejl", async () => {
    const killed = vi.fn();
    const startServerFn = vi.fn().mockResolvedValue({ kill: killed });
    const launchBrowser = vi.fn().mockResolvedValue({ close: vi.fn().mockRejectedValue(new Error("close fejlede også")) });
    const loadRegistryFn = vi.fn().mockRejectedValue(new Error("registry.json ugyldig"));

    await expect(
      createCapture({ runDir: "x", screenIds: ["title"], startServerFn, launchBrowser, loadRegistryFn }),
    ).rejects.toThrow("registry.json ugyldig");
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("lykkes opsætningen normalt: dispose() lukker browseren og dræber serveren præcis én gang hver", async () => {
    const killed = vi.fn();
    const closed = vi.fn().mockResolvedValue(undefined);
    const startServerFn = vi.fn().mockResolvedValue({ kill: killed });
    const launchBrowser = vi.fn().mockResolvedValue({ close: closed, newPage: vi.fn() });
    const loadRegistryFn = vi.fn().mockResolvedValue({ screens: [{ id: "title", regions: [] }] });

    const { dispose } = await createCapture({ runDir: "x", screenIds: ["title"], startServerFn, launchBrowser, loadRegistryFn });
    expect(killed).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    await dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("dispose() på en VELLYKKET opsætning: en fejlende browser.close() logges, men dræber STADIG serveren og kaster ikke selv videre (2. anmeldelse, opfølgning)", async () => {
    const killed = vi.fn();
    const closeError = new Error("close fejlede under normal oprydning");
    const startServerFn = vi.fn().mockResolvedValue({ kill: killed });
    const launchBrowser = vi.fn().mockResolvedValue({ close: vi.fn().mockRejectedValue(closeError), newPage: vi.fn() });
    const loadRegistryFn = vi.fn().mockResolvedValue({ screens: [{ id: "title", regions: [] }] });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { dispose } = await createCapture({ runDir: "x", screenIds: ["title"], startServerFn, launchBrowser, loadRegistryFn });
    // dispose() SELV må aldrig afvise/kaste — ellers overskriver den en
    // allerede undervejs-fejl, hvis den kaldes fra et finally (se
    // safeDispose-testene nedenfor for selve den interaktion).
    await expect(dispose()).resolves.toBeUndefined();
    expect(killed).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});

describe("safeDispose — main()s oprydning må ALDRIG overskrive kørslens egen fejl (2. anmeldelse, opfølgning)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("kalder disposeFn og sluger dens fejl stille (logget, ikke kastet videre)", async () => {
    const disposeFn = vi.fn().mockRejectedValue(new Error("luk-fejl"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(safeDispose(disposeFn)).resolves.toBeUndefined();
    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("er et no-op uden fejl, når disposeFn lykkes", async () => {
    const disposeFn = vi.fn().mockResolvedValue(undefined);
    await expect(safeDispose(disposeFn)).resolves.toBeUndefined();
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it("er et no-op, når der slet ingen disposeFn er (opsætningen fejlede, før dispose blev tildelt)", async () => {
    await expect(safeDispose(undefined)).resolves.toBeUndefined();
  });

  it("bevarer den OPRINDELIGE fejl fra en kørsel, selvom oprydningen bagefter OGSÅ fejler — nøjagtig samme try/finally-mønster som main()", async () => {
    const disposeFn = vi.fn().mockRejectedValue(new Error("oprydningsfejl"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Dette ER main()s mønster (let dispose; try { … } finally { await
    // safeDispose(dispose); }) — et kast i en finally-blok overskriver
    // ellers ubetinget et kast fra selve try-blokken i JavaScript.
    async function simulerMain() {
      try {
        throw new Error("kørselsfejl");
      } finally {
        await safeDispose(disposeFn);
      }
    }

    await expect(simulerMain()).rejects.toThrow("kørselsfejl");
    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
