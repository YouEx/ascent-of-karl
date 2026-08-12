import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import { judgePair } from "../src/core/verdict";
import { grammarPool } from "../src/narrator/grammar";
import { playAndCollectFailures } from "./helpers";
import type { Verdict } from "../src/core/types";

const content = loadContent();
const act1 = content.narrator.find((n) => n.act === 1)!;

const VERDICTS: Verdict[] = [
  "locked",
  "near-miss",
  "self",
  "inert",
  "clash",
  "plausible",
  "absurd",
];

describe("Grammatikken: dækningen (TEST-004)", () => {
  it("har en regel for hver eneste dom", () => {
    for (const v of VERDICTS) {
      expect(act1.grammar?.[v]?.length ?? 0, `mangler regler for ${v}`).toBeGreaterThan(0);
    }
  });

  it("hvert eneste par af de 187 elementer kan besvares", () => {
    // Dette er hele ombygningens løfte: der findes ikke et par uden svar.
    const e = new Engine(content);
    const els = content.elements;
    const missing: string[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i; j < els.length; j++) {
        const { verdict } = judgePair(e, els[i]!, els[j]!);
        const pool = grammarPool(act1.grammar, verdict, els[i]!, els[j]!);
        if (pool.length === 0) missing.push(`${els[i]!.id}+${els[j]!.id} (${verdict})`);
      }
    }
    expect(missing.slice(0, 5)).toEqual([]);
  });

  it("alle regel-id'er peger på en replik der findes", () => {
    const e = new Engine(content);
    const n = new Narrator(e);
    for (const ids of Object.values(act1.grammar ?? {})) {
      for (const id of ids) {
        expect(() => n.line(id), id).not.toThrow();
      }
    }
  });

  it("hver replik har mindst seks varianter (TEST-009)", () => {
    // Planens egen bar (TASK-020: "≈ 48 regler, mindst 6 varianter pr. dom").
    // Stod før på ≥4, som er under det grammatikken faktisk leverer i dag (6)
    // — en fremtidig redigering kunne stille og roligt skrabe ned til 4 uden
    // at nogen test bed mærke.
    const e = new Engine(content);
    const n = new Narrator(e);
    for (const ids of Object.values(act1.grammar ?? {})) {
      for (const id of ids) {
        expect(n.line(id).variants.length, id).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("ingen variant lyder ens under to forskellige domme (TEST-009)", () => {
    // En replik der læses op for både "near-miss" og "absurd" fortæller
    // spilleren ingenting — den ene dom er "du var tæt på", den anden er
    // "det var vildt ude i skoven", og teksten skal bære den forskel. Samme
    // variant to gange UNDER SAMME dom er ikke testens problem her.
    const e = new Engine(content);
    const n = new Narrator(e);
    const verdictOf = (key: string): Verdict => key.split(":")[0]! as Verdict;
    const verdictsByVariant = new Map<string, Set<Verdict>>();
    for (const [key, ids] of Object.entries(act1.grammar ?? {})) {
      const verdict = verdictOf(key);
      for (const id of ids) {
        for (const variant of n.line(id).variants) {
          const seen = verdictsByVariant.get(variant) ?? new Set<Verdict>();
          seen.add(verdict);
          verdictsByVariant.set(variant, seen);
        }
      }
    }
    const crossVerdict = [...verdictsByVariant.entries()]
      .filter(([, verdicts]) => verdicts.size > 1)
      .map(([variant, verdicts]) => `"${variant}" → ${[...verdicts].join(" vs. ")}`);
    expect(crossVerdict).toEqual([]);
  });

  it("næsten hver variant nævner mindst ét af de to elementer", () => {
    // Det er hele pointen. En variant uden {a}/{b} er en generisk replik i
    // forklædning, og dem havde vi rigeligt af i forvejen.
    const e = new Engine(content);
    const n = new Narrator(e);
    let total = 0;
    let named = 0;
    for (const ids of Object.values(act1.grammar ?? {})) {
      for (const id of ids) {
        for (const v of n.line(id).variants) {
          total++;
          if (v.includes("{a}") || v.includes("{b}")) named++;
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(named / total).toBeGreaterThan(0.85);
  });
});

describe("Grammatikken: i den rigtige motor", () => {
  // TEST-007 (den generiske pulje bliver aldrig nået, over mange runs) er
  // foldet ind i den stærkere 200-run-regressionstest i
  // tests/narrator-regression.test.ts (TASK-031): samme 0-krav på generic-
  // pulje-hits, men på 200 runs i stedet for 60, og med gentagelsesloftet
  // planen faktisk beder om. Denne fil beholder kun det, den regressionstest
  // ikke dækker: pladsholder-udfyldning og konsekutiv gentagelse.

  it("replikkerne nævner faktisk elementerne, efter udfyldning", () => {
    const said = playAndCollectFailures(content, 31337);
    const withNames = said.filter((l) => /[a-z]/.test(l.text) && l.text.length > 10);
    expect(withNames.length).toBe(said.length);
    // Ingen tom pladsholder må slippe igennem til spilleren.
    for (const l of said) {
      expect(l.text, l.id).not.toMatch(/\{[a-z]+\}/i);
      expect(l.text, l.id).not.toMatch(/\s{2,}/);
      expect(l.text.trim(), l.id).toBe(l.text);
    }
  });

  it("gentager ikke en grammatik-replik i træk", () => {
    // Kun grammatikken. Challenge-varsler SKAL kunne gentages — de tæller ned
    // mod en frist, og en tavs frist er ingen frist.
    const grammarIds = new Set(Object.values(act1.grammar ?? {}).flat());
    for (const seed of [4242, 99, 7, 31337]) {
      const said = playAndCollectFailures(content, seed).filter((l) => grammarIds.has(l.id));
      let repeats = 0;
      for (let i = 1; i < said.length; i++) {
        if (said[i]!.id === said[i - 1]!.id) repeats++;
      }
      expect(repeats, `frø ${seed}`).toBe(0);
    }
  });
});

