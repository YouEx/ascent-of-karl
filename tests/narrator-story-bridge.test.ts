import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { loadContent } from "../src/content";
import { Narrator } from "../src/narrator/narrator";

const content = loadContent();

describe("fortællerens kontekstbro mellem opdagelser", () => {
  it("binder Stone axe til Rope og peger mod varme i samme beat", () => {
    const engine = new Engine(content);
    const narrator = new Narrator(engine);
    expect(narrator.openingPull()?.id).toBe("pull-kulde");

    const axe = engine.combine("sten", "pind");
    expect(axe.kind).toBe("discovery");
    expect(narrator.react("sten", "pind", axe)?.id).toBe("story-stenoekse");
    narrator.followUp(axe);

    const rope = engine.combine("graes", "graes");
    expect(rope.kind).toBe("discovery");
    const line = narrator.react("graes", "graes", rope);

    expect(line?.id).toMatch(/^bridge-discovery-/);
    expect(line?.text.toLowerCase()).toContain("stone axe");
    expect(line?.text.toLowerCase()).toContain("rope");
    expect(line?.text.toLowerCase()).toMatch(/warm|heat|cold/);
    expect(line?.text).not.toContain("It enters the world. It did not ask to.");
    expect(narrator.followUp(rope)).toBeUndefined();
  });

  it("bevarer forrige opdagelse gennem save/load", () => {
    const engine = new Engine(content);
    const narrator = new Narrator(engine);
    narrator.openingPull();
    const axe = engine.combine("sten", "pind");
    narrator.react("sten", "pind", axe);

    const restored = new Narrator(engine, narrator.getState());
    const rope = engine.combine("graes", "graes");
    const line = restored.react("graes", "graes", rope);

    expect(line?.text.toLowerCase()).toContain("stone axe");
  });
});
