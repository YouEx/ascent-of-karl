import { describe, expect, it } from "vitest";
import {
  dominantTrack,
  emptyTracks,
  resolveAnswer,
  tallyTracks,
  verdict,
} from "../src/core/decision";
import type { ContentBundle, DecisionDef, ElementDef } from "../src/core/types";

/** Lille fikstur, så modulet er testet før indholdet er skrevet. */
const decision: DecisionDef = {
  id: "de-sultne",
  emoji: "🍞",
  title: "The hungry at the fire",
  line: "decision-sultne",
  page: 10,
  responses: {
    mad: { score: 5, line: "d-sultne-mad", tracks: { helgen: 2 }, setsFlags: ["sultne-maette"] },
    vaaben: { score: 1, line: "d-sultne-vaaben", tracks: { tyran: 2 }, setsFlags: ["sultne-vrede"] },
    materiale: { score: 3, line: "d-sultne-materiale" },
    default: { score: 2, line: "d-sultne-default" },
  },
};
const content = { decisions: [decision] } as unknown as ContentBundle;
const el = (id: string, tag?: string) => ({ id, tag }) as ElementDef;

describe("Decisions: kategorien afgør svaret", () => {
  it("mad mætter dem og trækker mod helgen", () => {
    const r = resolveAnswer(decision, el("broed", "mad"));
    expect(r.score).toBe(5);
    expect(r.tracks.helgen).toBe(2);
    expect(r.setsFlags).toContain("sultne-maette");
  });

  it("et våben løser noget andet — og gør dem vrede", () => {
    const r = resolveAnswer(decision, el("spyd", "vaaben"));
    expect(r.score).toBe(1);
    expect(r.setsFlags).toContain("sultne-vrede");
  });

  it("træ til de sultne rammer materiale-svaret, ikke en fejl", () => {
    const r = resolveAnswer(decision, el("stamme", "materiale"));
    expect(r.tag).toBe("materiale");
    expect(r.score).toBe(3);
  });

  it("en kategori uden eget svar falder tilbage på default", () => {
    const r = resolveAnswer(decision, el("tromme", "kunst"));
    expect(r.tag).toBe("default");
    expect(r.score).toBe(2);
  });

  it("et element helt uden kategori giver stadig et svar", () => {
    const r = resolveAnswer(decision, el("ukendt"));
    expect(r.score).toBeGreaterThan(0);
  });
});

describe("Decisions: spor og dom", () => {
  it("summerer sporene over trufne beslutninger", () => {
    const t = tallyTracks(content, [
      { id: "de-sultne", answeredWith: "broed", tag: "mad", score: 5 },
    ]);
    expect(t.helgen).toBe(2);
    expect(t.tyran).toBe(0);
  });

  it("uafgjort giver INGEN retning — man har ikke fortjent nogen af delene", () => {
    expect(dominantTrack({ ...emptyTracks(), helgen: 2, tyran: 2 })).toBeNull();
  });

  it("uden valg er der intet spor", () => {
    expect(dominantTrack(emptyTracks())).toBeNull();
  });

  it("et klart flertal giver retningen", () => {
    expect(dominantTrack({ ...emptyTracks(), helgen: 4, tyran: 1 })).toBe("helgen");
  });

  it("kongens dom er summen ud af det mulige", () => {
    const v = verdict(
      [
        { id: "a", answeredWith: "x", tag: "mad", score: 5 },
        { id: "b", answeredWith: "y", tag: "materiale", score: 3 },
      ],
      4,
    );
    expect(v).toEqual({ score: 8, max: 20, decisions: 2 });
  });
});
