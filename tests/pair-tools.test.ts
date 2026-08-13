import { describe, expect, it } from "vitest";
import baked from "../content/narrator/pairs-act-1.json";
// @ts-expect-error — hjælpefilen er ren ESM uden typedeklaration.
import { bakedLookupKeys, bakedPairKeys } from "../tools/pair_lookup.mjs";

describe("værktøjerne læser det kompakte pairs-array", () => {
  it("bevarer alle par+dom-opslag", () => {
    const keys = bakedLookupKeys(baked);
    expect(keys.size).toBe(baked.pairs.length);
    expect(keys.has(baked.pairs[0])).toBe(true);
  });

  it("udleder unikke par uden dom til næste bagebatch", () => {
    const pairs = bakedPairKeys(baked);
    expect(pairs.size).toBe(baked.pairs.length);
    expect([...pairs].every((key) => !key.includes(":"))).toBe(true);
    expect(pairs.has(baked.pairs[0]!.slice(0, baked.pairs[0]!.lastIndexOf(":")))).toBe(true);
  });

  it("afviser den gamle objektform frem for stiltiende at læse array-indeks", () => {
    expect(() => bakedLookupKeys({ pairs: { "a+b:inert": "pair-a-b-inert" } })).toThrow(
      /pairs skal være en liste/,
    );
  });
});
