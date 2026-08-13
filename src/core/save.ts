import type { GameState } from "./engine";
import { sanitizeImprovisedElement } from "./improvise";

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
