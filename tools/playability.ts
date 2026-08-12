/**
 * Måler hvordan et run FØLES, ikke hvilke par det møder.
 *
 * pair_frequency tæller par. Den kan ikke se det, Martin klagede over: at
 * halvdelen af spillet gik med ingenting, at de tre nøder var løst længe før
 * somrene slap op, og at der ingenting var tilbage bagefter. Det er tempo, og
 * tempo kræver sine egne tal.
 *
 * Kørsel: npx vite-node tools/playability.ts
 */

import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";

const content = loadContent();
const RUNS_PER_STYLE = 200;
type Style = "blind" | "nysgerrig" | "grundig";
const STYLES: Style[] = ["blind", "nysgerrig", "grundig"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pickPair(style: Style, pool: readonly string[], rand: () => number, page: number): [string, string] {
  const n = pool.length;
  if (style === "nysgerrig") {
    const fresh = pool.slice(Math.max(0, n - 6));
    const a = rand() < 0.5 ? fresh[Math.floor(rand() * fresh.length)]! : pool[Math.floor(rand() * n)]!;
    return [a, pool[Math.floor(rand() * n)]!];
  }
  if (style === "grundig") {
    return [pool[page % n]!, pool[Math.floor(page / n + rand() * 3) % n]!];
  }
  return [pool[Math.floor(rand() * n)]!, pool[Math.floor(rand() * n)]!];
}

interface Run {
  style: Style;
  attempts: number;
  failures: number;
  discoveries: number;
  /** Tur nr. hvor hver obligatorisk nød blev løst — undefined hvis aldrig. */
  solvedAt: Record<string, number | undefined>;
  /** Tur nr. hvor den sidste obligatoriske nød faldt. */
  allSolvedAt?: number;
  /** Længste stribe af turer i træk uden et eneste fund. */
  longestDrought: number;
  ended: string | null;
  /** Hvor mange trusler nåede at dukke op i løbet af livet. */
  challenges: number;
}

const runs: Run[] = [];
const alle = (content.acts[0]!.problems ?? []) as { id: string; required?: boolean }[];
const required = alle.filter((p) => p.required).map((p) => p.id);
const valgfri = alle.filter((p) => !p.required).map((p) => p.id);

for (const style of STYLES) {
  for (let run = 0; run < RUNS_PER_STYLE; run++) {
    const e = new Engine(content);
    const n = new Narrator(e);
    const rand = rng(run * 7919 + STYLES.indexOf(style) * 104729 + 17);
    const r: Run = {
      style, attempts: 0, failures: 0, discoveries: 0,
      solvedAt: {}, longestDrought: 0, ended: null, challenges: 0,
    };
    let sinceDiscovery = 0;
    for (let page = 1; page <= 400; page++) {
      if (e.getState().ended) break;
      const before = e.getState().discovered.length;
      const beforeSolved = new Set(e.getState().solvedProblems);
      const [a, b] = pickPair(style, e.getState().discovered, rand, page);
      const out = e.combine(a, b);
      n.react(a, b, out, 4000);
      r.attempts++;
      if (out.challenge?.kind === "spawned") r.challenges++;
      if (e.getState().discovered.length > before) {
        r.discoveries++;
        sinceDiscovery = 0;
      } else {
        r.failures++;
        sinceDiscovery++;
        r.longestDrought = Math.max(r.longestDrought, sinceDiscovery);
      }
      for (const id of e.getState().solvedProblems) {
        if (!beforeSolved.has(id)) r.solvedAt[id] = r.attempts;
      }
      if (!r.allSolvedAt && required.every((id: string) => e.getState().solvedProblems.includes(id))) {
        r.allSolvedAt = r.attempts;
      }
    }
    r.ended = e.getState().ended;
    runs.push(r);
  }
}

const pct = (n: number, d: number) => ((n / d) * 100).toFixed(1);
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

console.log(`\n${runs.length} gennemspilninger, turgrænse ${content.config.turnLimit}\n`);

const atts = runs.reduce((s, r) => s + r.attempts, 0);
const fails = runs.reduce((s, r) => s + r.failures, 0);
console.log(`fiaskorate:        ${pct(fails, atts)} %  (${fails} af ${atts} turer gav ingenting)`);
console.log(`fund pr. run:      median ${med(runs.map((r) => r.discoveries))}`);
console.log(`længste tørke:     median ${med(runs.map((r) => r.longestDrought))} turer i træk uden fund, værste ${Math.max(...runs.map((r) => r.longestDrought))}`);

console.log(`\nde obligatoriske nøder:`);
for (const id of [...required, ...valgfri]) {
  const solved = runs.filter((r) => r.solvedAt[id] !== undefined);
  const turns = solved.map((r) => r.solvedAt[id]!);
  console.log(`  ${id.padEnd(10)} løst i ${pct(solved.length, runs.length).padStart(5)} % af runs, median tur ${String(med(turns)).padStart(3)}`);
}
const done = runs.filter((r) => r.allSolvedAt !== undefined);
console.log(`  ALLE PÅKRÆVEDE løst i ${pct(done.length, runs.length)} % af runs, median tur ${med(done.map((r) => r.allSolvedAt!))}`);

// Det Martin faktisk mærkede: hvor stor en del af livet der lå EFTER at alt
// var løst, uden noget nyt at stræbe efter.
const after = done.map((r) => r.attempts - r.allSolvedAt!);
console.log(`\ntomgang efter sidste nød: median ${med(after)} turer af ${content.config.turnLimit} — ${pct(med(after), content.config.turnLimit)} % af livet`);

console.log(`\ntrusler pr. run:   median ${med(runs.map((r) => r.challenges))}, højeste ${Math.max(...runs.map((r) => r.challenges))}`);

console.log(`\nslutninger pr. spillestil:`);
for (const style of STYLES) {
  const rs = runs.filter((r) => r.style === style);
  const e = new Map<string, number>();
  for (const r of rs) e.set(r.ended ?? "(ingen)", (e.get(r.ended ?? "(ingen)") ?? 0) + 1);
  const top = [...e].sort((a, b) => b[1] - a[1]).map(([id, c]) => `${id} ${pct(c, rs.length)} %`);
  console.log(`  ${style.padEnd(10)} ${top.join("   ")}`);
  console.log(`  ${"".padEnd(10)} fund median ${med(rs.map((r) => r.discoveries))}, levede ${med(rs.map((r) => r.attempts))} somre`);
}
