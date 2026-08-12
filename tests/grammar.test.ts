import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import { judgePair } from "../src/core/verdict";
import { grammarPool } from "../src/narrator/grammar";
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

  it("hver replik har mindst fire varianter", () => {
    const e = new Engine(content);
    const n = new Narrator(e);
    for (const ids of Object.values(act1.grammar ?? {})) {
      for (const id of ids) {
        expect(n.line(id).variants.length, id).toBeGreaterThanOrEqual(4);
      }
    }
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
  /** Spiller blindt og fanger hver eneste replik fortælleren siger ved en fiasko. */
  function playAndCollect(seed: number) {
    const e = new Engine(content);
    const n = new Narrator(e);
    const said: { id: string; text: string }[] = [];
    for (let page = 1; page <= 200; page++) {
      if (e.getState().ended) break;
      const pool = e.getState().discovered;
      const a = pool[(page * 7 + seed) % pool.length]!;
      const b = pool[(page * 13 + seed * 3) % pool.length]!;
      const out = e.combine(a, b);
      const line = n.react(a, b, out, 4000);
      if (out.kind === "nofuse" && line) said.push({ id: line.id, text: line.text });
    }
    return said;
  }

  it("den generiske pulje bliver aldrig nået", () => {
    // Grammatikken står før den; hvis en generisk replik alligevel lyder, er
    // der et hul i dækningen. Nødudgangen skal forblive ubrugt.
    const generic = new Set(act1.genericFailure);
    let hits = 0;
    let total = 0;
    for (let r = 0; r < 60; r++) {
      for (const line of playAndCollect(r * 7919 + 13)) {
        total++;
        if (generic.has(line.id)) hits++;
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(hits).toBe(0);
  });

  it("replikkerne nævner faktisk elementerne, efter udfyldning", () => {
    const said = playAndCollect(31337);
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
      const said = playAndCollect(seed).filter((l) => grammarIds.has(l.id));
      let repeats = 0;
      for (let i = 1; i < said.length; i++) {
        if (said[i]!.id === said[i - 1]!.id) repeats++;
      }
      expect(repeats, `frø ${seed}`).toBe(0);
    }
  });
});
