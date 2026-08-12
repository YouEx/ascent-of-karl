/**
 * Oprindelses-politikken (SEC-002/RISK-001).
 *
 * CORS-headere alene stopper ikke en klient, der ikke er en browser — kun
 * browseren selv håndhæver CORS, og `curl` er ligeglad. Derfor er
 * `isOriginAllowed` en RIGTIG beslutning, brugt til at afvise med 403 FØR
 * koordinatoren og modellen overhovedet nås — ikke kun til at sætte en
 * header på et svar, der alligevel blev lavet.
 */

/** Kommasepareret liste til et array. Tom streng/undefined giver et tomt array ("tillad alle"). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Tom liste = ingen begrænsning sat (kun til lokal brug, jf. SEC-002).
 * Er der sat en liste, skal origin være til stede og stå på den.
 */
export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

/**
 * CORS-headerne til et svar. `Retry-After` er ikke en "simpel" header —
 * uden `access-control-expose-headers` gemmer browseren den for klientens
 * JavaScript, og klientens løfte om at "holde sig i ro til Retry-After" kan
 * ikke holdes.
 */
export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const ok = isOriginAllowed(origin, allowed);
  return {
    "access-control-allow-origin": ok && origin ? origin : (allowed[0] ?? "*"),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-expose-headers": "retry-after",
    "access-control-max-age": "86400",
  };
}
