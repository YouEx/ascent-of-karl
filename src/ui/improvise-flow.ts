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
