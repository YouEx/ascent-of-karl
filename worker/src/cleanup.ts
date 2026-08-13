/**
 * Lager-livscyklus (sikkerhedsrunde 2, punkt 4; udvidet med et tredje
 * problem i sikkerhedsrunde 3, punkt 2): Durable Object storage har ingen
 * indbygget TTL — en post, der aldrig slettes eksplicit, ligger der for
 * evigt. Tre ting skal ryddes op, og de er hver sit problem:
 *
 *   1. Rate-limit-poster (`rl:<ipHash>`) hvor ALLE tidsstempler er faldet
 *      ud af det rullende vindue: posten er død vægt, ingen fremtidig
 *      forespørgsel vil nogensinde læse noget nyttigt fra den igen, før
 *      den under alle omstændigheder ville blive overskrevet ved næste
 *      forespørgsel fra samme IP-hash (som måske aldrig kommer).
 *   2. Cache-poster (`cache:...`) der er ældre end en fornuftig maksimal
 *      alder — ikke fordi svaret er blevet forkert (det er stadig samme
 *      par+dom+navnerum), men fordi en ubegrænset cache er en ubegrænset
 *      regning i lagerplads, og gamle, sjældent ramte par er de billigste
 *      at genskabe ved næste forespørgsel.
 *   3. Pr.-IP-budgetposter (`budget:ip:<ipHash>`, sikkerhedsrunde 2 punkt
 *      2): hver aktiv spiller-IP-hash skaber sin egen post PR. DAG, og
 *      uden oprydning ville dette lager vokse for evigt med én post pr.
 *      IP-hash, der nogensinde har spurgt — de fleste af dem for altid
 *      irrelevante efter selve dagen er omme.
 *
 * Alle funktioner her er RENE: de tager det allerede indlæste indhold
 * (typisk fra `storage.list({ prefix })`) og returnerer nøglerne der bør
 * slettes — selve `storage.delete(...)`-kaldet sker i `coordinator-do.ts`s
 * alarm-handler, som er den eneste Cloudflare-specifikke del.
 */

import { utcDateKey } from "./budget";

/**
 * Hvilke rate-limit-nøgler har INGEN tidsstempler tilbage i vinduet?
 *
 * En post overlever så snart bare ét tidsstempel stadig er inden for
 * vinduet — den bliver alligevel snart overskrevet af `checkRollingWindow`
 * ved næste rigtige forespørgsel, og at slette den for tidligt sparer
 * intet.
 */
export function findStaleRateLimitKeys(
  entries: ReadonlyMap<string, readonly number[]>,
  now: number,
  windowMs: number,
): string[] {
  const stale: string[] = [];
  for (const [key, timestamps] of entries) {
    const hasFreshTimestamp = timestamps.some((t) => now - t < windowMs);
    if (!hasFreshTimestamp) stale.push(key);
  }
  return stale;
}

/** Hvilke cache-poster er ældre end `maxAgeMs`? */
export function findExpiredCacheKeys(
  entries: ReadonlyMap<string, { readonly createdAt: number }>,
  now: number,
  maxAgeMs: number,
): string[] {
  const expired: string[] = [];
  for (const [key, entry] of entries) {
    if (now - entry.createdAt > maxAgeMs) expired.push(key);
  }
  return expired;
}

/**
 * Hvilke pr.-IP-budgetposter har en gemt UTC-dato der hverken er I DAG
 * eller I GÅR (sikkerhedsrunde 3, punkt 2)?
 *
 * "I dag ELLER i går" — ikke kun "i dag" — er en bevidst tolerance for
 * uret mellem hvornår en post blev SKREVET og hvornår alarmen tilfældigvis
 * KØRER: en post dateret i går, skrevet ét sekund før UTC-midnat, må ikke
 * ryddes bare fordi alarmen kører nogle sekunder inde i den nye dag — den
 * er reelt kun sekunder gammel, ikke en hel dag. UTC har ingen sommertid,
 * så subtraktionen på 24 timer er entydig (samme antagelse som `budget.ts`s
 * `utcDateKey`/`secondsUntilNextUtcMidnight` allerede bygger på).
 */
export function findStaleIpBudgetKeys(
  entries: ReadonlyMap<string, { readonly date: string }>,
  now: number,
): string[] {
  const today = utcDateKey(now);
  const yesterday = utcDateKey(now - 24 * 60 * 60 * 1000);
  const stale: string[] = [];
  for (const [key, entry] of entries) {
    if (entry.date !== today && entry.date !== yesterday) stale.push(key);
  }
  return stale;
}
