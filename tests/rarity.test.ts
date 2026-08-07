import { describe, expect, it } from "vitest";
import { computeRarity } from "../src/core/rarity";
import { loadContent } from "../src/content";

const content = loadContent();
const rarity = computeRarity(content);
const tierOf = (id: string) => rarity.get(id)!.tier;

describe("Sjældenhed: udledt af grafen", () => {
  it("dækker hvert element", () => {
    expect(rarity.size).toBe(content.elements.length);
  });

  it("base-elementer er altid common — de er ikke fundet, de var der", () => {
    for (const e of content.elements.filter((x) => x.base)) {
      expect(tierOf(e.id), e.id).toBe("common");
    }
  });

  it("alt der afslutter et run er unique", () => {
    for (const c of content.combos.filter((x) => x.ending)) {
      expect(tierOf(c.result), c.result).toBe("unique");
    }
  });

  it("fordelingen er 'de fleste common, nogle rare, få unique'", () => {
    const n = content.elements.length;
    const count = { common: 0, rare: 0, unique: 0 };
    for (const info of rarity.values()) count[info.tier]++;
    expect(count.common / n).toBeGreaterThan(0.5);
    expect(count.rare / n).toBeGreaterThan(0.1);
    expect(count.rare / n).toBeLessThan(0.4);
    expect(count.unique / n).toBeLessThan(0.1);
    expect(count.unique).toBeGreaterThan(0);
  });

  it("er deterministisk — samme indhold, samme etiketter", () => {
    const again = computeRarity(content);
    for (const [id, info] of rarity) {
      expect(again.get(id)!.tier, id).toBe(info.tier);
    }
  });

  it("en genvej til et element gør det mindre sjældent", () => {
    // Rav er rare. Giv den en opskrift fra to base-elementer og se den falde.
    expect(tierOf("rav")).toBe("rare");
    const patched = {
      ...content,
      combos: [
        ...content.combos,
        { pair: ["sten", "vand"] as [string, string], result: "rav" },
      ],
    };
    expect(computeRarity(patched).get("rav")!.tier).toBe("common");
  });

  it("dybde måles som færreste kombinationer fra base", () => {
    expect(rarity.get("gnister")!.depth).toBe(1); // sten + sten
    expect(rarity.get("ild")!.depth).toBe(2); // gnister + græs
  });
});
