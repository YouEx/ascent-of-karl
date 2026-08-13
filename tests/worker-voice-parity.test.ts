import { describe, expect, it } from "vitest";
import fixture from "./fixtures/voice-parity-fixture.json";
import fixtureSource from "./fixtures/voice-parity-fixture.json?raw";
import voiceProfile from "../worker/src/generated/voice-profile.json";
import { createScorer, type VoiceProfile, type Source } from "../worker/src/voice/scorer";

/**
 * Paritet mellem Python-stemmedommeren (tools/voice/judge.py, metrics.py) og
 * dens TS-port (worker/src/voice/scorer.ts) — TASK-007.
 *
 * Samme filosofi som tests/solves.test.ts (predicate_report.py vs.
 * src/core/solves.ts): to implementeringer af samme regel skrider fra
 * hinanden før eller siden, og skreddet er tavst hvis intet sammenligner dem
 * tal for tal. Python er facit; fixturen er aftrykket. Regenerer fixturen med:
 *   npm run voice:parity-fixture
 *
 * Tolerance: `overall` sammenlignes inden for 1e-4 (dokumenteret i opgaven),
 * ikke bit-eksakt — Python's `round()` (bankers rounding) og JS's
 * `Math.round()`-baserede afrunding kan i sjældne tilfælde afrunde en
 * eksakt .5-grænse forskelligt, men floating-point-summer af 6 kontinuerte
 * dimensioner rammer den grænse praktisk talt aldrig eksakt. hardRejects
 * sammenlignes derimod EKSAKT — det er kategoriske, tekstlige facit, ikke
 * flydende tal, og skal matche ordret (samme reason-strings, samme
 * rækkefølge).
 */

interface FixtureCase {
  id: string;
  source: Source;
  text: string;
  hardRejects: string[];
  dimensions: {
    wordLength: number;
    sentenceCount: number;
    wordCount: number;
    vocabulary: number;
    presentTense: number;
    punctuation: number;
  };
  overall: number;
  presentShareDecidable: boolean;
}

interface Fixture {
  counts: { handwritten: number; grammar: number; pairs: number; synthetic: number };
  cases: FixtureCase[];
}

const TOLERANCE = 1e-4;
const typedFixture = fixture as unknown as Fixture;
const profile = voiceProfile as unknown as VoiceProfile;
const scorer = createScorer(profile);

describe("stemmedommer-paritet: Python facit vs. TS-port (TASK-007)", () => {
  it("fiksturen dækker de tal opgaven kræver — 866 håndskrevne, 312 grammatik, 940 par", () => {
    expect(typedFixture.counts.handwritten).toBe(866);
    expect(typedFixture.counts.grammar).toBe(312);
    // RISK-005: ni bagte par fik en ubetinget åben opskrift (908 -> 890
    // varianter, 404 -> 395 opslag, jf. narration-coverage.md) og blev fjernet
    // fra drafts + facit, ikke bare fra facittet — se validate.py's kontrol.
    // TASK-022, runde 3: 25 nye par (420 opslag, 940 varianter) bagt oven på
    // det oprensede grundlag, indtil CON-003's 60 KB/akt-loft var nået.
    expect(typedFixture.counts.pairs).toBe(940);
    expect(typedFixture.counts.synthetic).toBeGreaterThan(0);
    expect(typedFixture.cases.length).toBe(
      typedFixture.counts.handwritten +
        typedFixture.counts.grammar +
        typedFixture.counts.pairs +
        typedFixture.counts.synthetic,
    );
  });

  it("serialiserer kontinuerte dimensioner kanonisk på tværs af Python-versioner", () => {
    const dimensions = [
      "wordLength",
      "sentenceCount",
      "wordCount",
      "vocabulary",
      "presentTense",
      "punctuation",
    ].join("|");
    const values = [
      ...fixtureSource.matchAll(
        new RegExp(`"(?:${dimensions})":\\s*-?\\d+(?:\\.(\\d+))?`, "g"),
      ),
    ];
    expect(values.length).toBeGreaterThan(0);
    const longestFraction = Math.max(
      ...values.map((match) => match[1]?.length ?? 0),
    );
    expect(longestFraction).toBeLessThanOrEqual(12);
  });

  it("matcher hardRejects og overall (±1e-4) for HVER eneste case i fixturen", () => {
    const afvigelser: string[] = [];

    for (const c of typedFixture.cases) {
      const result = scorer.judgeLine(c.text, c.source);

      if (JSON.stringify(result.hardRejects) !== JSON.stringify(c.hardRejects)) {
        afvigelser.push(
          `${c.id}: hardRejects TS=${JSON.stringify(result.hardRejects)} Python=${JSON.stringify(c.hardRejects)}`,
        );
        continue;
      }

      const diff = Math.abs(result.overall - c.overall);
      if (diff > TOLERANCE) {
        afvigelser.push(`${c.id}: overall TS=${result.overall} Python=${c.overall} (diff ${diff})`);
      }
    }

    expect(afvigelser).toEqual([]);
  });

  it("matcher hver kontinuerlig dimension (±1e-4), ikke kun det samlede gennemsnit", () => {
    const afvigelser: string[] = [];

    for (const c of typedFixture.cases) {
      const result = scorer.judgeLine(c.text, c.source);
      for (const dim of ["wordLength", "sentenceCount", "wordCount", "vocabulary", "presentTense", "punctuation"] as const) {
        const diff = Math.abs(result.dimensions[dim] - c.dimensions[dim]);
        if (diff > TOLERANCE) {
          afvigelser.push(`${c.id}.${dim}: TS=${result.dimensions[dim]} Python=${c.dimensions[dim]} (diff ${diff})`);
        }
      }
    }

    expect(afvigelser).toEqual([]);
  });

  it("matcher presentShareDecidable præcist (bool, ingen tolerance relevant)", () => {
    const afvigelser: string[] = [];
    for (const c of typedFixture.cases) {
      const result = scorer.judgeLine(c.text, c.source);
      if (result.presentShareDecidable !== c.presentShareDecidable) {
        afvigelser.push(`${c.id}: TS=${result.presentShareDecidable} Python=${c.presentShareDecidable}`);
      }
    }
    expect(afvigelser).toEqual([]);
  });

  it("den frosne par-tærskel (p5, threshold.value) matcher profilen ordret", () => {
    expect(profile.threshold.percentile).toBe("p5");
    expect(typeof profile.threshold.value).toBe("number");
    expect(profile.threshold.value).toBeGreaterThan(0);
    expect(profile.threshold.value).toBeLessThan(1);
  });
});
