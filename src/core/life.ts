import type { GameState } from "./engine";
import { Engine } from "./engine";
import {
  applyCompletionUnlocks,
  freshCompendium,
  type CompletionKey,
  type Compendium,
} from "./compendium";
import type { ReplayTarget } from "./replay";
import { deriveLifePlan, type StoredLifePlan } from "./seed";
import type { ContentBundle } from "./types";
import type { NarratorState } from "../narrator/narrator";
import { freshNarratorState } from "../narrator/narrator";
import type { AnyProductEvent } from "../product/events";

export interface ActiveLife {
  version: 1;
  lifeId: string;
  startedAt: string;
  plan: StoredLifePlan;
  target: ReplayTarget | null;
  engine: GameState;
  narrator: NarratorState;
  events: AnyProductEvent[];
}

export interface ArchivedLife {
  version: 1;
  lifeId: string;
  startedAt: string;
  endedAt: string;
  outcome:
    | { kind: "ending"; endingId: string }
    | { kind: "abandoned" };
  plan: StoredLifePlan;
  target: ReplayTarget | null;
  events: AnyProductEvent[];
  finalState: GameState;
  historyCompleteness: "full" | "legacy-summary";
}

export interface ArchivedLifeSummary {
  lifeId: string;
  startedAt: string;
  endedAt: string;
  outcome: ArchivedLife["outcome"];
  seedCode: string;
}

export interface ProfileV2 {
  version: 2;
  activeLife: ActiveLife | null;
  archives: ArchivedLifeSummary[];
  compendium: Compendium;
}

export function freshProfile(): ProfileV2 {
  return {
    version: 2,
    activeLife: null,
    archives: [],
    compendium: freshCompendium(),
  };
}

export function createActiveLife(options: {
  content: ContentBundle;
  lifeId: string;
  startedAt: string;
  seed: number;
  target?: ReplayTarget | null;
}): ActiveLife {
  const variation = options.content.lifeVariation;
  const revision = options.content.completionManifest?.contentRevision;
  if (!variation || !revision) {
    throw new Error("Cannot create a life without variation and completion contracts");
  }
  const plan = deriveLifePlan(variation, revision, options.seed);
  const engine = new Engine(options.content, undefined, { lifePlan: plan });
  return {
    version: 1,
    lifeId: options.lifeId,
    startedAt: options.startedAt,
    plan,
    target: options.target ?? null,
    engine: engine.getState(),
    narrator: freshNarratorState(options.seed),
    events: [],
  };
}

export function archiveLife(
  active: ActiveLife,
  outcome: ArchivedLife["outcome"],
  endedAt: string,
): ArchivedLife {
  return structuredClone({
    version: 1,
    lifeId: active.lifeId,
    startedAt: active.startedAt,
    endedAt,
    outcome,
    plan: active.plan,
    target: active.target,
    events: active.events,
    finalState: active.engine,
    historyCompleteness: "full",
  });
}

export function archiveSummary(archive: ArchivedLife): ArchivedLifeSummary {
  return {
    lifeId: archive.lifeId,
    startedAt: archive.startedAt,
    endedAt: archive.endedAt,
    outcome: structuredClone(archive.outcome),
    seedCode: archive.plan.seedCode,
  };
}

export function completionKeysForArchive(
  content: ContentBundle,
  archive: ArchivedLife,
): CompletionKey[] {
  const manifest = content.completionManifest;
  if (!manifest) return [];
  const canonical = new Set(manifest.discoveries);
  const branches = new Set(manifest.branches);
  const keys: CompletionKey[] = [];
  for (const id of archive.finalState.discovered) {
    if (canonical.has(id)) keys.push(`discovery:${id}`);
  }
  for (const id of archive.finalState.completedBranchIds ?? []) {
    if (branches.has(id)) keys.push(`branch:${id}`);
  }
  if (
    archive.outcome.kind === "ending" &&
    manifest.endings.includes(archive.outcome.endingId)
  ) {
    keys.push(`ending:${archive.outcome.endingId}`);
  }
  return [...new Set(keys)].sort();
}

export function applyArchivedLife(
  profile: ProfileV2,
  content: ContentBundle,
  archive: ArchivedLife,
): ProfileV2 {
  if (profile.archives.some((entry) => entry.lifeId === archive.lifeId)) {
    throw new Error(`Life ${archive.lifeId} is already archived`);
  }
  const next = structuredClone(profile);
  next.activeLife =
    next.activeLife?.lifeId === archive.lifeId ? null : next.activeLife;
  next.archives.push(archiveSummary(archive));
  next.compendium = applyCompletionUnlocks(
    next.compendium,
    completionKeysForArchive(content, archive),
    {
      firstLifeId: archive.lifeId,
      unlockedAt: archive.endedAt,
      viaInvention: archive.events.some(
        (event) => event.type === "invention.accepted",
      ),
    },
  );
  return next;
}
