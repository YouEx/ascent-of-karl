import type { ContentBundle } from "./types";

/**
 * Sjældenhed (docs/design/sjaeldenhed.md).
 *
 * Etiketten er **udledt af kombinationsgrafen**, ikke skrevet i hånden. Med
 * 187 elementer ville håndmærkning drifte fra første nye kombination, og to
 * personer ville aldrig være enige. Her er den en egenskab ved indholdet:
 * tilføjer man en genvej til et element, bliver det automatisk mindre
 * sjældent — hvilket er præcis sandheden.
 *
 * Tre målbare ting afgør det:
 *   1. Afstand     — færreste kombinationer fra start-elementerne.
 *   2. Entydighed  — hvor mange opskrifter fører hertil? Én vej betyder at
 *                    du skulle finde netop DEN vej.
 *   3. Konsekvens  — koster den ekstra somre, er den en blindgyde (altså en
 *                    destination, ikke en ingrediens), eller afslutter den
 *                    Karls historie?
 */
export type Rarity = "common" | "rare" | "unique";

/** Point hvorfra et element regnes som sjældent / enestående. */
const RARE_AT = 8;
const UNIQUE_AT = 14;

export interface RarityInfo {
  tier: Rarity;
  score: number;
  /** Færreste kombinationer fra base-elementerne */
  depth: number;
  /** Antal opskrifter der fører hertil */
  recipes: number;
  /** Bruges elementet videre som ingrediens? */
  deadEnd: boolean;
  /** Afslutter elementet runnet? */
  ending: boolean;
}

/**
 * Beregn sjældenhed for alle elementer. Ren og deterministisk — samme
 * indhold giver altid samme resultat, så etiketten kan ikke skride.
 */
export function computeRarity(content: ContentBundle): Map<string, RarityInfo> {
  const base = new Set(content.elements.filter((e) => e.base).map((e) => e.id));

  // Afstand: fixpunkt-iteration, samme metode som validatorens balance-tjek
  const depth = new Map<string, number>();
  for (const id of base) depth.set(id, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of content.combos) {
      const [a, b] = c.pair;
      const da = depth.get(a);
      const db = depth.get(b);
      if (da === undefined || db === undefined) continue;
      const d = Math.max(da, db) + 1;
      const cur = depth.get(c.result);
      if (cur === undefined || d < cur) {
        depth.set(c.result, d);
        changed = true;
      }
    }
  }

  const recipes = new Map<string, number>();
  const usedAsIngredient = new Set<string>();
  const endings = new Set<string>();
  const cost = new Map<string, number>();
  for (const c of content.combos) {
    recipes.set(c.result, (recipes.get(c.result) ?? 0) + 1);
    usedAsIngredient.add(c.pair[0]);
    usedAsIngredient.add(c.pair[1]);
    if (c.ending) endings.add(c.result);
    cost.set(c.result, Math.max(cost.get(c.result) ?? 1, c.cost ?? 1));
  }

  const out = new Map<string, RarityInfo>();
  for (const e of content.elements) {
    const isBase = base.has(e.id);
    const d = depth.get(e.id) ?? 0;
    const r = recipes.get(e.id) ?? 0;
    const deadEnd = !usedAsIngredient.has(e.id);
    const isEnding = endings.has(e.id);

    let score = 0;
    if (!isBase) {
      score = d;
      if (r === 1) score += 2; // kun én vej derhen
      if (deadEnd) score += 2; // en destination, ikke en ingrediens
      score += 2 * ((cost.get(e.id) ?? 1) - 1); // kostede ekstra somre
    }

    // Slutnings-elementer er altid enestående: de er runnets klimaks.
    const tier: Rarity =
      isEnding || score >= UNIQUE_AT
        ? "unique"
        : score >= RARE_AT
          ? "rare"
          : "common";

    out.set(e.id, { tier, score, depth: d, recipes: r, deadEnd, ending: isEnding });
  }
  return out;
}

/** Spiller-vendt etiket. */
export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare find",
  unique: "Unique",
};
