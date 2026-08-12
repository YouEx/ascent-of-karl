/**
 * Måler om fortælleren stadig peger, EFTER de tre nøder er løst.
 *
 * Martins klage var ikke, at der manglede replikker — det var, at der ikke var
 * nogen retning. Han løste alle tre nøder og spillede derefter tredive somre
 * uden ét vink. Det tal kan hverken coverage_report eller playability se: de
 * tæller møder og tempo, ikke om spilleren fik at vide, hvad han skulle.
 *
 * Kørsel: npx vite-node tools/guidance_report.ts
 */

import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import pairsAct1 from "../content/narrator/pairs-act-1.json";

const content = loadContent();
const RUNS = 300;
const TURNS = 50;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Alle hint-replik-id'er i akten. `hints` holder id'er, ikke tekst. */
const hintIds = new Set<string>();
for (const act of content.acts) {
  for (const p of act.problems) for (const h of p.hints ?? []) hintIds.add(h);
}

let runsNaaedeTre = 0;
const guidedEfter: number[] = [];
const tureEfter: number[] = [];
let hintsIalt = 0;
let hintsEfterTre = 0;

for (let run = 0; run < RUNS; run++) {
  const rand = rng(run * 7919 + 13);
  const e = new Engine(content);
  const n = new Narrator(e);
  n.attachPairs(pairsAct1 as never);

  let treLoest = -1;
  let hintsHer = 0;
  let hintsEfterHer = 0;
  let tureEfterHer = 0;

  for (let page = 0; page < TURNS; page++) {
    if (e.activeEnding()) break;
    const pool = e.availableElements().map((x) => x.id);
    const a = pool[Math.floor(rand() * pool.length)]!;
    const b = pool[Math.floor(rand() * pool.length)]!;
    const said = n.react(a, b, e.combine(a, b), 4000);

    const erHint = said ? hintIds.has(said.id) : false;
    if (erHint) hintsHer++;
    if (treLoest >= 0) {
      tureEfterHer++;
      if (erHint) hintsEfterHer++;
    }
    if (treLoest < 0 && e.unsolvedRequiredProblems().length === 0) treLoest = page;
  }

  hintsIalt += hintsHer;
  if (treLoest >= 0 && tureEfterHer > 0) {
    runsNaaedeTre++;
    hintsEfterTre += hintsEfterHer;
    guidedEfter.push(hintsEfterHer);
    tureEfter.push(tureEfterHer);
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
console.log(`${RUNS} gennemspil\n`);
console.log(`vink i alt                        ${hintsIalt}  (${(hintsIalt / RUNS).toFixed(2)} pr. run)`);
console.log(`runs der løste alle tre nøder     ${runsNaaedeTre}`);
if (runsNaaedeTre > 0) {
  console.log(`ture spillet EFTER den tredje     ${sum(tureEfter)}  (${(sum(tureEfter) / runsNaaedeTre).toFixed(1)} pr. run)`);
  console.log(`vink givet EFTER den tredje       ${hintsEfterTre}  (${(hintsEfterTre / runsNaaedeTre).toFixed(2)} pr. run)`);
  const tavse = guidedEfter.filter((x) => x === 0).length;
  console.log(`runs uden ét vink efter de tre    ${tavse} af ${runsNaaedeTre}  (${((tavse / runsNaaedeTre) * 100).toFixed(0)} %)`);
}
