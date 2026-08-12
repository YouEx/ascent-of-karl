/**
 * Grammatikken: gulvet under fortælleren.
 *
 * Hver fiasko skal nævne præcis de to ting spilleren lagde sammen. Før faldt
 * de alle sammen ned i den generiske pulje, og et spil med ~40 fiaskoer pr.
 * gennemspilning delte 14 replikker ud på dem — så hørte man "nothing happens"
 * og troede fortælleren ikke kiggede med.
 *
 * Her vælges kun HVILKEN replik der skal siges. Selve replikkerne står i
 * content/narrator/grammar-act-*.json og er skrevet i hånden, og de siges
 * gennem fortællerens egen speak(), så varianthukommelse, lyd og
 * anti-gentagelse virker uændret.
 *
 * Nøglerne går fra specifik til generel:
 *   "near-miss:plant+stone"   dommen + de to materialer, sorteret
 *   "near-miss:plant"         dommen + det ene materiale
 *   "near-miss"               dommen alene — altid til stede
 */

import type { ElementDef, Verdict, VerdictEvidence } from "../core/types";

/** Nøglerne der skal prøves, mest specifikke først. */
export function grammarKeys(
  verdict: Verdict,
  a: ElementDef,
  b: ElementDef,
): string[] {
  const keys: string[] = [];
  const pair = [a.stuff, b.stuff].sort();
  if (a.stuff !== "none" || b.stuff !== "none") {
    keys.push(`${verdict}:${pair[0]}+${pair[1]}`);
  }
  // Ét materiale alene: sten mod hvad som helst er en genkendelig situation,
  // også når det andet er en tanke.
  for (const stuff of new Set([a.stuff, b.stuff])) {
    if (stuff !== "none") keys.push(`${verdict}:${stuff}`);
  }
  keys.push(verdict);
  return keys;
}

/**
 * Find replik-id'erne for dommen. Returnerer den mest specifikke pulje der
 * findes — ikke en sammenlægning, for en specialiseret replik skal kunne
 * fortrænge den generelle helt.
 */
export function grammarPool(
  grammar: Record<string, string[]> | undefined,
  verdict: Verdict,
  a: ElementDef,
  b: ElementDef,
): string[] {
  if (!grammar) return [];
  for (const key of grammarKeys(verdict, a, b)) {
    const pool = grammar[key];
    if (pool?.length) return pool;
  }
  return [];
}

/**
 * Vælg én replik fra puljen. `recent` er de sidst sagte grammatik-replikker;
 * de udelukkes, så længe der er andre tilbage. Med ~40 fiaskoer pr. spil er
 * gentagelse den største trussel mod illusionen.
 *
 * `roll` er fortællerens egen RNG — grammatikken må ikke have sin egen, ellers
 * er en gennemspilning ikke længere deterministisk ud fra ét seed.
 */
export function pickGrammarLine(
  pool: string[],
  recent: string[],
  roll: () => number,
): string | undefined {
  if (pool.length === 0) return undefined;
  const fresh = pool.filter((id) => !recent.includes(id));
  const usable = fresh.length > 0 ? fresh : pool;
  return usable[Math.floor(roll() * usable.length) % usable.length];
}

/** Pladsholdere grammatikken må bruge, udfyldt fra dommens bevismateriale. */
export interface VerdictContext {
  a: string;
  b: string;
  /** near-miss: hvilket af de to der faktisk var rigtigt. */
  rightOne?: string;
  /** Samme som rightOne, men som pladsholder — og dens modstykke. */
  right?: string;
  wrong?: string;
  partner?: string;
  result?: string;
  shared?: string;
  trait?: string;
  trait2?: string;
  deadEnd?: string;
}

export function verdictContext(
  a: ElementDef,
  b: ElementDef,
  evidence: VerdictEvidence,
): VerdictContext {
  return {
    a: a.id,
    b: b.id,
    rightOne: evidence.rightOne,
    // Fortælleren VED hvem af de to der havde ret. Det ville være spild at
    // lade ham sige "en af dem" når han kan pege.
    right: evidence.rightOne,
    wrong:
      evidence.rightOne === undefined
        ? undefined
        : evidence.rightOne === a.id
          ? b.id
          : a.id,
    partner: evidence.partner,
    result: evidence.partnerResult,
    shared: evidence.shared,
    trait: evidence.clashing?.[0],
    trait2: evidence.clashing?.[1],
    deadEnd: evidence.deadEnds?.[0],
  };
}
