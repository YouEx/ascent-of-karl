import { describe, expect, it } from "vitest";
import { freshChallengeState } from "../src/core/challenge";
import { Engine } from "../src/core/engine";
import { serialize, deserialize } from "../src/core/save";
import { judgePair } from "../src/core/verdict";
import { loadContent } from "../src/content";
import type {
  ActDef,
  ChallengeDef,
  ContentBundle,
  ElementDef,
  ProblemDef,
} from "../src/core/types";

function element(
  id: string,
  overrides: Partial<ElementDef> = {},
): ElementDef {
  return {
    id,
    name: id,
    emoji: "",
    act: 1,
    kind: "material",
    stuff: "stone",
    traits: ["hard"],
    scale: "hand",
    ...overrides,
  };
}

const fire = element("fire", {
  base: true,
  kind: "phenomenon",
  stuff: "none",
  traits: ["hot"],
  scale: "camp",
});
const berries = element("berries", {
  base: true,
  stuff: "plant",
  traits: ["edible", "light"],
});
const firePartner = element("fire-partner");
const berryPartner = element("berry-partner", { stuff: "wood" });
const fireResult = element("fire-result", { kind: "tool" });
const berryResult = element("berry-result", { kind: "tool" });

const hunger: ProblemDef = {
  id: "hunger",
  name: "Hunger",
  description: "Karl is hungry",
  required: false,
};
const act: ActDef = { act: 1, name: "Test act", problems: [hunger] };
const wolves: ChallengeDef = {
  id: "wolves",
  emoji: "",
  title: "Wolves",
  line: "wolves",
  turns: 3,
  alsoSolvedBy: [],
  successLine: "safe",
  failEnding: "eaten",
};

function testContent(withNeeds = true): ContentBundle {
  return {
    elements: [
      fire,
      berries,
      firePartner,
      berryPartner,
      fireResult,
      berryResult,
    ],
    combos: [
      { pair: ["fire", "fire-partner"], result: "fire-result" },
      { pair: ["berries", "berry-partner"], result: "berry-result" },
    ],
    acts: [{ ...act, problems: withNeeds ? [hunger] : [] }],
    narrator: [],
    endings: [],
    challenges: withNeeds ? [wolves] : [],
    decisions: [],
    predicates: withNeeds
      ? {
          hunger: { traits: ["edible", "hot"], crafted: true },
          wolves: { traits: ["hot"], crafted: true },
        }
      : {},
    config: { turnLimit: 99, endingsUnlockAt: 1 },
  };
}

function engineWithChallenge(): Engine {
  const engine = new Engine(testContent());
  const state = engine.getState();
  engine.loadState({
    ...state,
    attempts: 10,
    challenges: {
      ...freshChallengeState(),
      active: { id: "wolves", startedAtPage: 10, turnsLeft: 2 },
      seen: ["wolves"],
      everSpawned: true,
    },
  });
  return engine;
}

describe("Engine.improvise — atomisk tur", () => {
  it("registrerer, løser problem og challenge og krediterer i samme ene tur", () => {
    const engine = engineWithChallenge();

    const outcome = engine.improvise("fire", "berries");

    expect(outcome.kind).toBe("improvised");
    if (outcome.kind !== "improvised") return;
    expect(outcome.reused).toBe(false);
    expect(outcome.solved?.id).toBe("hunger");
    expect(outcome.challenge?.kind).toBe("solved");
    expect(outcome.challenge?.kind === "solved" && outcome.challenge.by.id).toBe(
      outcome.element.id,
    );
    expect(outcome.needExplanations.hunger?.satisfied).toBe(true);
    expect(outcome.needExplanations.wolves?.satisfied).toBe(true);
    expect(engine.getState().attempts).toBe(11);
    expect(engine.getState().improvisedElements).toEqual([outcome.element]);
    expect(engine.availableElements().map((entry) => entry.id)).toContain(
      outcome.element.id,
    );
    expect(engine.inventions()).toBe(1);
    expect(engine.endingsUnlocked()).toBe(true);
    expect(engine.getState().flags).toEqual([]);
    expect(engine.getState().act).toBe(1);
    expect(engine.getState().ended).toBeNull();
  });

  it("genbruger samme stabile element uden at duplikere registry eller kredit", () => {
    const engine = engineWithChallenge();
    const first = engine.improvise("fire", "berries");
    const second = engine.improvise("berries", "fire");

    expect(first.kind).toBe("improvised");
    expect(second.kind).toBe("improvised");
    if (first.kind !== "improvised" || second.kind !== "improvised") return;
    expect(second.reused).toBe(true);
    expect(second.element).toEqual(first.element);
    expect(engine.getState().improvisedElements).toHaveLength(1);
    expect(engine.getState().creditedImprovised).toEqual([first.element.id]);
    expect(engine.inventions()).toBe(1);
    expect(engine.getState().attempts).toBe(12);
  });

  it("lader ukrediteret improvisationsspam give nul ending-kredit", () => {
    const engine = new Engine(testContent(false));
    const outcome = engine.improvise("fire", "berries");
    expect(outcome.kind).toBe("improvised");
    expect(engine.inventions()).toBe(0);
    expect(engine.endingsUnlocked()).toBe(false);

    const state = engine.getState();
    engine.loadState({
      ...state,
      discovered: [...state.discovered, "fire-result"],
    });
    expect(engine.inventions()).toBe(1);
  });

  it("krediterer et tidligere ukrediteret element når det senere løser et challenge", () => {
    const content = testContent(true);
    content.acts[0] = { ...content.acts[0]!, problems: [] };
    content.challenges[0] = { ...content.challenges[0]!, minPage: 99 };
    delete content.predicates.hunger;
    const engine = new Engine(content);
    const made = engine.improvise("fire", "berries");
    expect(made.kind).toBe("improvised");
    if (made.kind !== "improvised") return;
    expect(engine.inventions()).toBe(0);

    const state = engine.getState();
    engine.loadState({
      ...state,
      challenges: {
        ...freshChallengeState(),
        active: { id: "wolves", startedAtPage: 2, turnsLeft: 2 },
        seen: ["wolves"],
        everSpawned: true,
      },
    });
    const turn = engine.combine("fire", "berries");

    expect(turn.challenge?.kind).toBe("solved");
    expect(turn.challenge?.kind === "solved" && turn.challenge.by.id).toBe(
      made.element.id,
    );
    expect(engine.getState().creditedImprovised).toEqual([made.element.id]);
    expect(engine.inventions()).toBe(1);
  });
});

describe("Engine.improvise — portcullis og dybde", () => {
  it("afviser kanoniske opskrifter, near-miss, locked og inert", () => {
    const content = loadContent();

    const canonical = new Engine(content);
    expect(canonical.element("sten").origin).toBe("canon");
    expect(canonical.improvise("sten", "sten")).toMatchObject({
      kind: "improvise-rejected",
      reason: "canonical-recipe",
    });
    expect(canonical.isDiscovered("gnister")).toBe(false);
    expect(canonical.getState().attempts).toBe(1);

    const nearMiss = new Engine(content);
    expect(nearMiss.improvise("sten", "graes")).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "near-miss",
    });

    const locked = new Engine(content);
    const lockedState = locked.getState();
    locked.loadState({
      ...lockedState,
      discovered: [...lockedState.discovered, "larver"],
    });
    expect(locked.improvise("larver", "ler")).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "locked",
    });

    const inert = new Engine(content);
    const deadEnds = content.elements
      .filter((entry) => inert.combosWith(entry.id).length === 0)
      .slice(0, 2);
    expect(deadEnds).toHaveLength(2);
    const inertState = inert.getState();
    inert.loadState({
      ...inertState,
      discovered: [
        ...inertState.discovered,
        deadEnds[0]!.id,
        deadEnds[1]!.id,
      ],
    });
    expect(
      inert.improvise(deadEnds[0]!.id, deadEnds[1]!.id),
    ).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "inert",
    });
  });

  it("tillader dybde tre som terminal og bruger den aldrig som forælder til dybde fire", () => {
    const engine = new Engine(testContent(false));
    const first = engine.improvise("fire", "berries");
    expect(first.kind).toBe("improvised");
    if (first.kind !== "improvised") return;
    const second = engine.improvise(first.element.id, "fire");
    expect(second.kind).toBe("improvised");
    if (second.kind !== "improvised") return;
    const third = engine.improvise(second.element.id, "berries");
    expect(third.kind).toBe("improvised");
    if (third.kind !== "improvised") return;

    expect(third.element.depth).toBe(3);
    expect(third.element.terminal).toBe(true);
    expect(engine.improvise(third.element.id, "fire")).toMatchObject({
      kind: "improvise-rejected",
      reason: "depth-limit",
      attemptedDepth: 4,
    });
    expect(engine.getState().attempts).toBe(4);
  });
});

describe("Engine.improvise — save og determinisme", () => {
  it("serialiserer registry og loader gamle saves uden felterne", () => {
    const engine = new Engine(testContent(false));
    const made = engine.improvise("fire", "berries");
    expect(made.kind).toBe("improvised");
    if (made.kind !== "improvised") return;

    const restored = new Engine(
      testContent(false),
      deserialize(serialize(engine.getState(), "2026-08-13T12:00:00Z")),
    );
    expect(restored.element(made.element.id)).toEqual(made.element);
    expect(restored.getState().improvisedElements).toEqual([made.element]);

    const oldState = {
      act: 1,
      discovered: ["fire", "berries"],
      flags: [],
      solvedProblems: [],
      attempts: 2,
    };
    const oldSave = JSON.stringify({
      version: 1,
      savedAt: "2026-08-12T12:00:00Z",
      state: oldState,
    });
    const legacy = new Engine(testContent(false), deserialize(oldSave));
    expect(legacy.getState().improvisedElements).toEqual([]);
    expect(legacy.getState().creditedImprovised).toEqual([]);
  });

  it("giver identiske udfald og state for hele samme offline-sekvens", () => {
    function run() {
      const engine = new Engine(testContent(false));
      const first = engine.improvise("fire", "berries");
      if (first.kind !== "improvised") throw new Error("first failed");
      const second = engine.improvise(first.element.id, "fire");
      if (second.kind !== "improvised") throw new Error("second failed");
      const third = engine.improvise(second.element.id, "berries");
      if (third.kind !== "improvised") throw new Error("third failed");
      const fourth = engine.improvise(third.element.id, "fire");
      return { first, second, third, fourth, state: engine.getState() };
    }

    expect(run()).toEqual(run());
  });

  it("klassificerer det første syntetiske par som en tilladt plausible idé", () => {
    const engine = new Engine(testContent(false));
    expect(
      judgePair(engine, engine.element("fire"), engine.element("berries"))
        .verdict,
    ).toBe("plausible");
  });
});
