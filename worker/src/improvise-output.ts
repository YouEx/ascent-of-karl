/** Den eneste modelkontrollerede del af et improviseret element. */

export interface ImproviseCopy {
  name: string;
  flavor: string;
}

export const IMPROVISE_OUTPUT_LIMITS = {
  nameChars: 48,
  nameWords: 3,
  flavorChars: 240,
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const QUOTES = /["'`“”‘’«»]/;
const URL =
  /(?:https?:\/\/|www\.|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\/\S*)?)/i;
const PUNCTUATION_WILDERNESS = /[!?.,;:—–-]{3,}/;
const UNSAFE_PUNCTUATION = /[{}\[\]<>\\|@#$%^*_+=~\/]/;
const SAFE_NAME = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
const SAFE_FLAVOR = /^[\p{L}\p{N}\p{Zs}.,!?;:()—–-]+$/u;

function isSafeCommon(value: string): boolean {
  return (
    value === value.trim() &&
    !CONTROL_CHARS.test(value) &&
    !QUOTES.test(value) &&
    !URL.test(value) &&
    !PUNCTUATION_WILDERNESS.test(value) &&
    !UNSAFE_PUNCTUATION.test(value)
  );
}

/** Strikt skema + indholdsgrænser. Der renses ikke: ugyldigt betyder afvist. */
export function validateImproviseOutput(raw: unknown): ImproviseCopy | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "flavor" || keys[1] !== "name") return undefined;
  if (typeof body.name !== "string" || typeof body.flavor !== "string") return undefined;

  const { name, flavor } = body;
  if (name.length === 0 || name.length > IMPROVISE_OUTPUT_LIMITS.nameChars) return undefined;
  if (name.split(/\s+/).length > IMPROVISE_OUTPUT_LIMITS.nameWords) return undefined;
  if (!SAFE_NAME.test(name) || !isSafeCommon(name)) return undefined;

  if (flavor.length === 0 || flavor.length > IMPROVISE_OUTPUT_LIMITS.flavorChars) return undefined;
  if (!SAFE_FLAVOR.test(flavor) || !isSafeCommon(flavor)) return undefined;

  return { name, flavor };
}
