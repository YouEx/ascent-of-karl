import { describe, expect, it } from "vitest";
import {
  buildFallbackElement,
  deriveTags,
  improvisedElementId,
} from "../src/core/improvise";
import { loadContent } from "../src/content";
import type { ElementDef } from "../src/core/types";

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
    depth: 0,
    ...overrides,
  };
}

describe("Deterministisk improvisation", () => {
  it("normaliserer gammelt canonical content til origin canon ved runtime", () => {
    expect(loadContent().elements.every((entry) => entry.origin === "canon")).toBe(
      true,
    );
  });

  it("giver parret et stabilt, kollisionsfrit og rækkefølgeuafhængigt id", () => {
    expect(improvisedElementId("ild", "baer")).toBe("improv:4:baer:3:ild");
    expect(improvisedElementId("baer", "ild")).toBe("improv:4:baer:3:ild");
    expect(improvisedElementId("ild", "vand")).not.toBe(
      improvisedElementId("ild", "baer"),
    );
  });

  it("lader ild forarbejde spiselig råvare med den eksisterende taksonomi", () => {
    const fire = element("ild", {
      name: "Fire",
      kind: "phenomenon",
      stuff: "none",
      traits: ["hot"],
      scale: "camp",
      depth: 0,
    });
    const berries = element("baer", {
      name: "Berries",
      stuff: "plant",
      traits: ["edible", "light"],
      depth: 2,
    });

    const built = buildFallbackElement(fire, berries);

    expect(built).toEqual(buildFallbackElement(berries, fire));
    expect(built).toMatchObject({
      id: "improv:4:baer:3:ild",
      name: "Fire-touched Berries",
      origin: "improvised",
      parents: ["baer", "ild"],
      depth: 3,
      terminal: true,
      base: false,
      kind: "food",
      stuff: "plant",
      scale: "hand",
    });
    expect(built.traits).toEqual(["hot", "dry", "edible", "light"]);
    expect(built.flavor).toContain("Fire");
    expect(built.flavor).toContain("Berries");
    expect(built.traits as string[]).not.toContain("cooked");
  });

  it("lader et skarpt værktøj gøre et dyr til dødt, spiseligt kød", () => {
    const spear = element("spyd", {
      name: "Spear",
      kind: "tool",
      stuff: "wood",
      traits: ["sharp", "weapon"],
      depth: 1,
    });
    const boar = element("dyr", {
      name: "Wild boar",
      kind: "creature",
      stuff: "flesh",
      traits: ["alive", "heavy"],
      scale: "body",
      depth: 1,
    });

    expect(deriveTags(spear, boar)).toEqual({
      kind: "food",
      stuff: "flesh",
      traits: ["dead", "edible", "heavy"],
      scale: "body",
    });
    const built = buildFallbackElement(boar, spear);
    expect(built.name).toBe("Butchered Wild boar");
    expect(built.depth).toBe(2);
    expect(built.terminal).toBe(false);
  });

  it("lader vand gennemvæde målet og fjerner tør og varm", () => {
    const water = element("vand", {
      name: "Water",
      stuff: "water",
      traits: ["wet"],
    });
    const grass = element("graes", {
      name: "Dry grass",
      stuff: "plant",
      traits: ["dry", "light"],
    });

    expect(deriveTags(water, grass)).toEqual({
      kind: "material",
      stuff: "plant",
      traits: ["wet", "light"],
      scale: "hand",
    });
    expect(buildFallbackElement(grass, water).name).toBe("Soaked Dry grass");
  });

  it("lader ler binde målet og gøre konstruktionen våd og skrøbelig", () => {
    const clay = element("ler", {
      name: "Clay",
      stuff: "clay",
      traits: ["soft", "wet"],
    });
    const stick = element("pind", {
      name: "Stick",
      stuff: "wood",
      traits: ["dry", "light"],
    });

    expect(deriveTags(clay, stick)).toEqual({
      kind: "material",
      stuff: "wood",
      traits: ["soft", "wet", "light", "fragile"],
      scale: "hand",
    });
    expect(buildFallbackElement(stick, clay).name).toBe("Clay-bound Stick");
  });

  it("lader et værktøj forme materialets dominerende stof", () => {
    const spear = element("spyd", {
      name: "Spear",
      kind: "tool",
      stuff: "wood",
      traits: ["sharp", "weapon"],
    });
    const stone = element("sten", {
      name: "Stone",
      stuff: "stone",
      traits: ["hard", "heavy"],
    });

    expect(deriveTags(spear, stone)).toEqual({
      kind: "tool",
      stuff: "stone",
      traits: ["hard", "heavy"],
      scale: "hand",
    });
    expect(buildFallbackElement(stone, spear).name).toBe(
      "Stone worked by Spear",
    );
  });

  it("bruger faste prioriteter som deterministisk fallback uden en særregel", () => {
    const idea = element("idea", {
      name: "Idea",
      kind: "abstract",
      stuff: "none",
      traits: ["sacred"],
    });
    const ore = element("ore", {
      name: "Ore",
      kind: "material",
      stuff: "metal",
      traits: ["hard", "heavy"],
    });

    expect(deriveTags(idea, ore)).toEqual({
      kind: "material",
      stuff: "metal",
      traits: ["hard", "heavy", "sacred"],
      scale: "hand",
    });
    expect(buildFallbackElement(ore, idea)).toEqual(
      buildFallbackElement(idea, ore),
    );
  });

  it("afviser en generation over dybdeloftet på tre", () => {
    const deep = element("dyb", { depth: 3 });
    const shallow = element("lav", { depth: 0 });

    expect(() => buildFallbackElement(deep, shallow)).toThrow(
      "Improvisation depth 4 exceeds maximum 3",
    );
  });
});
