import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { judgePair } from "../src/core/verdict";
import { loadContent } from "../src/content";
import type { ElementDef, ProblemDef } from "../src/core/types";
import { performPlayerAttempt } from "../src/ui/improvise-flow";
import {
  elementOriginClass,
  partitionChronicleEntries,
  renderCopyStatus,
  renderInventionCard,
  renderInventionEntry,
  renderInventionsSection,
} from "../src/ui/improvise-view";
import {
  MAX_SHARED_INVENTIONS,
  inventionSummaryText,
  summarizeInventions,
} from "../src/ui/run-summary";

function invention(id: string, name = id): ElementDef {
  return {
    id,
    origin: "improvised",
    parents: ["sten", "pind"],
    name,
    emoji: "",
    act: 1,
    depth: 1,
    kind: "tool",
    stuff: "stone",
    traits: ["hard"],
    scale: "hand",
    flavor: `${name} exists because Karl refused to stop.`,
  };
}

describe("feature-off parity", () => {
  it("kalder den eksisterende combine-adfærd uændret, når flaget er false", () => {
    const direct = new Engine(loadContent());
    const throughFeatureGate = new Engine(loadContent());

    const expected = direct.combine("sten", "sten");
    const actual = performPlayerAttempt(
      throughFeatureGate,
      "sten",
      "sten",
      false,
      {
        name: "Must be ignored",
        flavor: "Feature-off must never read this copy.",
      },
    );

    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(throughFeatureGate.getState())).toBe(
      JSON.stringify(direct.getState()),
    );
  });

  it("bruger den atomiske attempt-seam, når flaget er true", () => {
    const engine = new Engine(loadContent());
    const available = engine.availableElements();
    let pair: [string, string] | undefined;
    for (let i = 0; i < available.length && !pair; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const a = available[i]!;
        const b = available[j]!;
        if (engine.matchCombo(a.id, b.id)) continue;
        const verdict = judgePair(engine, a, b).verdict;
        if (verdict === "plausible" || verdict === "absurd") {
          pair = [a.id, b.id];
          break;
        }
      }
    }
    expect(pair).toBeDefined();
    if (!pair) return;

    const outcome = performPlayerAttempt(engine, pair[0], pair[1], true);

    expect(outcome.kind).toBe("improvised");
    expect(engine.getState().attempts).toBe(1);
  });
});

describe("improvisationens semantiske UI", () => {
  const made = invention("improv:made", "Clay spear");
  const solved: ProblemDef = {
    id: "vaerktoej",
    name: "Bare hands",
    description: "Karl needs a tool",
    required: true,
  };

  it("skiller canonical poster og Karls opfindelser før rendering", () => {
    const canonical = { ...made, id: "spyd", origin: "canon" as const };
    const otherAct = { ...made, id: "improv:later", act: 2 };

    expect(
      partitionChronicleEntries([canonical, made, otherAct], 1),
    ).toEqual({
      canonical: [canonical],
      inventions: [made],
    });
  });

  it("giver improviserede elementer en særskilt klasse", () => {
    expect(elementOriginClass(made)).toBe("is-improvised");
    expect(elementOriginClass({ ...made, origin: "canon" })).toBe("");
  });

  it("renderer en separat, navngivet invention-sektion med tastaturknapper", () => {
    const html = renderInventionsSection([made], made.id, true, 1);

    expect(html).toContain('class="book-inventions"');
    expect(html).toContain('id="book-inventions-title"');
    expect(html).toContain("Karl's inventions");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Karl's invention");
    expect(html).not.toContain("Timeline");
  });

  it("lærer funktionen i den tomme invention-sektion og skjuler den helt feature-off", () => {
    const empty = renderInventionsSection([], null, true, 1);
    expect(empty).toContain("Combine two things with no recipe");
    expect(empty).toContain("historical timeline");
    expect(renderInventionsSection([], null, false, 1)).toBe("");
  });

  it("viser opfindelsen uden note, kilde eller historisk påstand", () => {
    const entry = renderInventionEntry({
      ...made,
      note: "This forged note must never render.",
      sourceUrl: "https://example.invalid/forged",
    });
    const card = renderInventionCard(
      {
        ...made,
        note: "This forged note must never render.",
        sourceUrl: "https://example.invalid/forged",
      },
      '<span class="card-glyph"></span>',
      solved,
    );

    for (const html of [entry, card]) {
      expect(html).toContain("Karl's invention");
      expect(html).toContain("Clay spear");
      expect(html).not.toContain("forged note");
      expect(html).not.toContain("example.invalid");
      expect(html.toLowerCase()).not.toContain("historical discovery");
    }
    expect(card).toContain("invention-card");
    expect(card).toContain("Problem solved: Bare hands");
  });

  it("annoncerer loading og fallback som ikke-blokerende statusser", () => {
    const loading = renderCopyStatus({ status: "loading" });
    const fallback = renderCopyStatus({
      status: "fallback",
      reason: "timeout",
      latencyMs: 2500,
      timeout: true,
    });

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain("Combine works now");
    expect(loading).toContain("is-loading");
    expect(fallback).toContain("Karl used his own wording");
    expect(fallback).toContain("is-fallback");
  });
});

describe("bounded run/share summary", () => {
  it("viser højst fem navne og oplyser hvor mange der er udeladt", () => {
    const inventions = Array.from({ length: 8 }, (_, index) =>
      invention(`improv:${index}`, `Invention ${index + 1}`),
    );

    const summary = summarizeInventions(inventions);

    expect(summary.total).toBe(8);
    expect(summary.names).toHaveLength(MAX_SHARED_INVENTIONS);
    expect(summary.names).toEqual([
      "Invention 1",
      "Invention 2",
      "Invention 3",
      "Invention 4",
      "Invention 5",
    ]);
    expect(inventionSummaryText(summary)).toContain("+3 more");
    expect(inventionSummaryText(summary).length).toBeLessThan(160);
  });
});
