import {
  RUNTIME_COMMENTARY_KINDS,
  type RuntimeCommentaryKind,
  type RuntimeCommentaryModelRequest,
} from "../../src/product/runtime-commentary";

export type RuntimeCommentaryValidation =
  | { ok: true; body: RuntimeCommentaryModelRequest }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(value)
  );
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((entry) => boundedString(entry, 1, maximumLength))
  );
}

function isRuntimeCommentaryKind(
  value: unknown,
): value is RuntimeCommentaryKind {
  return RUNTIME_COMMENTARY_KINDS.includes(
    value as RuntimeCommentaryKind,
  );
}

export function validateRuntimeCommentaryBody(
  raw: unknown,
): RuntimeCommentaryValidation {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      "schemaVersion",
      "seedCode",
      "commentaryIndex",
      "cue",
      "run",
      "recentLines",
    ]) ||
    raw.schemaVersion !== 1 ||
    !boundedString(raw.seedCode, 1, 64) ||
    !Number.isInteger(raw.commentaryIndex) ||
    (raw.commentaryIndex as number) < 0 ||
    (raw.commentaryIndex as number) > 24
  ) {
    return { ok: false, reason: "invalid schema" };
  }
  if (!isRecord(raw.cue)) {
    return { ok: false, reason: "invalid cue" };
  }
  const cue = raw.cue;
  if (
    !exactKeys(cue, [
      "schemaVersion",
      "eventId",
      "kind",
      "turn",
      "context",
      "requiredTerms",
    ]) ||
    cue.schemaVersion !== 1 ||
    !boundedString(cue.eventId, 1, 96) ||
    !isRuntimeCommentaryKind(cue.kind) ||
    !Number.isInteger(cue.turn) ||
    (cue.turn as number) < 0
  ) {
    return { ok: false, reason: "invalid cue" };
  }
  if (!boundedString(cue.context, 1, 600)) {
    return { ok: false, reason: "invalid cue context" };
  }
  if (
    !stringList(cue.requiredTerms, 6, 80) ||
    cue.requiredTerms.length === 0
  ) {
    return { ok: false, reason: "invalid requiredTerms" };
  }
  if (
    !isRecord(raw.run) ||
    !exactKeys(raw.run, [
      "act",
      "attempts",
      "discoveredCount",
      "solvedNeedIds",
      "completedBranchIds",
      "endingId",
    ]) ||
    !Number.isInteger(raw.run.act) ||
    (raw.run.act as number) < 1 ||
    (raw.run.act as number) > 10 ||
    !Number.isInteger(raw.run.attempts) ||
    (raw.run.attempts as number) < 0 ||
    !Number.isInteger(raw.run.discoveredCount) ||
    (raw.run.discoveredCount as number) < 0 ||
    !stringList(raw.run.solvedNeedIds, 32, 96) ||
    !stringList(raw.run.completedBranchIds, 32, 96) ||
    !(
      raw.run.endingId === null ||
      boundedString(raw.run.endingId, 1, 96)
    )
  ) {
    return { ok: false, reason: "invalid run state" };
  }
  if (!stringList(raw.recentLines, 8, 260)) {
    return { ok: false, reason: "invalid recentLines" };
  }
  return {
    ok: true,
    body: {
      schemaVersion: 1,
      seedCode: raw.seedCode,
      commentaryIndex: Number(raw.commentaryIndex),
      cue: {
        schemaVersion: 1,
        eventId: cue.eventId,
        kind: cue.kind,
        turn: Number(cue.turn),
        context: cue.context,
        requiredTerms: [...cue.requiredTerms],
      },
      run: {
        act: Number(raw.run.act),
        attempts: Number(raw.run.attempts),
        discoveredCount: Number(raw.run.discoveredCount),
        solvedNeedIds: [...raw.run.solvedNeedIds],
        completedBranchIds: [...raw.run.completedBranchIds],
        endingId: raw.run.endingId,
      },
      recentLines: [...raw.recentLines],
    },
  };
}
