import type {
  AuthoredBranchDef,
  BranchPredicate,
  ContentBundle,
} from "./types";

export interface BranchWorld {
  discovered: ReadonlySet<string>;
  flags: ReadonlySet<string>;
  solvedProblems: ReadonlySet<string>;
  solvedChallenges: ReadonlySet<string>;
  failedChallenges: ReadonlySet<string>;
  endingId: string | null;
}

export function branchPredicateMatches(
  predicate: BranchPredicate,
  world: BranchWorld,
): boolean {
  switch (predicate.kind) {
    case "flag":
      return world.flags.has(predicate.id);
    case "discovery":
      return world.discovered.has(predicate.id);
    case "solvedNeed":
      return world.solvedProblems.has(predicate.id);
    case "challengeSolved":
      return world.solvedChallenges.has(predicate.id);
    case "challengeFailed":
      return world.failedChallenges.has(predicate.id);
    case "ending":
      return world.endingId === predicate.id;
    case "allOf":
      return predicate.predicates.every((entry) =>
        branchPredicateMatches(entry, world),
      );
    case "anyOf":
      return predicate.predicates.some((entry) =>
        branchPredicateMatches(entry, world),
      );
  }
}

export function completedBranches(
  branches: readonly AuthoredBranchDef[],
  world: BranchWorld,
): string[] {
  return branches
    .filter((branch) => branchPredicateMatches(branch.trigger, world))
    .map((branch) => branch.id)
    .sort();
}

export function newlyCompletedBranches(
  content: ContentBundle,
  existing: readonly string[],
  world: BranchWorld,
): string[] {
  const known = new Set(existing);
  return completedBranches(content.branches ?? [], world).filter(
    (id) => !known.has(id),
  );
}
