import { describe, expect, it } from "vitest";
// @ts-expect-error — parityværktøjet er ren JavaScript uden typedeklaration.
import {
  FIXTURES,
  normalizeParitySnapshot,
  normalizeSave,
} from "../tools/parity/harness.mjs";
import ciSource from "../.github/workflows/ci.yml?raw";

describe("legacy-to-Svelte differential parity harness", () => {
  it("covers the required visible and interaction checkpoints", () => {
    expect(FIXTURES.map((fixture: { id: string }) => fixture.id)).toEqual(
      expect.arrayContaining([
        "title-mobile",
        "title-desktop",
        "game-mobile",
        "game-desktop",
        "start-desktop",
        "select-desktop",
        "discovery-desktop",
        "no-fuse-desktop",
        "archive-desktop",
        "modal-desktop",
        "ending-desktop",
        "resume-desktop",
      ]),
    );
  });

  it("compares the legacy save contract without treating target-only fields as drift", () => {
    expect(
      normalizeSave(
        JSON.stringify({
          version: 1,
          savedAt: "dynamic",
          state: {
            act: 1,
            discovered: ["sten"],
            flags: ["ild"],
            solvedProblems: ["kulde"],
            attempts: 2,
            ended: null,
            seed: 42,
            lifePlan: { targetOnly: true },
            completedBranchIds: ["target-only"],
          },
        }),
      ),
    ).toEqual({
      version: 1,
      state: {
        act: 1,
        discovered: ["sten"],
        flags: ["ild"],
        solvedProblems: ["kulde"],
        attempts: 2,
        ended: null,
        seed: 42,
      },
    });
  });

  it("runs parity and outage browser gates in the Chromium-equipped CI job", () => {
    const uxJob = ciSource.slice(ciSource.indexOf("  ux-audit:"));
    expect(uxJob).toContain("npm run parity:check");
    expect(uxJob).toContain(
      "OUTAGE_BROWSER_TESTS=1 npx vitest run tests/network-outage-browser.test.ts",
    );
    expect(uxJob).toContain(
      "RUNTIME_COMMENTARY_BROWSER_TESTS=1 npx vitest run tests/runtime-commentary-browser.test.ts",
    );
  });

  it("normalizes browser-dependent synthesized/text-only fallback without hiding recorded audio", () => {
    const base = {
      productEvents: [
        { payload: { audioMode: "synthesized" } },
        { payload: { audioMode: "recorded" } },
      ],
      save: null,
    };
    const fallback = {
      productEvents: [
        { payload: { audioMode: "text-only" } },
        { payload: { audioMode: "recorded" } },
      ],
      save: null,
    };

    expect(normalizeParitySnapshot(base, base, {})).toEqual(
      normalizeParitySnapshot(fallback, base, {}),
    );
    expect(
      normalizeParitySnapshot(base, base, {}).productEvents[1].payload.audioMode,
    ).toBe("recorded");
  });

  it("ignores the hidden title subtree outside title fixtures", () => {
    const snapshot = {
      app: {
        children: [
          { attributes: { id: "game" } },
          { attributes: { id: "title-screen" } },
        ],
      },
      productEvents: [],
      save: null,
    };

    expect(
      normalizeParitySnapshot(snapshot, snapshot, { scope: "#app" })
        .app.children,
    ).toEqual([{ attributes: { id: "game" } }]);
    expect(
      normalizeParitySnapshot(snapshot, snapshot, { scope: "#title-screen" })
        .app.children,
    ).toHaveLength(2);
  });
});
