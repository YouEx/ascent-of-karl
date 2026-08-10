import type { ChallengeDef, ContentBundle } from "./types";

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
 *  2. **Hvad der tæller som en løsning** — afgøres af et hash over
 *     (seed, challenge, element). Samme element giver altid samme svar i
 *     samme run, så det føles som en egenskab ved verden frem for et
 *     terningkast. Man kan ikke prøve igen med samme idé og håbe på held.
 */

/** Andel af elementer der løser et challenge, efter hvornår det dukker op. */
const DIFFICULTY_BANDS: ReadonlyArray<{ upToPage: number; successRate: number }> = [
  { upToPage: 10, successRate: 1.0 }, // fortælleren finder på noget uanset hvad
  { upToPage: 20, successRate: 0.8 },
  { upToPage: 30, successRate: 0.7 },
  { upToPage: 40, successRate: 0.6 },
  { upToPage: Infinity, successRate: 0.4 },
];

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
}

export interface ChallengeState {
  active: ActiveChallenge | null;
  /** Sider siden sidste challenge (eller siden start) */
  gap: number;
  /** Challenges der allerede har været — gentages ikke i samme run */
  seen: string[];
  /** Har dette run mødt overhovedet ét? Driver "Carl the Lucky". */
  everSpawned: boolean;
}

export function freshChallengeState(): ChallengeState {
  return { active: null, gap: 0, seen: [], everSpawned: false };
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

export function successRateForPage(page: number): number {
  return DIFFICULTY_BANDS.find((b) => page <= b.upToPage)!.successRate;
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
  const pool = content.challenges.filter(
    (c) => !state.seen.includes(c.id) && page >= (c.minPage ?? 1),
  );
  if (pool.length === 0) return null;
  if (hash01(seed, "spawn", page) >= spawnChanceForGap(state.gap)) return null;
  const pick = Math.floor(hash01(seed, "pick", page) * pool.length);
  return pool[pick] ?? null;
}

/**
 * Løser dette element challenget?
 *
 * De oplagte svar virker altid — ellers ville spillet straffe god
 * ræsonnering. Alt andet afgøres af hash'et mod sværhedsbåndet: tidligt i
 * spillet finder fortælleren på en måde uanset hvad, senere skal man være
 * heldig eller kreativ.
 */
export function resolves(
  challenge: ChallengeDef,
  active: ActiveChallenge,
  elementId: string,
  seed: number,
): boolean {
  if (challenge.solvedBy.includes(elementId)) return true;
  const rate = successRateForPage(active.startedAtPage);
  return hash01(seed, challenge.id, elementId) < rate;
}
