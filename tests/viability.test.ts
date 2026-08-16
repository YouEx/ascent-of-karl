import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import {
  validateLifeVariation,
  validateOpeningWitness,
} from "../src/core/viability";

describe("life-opening viability", () => {
  it("proves every admissible opening crosses the first age-up", () => {
    const results = validateLifeVariation(loadContent());
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.viable)).toBe(true);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
  });

  it("rejects a witness that uses an unavailable element", () => {
    const content = loadContent();
    const opening = structuredClone(content.lifeVariation!.openings[0]!);
    opening.elementIds = ["sten", "pind"];
    const result = validateOpeningWitness(content, opening);
    expect(result.viable).toBe(false);
    expect(result.errors.some((error) => error.includes("failed"))).toBe(true);
  });
});
