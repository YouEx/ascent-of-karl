import { describe, expect, it } from "vitest";
import styles from "../src/ui/style.css?raw";
import { Engine } from "../src/core/engine";
import { freshChallengeState } from "../src/core/challenge";
import {
  IMPROVISE_RUN_CAP,
  improvisedElementId,
} from "../src/core/improvise";
import { deserialize, serialize } from "../src/core/save";
import { judgePair } from "../src/core/verdict";
import { loadContent } from "../src/content";
import type { ElementDef, ProblemDef } from "../src/core/types";
import { performPlayerAttempt } from "../src/ui/improvise-flow";
import * as improviseFlowModule from "../src/ui/improvise-flow";
import {
  elementOriginClass,
  partitionChronicleEntries,
  renderCopyStatus,
  renderInventionCard,
  renderInventionEntry,
  renderInventionsSection,
} from "../src/ui/improvise-view";
import * as improviseViewModule from "../src/ui/improvise-view";
import { glyphHTML } from "../src/ui/art";
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

  it("stopper copy-prefetch ved det serialiserede run-loft", () => {
    const shouldPrefetch = (
      improviseFlowModule as typeof improviseFlowModule & {
        shouldPrefetchImprovisedCopy?: (
          engine: Engine,
          a: string,
          b: string,
        ) => boolean;
      }
    ).shouldPrefetchImprovisedCopy;
    expect(typeof shouldPrefetch).toBe("function");
    if (!shouldPrefetch) return;

    const engine = new Engine(loadContent());
    const state = engine.getState();
    engine.loadState({
      ...state,
      discovered: engine.content.elements
        .filter((entry) => entry.act === 1)
        .map((entry) => entry.id),
      challenges: {
        ...state.challenges,
        seen: engine.content.challenges.map((entry) => entry.id),
      },
    });

    for (let made = 0; made < IMPROVISE_RUN_CAP; made++) {
      const known = new Set(
        engine.getState().improvisedElements.map((entry) => entry.id),
      );
      const available = engine.availableElements();
      let pair: [string, string] | undefined;
      for (let left = 0; left < available.length && !pair; left++) {
        for (let right = left + 1; right < available.length; right++) {
          const a = available[left]!;
          const b = available[right]!;
          if (engine.matchCombo(a.id, b.id)) continue;
          if (known.has(improvisedElementId(a.id, b.id))) continue;
          if (Math.max(a.depth ?? 0, b.depth ?? 0) + 1 > 3) continue;
          const verdict = judgePair(engine, a, b).verdict;
          if (verdict === "plausible" || verdict === "absurd") {
            pair = [a.id, b.id];
            break;
          }
        }
      }
      expect(pair).toBeDefined();
      if (!pair) return;
      expect(engine.attempt(pair[0], pair[1]).kind).toBe("improvised");
    }

    const available = engine.availableElements();
    let blocked: [string, string] | undefined;
    for (let left = 0; left < available.length && !blocked; left++) {
      for (let right = left + 1; right < available.length; right++) {
        const a = available[left]!;
        const b = available[right]!;
        if (engine.matchCombo(a.id, b.id)) continue;
        if (
          engine
            .getState()
            .improvisedElements.some(
              (entry) => entry.id === improvisedElementId(a.id, b.id),
            )
        ) {
          continue;
        }
        const verdict = judgePair(engine, a, b).verdict;
        if (verdict === "plausible" || verdict === "absurd") {
          blocked = [a.id, b.id];
          break;
        }
      }
    }
    expect(blocked).toBeDefined();
    if (!blocked) return;
    expect(shouldPrefetch(engine, blocked[0], blocked[1])).toBe(false);
  });

  it("viser run-loftet sandt og fra udfaldets målte tal", () => {
    const rejectionStatus = (
      improviseFlowModule as typeof improviseFlowModule & {
        improvisationRejectionStatus?: (
          outcome: Extract<
            ReturnType<Engine["attempt"]>,
            { kind: "improvise-rejected" }
          >,
        ) => string;
      }
    ).improvisationRejectionStatus;
    expect(typeof rejectionStatus).toBe("function");
    if (!rejectionStatus) return;

    const engine = new Engine(loadContent());
    expect(
      rejectionStatus({
        kind: "improvise-rejected",
        a: engine.element("sten"),
        b: engine.element("graes"),
        reason: "run-limit",
        limit: 7,
      }),
    ).toContain("7");
  });

  it("gemmer feature-on-afvisningens sommer og challenge-tick gennem reload", () => {
    const shouldPersist = (
      improviseFlowModule as typeof improviseFlowModule & {
        shouldPersistAttemptState?: (
          enabled: boolean,
          outcome: ReturnType<Engine["attempt"]>,
        ) => boolean;
      }
    ).shouldPersistAttemptState;
    expect(typeof shouldPersist).toBe("function");
    if (!shouldPersist) return;

    const content = loadContent();
    const engine = new Engine(content);
    const state = engine.getState();
    engine.loadState({
      ...state,
      challenges: {
        ...freshChallengeState(),
        active: { id: "ulve", startedAtPage: 0, turnsLeft: 3 },
        seen: ["ulve"],
        everSpawned: true,
      },
    });
    const outcome = engine.attempt("sten", "graes");

    expect(outcome).toMatchObject({
      kind: "improvise-rejected",
      reason: "verdict",
      verdict: "near-miss",
      challenge: { kind: "ticking", turnsLeft: 2 },
    });
    expect(shouldPersist(true, outcome)).toBe(true);

    const restored = new Engine(
      content,
      deserialize(serialize(engine.getState(), "2026-08-13T20:30:00Z")),
    );
    expect(restored.getState().attempts).toBe(1);
    expect(restored.getState().challenges.active?.turnsLeft).toBe(2);
  });

  it("gemmer alle rejection-grunde feature-on, men ændrer intet feature-off", () => {
    const shouldPersist = (
      improviseFlowModule as typeof improviseFlowModule & {
        shouldPersistAttemptState?: (
          enabled: boolean,
          outcome: ReturnType<Engine["attempt"]>,
        ) => boolean;
      }
    ).shouldPersistAttemptState;
    expect(typeof shouldPersist).toBe("function");
    if (!shouldPersist) return;
    const engine = new Engine(loadContent());
    const base = {
      kind: "improvise-rejected" as const,
      a: engine.element("sten"),
      b: engine.element("graes"),
    };

    for (const outcome of [
      { ...base, reason: "verdict" as const, verdict: "near-miss" as const },
      { ...base, reason: "depth-limit" as const, attemptedDepth: 4 },
      { ...base, reason: "run-limit" as const, limit: 5 },
    ]) {
      expect(shouldPersist(true, outcome)).toBe(true);
      expect(shouldPersist(false, outcome)).toBe(false);
    }
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
    expect(elementOriginClass(made, false)).toBe("");
    expect(elementOriginClass(made, true)).toBe("is-improvised");
    expect(elementOriginClass({ ...made, origin: "canon" }, true)).toBe("");
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

  it("escaper skadelig invention-copy i grid, card, Chronicle og share-markup", () => {
    const malicious = invention(
      "improv:malicious",
      '<img src=x onerror="alert(1)">',
    );
    malicious.emoji = "<svg onload=alert(1)>";
    malicious.flavor = "<script>alert(1)</script>";
    const tile = (
      improviseViewModule as typeof improviseViewModule & {
        renderElementTileContent?: (element: ElementDef) => string;
      }
    ).renderElementTileContent;
    const share = (
      improviseViewModule as typeof improviseViewModule & {
        renderInventionSummaryHTML?: (summary: {
          total: number;
          names: string[];
        }) => string;
      }
    ).renderInventionSummaryHTML;
    expect(typeof tile).toBe("function");
    expect(typeof share).toBe("function");
    if (!tile || !share) return;

    const outputs = [
      tile(malicious),
      renderInventionCard(
        malicious,
        glyphHTML(malicious.id, malicious.emoji, "card-glyph"),
      ),
      renderInventionEntry(malicious),
      renderInventionsSection([malicious], malicious.id, true, 1),
      share({ total: 1, names: [malicious.name] }),
    ];
    for (const html of outputs) {
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;");
    }
  });
});

describe("invention motion", () => {
  it("bruger decelererende ease-out uden spring, bounce eller uendelig alternate", () => {
    const inventionReveal = styles.match(
      /\.invention-card \.card-emoji\s*\{([^}]+)\}/,
    )?.[1];
    const loadingInk = styles.match(
      /\.improvise-status\.is-loading::before\s*\{([^}]+)\}/,
    )?.[1];

    expect(inventionReveal).toContain("var(--ease-out)");
    expect(inventionReveal).not.toContain("ease-spring");
    expect(loadingInk).toContain("var(--ease-out)");
    expect(loadingInk).not.toMatch(/\binfinite\b|\balternate\b/);
  });

  describe("feature-root gating", () => {
    it("renderer ingen invention-class/tag/summary feature-off", () => {
      const tile = (
        improviseViewModule as typeof improviseViewModule & {
          renderElementTileContent?: (
            element: ElementDef,
            enabled: boolean,
          ) => string;
        }
      ).renderElementTileContent;
      const share = (
        improviseViewModule as typeof improviseViewModule & {
          renderInventionSummaryHTML?: (
            summary: { total: number; names: string[] },
            enabled: boolean,
          ) => string;
        }
      ).renderInventionSummaryHTML;
      expect(typeof tile).toBe("function");
      expect(typeof share).toBe("function");
      if (!tile || !share) return;

      const made = invention("improv:gated", "Gated thing");
      expect(tile(made, false)).not.toContain("is-improvised");
      expect(tile(made, false)).not.toContain("Karl");
      expect(share({ total: 1, names: [made.name] }, false)).toBe("");
    });

    it("prefixer de responsive feature-overrides med root-attributten", () => {
      for (const selector of [
        "header",
        // #narrator blev til den samlede bog (Living Chronicle); overriden
        // følger komponenten, ikke det gamle id.
        "#story-book",
        "#tools",
        "#dock",
        "#book-panel",
      ]) {
        expect(styles).toContain(
          `html[data-improvise-enabled] ${selector}`,
        );
      }
    });
  });

  it("slår fortsat invention-bevægelse fra ved reduced motion", () => {
    expect(styles).toMatch(
      /prefers-reduced-motion:[\s\S]*\.invention-card \.card-emoji[\s\S]*animation:\s*none/,
    );
    expect(styles).toMatch(
      /prefers-reduced-motion:[\s\S]*\.improvise-status\.is-loading::before[\s\S]*animation:\s*none/,
    );
  });
});
