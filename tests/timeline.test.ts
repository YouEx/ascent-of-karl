import { describe, expect, it } from "vitest";
import { buildTimeline, computeDepths } from "../src/core/timeline";
import { loadContent } from "../src/content";

const content = loadContent();

describe("Timeline: dybder", () => {
  it("base-elementer ligger på dybde 0 og opskrifter bygger ovenpå", () => {
    const depths = computeDepths(content);
    expect(depths.get("sten")).toBe(0);
    expect(depths.get("gnister")).toBe(1); // sten + sten
    expect(depths.get("ild")).toBe(2); // gnister + græs
    expect(depths.get("stenoekse")).toBe(1); // sten + pind
    expect(depths.get("koed")).toBe(3); // spyd(2) + dyr(0)
    expect(depths.get("stegt-koed")).toBe(4);
  });

  it("alle akt 1-elementer har en dybde (ingen huller i grafen)", () => {
    const depths = computeDepths(content);
    for (const el of content.elements.filter((e) => e.act === 1)) {
      expect(depths.has(el.id), el.id).toBe(true);
    }
  });
});

describe("Timeline: frontier (progressive disclosure)", () => {
  it("viser kun opdagede plus dem der kan nås med én kombination", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind"]));
    const ids = t.nodes.map((n) => n.id).sort();
    // sten+sten=gnister, sten+pind=stenøkse, pind+pind=boomerang er inden for rækkevidde
    expect(ids).toEqual(["boomerang", "gnister", "pind", "sten", "stenoekse"]);
    // ild kræver gnister+græs — for langt ude, tælles kun
    expect(ids).not.toContain("ild");
    expect(t.hidden).toBeGreaterThan(50);
  });

  it("markerer frontier-noder som uopdagede", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind"]));
    const gnister = t.nodes.find((n) => n.id === "gnister")!;
    expect(gnister.frontier).toBe(true);
    expect(gnister.discovered).toBe(false);
    const sten = t.nodes.find((n) => n.id === "sten")!;
    expect(sten.frontier).toBe(false);
    expect(sten.discovered).toBe(true);
  });

  it("respekterer flag-krav: låst opskrift er ikke frontier", () => {
    const base = new Set(["larver", "ler"]);
    // larvefarm kræver flaget "larver"
    const uden = buildTimeline(content, 1, base);
    expect(uden.nodes.map((n) => n.id)).not.toContain("larvefarm");
    const med = buildTimeline(content, 1, base, new Set(["larver"]));
    expect(med.nodes.map((n) => n.id)).toContain("larvefarm");
  });

  it("tæller opdagede ud af alle mulige opdagelser i akten", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind", "gnister"]));
    expect(t.found).toBe(1); // kun gnister er en opdagelse (sten/pind er base)
    expect(t.total).toBe(content.elements.filter((e) => e.act === 1 && !e.base).length);
  });
});

describe("Timeline: kanter", () => {
  it("opdagede resultater får kanter fra deres ingredienser", () => {
    const discovered = new Set(["sten", "pind", "graes", "gnister", "ild"]);
    const t = buildTimeline(content, 1, discovered);
    expect(t.edges).toContainEqual({ from: "sten", to: "gnister", komisk: false });
    expect(t.edges).toContainEqual({ from: "gnister", to: "ild", komisk: false });
    expect(t.edges).toContainEqual({ from: "graes", to: "ild", komisk: false });
  });

  it("frontier-noder får ingen kanter — opskriften afsløres ikke", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind"]));
    expect(t.edges.some((e) => e.to === "gnister")).toBe(false);
  });

  it("selv-kombination giver én kant, ikke to", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "gnister"]));
    const stenEdges = t.edges.filter((e) => e.from === "sten" && e.to === "gnister");
    expect(stenEdges).toHaveLength(1);
  });

  it("komiske grene tagges på både noder og kanter", () => {
    const discovered = new Set(["larver", "ild", "ristede-larver", "ler", "larvefarm"]);
    const t = buildTimeline(content, 1, discovered, new Set(["larver"]));
    expect(t.nodes.find((n) => n.id === "ristede-larver")!.komisk).toBe(true);
    expect(t.nodes.find((n) => n.id === "larvefarm")!.komisk).toBe(true);
    expect(t.nodes.find((n) => n.id === "ild")!.komisk).toBe(false);
    expect(t.edges.find((e) => e.to === "ristede-larver")!.komisk).toBe(true);
  });
});

describe("Timeline: aktafgrænsning og sortering", () => {
  it("viser kun den valgte akts elementer", () => {
    const t = buildTimeline(content, 2, new Set(["korn", "okse", "sten"]));
    expect(t.nodes.map((n) => n.id).sort()).toEqual(["korn", "okse"]);
  });

  it("noder er sorteret efter dybde (stabilt bog-layout)", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind", "graes", "gnister", "ild"]));
    const depths = t.nodes.map((n) => n.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });
});
