/**
 * Ren fortolkning af Wrangler-vars (som altid ankommer som strenge, eller
 * slet ikke). Trukket ud af `coordinator-do.ts`, så fejl i selve
 * parsningen — som den nedenstående — kan fanges af Vitest uden en
 * Cloudflare-runtime.
 */

/**
 * Falder tilbage til `fallback`, hvis `raw` mangler, ikke er et tal, eller
 * ikke er strengt positivt. Bruges til vinduer/grænser hvor 0 eller derunder
 * aldrig er en gyldig konfiguration (fx et rullende vindue på 0 sekunder).
 */
export function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Som `toPositiveInt`, men tillader eksplicit 0. Bruges KUN til det daglige
 * opstrømsloft (TASK-003): 0 er den tilsigtede nødstopsværdi (TASK-005's
 * kill switch — "sæt dagligt loft til 0"), ikke en fejlindtastning, og må
 * ikke falde tilbage til defaulten.
 *
 * `!raw` alene ville IKKE fange dette — `"0"` er en sand streng i
 * JavaScript. Fejlen sad i næste led: en betingelse som `n > 0` forkaster
 * en tilsigtet nul lige så stille som en tom eller ugyldig værdi. Denne
 * funktion bruger `n >= 0`, så kun mangel, tomhed, ikke-tal eller negative
 * tal falder tilbage — 0 går igennem uændret.
 */
export function toNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
