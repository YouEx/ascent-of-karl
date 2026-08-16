import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import {
  archiveLife,
  createActiveLife,
} from "../src/core/life";
import { archivedRunSummary } from "../src/ui/run-summary";

const content = loadContent();

describe("archived run summary", () => {
  it("includes life, seed, fate, authored progress and bounded inventions", () => {
    const active = createActiveLife({
      content,
      lifeId: "life-summary",
      startedAt: "2026-08-16T08:00:00Z",
      seed: 42,
    });
    active.engine = {
      ...active.engine,
      attempts: 17,
      ended: "et-helt-liv",
      discovered: [...active.engine.discovered, "ild"],
      completedBranchIds: ["overleveren"],
      improvisedElements: Array.from({ length: 7 }, (_, index) => ({
        id: `improv-${index}`,
        origin: "improvised" as const,
        parents: ["sten", "pind"] as [string, string],
        name: `Invention ${index}`,
        emoji: "",
        act: 1,
        base: false,
        depth: 1,
        terminal: false,
        kind: "tool" as const,
        stuff: "wood" as const,
        traits: ["hard"] as const,
        scale: "hand" as const,
      })),
    };
    const archive = archiveLife(
      active,
      { kind: "ending", endingId: "et-helt-liv" },
      "2026-08-16T09:00:00Z",
    );
    const summary = archivedRunSummary(archive, {
      canonicalIds: new Set(content.completionManifest!.discoveries),
      authoredUnlocks: [
        "discovery:ild",
        "branch:overleveren",
        "ending:et-helt-liv",
      ],
      replayTargets: [
        {
          kind: "branch",
          branchId: "larvemanden",
          label: "Try the larvae",
          area: "food",
        },
      ],
    });
    expect(summary.lifeId).toBe("life-summary");
    expect(summary.seedCode).toMatch(/^K1\./);
    expect(summary.fate).toBe("et-helt-liv");
    expect(summary.summers).toBe(17);
    expect(summary.majorBranches).toEqual(["overleveren"]);
    expect(summary.inventions.total).toBe(7);
    expect(summary.inventions.names).toHaveLength(5);
  });
});
