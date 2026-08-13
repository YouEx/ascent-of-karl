/**
 * Afgør om et element løser en nød.
 *
 * Magtdelingen (plan/feature-improvised-solutions-1.md, PAT-001): den
 * deterministiske regelmotor dømmer hvad tingen ER — det ligger i elementets
 * tags. Prædikatet dømmer om det ER NOK. En fremtidig model må kun forbedre
 * navn/flavor og kan derfor aldrig tale sværhedsgraden ned.
 *
 * satisfies() er tvilling til satisfies() i tools/predicate_report.py. De to
 * SKAL ændres sammen; tests/solves.test.ts sammenligner dem mod en fikstur der
 * er genereret af Python-siden, så et skred bliver fanget.
 */

import type {
  ElementDef,
  PredicateExplanation,
  PredicateFailure,
  SolvePredicate,
} from "./types";

/**
 * Samme dom som satisfies(), men med et serialiserbart bevis. Fortælleren kan
 * senere bruge det uden at genimplementere gameplay-reglerne.
 */
export function explainSatisfaction(
  el: ElementDef,
  pred: SolvePredicate,
): PredicateExplanation {
  const failures: PredicateFailure[] = [];

  if (pred.allOf) {
    const branches = pred.allOf
      .map((branch) => explainSatisfaction(el, branch))
      .filter((result) => !result.satisfied);
    if (branches.length > 0) failures.push({ requirement: "allOf", branches });
  }
  if (pred.anyOf) {
    const branches = pred.anyOf.map((branch) => explainSatisfaction(el, branch));
    if (!branches.some((result) => result.satisfied)) {
      failures.push({ requirement: "anyOf", branches });
    }
  }
  if (pred.not) {
    const matched = explainSatisfaction(el, pred.not);
    if (matched.satisfied) failures.push({ requirement: "not", matched });
  }
  if (pred.crafted && el.base) {
    failures.push({ requirement: "crafted", expected: true, actual: false });
  }
  const depth = el.depth ?? 0;
  if (pred.minDepth !== undefined && depth < pred.minDepth) {
    failures.push({
      requirement: "minDepth",
      expected: pred.minDepth,
      actual: depth,
    });
  }
  if (pred.kind && !pred.kind.includes(el.kind)) {
    failures.push({
      requirement: "kind",
      expected: pred.kind,
      actual: el.kind,
    });
  }
  if (pred.stuff && !pred.stuff.includes(el.stuff)) {
    failures.push({
      requirement: "stuff",
      expected: pred.stuff,
      actual: el.stuff,
    });
  }
  if (pred.traits) {
    const missing = pred.traits.filter((trait) => !el.traits.includes(trait));
    if (missing.length > 0) {
      failures.push({
        requirement: "traits",
        expected: pred.traits,
        missing,
      });
    }
  }
  if (pred.scale && !pred.scale.includes(el.scale)) {
    failures.push({
      requirement: "scale",
      expected: pred.scale,
      actual: el.scale,
    });
  }

  return { satisfied: failures.length === 0, failures };
}

/** Sandt hvis elementet opfylder prædikatet. Ren og rekursiv. */
export function satisfies(el: ElementDef, pred: SolvePredicate): boolean {
  return explainSatisfaction(el, pred).satisfied;
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
