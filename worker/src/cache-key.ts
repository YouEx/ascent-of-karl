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
 *
 * Versioneret (sikkerhedsrunde 2, punkt 4): prompten i `worker/src/model.ts`
 * eller selve modellen (`MODEL`-variablen) kan ændre sig, og en gammel,
 * cachet linje skal ikke blive ved med at blive serveret, som om den stadig
 * var skrevet af den nye prompt. Præfikset gør gamle nøgler simpelthen
 * UOPSLÅELIGE i samme øjeblik versionen bumpes — ingen migrering, intet
 * eksplicit slet nødvendigt for at "invalidere" (de fysiske poster rømmes
 * senere af `worker/src/cleanup.ts`s alderstjek, men er allerede uskadelige
 * fra første forespørgsel efter bumpet).
 *
 * Sådan bumpes den: rediger `CACHE_VERSION` (fx `"v1"` → `"v2"`) når som
 * helst prompten i `model.ts` (SYSTEM/`buildUserPrompt`) eller `MODEL` i
 * `wrangler.toml` ændres på en måde, der gør gamle linjer util passende
 * stilistisk eller faktuelt. En version, der aldrig bumpes, er lige så
 * forkert som en cache, der aldrig ryddes.
 */
export const CACHE_VERSION = "v1";

export function pairCacheKey(aId: string, bId: string, verdict: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${CACHE_VERSION}:${first}+${second}:${verdict}`;
}
