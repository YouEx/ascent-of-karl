import { describe, expect, it } from "vitest";
import {
  ACTION_CAPABILITY,
  CAPABILITY_IDS,
  PRODUCT_EVENT_TYPES,
  SCENARIO_IDS,
} from "../src/product/generated/contracts";
import { semanticAttributes } from "../src/product/semantic";

describe("semantic UI foundation", () => {
  it("generates all approved capability, scenario and event ids", () => {
    expect(CAPABILITY_IDS).toHaveLength(12);
    expect(SCENARIO_IDS).toHaveLength(16);
    expect(PRODUCT_EVENT_TYPES).toHaveLength(13);
    expect(new Set(PRODUCT_EVENT_TYPES).size).toBe(PRODUCT_EVENT_TYPES.length);
  });

  it("returns stable semantic attributes for a valid action", () => {
    expect(
      semanticAttributes({
        capability: "craft.combine",
        scenario: "need.active",
        state: "ready",
        action: "combination.submit",
        entityId: "sten+pind",
      }),
    ).toEqual({
      "data-capability": "craft.combine",
      "data-scenario": "need.active",
      "data-state": "ready",
      "data-action": "combination.submit",
      "data-entity-id": "sten+pind",
    });
  });

  it("refuses an action rendered under the wrong capability", () => {
    expect(ACTION_CAPABILITY["chronicle.open"]).toBe("chronicle.life");
    expect(() =>
      semanticAttributes({
        capability: "craft.combine",
        scenario: "need.active",
        state: "ready",
        action: "chronicle.open",
      }),
    ).toThrow("chronicle.open belongs to chronicle.life, not craft.combine");
  });
});
