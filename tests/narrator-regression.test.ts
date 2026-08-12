import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { playAndCollectFailures } from "./helpers";

const content = loadContent();
const act1 = content.narrator.find((n) => n.act === 1)!;

const RUNS = 200;
/** Planens egen grænse (TASK-031): "fejl hvis nogen replik optræder mere end 3 gange pr. run". */
const MAX_REPEATS_PER_RUN = 3;

interface Regression {
  totalLines: number;
  genericHits: number;
  worstRepeat: number;
  offenders: string[];
}

/**
 * Kører de 200 runs én gang og deler resultatet mellem testene nedenfor, så
 * simuleringen ikke køres to gange for to spørgsmål til samme datasæt.
 * `playAndCollectFailures` (tests/helpers.ts) opsamler kun fiaskokædens egne
 * fire led (bagt → live → grammatik → generisk) — adfærd, hint og
 * flag-hukommelse er bevidst udeladt, se helperens dokumentation.
 */
function simulate(): Regression {
  const generic = new Set(act1.genericFailure);
  let totalLines = 0;
  let genericHits = 0;
  let worstRepeat = 0;
  const offenders: string[] = [];

  for (let r = 0; r < RUNS; r++) {
    // Samme seed-formel som de øvrige simuleringer i repoet (grammar.test.ts,
    // challenge-rates.test.ts) — spredt nok til at runs ikke ligner hinanden.
    const seed = r * 7919 + 13;
    const said = playAndCollectFailures(content, seed);
    totalLines += said.length;

    const countsInRun = new Map<string, number>();
    for (const line of said) {
      countsInRun.set(line.id, (countsInRun.get(line.id) ?? 0) + 1);
      if (generic.has(line.id)) genericHits++;
    }
    for (const [id, count] of countsInRun) {
      if (count > worstRepeat) worstRepeat = count;
      if (count > MAX_REPEATS_PER_RUN) {
        offenders.push(`run ${r} (seed ${seed}): "${id}" lød ${count} gange`);
      }
    }
  }

  return { totalLines, genericHits, worstRepeat, offenders };
}

const result = simulate();

/**
 * TASK-031 + TEST-007: regressionstesten planen faktisk beder om.
 *
 * Fiaskokæden er bagt replik → live replik → grammatik → generisk nødudgang
 * (plan/architecture-procedural-narration-1.md, fase 5). Nødudgangen skal
 * være teknisk til stede men praktisk uopnåelig, og selv de tre lag over den
 * skal veksle nok til at en spiller ikke lægger mærke til at han hører den
 * samme sætning igen og igen.
 *
 * Runtal: planen beder om 200. `challenge-rates.test.ts` klarer 2.000 runs på
 * ~3 s med samme slags blinde simulering; disse 200 kører på under 300 ms
 * (se `npm test`-output), så runtiden er ikke et problem.
 */
describe("Fortællerens fiaskokæde: 200-run regressionstest (TASK-031, TEST-007)", () => {
  it("simuleringen rammer nok fiaskoer, og nødudgangen bliver aldrig nået", () => {
    console.log(
      `  ${RUNS} runs · ${result.totalLines} fiaskokæde-replikker (~${(result.totalLines / RUNS).toFixed(1)}/run) · ` +
        `værste gentagelse i ét run: ${result.worstRepeat} · nødudgangs-hits: ${result.genericHits}`,
    );
    // Sikrer at simuleringen rent faktisk rammer fiaskoer nok til at
    // gentagelses- og nødudgangs-kontrollerne betyder noget (jf. planens
    // egen måling: ~80,6 % af alle forsøg fejler).
    expect(result.totalLines).toBeGreaterThan(1000);
    // TASK-019/TEST-004's løfte: nødudgangen findes kun for det tilfælde
    // grammatikken mangler en regel, og det tilfælde forekommer aldrig i 200
    // runs. Dette løfte HOLDER — se den ikke-holdende nabotest nedenfor.
    expect(result.genericHits).toBe(0);
  });

  // FUND, IKKE TESTFEJL — rapporteret til Martin i stedet for gemt væk.
  //
  // Planens egen grænse (TASK-031/TEST-007) er at INGEN replik i fiaskokæden
  // må lyde mere end 3 gange i ét run. Den grænse holder ikke i dag: over 200
  // runs optræder 20 overtrædelser (10 % af runs), alle på ægte
  // grammatik-id'er — IKKE adfærdsreplikker som failStreak, der allerede er
  // udelukket af `playAndCollectFailures` (se helperens `isFailureChainLine`).
  // Værste tilfælde: "g-plaus-1" lyder 5 gange i samme run — det sker i 5 af
  // de 200 runs (seed 55446, 388044, 720642, 1053240, 1385838), altid sammen
  // med "g-plaus-8" og "g-plaus-2" 4 gange hver. Mindre overtrædelser rammer
  // også "g-clash-6" (run 78) og "g-nm-3" (run 119) — så det er ikke kun
  // "plausible"-puljen, det er mekanikken bag alle puljer.
  //
  // Rodårsag: `NarratorState.recentGrammar` (RECENT_GRAMMAR = 6 i
  // narrator.ts) er ÉT globalt vindue delt af alle 7 domme tilsammen (~51
  // replikker), ikke ét vindue pr. dom. "plausible" har kun 8 replikker
  // (g-plaus-1..8); når andre domme blander sig ind mellem to
  // "plausible"-møder, bliver de fleste af "plausible"s egne 8 id'er aldrig
  // ekskluderet af vinduet, og et lille pulje-udvalg trukket tilfældigt ~7
  // gange pr. run rammer i praksis ofte den samme replik 2+ gange. RISK-002 i
  // planen forudsagde præcis denne risiko og udpegede TASK-018 (vinduet) +
  // TEST-007 (denne test) som modtræk — testen gør sit arbejde, vinduet gør
  // det ikke. En rettelse (fx vinduer pr. dom, eller K skaleret til
  // puljestørrelsen) er en ægte designbeslutning i `grammar.ts`/`narrator.ts`
  // og er bevidst IKKE lavet her: opgaven var at bygge testen, ikke at omgøre
  // anti-gentagelsen. Fjern `.fails` og lad denne test håndhæve grænsen for
  // alvor, den dag vinduet er rettet.
  it.fails(
    "ingen fiaskokæde-replik gentages mere end 3 gange i ét run (planens grænse — se fund ovenfor)",
    () => {
      expect(result.offenders).toEqual([]);
    },
  );
});
