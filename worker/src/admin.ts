/**
 * TASK-008: godkendelse af `/admin/pairs`-eksporten (den høstede
 * efterspørgsel, se `stats.ts`). Beskyttet af en OBLIGATORISK
 * `ADMIN_EXPORT_TOKEN`-hemmelighed — findes den ikke, fejler ALT admin-
 * adgang LUKKET, uanset hvad en anmodning sender med (samme "fail closed
 * uden hemmelighed"-mønster som `index.ts`s `IP_HASH_SALT`).
 *
 * `crypto.subtle` er standard Web Crypto — tilgængelig uændret i både
 * Cloudflare Workers og Node (root-Vitest), præcis som `ip.ts`s
 * `hashClientIp` allerede udnytter. Der findes ikke ét
 * `timingSafeEqual`-primitiv, der virker identisk i begge miljøer uden en
 * ny afhængighed — løsningen her er derfor at HASHE begge sider af
 * sammenligningen med SHA-256 først (samme primitiv som `hashClientIp`),
 * og derefter sammenligne de to FASTE 64-hex-tegns digests med en manuel
 * XOR-akkumulering, der altid løber igennem HELE strengen uanset hvor
 * tidligt de to sider måtte afvige. Dette undgår at lække tokenets rå
 * længde eller indhold via en naiv `===`/substring-sammenligning, uden
 * nogen ny afhængighed og med identisk opførsel i begge runtimes.
 */

/** Intern markørheader: `index.ts` sætter den KUN efter en bestået
 * token-kontrol, og Durable Object'et stoler på dens tilstedeværelse som
 * "kanten har allerede godkendt denne anmodning" — samme tillidsmønster
 * som `ip.ts`s `INTERNAL_IP_HASH_HEADER`. Den RÅ hemmelighed (tokenet)
 * forlader ALDRIG `index.ts` — Durable Object'et ser kun denne markør. */
export const ADMIN_VERIFIED_HEADER = "x-internal-admin-verified";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Konstant-tids sammenligning af to strenge med SAMME (faste) længde —
 * XOR-akkumulerer over HELE strengen, uanset hvor tidligt de to sider
 * måtte afvige, så sammenligningstiden ikke afslører hvor et uoverensstemt
 * tegn sidder.
 */
function constantTimeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Er de to hemmeligheder ens? Hasher BEGGE sider først (se fil-
 * kommentaren for hvorfor), sammenligner derefter de to faste
 * 64-hex-tegns digests konstant-tids. Bruges til selve token-
 * sammenligningen i `isValidAdminToken` nedenfor, men eksporteret separat
 * så den kan bevises direkte (`tests/worker-admin.test.ts`) uden om
 * "Bearer "-parsingen.
 */
export async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return constantTimeStringEquals(hashA, hashB);
}

/**
 * Gyldig admin-adgang? Fejler LUKKET (`false`) — aldrig en kastet fejl,
 * aldrig en begrundelse — hvis:
 *   - `expectedToken` (den konfigurerede hemmelighed) slet ikke er sat.
 *     Ingen hemmelighed konfigureret betyder INGEN admin-adgang, ALDRIG et
 *     gættet standard-token.
 *   - `Authorization`-headeren mangler.
 *   - Den ikke er formet som `Bearer <token>`.
 *   - Det angivne token ikke er konstant-tids-ens med `expectedToken`.
 *
 * Kaldstedet (`index.ts`s `handleAdminExport`) svarer generisk 401 i ALLE
 * disse tilfælde — denne funktion returnerer bevidst kun `boolean`, ikke
 * en begrundelse, så der intet er at lække ved et uheld.
 */
export async function isValidAdminToken(
  authorizationHeader: string | null | undefined,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!expectedToken) return false;
  if (!authorizationHeader) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  const provided = authorizationHeader.slice(prefix.length);
  if (!provided) return false;
  return constantTimeEquals(provided, expectedToken);
}
