// Rapporten: en selvstændig HTML-fil under .judge/<run>/, uden CDN eller
// netværksafhængigheder. `renderReport` er ren streng-bygning (ingen disk-
// adgang), så den kan enhedstestes med håndlavede journal-fixtures. Det
// eneste, disse tests IKKE kan teste rent (billedstier, --open) er dækket
// af den rigtige fixture-drevne verifikationskørsel, ikke her.
// Se plan/architecture-visual-judge-1.md TASK-028.
import { describe, expect, it } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration.
import { escapeHtml, renderReport } from "../tools/judge/report.mjs";

const REGISTRY = {
  screens: [{ id: "title", regions: [{ id: "chip", rect: [0, 0, 1, 1], weight: 1, threshold: 0.9, note: "vigtig chip" }] }],
  allowedDeviations: [],
};

function scoresFor(overall: number, chipOverall: number, threshold = 0.9) {
  return {
    overall,
    screens: {
      title: {
        screen: "title", overall,
        regions: {
          chip: {
            structure: chipOverall, tone: chipOverall, ink: chipOverall,
            geometry: chipOverall, materiality: chipOverall, overall: chipOverall,
            threshold, weight: 1, missing: false, raw: { deltaE: 9.1 },
          },
        },
      },
    },
  };
}

describe("escapeHtml", () => {
  it("escaper &, <, >, dobbelt- og enkeltcitat", () => {
    expect(escapeHtml(`<script>alert("x" + 'y' & 1)</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot; + &#39;y&#39; &amp; 1)&lt;/script&gt;",
    );
  });
  it("giver tom streng for null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
  it("konverterer tal til tekst uden at kaste", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("renderReport", () => {
  const baseline = scoresFor(0.7, 0.7);
  const afterAccept = scoresFor(0.95, 0.95);
  const afterReject = scoresFor(0.6, 0.55);

  const ledger = {
    run: ".judge/20260813-000000", screens: ["title"],
    startedAt: "2026-08-13T00:00:00.000Z", finishedAt: "2026-08-13T00:05:00.000Z",
    baselineScores: baseline, bestScores: afterAccept, finalScores: afterAccept,
    bestTuning: ":root {\n  --chronicle: #d8ba9b;\n}\n",
    stopReason: "success", outcome: "success",
    iterations: [
      {
        n: 1, at: "2026-08-13T00:01:00.000Z", verdict: "accepted",
        before: baseline, after: afterAccept,
        findings: [{
          region: "chip", defect: "color", severity: 3,
          evidence: 'tone <0.7> mod tærskel "0.9", ΔE 9.1 & stigende',
          fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" },
        }],
        applied: [{ key: "chip:color:--chronicle", region: "chip", defect: "color", severity: 3, fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" } }],
        queuedAssets: 0, queuedHuman: 0, gain: 0.25, reason: "samlet fremgang uden regression",
      },
    ],
    rejected: [],
  };

  it("gengiver skærme, scoretabel og tærskelstatus", () => {
    const html = renderReport({ run: ".judge/20260813-000000", ledger, registry: REGISTRY, scores: afterAccept });
    expect(html).toContain("title");
    expect(html).toMatch(/0[.,]9[05]0?/); // 0.950 overall et sted
    expect(html).toContain("chip");
  });

  it("escaper ALT modeltekst — findings.evidence må ALDRIG optræde urenset i output", () => {
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept });
    expect(html).not.toContain('tone <0.7> mod tærskel "0.9"');
    expect(html).toContain("&lt;0.7&gt;");
    expect(html).toContain("&quot;0.9&quot;");
  });

  it("gengiver anvendt token, verdikt og begrundelse for en accepteret iteration", () => {
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept });
    expect(html).toContain("--chronicle");
    expect(html).toContain("accepted");
    expect(html).toContain("samlet fremgang uden regression");
  });

  it("gengiver før/efter-delta pr. region for en iteration", () => {
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept });
    // 0.95 - 0.70 = 0.25 delta for chip — vis mindst tegnet og størrelsesordenen.
    expect(html).toMatch(/\+0[.,]2[45]/);
  });

  it("gengiver en afvist iterations forsøgte fund, regression og begrundelse", () => {
    const rejectLedger = {
      ...ledger,
      stopReason: "no-accept-streak", outcome: "defeat", finalScores: baseline,
      iterations: [{
        n: 1, at: "2026-08-13T00:01:00.000Z", verdict: "rejected",
        before: baseline, after: afterReject,
        findings: [{ region: "chip", defect: "color", severity: 3, evidence: "tone 0.55 mod tærskel 0.9", fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#000000" } }],
        attempted: [{ key: "chip:color:--chronicle", region: "chip", defect: "color", severity: 3, fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#000000" } }],
        queuedAssets: 0, queuedHuman: 0, gain: -0.1, regressions: [{ region: "title/chip", drop: 0.15 }],
        reason: "regression i title/chip",
      }],
      rejected: [{ key: "chip:color:--chronicle", region: "chip", defect: "color", fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#000000" }, consolidatedFrom: [], iteration: 1 }],
    };
    const html = renderReport({ run: ".judge/x", ledger: rejectLedger, registry: REGISTRY, scores: baseline });
    expect(html).toContain("rejected");
    expect(html).toContain("regression i title/chip");
    expect(html).toContain("chip:color:--chronicle");
  });

  it("gengiver afvist hukommelse (rejected memory) som en selvstændig sektion", () => {
    const rejectLedger = { ...ledger, rejected: [{ key: "chip:color:--chronicle", region: "chip", defect: "color", fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#000" }, consolidatedFrom: ["tools:color:--chronicle"], iteration: 2 }] };
    const html = renderReport({ run: ".judge/x", ledger: rejectLedger, registry: REGISTRY, scores: afterAccept });
    expect(html).toContain("chip:color:--chronicle");
    expect(html).toContain("tools:color:--chronicle");
  });

  it("gengiver blokerede/køede fund (asset- og human-queue) som blokerende punkter", () => {
    const html = renderReport({
      run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept,
      assetQueue: { items: [{ key: "chip:missing-asset:UI-chip-glow", region: "chip", severity: 4, fix: { kind: "asset", assetId: "UI-chip-glow", spec: "Malet glød-effekt bag chip-ikonet" }, status: "open" }] },
      humanQueue: { items: [{ key: "chip:extra-element:x", region: "chip", severity: 2, fix: { kind: "structure", file: "src/ui/Chip.tsx", change: "Fjern det ekstra ikon-lag" }, status: "open" }] },
    });
    expect(html).toContain("UI-chip-glow");
    expect(html).toContain("Chip.tsx");
  });

  it("gengiver stop-årsag og udfald (success/defeat)", () => {
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept });
    expect(html).toContain("success");
  });

  it("udelader en skærm HELT (ingen <img>-reference) når metrics.py's stub for en ikke-optaget skærm (alle regioner missing, overall 0) optræder i scores — ellers peger rapporten på et billede der ikke findes (--screen title-kørsler runder game med til 0/missing)", () => {
    const scoresWithUncapturedGame = {
      overall: afterAccept.overall,
      screens: {
        ...afterAccept.screens,
        game: {
          screen: "game", overall: 0,
          regions: {
            grid: { structure: 0, tone: 0, ink: 0, geometry: 0, materiality: 0, overall: 0, missing: true, raw: {}, weight: 4, threshold: 0.75 },
          },
        },
      },
    };
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: scoresWithUncapturedGame });
    expect(html).not.toContain('overlay/game.png');
    expect(html).not.toContain('overlay/game-heat.png');
    expect(html).toContain("title"); // den rigtigt optagne skærm vises stadig
  });

  it("markerer en enkelt manglende region (missing:true) som 'mangler', ikke som 'under tærskel' — regionen fejlede ikke visuelt, den blev bare ikke fundet", () => {
    const scoresWithMissingRegion = {
      overall: 0.7,
      screens: {
        title: {
          screen: "title", overall: 0.7,
          regions: {
            chip: { structure: 0.9, tone: 0.9, ink: 0.9, geometry: 0.9, materiality: 0.9, overall: 0.9, threshold: 0.9, weight: 1, missing: false, raw: {} },
            ribbon: { structure: 0, tone: 0, ink: 0, geometry: 0, materiality: 0, overall: 0, threshold: 0.85, weight: 1, missing: true, raw: {} },
          },
        },
      },
    };
    const html = renderReport({ run: ".judge/x", ledger: null, registry: REGISTRY, scores: scoresWithMissingRegion });
    expect(html).toContain("mangler");
    expect(html).toContain("ribbon");
  });

  it("udelader delta-rækker for regioner der er 'missing' i BÅDE før og efter — det er metrics.py's stub for en anden skærm end den kørslen dækkede, ikke en reel før/efter-ændring", () => {
    const stubRegion = { structure: 0, tone: 0, ink: 0, geometry: 0, materiality: 0, overall: 0, missing: true, raw: {}, weight: 4, threshold: 0.75 };
    const beforeWithStub = { ...baseline, screens: { ...baseline.screens, game: { screen: "game", overall: 0, regions: { grid: stubRegion } } } };
    const afterWithStub = { ...afterAccept, screens: { ...afterAccept.screens, game: { screen: "game", overall: 0, regions: { grid: stubRegion } } } };
    const ledgerWithStub = { ...ledger, iterations: [{ ...ledger.iterations[0], before: beforeWithStub, after: afterWithStub }] };
    const html = renderReport({ run: ".judge/x", ledger: ledgerWithStub, registry: REGISTRY, scores: afterWithStub });
    expect(html).not.toContain("game/grid");
  });

  it("håndterer en kørsel UDEN ledger.json roligt — viser scoretabel, ingen krak, tydelig besked", () => {
    expect(() => renderReport({ run: ".judge/x", ledger: null, registry: REGISTRY, scores: afterAccept })).not.toThrow();
    const html = renderReport({ run: ".judge/x", ledger: null, registry: REGISTRY, scores: afterAccept });
    expect(html).toContain("title");
    expect(/ingen journal|ingen kørsel/i.test(html)).toBe(true);
  });

  it("håndterer en helt tom kørsel (hverken ledger eller scores) roligt", () => {
    expect(() => renderReport({ run: ".judge/x", ledger: null, registry: REGISTRY, scores: null })).not.toThrow();
  });

  it("er selvstændig — ingen http(s):// eller CDN-referencer i output", () => {
    const html = renderReport({ run: ".judge/x", ledger, registry: REGISTRY, scores: afterAccept });
    expect(html).not.toMatch(/https?:\/\//);
  });
});
