import type { GameState } from "./engine";
import { sanitizeImprovisedElement } from "./improvise";
import {
  archiveSummary,
  type ActiveLife,
  type ArchivedLife,
  type ProfileV2,
} from "./life";
import {
  applyCompletionUnlocks,
  freshCompendium,
  type CompletionKey,
} from "./compendium";
import { legacyLifePlan } from "./seed";
import { migrateGameStateToCurrentContent } from "./content-migrations";
import type { ContentBundle } from "./types";
import type { NarratorState } from "../narrator/narrator";

/** Save-format med version, så gamle saves kan migreres senere. */
export interface SaveFile {
  version: 1;
  savedAt: string;
  state: GameState;
}

export function serialize(state: GameState, savedAt: string): string {
  const file: SaveFile = { version: 1, savedAt, state };
  return JSON.stringify(file);
}

export function deserialize(json: string): GameState {
  const file = JSON.parse(json) as SaveFile;
  if (file.version !== 1) throw new Error(`Ukendt save-version: ${file.version}`);
  const s = file.state;
  if (
    !s ||
    typeof s.act !== "number" ||
    !Array.isArray(s.discovered) ||
    !Array.isArray(s.flags) ||
    !Array.isArray(s.solvedProblems) ||
    (s.improvisedElements !== undefined &&
      !Array.isArray(s.improvisedElements)) ||
    (s.creditedImprovised !== undefined &&
      (!Array.isArray(s.creditedImprovised) ||
        s.creditedImprovised.some((id) => typeof id !== "string")))
  ) {
    throw new Error("Ugyldig save-fil");
  }
  const improvisedElements = (s.improvisedElements ?? [])
    .map((element) => sanitizeImprovisedElement(element))
    .filter((element) => element !== null);
  const improvisedIds = new Set(
    improvisedElements.map((element) => element.id),
  );
  return {
    ...s,
    improvisedElements,
    creditedImprovised: (s.creditedImprovised ?? []).filter((id) =>
      improvisedIds.has(id),
    ),
  };
}

export interface ProfileSaveFile {
  version: 2;
  savedAt: string;
  profile: ProfileV2;
}

export function serializeProfile(
  profile: ProfileV2,
  savedAt: string,
): string {
  return JSON.stringify({
    version: 2,
    savedAt,
    profile,
  } satisfies ProfileSaveFile);
}

export function deserializeProfile(json: string): ProfileV2 {
  const file = JSON.parse(json) as Partial<ProfileSaveFile>;
  if (file.version !== 2) {
    throw new Error(`Ukendt profil-version: ${String(file.version)}`);
  }
  const profile = file.profile;
  if (
    !profile ||
    profile.version !== 2 ||
    !Array.isArray(profile.archives) ||
    !profile.compendium ||
    profile.compendium.version !== 1
  ) {
    throw new Error("Ugyldig profil-fil");
  }
  return structuredClone(profile);
}

export interface LegacyMigrationInput {
  saveJson: string;
  narrator: NarratorState;
  achievements: Record<string, string>;
  content: ContentBundle;
  lifeId: string;
  startedAt: string;
  migratedAt: string;
}

export interface LegacyMigrationResult {
  profile: ProfileV2;
  archives: ArchivedLife[];
}

function legacyCompletionKeys(
  content: ContentBundle,
  state: GameState,
  achievements: Record<string, string>,
): CompletionKey[] {
  const manifest = content.completionManifest;
  if (!manifest) return [];
  const canonical = new Set(manifest.discoveries);
  const branches = new Set(manifest.branches);
  return [
    ...state.discovered
      .filter((id) => canonical.has(id))
      .map((id): CompletionKey => `discovery:${id}`),
    ...(state.completedBranchIds ?? [])
      .filter((id) => branches.has(id))
      .map((id): CompletionKey => `branch:${id}`),
    ...Object.keys(achievements)
      .filter((id) => manifest.endings.includes(id))
      .map((id): CompletionKey => `ending:${id}`),
  ];
}

export function migrateLegacyProfile(
  input: LegacyMigrationInput,
): LegacyMigrationResult {
  const state = migrateGameStateToCurrentContent(
    input.content,
    deserialize(input.saveJson),
  );
  const plan = state.lifePlan ?? legacyLifePlan(input.content, state.seed ?? 1);
  const active: ActiveLife = {
    version: 1,
    lifeId: input.lifeId,
    startedAt: input.startedAt,
    plan,
    target: null,
    engine: { ...state, lifePlan: plan },
    narrator: structuredClone(input.narrator),
    events: [],
  };
  let compendium = applyCompletionUnlocks(
    freshCompendium(),
    legacyCompletionKeys(input.content, state, input.achievements),
    {
      firstLifeId: input.lifeId,
      unlockedAt: input.migratedAt,
      viaInvention: false,
    },
  );
  const profile: ProfileV2 = {
    version: 2,
    activeLife: active,
    archives: [],
    compendium,
  };
  if (!state.ended) return { profile, archives: [] };

  const archive: ArchivedLife = {
    version: 1,
    lifeId: input.lifeId,
    startedAt: input.startedAt,
    endedAt: input.migratedAt,
    outcome: { kind: "ending", endingId: state.ended },
    plan,
    target: null,
    events: [],
    finalState: { ...state, lifePlan: plan },
    historyCompleteness: "legacy-summary",
  };
  compendium = applyCompletionUnlocks(
    compendium,
    input.content.completionManifest?.endings.includes(state.ended)
      ? [`ending:${state.ended}`]
      : [],
    {
      firstLifeId: input.lifeId,
      unlockedAt: input.migratedAt,
      viaInvention: false,
    },
  );
  return {
    profile: {
      ...profile,
      activeLife: null,
      archives: [archiveSummary(archive)],
      compendium,
    },
    archives: [archive],
  };
}
