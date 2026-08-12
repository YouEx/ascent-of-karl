/**
 * Fordelingsrapport for dommene (TASK-012).
 *
 * Kører judgePair på alle par af de 187 elementer og udskriver fordelingen.
 * Målet fra planen: ingen dom under 3 % og ingen over 45 %. Falder en dom
 * udenfor, er taksonomien for grov eller tærsklerne forkerte — og så skal de
 * justeres, ikke rapporten.
 *
 * To målinger, fordi de svarer på hver sit spørgsmål:
 *   ALLE PAR      — er klassifikatoren overhovedet i balance?
 *   SPILLET PAR   — hvad møder en spiller rent faktisk? Vægtet efter en
 *                   simulering gennem den rigtige motor, for de par der
 *                   faktisk kan dannes af opdagede elementer.
 *
 * Kør: npm run verdicts
 *
 * Målt 2026-08-12, spillede par (det tal der betyder noget):
 *   near-miss 41,7 · plausible 18,9 · absurd 18,8 · self 9,1 · clash 7,5
 *   inert 2,8 · locked 1,2
 *
 * `locked` ligger under 3 % og kan ikke løftes herfra: der findes kun to
 * flag-spærrede opskrifter i hele spillet. Det er en kendsgerning om
 * indholdet, ikke en fejl i klassifikatoren, og rettes ved at skrive flere
 * flag-spærrede opskrifter — ikke ved at slække på dommen.
 *
 * Bemærk forskellen mellem de to målinger: over ALLE par er `inert` 51,8 %,
 * fordi 63 elementer ikke indgår i nogen opskrift. I spil er tallet 2,8 %,
 * fordi de elementer sjældent bliver opdaget. Det er den spillede fordeling
 * planens 3–45 %-mål gælder.
 */

import { Engine } from "../src/core/engine";
import { loadContent } from "../src/content";
import { judgePair } from "../src/core/verdict";
import type { Verdict } from "../src/core/types";

const content = loadContent();
const engine = new Engine(content);

const VERDICTS: Verdict[] = [
  "locked",
  "near-miss",
  "self",
  "inert",
  "clash",
  "plausible",
  "absurd",
];

function tally(): Map<Verdict, number> {
  return new Map(VERDICTS.map((v) => [v, 0]));
}

function report(title: string, counts: Map<Verdict, number>, total: number) {
  console.log(`\n${title} — ${total.toLocaleString("da-DK")} par`);
  for (const v of VERDICTS) {
    const n = counts.get(v)!;
    const pct = total ? (n * 100) / total : 0;
    const bar = "█".repeat(Math.round(pct / 2));
    const flag = pct < 3 ? " ⚠ under 3 %" : pct > 45 ? " ⚠ over 45 %" : "";
    console.log(
      `  ${v.padEnd(10)} ${String(n).padStart(6)}  ${pct.toFixed(1).padStart(5)} % ${bar}${flag}`,
    );
  }
}

// ---------------------------------------------------------------- alle par
{
  const els = content.elements;
  const counts = tally();
  let total = 0;
  for (let i = 0; i < els.length; i++) {
    for (let j = i; j < els.length; j++) {
      const { verdict } = judgePair(engine, els[i]!, els[j]!);
      counts.set(verdict, counts.get(verdict)! + 1);
      total++;
    }
  }
  report("ALLE PAR (frisk spil)", counts, total);
}

// ------------------------------------------------------------- spillet par
{
  // Simulér gennemspilninger og dømm kun de par en spiller faktisk kan danne.
  // Dommen afhænger af tilstanden — near-miss kræver at partneren er opdaget —
  // så den skal måles undervejs, ikke bagefter.
  const counts = tally();
  let total = 0;
  const RUNS = 400;
  for (let r = 0; r < RUNS; r++) {
    const seed = r * 7919 + 13;
    const e = new Engine(content);
    e.loadState({ ...e.getState(), seed });
    for (let page = 1; page <= content.config.turnLimit; page++) {
      if (e.getState().ended) break;
      const pool = e.getState().discovered;
      const a = pool[(page * 7 + seed) % pool.length]!;
      const b = pool[(page * 13 + seed * 3) % pool.length]!;
      const out = e.combine(a, b);
      if (out.kind === "nofuse") {
        counts.set(out.verdict, counts.get(out.verdict)! + 1);
        total++;
      }
    }
  }
  report(`SPILLET PAR (${RUNS} gennemspilninger, kun fiaskoer)`, counts, total);
}

console.log();
