import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { freshChallengeState } from "../src/core/challenge";
import { Engine } from "../src/core/engine";
import { buildFallbackElement } from "../src/core/improvise";
import { satisfies } from "../src/core/solves";
import { judgePair } from "../src/core/verdict";
import type {
  ActDef,
  ChallengeDef,
  CombineOutcome,
  ContentBundle,
  ElementDef,
  PredicateFailure,
  ProblemDef,
  SolvePredicate,
  Verdict,
} from "../src/core/types";
import { loadContent } from "../src/content";
import { Narrator, freshNarratorState } from "../src/narrator/narrator";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const production = loadContent();
const productionNarrator = production.narrator.find((entry) => entry.act === 1)!;

function element(
  id: string,
  overrides: Partial<ElementDef> = {},
): ElementDef {
  return {
    id,
    name: id.replaceAll("-", " "),
    emoji: "",
    act: 1,
    kind: "material",
    stuff: "stone",
    traits: ["hard"],
    scale: "hand",
    ...overrides,
  };
}

const fire = element("test-fire", {
  name: "campfire",
  base: true,
  kind: "phenomenon",
  stuff: "fire",
  traits: ["hot"],
  scale: "camp",
});
const berries = element("test-berries", {
  name: "berries",
  base: true,
  stuff: "plant",
  traits: ["edible", "light"],
});
const stone = element("test-stone", {
  name: "stone",
  base: true,
});
const firePartner = element("test-fire-partner", { stuff: "wood" });
const berryPartner = element("test-berry-partner", { stuff: "wood" });
const stonePartner = element("test-stone-partner", { stuff: "wood" });
const fireResult = element("test-fire-result", { kind: "tool" });
const berryResult = element("test-berry-result", { kind: "tool" });
const stoneResult = element("test-stone-result", { kind: "tool" });

function problem(
  id: string,
  name: string,
  overrides: Partial<ProblemDef> = {},
): ProblemDef {
  return {
    id,
    name,
    description: name,
    required: true,
    ...overrides,
  };
}

const wolves: ChallengeDef = {
  id: "test-wolves-internal",
  emoji: "",
  title: "Wolves at the treeline",
  line: "challenge-ulve",
  turns: 4,
  minPage: 99,
  alsoSolvedBy: [],
  successLine: "challenge-ulve-loest",
  failEnding: "aedt",
};

function testContent(
  problems: ProblemDef[],
  predicates: Record<string, SolvePredicate>,
  challenges: ChallengeDef[] = [],
): ContentBundle {
  const act: ActDef = { act: 1, name: "Test act", problems };
  const narrator = structuredClone(productionNarrator);
  narrator.improvisation!.labels.needs = Object.fromEntries([
    ...problems.map((entry) => [entry.id, entry.name]),
    ...challenges.map((entry) => [entry.id, entry.title]),
  ]);
  return {
    elements: [
      fire,
      berries,
      stone,
      firePartner,
      berryPartner,
      stonePartner,
      fireResult,
      berryResult,
      stoneResult,
    ],
    combos: [
      { pair: [fire.id, firePartner.id], result: fireResult.id },
      { pair: [berries.id, berryPartner.id], result: berryResult.id },
      { pair: [stone.id, stonePartner.id], result: stoneResult.id },
    ],
    acts: [act],
    narrator: [narrator],
    endings: [],
    challenges,
    decisions: [],
    predicates,
    config: { turnLimit: 99, endingsUnlockAt: 99 },
  };
}

function narrated(
  content: ContentBundle,
  seed = 1,
): { engine: Engine; narrator: Narrator } {
  const engine = new Engine(content);
  return {
    engine,
    narrator: new Narrator(engine, freshNarratorState(seed)),
  };
}

function improviseAndReact(
  engine: Engine,
  narrator: Narrator,
  a: string,
  b: string,
): { outcome: CombineOutcome; line: ReturnType<Narrator["react"]> } {
  const outcome = engine.improvise(a, b);
  return { outcome, line: narrator.react(a, b, outcome) };
}

function pool(name: keyof NonNullable<typeof productionNarrator.improvisation>): string[] {
  const value = productionNarrator.improvisation![name];
  if (!Array.isArray(value)) throw new Error(`${String(name)} er ikke en pulje`);
  return value;
}

function productionSolverPair(needId: string): [string, string] {
  const predicate = production.predicates[needId];
  if (!predicate) throw new Error(`mangler prædikat for ${needId}`);
  const search = new Engine(production);
  const candidates = production.elements.filter(
    (entry) => entry.act === 1 && (entry.depth ?? 0) <= 2,
  );
  search.loadState({
    ...search.getState(),
    discovered: production.elements
      .filter((entry) => entry.act === 1)
      .map((entry) => entry.id),
    solvedProblems: search.currentActProblems().map((entry) => entry.id),
  });
  const canonicalPairs = new Set(
    production.combos.map((combo) => [...combo.pair].sort().join("+")),
  );
  const canonicalIds = new Set(production.elements.map((entry) => entry.id));

  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const a = candidates[left]!;
      const b = candidates[right]!;
      if (canonicalPairs.has([a.id, b.id].sort().join("+"))) continue;
      if (Math.max(a.depth ?? 0, b.depth ?? 0) + 1 > 3) continue;
      const verdict = judgePair(search, a, b).verdict;
      if (verdict !== "plausible" && verdict !== "absurd") continue;
      const invented = buildFallbackElement(a, b);
      if (canonicalIds.has(invented.id)) continue;
      if (satisfies(invented, predicate)) return [a.id, b.id];
    }
  }
  throw new Error(`fandt ingen improviseret løsning til ${needId}`);
}

describe("Narrator: improviserede udfald er egne story-beats", () => {
  it("fortæller at en plausibel opfindelse løser problemet", () => {
    const hunger = problem("test-hunger-internal", "Karl is hungry");
    const content = testContent(
      [hunger],
      { [hunger.id]: { traits: ["edible", "hot"], crafted: true } },
    );
    const { engine, narrator } = narrated(content);

    expect(judgePair(engine, fire, berries).verdict).toBe("plausible");
    const { outcome, line } = improviseAndReact(engine, narrator, fire.id, berries.id);

    expect(outcome).toMatchObject({ kind: "improvised", solved: { id: hunger.id } });
    expect(pool("problemSolved")).toContain(line?.id);
    expect(line?.text).toContain("fire-touched berries");
    expect(line?.text).toContain(hunger.name);
    expect(line?.id).not.toMatch(/^disc-/);
  });

  it("bruger den særlige challenge-familie frem for challengets generiske successLine", () => {
    const hunger = problem("test-hunger-internal", "Karl is hungry");
    const content = testContent(
      [hunger],
      {
        [hunger.id]: { traits: ["edible", "hot"], crafted: true },
        [wolves.id]: { traits: ["hot"], crafted: true },
      },
      [wolves],
    );
    const { engine, narrator } = narrated(content);
    const state = engine.getState();
    engine.loadState({
      ...state,
      attempts: 10,
      challenges: {
        ...freshChallengeState(),
        active: { id: wolves.id, startedAtPage: 10, turnsLeft: 2 },
        seen: [wolves.id],
        everSpawned: true,
      },
    });

    const { outcome, line } = improviseAndReact(engine, narrator, fire.id, berries.id);

    expect(outcome.kind).toBe("improvised");
    expect(outcome.challenge?.kind).toBe("solved");
    expect(pool("challengeSolved")).toContain(line?.id);
    expect(line?.id).not.toBe(wolves.successLine);
    expect(line?.text).toContain(wolves.title);
  });

  it("bevarer et nyt challenges højere prioritet end en samtidig problemløsning", () => {
    const hunger = problem("test-hunger-internal", "Karl is hungry");
    const content = testContent(
      [hunger],
      {
        [hunger.id]: { traits: ["edible", "hot"], crafted: true },
        [wolves.id]: { traits: ["healing"], crafted: true },
      },
      [{ ...wolves, minPage: 1 }],
    );
    let heard: ReturnType<Narrator["react"]> | undefined;
    let outcome: CombineOutcome | undefined;

    for (let seed = 1; seed <= 100 && !heard; seed++) {
      const { engine, narrator } = narrated(content, seed);
      const state = engine.getState();
      engine.loadState({
        ...state,
        seed,
        challenges: { ...freshChallengeState(), gap: 100 },
      });
      const attempt = improviseAndReact(engine, narrator, fire.id, berries.id);
      if (attempt.outcome.challenge?.kind === "spawned") {
        outcome = attempt.outcome;
        heard = attempt.line;
      }
    }

    expect(outcome).toMatchObject({
      kind: "improvised",
      solved: { id: hunger.id },
      challenge: { kind: "spawned", def: { id: wolves.id } },
    });
    expect(heard?.id).toBe(wolves.line);
  });

  it("lader den absurde løsning slå den almindelige problemløsningsfamilie", () => {
    const warmth = problem("test-warmth-internal", "Karl is freezing");
    const content = testContent(
      [warmth],
      { [warmth.id]: { traits: ["hot"], crafted: true } },
    );
    const { engine, narrator } = narrated(content);

    expect(judgePair(engine, fire, stone).verdict).toBe("absurd");
    const { outcome, line } = improviseAndReact(engine, narrator, fire.id, stone.id);

    expect(outcome).toMatchObject({ kind: "improvised", solved: { id: warmth.id } });
    expect(pool("absurdSolved")).toContain(line?.id);
    expect(pool("problemSolved")).not.toContain(line?.id ?? "");
    expect(line?.text).toContain(warmth.name);
  });

  it("bevarer næste træk efter en improviseret problemløsning", () => {
    const warmth = problem("test-warmth-internal", "Karl is freezing", {
      pull: "pull-kulde",
    });
    const tools = problem("test-tools-internal", "Bare hands", {
      pull: "pull-vaerktoej",
    });
    const content = testContent(
      [warmth, tools],
      {
        [warmth.id]: { traits: ["hot"], crafted: true },
        [tools.id]: { kind: ["tool"], crafted: true },
      },
    );
    const { engine, narrator } = narrated(content);
    expect(narrator.openingPull()?.id).toBe("pull-kulde");

    const outcome = engine.improvise(fire.id, stone.id);
    narrator.react(fire.id, stone.id, outcome);

    expect(outcome).toMatchObject({ kind: "improvised", solved: { id: warmth.id } });
    expect(narrator.followUp(outcome)?.id).toBe("pull-vaerktoej");
  });
});

describe("Narrator: need-labels er grammatiske for alle rigtige behov", () => {
  const act = production.acts.find((entry) => entry.act === 1)!;

  it.each(act.problems)("bruger en indholdsphrase for problemet $id", (need) => {
    const label =
      productionNarrator.improvisation!.labels.needs[need.id];
    expect(label).toBeTruthy();
    if (!label) throw new Error(`mangler need-label for ${need.id}`);
    let engine: Engine;
    let pair: [string, string];
    if (need.id === "ensomhed") {
      const content = testContent(
        [need],
        { [need.id]: production.predicates[need.id]! },
      );
      const companion = element("companion-seed", {
        name: "quiet companion",
        base: true,
        kind: "person",
        stuff: "flesh",
        traits: ["alive"],
      });
      const companionPartner = element("companion-partner");
      const companionResult = element("companion-result");
      content.elements.push(companion, companionPartner, companionResult);
      content.combos.push({
        pair: [companion.id, companionPartner.id],
        result: companionResult.id,
      });
      content.narrator[0]!.improvisation!.labels.needs[need.id] = label;
      engine = new Engine(content);
      pair = [companion.id, stone.id];
    } else {
      pair = productionSolverPair(need.id);
      engine = new Engine(production);
      engine.loadState({
        ...engine.getState(),
        discovered: production.elements
          .filter((entry) => entry.act === 1)
          .map((entry) => entry.id),
        solvedProblems: act.problems
          .filter((entry) => entry.id !== need.id)
          .map((entry) => entry.id),
      });
    }
    const narrator = new Narrator(engine, freshNarratorState(17));

    const { outcome, line } = improviseAndReact(
      engine,
      narrator,
      pair[0],
      pair[1],
    );
    expect(outcome).toMatchObject({
      kind: "improvised",
      solved: { id: need.id },
    });
    expect(label).not.toBe(need.name);
    expect(label).not.toMatch(/^Karl (is|needs|wonders)\b/);
    expect(line?.text.toLowerCase()).toContain(label.toLowerCase());
    expect(line?.text.toLowerCase()).not.toContain(need.name.toLowerCase());
  });

  it.each(production.challenges)(
    "bruger en indholdsphrase for challenget $id",
    (need) => {
      const pair = productionSolverPair(need.id);
      const engine = new Engine(production);
      engine.loadState({
        ...engine.getState(),
        discovered: production.elements
          .filter((entry) => entry.act === 1)
          .map((entry) => entry.id),
        solvedProblems: act.problems.map((entry) => entry.id),
        challenges: {
          ...freshChallengeState(),
          active: { id: need.id, startedAtPage: 1, turnsLeft: 2 },
          seen: [need.id],
          everSpawned: true,
        },
      });
      const narrator = new Narrator(engine, freshNarratorState(19));

      const { outcome, line } = improviseAndReact(
        engine,
        narrator,
        pair[0],
        pair[1],
      );
      const label =
        productionNarrator.improvisation!.labels.needs[need.id];
      expect(label).toBeTruthy();
      if (!label) throw new Error(`mangler need-label for ${need.id}`);

      expect(outcome.challenge).toMatchObject({
        kind: "solved",
        def: { id: need.id },
      });
      expect(label).not.toBe(need.title);
      expect(line?.text.toLowerCase()).toContain(label.toLowerCase());
      expect(line?.text.toLowerCase()).not.toContain(need.title.toLowerCase());
    },
  );
});

describe("Narrator: improvisation følger opdagelses- og fiaskotællerne", () => {
  it("en ny improviseret opfindelse nulstiller en eksisterende fiaskorække", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content);

    for (let index = 0; index < 3; index++) {
      const outcome = engine.combine(fire.id, stone.id);
      expect(outcome.kind).toBe("nofuse");
      narrator.react(fire.id, stone.id, outcome);
    }
    expect(narrator.getState()).toMatchObject({
      failStreak: 3,
      failsSinceDiscovery: 3,
    });

    const success = engine.improvise(fire.id, berries.id);
    expect(success).toMatchObject({ kind: "improvised", reused: false });
    narrator.react(fire.id, berries.id, success);

    expect(narrator.getState()).toMatchObject({
      failStreak: 0,
      failsSinceDiscovery: 0,
    });
  });

  it("afviste improvisationer bygger den samme fiaskorække som nofuse", () => {
    const engine = new Engine(production);
    const narrator = new Narrator(engine);

    for (let index = 0; index < 2; index++) {
      const outcome = engine.improvise("sten", "sten");
      expect(outcome).toMatchObject({
        kind: "improvise-rejected",
        reason: "canonical-recipe",
      });
      narrator.react("sten", "sten", outcome);
    }

    expect(narrator.getState()).toMatchObject({
      failStreak: 2,
      failsSinceDiscovery: 2,
    });
  });
});

describe("Narrator: NeedExplanations bliver sand spillertekst", () => {
  const cases: Array<[
    Exclude<PredicateFailure["requirement"], "crafted">,
    SolvePredicate,
  ]> = [
    ["kind", { kind: ["structure"] }],
    ["stuff", { stuff: ["metal"] }],
    ["traits", { traits: ["healing"] }],
    ["scale", { scale: ["landscape"] }],
    ["minDepth", { minDepth: 2 }],
    ["anyOf", { anyOf: [{ kind: ["tool"] }, { traits: ["healing"] }] }],
    ["allOf", { allOf: [{ traits: ["hot"] }, { traits: ["healing"] }] }],
    ["not", { not: { traits: ["hot"] } }],
  ];

  it.each(cases)("forklarer %s uden rå JSON eller interne id'er", (requirement, predicate) => {
    const need = problem("secret-need-id", "Karl needs a cure");
    const content = testContent([need], { [need.id]: predicate });
    const { engine, narrator } = narrated(content, 7);

    const { outcome, line } = improviseAndReact(engine, narrator, fire.id, berries.id);

    expect(outcome.kind).toBe("improvised");
    expect(outcome.kind === "improvised" && outcome.solved).toBeUndefined();
    expect(productionNarrator.improvisation!.noSolution[requirement]).toContain(line?.id);
    expect(line?.text).toContain(need.name);
    expect(line?.text).not.toContain(need.id);
    expect(line?.text).not.toMatch(/\b(anyOf|allOf|minDepth|traits|stuff)\b/);
    expect(line?.text).not.toContain("{");
  });

  it("klassificerer crafted som uopnåelig for rigtige improviserede elementer", () => {
    const need = problem("secret-crafted-id", "something Karl made");
    const content = testContent(
      [need],
      { [need.id]: { kind: ["structure"], crafted: true } },
    );
    const { engine, narrator } = narrated(content, 9);

    const { outcome, line } = improviseAndReact(
      engine,
      narrator,
      fire.id,
      berries.id,
    );

    expect(outcome.kind).toBe("improvised");
    if (outcome.kind !== "improvised") return;
    const failures = outcome.needExplanations[need.id]?.failures ?? [];
    expect(failures.map((failure) => failure.requirement)).toEqual(["kind"]);
    expect(productionNarrator.improvisation!.noSolution).not.toHaveProperty(
      "crafted",
    );
    expect(productionNarrator.improvisation!.noSolution.kind).toContain(line?.id);
  });

  it("bruger den brede no-current-need fallback med et ægte Engine.improvise-udfald", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content, 11);

    const { outcome, line } = improviseAndReact(
      engine,
      narrator,
      fire.id,
      berries.id,
    );

    expect(outcome).toMatchObject({ kind: "improvised", reused: false });
    expect(outcome.kind === "improvised" && outcome.needExplanations).toEqual({});
    expect(pool("noCurrentNeed")).toContain(line?.id);
  });
});

describe("Narrator: genbrug, afvisning og serialiseret variation", () => {
  it("genkender en genbrugt opfindelse", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content);
    improviseAndReact(engine, narrator, fire.id, berries.id);

    const { outcome, line } = improviseAndReact(engine, narrator, berries.id, fire.id);

    expect(outcome).toMatchObject({ kind: "improvised", reused: true });
    expect(pool("reused")).toContain(line?.id);
    expect(line?.text).toContain("fire-touched berries");
  });

  it("afviser kanonisk opskrift og verdikt-port med egne familier, ikke story/grammar", () => {
    const canonicalEngine = new Engine(production);
    const canonicalNarrator = new Narrator(canonicalEngine);
    const canonical = improviseAndReact(
      canonicalEngine,
      canonicalNarrator,
      "sten",
      "sten",
    );
    expect(canonical.outcome).toMatchObject({
      kind: "improvise-rejected",
      reason: "canonical-recipe",
    });
    expect(productionNarrator.improvisation!.rejected.canonicalRecipe).toContain(
      canonical.line?.id,
    );
    expect(canonical.line?.id).not.toBe("story-gnister");

    const verdictEngine = new Engine(production);
    const verdictNarrator = new Narrator(verdictEngine);
    const verdict = improviseAndReact(
      verdictEngine,
      verdictNarrator,
      "sten",
      "graes",
    );
    expect(verdict.outcome).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "near-miss",
    });
    expect(productionNarrator.improvisation!.rejected.verdict.other).toContain(
      verdict.line?.id,
    );
    expect(verdict.line?.id).not.toMatch(/^(g-|gf-|pair-)/);
  });

  it("giver locked sin egen sandfærdige afvisning", () => {
    const engine = new Engine(production);
    const state = engine.getState();
    engine.loadState({
      ...state,
      discovered: [...state.discovered, "larver"],
    });
    const narrator = new Narrator(engine);

    const { outcome, line } = improviseAndReact(
      engine,
      narrator,
      "larver",
      "ler",
    );

    expect(outcome).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "locked",
    });
    expect(
      productionNarrator.improvisation!.rejected.verdict.locked,
    ).toContain(line?.id);
    expect(line?.text.toLowerCase()).not.toContain("empty space");
    expect(line?.text.toLowerCase()).toMatch(/already|answer|known|correct|right/);
  });

  it.each(["near-miss", "inert", "self", "clash"] as const)(
    "holder den øvrige verdikt-afvisning bred og sand for %s",
    (targetVerdict) => {
      let engine: Engine;
      let pair: [string, string];
      if (targetVerdict === "near-miss") {
        engine = new Engine(production);
        pair = ["sten", "graes"];
      } else if (targetVerdict === "self") {
        engine = new Engine(production);
        pair = ["ler", "ler"];
      } else if (targetVerdict === "inert") {
        const content = testContent([], {});
        const first = element("inert-a", { name: "idle stone", base: true });
        const second = element("inert-b", { name: "idle bone", base: true });
        content.elements.push(first, second);
        engine = new Engine(content);
        pair = [first.id, second.id];
      } else {
        const content = testContent([], {});
        const wet = element("wet-test", {
          name: "wet bundle",
          base: true,
          stuff: "none",
          traits: ["wet"],
        });
        const wetPartner = element("wet-partner");
        const wetResult = element("wet-result");
        content.elements.push(wet, wetPartner, wetResult);
        content.combos.push({
          pair: [wet.id, wetPartner.id],
          result: wetResult.id,
        });
        engine = new Engine(content);
        pair = [fire.id, wet.id];
      }
      const narrator = new Narrator(engine);
      const { outcome, line } = improviseAndReact(
        engine,
        narrator,
        pair![0],
        pair![1],
      );

      expect(outcome).toMatchObject({
        kind: "improvise-rejected",
        reason: "verdict",
        verdict: targetVerdict,
      });
      expect(
        productionNarrator.improvisation!.rejected.verdict.other,
      ).toContain(line?.id);
      expect(line?.text).not.toContain("{");
    },
  );

  it("kanonisk afvisning lover ikke en konkret opskrift, fordi et kurateret id også kan eje udfaldet", () => {
    for (const id of productionNarrator.improvisation!.rejected.canonicalRecipe) {
      for (const variant of productionNarrator.lines.find((line) => line.id === id)!.variants) {
        expect(variant.toLowerCase()).not.toContain("recipe");
      }
    }
  });

  it("afviser dybde fire med dybdeloftets egen familie", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content);
    const first = engine.improvise(fire.id, berries.id);
    expect(first.kind).toBe("improvised");
    if (first.kind !== "improvised") return;
    const second = engine.improvise(first.element.id, fire.id);
    expect(second.kind).toBe("improvised");
    if (second.kind !== "improvised") return;
    const third = engine.improvise(second.element.id, berries.id);
    expect(third.kind).toBe("improvised");
    if (third.kind !== "improvised") return;

    const outcome = engine.improvise(third.element.id, fire.id);
    const line = narrator.react(third.element.id, fire.id, outcome);

    expect(outcome).toMatchObject({
      kind: "improvise-rejected",
      reason: "depth-limit",
      attemptedDepth: 4,
    });
    expect(productionNarrator.improvisation!.rejected.depthLimit).toContain(line?.id);
  });

  it("gentager hverken replik-id eller variant i en række genbrug", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content, 31);
    improviseAndReact(engine, narrator, fire.id, berries.id);
    const heard: Array<{ id: string; text: string }> = [];

    for (let index = 0; index < 8; index++) {
      const { line } = improviseAndReact(engine, narrator, fire.id, berries.id);
      expect(line).toBeTruthy();
      heard.push({ id: line!.id, text: line!.text });
    }

    for (let index = 1; index < heard.length; index++) {
      expect(heard[index]!.id).not.toBe(heard[index - 1]!.id);
      expect(heard[index]!.text).not.toBe(heard[index - 1]!.text);
    }
  });

  it("samme seed giver samme domsforløb", () => {
    const run = (seed: number) => {
      const { engine, narrator } = narrated(testContent([], {}), seed);
      const lines = [
        improviseAndReact(engine, narrator, fire.id, berries.id).line,
        improviseAndReact(engine, narrator, fire.id, berries.id).line,
        improviseAndReact(engine, narrator, fire.id, berries.id).line,
      ];
      expect(lines.every(Boolean)).toBe(true);
      return lines.map((line) => `${line?.id}:${line?.variant}:${line?.text}`);
    };

    expect(run(73)).toEqual(run(73));
  });

  it("save/load fortsætter præcis samme pool- og variantsekvens", () => {
    const content = testContent([], {});
    const { engine, narrator } = narrated(content, 91);
    improviseAndReact(engine, narrator, fire.id, berries.id);
    improviseAndReact(engine, narrator, fire.id, berries.id);
    const engineState = engine.getState();
    const narratorState = narrator.getState();

    const expected = improviseAndReact(engine, narrator, fire.id, berries.id).line;
    expect(expected).toBeTruthy();
    expect(pool("reused")).toContain(expected?.id);

    const restoredEngine = new Engine(content, engineState);
    const restoredNarrator = new Narrator(restoredEngine, narratorState);
    const actual = improviseAndReact(
      restoredEngine,
      restoredNarrator,
      fire.id,
      berries.id,
    ).line;

    expect(actual).toBeTruthy();
    expect(pool("reused")).toContain(actual?.id);
    expect(actual).toEqual(expected);
  });
});

function runPython(
  source: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawn("python3", ["-c", source], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

function realLongDepthThreeInvention(): ElementDef {
  const stuffs: ElementDef["stuff"][] = [
    "none",
    "plant",
    "flesh",
    "fibre",
    "bone",
    "wood",
    "stone",
    "metal",
  ];
  const bases = stuffs.map((stuff, index) =>
    element(`long-base-${index}`, {
      name: `Ancient object${index}`,
      base: true,
      stuff,
    }),
  );
  const dummies = stuffs.map((stuff, index) =>
    element(`long-dummy-${index}`, { stuff }),
  );
  const results = stuffs.map((stuff, index) =>
    element(`long-result-${index}`, { stuff }),
  );
  const content: ContentBundle = {
    elements: [...bases, ...dummies, ...results],
    combos: bases.map((base, index) => ({
      pair: [base.id, dummies[index]!.id],
      result: results[index]!.id,
    })),
    acts: [{ act: 1, name: "Long-name test", problems: [] }],
    narrator: [structuredClone(productionNarrator)],
    endings: [],
    challenges: [],
    decisions: [],
    predicates: {},
    config: { turnLimit: 99, endingsUnlockAt: 99 },
  };
  const engine = new Engine(content);
  const make = (a: string, b: string): ElementDef => {
    const outcome = engine.improvise(a, b);
    expect(outcome.kind).toBe("improvised");
    if (outcome.kind !== "improvised") throw new Error("forventede opfindelse");
    return outcome.element;
  };

  const depthOne = [
    make(bases[0]!.id, bases[1]!.id),
    make(bases[2]!.id, bases[3]!.id),
    make(bases[4]!.id, bases[5]!.id),
    make(bases[6]!.id, bases[7]!.id),
  ];
  const depthTwo = [
    make(depthOne[0]!.id, depthOne[1]!.id),
    make(depthOne[2]!.id, depthOne[3]!.id),
  ];
  return make(depthTwo[0]!.id, depthTwo[1]!.id);
}

describe("Stemmedommer: improvisationsfamilier", () => {
  it("ekspanderer alle nye varianter uden rå pladsholdere", async () => {
    const result = await runPython(`
import json
from tools.voice import judge
lines = judge.expand_improvisation()
print(json.dumps({
  "count": len(lines),
  "unfilled": [label for label, text in lines if "{" in text or "}" in text],
}))
`);

    expect(result.code, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as { count: number; unfilled: string[] };
    expect(parsed.count).toBeGreaterThan(60);
    expect(parsed.unfilled).toEqual([]);
  });

  it("gater hver familie med et konservativt navn mindst så langt som en ægte dybde-3-opfindelse", async () => {
    const real = realLongDepthThreeInvention();
    expect(real.depth).toBe(3);
    const result = await runPython(`
import json
from tools.voice import judge
real_name = ${JSON.stringify(real.name)}
fillers = judge.improvisation_element_fillers()
expanded = judge.expand_improvisation()
short_ids = sorted({label.split(":")[2].split("#")[0] for label, _ in expanded if label.startswith("improvisation:short:")})
max_ids = sorted({label.split(":")[2].split("#")[0] for label, _ in expanded if label.startswith("improvisation:max:")})
failures = [f for f in judge.gate() if "improvisation:max:" in f]
print(json.dumps({
  "realWords": len(judge.tokenize_words(real_name)),
  "maxWords": max(len(judge.tokenize_words(name)) for name in fillers),
  "shortIds": short_ids,
  "maxIds": max_ids,
  "failures": failures,
}))
`);

    expect(result.code, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      realWords: number;
      maxWords: number;
      shortIds: string[];
      maxIds: string[];
      failures: string[];
    };
    expect(parsed.realWords).toBeGreaterThan(10);
    expect(parsed.maxWords).toBeGreaterThanOrEqual(parsed.realWords);
    expect(parsed.maxIds).toEqual(parsed.shortIds);
    expect(parsed.failures).toEqual([]);
  }, 20_000);

  it("afviser en lav-stemme improvisationsvariant gennem den samme gate som validate", async () => {
    const result = await runPython(`
import json
from tools.voice import judge
failures = judge.gate(extra_candidates=[
  ("improvisation:test-bad#0", "Invalid input received. Please try again on the internet.")
])
print(json.dumps([f for f in failures if "improvisation:test-bad#0" in f]))
`);

    expect(result.code, result.stderr).toBe(0);
    const failures = JSON.parse(result.stdout) as string[];
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("hård afvisning");
  }, 20_000);
});
