import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { freshChallengeState, resolves, spawnChanceForGap, successRateForPage } from "../src/core/challenge";
import { loadContent } from "../src/content";

const content = loadContent();
const wolves = content.challenges.find((c) => c.id === "ulve")!;

describe("Challenges: sværhedsbånd", () => {
  it("de første ti sider lader alt lykkes", () => {
    expect(successRateForPage(1)).toBe(1);
    expect(successRateForPage(10)).toBe(1);
  });

  it("bliver gradvist hårdere", () => {
    const rates = [15, 25, 35, 45].map(successRateForPage);
    expect(rates).toEqual([0.8, 0.7, 0.6, 0.4]);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!).toBeLessThan(rates[i - 1]!);
    }
  });

  it("spawn-chancen stiger jo længere der går uden challenge", () => {
    const chances = [0, 10, 20, 30, 40].map(spawnChanceForGap);
    for (let i = 1; i < chances.length; i++) {
      expect(chances[i]!).toBeGreaterThan(chances[i - 1]!);
    }
  });
});

describe("Challenges: hvad der løser dem", () => {
  it("de oplagte svar virker altid, uanset hvor sent det er", () => {
    const late = { id: "ulve", startedAtPage: 50, turnsLeft: 4 };
    for (const id of wolves.solvedBy) {
      expect(resolves(wolves, late, id, 12345), id).toBe(true);
    }
  });

  it("tidligt i spillet løser ALT — fortælleren finder på noget", () => {
    const early = { id: "ulve", startedAtPage: 3, turnsLeft: 4 };
    const sample = content.elements.slice(0, 40).map((e) => e.id);
    expect(sample.every((id) => resolves(wolves, early, id, 999))).toBe(true);
  });

  it("er deterministisk — samme element kan ikke prøves igen for held", () => {
    const active = { id: "ulve", startedAtPage: 45, turnsLeft: 3 };
    const first = content.elements.map((e) => resolves(wolves, active, e.id, 777));
    const again = content.elements.map((e) => resolves(wolves, active, e.id, 777));
    expect(again).toEqual(first);
  });

  it("rammer omtrent det lovede sværhedsbånd", () => {
    const active = { id: "ulve", startedAtPage: 45, turnsLeft: 3 }; // 40 %
    const others = content.elements.filter((e) => !wolves.solvedBy.includes(e.id));
    const ok = others.filter((e) => resolves(wolves, active, e.id, 4242)).length;
    const rate = ok / others.length;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.5);
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
    // stenøkse står selv i solvedBy — ulvene ser våbnet med det samme
    const out = e.combine("sten", "pind");
    expect(out.challenge?.kind).toBe("solved");
    if (out.challenge?.kind === "solved") {
      expect(out.challenge.by.id).toBe("stenoekse");
    }
    expect(e.activeChallenge()).toBeNull();
  });

  it("fristen tæller ned og slutter runnet når den er brugt op", () => {
    const e = engineWith({ id: "ulve", startedAtPage: 20, turnsLeft: 2 });
    e.combine("baer", "ler"); // ingenting — koster en sommer
    expect(e.activeChallenge()?.active.turnsLeft).toBe(1);
    const out = e.combine("baer", "ler");
    expect(out.challenge?.kind).toBe("failed");
    expect(e.activeEnding()?.id).toBe("aedt");
    expect(() => e.combine("baer", "ler")).toThrow();
  });

  it("challenge-tilstand overlever save/load", () => {
    const e = engineWith({ id: "ulve", startedAtPage: 20, turnsLeft: 3 });
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
