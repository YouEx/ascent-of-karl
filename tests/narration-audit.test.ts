import { describe, expect, it } from "vitest";
import { assertNarrationParity } from "../tools/narration_audit.mjs";

describe("narration parity-audit", () => {
  it("afviser et nyt beat før forrige lyd+tekst er færdigt", () => {
    expect(() =>
      assertNarrationParity([
        {
          phase: "start",
          id: "intro",
          variant: 0,
          text: "Intro",
          audioMode: "recorded",
        },
        {
          phase: "start",
          id: "pull",
          variant: 0,
          text: "Pull",
          audioMode: "text-only",
        },
        {
          phase: "complete",
          id: "intro",
          variant: 0,
          text: "Intro",
          audioMode: "recorded",
        },
      ]),
    ).toThrow(/før intro var færdig/);
  });

  it("afviser en synlig replik uden recorded eller synthesized lyd", () => {
    expect(() =>
      assertNarrationParity([
        {
          phase: "start",
          id: "pull",
          variant: 0,
          text: "Pull",
          audioMode: "text-only",
        },
        {
          phase: "complete",
          id: "pull",
          variant: 0,
          text: "Pull",
          audioMode: "text-only",
        },
      ]),
    ).toThrow(/pull.*text-only/);
  });

  it("godkender atomiske recorded og synthesized beats", () => {
    expect(() =>
      assertNarrationParity([
        {
          phase: "start",
          id: "intro",
          variant: 0,
          text: "Intro",
          audioMode: "recorded",
        },
        {
          phase: "complete",
          id: "intro",
          variant: 0,
          text: "Intro",
          audioMode: "recorded",
        },
        {
          phase: "start",
          id: "pull",
          variant: 0,
          text: "Pull",
          audioMode: "synthesized",
        },
        {
          phase: "complete",
          id: "pull",
          variant: 0,
          text: "Pull",
          audioMode: "synthesized",
        },
      ]),
    ).not.toThrow();
  });
});
