import type { Combo, Flags } from "./types";

// Kombinationer er uordnede: a+b og b+a er samme opslag.
export function comboKey(a: string, b: string): string {
  return [a, b].sort().join("+");
}

export function indexCombos(combos: Combo[]): Map<string, Combo> {
  const index = new Map<string, Combo>();
  for (const combo of combos) {
    index.set(comboKey(combo.element_a, combo.element_b), combo);
  }
  return index;
}

// null = "ingenting sker" (gyldigt udfald, fortælleren tager over).
export function findCombo(
  index: Map<string, Combo>,
  a: string,
  b: string,
  flags: Flags,
): Combo | null {
  const combo = index.get(comboKey(a, b));
  if (!combo) return null;
  if (combo.flags_kraevet.some((flag) => !flags[flag])) return null;
  return combo;
}
