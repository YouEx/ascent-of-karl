import { loadContent } from "../../src/content";
import {
  deriveGeneratedCandidateSet,
  type GeneratedCandidate,
} from "../../src/core/generated-candidates";
import { sanitizeImprovisedElement } from "../../src/core/improvise";
import type { ElementDef } from "../../src/core/types";
import type { ImproviseWireRequest } from "./improvise-validate";

export const GENERATED_INTERNAL_CANDIDATES_HEADER =
  "x-internal-generated-candidates";

const content = loadContent();
const elements = new Map(
  content.elements.map((element) => [element.id, element]),
);

export interface CanonicalGeneratedBody {
  a: ElementDef;
  b: ElementDef;
  act: number;
  candidates: GeneratedCandidate[];
}

export type GeneratedCatalogResult =
  | { ok: true; body: CanonicalGeneratedBody }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authoritativeParent(raw: unknown): ElementDef | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const canonical = elements.get(raw.id);
  if (canonical) return canonical;
  return sanitizeImprovisedElement(raw);
}

export function resolveGeneratedBody(
  wire: ImproviseWireRequest,
): GeneratedCatalogResult {
  const a = elements.get(wire.a);
  if (!a) return { ok: false, reason: "unknown a" };
  const b = elements.get(wire.b);
  if (!b) return { ok: false, reason: "unknown b" };
  if (a.act > wire.act) return { ok: false, reason: "a unavailable in act" };
  if (b.act > wire.act) return { ok: false, reason: "b unavailable in act" };
  const [first, second] = a.id <= b.id ? [a, b] : [b, a];
  let candidates: GeneratedCandidate[];
  try {
    candidates = deriveGeneratedCandidateSet(first, second);
  } catch {
    return { ok: false, reason: "generated depth limit" };
  }
  return {
    ok: true,
    body: {
      a: first,
      b: second,
      act: wire.act,
      candidates,
    },
  };
}

export function resolveGeneratedSelectionBody(
  raw: unknown,
): GeneratedCatalogResult {
  if (!isRecord(raw)) return { ok: false, reason: "invalid schema" };
  const keys = Object.keys(raw).sort();
  if (
    keys.length !== 5 ||
    keys[0] !== "a" ||
    keys[1] !== "act" ||
    keys[2] !== "b" ||
    keys[3] !== "candidates" ||
    keys[4] !== "schemaVersion" ||
    raw.schemaVersion !== 1 ||
    !Number.isInteger(raw.act) ||
    (raw.act as number) < 1 ||
    (raw.act as number) > 5 ||
    !Array.isArray(raw.candidates)
  ) {
    return { ok: false, reason: "invalid schema" };
  }
  const a = authoritativeParent(raw.a);
  const b = authoritativeParent(raw.b);
  if (!a || !b) return { ok: false, reason: "invalid authoritative parent" };
  if (a.act > (raw.act as number) || b.act > (raw.act as number)) {
    return { ok: false, reason: "parent unavailable in act" };
  }
  const [first, second] = a.id <= b.id ? [a, b] : [b, a];
  let expected: GeneratedCandidate[];
  try {
    expected = deriveGeneratedCandidateSet(first, second);
  } catch {
    return { ok: false, reason: "generated depth limit" };
  }
  if (JSON.stringify(raw.candidates) !== JSON.stringify(expected)) {
    return { ok: false, reason: "candidate set mismatch" };
  }
  return {
    ok: true,
    body: {
      a: first,
      b: second,
      act: raw.act as number,
      candidates: expected,
    },
  };
}
