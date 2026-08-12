/**
 * Rullende vindue pr. klient — SEC-003's "loft pr. IP" fra søsterplanens
 * mønster (`plan/feature-improvised-solutions-1.md`), genbrugt frem for
 * genopfundet.
 *
 * Ren funktion: intet lager, intet ur herinde. Kaldes med det gemte sæt
 * tidsstempler, nu-tidspunktet og de to grænser, og returnerer både
 * beslutningen og det nye sæt der skal gemmes. Det gør den testbar uden en
 * Durable Object og uden mock af `Date.now`.
 */

export interface RollingWindowResult {
  /** Må dette kald slippe igennem? */
  allowed: boolean;
  /** Tidsstemplerne der skal gemmes efter dette kald (beskåret, og udvidet hvis tilladt). */
  timestamps: number[];
  /** Kun meningsfuld når allowed er false: sekunder til vinduet åbner igen. */
  retryAfterSeconds: number;
}

/** Fjerner tidsstempler der er faldet ud af vinduet. */
export function pruneWindow(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

/**
 * Tjekker og — hvis tilladt — reserverer én plads i vinduet.
 *
 * `max <= 0` betyder "luk helt", hvilket ellers ikke er en gyldig
 * produktionsværdi, men koden skal ikke kunne krasje eller lukke sig selv
 * op på den slags input.
 */
export function checkRollingWindow(
  existing: readonly number[],
  now: number,
  windowMs: number,
  max: number,
): RollingWindowResult {
  const pruned = pruneWindow(existing, now, windowMs);
  if (max > 0 && pruned.length < max) {
    return { allowed: true, timestamps: [...pruned, now], retryAfterSeconds: 0 };
  }
  const oldest = pruned[0];
  const retryAfterMs = oldest !== undefined ? oldest + windowMs - now : windowMs;
  return {
    allowed: false,
    timestamps: pruned,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}
