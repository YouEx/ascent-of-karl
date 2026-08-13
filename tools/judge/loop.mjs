#!/usr/bin/env node
/**
 * Selve efterprøv-sløjfen — den del der binder de andre moduler sammen til
 * en faktisk proces: fund → rute → anvend token → optag igen → accept-port →
 * journalpost → stopbetingelse.
 *
 * `runJudgeLoop` er sløjfens rene(re) kerne: ALLE sideeffekter (optag+scor,
 * hent fund, rut, skriv token, kø-tilføjelse, journal-tid) er injicerbare
 * parametre med en rigtig standardimplementering. Det er det, der gør en
 * proces, der i produktion booter en browser og bygger et Vite-bundt, muligt
 * at teste fuldt ud uden hverken browser, netværk eller de rigtige
 * src/ui/tuning.css-, docs/design/*-queue.json- eller .judge/-stier — se
 * tests/judge-loop.test.ts, der injicerer alt sammen mod en midlertidig
 * testmappe.
 *
 * Tre ting der ALDRIG sker her, uanset hvad et fund foreslår:
 *   - tuning.css rulles ALDRIG tilbage med `git reset`/`git checkout` — kun
 *     et rent strengsnapshot af selve filen, taget lige før skrivning.
 *   - en `structure`-rettelse anvendes ALDRIG automatisk (CON-003) — den
 *     ruteres til human-queue.json og venter på et menneske.
 *   - en iteration med KUN asset/struktur-fund (ingen anvendelig token)
 *     bliver ALDRIG ved med at spinde igennem resten af loftet — den
 *     blokerer med det samme og rapporterer hvorfor (spec-krav, se README
 *     for opgaven: "asset/structure-only iteration reports blocked rather
 *     than spinning").
 *
 * CON-001's hårde loft på 12 iterationer kan kun SÆNKES af `--max`, aldrig
 * hæves — se resolveMaxIterations.
 *
 * Kør:
 *   node tools/judge/loop.mjs [--run .judge/<run>] [--screen title] [--max N] [--fixture findings.json]
 * Se plan/architecture-visual-judge-1.md TASK-024, TASK-025, TASK-026,
 * CON-001, CON-002, CON-003, CON-004.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { route, writeTuning, appendQueue, acceptGate, rejectedKeys } from "./apply.mjs";
import { loadKnownTokens } from "./validate-finding.mjs";
import { getFindings, loadRegionPayloads } from "./judge.mjs";
import { build, startServer, loadRegistry, captureScreen } from "./capture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUNING = path.join(ROOT, "src/ui/tuning.css");
const ASSET_QUEUE = path.join(ROOT, "docs/design/asset-queue.json");
const HUMAN_QUEUE = path.join(ROOT, "docs/design/human-queue.json");

const HARD_MAX_ITERATIONS = 12;
const NO_ACCEPT_STREAK_LIMIT = 3;

/** De fire stopkoder (TASK-026). Kun SUCCESS er en sejr — de tre andre er
 *  et rapporteret nederlag (CON-001), aldrig en stille afslutning. */
export const STOP = Object.freeze({
  SUCCESS: "success",
  NO_ACTIONABLE_TOKENS: "no-actionable-tokens",
  NO_ACCEPT_STREAK: "no-accept-streak",
  MAX_ITERATIONS: "max-iterations",
});

/**
 * Er alle regioner på de efterspurgte skærme over deres egen tærskel? Ren
 * funktion: læser kun de tal, scores.json allerede bærer pr. region (vægt/
 * tærskel kopieres derind af metrics.py fra registry.json). En efterspurgt
 * skærm, der slet ikke findes i scores, tæller som ikke-bestået — en tavs
 * "success" fordi data manglede, ville være værre end at fortsætte.
 */
export function allRegionsPassing(scores, screenIds) {
  for (const sid of screenIds) {
    const s = scores?.screens?.[sid];
    if (!s) return false;
    for (const r of Object.values(s.regions ?? {})) {
      if (typeof r.threshold === "number" && r.overall < r.threshold) return false;
    }
  }
  return true;
}

/** `--max` kan kun sænke loftet på 12, aldrig hæve det (CON-001). Klampet
 *  til mindst 1 — en sløjfe med et loft på 0 ville aldrig få lov at prøve. */
export function resolveMaxIterations(requested) {
  if (!Number.isFinite(requested)) return HARD_MAX_ITERATIONS;
  return Math.min(HARD_MAX_ITERATIONS, Math.max(1, Math.floor(requested)));
}

/**
 * Afgør om sløjfen skal stoppe FØR endnu en iteration startes. Ren funktion
 * — kaldt i toppen af hver gennemløb i runJudgeLoop, og direkte testbar for
 * sig selv. Rækkefølgen er reglen: success tjekkes altid FØRST, for en
 * sløjfe der allerede er i mål skal ikke fortsætte, bare fordi den også har
 * forsøg eller streak tilbage.
 *
 * "no-actionable-tokens" er IKKE med her — den kan først afgøres midt i en
 * iteration, efter ruteren har set, hvad fundene faktisk indeholder.
 */
export function decideStop({ scores, screenIds, noAcceptStreak, iteration, maxIterations }) {
  if (allRegionsPassing(scores, screenIds)) return STOP.SUCCESS;
  if (noAcceptStreak >= NO_ACCEPT_STREAK_LIMIT) return STOP.NO_ACCEPT_STREAK;
  if (iteration >= maxIterations) return STOP.MAX_ITERATIONS;
  return null;
}

/**
 * Sløjfens kerne. Se filens toptekst for injektionsprincippet.
 *
 * Påkrævede parametre (ingen sikker standard, fordi de er selve pointen med
 * injektion): `runDir`, `screens`, `registry`, `captureAndScore`.
 * `tuningPath`/`assetQueuePath`/`humanQueuePath`/`ledgerPath` har rigtige
 * standardværdier for produktionsbrug, men SKAL injiceres i tests, så en
 * test aldrig kan røre en rigtig fil ved en fejl.
 */
export async function runJudgeLoop({
  runDir,
  screens,
  registry,
  maxIterations,
  fixture,
  captureAndScore,
  getFindingsFn = getFindings,
  tuningPath = TUNING,
  assetQueuePath = ASSET_QUEUE,
  humanQueuePath = HUMAN_QUEUE,
  ledgerPath,
  now = () => new Date().toISOString(),
  knownTokensLoader = loadKnownTokens,
} = {}) {
  if (typeof captureAndScore !== "function") {
    throw new Error("runJudgeLoop: captureAndScore er påkrævet (ingen sikker standard for en rigtig browser/netværk her)");
  }
  const cappedMax = resolveMaxIterations(maxIterations);
  const backupPath = path.join(runDir, "tuning.prev.css");

  const ledger = {
    run: runDir, screens, startedAt: now(),
    iterations: [], rejected: [],
    bestTuning: fs.existsSync(tuningPath) ? fs.readFileSync(tuningPath, "utf8") : "",
    bestScores: null,
    stopReason: null, outcome: null,
  };

  const knownRegions = new Set(registry.screens.flatMap((s) => s.regions.map((r) => r.id)));

  let scores = await captureAndScore("baseline");
  ledger.baselineScores = scores;
  ledger.bestScores = scores;

  let noAcceptStreak = 0;
  let iteration = 0;

  while (true) {
    const stop = decideStop({ scores, screenIds: screens, noAcceptStreak, iteration, maxIterations: cappedMax });
    if (stop) { ledger.stopReason = stop; break; }
    iteration += 1;

    const knownTokens = knownTokensLoader();
    const context = { knownRegions, knownTokens };
    const rejectedKeysArr = [...rejectedKeys(ledger)];

    let allFindings = [];
    for (const sid of screens) {
      const regionPayloads = fixture ? [] : loadRegionPayloads(runDir, sid, registry);
      const doc = await getFindingsFn({ run: runDir, screen: sid, fixture, context, regionPayloads, rejectedKeys: rejectedKeysArr });
      for (const f of doc.findings ?? []) allFindings.push({ ...f, screen: sid });
    }

    const routed = route(allFindings, ledger);
    const qa = appendQueue(assetQueuePath, routed.assets, iteration);
    const qh = appendQueue(humanQueuePath, routed.human, iteration);

    if (routed.tokens.length === 0) {
      // Kun asset/struktur-fund (eller alt sammen tidligere afvist og derfor
      // sprunget over) — der er intet at anvende. Blokerer STRAKS i stedet
      // for at bruge resten af loftet på iterationer, der aldrig kunne have
      // rykket noget, jf. opgavens krav om ikke at spinde.
      ledger.iterations.push({
        n: iteration, at: now(), verdict: "blocked",
        reason: "ingen anvendelige token-fund denne iteration (kun asset/struktur, eller alt tidligere afvist)",
        findings: allFindings, queuedAssets: qa, queuedHuman: qh,
        before: scores,
      });
      ledger.stopReason = STOP.NO_ACTIONABLE_TOKENS;
      break;
    }

    const beforeTuning = fs.readFileSync(tuningPath, "utf8");
    const before = scores;

    // writeTuning kaster selv, hvis en foreslået værdi er usikker CSS —
    // forsvar i dybden helt ude ved den eneste fil, sløjfen må skrive til.
    // Kastes her, er tuning.css IKKE rørt (writeTuning skriver kun ved
    // succes), så vi lader fejlen boble op uden at forsøge en gendannelse,
    // der ikke er nødvendig.
    writeTuning(routed.tokens, iteration, { tuningPath, backupPath });
    const after = await captureAndScore(`iter-${iteration}`);
    const verdict = acceptGate(before, after);

    if (verdict.accepted) {
      noAcceptStreak = 0;
      scores = after;
      ledger.bestScores = after;
      ledger.bestTuning = fs.readFileSync(tuningPath, "utf8");
      ledger.iterations.push({
        n: iteration, at: now(), verdict: "accepted",
        before, after, findings: allFindings,
        applied: routed.tokens.map((t) => ({ key: t.key, region: t.region, defect: t.defect, severity: t.severity, fix: t.fix })),
        queuedAssets: qa, queuedHuman: qh,
        gain: verdict.gain, reason: verdict.why,
      });
    } else {
      noAcceptStreak += 1;
      // Byte-for-byte gendannelse — ALDRIG git reset/checkout. Kun et rent
      // strengsnapshot af selve filen, taget lige før writeTuning ovenfor.
      fs.writeFileSync(tuningPath, beforeTuning);
      for (const t of routed.tokens) {
        ledger.rejected.push({
          key: t.key, region: t.region, defect: t.defect, fix: t.fix,
          consolidatedFrom: t.consolidatedFrom ?? [], iteration,
        });
      }
      ledger.iterations.push({
        n: iteration, at: now(), verdict: "rejected",
        before, after, findings: allFindings,
        attempted: routed.tokens.map((t) => ({ key: t.key, region: t.region, defect: t.defect, severity: t.severity, fix: t.fix })),
        queuedAssets: qa, queuedHuman: qh,
        gain: verdict.gain, regressions: verdict.regressions, reason: verdict.why,
      });
      // scores forbliver uændret — tuning.css blev lige rullet tilbage, så
      // den visuelle tilstand er byte-for-byte identisk med `before` igen.
    }
  }

  if (!ledger.stopReason) ledger.stopReason = STOP.MAX_ITERATIONS;
  ledger.outcome = ledger.stopReason === STOP.SUCCESS ? "success" : "defeat";
  ledger.finishedAt = now();
  ledger.finalScores = scores;

  if (ledgerPath) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  }
  return ledger;
}

// --------------------------------------------------- produktions-wiring

/**
 * Rigtig `captureAndScore`: starter server + browser ÉN gang og genbruger
 * dem på tværs af iterationer, genbygger kun `dist/` mellem hver (se
 * capture.mjs's `build()`-kommentar for hvorfor det er sikkert, CON-004).
 * metrics.py/overlay.py er Python og kan ikke importeres — kaldes derfor
 * som underprocesser, synkront, så en fejl i dem stopper sløjfen med det
 * samme frem for at score på et halvfærdigt scores.json.
 *
 * Ikke enhedstestet direkte (kræver en rigtig browser) — afprøvet end-to-
 * end via de rigtige fixture-drevne verifikationskørsler.
 */
export async function createCapture({ runDir, screenIds }) {
  const server = await startServer();
  const browser = await chromium.launch();
  const registry = await loadRegistry();
  const screensToCapture = registry.screens.filter((s) => screenIds.includes(s.id));

  async function captureAndScore() {
    await build();
    for (const screen of screensToCapture) {
      await captureScreen(browser, screen, runDir);
    }
    execFileSync("python3", ["tools/judge/metrics.py", "--run", runDir, "--json"], {
      cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync("python3", ["tools/judge/overlay.py", "--run", runDir], {
      cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    });
    return JSON.parse(fs.readFileSync(path.join(runDir, "scores.json"), "utf8"));
  }

  async function dispose() {
    await browser.close();
    server.kill();
  }

  return { captureAndScore, dispose };
}

function defaultRunDir() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return path.join(ROOT, ".judge", stamp);
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const runArg = valueOf(args, "--run");
  const runDir = runArg ? path.resolve(ROOT, runArg) : defaultRunDir();
  const screenArg = valueOf(args, "--screen");
  const fixture = valueOf(args, "--fixture");
  const maxArg = valueOf(args, "--max");
  const maxIterations = maxArg ? parseInt(maxArg, 10) : HARD_MAX_ITERATIONS;

  const registry = await loadRegistry();
  const screens = screenArg ? [screenArg] : registry.screens.map((s) => s.id);

  fs.mkdirSync(runDir, { recursive: true });
  const { captureAndScore, dispose } = await createCapture({ runDir, screenIds: screens });
  try {
    const ledger = await runJudgeLoop({
      runDir, screens, registry, maxIterations, fixture, captureAndScore,
      ledgerPath: path.join(runDir, "ledger.json"),
    });
    console.log(`→ ${runDir}`);
    console.log(`  udfald: ${ledger.outcome} · stop: ${ledger.stopReason} · iterationer: ${ledger.iterations.length}`);
    if (ledger.outcome !== "success") process.exitCode = 1;
  } finally {
    await dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
