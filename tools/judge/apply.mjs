#!/usr/bin/env node
/**
 * Ruter og accept-port — den del der gør sløjfen sikker.
 *
 * Den vigtigste designbeslutning i hele systemet: sløjfen må skrive ÉT sted,
 * src/ui/tuning.css, og kun :root-tokenoverstyringer. Alt andet ruteres til en
 * kø, som et menneske eller et asset-script tømmer.
 *
 * Hvorfor: størstedelen af afstanden til referencen er MALET KUNST, som ikke
 * findes. En sløjfe uden den opdeling vil forsøge at efterligne et pergament
 * med en box-shadow, score marginalt værre, prøve en gradient, score værre
 * igen — i det uendelige, mens den langsomt ødelægger de dele, der virkede.
 * Ruteren er det, der gør "kan ikke løses med CSS" til et RESULTAT frem for
 * til en endeløs løkke.
 *
 * Accept-porten (CON-002) er den anden halvdel: en ændring beholdes kun, hvis
 * den samlede score stiger OG ingen region falder mere end 0,02. Uden den
 * anden betingelse kan sløjfen ofre en region for at hæve gennemsnittet.
 *
 * VIGTIG afgrænsning, lært ved første rigtige iteration: porten dømmer
 * SLØJFENS tokenskrivninger, ikke menneskets strukturændringer. Da #app blev
 * rettet fra 760 px til referencens målte 1112 px, steg app-frame 0,45→0,54 og
 * narrator 0,56→0,65, men `chips` faldt 0,04 — og porten afviste. Kigget på
 * overlejringen var forklaringen klar: vores chips er for SMÅ, og ved 760 px
 * udfyldte de tilfældigvis rækken bedre. Ændringen skabte ikke fejlen, den
 * afslørede den. En strukturel rettelse, der er verificeret mod målt geometri,
 * må derfor gå uden om porten — men det, den afslører, skal skrives ned, ikke
 * ties ihjel. Se GUD-004 i planen.
 *
 * Kør:
 *   node tools/judge/apply.mjs --findings <fil.json>       # ruter + anvender
 *   node tools/judge/apply.mjs --findings <fil.json> --dry # kun ruter, skriv intet
 *   node tools/judge/apply.mjs --revert                    # rul den globale sidste skrivning tilbage
 *   node tools/judge/apply.mjs --revert --run .judge/<kørsel>   # rul PRÆCIS den kørsels backup tilbage
 *   node tools/judge/apply.mjs --revert --backup <sti>     # rul en eksplicit backupfil tilbage
 *
 * Se plan/architecture-visual-judge-1.md REQ-004, REQ-005, CON-002, CON-003.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFECTS, NEVER_TOKEN, safeCssValueErrors } from "./validate-finding.mjs";
import { collectScoreRegressions, normalizedDrop } from "./score-tolerance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUNING = path.join(ROOT, "src/ui/tuning.css");
const ASSET_QUEUE = path.join(ROOT, "docs/design/asset-queue.json");
const HUMAN_QUEUE = path.join(ROOT, "docs/design/human-queue.json");
const LEDGER = path.join(ROOT, ".judge/ledger.json");
const BACKUP = path.join(ROOT, ".judge/tuning.prev.css");
const REGISTRY = path.join(ROOT, "docs/design/reference/registry.json");

// DEFECTS og NEVER_TOKEN kommer nu fra validate-finding.mjs, som selv udleder
// det lukkede ordforråd af finding.schema.json — ruteren og judge.mjs's
// strenge validator kan derfor aldrig glide fra hinanden (se TASK-021's
// revisionsnote om præcis den slags drift, dengang de var to håndkopier).

const readJson = (p, fallback) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;

/** Minimal skemakontrol. Håndrullet frem for ajv, fordi projektet ikke har
 *  runtime-afhængigheder, og reglerne her er få og faste. */
function validate(doc, knownRegions) {
  const errs = [];
  if (!doc || typeof doc !== "object") return ["findings-dokumentet er ikke et objekt"];
  if (typeof doc.screen !== "string") errs.push("screen mangler");
  if (!Array.isArray(doc.findings)) return [...errs, "findings er ikke en liste"];

  doc.findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!knownRegions.has(f.region)) errs.push(`${at}.region "${f.region}" findes ikke i registry`);
    if (!DEFECTS.has(f.defect)) errs.push(`${at}.defect "${f.defect}" er uden for det lukkede ordforråd`);
    if (!Number.isInteger(f.severity) || f.severity < 1 || f.severity > 5)
      errs.push(`${at}.severity skal være 1-5`);
    if (typeof f.evidence !== "string" || f.evidence.length < 20)
      errs.push(`${at}.evidence mangler tal-belæg (min. 20 tegn)`);
    const fix = f.fix;
    if (!fix || typeof fix !== "object") { errs.push(`${at}.fix mangler`); return; }
    if (fix.kind === "token") {
      if (!/^--[a-z0-9-]+$/.test(fix.token || "")) errs.push(`${at}.fix.token er ikke et token-navn`);
      if (typeof fix.to !== "string" || !fix.to) errs.push(`${at}.fix.to mangler`);
      else for (const e of safeCssValueErrors(fix.to)) errs.push(`${at}.fix.to: ${e}`);
    } else if (fix.kind === "asset") {
      if (!/^[A-Z]+-[A-Za-z0-9-]+$/.test(fix.assetId || "")) errs.push(`${at}.fix.assetId er malformet`);
      if ((fix.spec || "").length < 20) errs.push(`${at}.fix.spec er for tynd`);
    } else if (fix.kind === "structure") {
      if (!fix.file) errs.push(`${at}.fix.file mangler`);
      if ((fix.change || "").length < 20) errs.push(`${at}.fix.change er for tynd`);
    } else {
      errs.push(`${at}.fix.kind "${fix.kind}" er ukendt`);
    }
  });
  return errs;
}

/**
 * Vælger, for hvert token, HVILKET fund der vinder når flere foreslår en
 * værdi til samme `--token` — højeste severity, ikke sidst behandlede.
 *
 * Ren funktion (ingen disk-adgang), fordi den er selve reglen, der tidligere
 * var i stykker to steder på én gang: writeTuning() satte værdier i et Map i
 * severity-sorteret (faldende) rækkefølge, og Map.set overskriver — så den
 * SIDST behandlede vandt, hvilket er den LAVESTE severity, ikke den højeste.
 * Ved uafgjort severity vinder det fund, der stod FØRST i inputlisten
 * (stabilt og deterministisk, ikke tilfældigt hvem der "kom sidst").
 */
export function resolveTokenWinners(tokens) {
  const winners = new Map(); // token -> vindende fund
  for (const t of tokens) {
    const current = winners.get(t.fix.token);
    if (!current || t.severity > current.severity) winners.set(t.fix.token, t);
  }
  return winners;
}

/**
 * Dedupérer fund på tværs af regioner: to regioner, der begge peger på samme
 * `--token`, er ÉT fund for ruteren og journalen, ikke to. Uden dette skriver
 * sløjfen samme variabel to gange i én iteration og tilskriver æren til den
 * forkerte region, og to separate region:defect:token-nøgler forhindrer
 * genkendelse af, at det reelt var samme rettelse. TASK-021.
 */
export function consolidateTokens(tokens) {
  const winners = resolveTokenWinners(tokens);
  // Alle nøgler pr. token, i den rækkefølge de optræder — også dem der taber.
  // Uden dem kan en senere iteration ikke se, at regionen bag det tabende
  // fund allerede fik sit token-forslag medregnet denne gang.
  const keysByToken = new Map();
  for (const t of tokens) {
    const keys = keysByToken.get(t.fix.token) ?? [];
    if (!keys.includes(t.key)) keys.push(t.key);
    keysByToken.set(t.fix.token, keys);
  }
  return [...winners.entries()].map(([token, winner]) => {
    const keys = keysByToken.get(token);
    return keys.length > 1 ? { ...winner, consolidatedFrom: keys } : winner;
  });
}

/**
 * Flader en journalpost af afviste fund ud til ALLE nøgler, den dækker.
 *
 * En afvist post kan repræsentere et konsolideret fund (se consolidateTokens,
 * TASK-021): `.key` er kun VINDERENS region:defekt:token, mens `.consolidat-
 * edFrom` rummer de tabende regioners nøgler for samme token. At kun læse
 * `.key` — hvad route() gjorde før denne rettelse — glemmer de tabende
 * nøgler, så den tabende regions IDENTISKE forslag ikke genkendes som
 * "allerede afvist" og foreslås igen hver eneste iteration.
 */
export function rejectedKeys(ledger) {
  const keys = new Set();
  for (const r of ledger.rejected ?? []) {
    keys.add(r.key);
    for (const k of r.consolidatedFrom ?? []) keys.add(k);
  }
  return keys;
}

/** Ruter hvert fund til den ene kanal, der faktisk kan løse det. */
export function route(findings, ledger) {
  const rejected = rejectedKeys(ledger);
  const out = { tokens: [], assets: [], human: [], skipped: [] };

  for (const f of findings) {
    const key = `${f.region}:${f.defect}:${f.fix.token ?? f.fix.assetId ?? f.fix.file}`;
    // Hukommelse på tværs af iterationer: et fund, accept-porten allerede har
    // afvist, foreslås igen af dommeren hver gang, fordi symptomet stadig er
    // der. Uden denne kontrol bruger sløjfen hver iteration på samme døde idé.
    if (rejected.has(key)) { out.skipped.push({ ...f, key, why: "tidligere afvist af accept-porten" }); continue; }

    if (NEVER_TOKEN.has(f.defect) && f.fix.kind === "token") {
      out.human.push({ ...f, key, why: `defekt "${f.defect}" kan ikke løses med et token` });
    } else if (f.fix.kind === "token") {
      out.tokens.push({ ...f, key });
    } else if (f.fix.kind === "asset") {
      out.assets.push({ ...f, key });
    } else {
      out.human.push({ ...f, key });
    }
  }
  // Dedupér på tværs af regioner FØR sortering: samme --token fra to
  // regioner er ét fund med den højeste severity (TASK-021).
  out.tokens = consolidateTokens(out.tokens);
  // Værste først: alvorlighed er dommerens eneste prioriteringssignal.
  out.tokens.sort((a, b) => b.severity - a.severity);
  return out;
}

/**
 * Skriver de vindende tokens til tuning.css. `tuningPath`/`backupPath` er
 * injicerbare (default: de rigtige stier), så loop.mjs's tests kan pege dem
 * på en testmappe og ALDRIG røre den rigtige src/ui/tuning.css. Se REQ-004.
 */
export function writeTuning(tokens, iteration, { tuningPath = TUNING, backupPath = BACKUP } = {}) {
  const existing = fs.existsSync(tuningPath) ? fs.readFileSync(tuningPath, "utf8") : "";
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, existing); // så --revert altid kan komme tilbage

  const prior = new Map();
  for (const m of existing.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) prior.set(m[1], m[2].trim());
  // Højeste severity vinder — se resolveTokenWinners(). Beregnes her igen
  // (billigt, og gør writeTuning korrekt uanset om kalderen allerede har
  // dedupleret), så funktionen ikke er afhængig af at route() gjorde det.
  const winners = resolveTokenWinners(tokens);
  for (const [token, t] of winners) {
    // Sidste værn FØR skrivning til disk. Selv hvis et opstrøms
    // valideringstrin (judge.mjs's retry-gate, apply.mjs's egen validate())
    // skulle glippe, skriver denne funktion ALDRIG en usikker værdi — den
    // eneste fil sløjfen må røre, skal også være den sværeste at misbruge.
    const unsafe = safeCssValueErrors(t.fix.to);
    if (unsafe.length) {
      throw new Error(`writeTuning: usikker værdi til ${token} afvist: ${unsafe.join("; ")}`);
    }
    prior.set(token, t.fix.to);
  }

  const lines = [...prior.entries()].map(([k, v]) => {
    const t = winners.get(k);
    return t ? `  ${k}: ${v}; /* ${t.region}/${t.defect} — iter ${iteration} */` : `  ${k}: ${v};`;
  });

  fs.writeFileSync(tuningPath, [
    "/* Genereret af den visuelle sløjfe — rediger ikke i hånden.",
    " * Kun :root-tokenoverstyringer. Alt andet ruteres til asset-queue.json",
    " * eller human-queue.json. Se plan/architecture-visual-judge-1.md REQ-004.",
    ` * Sidst skrevet: iteration ${iteration}, ${new Date().toISOString()} */`,
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n"));
}

export function appendQueue(file, items, iteration) {
  if (!items.length) return 0;
  const q = readJson(file, { version: 1, items: [] });
  const seen = new Set(q.items.map((i) => i.key));
  let added = 0;
  for (const it of items) {
    if (seen.has(it.key)) continue;
    q.items.push({
      key: it.key, region: it.region, defect: it.defect, severity: it.severity,
      evidence: it.evidence, fix: it.fix, why: it.why ?? null,
      firstSeen: new Date().toISOString().slice(0, 10), iteration, status: "open",
    });
    added++;
  }
  q.items.sort((a, b) => b.severity - a.severity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(q, null, 2) + "\n");
  return added;
}

/**
 * Samme regionsantal-vægtede formel som metrics.py's globale `overall`-felt
 * (se metrics.py's main()), men afgrænset til de EFTERSPURGTE skærme.
 *
 * Hvorfor den findes (2. anmeldelse, blokerer 1): metrics.py scorer ALLE
 * registry-skærme hver kørsel, også dem der slet ikke blev optaget denne
 * gang (deres regioner får `missing:true`, overall 0). Det globale felt
 * vejer med REGIONSANTAL, ikke hvilke skærme der reelt blev bedt om — så en
 * ægte forbedring på ÉN skærm bliver fortyndet af de andre skærmes uændrede
 * nul-stubbe. Et `--screen title`-kørsel, der reelt forbedrer title markant,
 * kan derfor blive afvist af accept-porten, fordi game (aldrig optaget)
 * tæller med i nævneren. Denne funktion genskaber metrics.py's formel, men
 * kun over de skærme, sløjfen faktisk bad om denne kørsel.
 */
export function scopedOverall(scores, screenIds) {
  let weighted = 0;
  let weight = 0;
  for (const sid of screenIds) {
    const s = scores?.screens?.[sid];
    if (!s) continue; // efterspurgt skærm findes slet ikke i scores — spring stille over
    const regionCount = Object.keys(s.regions ?? {}).length;
    weighted += s.overall * regionCount;
    weight += regionCount;
  }
  return weight > 0 ? weighted / weight : 0;
}

/**
 * Accept-porten (CON-002). To betingelser, ikke én:
 *   1. samlet score skal stige (mere end støjgulvet)
 *   2. INGEN regions overall ELLER enkeltaspekt må falde mere end 0,02
 * Betingelse 2 er den, folk glemmer: uden per-aspekt-kontrollen kan sløjfen
 * ofre tone for struktur i SAMME region, mens aggregate-tallet skjuler det.
 *
 * `screenIds` (2. anmeldelse, blokerer 1, valgfri): når sløjfen kun kørte
 * ÉN skærm denne iteration, skal hverken gevinsten eller regressionsscanet
 * lade sig fortynde/forurene af de andre registry-skærmes uoptagne nul-
 * stubbe. Udeladt `screenIds` bevarer den gamle, globale opførsel uændret —
 * eksisterende kaldere, der scorer alle skærme, skal ikke ændre adfærd.
 */
export function acceptGate(before, after, { epsilon = 0.002, maxDrop = 0.02, screenIds = null } = {}) {
  // Fejl højlydt frem for at kaste TypeError midt i en sløjfe. En port, der
  // brækker i stedet for at fælde dom, lader ændringen passere uset.
  for (const [navn, v] of [["before", before], ["after", after]]) {
    if (typeof v?.overall !== "number") {
      throw new Error(`acceptGate: ${navn}.overall mangler — scores.json er fra en ældre metrics.py`);
    }
  }
  const gain = screenIds
    ? -normalizedDrop(scopedOverall(before, screenIds), scopedOverall(after, screenIds))
    : -normalizedDrop(before.overall, after.overall);
  const regressions = collectScoreRegressions(before, after, { maxDrop, screenIds });
  const accepted = gain > epsilon && regressions.length === 0;
  return {
    accepted, gain, regressions,
    why: accepted ? "samlet fremgang uden regression"
      : regressions.length ? `regression i ${regressions.map((r) => r.region).join(", ")}`
      : `for lille fremgang (${gain.toFixed(4)} ≤ ${epsilon})`,
  };
}

/**
 * Genskaber tuning.css fra dens backup. `tuningPath`/`backupPath` er
 * injicerbare (default: de gamle globale filer, for bagudkompatibilitet),
 * så både loop.mjs's krak-sikring og CLI'ens `--run`/`--backup`-flag kan
 * pege den på PRÆCIS den kørsels backup, og aldrig en løsrevet global fil.
 * Se REQ-004 og 2. anmeldelse, blokerer 2.
 */
export function revert({ tuningPath = TUNING, backupPath = BACKUP } = {}) {
  if (!fs.existsSync(backupPath)) return false;
  fs.writeFileSync(tuningPath, fs.readFileSync(backupPath, "utf8"));
  return true;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--revert")) {
    // 2. anmeldelse, blokerer 2: løkken skriver PR-KØRSEL-backups
    // (<runDir>/tuning.prev.css), aldrig den gamle globale .judge/tuning.prev.css.
    // Uden disse flag ville --revert gendanne en løsrevet, forældet fil, der
    // intet har med den seneste kørsel at gøre.
    const runIdx = argv.indexOf("--run");
    const backupIdx = argv.indexOf("--backup");
    const opts = {};
    if (runIdx !== -1) opts.backupPath = path.resolve(ROOT, argv[runIdx + 1], "tuning.prev.css");
    if (backupIdx !== -1) opts.backupPath = path.resolve(argv[backupIdx + 1]); // eksplicit sti vinder over --run
    console.log(revert(opts) ? "tuning.css rullet tilbage" : "ingen backup at rulle tilbage til");
    return;
  }
  const fIdx = argv.indexOf("--findings");
  if (fIdx === -1) { console.error("brug: --findings <fil.json> [--dry]"); process.exit(2); }
  const dry = argv.includes("--dry");

  const registry = readJson(REGISTRY, { screens: [] });
  const known = new Set(registry.screens.flatMap((s) => s.regions.map((r) => r.id)));
  const doc = readJson(path.resolve(argv[fIdx + 1]), null);

  const errs = validate(doc, known);
  if (errs.length) {
    // Et ugyldigt fund anvendes ALDRIG delvist. Dommeren er en sandsynlig-
    // hedsmaskine; skemaet er det eneste sted, dens output faktisk stoppes.
    console.error(`✗ ${errs.length} skemafejl — intet anvendt:`);
    errs.forEach((e) => console.error("  · " + e));
    process.exit(1);
  }

  const ledger = readJson(LEDGER, { iterations: [], rejected: [] });
  const iteration = (ledger.iterations.length ?? 0) + 1;
  const r = route(doc.findings, ledger);

  console.log(`iteration ${iteration} · ${doc.findings.length} fund`);
  console.log(`  token   → tuning.css        ${r.tokens.length}`);
  console.log(`  asset   → asset-queue.json  ${r.assets.length}`);
  console.log(`  struktur→ human-queue.json  ${r.human.length}`);
  if (r.skipped.length) console.log(`  sprunget over (tidligere afvist)  ${r.skipped.length}`);

  if (dry) { r.tokens.forEach((t) => console.log(`    ${t.fix.token}: ${t.fix.to}  (${t.region}/${t.defect})`)); return; }

  const a = appendQueue(ASSET_QUEUE, r.assets, iteration);
  const h = appendQueue(HUMAN_QUEUE, r.human, iteration);
  if (r.tokens.length) writeTuning(r.tokens, iteration);

  ledger.iterations.push({
    n: iteration, at: new Date().toISOString(), screen: doc.screen,
    applied: r.tokens.map((t) => t.key), queuedAssets: a, queuedHuman: h,
    skipped: r.skipped.length, verdict: "pending",
  });
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

  console.log(r.tokens.length
    ? "→ tuning.css skrevet. Kør scoring igen og lad accept-porten dømme."
    : "→ ingen tokenændringer; alt krævede kunst eller et menneske.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
