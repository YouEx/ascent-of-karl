import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { loadContent } from "../src/content";

const content = loadContent();

/** Spiller et helt run igennem med varierede kombinationer. */
function playRun(seed: number) {
  const e = new Engine(content);
  e.loadState({ ...e.getState(), seed });
  let spawned = 0, first: number | null = null, pages = 0;
  for (let page = 1; page <= content.config.turnLimit; page++) {
    if (e.getState().ended) break;
    const pool = e.getState().discovered;
    const a = pool[(page * 7 + seed) % pool.length]!;
    const b = pool[(page * 13 + seed * 3) % pool.length]!;
    const out = e.combine(a, b);
    pages = page;
    if (out.challenge?.kind === "spawned") { spawned++; if (!first) first = page; }
  }
  return { spawned, first, pages, lucky: e.neverChallenged() };
}

describe("Challenges: raterne holder i den rigtige motor", () => {
  it("giver den kalibrerede fordeling over mange runs", () => {
    const RUNS = 2000;
    let lucky = 0, total = 0, pages = 0;
    for (let r = 0; r < RUNS; r++) {
      const res = playRun(r * 7919 + 13);
      total += res.spawned;
      pages += res.pages;
      if (res.lucky) lucky++;
    }
    const luckyPct = (lucky * 100) / RUNS;
    // Rapportér, så en fejlkalibrering er synlig i testkørslen
    console.log(
      `  challenges/run ${(total / RUNS).toFixed(2)} · Carl the Lucky ${luckyPct.toFixed(1)} %` +
      ` · sider/run ${(pages / RUNS).toFixed(1)}`,
    );
    // Kalibreret mod MOTOREN, ikke mod en formel — se src/core/challenge.ts.
    //
    // Bemærk at denne simulering kombinerer i blinde og derfor stort set
    // aldrig løser et challenge; runs dør tidligt (~30 sider). En rigtig
    // spiller overlever længere og møder derfor FLERE end tallet her.
    // Grænserne er sat på det pessimistiske estimat.
    expect(total / RUNS).toBeGreaterThan(1.2);
    expect(total / RUNS).toBeLessThan(2.6);
    expect(luckyPct).toBeGreaterThan(0.5); // ellers er bedriften uopnåelig
    expect(luckyPct).toBeLessThan(10);
  });
});
