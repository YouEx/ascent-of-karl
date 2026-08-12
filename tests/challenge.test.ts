import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { freshChallengeState, resolves, spawnChanceForGap } from "../src/core/challenge";
import { loadContent } from "../src/content";

const content = loadContent();
const wolves = content.challenges.find((c) => c.id === "ulve")!;
const elementById = new Map(content.elements.map((e) => [e.id, e]));

describe("Challenges: hvornår de dukker op", () => {
  it("spawn-chancen stiger jo længere der går uden challenge", () => {
    const chances = [0, 10, 20, 30, 40].map(spawnChanceForGap);
    for (let i = 1; i < chances.length; i++) {
      expect(chances[i]!).toBeGreaterThan(chances[i - 1]!);
    }
  });
});

describe("Challenges: hvad der løser dem", () => {
  it("de oplagte svar virker altid, uanset hvor sent det er", () => {
    // alsoSolvedBy er facit-listen — de mennesker-skrevne svar fra før
    // taksonomien fandtes. Prædikatet skal acceptere hvert eneste af dem,
    // ellers er taggene forkerte. Samme krav som porten i
    // tools/predicate_report.py.
    for (const id of wolves.alsoSolvedBy) {
      const el = elementById.get(id);
      expect(el, id).toBeDefined();
      expect(resolves(wolves, el!, content.predicates), id).toBe(true);
    }
  });

  it("dømmer på hvad tingen er, ikke på hvornår den bliver prøvet", () => {
    // Det gamle system gav gratis sejre før side 10 og terningkast bagefter.
    // Nu er svaret det samme uanset side: enten skræmmer tingen ulve, eller
    // også gør den ikke.
    const spear = elementById.get("spyd")!;
    const berry = elementById.get("baer")!;
    expect(resolves(wolves, spear, content.predicates)).toBe(true);
    expect(resolves(wolves, berry, content.predicates)).toBe(false);
  });

  it("lader ikke hvad som helst redde Karl", () => {
    // Generøs, men ikke gratis: hvis alt løste alt, var der intet valg.
    const solving = content.elements.filter((e) =>
      resolves(wolves, e, content.predicates),
    );
    expect(solving.length).toBeGreaterThan(wolves.alsoSolvedBy.length);
    expect(solving.length).toBeLessThan(content.elements.length / 2);
  });

  it("er deterministisk — samme element giver samme svar hver gang", () => {
    const first = content.elements.map((e) => resolves(wolves, e, content.predicates));
    const again = content.elements.map((e) => resolves(wolves, e, content.predicates));
    expect(again).toEqual(first);
  });
});

describe("Challenges: forløbet i motoren", () => {
  function engineWith(active: { id: string; startedAtPage: number; turnsLeft: number }) {
    const e = new Engine(content);
    const s = e.getState();
    e.loadState({
      ...s,
      discovered: [...s.discovered, "ild", "gnister"],
      attempts: 20,
      seed: 5,
      challenges: { ...freshChallengeState(), active, everSpawned: true, seen: [active.id] },
    });
    return e;
  }

  it("et oplagt svar løser challenget og fjerner presset", () => {
    const e = engineWith({ id: "ulve", startedAtPage: 20, turnsLeft: 3 });
    // stenøkse står selv i alsoSolvedBy — ulvene ser våbnet med det samme
    const out = e.combine("sten", "pind");
    expect(out.challenge?.kind).toBe("solved");
    if (out.challenge?.kind === "solved") {
      expect(out.challenge.by.id).toBe("stenoekse");
    }
    expect(e.activeChallenge()).toBeNull();
  });

  /**
   * En Karl uden svar. Fristen kan kun måles på ham: har han ild eller
   * gnister i hånden, viger ulvene med det samme — og det er meningen.
   */
  function engineUdenSvar(active: { id: string; startedAtPage: number; turnsLeft: number }) {
    const e = new Engine(content);
    const s = e.getState();
    e.loadState({
      ...s,
      attempts: 20,
      seed: 5,
      challenges: { ...freshChallengeState(), active, everSpawned: true, seen: [active.id] },
    });
    return e;
  }

  it("et svar, Karl allerede har, får truslen til at vige", () => {
    // Reglen var før, at kun et NYT fund talte. Den straffede omhu: den
    // metodiske spiller havde brugt de lette svar, før ulvene kom.
    const e = engineWith({ id: "ulve", startedAtPage: 20, turnsLeft: 3 });
    const out = e.combine("baer", "ler"); // ingen opdagelse — ilden står der bare
    expect(out.challenge?.kind).toBe("solved");
    expect(e.activeChallenge()).toBeNull();
  });

  it("men den dræber stadig den, der intet har", () => {
    const e = engineUdenSvar({ id: "ulve", startedAtPage: 20, turnsLeft: 1 });
    const out = e.combine("baer", "ler");
    expect(out.challenge?.kind).toBe("failed");
    expect(e.activeEnding()?.id).toBe("aedt");
  });

  it("fristen tæller ned og slutter runnet når den er brugt op", () => {
    const e = engineUdenSvar({ id: "ulve", startedAtPage: 20, turnsLeft: 2 });
    e.combine("baer", "ler"); // ingenting — koster en sommer
    expect(e.activeChallenge()?.active.turnsLeft).toBe(1);
    const out = e.combine("baer", "ler");
    expect(out.challenge?.kind).toBe("failed");
    expect(e.activeEnding()?.id).toBe("aedt");
    expect(() => e.combine("baer", "ler")).toThrow();
  });

  it("challenge-tilstand overlever save/load", () => {
    const e = engineUdenSvar({ id: "ulve", startedAtPage: 20, turnsLeft: 3 });
    e.combine("baer", "ler");
    const saved = JSON.parse(JSON.stringify(e.getState()));
    const e2 = new Engine(content);
    e2.loadState(saved);
    expect(e2.activeChallenge()?.active.turnsLeft).toBe(2);
    expect(e2.activeChallenge()?.def.id).toBe("ulve");
  });

  it("et frisk run har ikke mødt noget challenge (Carl the Lucky)", () => {
    expect(new Engine(content).neverChallenged()).toBe(true);
  });

  it("gamle saves uden challenge-felt kan stadig indlæses", () => {
    const e = new Engine(content);
    e.loadState({ act: 1, discovered: ["sten"], flags: [], solvedProblems: [], attempts: 3 } as never);
    expect(e.activeChallenge()).toBeNull();
    expect(e.neverChallenged()).toBe(true);
  });
});
