import type { CombineOutcome, ElementDef } from "../core/types";

export type StoryPageKind =
  | "opening"
  | "discovery"
  | "invention"
  | "known"
  | "blocked"
  | "attempt";

export interface StoryPagePayload {
  kind: StoryPageKind;
  pairLabel: string;
  kicker: string;
  title: string;
  body?: string;
  note?: string;
  solved?: string;
  elementId?: string;
  emoji?: string;
}

export function openingStoryPage(): StoryPagePayload {
  return {
    kind: "opening",
    pairLabel: "The first page",
    kicker: "Karl's story",
    title: "The page is waiting",
    body: "Combine two elements to write what happens next.",
  };
}

export function storyPageForOutcome(
  a: ElementDef,
  b: ElementDef,
  outcome: CombineOutcome,
): StoryPagePayload {
  const pairLabel = `${a.name} + ${b.name}`;

  switch (outcome.kind) {
    case "discovery":
      return {
        kind: "discovery",
        pairLabel,
        kicker: "Discovery",
        title: outcome.element.name,
        body: outcome.element.flavor,
        note: outcome.element.note,
        solved: outcome.solved?.name,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "known":
      return {
        kind: "known",
        pairLabel,
        kicker: "Already written",
        title: outcome.element.name,
        body: outcome.element.flavor,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "gated":
      return {
        kind: "blocked",
        pairLabel,
        kicker: "Not yet",
        title: "The next page is blocked",
        body: outcome.unsolved.map((problem) => problem.name).join(", "),
      };
    case "nofuse":
      return {
        kind: "attempt",
        pairLabel,
        kicker: "Attempt",
        title: "No new discovery",
      };
    case "improvised":
      return {
        kind: "invention",
        pairLabel,
        kicker: outcome.reused ? "Karl remembers" : "Karl invents",
        title: outcome.element.name,
        body: outcome.element.flavor,
        solved: outcome.solved?.name,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "improvise-rejected":
      return {
        kind: "attempt",
        pairLabel,
        kicker: "Karl's idea",
        title: "It does not hold together",
      };
  }
}
