import type { ArchivedLife } from "./life";
import type { ContentBundle } from "./types";
import type { AnyProductEvent } from "../product/events";

export interface ChronicleEntry {
  sequence: number;
  turn: number;
  kind: "life" | "discovery" | "invention" | "attempt" | "narrator" | "fate";
  text: string;
  relatedId: string | null;
}

function eventName(
  id: string | null,
  names: ReadonlyMap<string, string>,
): string {
  return id ? names.get(id) ?? id : "nothing new";
}

function pairText(
  pair: readonly [string, string],
  names: ReadonlyMap<string, string>,
): string {
  return `${eventName(pair[0], names)} + ${eventName(pair[1], names)}`;
}

function chronicleText(
  event: Extract<AnyProductEvent, { type: "chronicle.entry-recorded" }>,
  attempt:
    | Extract<AnyProductEvent, { type: "combination.attempted" }>
    | undefined,
  names: ReadonlyMap<string, string>,
): { kind: ChronicleEntry["kind"]; text: string } {
  const pairing = attempt
    ? pairText(attempt.payload.pair, names)
    : "An unrecoverable legacy attempt";
  const result = eventName(event.payload.relatedId, names);
  switch (event.payload.kind) {
    case "canonical-discovery":
      return { kind: "discovery", text: `${pairing} discovered ${result}.` };
    case "invention":
      return { kind: "invention", text: `${pairing} invented ${result}.` };
    case "known-result":
      return { kind: "attempt", text: `${pairing} returned ${result}.` };
    case "blocked-progress":
      return { kind: "attempt", text: `${pairing} left progress blocked.` };
    case "fate":
      return { kind: "fate", text: `Karl reached ${result}.` };
    case "attempt":
      return {
        kind: "attempt",
        text: `${pairing} produced no new thing${
          attempt?.payload.verdict ? ` (${attempt.payload.verdict})` : ""
        }.`,
      };
  }
}

export function chronicleEntriesForArchive(
  content: ContentBundle,
  archive: ArchivedLife,
): ChronicleEntry[] {
  const names = new Map(
    content.elements.map((element) => [element.id, element.name]),
  );
  for (const invention of archive.finalState.improvisedElements ?? []) {
    names.set(invention.id, invention.name);
  }
  const attempts = new Map<
    number,
    Extract<AnyProductEvent, { type: "combination.attempted" }>
  >();
  const entries: ChronicleEntry[] = [];
  for (const event of [...archive.events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (event.type === "combination.attempted") {
      attempts.set(event.turn, event);
      continue;
    }
    if (event.type === "life.started") {
      entries.push({
        sequence: event.sequence,
        turn: event.turn,
        kind: "life",
        text: `Karl began life ${archive.plan.seedCode}.`,
        relatedId: null,
      });
      continue;
    }
    if (event.type === "chronicle.entry-recorded") {
      const rendered = chronicleText(
        event,
        attempts.get(event.turn),
        names,
      );
      entries.push({
        sequence: event.sequence,
        turn: event.turn,
        ...rendered,
        relatedId: event.payload.relatedId,
      });
      continue;
    }
    if (event.type === "narrator.presented") {
      entries.push({
        sequence: event.sequence,
        turn: event.turn,
        kind: "narrator",
        text: `Narrator: ${event.payload.text}`,
        relatedId: event.payload.lineId,
      });
      continue;
    }
    if (event.type === "fate.unlocked") {
      entries.push({
        sequence: event.sequence,
        turn: event.turn,
        kind: "fate",
        text: `Fate unlocked: ${eventName(event.payload.endingId, names)}.`,
        relatedId: event.payload.endingId,
      });
    }
  }
  return entries;
}
