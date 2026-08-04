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

describe("Timeline: noder og silhuetter", () => {
  it("uopdagede elementer er noder uden kanter — opskriften afsløres ikke", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "pind"]));
    const ild = t.nodes.find((n) => n.id === "ild");
    expect(ild).toBeDefined();
    expect(ild!.discovered).toBe(false);
    expect(t.edges).toHaveLength(0);
  });

  it("opdagede resultater får kanter fra deres ingredienser", () => {
    const discovered = new Set(["sten", "pind", "graes", "gnister", "ild"]);
    const t = buildTimeline(content, 1, discovered);
    expect(t.edges).toContainEqual({ from: "sten", to: "gnister", komisk: false });
    expect(t.edges).toContainEqual({ from: "gnister", to: "ild", komisk: false });
    expect(t.edges).toContainEqual({ from: "graes", to: "ild", komisk: false });
    // stegt-koed er ikke opdaget → ingen kanter dertil
    expect(t.edges.some((e) => e.to === "stegt-koed")).toBe(false);
  });

  it("selv-kombination giver én kant, ikke to", () => {
    const t = buildTimeline(content, 1, new Set(["sten", "gnister"]));
    const stenEdges = t.edges.filter((e) => e.from === "sten" && e.to === "gnister");
    expect(stenEdges).toHaveLength(1);
  });

  it("komiske grene tagges på både noder og kanter", () => {
    const discovered = new Set(["larver", "ild", "ristede-larver", "ler", "larvefarm"]);
    const t = buildTimeline(content, 1, discovered);
    expect(t.nodes.find((n) => n.id === "ristede-larver")!.komisk).toBe(true);
    expect(t.nodes.find((n) => n.id === "larvefarm")!.komisk).toBe(true);
    expect(t.nodes.find((n) => n.id === "ild")!.komisk).toBe(false);
    expect(t.edges.find((e) => e.to === "ristede-larver")!.komisk).toBe(true);
  });

  it("viser kun den valgte akts elementer", () => {
    const t = buildTimeline(content, 2, new Set(["korn", "okse", "sten"]));
    expect(t.nodes.map((n) => n.id).sort()).toEqual(["korn", "okse"]);
  });

  it("noder er sorteret efter dybde (stabil bog-layout)", () => {
    const t = buildTimeline(content, 1, new Set());
    const depths = t.nodes.map((n) => n.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });
});
