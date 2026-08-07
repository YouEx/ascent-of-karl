import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { freshChallengeState } from "../src/core/challenge";
import { deserialize, serialize } from "../src/core/save";
import { loadContent } from "../src/content";

const content = loadContent();

function freshEngine(): Engine {
  return new Engine(content);
}

/** Spiller hovedsporet frem til (men ikke inklusive) bronze. */
/**
 * Fylder op med opfundne elementer, så Karl er over skæbne-grænsen.
 * Skæbner er gated på antal opfindelser (se Engine.endingsUnlocked); tests der
 * vil ramme en slutning skal derfor have et liv bag sig først.
 */
function withInventions(discovered: string[]): string[] {
  const endingResults = new Set(
    content.combos.filter((c) => c.ending).map((c) => c.result),
  );
  const padding = content.elements
    .filter(
      (e) =>
        !e.base && !discovered.includes(e.id) && !endingResults.has(e.id),
    )
    .map((e) => e.id)
    .slice(0, content.config.endingsUnlockAt);
  return [...discovered, ...padding];
}

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

describe("Engine: slutninger og levetid", () => {
  const baseState = {
    act: 1,
    flags: [],
    solvedProblems: [],
    attempts: 0,
    ended: null,
    challenges: freshChallengeState(),
    seed: 1,
  };

  it("en skæbne-kombination afslutter runnet og låser videre spil", () => {
    const e = freshEngine();
    e.loadState({
      ...baseState,
      discovered: withInventions(["mudderkage", "grottebryg"]),
    });
    const outcome = e.combine("mudderkage", "grottebryg");
    expect(outcome.kind).toBe("discovery");
    expect(e.activeEnding()?.id).toBe("gourmet");
    expect(() => e.combine("mudderkage", "grottebryg")).toThrow();
  });

  it("alderdommen indtræffer når somrene slipper op", () => {
    const e = freshEngine();
    const limit = content.config.turnLimit;
    e.loadState({ ...baseState, discovered: ["baer", "ler"], attempts: limit - 1 });
    e.combine("baer", "ler"); // fiasko — men sidste sommer
    expect(e.activeEnding()?.id).toBe("et-helt-liv");
    expect(e.remainingTurns()).toBe(0);
  });

  it("dybe opdagelser koster ekstra somre (cost)", () => {
    const e = freshEngine();
    e.loadState({ ...baseState, discovered: ["landsby", "festdragt"] });
    e.combine("landsby", "festdragt"); // kroning, cost 3
    expect(content.config.turnLimit - e.remainingTurns()).toBe(3);
  });

  it("gamle saves uden ended-felt kan stadig indlæses", () => {
    const e = freshEngine();
    const legacy = { act: 1, discovered: ["sten"], flags: [], solvedProblems: [], attempts: 5 };
    e.loadState(legacy as never);
    expect(e.activeEnding()).toBeNull();
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

describe("Engine: skæbner er gated på antal opfindelser", () => {
  /** Korteste vej til Ikaros-slutningen: fire kombinationer. */
  function flyToTheSun(e: Engine): void {
    e.combine("fugl", "nabo"); // fjer
    e.combine("fjer", "fjer"); // vinger
    e.combine("sten", "nabo"); // bautasten
    e.combine("vinger", "bautasten"); // flyveforsoeg → icarus
  }

  it("base-elementer tæller ikke som opfindelser", () => {
    const e = freshEngine();
    expect(e.inventions()).toBe(0);
    e.combine("sten", "sten");
    expect(e.inventions()).toBe(1);
  });

  it("afværger en skæbne når Karl har opfundet for lidt", () => {
    const e = freshEngine();
    flyToTheSun(e);
    const s = e.getState();
    expect(s.ended).toBeNull();
    expect(s.discovered).toContain("flyveforsoeg");
    expect(e.inventions()).toBeLessThan(content.config.endingsUnlockAt);
  });

  it("melder afværgningen tilbage, så fortælleren kan reagere", () => {
    const e = freshEngine();
    e.combine("fugl", "nabo");
    e.combine("fjer", "fjer");
    e.combine("sten", "nabo");
    const outcome = e.combine("vinger", "bautasten");
    expect(outcome.kind).toBe("discovery");
    if (outcome.kind === "discovery") expect(outcome.endingDeflected).toBe(true);
  });

  it("mister ikke skæbnen: den kan opsøges igen når grænsen er nået", () => {
    const e = freshEngine();
    flyToTheSun(e);
    expect(e.getState().ended).toBeNull();

    // Karl lever videre og opfinder sig op over grænsen
    const s = e.getState();
    e.loadState({ ...s, discovered: withInventions(s.discovered) });
    expect(e.inventions()).toBeGreaterThanOrEqual(content.config.endingsUnlockAt);

    // Samme kombination igen — nu er resultatet kendt, men skæbnen venter
    const again = e.combine("vinger", "bautasten");
    expect(again.kind).toBe("known");
    expect(e.getState().ended).toBe("icarus");
  });

  it("alderdommen rammer uanset hvor lidt Karl har opfundet", () => {
    const e = freshEngine();
    // Tøm challenge-puljen, så testen måler alderdommen og intet andet
    const s0 = e.getState();
    e.loadState({
      ...s0,
      challenges: { ...s0.challenges, seen: content.challenges.map((c) => c.id) },
    });
    while (e.getState().attempts < content.config.turnLimit) {
      e.combine("sten", "vand");
    }
    const ending = e.activeEnding();
    expect(ending?.automatic).toBe(true);
  });
});
