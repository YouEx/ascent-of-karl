import type { Engine } from "./engine";
import type { ElementDef, InventionConsequenceDef } from "./types";
import { solvesNeed } from "./solves";

export interface ValidatedGeneratedEffects {
  solvedProblemId: string | null;
  solvedChallengeId: string | null;
  unlockedEndingId: string | null;
  authoredBranchIds: string[];
}

export function validateGeneratedEffects(
  engine: Engine,
  element: ElementDef,
  rules: readonly InventionConsequenceDef[],
): ValidatedGeneratedEffects {
  const solvedProblemId =
    engine
      .currentActProblems()
      .find(
        (problem) =>
          !engine.isSolved(problem.id) &&
          solvesNeed(element, problem.id, engine.content.predicates),
      )?.id ?? null;
  const activeChallenge = engine.activeChallenge();
  const solvedChallengeId =
    activeChallenge &&
    solvesNeed(element, activeChallenge.def.id, engine.content.predicates)
      ? activeChallenge.def.id
      : null;
  const matchingRules = rules.filter((rule) =>
    solvesNeed(element, rule.predicateId, engine.content.predicates),
  );
  const unlockedEndingIds = matchingRules
    .map((rule) => rule.unlocksEndingId)
    .filter((id): id is string => typeof id === "string");
  const validEndingIds = unlockedEndingIds.filter((id) =>
    engine.content.endings.some((ending) => ending.id === id),
  );
  const branchIds = matchingRules
    .map((rule) => rule.unlocksBranchId)
    .filter((id): id is string => typeof id === "string")
    .filter((id) => (engine.content.branches ?? []).some((branch) => branch.id === id));
  return {
    solvedProblemId,
    solvedChallengeId,
    unlockedEndingId: validEndingIds.sort()[0] ?? null,
    authoredBranchIds: [...new Set(branchIds)].sort().slice(0, 1),
  };
}
