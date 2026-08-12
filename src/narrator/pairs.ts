/**
 * De bagte par-replikker: fortællerens bedste ord, til de par spillerne
 * faktisk møder.
 *
 * Grammatikken (grammar.ts) garanterer at ingen fiasko møder tavshed. Den er
 * gulvet. Det her er loftet: 250 par, målt frem i docs/design/pair-frequency.json,
 * som tilsammen udgør 94,5 % af alle fiasko-møder. Til dem findes en replik
 * der kun kan handle om netop de to ting.
 *
 * Filen lazy-loades pr. akt (CON-003), fordi den ikke skal ligge i første
 * bundt: spillet skal stadig kunne males før teksten er hentet, og indtil den
 * lander, taler grammatikken. Det er en ærlig degradering — gulvet er godt nok
 * til at stå på.
 *
 * Opslaget er "<pairKey>:<dom>", ikke bare parret. 106 af de 250 hyppigste par
 * skifter dom mellem gennemspilninger, fordi det samme par mødes i forskellige
 * spiltilstande. Kun den dominerende dom er bagt; de øvrige falder igennem til
 * grammatikken frem for at lyve om hvor tæt på spilleren var.
 */

import type { NarratorLineDef } from "../core/types";

export interface PairContent {
  act: number;
  /** Nøglerne "<pairKey>:<dom>" der har en bagt replik. */
  pairs: string[];
  lines: NarratorLineDef[];
}

/**
 * Replik-id'et for et opslag. Udledt frem for gemt: id'et var før skrevet ud
 * ved siden af hver eneste nøgle, og de 404 gentagelser kostede mere gzip end
 * CON-003 har råd til. Reglen skal holdes i sync med `line_id()` i
 * `tools/assemble_pairs.py` — `tests/pairs.test.ts` tjekker at den gør.
 */
export function pairLineId(lookup: string): string {
  const at = lookup.lastIndexOf(":");
  return "pair-" + lookup.slice(0, at).replace("+", "-") + "-" + lookup.slice(at + 1);
}

/**
 * Hent de bagte replikker for en akt. Ukendte akter giver undefined frem for
 * at kaste — en akt uden bagt tekst er en akt der taler grammatik, ikke en fejl.
 */
export async function loadPairs(act: number): Promise<PairContent | undefined> {
  if (act !== 1) return undefined;
  const mod = await import("../../content/narrator/pairs-act-1.json");
  return (mod.default ?? mod) as unknown as PairContent;
}
