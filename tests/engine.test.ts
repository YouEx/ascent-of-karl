import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { deserialize, serialize } from "../src/core/save";
import { loadContent } from "../src/content";

const content = loadContent();

function freshEngine(): Engine {
  return new Engine(content);
}

/** Spiller hovedsporet frem til (men ikke inklusive) bronze. */
function playMainTrack(e: Engine): void {
  e.combine("sten", "sten"); // gnister
  e.combine("gnister", "graes"); // ild → løser kulde
  e.combine("sten", "pind"); // stenøkse → løser værktøj
  e.combine("stenoekse", "pind"); // spyd
  e.combine("spyd", "dyr"); // kød
  e.combine("ild", "koed"); // stegt kød → løser sult
  e.combine("stenoekse", "sten"); // malm
  e.combine("malm", "ild"); // kobber
}

describe("Engine: grundregler", () => {
  it("starter med akt 1's base-elementer", () => {
    const e = freshEngine();
    const ids = e.availableElements().map((el) => el.id);
    expect(ids).toContain("sten");
    expect(ids).toContain("larver");
    expect(ids).not.toContain("ild");
    expect(ids).not.toContain("korn"); // akt 2-element er låst
  });

  it("et element kan kombineres med sig selv (sten + sten = gnister)", () => {
    const e = freshEngine();
    const outcome = e.combine("sten", "sten");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.element.id).toBe("gnister");
  });

  it("rækkefølgen af parret er ligegyldig", () => {
    const e = freshEngine();
    e.combine("sten", "sten");
    const outcome = e.combine("graes", "gnister");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.element.id).toBe("ild");
  });

  it("ugyldige kombinationer giver ingenting", () => {
    const e = freshEngine();
    expect(e.combine("baer", "ler").kind).toBe("nothing");
  });

  it("kendte kombinationer giver 'known', ikke en ny opdagelse", () => {
    const e = freshEngine();
    e.combine("sten", "sten");
    const again = e.combine("sten", "sten");
    expect(again.kind).toBe("known");
  });

  it("afviser kombination med uopdagede elementer", () => {
    const e = freshEngine();
    expect(() => e.combine("ild", "koed")).toThrow();
  });
});

describe("Engine: problemer og flere gyldige løsninger", () => {
  it("ild løser kulde", () => {
    const e = freshEngine();
    e.combine("sten", "sten");
    const outcome = e.combine("gnister", "graes");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.solved?.id).toBe("kulde");
    expect(e.isSolved("kulde")).toBe(true);
  });

  it("sult kan løses ad det komiske spor (ristede larver) og sætter flag", () => {
    const e = freshEngine();
    e.combine("sten", "sten");
    e.combine("gnister", "graes");
    const outcome = e.combine("larver", "ild");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.solved?.id).toBe("sult");
    expect(e.hasFlag("larver")).toBe(true);
  });

  it("et allerede løst problem løses ikke igen af den anden gren", () => {
    const e = freshEngine();
    playMainTrack(e); // sult løst med stegt kød
    const outcome = e.combine("larver", "ild");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.solved).toBeUndefined();
  });
});

describe("Engine: flags åbner kombinationer", () => {
  it("larvefarm kræver larver-flaget", () => {
    const e = freshEngine();
    expect(e.combine("larver", "ler").kind).toBe("nothing");
    e.combine("sten", "sten");
    e.combine("gnister", "graes");
    e.combine("larver", "ild"); // sætter flag
    const outcome = e.combine("larver", "ler");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.element.id).toBe("larvefarm");
  });
});

describe("Engine: age-up med blødt gate", () => {
  it("nægter age-up mens obligatoriske problemer er uløste", () => {
    const e = freshEngine();
    e.combine("sten", "sten");
    e.combine("sten", "pind"); // værktøj løst — men kulde/sult mangler... nej, ild mangler
    e.combine("stenoekse", "sten"); // malm
    // Vi mangler ild for kobber — brug direkte state-vej: kulde er uløst her.
    e.combine("gnister", "graes"); // ild → kulde løst
    e.combine("malm", "ild"); // kobber
    const gated = e.combine("kobber", "malm");
    expect(gated.kind).toBe("gated");
    if (gated.kind === "gated") {
      expect(gated.unsolved.map((p) => p.id)).toEqual(["sult"]);
    }
    expect(e.isDiscovered("bronze")).toBe(false);
  });

  it("age-up lykkes når alle obligatoriske problemer er løst og låser næste akts elementer op", () => {
    const e = freshEngine();
    playMainTrack(e);
    const outcome = e.combine("kobber", "malm");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.ageUp).toBe(true);
    expect(e.currentAct().act).toBe(2);
    const ids = e.availableElements().map((el) => el.id);
    expect(ids).toContain("korn");
    expect(ids).toContain("okse");
    expect(ids).toContain("sten"); // gamle elementer består
  });
});

describe("Save/load", () => {
  it("state overlever en serialiserings-rundtur", () => {
    const e = freshEngine();
    playMainTrack(e);
    const json = serialize(e.getState(), "2026-08-04T12:00:00Z");
    const restored = new Engine(content, deserialize(json));
    expect(restored.isSolved("sult")).toBe(true);
    expect(restored.isDiscovered("kobber")).toBe(true);
    const outcome = restored.combine("kobber", "malm");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.ageUp).toBe(true);
  });

  it("afviser ugyldige save-filer", () => {
    expect(() => deserialize('{"version":1,"state":{}}')).toThrow();
    expect(() => deserialize('{"version":99,"state":{}}')).toThrow();
  });
});
