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
 * punkt 3, og UDVIDET i en opfølgning derefter): den fulde prompt-kontrakt
 * (system-prompt + alle dom-forklaringer + brugerprompt-skabelonen,
 * `worker/src/model.ts`s `PROMPT_VERSION_INPUT`) eller selve modellen
 * (`MODEL`-variablen) kan ændre sig, og en gammel, cachet linje skal ikke
 * blive ved med at blive serveret, som om den stadig var skrevet af den nye
 * prompt. Sikkerhedsrunde 2 løste dette med et MANUELT versionstal
 * (`CACHE_VERSION`), en udvikler selv skulle huske at bumpe — et løfte, ikke
 * en garanti. Sikkerhedsrunde 3 erstattede løftet med `promptNamespace()`
 * nedenfor, men dækkede først kun `SYSTEM` — en opfølgende gennemgang
 * fandt at hverken dom-forklaringerne (`DOMME`) eller selve
 * brugerprompt-skabelonen indgik, selvom begge former den genererede tekst
 * lige så meget som `SYSTEM`. `PROMPT_VERSION_INPUT` retter det: navnerummet
 * udledes nu AUTOMATISK af HELE prompt-kontrakten og modellen, så en
 * ændring i ét af de tre ændrer navnerummet af sig selv, uden at nogen skal
 * huske noget som helst.
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
 * Udleder et deterministisk, kort navnerum fra den FULDE prompt-kontrakt
 * (`promptContract` — i praksis `model.ts`s `PROMPT_VERSION_INPUT`: system-
 * prompt + dom-forklaringer + brugerprompt-skabelon, se filens top-
 * kommentar), den konfigurerede model (sikkerhedsrunde 3, punkt 3, udvidet
 * i en opfølgning), og — siden TASK-007 — stemmedommerens profil-hash
 * (`voiceProfileHash`, i praksis `voice/gate.ts`s `VOICE_PROFILE_HASH`,
 * udledt af `worker/src/generated/voice-profile.json`). Funktionen selv er
 * ligeglad med HVAD nogen af de tre inputs indeholder — den hasher blot tre
 * strenge — så testene herunder kan fodre den vilkårlige literaler uden at
 * kende `model.ts` eller `voice/gate.ts`.
 *
 * `voiceProfileHash` er VALGFRI (standard tom streng) udelukkende for at
 * lade EKSISTERENDE to-argument-kald (denne fils egne ældre tests, samt
 * `PROMPT_VERSION_INPUT`-sensitivitetstestene) forblive uændrede — de
 * tester prompt/model-følsomhed, en ANDEN akse end stemmeprofilen, og skal
 * ikke tvinges til at kende til TASK-007 for at blive ved med at bestå. Den
 * RIGTIGE produktionskode (`coordinator-do.ts`s `getDeps()`) sender altid
 * det tredje argument eksplicit — det er IKKE et løfte om at huske at
 * bumpe noget, ligesom de to andre, det udledes automatisk af selve
 * profil-artefaktet.
 *
 * NUL-tegn adskiller alle tre inputs, så ingen kombination af kortere/
 * længere delstrenge kan give samme hash ved simpel sammenkædning.
 *
 * Kaldes ÉN gang pr. Durable Object-instans (`coordinator-do.ts`s
 * `getDeps()`), ikke pr. forespørgsel — prompt-kontrakten, modellen og
 * stemmeprofilen ændrer sig kun ved en gendeploy, aldrig midt i en kørende
 * instans.
 */
export function promptNamespace(promptContract: string, model: string, voiceProfileHash = ""): string {
  return fnv1a32(`${model}\u0000${promptContract}\u0000${voiceProfileHash}`);
}

export function pairCacheKey(aId: string, bId: string, verdict: string, namespace: string): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${namespace}:${first}+${second}:${verdict}`;
}
