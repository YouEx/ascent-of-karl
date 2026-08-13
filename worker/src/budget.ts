/**
 * Det globale, daglige loft over kald der når frem til modellen (TASK-003).
 *
 * "Dagen" er UTC — Cloudflare-workeren har ingen lokal tidszone, og et loft
 * der nulstiller sig ved UTC-midnat er det eneste, der er entydigt uden at
 * spørge spilleren, hvor han bor.
 *
 * Reservationen sker FØR modelkaldet: et kald der når frem til OpenAI
 * tæller, selv hvis OpenAI bagefter svarer dårligt. Det er det eneste, der
 * gør loftet til et deterministisk regnskabsloft frem for et gæt.
 */

export interface BudgetRecord {
  /** UTC-dato som "YYYY-MM-DD". */
  date: string;
  /** Antal reserverede kald denne dato. */
  count: number;
}

export interface BudgetReservation {
  ok: boolean;
  /** Den nye tilstand der skal gemmes — uanset ok. */
  record: BudgetRecord;
  /** Kun meningsfuld når ok er false. */
  retryAfterSeconds: number;
}

/** UTC-datonøglen for et givet tidspunkt, i millisekunder siden epoke. */
export function utcDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Sekunder til næste UTC-midnat — den sandfærdige `Retry-After` ved 503. */
export function secondsUntilNextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const nextMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((nextMidnight - nowMs) / 1000));
}

/**
 * Prøver at reservere én af dagens pladser.
 *
 * Ruller automatisk over til en frisk tæller, hvis den gemte post er fra en
 * tidligere UTC-dato — kaldstedet behøver ikke selv vide, om det er en ny
 * dag.
 */
export function reserveBudget(
  existing: BudgetRecord | undefined,
  nowMs: number,
  max: number,
): BudgetReservation {
  const today = utcDateKey(nowMs);
  const current: BudgetRecord =
    existing && existing.date === today ? existing : { date: today, count: 0 };
  if (max > 0 && current.count < max) {
    return {
      ok: true,
      record: { date: today, count: current.count + 1 },
      retryAfterSeconds: 0,
    };
  }
  return {
    ok: false,
    record: current,
    retryAfterSeconds: secondsUntilNextUtcMidnight(nowMs),
  };
}
