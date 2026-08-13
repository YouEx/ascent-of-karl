/**
 * Formen på en anmodning, tjekket FØR noget rører modelbudgettet (TASK-002
 * "valider request shape... afvis med 400 uden at røre modelbudgettet").
 *
 * Sikkerhedsrunde 2, punkt 3 gjorde formen meget SMALLERE med vilje: kun
 * id'er, dom, og et valgfrit need-id/sommertal. Klienten kan ikke længere
 * sende navn/kind/stuff/traits/flavor — det var netop vejen ind for en
 * forfalsket beskrivelse (prompt-injektion) og for uendeligt mange unikke
 * cache-nøgler fra opdigtede id'er. Selve tekstopslaget (id → navn/kind/…)
 * sker i `catalog.ts`, som kun kender spillets EGET indhold — denne fil
 * kender intet til navne, kind, stuff, traits eller flavor.
 *
 * Grænserne er ikke gættet: id'er i `content/elements.json` er i dag højst
 * 16 tegn — grænsen her (64) er rigelig margin, ikke en stram måling af
 * indholdets stil (se `plan/feature-live-narrator-1.md`, TASK-002).
 */

export const LIMITS = {
  /** Højst 16 tegn i indholdet i dag → grænse 64, rigelig margin. */
  id: 64,
  /** Groft mål på råtekstens ÆGTE UTF-8 byte-længde, tjekket FØR JSON.parse
   *  (sikkerhedsrunde 2, punkt 7 — JS' streng-`.length` tæller UTF-16
   *  code-units, ikke bytes, og undervurderer derfor multi-byte-tegn). */
  bodyBytes: 6000,
  /** Rigeligt over `content/config.json`'s turnLimit (50). */
  summer: 10_000,
} as const;

/**
 * De domme workeren kender i dag (samme sæt som `DOMME` i `model.ts`). Et
 * ukendt verdikt er enten en fejl i klienten eller et forsøg på at sende
 * vilkårlig tekst ind i prompten — begge afvises.
 */
export const KNOWN_VERDICTS = [
  "plausible",
  "near-miss",
  "clash",
  "absurd",
  "self",
  "inert",
  "locked",
] as const;
export type KnownVerdict = (typeof KNOWN_VERDICTS)[number];

/**
 * Den SMALLE ledningsform (sikkerhedsrunde 2, punkt 3): kun kanoniske id'er
 * og dom. `catalog.ts` slår resten op i spillets eget indhold.
 */
export interface WireRequest {
  aId: string;
  bId: string;
  verdict: KnownVerdict;
  needId?: string;
  summer?: number;
}

export type ValidationResult =
  | { ok: true; body: WireRequest }
  | { ok: false; reason: string };

/**
 * Er råteksten (før parsing) for stor til at være en ægte anmodning?
 *
 * Rigtig UTF-8 byte-længde, IKKE `rawText.length` (som tæller UTF-16
 * code-units): en streng fuld af multi-byte tegn (fx emoji, accenter) kan
 * have en lille JS-`.length` men et body, der i virkeligheden fylder
 * dobbelt eller mere i de bytes, Cloudflare rent faktisk modtager og
 * betaler for at parse.
 */
export function isBodyTooLarge(rawText: string): boolean {
  return new TextEncoder().encode(rawText).length > LIMITS.bodyBytes;
}

/** `application/json` med eller uden parametre som `charset=utf-8`. */
export function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/** Struktur og grænser — ingen kendskab til lager, budget, netværk eller indhold. */
export function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "krop er ikke et objekt" };
  }
  const b = raw as Record<string, unknown>;

  if (!isBoundedString(b.aId, LIMITS.id)) return { ok: false, reason: "aId ugyldig" };
  if (!isBoundedString(b.bId, LIMITS.id)) return { ok: false, reason: "bId ugyldig" };
  if (typeof b.verdict !== "string" || !(KNOWN_VERDICTS as readonly string[]).includes(b.verdict)) {
    return { ok: false, reason: "ukendt verdikt" };
  }
  if (b.needId !== undefined && !isBoundedString(b.needId, LIMITS.id)) {
    return { ok: false, reason: "needId ugyldig" };
  }
  if (
    b.summer !== undefined &&
    (typeof b.summer !== "number" || !Number.isFinite(b.summer) || b.summer < 0 || b.summer > LIMITS.summer)
  ) {
    return { ok: false, reason: "summer ugyldig" };
  }

  return {
    ok: true,
    body: {
      aId: b.aId,
      bId: b.bId,
      verdict: b.verdict as KnownVerdict,
      needId: b.needId as string | undefined,
      summer: b.summer as number | undefined,
    },
  };
}
