import type { Compendium } from "./compendium";
import type { ContentBundle } from "./types";

export type ReplayTarget =
  | { kind: "ending"; endingId: string; label: string }
  | { kind: "branch"; branchId: string; label: string; area: string }
  | { kind: "discovery-area"; act: number; area: string; label: string };

export function selectReplayTargets(
  content: ContentBundle,
  compendium: Compendium,
): ReplayTarget[] {
  const targets: ReplayTarget[] = [];
  for (const branch of content.branches ?? []) {
    if (branch.importance !== "major") continue;
    if (Object.hasOwn(compendium.unlocks, `branch:${branch.id}`)) continue;
    targets.push({
      kind: "branch",
      branchId: branch.id,
      label: branch.replayHint.label,
      area: branch.replayHint.area,
    });
  }
  for (const ending of content.endings) {
    if (Object.hasOwn(compendium.unlocks, `ending:${ending.id}`)) continue;
    targets.push({
      kind: "ending",
      endingId: ending.id,
      label: `Find another fate in ${ending.tone ?? "Karl's story"}`,
    });
  }
  const missingByAct = new Map<number, number>();
  for (const element of content.elements) {
    if (
      element.base ||
      Object.hasOwn(compendium.unlocks, `discovery:${element.id}`)
    ) {
      continue;
    }
    missingByAct.set(element.act, (missingByAct.get(element.act) ?? 0) + 1);
  }
  for (const [act, count] of [...missingByAct].sort(([a], [b]) => a - b)) {
    targets.push({
      kind: "discovery-area",
      act,
      area: `act-${act}`,
      label: `Explore ${count} undiscovered authored results in Act ${act}`,
    });
  }
  return targets;
}
