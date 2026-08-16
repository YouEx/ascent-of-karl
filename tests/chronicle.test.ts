import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { chronicleEntriesForArchive } from "../src/core/chronicle";
import {
  archiveLife,
  createActiveLife,
} from "../src/core/life";
import { ProductEventBus } from "../src/product/events";

const content = loadContent();

describe("causal archived Chronicle", () => {
  it("renders ordered player action, result and narrator evidence from life events", () => {
    const bus = new ProductEventBus();
    bus.startLifeJournal();
    bus.emit({
      type: "life.started",
      scenario: "life.fresh-start",
      turn: 0,
      payload: { mode: "new", seed: 42, saveVersion: 2, act: 1 },
    });
    bus.emit({
      type: "combination.attempted",
      scenario: "attempt.canonical-discovery",
      turn: 1,
      payload: {
        pair: ["sten", "sten"],
        outcome: "discovery",
        resultId: "gnister",
        verdict: null,
        rejectionReason: null,
      },
    });
    bus.emit({
      type: "chronicle.entry-recorded",
      scenario: "attempt.canonical-discovery",
      turn: 1,
      payload: {
        entryId: "42:1:discovery",
        kind: "canonical-discovery",
        relatedId: "gnister",
        canonical: true,
      },
    });
    bus.emit({
      type: "narrator.presented",
      scenario: "need.active",
      turn: 1,
      payload: {
        lineId: "test",
        variant: 0,
        text: "Karl has discovered fire's administrative assistant.",
        roles: ["humour", "story"],
        audioMode: "text-only",
      },
    });
    const active = createActiveLife({
      content,
      lifeId: "life-chronicle",
      startedAt: "2026-08-16T08:00:00Z",
      seed: 42,
    });
    active.events = bus.lifeJournal();
    const archive = archiveLife(
      active,
      { kind: "abandoned" },
      "2026-08-16T09:00:00Z",
    );

    const entries = chronicleEntriesForArchive(content, archive);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "life",
      "discovery",
      "narrator",
    ]);
    expect(entries[1]?.text).toContain(
      `${content.elements.find((element) => element.id === "sten")!.name} +`,
    );
    expect(entries[1]?.text).toContain(
      content.elements.find((element) => element.id === "gnister")!.name,
    );
    expect(entries[2]?.text).toContain("administrative assistant");
  });
});
