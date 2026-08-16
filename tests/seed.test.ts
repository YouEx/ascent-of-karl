import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import {
  decodeSeed,
  deriveLifePlan,
  encodeSeed,
  hash32,
  randomSeed,
} from "../src/core/seed";

const content = loadContent();
const variation = content.lifeVariation!;
const revision = content.completionManifest!.contentRevision;

describe("deterministic life seeds", () => {
  it("encodes and decodes the content revision and uint32 seed", () => {
    const code = encodeSeed(0xdeadbeef, revision);
    expect(code).toBe(`K1.${revision.toUpperCase()}.DEADBEEF`);
    expect(decodeSeed(code)).toEqual({
      seed: 0xdeadbeef,
      contentRevision: revision,
    });
  });

  it("derives byte-identical plans for the same seed", () => {
    expect(deriveLifePlan(variation, revision, 42)).toEqual(
      deriveLifePlan(variation, revision, 42),
    );
  });

  it("uses every authored opening while keeping bounded selections", () => {
    const plans = Array.from({ length: 256 }, (_, seed) =>
      deriveLifePlan(variation, revision, seed),
    );
    expect(new Set(plans.map((plan) => plan.openingId))).toEqual(
      new Set(variation.openings.map((opening) => opening.id)),
    );
    for (const plan of plans) {
      expect(plan.startingElementIds).toHaveLength(5);
      expect(plan.sidequestIds).toHaveLength(variation.sidequestsPerLife);
      expect(plan.challengeIds).toHaveLength(variation.challengesPerLife);
      expect(plan.sidequestIds).toEqual([...plan.sidequestIds].sort());
      expect(plan.challengeIds).toEqual([...plan.challengeIds].sort());
    }
  });

  it("keeps the established hash deterministic", () => {
    expect(hash32(1, "spawn", 6)).toBe(1432874732);
    expect(hash32(20260811, "opening", "riverbank")).toBe(2875161026);
  });

  it("accepts an injectable cryptographic random source", () => {
    expect(
      randomSeed((array) => {
        array[0] = 123456789;
        return array;
      }),
    ).toBe(123456789);
  });
});
