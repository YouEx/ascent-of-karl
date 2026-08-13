/**
 * Fælles valideringslag mellem en vision-model og resten af sløjfen.
 *
 * To slags kontrol, lag på lag:
 *   1. SKEMAFORM — udledt direkte af finding.schema.json ved indlæsning, ikke
 *      en håndkopieret parallel liste. Det lukkede defekt-ordforråd,
 *      evidence-mønsteret og de tre fix-formers påkrævede felter læses fra
 *      selve skemafilen, så en fremtidig rettelse af skemaet ikke kan glide
 *      fra en glemt kopi i denne fil. Se REQ-006.
 *   2. RUNTIME-fakta skemaet ikke kan kende: findes regionen i DENNE skærms
 *      registry? findes tokenet i tokens.css/tuning.css? giver `from` mening
 *      i lyset af den faktiske nuværende værdi (eller er målet hallucineret)?
 *      er `to` en sikker, enkelt CSS-værdi — aldrig eksekverbar/vilkårlig CSS?
 *
 * Bruges af judge.mjs (streng gate på modellens rå output, med retry) og af
 * apply.mjs (deler det lukkede ordforråd, så de to aldrig kan glide fra
 * hinanden — se TASK-021's revisionsnote om præcis den slags drift).
 *
 * Se plan/architecture-visual-judge-1.md REQ-005, REQ-006, TASK-018/019/020.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_PATH = path.join(ROOT, "tools/judge/finding.schema.json");
const DEFAULT_TOKENS_CSS = path.join(ROOT, "src/ui/tokens.css");
const DEFAULT_TUNING_CSS = path.join(ROOT, "src/ui/tuning.css");

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const FINDING_DEF = schema.definitions.finding;
const FIX_DEFS = { token: "tokenFix", asset: "assetFix", structure: "structureFix" };

/** Det lukkede defekt-ordforråd — udledt af skemaets egen enum, ikke en
 *  parallel kopi. Se finding.schema.json's $comment for hvorfor lukket. */
export const DEFECTS = new Set(FINDING_DEF.properties.defect.enum);

/** Defekter der pr. definition ikke kan rettes med et token, uanset hvad
 *  modellen foreslår. Ren rutningsregel — findes ikke i skemaet, for skemaet
 *  kender kun FORMEN af et fund, ikke hvad ruteren gør med det bagefter. */
export const NEVER_TOKEN = new Set(["missing-asset", "extra-element", "state-mismatch"]);

// --------------------------------------------------------- CSS-sikkerhed

/** Kun disse tegn er tilladt i en modelforeslået tokenværdi. Bevidst uden
 *  `:`, `;`, `{`, `}`, `@`, `!`, backtick, `$`, `\`, `<`, `>` — hverken en
 *  ny deklaration, et nyt regelsæt, en at-regel eller en kommentarstart
 *  (`/` alene er tilladt for `1px/1.4`, men `*` er det ikke, så `/* … *\/`
 *  ikke kan dannes) kan bygges af tegn i dette sæt alene. */
const CSS_VALUE_CHARSET = /^[A-Za-z0-9 .%#\-+,()/'"]*$/;

const CSS_VALUE_BANNED = [
  [/url\s*\(/i, "url() er ikke tilladt — et manglende aktiv ryger i asset-queue.json, ikke i et token"],
  [/!important/i, "!important er ikke tilladt"],
  [/expression\s*\(/i, "expression() er ikke tilladt"],
  [/javascript:/i, "javascript: er ikke tilladt"],
  [/[;{}@]/, "semikolon, krøllede parenteser eller at-regler er ikke tilladt i en tokenværdi"],
];

/** Alle grunde til at afvise en foreslået tokenværdi. Tom liste = sikker.
 *  Se TASK-019/020: modellens `to` må ALDRIG kunne bryde ud af den ene
 *  `--token: <værdi>;`-linje, den skrives ind i. */
export function safeCssValueErrors(value) {
  const errs = [];
  if (typeof value !== "string" || value.trim() === "") {
    errs.push("tokenværdien mangler eller er tom");
    return errs;
  }
  for (const [re, msg] of CSS_VALUE_BANNED) {
    if (re.test(value)) errs.push(msg);
  }
  if (!CSS_VALUE_CHARSET.test(value)) {
    errs.push("tokenværdien indeholder tegn uden for det tilladte sæt (bogstaver, tal, mellemrum og . % # - + , ( ) / ' \")");
  }
  return errs;
}

export function isSafeCssValue(value) {
  return safeCssValueErrors(value).length === 0;
}

// ------------------------------------------------- hallucineret mål?

function parseColor(v) {
  const s = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = m[1];
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const n = m[1];
    return [0, 1, 2].map((i) => parseInt(n[i] + n[i], 16));
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return [1, 2, 3].map((i) => parseFloat(m[i]));
  return null;
}

function parseNumeric(v) {
  const m = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(v.trim());
  return m ? { value: parseFloat(m[1]), unit: (m[2] || "").toLowerCase() } : null;
}

/**
 * Giver `from` mening i lyset af den FAKTISKE nuværende værdi? Tolerant over
 * for format (hex mod rgb(), afrundingsstøj i tal) — men et mål der reelt er
 * en anden farve eller en anden enhed er formentlig hallucineret, ikke målt.
 */
export function matchesCurrentValue(from, current, { colorTolerance = 6, numericTolerance = 1 } = {}) {
  if (typeof from !== "string" || typeof current !== "string") return false;
  const a = from.trim();
  const b = current.trim();
  if (a.toLowerCase() === b.toLowerCase()) return true;

  const ca = parseColor(a);
  const cb = parseColor(b);
  if (ca && cb) return ca.every((v, i) => Math.abs(v - cb[i]) <= colorTolerance);

  const na = parseNumeric(a);
  const nb = parseNumeric(b);
  if (na && nb && na.unit === nb.unit) return Math.abs(na.value - nb.value) <= numericTolerance;

  return false;
}

/** Læser kendte `--token: værdi;`-par fra tokens.css og (hvis den findes)
 *  tuning.css. tuning.css importeres SIDST (TASK-022), så dens værdi vinder
 *  ved overlap — nøjagtig den kaskade browseren selv anvender. */
export function loadKnownTokens(tokensPath = DEFAULT_TOKENS_CSS, tuningPath = DEFAULT_TUNING_CSS) {
  const map = new Map();
  for (const p of [tokensPath, tuningPath]) {
    const full = path.isAbsolute(p) ? p : path.join(ROOT, p);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, "utf8");
    for (const m of content.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
      map.set(m[1], m[2].trim());
    }
  }
  return map;
}

// --------------------------------------------------- skemaform (generisk)

/** Tjekker én værdi mod ét skema-underobjekt. Dækker netop de nøgleord,
 *  denne ene skemafil bruger (const, enum, integer+min/max, string+
 *  minLength+pattern) — ikke en generel JSON-Schema-motor, men direkte
 *  drevet af de faktiske felter i finding.schema.json. */
function checkAgainstDef(value, def, at, errs) {
  if (def.const !== undefined) {
    if (value !== def.const) errs.push(`${at} skal være "${def.const}", fik "${value}"`);
    return;
  }
  if (def.enum) {
    if (!def.enum.includes(value)) errs.push(`${at} "${value}" er uden for det lukkede ordforråd`);
    return;
  }
  if (def.type === "integer") {
    if (!Number.isInteger(value)) { errs.push(`${at} skal være et heltal`); return; }
    if (def.minimum !== undefined && value < def.minimum) errs.push(`${at} skal være mindst ${def.minimum}`);
    if (def.maximum !== undefined && value > def.maximum) errs.push(`${at} skal være højst ${def.maximum}`);
    return;
  }
  // Resten er strengfelter (evt. med minLength/pattern) — evidence, spec,
  // change, token, from, to falder alle her.
  if (typeof value !== "string") { errs.push(`${at} skal være tekst`); return; }
  if (def.minLength !== undefined && value.length < def.minLength) {
    errs.push(`${at} er for kort (min. ${def.minLength} tegn, fik ${value.length})`);
  }
  if (def.pattern && !new RegExp(def.pattern).test(value)) {
    errs.push(`${at} matcher ikke det påkrævede mønster (${def.pattern})`);
  }
}

/** Validerer `fix` som en diskrimineret union på `fix.kind`, mod den
 *  matchende definition i skemaet (tokenFix/assetFix/structureFix).
 *  Returnerer fix.kind, eller null hvis fix slet ikke kunne bedømmes. */
function validateFix(fix, at, errs) {
  if (!fix || typeof fix !== "object") { errs.push(`${at} mangler`); return null; }
  const defName = FIX_DEFS[fix.kind];
  if (!defName) { errs.push(`${at}.kind "${fix.kind}" er ukendt`); return null; }
  const def = schema.definitions[defName];
  const propNames = Object.keys(def.properties ?? {});

  for (const key of Object.keys(fix)) {
    if (!propNames.includes(key)) errs.push(`${at}.${key} er ikke en tilladt egenskab i en ${fix.kind}-rettelse`);
  }
  for (const req of def.required ?? []) {
    if (fix[req] === undefined) errs.push(`${at}.${req} mangler`);
  }
  for (const [propName, propDef] of Object.entries(def.properties ?? {})) {
    if (fix[propName] !== undefined) checkAgainstDef(fix[propName], propDef, `${at}.${propName}`, errs);
  }
  return fix.kind;
}

/**
 * Validerer ét fund: skemaform (fra finding.schema.json) OG runtime-fakta
 * (fra `context`). `context = { knownRegions: Set<string>, knownTokens:
 * Map<string,string> }` — begge er skærm-/tilstandsafhængige og kan derfor
 * ikke stå i selve skemaet.
 */
function validateOneFinding(finding, index, context, errs) {
  const at = `findings[${index}]`;
  if (!finding || typeof finding !== "object") { errs.push(`${at} er ikke et objekt`); return; }

  const allowedKeys = Object.keys(FINDING_DEF.properties);
  for (const key of Object.keys(finding)) {
    if (!allowedKeys.includes(key)) errs.push(`${at}.${key} er ikke en tilladt egenskab`);
  }
  for (const req of FINDING_DEF.required) {
    if (finding[req] === undefined) errs.push(`${at}.${req} mangler`);
  }

  // region: skemaet kender kun typen; det lukkede sæt er registry.json's,
  // som er skærm-specifikt og derfor leveres via context.
  if (finding.region !== undefined) {
    if (typeof finding.region !== "string") errs.push(`${at}.region skal være tekst`);
    else if (context.knownRegions && !context.knownRegions.has(finding.region)) {
      errs.push(`${at}.region "${finding.region}" findes ikke i registry`);
    }
  }
  if (finding.defect !== undefined) checkAgainstDef(finding.defect, FINDING_DEF.properties.defect, `${at}.defect`, errs);
  if (finding.severity !== undefined) checkAgainstDef(finding.severity, FINDING_DEF.properties.severity, `${at}.severity`, errs);
  if (finding.evidence !== undefined) checkAgainstDef(finding.evidence, FINDING_DEF.properties.evidence, `${at}.evidence`, errs);

  if (finding.fix === undefined) return; // "fix mangler" er allerede rapporteret ovenfor
  const kind = validateFix(finding.fix, `${at}.fix`, errs);
  if (kind !== "token") return;

  // Runtime-tjek der IKKE kan udtrykkes i JSON Schema.
  if (DEFECTS.has(finding.defect) && NEVER_TOKEN.has(finding.defect)) {
    errs.push(`${at}.fix: defekt "${finding.defect}" kan ikke rettes med et token`);
  }
  const token = finding.fix.token;
  if (context.knownTokens) {
    if (typeof token === "string" && !context.knownTokens.has(token)) {
      errs.push(`${at}.fix.token "${token}" findes ikke i tokens.css/tuning.css`);
    } else if (typeof finding.fix.from === "string" && context.knownTokens.has(token)) {
      const current = context.knownTokens.get(token);
      if (!matchesCurrentValue(finding.fix.from, current)) {
        errs.push(`${at}.fix.from "${finding.fix.from}" matcher ikke den nuværende værdi af ${token} ("${current}") — mistænkt hallucineret mål`);
      }
    }
  }
  if (typeof finding.fix.to === "string") {
    for (const e of safeCssValueErrors(finding.fix.to)) errs.push(`${at}.fix.to: ${e}`);
  }
}

/**
 * Validerer et helt findings-dokument (`{screen, findings[]}`) mod
 * finding.schema.json's semantik OG runtime-registry/token-fakta.
 * Returnerer en fejlliste; tom liste = gyldigt.
 */
export function validateFindings(doc, context = {}) {
  const errs = [];
  if (!doc || typeof doc !== "object") return ["dokumentet er ikke et objekt"];

  const topKeys = Object.keys(schema.properties);
  for (const key of Object.keys(doc)) {
    if (!topKeys.includes(key)) errs.push(`${key} er ikke en tilladt egenskab på øverste niveau`);
  }
  for (const req of schema.required) {
    if (doc[req] === undefined) errs.push(`${req} mangler`);
  }
  if (doc.screen !== undefined && typeof doc.screen !== "string") errs.push("screen skal være tekst");

  if (doc.findings === undefined) return errs;
  if (!Array.isArray(doc.findings)) { errs.push("findings er ikke en liste"); return errs; }
  doc.findings.forEach((f, i) => validateOneFinding(f, i, context, errs));
  return errs;
}
