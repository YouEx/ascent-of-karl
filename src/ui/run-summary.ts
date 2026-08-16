import type { ElementDef } from "../core/types";
import type { ArchivedLife } from "../core/life";
import type { CompletionKey } from "../core/compendium";
import type { ReplayTarget } from "../core/replay";

export const MAX_SHARED_INVENTIONS = 5;

export interface InventionSummary {
  total: number;
  names: string[];
}

export function summarizeInventions(
  elements: readonly ElementDef[],
): InventionSummary {
  const inventions = elements.filter(
    (element) => element.origin === "improvised",
  );
  return {
    total: inventions.length,
    names: inventions
      .slice(0, MAX_SHARED_INVENTIONS)
      .map((element) => element.name),
  };
}

export function inventionSummaryText(summary: InventionSummary): string {
  if (summary.total === 0) return "No inventions this life.";
  const omitted = summary.total - summary.names.length;
  return `Karl's inventions: ${summary.names.join(", ")}${
    omitted > 0 ? ` +${omitted} more` : ""
  }`;
}

export interface ArchivedRunSummary {
  lifeId: string;
  seedCode: string;
  fate: string | null;
  summers: number;
  canonicalDiscoveries: number;
  majorBranches: string[];
  authoredUnlocks: CompletionKey[];
  inventions: InventionSummary;
  replayTargets: ReplayTarget[];
}

export function archivedRunSummary(
  archive: ArchivedLife,
  options: {
    canonicalIds: ReadonlySet<string>;
    authoredUnlocks: CompletionKey[];
    replayTargets: ReplayTarget[];
  },
): ArchivedRunSummary {
  return {
    lifeId: archive.lifeId,
    seedCode: archive.plan.seedCode,
    fate:
      archive.outcome.kind === "ending" ? archive.outcome.endingId : null,
    summers: archive.finalState.attempts,
    canonicalDiscoveries: archive.finalState.discovered.filter((id) =>
      options.canonicalIds.has(id),
    ).length,
    majorBranches: [...(archive.finalState.completedBranchIds ?? [])].sort(),
    authoredUnlocks: [...options.authoredUnlocks].sort(),
    inventions: summarizeInventions(
      archive.finalState.improvisedElements ?? [],
    ),
    replayTargets: structuredClone(options.replayTargets),
  };
}
