import { Engine } from "./engine";
import { deriveLifePlan } from "./seed";
import type { ContentBundle, LifeOpeningDef } from "./types";

export interface ViabilityResult {
  openingId: string;
  viable: boolean;
  errors: string[];
}

export function validateOpeningWitness(
  content: ContentBundle,
  opening: LifeOpeningDef,
): ViabilityResult {
  const errors: string[] = [];
  const knownIds = new Set(content.elements.map((element) => element.id));
  for (const id of opening.elementIds) {
    if (!knownIds.has(id)) errors.push(`unknown starting element ${id}`);
  }
  const variation = content.lifeVariation;
  const revision = content.completionManifest?.contentRevision;
  if (!variation || !revision) {
    errors.push("content is missing life variation or completion revision");
    return { openingId: opening.id, viable: false, errors };
  }
  const basePlan = deriveLifePlan(variation, revision, 1);
  const engine = new Engine(content, undefined, {
    lifePlan: {
      ...basePlan,
      openingId: opening.id,
      startingElementIds: [...opening.elementIds],
      challengeIds: [],
    },
  });
  for (const [left, right] of opening.viabilityWitness) {
    try {
      const outcome = engine.combine(left, right);
      if (
        outcome.kind !== "discovery" &&
        outcome.kind !== "known"
      ) {
        errors.push(
          `${left}+${right} produced ${outcome.kind}, not a viable canonical step`,
        );
        break;
      }
    } catch (error) {
      errors.push(
        `${left}+${right} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      break;
    }
  }
  if (engine.unsolvedRequiredProblems().length > 0) {
    errors.push(
      `required needs remain: ${engine
        .unsolvedRequiredProblems()
        .map((problem) => problem.id)
        .join(", ")}`,
    );
  }
  const firstAct = Math.min(...content.acts.map((act) => act.act));
  if (engine.currentAct().act <= firstAct) {
    errors.push("witness does not cross the first age-up");
  }
  return {
    openingId: opening.id,
    viable: errors.length === 0,
    errors,
  };
}

export function validateLifeVariation(content: ContentBundle): ViabilityResult[] {
  const variation = content.lifeVariation;
  if (!variation) {
    return [
      {
        openingId: "missing",
        viable: false,
        errors: ["content is missing life variation"],
      },
    ];
  }
  return variation.openings.map((opening) =>
    validateOpeningWitness(content, opening),
  );
}
