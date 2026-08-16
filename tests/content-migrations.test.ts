import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine, type GameState } from "../src/core/engine";
import {
  migrateArchivedLifeToCurrentContent,
  migrateGameStateToCurrentContent,
  migrateProfileToCurrentContent,
} from "../src/core/content-migrations";
import {
  buildFallbackElement,
  improvisedElementId,
} from "../src/core/improvise";
import { deriveLifePlan, encodeSeed } from "../src/core/seed";
import type {
  ContentBundle,
  ContentMigrationsDef,
} from "../src/core/types";
import { freshNarratorState } from "../src/narrator/narrator";

const OLD_REVISION = "aaaaaaaaaaaaaaaa";
const CURRENT_REVISION = "bbbbbbbbbbbbbbbb";

function migrationContent(): ContentBundle {
  const content = structuredClone(loadContent());
  content.completionManifest = {
    ...content.completionManifest!,
    contentRevision: CURRENT_REVISION,
  };
  content.migrations = {
    schemaVersion: 1,
    targetRevision: CURRENT_REVISION,
    supportedSourceRevisions: [OLD_REVISION],
    elementAliases: { "gammel-sten": "sten" },
    branchAliases: { "gammel-gren": "overleveren" },
    endingAliases: { "gammel-slutning": "et-helt-liv" },
  } satisfies ContentMigrationsDef;
  return content;
}

function staleState(content: ContentBundle) {
  const state = new Engine(content, undefined, {
    lifePlan: deriveLifePlan(
      content.lifeVariation!,
      CURRENT_REVISION,
      1,
    ),
  }).getState();
  const currentPlan = state.lifePlan!;
  const oldInvention = buildFallbackElement(
    content.elements.find((element) => element.id === "sten")!,
    content.elements.find((element) => element.id === "graes")!,
  );
  oldInvention.parents = ["gammel-sten", "graes"];
  oldInvention.id = improvisedElementId("gammel-sten", "graes");
  return {
    ...state,
    discovered: [
      ...state.discovered.filter((id) => id !== "sten"),
      "gammel-sten",
      oldInvention.id,
    ],
    lifePlan: {
      ...currentPlan,
      contentRevision: OLD_REVISION,
      seedCode: encodeSeed(currentPlan.seed, OLD_REVISION),
      startingElementIds: currentPlan.startingElementIds.map((id) =>
        id === "sten" ? "gammel-sten" : id,
      ),
      sidequestIds: ["gammel-gren"],
    },
    decisions: {
      ...state.decisions,
      taken: [
        {
          id: "gave",
          answeredWith: "gammel-sten",
          tag: "materiale",
          score: 3,
        },
      ],
    },
    completedBranchIds: ["gammel-gren"],
    ended: "gammel-slutning",
    improvisedElements: [oldInvention],
    creditedImprovised: [oldInvention.id],
  };
}

describe("content revision migrations", () => {
  it("maps element, invention-parent, branch and ending ids before Engine filtering", () => {
    const content = migrationContent();
    const migrated = migrateGameStateToCurrentContent(
      content,
      staleState(content),
    );
    const migratedInvention = migrated.improvisedElements?.[0]!;
    const expectedInventionId = improvisedElementId("sten", "graes");

    expect(migrated.lifePlan?.contentRevision).toBe(CURRENT_REVISION);
    expect(migrated.lifePlan?.seedCode).toBe(
      encodeSeed(migrated.seed!, CURRENT_REVISION),
    );
    expect(migrated.lifePlan?.startingElementIds).toContain("sten");
    expect(migrated.lifePlan?.sidequestIds).toEqual(["overleveren"]);
    expect(migrated.discovered).toContain("sten");
    expect(migrated.discovered).toContain(expectedInventionId);
    expect(migrated.completedBranchIds).toEqual(["overleveren"]);
    expect(migrated.ended).toBe("et-helt-liv");
    expect(migrated.decisions?.taken[0]?.answeredWith).toBe("sten");
    expect(migratedInvention.parents).toEqual(["graes", "sten"]);
    expect(migratedInvention.id).toBe(expectedInventionId);
    expect(migrated.creditedImprovised).toEqual([expectedInventionId]);

    const loaded = new Engine(content, staleState(content)).getState();
    expect(loaded.discovered).toContain("sten");
    expect(loaded.discovered).toContain(expectedInventionId);
    expect(loaded.completedBranchIds).toEqual(["overleveren"]);
    expect(loaded.ended).toBe("et-helt-liv");
  });

  it("fails closed for an unsupported content revision", () => {
    const content = migrationContent();
    const state = staleState(content);
    state.lifePlan = {
      ...state.lifePlan!,
      contentRevision: "cccccccccccccccc",
      seedCode: encodeSeed(state.seed!, "cccccccccccccccc"),
    };
    expect(() =>
      migrateGameStateToCurrentContent(content, state),
    ).toThrow("Unsupported content revision cccccccccccccccc");
  });

  it("fails instead of silently dropping an unmapped stale canonical id", () => {
    const content = migrationContent();
    const state = staleState(content);
    state.discovered.push("fjernet-uden-alias");
    expect(() =>
      migrateGameStateToCurrentContent(content, state),
    ).toThrow("Missing element alias for fjernet-uden-alias");
  });

  it("preserves pre-LifePlan legacy saves for the existing migration path", () => {
    const content = migrationContent();
    const { lifePlan: _lifePlan, ...legacyWithoutPlan } =
      new Engine(content).getState();
    const legacy: GameState = legacyWithoutPlan;
    expect(
      migrateGameStateToCurrentContent(content, legacy).discovered,
    ).toEqual(legacy.discovered);
  });

  it("migrates the complete ProfileV2 aggregate instead of only the temporary Engine", () => {
    const content = migrationContent();
    const state = staleState(content);
    const oldInvention = state.improvisedElements[0]!;
    const provenance = {
      firstLifeId: "life-old",
      unlockedAt: "2026-08-16T08:00:00Z",
      viaInvention: true,
    };
    const profile = {
      version: 2 as const,
      activeLife: {
        version: 1 as const,
        lifeId: "life-old",
        startedAt: "2026-08-16T08:00:00Z",
        plan: state.lifePlan!,
        target: {
          kind: "branch" as const,
          branchId: "gammel-gren",
          label: "Old branch",
          area: "old",
        },
        engine: state,
        narrator: freshNarratorState(1),
        events: [],
      },
      archives: [
        {
          lifeId: "archive-old",
          startedAt: "2026-08-15T08:00:00Z",
          endedAt: "2026-08-15T09:00:00Z",
          outcome: {
            kind: "ending" as const,
            endingId: "gammel-slutning",
          },
          seedCode: state.lifePlan!.seedCode,
        },
      ],
      compendium: {
        version: 1 as const,
        unlocks: {
          "discovery:gammel-sten": provenance,
          "branch:gammel-gren": provenance,
          "ending:gammel-slutning": provenance,
        },
        inventions: [
          {
            id: oldInvention.id,
            name: oldInvention.name,
            parents: oldInvention.parents!,
            firstLifeId: "life-old",
          },
        ],
      },
    };

    const migrated = migrateProfileToCurrentContent(content, profile);
    const migratedInventionId = improvisedElementId("sten", "graes");
    expect(migrated.activeLife?.plan.contentRevision).toBe(CURRENT_REVISION);
    expect(migrated.activeLife?.engine.discovered).toContain("sten");
    expect(migrated.activeLife?.target).toMatchObject({
      kind: "branch",
      branchId: "overleveren",
    });
    expect(Object.keys(migrated.compendium.unlocks).sort()).toEqual([
      "branch:overleveren",
      "discovery:sten",
      "ending:et-helt-liv",
    ]);
    expect(migrated.compendium.inventions[0]).toMatchObject({
      id: migratedInventionId,
      parents: ["graes", "sten"],
    });
    expect(migrated.archives[0]).toMatchObject({
      outcome: { kind: "ending", endingId: "et-helt-liv" },
      seedCode: encodeSeed(1, CURRENT_REVISION),
    });
  });

  it("migrates stored archives before they are rendered or finalized again", () => {
    const content = migrationContent();
    const state = staleState(content);
    const archive = {
      version: 1 as const,
      lifeId: "archive-old",
      startedAt: "2026-08-15T08:00:00Z",
      endedAt: "2026-08-15T09:00:00Z",
      outcome: {
        kind: "ending" as const,
        endingId: "gammel-slutning",
      },
      plan: state.lifePlan!,
      target: {
        kind: "ending" as const,
        endingId: "gammel-slutning",
        label: "Old ending",
      },
      events: [],
      finalState: state,
      historyCompleteness: "full" as const,
    };

    const migrated = migrateArchivedLifeToCurrentContent(content, archive);
    expect(migrated.plan.contentRevision).toBe(CURRENT_REVISION);
    expect(migrated.outcome).toEqual({
      kind: "ending",
      endingId: "et-helt-liv",
    });
    expect(migrated.target).toMatchObject({
      kind: "ending",
      endingId: "et-helt-liv",
    });
    expect(migrated.finalState.discovered).toContain("sten");
  });
});
