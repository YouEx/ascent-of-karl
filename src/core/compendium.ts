import type { GameState } from "./engine";
import type { CompletionManifestDef, ContentBundle } from "./types";

export type CompletionKey =
  | `discovery:${string}`
  | `branch:${string}`
  | `ending:${string}`;

export interface UnlockProvenance {
  firstLifeId: string;
  unlockedAt: string;
  viaInvention: boolean;
}

export interface ArchivedInvention {
  id: string;
  name: string;
  parents: [string, string];
  firstLifeId: string;
}

export interface Compendium {
  version: 1;
  unlocks: Record<CompletionKey, UnlockProvenance>;
  inventions: ArchivedInvention[];
}

export interface CompletionStatus {
  found: number;
  total: number;
  basisPoints: number;
  discoveries: { found: number; total: number };
  branches: { found: number; total: number };
  endings: { found: number; total: number };
}

export function freshCompendium(): Compendium {
  return { version: 1, unlocks: {}, inventions: [] };
}

export function completionKeys(
  manifest: CompletionManifestDef,
): CompletionKey[] {
  return [
    ...manifest.discoveries.map(
      (id): CompletionKey => `discovery:${id}`,
    ),
    ...manifest.branches.map((id): CompletionKey => `branch:${id}`),
    ...manifest.endings.map((id): CompletionKey => `ending:${id}`),
  ];
}

export function applyCompletionUnlocks(
  compendium: Compendium,
  keys: readonly CompletionKey[],
  provenance: UnlockProvenance,
): Compendium {
  const next = structuredClone(compendium);
  for (const key of keys) {
    if (!Object.hasOwn(next.unlocks, key)) {
      next.unlocks[key] = structuredClone(provenance);
    }
  }
  return next;
}

export function applyLiveProgress(
  compendium: Compendium,
  content: ContentBundle,
  state: GameState,
  provenance: UnlockProvenance,
): Compendium {
  const manifest = content.completionManifest;
  if (!manifest) return structuredClone(compendium);
  const discoveries = new Set(manifest.discoveries);
  const branches = new Set(manifest.branches);
  const keys: CompletionKey[] = [
    ...state.discovered
      .filter((id) => discoveries.has(id))
      .map((id): CompletionKey => `discovery:${id}`),
    ...(state.completedBranchIds ?? [])
      .filter((id) => branches.has(id))
      .map((id): CompletionKey => `branch:${id}`),
  ];
  if (state.ended && manifest.endings.includes(state.ended)) {
    keys.push(`ending:${state.ended}`);
  }
  const next = applyCompletionUnlocks(compendium, uniqueKeys(keys), provenance);
  const existing = new Set(next.inventions.map((invention) => invention.id));
  for (const invention of state.improvisedElements ?? []) {
    if (
      invention.origin !== "improvised" ||
      !invention.parents ||
      existing.has(invention.id)
    ) {
      continue;
    }
    next.inventions.push({
      id: invention.id,
      name: invention.name,
      parents: [...invention.parents],
      firstLifeId: provenance.firstLifeId,
    });
    existing.add(invention.id);
  }
  return next;
}

function uniqueKeys(keys: readonly CompletionKey[]): CompletionKey[] {
  return [...new Set(keys)].sort();
}

function categoryStatus(
  prefix: "discovery" | "branch" | "ending",
  ids: readonly string[],
  unlocks: Readonly<Record<string, UnlockProvenance>>,
) {
  return {
    found: ids.filter((id) => Object.hasOwn(unlocks, `${prefix}:${id}`)).length,
    total: ids.length,
  };
}

export function completionStatus(
  manifest: CompletionManifestDef,
  compendium: Compendium,
): CompletionStatus {
  const discoveries = categoryStatus(
    "discovery",
    manifest.discoveries,
    compendium.unlocks,
  );
  const branches = categoryStatus(
    "branch",
    manifest.branches,
    compendium.unlocks,
  );
  const endings = categoryStatus(
    "ending",
    manifest.endings,
    compendium.unlocks,
  );
  const found = discoveries.found + branches.found + endings.found;
  const total = discoveries.total + branches.total + endings.total;
  return {
    found,
    total,
    basisPoints: total === 0 ? 0 : Math.floor((found * 10000) / total),
    discoveries,
    branches,
    endings,
  };
}

export function completionCatalog(content: ContentBundle) {
  const manifest =
    content.completionManifest ??
    ({
      schemaVersion: 1,
      contentRevision: "0000000000000000",
      discoveries: content.elements
        .filter((element) => !element.base)
        .map((element) => element.id)
        .sort(),
      branches: (content.branches ?? [])
        .filter((branch) => branch.importance === "major")
        .map((branch) => branch.id)
        .sort(),
      endings: content.endings.map((ending) => ending.id).sort(),
    } satisfies CompletionManifestDef);
  return completionStatus(manifest, freshCompendium());
}
