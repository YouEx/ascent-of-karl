import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import {
  applyCompletionUnlocks,
  freshCompendium,
} from "../src/core/compendium";
import { selectReplayTargets } from "../src/core/replay";

const content = loadContent();
const provenance = {
  firstLifeId: "life-1",
  unlockedAt: "2026-08-16T08:00:00Z",
  viaInvention: false,
};

describe("replay targets", () => {
  it("offers broad authored gaps without recipe pairs", () => {
    const targets = selectReplayTargets(content, freshCompendium());
    expect(targets.some((target) => target.kind === "branch")).toBe(true);
    expect(targets.some((target) => target.kind === "ending")).toBe(true);
    expect(targets.some((target) => target.kind === "discovery-area")).toBe(
      true,
    );
    expect(JSON.stringify(targets)).not.toMatch(
      /"pair"|"sten"\s*,\s*"pind"/,
    );
  });

  it("removes completed branch and ending targets", () => {
    const compendium = applyCompletionUnlocks(
      freshCompendium(),
      ["branch:larvemanden", "ending:et-helt-liv"],
      provenance,
    );
    const targets = selectReplayTargets(content, compendium);
    expect(
      targets.some(
        (target) =>
          target.kind === "branch" && target.branchId === "larvemanden",
      ),
    ).toBe(false);
    expect(
      targets.some(
        (target) =>
          target.kind === "ending" && target.endingId === "et-helt-liv",
      ),
    ).toBe(false);
  });
});
