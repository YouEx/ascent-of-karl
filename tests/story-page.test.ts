import { describe, expect, it } from "vitest";
import type {
  ActDef,
  CombineOutcome,
  ElementDef,
  ProblemDef,
} from "../src/core/types";
import {
  openingStoryPage,
  storyPageForOutcome,
} from "../src/ui/story-page";

function element(
  id: string,
  name: string,
  overrides: Partial<ElementDef> = {},
): ElementDef {
  return {
    id,
    name,
    emoji: "",
    act: 1,
    kind: "material",
    stuff: "stone",
    traits: ["hard"],
    scale: "hand",
    ...overrides,
  };
}

const stone = element("stone", "Stone");
const stick = element("stick", "Stick", { stuff: "wood" });
const grass = element("grass", "Grass", {
  stuff: "plant",
  traits: ["dry"],
});
const axe = element("axe", "Stone axe", {
  emoji: "axe",
  kind: "tool",
  flavor: "Karl has invented leverage, mostly by accident.",
  note: "Ground stone axes appeared during the Neolithic.",
});
const currentAct: ActDef = {
  act: 1,
  name: "The Stone Age",
  problems: [],
};
const bareHands: ProblemDef = {
  id: "hands",
  name: "Karl has only bare hands",
  description: "Karl needs a tool.",
  required: true,
};

describe("opening story page", () => {
  it("invites the first combination without claiming an outcome", () => {
    expect(openingStoryPage()).toEqual({
      kind: "opening",
      pairLabel: "The first page",
      kicker: "Karl's story",
      title: "The page is waiting",
      body: "Combine two elements to write what happens next.",
    });
  });
});

describe("story page outcome mapping", () => {
  it("uses canonical discovery copy and its historical note", () => {
    const outcome: CombineOutcome = {
      kind: "discovery",
      combo: { pair: ["stone", "stick"], result: "axe" },
      element: axe,
      solved: bareHands,
      ageUp: false,
      act: currentAct,
    };

    expect(storyPageForOutcome(stone, stick, outcome)).toEqual({
      kind: "discovery",
      pairLabel: "Stone + Stick",
      kicker: "Discovery",
      title: "Stone axe",
      body: axe.flavor,
      note: axe.note,
      solved: bareHands.name,
      elementId: "axe",
      emoji: "axe",
    });
  });

  it("reports a known result without calling it a new discovery", () => {
    const outcome: CombineOutcome = {
      kind: "known",
      combo: { pair: ["stone", "stick"], result: "axe" },
      element: axe,
    };

    expect(storyPageForOutcome(stone, stick, outcome)).toEqual({
      kind: "known",
      pairLabel: "Stone + Stick",
      kicker: "Already written",
      title: "Stone axe",
      body: axe.flavor,
      elementId: "axe",
      emoji: "axe",
    });
  });

  it("names the unmet needs when a canonical result is gated", () => {
    const outcome: CombineOutcome = {
      kind: "gated",
      combo: { pair: ["stone", "stick"], result: "axe" },
      unsolved: [bareHands],
    };

    expect(storyPageForOutcome(stone, stick, outcome)).toEqual({
      kind: "blocked",
      pairLabel: "Stone + Stick",
      kicker: "Not yet",
      title: "The next page is blocked",
      body: "Karl has only bare hands",
    });
  });

  it("reports a failed pair without inventing a discovery", () => {
    const outcome: CombineOutcome = {
      kind: "nofuse",
      a: stone,
      b: grass,
      verdict: "clash",
      evidence: { clashing: ["hard", "dry"] },
    };

    expect(storyPageForOutcome(stone, grass, outcome)).toEqual({
      kind: "attempt",
      pairLabel: "Stone + Grass",
      kicker: "Attempt",
      title: "No new discovery",
    });
  });

  it("identifies a new improvisation as Karl's invention without a note", () => {
    const invention = element("stone-stick", "Pointy compromise", {
      origin: "improvised",
      parents: ["stone", "stick"],
      depth: 1,
      kind: "tool",
      flavor: "It is at least sharp at one end.",
    });
    const outcome: CombineOutcome = {
      kind: "improvised",
      element: invention,
      reused: false,
      solved: bareHands,
      ageUp: false,
      act: currentAct,
      needExplanations: {},
    };

    expect(storyPageForOutcome(stone, stick, outcome)).toEqual({
      kind: "invention",
      pairLabel: "Stone + Stick",
      kicker: "Karl invents",
      title: invention.name,
      body: invention.flavor,
      solved: bareHands.name,
      elementId: invention.id,
      emoji: invention.emoji,
    });
  });

  it("labels a reused improvisation as remembered rather than new", () => {
    const invention = element("stone-stick", "Pointy compromise", {
      origin: "improvised",
      parents: ["stone", "stick"],
      depth: 1,
      kind: "tool",
      flavor: "It is at least sharp at one end.",
    });
    const outcome: CombineOutcome = {
      kind: "improvised",
      element: invention,
      reused: true,
      ageUp: false,
      act: currentAct,
      needExplanations: {},
    };

    expect(storyPageForOutcome(stone, stick, outcome).kicker).toBe(
      "Karl remembers",
    );
  });

  it("reports a rejected improvisation as an attempt, not an invention", () => {
    const outcome: CombineOutcome = {
      kind: "improvise-rejected",
      a: stone,
      b: grass,
      reason: "verdict",
      verdict: "clash",
      evidence: { clashing: ["hard", "dry"] },
    };

    expect(storyPageForOutcome(stone, grass, outcome)).toEqual({
      kind: "attempt",
      pairLabel: "Stone + Grass",
      kicker: "Karl's idea",
      title: "It does not hold together",
    });
  });
});
