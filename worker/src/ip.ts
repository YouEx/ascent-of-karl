/**
 * Klientens IP — kun til at tælle imod, aldrig til at gemme (SEC-003:
 * "Hash IP'en før al lagring; gem aldrig rå IP'er").
 *
 * Sikkerhedsrunde 2, punkt 1: identiteten skal fastslås ved KANTEN
 * (`index.ts`), ikke inde i Durable Object'et. Grunden er tillid: kun
 * `index.ts` kører direkte på Cloudflares egen netværkskant og kan stole på
 * `cf-connecting-ip` — den header kan en klient IKKE forfalske, fordi
 * Cloudflare selv sætter den ud fra selve TCP-forbindelsen.
 * `X-Forwarded-For` derimod er blot endnu en header, som enhver klient frit
 * kan sætte til hvad som helst — en fallback til den ville lade en spiller
 * vælge sin egen "IP" og dermed sit eget rate-limit-vindue. Derfor er den
 * fjernet helt: findes `cf-connecting-ip` ikke, er der ingen troværdig
 * identitet, og kaldet skal fejle LUKKET (se `index.ts`), ikke gætte videre
 * med et "unknown"-sentinel.
 *
 * `crypto.subtle` er standard Web Crypto, tilgængelig uændret i både
 * Cloudflare Workers og Node — derfor kan denne fil køre både i
 * produktionen og under root-Vitest uden noget Cloudflare-specifikt.
 */

/**
 * Navnet på headeren `index.ts` bruger til at videresende den FÆRDIGE hash
 * til Durable Object'et. Delt konstant, så kanten og DO'en aldrig kan drive
 * fra hinanden om, hvad headeren hedder — og så en klient, der selv sætter
 * den samme header (spoofing), har et navn at blive overskrevet under.
 */
export const INTERNAL_IP_HASH_HEADER = "x-internal-ip-hash";

/**
 * KUN Cloudflares egen, troværdige header — ingen fallback. En klient kan
 * ikke forfalske `cf-connecting-ip`: Cloudflares kant sætter den ud fra selve
 * TCP-forbindelsen, uanset hvad klienten selv sender med. Mangler den (fx
 * lokal test uden for Cloudflares netværk), er der ingen troværdig identitet
 * at hashe — `undefined`, ikke et gættet `"unknown"`.
 */
export function clientIpFromRequest(req: Request): string | undefined {
  const ip = req.headers.get("cf-connecting-ip");
  return ip && ip.length > 0 ? ip : undefined;
}

/** SHA-256 af salt+ip, som hex. Saltet gør hashen ubrugelig uden workerens hemmelighed. */
export async function hashClientIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HASH_HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Er denne værdi en gyldig SHA-256-hash i hex (64 små bogstaver/tal)?
 *
 * Durable Object'et stoler ALDRIG på en indkommende header uden dette
 * tjek — selvom kun `index.ts` burde sætte den (og altid overskriver en
 * klients eget forsøg, se `index.ts`), er en type-vagt her billig dybde:
 * den gør det umuligt for en forkert formet eller rå IP-lignende streng at
 * nå lager eller tælling, uanset hvilken vej den skulle komme.
 */
export function isValidIpHash(value: string | null | undefined): value is string {
  return typeof value === "string" && HASH_HEX_64.test(value);
}
