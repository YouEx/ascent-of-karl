import type {
  ChallengeDef,
  ContentBundle,
  ElementDef,
  SolvePredicate,
} from "./types";
import { solvesNeed } from "./solves";

/**
 * Challenges (docs/design/challenges.md).
 *
 * Et challenge er en trussel med en frist: Karl har et par somre til at
 * finde en udvej, ellers slutter historien. Til forskel fra de valgfrie
 * problemer kan man ikke gå udenom.
 *
 * To ting er bevidst deterministiske:
 *
 *  1. **Hvornår de dukker op** — udledt af run-seed og sidetal, ikke af
 *     Math.random(). Ellers kunne man genindlæse sit save indtil ingen
 *     challenge kom.
 *  2. **Hvad der tæller som en løsning** — afgøres af elementets tags mod
 *     prædikatet i content/predicates.json. Et spyd virker fordi det ER et
 *     våben, ikke fordi det står på en liste og ikke fordi hash'et var i
 *     humør. Samme idé giver altid samme svar, i alle runs.
 *     `challenge.alsoSolvedBy` er en håndholdt undtagelse ved siden af
 *     hovedreglen (TASK-006) — for de enkeltstående svar, prædikatet ikke
 *     kan udtrykke.
 */

/**
 * Spawn-chance pr. side, efter hvor længe der ikke har været et challenge.
 *
 * Kalibreret mod MOTOREN, ikke mod en formel (tests/challenge.test.ts måler
 * det ved hver kørsel). En sandsynlighedsmodel på papir gav 2,4 challenges
 * pr. run ved 3 %; den rigtige løkke gav 0,63. Tre ting, modellen ikke så:
 *
 *   - `minPage` gør de første sider helt ufarlige
 *   - de 4-5 sider MENS et challenge kører ruller ikke nye
 *   - `seen` fjerner brugte challenges, så puljen tørrer ud
 *
 * Med tre challenges rammer 15 % basis 2,0 pr. run og lader 4-5 % af alle
 * runs slippe helt fri — sjældent nok til at "Carl the Lucky" betyder noget.
 * Kommer der flere challenges, kan basis sænkes igen; kør testen og se.
 */
const SPAWN_RATES: ReadonlyArray<{ afterGap: number; chance: number }> = [
  { afterGap: 40, chance: 0.75 },
  { afterGap: 30, chance: 0.6 },
  { afterGap: 20, chance: 0.45 },
  { afterGap: 10, chance: 0.3 },
  { afterGap: 0, chance: 0.15 },
];

/** Tilstand for et challenge der er i gang. Serialiserbar (gemmes i saven). */
export interface ActiveChallenge {
  id: string;
  /** Sidetal da det dukkede op — låser sværhedsbåndet fast */
  startedAtPage: number;
  /** Somre tilbage til at finde en udvej */
  turnsLeft: number;
  /** Har denne trussel været her før? Så er den en genkomst, ikke en prøve. */
  repeat?: boolean;
}

export interface ChallengeState {
  active: ActiveChallenge | null;
  /** Sider siden sidste challenge (eller siden start) */
  gap: number;
  /** Challenges der allerede har været — gentages ikke i samme run */
  seen: string[];
  /** Side, hvor hver trussel sidst blev udløst. Styrer afkølingen. */
  lastSeenAt?: Record<string, number>;
  /** Har dette run mødt overhovedet ét? Driver "Carl the Lucky". */
  everSpawned: boolean;
}

export function freshChallengeState(): ChallengeState {
  return { active: null, gap: 0, seen: [], lastSeenAt: {}, everSpawned: false };
}

/** Deterministisk hash → [0,1). Samme input giver altid samme tal. */
function hash01(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return (h >>> 0) / 4294967296;
}

export function spawnChanceForGap(gap: number): number {
  return SPAWN_RATES.find((r) => gap >= r.afterGap)!.chance;
}

/**
 * Skal et challenge dukke op på denne side? Rent udledt af seed og sidetal.
 * Returnerer challenget, eller null.
 */
export function rollChallenge(
  content: ContentBundle,
  state: ChallengeState,
  page: number,
  seed: number,
): ChallengeDef | null {
  if (state.active) return null;
  // En trussel er ude af puljen, indtil dens afkøling er gået — og for altid,
  // hvis den ikke er repeatable. Uden afkølingen kunne ulvene komme igen to
  // somre efter, de gik.
  const pool = content.challenges.filter((c) => {
    if (page < (c.minPage ?? 1)) return false;
    if (!state.seen.includes(c.id)) return true;
    if (!c.repeatable) return false;
    // `seen` afgør OM truslen har været her, `lastSeenAt` kun HVORNÅR. Et gammelt
    // save har det første og ikke det sidste; dér falder afkølingen tilbage til
    // nuet, så en gammel spiller aldrig får ulvene i hovedet ved indlæsning.
    const sidst = state.lastSeenAt?.[c.id] ?? page;
    return page - sidst >= (c.cooldown ?? 12);
  });
  if (pool.length === 0) return null;
  if (hash01(seed, "spawn", page) >= spawnChanceForGap(state.gap)) return null;
  const pick = Math.floor(hash01(seed, "pick", page) * pool.length);
  return pool[pick] ?? null;
}

/**
 * Løser dette element challenget?
 *
 * Hovedreglen: prædikatet i content/predicates.json — altså hvad elementet
 * ER, ikke hvad det hedder og ikke et terningkast. Ulvene viger for et
 * våben, en ild, et ly i lejrstørrelse eller et tamt dyr, uanset om nogen har
 * skrevet netop den ting på en liste.
 *
 * challenge.alsoSolvedBy er en eksplicit override ved siden af den regel
 * (TASK-006): står elementet der, vinder det, selv når prædikatet ville
 * afvise det. Listen er tænkt som undtagelser prædikatet (endnu) ikke kan
 * udtrykke og bør derfor være kort eller tom — tools/validate.py advarer,
 * hvis en post her allerede fanges af prædikatet. Det historiske facit for
 * tools/predicate_report.py bor ikke her, men i
 * docs/design/taxonomy-ground-truth.json.
 */
export function resolves(
  challenge: ChallengeDef,
  element: ElementDef,
  predicates: Record<string, SolvePredicate>,
): boolean {
  if (solvesNeed(element, challenge.id, predicates)) return true;
  return challenge.alsoSolvedBy.includes(element.id);
}
