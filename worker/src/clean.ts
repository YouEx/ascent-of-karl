/**
 * Sidste kontrol før modellens svar må gemmes i den delte cache og vises
 * for en spiller — samme regler som klientens egen `clean()` i
 * `src/narrator/live.ts`, men workerens egen kopi (workeren importerer
 * bevidst intet fra `../../src`, jf. `worker/package.json`).
 *
 * "Cache ikke fejl" (TASK-004) betyder også: en sætning der bliver kasseret
 * her, skrives ALDRIG til cachen — kun et resultat der består disse tjek,
 * er værd at dele mellem spillere.
 */
const PLACEHOLDER = /\{[a-z]+\}/i;

export function cleanModelText(
  raw: string | undefined,
  aName: string,
  bName: string,
): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
  if (t.length < 20 || t.length > 320) return undefined;
  if (t.includes("\n")) return undefined;
  const lower = t.toLowerCase();
  if (!lower.includes(aName.toLowerCase())) return undefined;
  if (!lower.includes(bName.toLowerCase())) return undefined;
  if (PLACEHOLDER.test(t)) return undefined;
  return t;
}
