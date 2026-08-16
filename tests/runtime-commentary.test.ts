import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import {
  attemptCommentaryCue,
  openingCommentaryCue,
  trimRuntimeCommentaryMemory,
  type RuntimeCommentaryRecord,
} from "../src/product/runtime-commentary";

const content = loadContent();

describe("authoritative runtime commentary cues", () => {
  it("creates a stable opening cue from the stored life plan", () => {
    const state = new Engine(content).getState();
    const cue = openingCommentaryCue(content, state);

    expect(cue).toMatchObject({
      schemaVersion: 1,
      eventId: "opening",
      kind: "opening",
      turn: 0,
    });
    expect(cue.requiredTerms).toContain("Karl");
    expect(cue.context).toContain(state.lifePlan!.openingId);
    expect(cue.context).toContain(
      content.elements.find(
        (element) => element.id === state.discovered[0],
      )!.name,
    );
  });

  it("prioritizes ending over challenge, branch, invention, and discovery", () => {
    const engine = new Engine(content);
    const before = engine.getState();
    const after = {
      ...before,
      attempts: 12,
      ended: "et-helt-liv",
      completedBranchIds: ["overleveren"],
    };
    const cue = attemptCommentaryCue({
      attemptId: "attempt-ending",
      content,
      before,
      after,
      outcome: {
        kind: "discovery",
        combo: {
          pair: ["sten", "sten"],
          result: "gnister",
        },
        element: content.elements.find(
          (element) => element.id === "gnister",
        )!,
        ageUp: false,
        act: content.acts[0]!,
        challenge: {
          kind: "solved",
          def: content.challenges[0]!,
          by: content.elements.find(
            (element) => element.id === "ild",
          )!,
        },
      },
    });

    expect(cue).toMatchObject({
      eventId: "attempt:attempt-ending",
      kind: "ending",
      turn: 12,
    });
    expect(cue?.context).toContain(
      content.endings.find((ending) => ending.id === "et-helt-liv")!
        .title,
    );
  });

  it("emits one cue for newly completed major branches before ordinary discoveries", () => {
    const engine = new Engine(content);
    const before = engine.getState();
    const after = {
      ...before,
      attempts: 4,
      completedBranchIds: ["overleveren"],
    };
    const cue = attemptCommentaryCue({
      attemptId: "attempt-branch",
      content,
      before,
      after,
      outcome: {
        kind: "discovery",
        combo: {
          pair: ["sten", "sten"],
          result: "gnister",
        },
        element: content.elements.find(
          (element) => element.id === "gnister",
        )!,
        ageUp: false,
        act: content.acts[0]!,
      },
    });

    expect(cue?.kind).toBe("branch");
    expect(cue?.context).toContain(
      content.branches!.find((branch) => branch.id === "overleveren")!
        .title,
    );
  });

  it("does not add runtime chatter for ordinary no-fuse or known attempts", () => {
    const engine = new Engine(content);
    const state = engine.getState();
    expect(
      attemptCommentaryCue({
        attemptId: "attempt-none",
        content,
        before: state,
        after: { ...state, attempts: 1 },
        outcome: {
          kind: "nofuse",
          a: content.elements.find((element) => element.id === "baer")!,
          b: content.elements.find((element) => element.id === "ler")!,
          verdict: "inert",
          evidence: {},
        },
      }),
    ).toBeUndefined();
  });
});

describe("runtime commentary memory", () => {
  it("retains every possible event in a 50-turn life plus its opening", () => {
    const records = Array.from(
      { length: 60 },
      (_, index): RuntimeCommentaryRecord => ({
        schemaVersion: 1,
        eventId: `event-${index}`,
        cue: {
          schemaVersion: 1,
          eventId: `event-${index}`,
          kind: "discovery",
          turn: index,
          context: `Discovery ${index}`,
          requiredTerms: ["Karl"],
        },
        text: `Karl records discovery ${index}.`,
        roles: ["story"],
        normalizedHash: `hash-${index}`,
      }),
    );

    expect(trimRuntimeCommentaryMemory(records).map((entry) => entry.eventId))
      .toEqual(
        Array.from({ length: 51 }, (_, index) => `event-${index + 9}`),
      );
  });
});
