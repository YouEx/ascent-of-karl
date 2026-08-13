/**
 * Lager-livscyklus (sikkerhedsrunde 2, punkt 4): Durable Object storage har
 * ingen indbygget TTL — en post, der aldrig slettes eksplicit, ligger der
 * for evigt. To ting skal ryddes op, og de er forskellige problemer:
 *
 *   1. Rate-limit-poster (`rl:<ipHash>`) hvor ALLE tidsstempler er faldet
 *      ud af det rullende vindue: posten er død vægt, ingen fremtidig
 *      forespørgsel vil nogensinde læse noget nyttigt fra den igen, før
 *      den under alle omstændigheder ville blive overskrevet ved næste
 *      forespørgsel fra samme IP-hash (som måske aldrig kommer).
 *   2. Cache-poster (`cache:...`) der er ældre end en fornuftig maksimal
 *      alder — ikke fordi svaret er blevet forkert (det er stadig samme
 *      par+dom+version), men fordi en ubegrænset cache er en ubegrænset
 *      regning i lagerplads, og gamle, sjældent ramte par er de billigste
 *      at genskabe ved næste forespørgsel.
 *
 * Begge funktioner her er RENE: de tager det allerede indlæste indhold
 * (typisk fra `storage.list({ prefix })`) og returnerer nøglerne der bør
 * slettes — selve `storage.delete(...)`-kaldet sker i `coordinator-do.ts`s
 * alarm-handler, som er den eneste Cloudflare-specifikke del.
 */

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
