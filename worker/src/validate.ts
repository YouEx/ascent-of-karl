/**
 * Formen på en anmodning, tjekket FØR noget rører modelbudgettet (TASK-002
 * "valider request shape... afvis med 400 uden at røre modelbudgettet").
 *
 * Grænserne er ikke gættet: de er sat med rigelig margin over de virkelige
 * tal i `content/elements.json` og `content/acts/act-1.json` (målt for
 * denne opgave — se `plan/feature-live-narrator-1.md`, TASK-002):
 *   - id: højst 16 tegn i indholdet i dag → grænse 64.
 *   - name: højst 18 tegn i dag → grænse 120.
 *   - fritekst (kind/stuff/scale/flavor/karlMood/need): længste er
 *     `flavor` på 142 tegn → grænse 400.
 *   - traits: højst 4 stk. i dag, længste 10 tegn → grænse 10 stk. á 32 tegn.
 * Grænserne er til for at afvise misbrug og tastefejl, ikke til at
 * håndhæve indholdets stil — derfor rigelig margin, ikke stram måling.
 */

export const LIMITS = {
  id: 64,
  name: 120,
  text: 400,
  traitCount: 10,
  trait: 32,
  /** Groft mål på råtekstens længde, tjekket FØR JSON.parse. */
  bodyBytes: 6000,
  /** Rigeligt over `content/config.json`'s turnLimit (50). */
  summer: 10_000,
} as const;

/**
 * De domme workeren kender i dag (samme sæt som `DOMME` i `index.ts`/
 * `model.ts`). Et ukendt verdikt er enten en fejl i klienten eller et
 * forsøg på at sende vilkårlig tekst ind i prompten — begge afvises.
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

export interface ValidatedThing {
  id: string;
  name: string;
  kind?: string;
  stuff?: string;
  scale?: string;
  traits: string[];
  flavor?: string;
  karlMood?: string;
}

export interface ValidatedBody {
  a: ValidatedThing;
  b: ValidatedThing;
  verdict: KnownVerdict;
  need?: string;
  summer?: number;
}

export type ValidationResult =
  | { ok: true; body: ValidatedBody }
  | { ok: false; reason: string };

/** Er råteksten (før parsing) for stor til at være en ægte anmodning? */
export function isBodyTooLarge(rawText: string): boolean {
  return rawText.length > LIMITS.bodyBytes;
}

function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function isBoundedOptionalString(v: unknown, max: number): v is string | undefined {
  return v === undefined || (typeof v === "string" && v.length <= max);
}

function validateThing(raw: unknown, label: string): ValidatedThing | { reason: string } {
  if (typeof raw !== "object" || raw === null) return { reason: `${label} mangler` };
  const t = raw as Record<string, unknown>;
  if (!isBoundedString(t.id, LIMITS.id)) return { reason: `${label}.id ugyldig` };
  if (!isBoundedString(t.name, LIMITS.name)) return { reason: `${label}.name ugyldig` };
  if (!isBoundedOptionalString(t.kind, LIMITS.text)) return { reason: `${label}.kind ugyldig` };
  if (!isBoundedOptionalString(t.stuff, LIMITS.text)) return { reason: `${label}.stuff ugyldig` };
  if (!isBoundedOptionalString(t.scale, LIMITS.text)) return { reason: `${label}.scale ugyldig` };
  if (!isBoundedOptionalString(t.flavor, LIMITS.text)) return { reason: `${label}.flavor ugyldig` };
  if (!isBoundedOptionalString(t.karlMood, LIMITS.text)) return { reason: `${label}.karlMood ugyldig` };

  let traits: string[] = [];
  if (t.traits !== undefined) {
    if (!Array.isArray(t.traits) || t.traits.length > LIMITS.traitCount) {
      return { reason: `${label}.traits ugyldig` };
    }
    if (!t.traits.every((x) => isBoundedString(x, LIMITS.trait))) {
      return { reason: `${label}.traits ugyldig` };
    }
    traits = t.traits as string[];
  }

  return {
    id: t.id,
    name: t.name,
    kind: t.kind as string | undefined,
    stuff: t.stuff as string | undefined,
    scale: t.scale as string | undefined,
    traits,
    flavor: t.flavor as string | undefined,
    karlMood: t.karlMood as string | undefined,
  };
}

/** Struktur og grænser — ingen kendskab til lager, budget eller netværk. */
export function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "krop er ikke et objekt" };
  }
  const b = raw as Record<string, unknown>;

  const a = validateThing(b.a, "a");
  if ("reason" in a) return { ok: false, reason: a.reason };
  const bb = validateThing(b.b, "b");
  if ("reason" in bb) return { ok: false, reason: bb.reason };

  if (typeof b.verdict !== "string" || !(KNOWN_VERDICTS as readonly string[]).includes(b.verdict)) {
    return { ok: false, reason: "ukendt verdikt" };
  }
  if (!isBoundedOptionalString(b.need, LIMITS.text)) {
    return { ok: false, reason: "need ugyldig" };
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
      a,
      b: bb,
      verdict: b.verdict as KnownVerdict,
      need: b.need as string | undefined,
      summer: b.summer as number | undefined,
    },
  };
}
