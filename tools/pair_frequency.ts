/**
 * Måler hvilke par spillerne FAKTISK møder — og hvad de får at vide.
 *
 * Bagte replikker er dyre at skrive og skal derfor lægges dér hvor de bliver
 * hørt. Hvilke par det er, kan ikke gættes: det afhænger af hvad motoren
 * lader spilleren opdage hvornår, og i hvilken rækkefølge. Så vi spiller
 * spillet mange gange og tæller.
 *
 * Tre spillestile, fordi fordelingen afhænger af hvem der spiller, og en
 * bagning der kun passer én stil rammer forbi de andre:
 *   blind      — mikser tilfældigt (den utålmodige)
 *   nysgerrig  — foretrækker det nyeste fund (den typiske)
 *   grundig    — arbejder sig systematisk gennem hånden (den metodiske)
 *
 * Kørsel: npm run pairs
 * Skriver docs/design/pair-frequency.json og printer dækningskurven.
 */

import { writeFileSync } from "node:fs";
import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import { judgePair } from "../src/core/verdict";
import type { ElementDef, Verdict } from "../src/core/types";

const content = loadContent();
const RUNS_PER_STYLE = 400;

type Style = "blind" | "nysgerrig" | "grundig";
const STYLES: Style[] = ["blind", "nysgerrig", "grundig"];

/** Lille deterministisk RNG, så rapporten er den samme hver gang. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pickPair(
  style: Style,
  pool: readonly string[],
  rand: () => number,
  page: number,
): [string, string] {
  const n = pool.length;
  if (style === "nysgerrig") {
    // Nye fund frister mest. Halvdelen af trækkene rører de 6 nyeste.
    const fresh = pool.slice(Math.max(0, n - 6));
    const a = rand() < 0.5 ? fresh[Math.floor(rand() * fresh.length)]! : pool[Math.floor(rand() * n)]!;
    const b = pool[Math.floor(rand() * n)]!;
    return [a, b];
  }
  if (style === "grundig") {
    // Gennemgår hånden parvist i rækkefølge — den metodiske spiller.
    const a = pool[page % n]!;
    const b = pool[Math.floor(page / n + rand() * 3) % n]!;
    return [a, b];
  }
  return [pool[Math.floor(rand() * n)]!, pool[Math.floor(rand() * n)]!];
}

/** Uordnet nøgle, så sten+græs og græs+sten er samme par. */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}+${b}` : `${b}+${a}`;
}

interface Row {
  key: string;
  a: string;
  b: string;
  met: number;
  byStyle: Record<Style, number>;
  /** Dommen kan skifte mellem gennemspilninger — parret mødes i forskellig
   *  tilstand. Vi tæller dem alle og bager kun for den dominerende. */
  verdicts: Record<string, number>;
}

const rows = new Map<string, Row>();
let totalFailures = 0;
let totalAttempts = 0;

for (const style of STYLES) {
  for (let run = 0; run < RUNS_PER_STYLE; run++) {
    const e = new Engine(content);
    const n = new Narrator(e);
    const rand = rng(run * 7919 + STYLES.indexOf(style) * 104729 + 17);
    for (let page = 1; page <= 400; page++) {
      if (e.getState().ended) break;
      const pool = e.getState().discovered;
      const [a, b] = pickPair(style, pool, rand, page);
      const out = e.combine(a, b);
      n.react(a, b, out, 4000);
      totalAttempts++;
      if (out.kind !== "nofuse") continue;
      totalFailures++;
      const key = pairKey(a, b);
      let row = rows.get(key);
      if (!row) {
        const [x, y] = a <= b ? [a, b] : [b, a];
        row = { key, a: x!, b: y!, met: 0, byStyle: { blind: 0, nysgerrig: 0, grundig: 0 }, verdicts: {} };
        rows.set(key, row);
      }
      const { verdict } = judgePair(e, e.element(a), e.element(b));
      row.verdicts[verdict] = (row.verdicts[verdict] ?? 0) + 1;
      row.met++;
      row.byStyle[style]++;
    }
  }
}

// Rangér efter hvor mange stilarter der møder parret, dernæst hyppighed. Et par
// alle tre stilarter rammer er mere værd end et ét enkelt spillemønster elsker.
const ranked = [...rows.values()].sort((p, q) => {
  const breadth = (r: Row) => STYLES.filter((s) => r.byStyle[s] > 0).length;
  return breadth(q) - breadth(p) || q.met - p.met;
});

const cum: number[] = [];
let sum = 0;
for (const r of ranked) {
  sum += r.met;
  cum.push(sum);
}
const share = (n: number) => ((cum[Math.min(n, cum.length) - 1] ?? 0) / totalFailures) * 100;

console.log(`spil: ${RUNS_PER_STYLE * STYLES.length} runs i ${STYLES.length} stilarter`);
console.log(`forsøg: ${totalAttempts}  fiaskoer: ${totalFailures} (${((totalFailures / totalAttempts) * 100).toFixed(1)} %)`);
console.log(`forskellige par mødt: ${ranked.length} af 17.578 mulige\n`);
console.log("dækningskurve (andel af alle fiasko-møder):");
for (const n of [50, 100, 200, 300, 400, 500, 600, 800, 1000, 1500]) {
  if (n > ranked.length) break;
  const bar = "█".repeat(Math.round(share(n) / 2.5));
  console.log(`  top ${String(n).padStart(4)}: ${share(n).toFixed(1).padStart(5)} %  ${bar}`);
}

const dominant = (r: Row) =>
  (Object.entries(r.verdicts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "plausible") as Verdict;
const dominantShare = (r: Row) => Math.max(...Object.values(r.verdicts)) / r.met;

const byVerdict = new Map<Verdict, number>();
for (const r of rows.values())
  for (const [v, c] of Object.entries(r.verdicts))
    byVerdict.set(v as Verdict, (byVerdict.get(v as Verdict) ?? 0) + c);
console.log("\nfiasko-møder pr. dom:");
for (const [v, c] of [...byVerdict].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${v.padEnd(10)} ${((c / totalFailures) * 100).toFixed(1).padStart(5)} %`);
}

const el = (id: string): ElementDef => content.elements.find((x) => x.id === id)!;
const out = {
  _: "Målt med tools/pair_frequency.ts (npm run pairs). Rangeret efter hvor "
    + "mange spillestile der møder parret, dernæst hyppighed.",
  runs: RUNS_PER_STYLE * STYLES.length,
  styles: STYLES,
  totalAttempts,
  totalFailures,
  distinctPairs: ranked.length,
  coverage: Object.fromEntries(
    [100, 200, 300, 400, 500, 600, 800, 1000].map((n) => [n, Number(share(n).toFixed(1))]),
  ),
  pairs: ranked.map((r) => ({
    key: r.key,
    a: r.a,
    b: r.b,
    met: r.met,
    styles: STYLES.filter((s) => r.byStyle[s] > 0).length,
    verdict: dominant(r),
    verdictShare: Number((dominantShare(r) * 100).toFixed(0)),
    verdicts: r.verdicts,
    aName: el(r.a).name,
    bName: el(r.b).name,
  })),
};
writeFileSync("docs/design/pair-frequency.json", JSON.stringify(out, null, 2) + "\n");
const shifting = ranked.slice(0, 250).filter((r) => Object.keys(r.verdicts).length > 1).length;
console.log(`\ntop 250: ${250 - shifting} par har én dom hele vejen, ${shifting} skifter`);
console.log(`(vi bager kun for den dominerende dom — resten falder til grammatikken)`);
console.log(`\n✅ docs/design/pair-frequency.json (${ranked.length} par)`);
