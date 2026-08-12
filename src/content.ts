import elements from "../content/elements.json";
import combos from "../content/combos.json";
import act1 from "../content/acts/act-1.json";
import act2 from "../content/acts/act-2.json";
import narrator1 from "../content/narrator/act-1.json";
import grammar1 from "../content/narrator/grammar-act-1.json";
import narrator2 from "../content/narrator/act-2.json";
import endings from "../content/endings.json";
import challenges from "../content/challenges.json";
import decisions from "../content/decisions.json";
import predicates from "../content/predicates.json";
import config from "../content/config.json";
import type { ContentBundle, SolvePredicate } from "./core/types";
import { computeDepths } from "./core/timeline";

/**
 * Samler alle content-filer til ét bundle. Nye akter tilføjes her —
 * al øvrig kode er indholds-agnostisk (PRD §5: skribenter rører aldrig kode udover denne liste).
 */
/**
 * Flet grammatikken ind i aktens fortæller-indhold.
 *
 * Grammatik-replikkerne lever i deres egen fil, fordi de er hundredvis og
 * skrevet i ét stræk — men de er almindelige replikker. Ved at lægge dem i
 * samme `lines`-pulje får de fortællerens varianthukommelse, lydopslag og
 * validering gratis, uden en eneste særregel.
 */
function mergeGrammar(act: unknown, grammar: unknown) {
  const a = act as { lines: unknown[] };
  const g = grammar as { lines: unknown[]; grammar: Record<string, string[]> };
  return { ...a, lines: [...a.lines, ...g.lines], grammar: g.grammar };
}

export function loadContent(): ContentBundle {
  // Nøgler med _-præfiks i predicates.json er dokumentation — hvor reglen er
  // udledt fra, og hvilket hul den lukkede. De er ikke nøder.
  const solvePredicates = Object.fromEntries(
    Object.entries(predicates as Record<string, unknown>).filter(
      ([key]) => !key.startsWith("_"),
    ),
  ) as Record<string, SolvePredicate>;

  // Dybden udledes her, én gang, så prædikater kan spørge om den (minDepth).
  // Den er en ren funktion af elements+combos, så alle kaldere får samme tal;
  // vi bygger alligevel nye objekter frem for at mutere JSON-modulets egne.
  const depths = computeDepths({ elements, combos } as unknown as ContentBundle);

  // "Færdig" betyder: tingen indgår ikke i én eneste opskrift. Den er ikke et
  // trin på vejen, den er enden på en. Det er udledt og aldrig skrevet i
  // hånden, så tallet ikke kan komme i utakt med opskrifterne.
  //
  // Grunden til at det overhovedet er værd at vise: spilleren vælger to ting
  // ad gangen, så hver færdig ting i inventaret gør alle senere valg ringere.
  // Andelen af par der giver noget, falder fra 42,9 % i åbningen til 1,3 % til
  // sidst, og en tredjedel af elementerne er ikke input nogen steder. Får man
  // dem lagt til side som det de er — trofæer — kan resten findes igen.
  const brugtSomInput = new Set<string>();
  for (const k of combos as { pair: string[] }[]) {
    for (const p of k.pair) brugtSomInput.add(p);
  }

  const elementsWithDepth = (elements as { id: string }[]).map((el) => ({
    ...el,
    depth: depths.get(el.id) ?? 0,
    terminal: !brugtSomInput.has(el.id),
  }));

  // JSON-import kan ikke udtrykke tuple-typen for `pair`; formen håndhæves af
  // tools/validate.py og unit tests i stedet.
  return {
    elements: elementsWithDepth,
    combos,
    acts: [act1, act2],
    narrator: [mergeGrammar(narrator1, grammar1), narrator2],
    endings,
    challenges,
    decisions,
    predicates: solvePredicates,
    config,
  } as unknown as ContentBundle;
}
