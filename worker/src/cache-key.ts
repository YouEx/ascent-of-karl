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
 * Navnerum (sikkerhedsrunde 2 punkt 4, gjort AUTOMATISK i sikkerhedsrunde 3
 * punkt 3): prompten i `worker/src/model.ts` eller selve modellen
 * (`MODEL`-variablen) kan ændre sig, og en gammel, cachet linje skal ikke
 * blive ved med at blive serveret, som om den stadig var skrevet af den nye
 * prompt. Sikkerhedsrunde 2 løste dette med et MANUELT versionstal
 * (`CACHE_VERSION`), en udvikler selv skulle huske at bumpe — et løfte, ikke
 * en garanti. Sikkerhedsrunde 3 erstattede løftet med `promptNamespace()`
 * nedenfor: navnerummet udledes AUTOMATISK af selve promptteksten og
 * modellen, så en ændring i den ene eller den anden ændrer navnerummet af
 * sig selv, uden at nogen skal huske noget som helst.
 */

/**
 * Simpel, deterministisk, IKKE-kryptografisk hash (FNV-1a, 32-bit) — nok
 * til et NAVNERUM, der skal ændre sig når prompten eller modellen gør,
 * IKKE en sikkerhedsgaranti (til det formål bruges SHA-256 andetsteds, se
 * `ip.ts`s `hashClientIp`). Ingen ny afhængighed: hele algoritmen er disse
 * få linjer, og den er ren og synkron — ingen `crypto.subtle`-omvej
 * nødvendig for noget, der blot skal navngive en cache-bøtte.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Udleder et deterministisk, kort navnerum fra selve promptteksten og den
 * konfigurerede model (sikkerhedsrunde 3, punkt 3). Et NUL-tegn adskiller de
 * to inputs, så `model="a", prompt="bc"` og `model="ab", prompt="c"` aldrig
 * kan give samme hash ved simpel sammenkædning.
 *
 * Kaldes ÉN gang pr. Durable Object-instans (`coordinator-do.ts`s
 * `getDeps()`), ikke pr. forespørgsel — prompten og modellen ændrer sig
 * kun ved en gendeploy, aldrig midt i en kørende instans.
 */
export function promptNamespace(systemPrompt: string, model: string): string {
  return fnv1a32(`${model}\u0000${systemPrompt}`);
}

export function pairCacheKey(aId: string, bId: string, verdict: string, namespace: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${namespace}:${first}+${second}:${verdict}`;
}
