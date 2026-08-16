import type { GameState } from "../core/engine";
import type {
  CombineOutcome,
  ContentBundle,
} from "../core/types";

export const RUNTIME_COMMENTARY_KINDS = [
  "opening",
  "discovery",
  "invention",
  "challenge",
  "branch",
  "ending",
] as const;

export type RuntimeCommentaryKind =
  (typeof RUNTIME_COMMENTARY_KINDS)[number];
export type RuntimeCommentaryRole =
  | "humour"
  | "guidance"
  | "story";

export interface RuntimeCommentaryCue {
  schemaVersion: 1;
  eventId: string;
  kind: RuntimeCommentaryKind;
  turn: number;
  context: string;
  requiredTerms: string[];
}

export interface RuntimeCommentaryRecord {
  schemaVersion: 1;
  eventId: string;
  cue: RuntimeCommentaryCue;
  text: string;
  roles: RuntimeCommentaryRole[];
  normalizedHash: string;
}

export interface RuntimeCommentaryResult {
  schemaVersion: 1;
  eventId: string;
  text: string;
  roles: RuntimeCommentaryRole[];
  audioAvailable: boolean;
}

export interface RuntimeCommentaryModelRequest {
  schemaVersion: 1;
  seedCode: string;
  commentaryIndex: number;
  cue: RuntimeCommentaryCue;
  run: {
    act: number;
    attempts: number;
    discoveredCount: number;
    solvedNeedIds: string[];
    completedBranchIds: string[];
    endingId: string | null;
  };
  recentLines: string[];
}

const MAX_COMMENTARY_RECORDS = 51;

function elementName(content: ContentBundle, id: string): string {
  return (
    content.elements.find((element) => element.id === id)?.name ?? id
  );
}

function endingName(content: ContentBundle, id: string): string {
  return content.endings.find((ending) => ending.id === id)?.title ?? id;
}

function branchName(content: ContentBundle, id: string): string {
  return content.branches?.find((branch) => branch.id === id)?.title ?? id;
}

function cue(
  eventId: string,
  kind: RuntimeCommentaryKind,
  turn: number,
  context: string,
  requiredTerms: readonly string[],
): RuntimeCommentaryCue {
  return {
    schemaVersion: 1,
    eventId,
    kind,
    turn,
    context,
    requiredTerms: [...new Set(requiredTerms)].filter(Boolean).slice(0, 6),
  };
}

export function openingCommentaryCue(
  content: ContentBundle,
  state: GameState,
): RuntimeCommentaryCue {
  const plan = state.lifePlan;
  const openingId = plan?.openingId ?? "legacy opening";
  const startingIds = plan?.startingElementIds ?? state.discovered;
  const startingNames = startingIds
    .slice(0, 5)
    .map((id) => elementName(content, id));
  return cue(
    "opening",
    "opening",
    0,
    `Opening ${openingId}. Karl begins with ${startingNames.join(", ")}.`,
    ["Karl", ...startingNames],
  );
}

function challengeCue(
  attemptId: string,
  outcome: CombineOutcome,
  turn: number,
): RuntimeCommentaryCue | undefined {
  const challenge = outcome.challenge;
  if (!challenge || challenge.kind === "ticking") return undefined;
  const resolution =
    challenge.kind === "solved"
      ? `solved with ${challenge.by.name}`
      : challenge.kind;
  return cue(
    `attempt:${attemptId}`,
    "challenge",
    turn,
    `Challenge ${challenge.def.title} was ${resolution}.`,
    ["Karl", challenge.def.title],
  );
}

export function attemptCommentaryCue(options: {
  attemptId: string;
  content: ContentBundle;
  before: GameState;
  after: GameState;
  outcome: CombineOutcome;
}): RuntimeCommentaryCue | undefined {
  const { attemptId, content, before, after, outcome } = options;
  const eventId = `attempt:${attemptId}`;
  const turn = after.attempts;

  if (after.ended && after.ended !== before.ended) {
    const title = endingName(content, after.ended);
    return cue(
      eventId,
      "ending",
      turn,
      `Karl reached the ending ${title}.`,
      ["Karl", title],
    );
  }

  const challenge = challengeCue(attemptId, outcome, turn);
  if (challenge) return challenge;

  const beforeBranches = new Set(before.completedBranchIds ?? []);
  const branchId = (after.completedBranchIds ?? []).find(
    (id) =>
      !beforeBranches.has(id) &&
      content.branches?.some(
        (branch) => branch.id === id && branch.importance === "major",
      ),
  );
  if (branchId) {
    const title = branchName(content, branchId);
    return cue(
      eventId,
      "branch",
      turn,
      `Karl completed the major story branch ${title}.`,
      ["Karl", title],
    );
  }

  if (outcome.kind === "improvised" && !outcome.reused) {
    const parents = outcome.element.parents?.map((id) =>
      elementName(content, id),
    ) ?? [];
    return cue(
      eventId,
      "invention",
      turn,
      `Karl invented ${outcome.element.name} from ${parents.join(" and ")}.`,
      ["Karl", outcome.element.name, ...parents],
    );
  }

  if (outcome.kind === "discovery") {
    return cue(
      eventId,
      "discovery",
      turn,
      `Karl discovered ${outcome.element.name}${
        outcome.solved ? ` and solved ${outcome.solved.name}` : ""
      }.`,
      [
        "Karl",
        outcome.element.name,
        outcome.solved?.name ?? "",
      ],
    );
  }

  return undefined;
}

export function trimRuntimeCommentaryMemory(
  records: readonly RuntimeCommentaryRecord[],
): RuntimeCommentaryRecord[] {
  return records
    .slice(-MAX_COMMENTARY_RECORDS)
    .map((record) => structuredClone(record));
}

export function normalizeRuntimeCommentaryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function runtimeCommentaryTextHash(text: string): string {
  const normalized = normalizeRuntimeCommentaryText(text);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function runtimeCommentaryModelRequest(options: {
  state: GameState;
  cue: RuntimeCommentaryCue;
  records: readonly RuntimeCommentaryRecord[];
}): RuntimeCommentaryModelRequest {
  const { state, cue, records } = options;
  return {
    schemaVersion: 1,
    seedCode: state.lifePlan?.seedCode ?? `LEGACY.${state.seed ?? 1}`,
    commentaryIndex: records.length,
    cue: structuredClone(cue),
    run: {
      act: state.act,
      attempts: state.attempts,
      discoveredCount: state.discovered.length,
      solvedNeedIds: [...state.solvedProblems].sort(),
      completedBranchIds: [...(state.completedBranchIds ?? [])].sort(),
      endingId: state.ended ?? null,
    },
    recentLines: records.slice(-8).map((record) => record.text),
  };
}
