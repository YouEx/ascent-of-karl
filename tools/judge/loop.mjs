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
import { build, startServer, stopServer, loadRegistry, captureScreen } from "./capture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUNING = path.join(ROOT, "src/ui/tuning.css");
const ASSET_QUEUE = path.join(ROOT, "docs/design/asset-queue.json");
const HUMAN_QUEUE = path.join(ROOT, "docs/design/human-queue.json");

const HARD_MAX_ITERATIONS = 12;
const NO_ACCEPT_STREAK_LIMIT = 3;

/** De fem stopkoder (TASK-026). Kun SUCCESS er en sejr — de andre er et
 *  rapporteret nederlag (CON-001), aldrig en stille afslutning. CRASHED
 *  (2. anmeldelse, blokerer 2) er ikke et bevidst stop, men den kode
 *  journalen får skrevet PÅ, når en iteration nedbrød efter tuning.css blev
 *  rørt — den ledsager altid en videre-kastet fejl, aldrig en rolig retur. */
export const STOP = Object.freeze({
  SUCCESS: "success",
  NO_ACTIONABLE_TOKENS: "no-actionable-tokens",
  NO_ACCEPT_STREAK: "no-accept-streak",
  MAX_ITERATIONS: "max-iterations",
  CRASHED: "crashed",
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

    // 2. anmeldelse, blokerer 2: FRA HER er tuning.css muteret. Enhver fejl
    // i genoptagelse, scoring, accept-porten ELLER journalskrivningen
    // herunder skal derfor genskabe tuning.css byte-for-byte, journalføre
    // nedbruddet (hvis journalen kan skrives) og kaste den OPRINDELIGE fejl
    // videre uændret — aldrig lade en muteret, udømt fil overleve, og aldrig
    // sluge fejlen bag et stille resultat.
    try {
      const after = await captureAndScore(`iter-${iteration}`);
      // screenIds scoper både gevinsten og regressionsscanet til DENNE
      // kørsels skærme (2. anmeldelse, blokerer 1) — uden det fortynder
      // andre registry-skærmes uoptagne nul-stubbe en ægte forbedring.
      const verdict = acceptGate(before, after, { screenIds: screens });

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
    } catch (err) {
      fs.writeFileSync(tuningPath, beforeTuning);
      ledger.iterations.push({
        n: iteration, at: now(), verdict: "crashed",
        reason: `nedbrud efter tuning.css blev skrevet, tuning.css genskabt: ${err.message}`,
        before, findings: allFindings,
        attempted: routed.tokens.map((t) => ({ key: t.key, region: t.region, defect: t.defect, severity: t.severity, fix: t.fix })),
        queuedAssets: qa, queuedHuman: qh,
      });
      ledger.stopReason = STOP.CRASHED;
      ledger.outcome = "crashed";
      ledger.finishedAt = now();
      if (ledgerPath) {
        try {
          fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
          fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
        } catch {
          // En sekundær I/O-fejl her må ALDRIG skjule den oprindelige fejl —
          // den er allerede den vigtigste besked, og den kastes uændret nedenfor.
        }
      }
      throw err;
    }
  }

  if (!ledger.stopReason) ledger.stopReason = STOP.MAX_ITERATIONS;
  // Udfalds-matrix (stopReason × mindst én accept?) → outcome. 2. anmeldelse,
  // blokerer 4 + opfølgning:
  //
  //   SUCCESS                                       → "success"  (alle anmodede regioner bestod)
  //   MAX_ITERATIONS        + acceptedCount ≥ 1      → "partial"  (loftet nået, men reel fremgang bevaret)
  //   MAX_ITERATIONS        + acceptedCount = 0      → "defeat"   (loftet nået, intet virkede — kan kun ske ved --max < 3)
  //   NO_ACTIONABLE_TOKENS  + acceptedCount ≥ 1       → "partial"  (blokeret af asset/struktur-fund, men reel fremgang bevaret)
  //   NO_ACTIONABLE_TOKENS  + acceptedCount = 0       → "defeat"   (blokeret fra første iteration, intet nåede at virke)
  //   NO_ACCEPT_STREAK      (uanset acceptedCount)    → ALTID "defeat" (tre afviste i træk er i sig selv beviset på,
  //                                                                     at sløjfen sidder fast NU — en tidligere accept
  //                                                                     ændrer ikke på det, jf. opgavens eksplicitte krav)
  //   CRASHED                                        → "crashed"  (sat direkte i catch-blokken ovenfor, aldrig her)
  //
  // 12 ægte accepterede iterationer, der løber tør for loft, er IKKE et
  // nederlag på linje med "intet virkede nogensinde" — det samme gælder en
  // kørsel, der blev accepteret og BAGEFTER blokerede på kun-asset/struktur-
  // fund. Begge bevarede reel fremgang og fortjener "partial", ikke "defeat".
  const acceptedCount = ledger.iterations.filter((i) => i.verdict === "accepted").length;
  const stopsWithPartialCredit = ledger.stopReason === STOP.MAX_ITERATIONS || ledger.stopReason === STOP.NO_ACTIONABLE_TOKENS;
  ledger.outcome = ledger.stopReason === STOP.SUCCESS ? "success"
    : (stopsWithPartialCredit && acceptedCount > 0) ? "partial"
    : "defeat";
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
 * `startServerFn`/`launchBrowser`/`loadRegistryFn` er injicerbare (default:
 * de rigtige implementeringer), så opsætningens FEJLSTIER kan enhedstestes
 * uden en rigtig browser eller server — se tests/judge-loop.test.ts's
 * "createCapture — opsætning og oprydning ved fejl". Selve `captureAndScore`
 * er stadig ikke enhedstestet direkte (kræver en rigtig browser) — afprøvet
 * end-to-end via de rigtige fixture-drevne verifikationskørsler.
 *
 * 2. anmeldelse, blokerer 3: opsætningen sker i to trin (server, så browser,
 * så registry), og et senere trins fejl må ALDRIG efterlade et tidligere
 * trins ressource kørende. Rækkefølgen på oprydning er omvendt af
 * opstarten: luk browseren (hvis den nåede at åbne), dræb derefter serveren
 * — og en fejlende browser.close() under oprydning må ALDRIG skjule den
 * oprindelige fejl, der udløste oprydningen.
 */
export async function createCapture({
  runDir, screenIds,
  startServerFn = startServer,
  launchBrowser = () => chromium.launch(),
  loadRegistryFn = loadRegistry,
}) {
  const server = await startServerFn();
  let browser;
  try {
    browser = await launchBrowser();
    const registry = await loadRegistryFn();
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
      // Opfølgning til 2. anmeldelse, blokerer 3: dette er den NORMALE
      // oprydning efter en vellykket kørsel, ikke fejlstien ovenfor — men
      // samme regel gælder. En fejlende browser.close() må ALDRIG forhindre
      // server.kill() i at køre, og må ALDRIG selv boble videre: dispose()
      // kaldes typisk fra main()s `finally`, og et kast dér ville overskrive
      // en fejl, der allerede er undervejs ud af den tilsvarende `try`
      // (JavaScripts finally-semantik — se safeDispose/tests for beviset).
      await browser.close().catch((err) => {
        console.error(`kunne ikke lukke browseren pænt under oprydning: ${err.message}`);
      });
      await stopServer(server);
    }

    return { captureAndScore, dispose };
  } catch (err) {
    if (browser) await browser.close().catch(() => {}); // sekundær lukkefejl må ALDRIG skjule den oprindelige
    await stopServer(server);
    throw err;
  }
}

/**
 * Kalder `disposeFn` (typisk `createCapture`s `dispose`) og sluger enhver
 * fejl derfra — logger den, kaster den ALDRIG videre. Beregnet til at stå i
 * `main()`s `finally`: et kast dér ville, uanset denne funktion, overskrive
 * en fejl der allerede er undervejs ud af den tilsvarende `try` — det er
 * selve JavaScript-sprogets semantik, ikke noget denne kode kan vælge om.
 * Den eneste måde at undgå det på er at sikre, at selve oprydningen aldrig
 * kaster (2. anmeldelse, opfølgning — se tests/judge-loop.test.ts's
 * "safeDispose" for et bevis på nøjagtig den try/finally-interaktion).
 */
export async function safeDispose(disposeFn) {
  if (!disposeFn) return;
  try {
    await disposeFn();
  } catch (err) {
    console.error(`oprydning efter kørslen fejlede: ${err.message}`);
  }
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
  // 2. anmeldelse, blokerer 3: createCapture ligger NU inde i den beskyttede
  // levetid, med et hejst `dispose`, der kun kaldes hvis opsætningen reelt
  // lykkedes. createCapture rydder allerede op efter sig selv, hvis DEN
  // fejler (se ovenfor) — dette er et ekstra lag, der gør levetiden korrekt,
  // selv hvis nogen senere føjer kode ind mellem opsætning og sløjfe.
  let dispose;
  try {
    const created = await createCapture({ runDir, screenIds: screens });
    dispose = created.dispose;
    const ledger = await runJudgeLoop({
      runDir, screens, registry, maxIterations, fixture, captureAndScore: created.captureAndScore,
      ledgerPath: path.join(runDir, "ledger.json"),
    });
    console.log(`→ ${runDir}`);
    console.log(`  udfald: ${ledger.outcome} · stop: ${ledger.stopReason} · iterationer: ${ledger.iterations.length}`);
    // "partial" er reel, bevaret fremgang der løb tør for loft — ikke et
    // nederlag (2. anmeldelse, blokerer 4). Kun "defeat" er en fejlkode.
    if (ledger.outcome === "defeat") process.exitCode = 1;
  } finally {
    // safeDispose SLUGER enhver oprydningsfejl (logget, ikke kastet) —
    // ellers ville et kast her, i en finally, overskrive en fejl der
    // allerede er undervejs ud af try-blokken ovenfor (2. anmeldelse,
    // opfølgning).
    await safeDispose(dispose);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
