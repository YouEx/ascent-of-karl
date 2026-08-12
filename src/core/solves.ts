/**
 * Afgør om et element løser en nød.
 *
 * Magtdelingen (plan/feature-improvised-solutions-1.md, PAT-001): fortælleren
 * dømmer hvad tingen ER — det ligger i elementets tags. Motoren dømmer om det
 * ER NOK — det ligger her. Uden den deling kan sværhedsgraden tales ned af en
 * model, og så er den ikke Martins længere.
 *
 * satisfies() er tvilling til satisfies() i tools/predicate_report.py. De to
 * SKAL ændres sammen; tests/solves.test.ts sammenligner dem mod en fikstur der
 * er genereret af Python-siden, så et skred bliver fanget.
 */

import type { ElementDef, SolvePredicate } from "./types";

/** Sandt hvis elementet opfylder prædikatet. Ren og rekursiv. */
export function satisfies(el: ElementDef, pred: SolvePredicate): boolean {
  if (pred.allOf && !pred.allOf.every((p) => satisfies(el, p))) return false;
  if (pred.anyOf && !pred.anyOf.some((p) => satisfies(el, p))) return false;
  if (pred.not && satisfies(el, pred.not)) return false;
  // crafted holder nøden væk fra tur 1: alle 30 oprindelige løsninger var
  // fremstillede, og ingen af base-elementerne løste noget — heller ikke bær
  // og larver, som ellers er spiselige.
  if (pred.crafted && el.base) return false;
  if (pred.kind && !pred.kind.includes(el.kind)) return false;
  if (pred.stuff && !pred.stuff.includes(el.stuff)) return false;
  if (pred.traits && !pred.traits.every((t) => el.traits.includes(t))) return false;
  if (pred.scale && !pred.scale.includes(el.scale)) return false;
  return true;
}

/**
 * Hvilke af nøderne løser dette element? Rækkefølgen følger prædikatfilen,
 * så resultatet er deterministisk.
 */
export function solvedNeeds(
  el: ElementDef,
  predicates: Record<string, SolvePredicate>,
): string[] {
  return Object.keys(predicates).filter((id) => satisfies(el, predicates[id]!));
}

/** Løser elementet netop denne nød? Ukendt nød giver false, ikke et brag. */
export function solvesNeed(
  el: ElementDef,
  needId: string,
  predicates: Record<string, SolvePredicate>,
): boolean {
  const pred = predicates[needId];
  return pred ? satisfies(el, pred) : false;
}
