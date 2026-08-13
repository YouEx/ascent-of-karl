import type { GameState } from "./engine";

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
    typeof s.act !== "number" ||
    !Array.isArray(s.discovered) ||
    !Array.isArray(s.flags) ||
    !Array.isArray(s.solvedProblems)
  ) {
    throw new Error("Ugyldig save-fil");
  }
  return {
    ...s,
    improvisedElements: s.improvisedElements ?? [],
    creditedImprovised: s.creditedImprovised ?? [],
  };
}
