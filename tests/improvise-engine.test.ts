import { describe, expect, it } from "vitest";
import { freshChallengeState } from "../src/core/challenge";
import { Engine } from "../src/core/engine";
import {
  buildFallbackElement,
  improvisedElementId,
} from "../src/core/improvise";
import { serialize, deserialize } from "../src/core/save";
import { judgePair } from "../src/core/verdict";
import { loadContent } from "../src/content";
import type {
  ActDef,
  ChallengeDef,
  CombineOutcome,
  ContentBundle,
  ElementDef,
  ProblemDef,
} from "../src/core/types";

type AttemptCapableEngine = Engine & {
  attempt?: (
    a: string,
    b: string,
    copy?: { name: string; flavor: string },
  ) => CombineOutcome;
  enhanceImprovisedCopy?: (
    id: string,
    copy: { name: string; flavor: string },
  ) => ElementDef | undefined;
};

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

function endingThresholdEngine(
  attempts: number,
  canonicalInventions: number,
): Engine {
  const endingA = element("ending-a", { base: true });
  const endingB = element("ending-b", { base: true });
  const fate = element("fate", { traits: ["sacred"] });
  const padding = Array.from({ length: 13 }, (_, index) =>
    element(`padding-${index + 1}`),
  );
  const improvised = buildFallbackElement(fire, berries);
  const content: ContentBundle = {
    elements: [fire, berries, endingA, endingB, fate, ...padding],
    combos: [
      {
        pair: ["ending-a", "ending-b"],
        result: "fate",
        ending: "intended",
      },
    ],
    acts: [{ act: 1, name: "Ending act", problems: [] }],
    narrator: [],
    endings: [
      {
        id: "intended",
        title: "Intended",
        emoji: "",
        tone: "happy",
        achievement: "Intended",
        line: "intended-line",
      },
      {
        id: "old-age",
        title: "Old age",
        emoji: "",
        tone: "bittersweet",
        achievement: "Old age",
        line: "old-age-line",
        automatic: true,
      },
    ],
    challenges: [{ ...wolves, minPage: 99 }],
    decisions: [],
    predicates: { wolves: { traits: ["hot"], crafted: true } },
    config: { turnLimit: 50, endingsUnlockAt: 14 },
  };
  const engine = new Engine(content);
  const state = engine.getState();
  engine.loadState({
    ...state,
    discovered: [
      ...state.discovered,
      ...padding.slice(0, canonicalInventions).map((entry) => entry.id),
      improvised.id,
    ],
    attempts,
    improvisedElements: [improvised],
    creditedImprovised: [],
    challenges: {
      ...freshChallengeState(),
      active: { id: "wolves", startedAtPage: attempts, turnsLeft: 2 },
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

  describe("Engine.attempt — canonical først, ellers improvisation", () => {
    it("vælger en tilgængelig canonical opskrift og bruger præcis ét forsøg", () => {
      const engine = new Engine(loadContent()) as AttemptCapableEngine;

      expect(typeof engine.attempt).toBe("function");
      if (!engine.attempt) return;
      const outcome = engine.attempt("sten", "sten", {
        name: "Must be ignored",
        flavor: "Network copy must never replace a canonical discovery.",
      });

      expect(outcome).toMatchObject({
        kind: "discovery",
        element: { id: "gnister", origin: "canon" },
      });
      expect(engine.getState().attempts).toBe(1);
      expect(engine.getState().improvisedElements).toEqual([]);
    });

    it("opretter deterministisk fallback med valgfri copy-override i samme ene tur", () => {
      const engine = new Engine(testContent(false)) as AttemptCapableEngine;
      const fallback = buildFallbackElement(fire, berries);

      expect(typeof engine.attempt).toBe("function");
      if (!engine.attempt) return;
      const outcome = engine.attempt("fire", "berries", {
        name: "Ember berries",
        flavor: "Karl warms the berries and calls the result a method.",
      });

      expect(outcome.kind).toBe("improvised");
      if (outcome.kind !== "improvised") return;
      expect(outcome.element).toEqual({
        ...fallback,
        name: "Ember berries",
        flavor: "Karl warms the berries and calls the result a method.",
      });
      expect(engine.getState().attempts).toBe(1);
      expect(engine.getState().improvisedElements).toEqual([outcome.element]);
    });
  });

  describe("Engine.enhanceImprovisedCopy — sen copy er kun copy", () => {
    it("opdaterer det stabile element uden at ændre mekanik eller duplikere id", () => {
      const engine = new Engine(testContent(false)) as AttemptCapableEngine;
      const made = engine.improvise("fire", "berries");
      expect(made.kind).toBe("improvised");
      if (made.kind !== "improvised") return;
      const before = engine.getState().improvisedElements[0]!;
      const mechanicsBefore = {
        ...before,
        name: undefined,
        flavor: undefined,
      };

      expect(typeof engine.enhanceImprovisedCopy).toBe("function");
      if (!engine.enhanceImprovisedCopy) return;
      const enhanced = engine.enhanceImprovisedCopy(before.id, {
        name: "Ember berries",
        flavor: "Karl warms the berries and calls the result a method.",
      });

      expect(enhanced?.id).toBe(before.id);
      expect(enhanced?.name).toBe("Ember berries");
      expect(enhanced?.flavor).toContain("warms the berries");
      expect({
        ...enhanced,
        name: undefined,
        flavor: undefined,
      }).toEqual(mechanicsBefore);
      expect(engine.getState().improvisedElements).toHaveLength(1);
      expect(engine.availableElements().filter((entry) => entry.id === before.id)).toHaveLength(1);
    });

    it("bevarer forbedret copy gennem save/load og rører aldrig canonical elementer", () => {
      const engine = new Engine(testContent(false)) as AttemptCapableEngine;
      const made = engine.improvise("fire", "berries");
      expect(made.kind).toBe("improvised");
      if (made.kind !== "improvised") return;
      expect(typeof engine.enhanceImprovisedCopy).toBe("function");
      if (!engine.enhanceImprovisedCopy) return;

      engine.enhanceImprovisedCopy(made.element.id, {
        name: "Ember berries",
        flavor: "Karl warms the berries and calls the result a method.",
      });
      expect(
        engine.enhanceImprovisedCopy("fire", {
          name: "Forged fire",
          flavor: "This must never replace canonical content.",
        }),
      ).toBeUndefined();

      const restored = new Engine(
        testContent(false),
        deserialize(serialize(engine.getState(), "2026-08-13T14:00:00Z")),
      );
      expect(restored.element(made.element.id)).toMatchObject({
        id: made.element.id,
        name: "Ember berries",
        flavor: "Karl warms the berries and calls the result a method.",
        kind: made.element.kind,
        traits: made.element.traits,
      });
      expect(restored.element("fire").name).toBe("fire");
    });
  });

  describe("Engine — challenge-kredit før endingvalg", () => {
    it("vælger den tiltænkte ending på sommer 50 når challenge-kredit rammer 14", () => {
      const engine = endingThresholdEngine(49, 12);

      const outcome = engine.combine("ending-a", "ending-b");

      expect(outcome.kind).toBe("discovery");
      expect(outcome.challenge?.kind).toBe("solved");
      expect(engine.inventions()).toBe(14);
      expect(engine.getState().attempts).toBe(50);
      expect(engine.activeEnding()?.id).toBe("intended");
      if (outcome.kind === "discovery") {
        expect(outcome.endingDeflected).toBe(false);
      }
    });

    it("vælger samme ending på den tilstødende ikke-finale sommer 49", () => {
      const engine = endingThresholdEngine(48, 12);

      const outcome = engine.combine("ending-a", "ending-b");

      expect(outcome.challenge?.kind).toBe("solved");
      expect(engine.inventions()).toBe(14);
      expect(engine.getState().attempts).toBe(49);
      expect(engine.activeEnding()?.id).toBe("intended");
      if (outcome.kind === "discovery") {
        expect(outcome.endingDeflected).toBe(false);
      }
    });

    it("bevarer deflection én invention under grænsen på en ikke-final sommer", () => {
      const engine = endingThresholdEngine(48, 11);

      const outcome = engine.combine("ending-a", "ending-b");

      expect(outcome.challenge?.kind).toBe("solved");
      expect(engine.inventions()).toBe(13);
      expect(engine.activeEnding()).toBeNull();
      if (outcome.kind === "discovery") {
        expect(outcome.endingDeflected).toBe(true);
      }
    });
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
    expect(legacy.element("fire").origin).toBe("canon");
  });

  it("lader aldrig et gemt runtime-element skygge et canonical id — heller ikke efter reload", () => {
    const content = loadContent();
    const engine = new Engine(content);
    const clean = engine.getState();
    const canonicalStone = engine.element("sten");
    const malicious = {
      ...canonicalStone,
      origin: "improvised",
      parents: ["pind", "graes"],
      depth: 1,
      name: "Forged stone",
    } as ElementDef;

    engine.loadState({
      ...clean,
      improvisedElements: [malicious],
      creditedImprovised: ["sten"],
    });
    expect(engine.element("sten")).toEqual(canonicalStone);
    expect(engine.getState().improvisedElements).toEqual([]);
    expect(engine.getState().creditedImprovised).toEqual([]);

    engine.loadState(clean);
    expect(engine.element("sten")).toEqual(canonicalStone);
  });

  it("fjerner gamle runtime-elementer helt ved en senere ren load", () => {
    const engine = new Engine(testContent(false));
    const made = engine.improvise("fire", "berries");
    expect(made.kind).toBe("improvised");
    if (made.kind !== "improvised") return;

    const clean = new Engine(testContent(false)).getState();
    engine.loadState(clean);

    expect(engine.getState().improvisedElements).toEqual([]);
    expect(engine.isDiscovered(made.element.id)).toBe(false);
    expect(() => engine.element(made.element.id)).toThrow("Ukendt element");
  });

  it("lader en senere kurateret canonical version vinde over samme stabile runtime-id", () => {
    const improvised = buildFallbackElement(fire, berries);
    const curated: ElementDef = {
      ...improvised,
      origin: "canon",
      parents: undefined,
      name: "Curated fire berries",
    };
    const content = testContent(false);
    content.elements.push(curated);
    const engine = new Engine(content);
    const state = engine.getState();

    engine.loadState({
      ...state,
      discovered: [...state.discovered, curated.id],
      improvisedElements: [improvised],
      creditedImprovised: [improvised.id],
    });

    expect(engine.element(curated.id)).toEqual(curated);
    expect(engine.getState().improvisedElements).toEqual([]);
    expect(engine.getState().creditedImprovised).toEqual([]);
    expect(engine.inventions()).toBe(1);

    expect(engine.improvise("fire", "berries")).toMatchObject({
      kind: "improvise-rejected",
      reason: "canonical-recipe",
    });
    expect(engine.element(curated.id)).toEqual(curated);
    expect(engine.getState().improvisedElements).toEqual([]);
  });

  it.each([
    ["origin", (entry: Record<string, unknown>) => { entry.origin = "canon"; }],
    ["parents missing", (entry: Record<string, unknown>) => { delete entry.parents; }],
    ["parents shape", (entry: Record<string, unknown>) => { entry.parents = ["fire"]; }],
    ["depth zero", (entry: Record<string, unknown>) => { entry.depth = 0; }],
    ["depth mismatch", (entry: Record<string, unknown>) => { entry.depth = 2; }],
    ["depth four", (entry: Record<string, unknown>) => { entry.depth = 4; }],
    ["unknown parents", (entry: Record<string, unknown>) => {
      entry.parents = ["missing-a", "missing-b"];
      entry.id = improvisedElementId("missing-a", "missing-b");
    }],
    ["kind", (entry: Record<string, unknown>) => { entry.kind = "vehicle"; }],
    ["valid but forged kind", (entry: Record<string, unknown>) => { entry.kind = "tool"; }],
    ["stuff", (entry: Record<string, unknown>) => { entry.stuff = "mud"; }],
    ["traits", (entry: Record<string, unknown>) => { entry.traits = ["cooked"]; }],
    ["valid but forged traits", (entry: Record<string, unknown>) => { entry.traits = ["hot"]; }],
    ["scale", (entry: Record<string, unknown>) => { entry.scale = "world"; }],
    ["act mismatch", (entry: Record<string, unknown>) => { entry.act = 2; }],
    ["self parents", (entry: Record<string, unknown>) => {
      entry.parents = ["fire", "fire"];
      entry.id = improvisedElementId("fire", "fire");
    }],
  ])("discarder malformed runtime taxonomy: %s", (_label, mutate) => {
    const valid = buildFallbackElement(fire, berries);
    const malformed = structuredClone(valid) as unknown as Record<string, unknown>;
    mutate(malformed);
    const malformedId = String(malformed.id);
    const engine = new Engine(testContent(false));
    const state = engine.getState();

    engine.loadState({
      ...state,
      discovered: [...state.discovered, malformedId],
      improvisedElements: [malformed as unknown as ElementDef],
      creditedImprovised: [malformedId],
    });

    expect(engine.getState().improvisedElements).toEqual([]);
    expect(engine.getState().creditedImprovised).toEqual([]);
    expect(engine.isDiscovered(malformedId)).toBe(false);
  });

  it("afviser saves hvor de nye registry-felter ikke er arrays", () => {
    const base = {
      act: 1,
      discovered: ["fire", "berries"],
      flags: [],
      solvedProblems: [],
      attempts: 1,
    };
    expect(() =>
      deserialize(JSON.stringify({
        version: 1,
        savedAt: "2026-08-13T12:00:00Z",
        state: { ...base, improvisedElements: {} },
      })),
    ).toThrow("Ugyldig save-fil");
    expect(() =>
      deserialize(JSON.stringify({
        version: 1,
        savedAt: "2026-08-13T12:00:00Z",
        state: { ...base, creditedImprovised: "forged" },
      })),
    ).toThrow("Ugyldig save-fil");
  });

  it("sanitizer strukturelt ugyldige runtime-elementer allerede ved deserialize", () => {
    const malformed = {
      ...buildFallbackElement(fire, berries),
      kind: "vehicle",
    };
    const state = deserialize(JSON.stringify({
      version: 1,
      savedAt: "2026-08-13T12:00:00Z",
      state: {
        act: 1,
        discovered: ["fire", "berries", malformed.id],
        flags: [],
        solvedProblems: [],
        attempts: 1,
        improvisedElements: [malformed],
        creditedImprovised: [malformed.id],
      },
    }));

    expect(state.improvisedElements).toEqual([]);
    expect(state.creditedImprovised).toEqual([]);
  });

  it.each([
    ["markup-navn", (entry: ElementDef) => {
      entry.name = '<img src=x onerror="alert(1)">';
    }],
    ["markup-emoji", (entry: ElementDef) => {
      entry.emoji = "<svg onload=alert(1)>";
    }],
    ["markup-flavor", (entry: ElementDef) => {
      entry.flavor = "<script>alert(1)</script>";
    }],
    ["oversize-navn", (entry: ElementDef) => {
      entry.name = "A".repeat(500);
    }],
    ["oversize-emoji", (entry: ElementDef) => {
      entry.emoji = "🪨".repeat(100);
    }],
    ["oversize-flavor", (entry: ElementDef) => {
      entry.flavor = "A".repeat(5000);
    }],
  ])("afviser skadelig gemt invention-copy ved save-grænsen: %s", (_label, mutate) => {
    const malicious = buildFallbackElement(fire, berries);
    mutate(malicious);
    const state = deserialize(JSON.stringify({
      version: 1,
      savedAt: "2026-08-13T15:00:00Z",
      state: {
        act: 1,
        discovered: ["fire", "berries", malicious.id],
        flags: [],
        solvedProblems: [],
        attempts: 1,
        improvisedElements: [malicious],
        creditedImprovised: [malicious.id],
      },
    }));

    expect(state.improvisedElements).toEqual([]);
    expect(state.creditedImprovised).toEqual([]);
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
