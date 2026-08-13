import { describe, expect, it } from "vitest";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { collectScoreRegressions, exceedsMaxDrop, normalizedDrop } from "../tools/judge/score-tolerance.mjs";

describe("score-tolerance — samme 4-decimalers dom overalt", () => {
  it("accepterer præcis 0,0200 og afviser den første normaliserede værdi over", () => {
    expect(normalizedDrop(0.5, 0.48)).toBe(0.02);
    expect(exceedsMaxDrop(0.5, 0.48, 0.02)).toBe(false);
    expect(normalizedDrop(0.5, 0.48004)).toBe(0.02);
    expect(exceedsMaxDrop(0.5, 0.48004, 0.02)).toBe(false);
    expect(normalizedDrop(0.5, 0.47995)).toBe(0.0201);
    expect(exceedsMaxDrop(0.5, 0.47995, 0.02)).toBe(true);
  });

  it("finder en aspektregression, selv når regionens overall forbedres", () => {
    const before = {
      screens: {
        title: {
          regions: {
            headline: {
              overall: 0.75,
              structure: 0.42,
              tone: 0.8,
              ink: 0.7,
              geometry: 0.99,
              materiality: 0.85,
            },
          },
        },
      },
    };
    const after = {
      screens: {
        title: {
          regions: {
            headline: {
              overall: 0.76,
              structure: 0.45,
              tone: 0.7799,
              ink: 0.72,
              geometry: 0.99,
              materiality: 0.86,
            },
          },
        },
      },
    };

    expect(collectScoreRegressions(before, after, {
      maxDrop: 0.02,
      screenIds: ["title"],
    })).toEqual([
      { region: "title/headline/tone", aspect: "tone", drop: 0.0201 },
    ]);
  });
});
