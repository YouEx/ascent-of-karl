/**
 * Måler om fortælleren gentager sig selv INDE I ét gennemspil.
 *
 * check_pairs passer på den enkelte replik, og coverage_report tæller hvor
 * mange møder der har en bagt replik. Ingen af dem kan se det, en spiller
 * faktisk lægger mærke til: at den samme vending kommer igen tyve ture senere.
 * Det er ikke en egenskab ved filen, det er en egenskab ved ét run — derfor
 * skal det måles ved at spille, ikke ved at læse.
 *
 * Kørsel: npx vite-node tools/echo_report.ts
 */

import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import pairsAct1 from "../content/narrator/pairs-act-1.json";

const content = loadContent();
const RUNS = 200;
const TURNS = 50;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Ordvinduer på fem — kort nok til at fange en vending, langt nok til ikke at fange grammatik. */
function ngrams(text: string, n = 5): string[] {
  const w = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

const perRun: { heard: number; distinct: number; echoes: number }[] = [];
const echoPhrases = new Map<string, number>();
const echoByVerdict = new Map<string, { heard: number; echoed: number }>();

for (let run = 0; run < RUNS; run++) {
  const rand = rng(run * 7919 + 13);
  const e = new Engine(content);
  const n = new Narrator(e);
  n.attachPairs(pairsAct1 as never);

  const heard: string[] = [];
  const seenGrams = new Set<string>();
  let echoes = 0;

  for (let page = 0; page < TURNS; page++) {
    if (e.activeEnding()) break;
    const pool = e.availableElements().map((x) => x.id);
    const a = pool[Math.floor(rand() * pool.length)]!;
    const b = pool[Math.floor(rand() * pool.length)]!;
    const out = e.combine(a, b);
    const said = n.react(a, b, out, 4000);
    if (!said) continue;
    const text = said.text;
    heard.push(text);

    const verdict = out.kind === "nofuse" ? out.verdict : out.kind;
    const v = echoByVerdict.get(verdict) ?? { heard: 0, echoed: 0 };
    v.heard++;

    // Et ekko er en vending spilleren allerede har hørt i DETTE run.
    let echoedHere = false;
    for (const g of ngrams(text)) {
      if (seenGrams.has(g)) {
        if (!echoedHere) echoes++;
        echoedHere = true;
        echoPhrases.set(g, (echoPhrases.get(g) ?? 0) + 1);
      }
      seenGrams.add(g);
    }
    if (echoedHere) v.echoed++;
    echoByVerdict.set(verdict, v);
  }

  perRun.push({ heard: heard.length, distinct: new Set(heard).size, echoes });
}

const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
const heard = med(perRun.map((r) => r.heard));
const distinct = med(perRun.map((r) => r.distinct));
const echoes = med(perRun.map((r) => r.echoes));

console.log(`${RUNS} gennemspil, ${TURNS} ture hver\n`);
console.log(`replikker hørt pr. run (median)      ${heard}`);
console.log(`heraf ordret forskellige             ${distinct}`);
console.log(`replikker der genbruger en vending   ${echoes}  (${((echoes / heard) * 100).toFixed(0)} % af alt spilleren hører)\n`);

console.log("pr. dom — hvor tit lyder en genbrugt vending:");
const rows = [...echoByVerdict.entries()].sort((a, b) => b[1].heard - a[1].heard);
for (const [verdict, v] of rows) {
  const pct = ((v.echoed / v.heard) * 100).toFixed(0);
  console.log(`  ${verdict.padEnd(11)} ${String(v.heard).padStart(6)} hørt   ${pct.padStart(3)} % med ekko`);
}

console.log("\nde ti vendinger spillerne hører igen og igen:");
for (const [g, n2] of [...echoPhrases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ×${String(n2).padEnd(5)} ${g}`);
}
