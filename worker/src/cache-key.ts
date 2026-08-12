/**
 * Nøglen til den delte cache (TASK-004): parrets to id'er, sorteret, plus
 * dommen. Samme skema som klientens egen `key()` i `src/narrator/live.ts`,
 * så de to lag taler om cachning på samme måde — men denne fil er workerens
 * egen, uafhængig af resten af repoet (se `worker/package.json`: ingen
 * import fra `../../src`).
 *
 * Sorteret, fordi parret {a, b} og {b, a} er samme spørgsmål. Dom-følsom,
 * fordi samme par kan fejle på flere forskellige måder (clash i ét run,
 * near-miss i et andet), og de fortjener hver sin replik.
 */
export function pairCacheKey(aId: string, bId: string, verdict: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${first}+${second}:${verdict}`;
}
