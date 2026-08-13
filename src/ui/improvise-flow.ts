import type { Engine } from "../core/engine";
import type { ImproviseCopy } from "../core/improvise";
import type { CombineOutcome } from "../core/types";

export const IMPROVISE_ENABLED =
  import.meta.env?.VITE_IMPROVISE_ENABLED === "true";

export function performPlayerAttempt(
  engine: Engine,
  a: string,
  b: string,
  enabled: boolean,
  copy?: ImproviseCopy,
): CombineOutcome {
  return enabled ? engine.attempt(a, b, copy) : engine.combine(a, b);
}

/**
 * Copy-laget må kun starte et nyt request, hvis motoren stadig kan oprette
 * elementet. Genbrug har allerede gemt copy, og et fyldt run-loft må ikke
 * kunne omgås af et sent netværkssvar.
 */
export function shouldPrefetchImprovisedCopy(
  engine: Engine,
  a: string,
  b: string,
): boolean {
  return engine.canCreateImprovisation(a, b);
}

export function improvisationRejectionStatus(
  outcome: Extract<CombineOutcome, { kind: "improvise-rejected" }>,
): string {
  if (outcome.reason === "run-limit") {
    return `Karl has used all ${outcome.limit ?? 0} inventions for this life.`;
  }
  if (outcome.reason === "depth-limit") {
    return "That invention cannot be taken any further.";
  }
  return "Karl could not make that idea hold together.";
}
