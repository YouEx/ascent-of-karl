import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import {
  applyArchivedLife,
  archiveLife,
  createActiveLife,
  freshProfile,
} from "../src/core/life";
import { InMemoryProfileStore } from "../src/persistence/profile-store";
import { freshNarratorState } from "../src/narrator/narrator";

const content = loadContent();

describe("life aggregate and immutable archives", () => {
  it("creates a seeded life with a bounded opening and selected sidequests", () => {
    const life = createActiveLife({
      content,
      lifeId: "life-1",
      startedAt: "2026-08-16T08:00:00Z",
      seed: 42,
    });
    expect(life.plan.startingElementIds).toHaveLength(5);
    expect(life.plan.sidequestIds).toHaveLength(2);
    expect(life.plan.challengeIds).toHaveLength(2);
    expect(life.engine.discovered).toEqual(life.plan.startingElementIds);
    expect(life.engine.lifePlan).toEqual(life.plan);
    expect(life.narrator).toEqual(freshNarratorState(42));
  });

  it("records authored branches after deterministic Engine transitions", () => {
    const life = Array.from({ length: 256 }, (_, seed) =>
      createActiveLife({
        content,
        lifeId: `life-${seed}`,
        startedAt: "2026-08-16T08:00:00Z",
        seed,
      }),
    ).find((candidate) =>
      candidate.plan.sidequestIds.includes("overleveren"),
    )!;
    const engine = new Engine(content, life.engine);
    const opening = content.lifeVariation!.openings.find(
      (entry) => entry.id === life.plan.openingId,
    )!;
    for (const [left, right] of opening.viabilityWitness) {
      engine.combine(left, right);
    }
    expect(engine.getState().completedBranchIds).toContain("overleveren");
  });

  it("archives once and applies only authored completion keys", async () => {
    const active = createActiveLife({
      content,
      lifeId: "life-3",
      startedAt: "2026-08-16T08:00:00Z",
      seed: 9,
    });
    active.engine = {
      ...active.engine,
      discovered: [...active.engine.discovered, "ild", "improv-fake"],
      completedBranchIds: ["overleveren"],
      ended: "et-helt-liv",
    };
    const archive = archiveLife(
      active,
      { kind: "ending", endingId: "et-helt-liv" },
      "2026-08-16T09:00:00Z",
    );
    const profile = applyArchivedLife(
      { ...freshProfile(), activeLife: active },
      content,
      archive,
    );
    expect(profile.activeLife).toBeNull();
    expect(Object.keys(profile.compendium.unlocks)).toEqual([
      "branch:overleveren",
      "discovery:ild",
      "ending:et-helt-liv",
    ]);
    expect(() => applyArchivedLife(profile, content, archive)).toThrow(
      "Life life-3 is already archived",
    );

    const store = new InMemoryProfileStore();
    await store.finalizeLife(profile, archive);
    expect((await store.loadArchive("life-3"))?.lifeId).toBe("life-3");
    await expect(store.finalizeLife(profile, archive)).rejects.toThrow(
      "Life life-3 is already archived",
    );

    const replacementProfile = freshProfile();
    const replacementArchive = {
      ...archive,
      lifeId: "life-replacement",
    };
    await store.replaceAll(replacementProfile, [replacementArchive]);
    expect(await store.loadProfile()).toEqual(replacementProfile);
    expect(await store.listArchives()).toEqual([replacementArchive]);
  });
});
