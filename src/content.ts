import elements from "../content/elements.json";
import combos from "../content/combos.json";
import act1 from "../content/acts/act-1.json";
import act2 from "../content/acts/act-2.json";
import narrator1 from "../content/narrator/act-1.json";
import narrator2 from "../content/narrator/act-2.json";
import endings from "../content/endings.json";
import challenges from "../content/challenges.json";
import decisions from "../content/decisions.json";
import predicates from "../content/predicates.json";
import config from "../content/config.json";
import type { ContentBundle, SolvePredicate } from "./core/types";

/**
 * Samler alle content-filer til ét bundle. Nye akter tilføjes her —
 * al øvrig kode er indholds-agnostisk (PRD §5: skribenter rører aldrig kode udover denne liste).
 */
export function loadContent(): ContentBundle {
  // Nøgler med _-præfiks i predicates.json er dokumentation — hvor reglen er
  // udledt fra, og hvilket hul den lukkede. De er ikke nøder.
  const solvePredicates = Object.fromEntries(
    Object.entries(predicates as Record<string, unknown>).filter(
      ([key]) => !key.startsWith("_"),
    ),
  ) as Record<string, SolvePredicate>;

  // JSON-import kan ikke udtrykke tuple-typen for `pair`; formen håndhæves af
  // tools/validate.py og unit tests i stedet.
  return {
    elements,
    combos,
    acts: [act1, act2],
    narrator: [narrator1, narrator2],
    endings,
    challenges,
    decisions,
    predicates: solvePredicates,
    config,
  } as unknown as ContentBundle;
}
