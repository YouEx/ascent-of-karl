import {
  deriveGeneratedCandidateSet,
  type GeneratedCandidate,
} from "./generated-candidates";
import type { ElementDef } from "./types";

export const PRESENTATION_KEYS = [
  "plain",
  "dry-pride",
  "quiet-regret",
] as const;
export type PresentationKey = (typeof PRESENTATION_KEYS)[number];

export interface GeneratedGameplayProposal {
  schemaVersion: 1;
  candidateKey: string;
  presentationKey: PresentationKey;
}

export type GeneratedProposalValidation =
  | {
      ok: true;
      proposal: GeneratedGameplayProposal;
      candidate: GeneratedCandidate;
    }
  | { ok: false; reason: string };

function exactRecord(
  raw: unknown,
): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

export function validateGeneratedGameplayProposal(
  raw: unknown,
  a: ElementDef,
  b: ElementDef,
): GeneratedProposalValidation {
  if (!exactRecord(raw)) return { ok: false, reason: "proposal must be an object" };
  const keys = Object.keys(raw).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "candidateKey" ||
    keys[1] !== "presentationKey" ||
    keys[2] !== "schemaVersion"
  ) {
    return { ok: false, reason: "proposal has unexpected fields" };
  }
  if (raw.schemaVersion !== 1) {
    return { ok: false, reason: "proposal schemaVersion must be 1" };
  }
  if (
    typeof raw.candidateKey !== "string" ||
    typeof raw.presentationKey !== "string" ||
    !PRESENTATION_KEYS.includes(raw.presentationKey as PresentationKey)
  ) {
    return { ok: false, reason: "proposal fields are invalid" };
  }
  const candidate = deriveGeneratedCandidateSet(a, b).find(
    (entry) => entry.candidateKey === raw.candidateKey,
  );
  if (!candidate) {
    return { ok: false, reason: "candidateKey was not offered" };
  }
  return {
    ok: true,
    proposal: {
      schemaVersion: 1,
      candidateKey: raw.candidateKey,
      presentationKey: raw.presentationKey as PresentationKey,
    },
    candidate,
  };
}

const PREFIXES: Record<PresentationKey, string> = {
  plain: "",
  "dry-pride": "Karl's ",
  "quiet-regret": "Regrettable ",
};

export function applyGeneratedPresentation(
  candidate: GeneratedCandidate,
  presentationKey: PresentationKey,
): ElementDef {
  const prefix = PREFIXES[presentationKey];
  return {
    ...candidate.element,
    name: `${prefix}${candidate.element.name}`.slice(0, 160),
  };
}
