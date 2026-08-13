#!/usr/bin/env node
/**
 * Projektets ledestjerne-tal: hvor stor en andel af de fiaskoer spillerne
 * faktisk møder, har en replik skrevet om præcis det par?
 *
 * Det er IKKE "hvor mange par er dækket". 790 par mødes nogensinde, men de
 * mødes vildt ujævnt — det hyppigste 762 gange på 1.200 gennemspilninger, de
 * nederste én gang hver. Et gennemsnit pr. par ville skjule det. Her vejes
 * hvert par med hvor ofte det faktisk mødes, så tallet svarer på det eneste
 * spørgsmål der betyder noget: hvor ofte hører en spiller den gode replik?
 *
 * Opslaget sker på par + dom, som i motoren. Et par hvis dominerende dom er
 * bagt, men som denne gang blev mødt i en anden spiltilstand og fik en anden
 * dom, tæller derfor som udækket — fordi det ér udækket. Det er hele grunden
 * til at nøglen indeholder dommen.
 *
 * Kør: node tools/coverage_report.mjs [--write]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bakedLookupKeys } from "./pair_lookup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const freq = read("docs/design/pair-frequency.json");
const baked = read("content/narrator/pairs-act-1.json");
const bakedKeys = bakedLookupKeys(baked);

let total = 0;
let covered = 0;
let bakedPairsMet = 0;
/** Par hvor den bagte dom findes, men hvor en anden dom også optræder. */
let minoritySpill = 0;
const uncovered = [];

for (const p of freq.pairs) {
  const hist = p.verdicts ?? { [p.verdict]: p.met };
  let pairCovered = 0;
  let pairTotal = 0;
  for (const [verdict, count] of Object.entries(hist)) {
    total += count;
    pairTotal += count;
    if (bakedKeys.has(`${p.key}:${verdict}`)) {
      covered += count;
      pairCovered += count;
    }
  }
  if (pairCovered > 0) {
    bakedPairsMet += 1;
    minoritySpill += pairTotal - pairCovered;
  } else {
    uncovered.push({ key: p.key, met: pairTotal, verdict: p.verdict });
  }
}

const pct = (n) => ((n / total) * 100).toFixed(1);
uncovered.sort((a, b) => b.met - a.met);

const lines = [
  "# Dækning: hvor ofte hører spilleren den gode replik?",
  "",
  `Målt ${freq.runs ?? "?"} gennemspilninger, ${freq.pairs.length} forskellige par mødt.`,
  "",
  "| | antal møder | andel |",
  "|---|---:|---:|",
  `| **Bagt replik** | ${covered} | **${pct(covered)} %** |`,
  `| Grammatik | ${total - covered} | ${pct(total - covered)} % |`,
  `| Tavshed | 0 | 0,0 % |`,
  "",
  `${bakedPairsMet} par har en bagt replik. Af de møder de par indgår i, `,
  `falder ${minoritySpill} (${pct(minoritySpill)} % af alle møder) tilbage til `,
  "grammatikken, fordi parret den gang fik en anden dom end den bagte. Det er",
  "med vilje: en bagt replik om at spilleren var tæt på må ikke lyde, når",
  "dommen er en anden.",
  "",
  "## De ti hyppigste par uden bagt replik",
  "",
  "| par | møder | dom |",
  "|---|---:|---|",
  ...uncovered.slice(0, 10).map((u) => `| ${u.key} | ${u.met} | ${u.verdict} |`),
  "",
  `_Genereret af \`node tools/coverage_report.mjs --write\`._`,
  "",
];

console.log(`bagt      ${covered} møder — ${pct(covered)} %`);
console.log(`grammatik ${total - covered} møder — ${pct(total - covered)} %`);
console.log(`tavshed   0 møder — 0,0 %`);
console.log(`${bakedPairsMet} par bagt, ${uncovered.length} par uden.`);

if (process.argv.includes("--write")) {
  const out = "docs/design/narration-coverage.md";
  writeFileSync(resolve(ROOT, out), lines.join("\n"));
  console.log(`skrev ${out}`);
}
