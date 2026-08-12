/**
 * Klientens IP — kun til at tælle imod, aldrig til at gemme (SEC-003:
 * "Hash IP'en før al lagring; gem aldrig rå IP'er").
 *
 * `crypto.subtle` er standard Web Crypto, tilgængelig uændret i både
 * Cloudflare Workers og Node — derfor kan denne fil køre både i
 * produktionen og under root-Vitest uden noget Cloudflare-specifikt.
 */

export function clientIpFromRequest(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** SHA-256 af salt+ip, som hex. Saltet gør hashen ubrugelig uden workerens hemmelighed. */
export async function hashClientIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
