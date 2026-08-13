import { describe, expect, it } from "vitest";
import realFreq from "../docs/design/pair-frequency.json";
// @ts-expect-error — hjælpefilen er ren ESM uden typedeklaration.
import { LIVE_TRAFFIC_WEIGHT, flattenVerdictCounts, liveExportEntries, mergeLiveTraffic, parseCliArgs, rankUncuredCandidates } from "../tools/prepare_pairs_lib.mjs";

/**
 * TASK-008: de RENE funktioner bag `prepare_pairs.ts`s nye høste-tilstand
 * (`--live=<sti>`). Samme mønster som `pair_lookup.mjs`/`tests/pair-tools.test.ts`
 * — logikken testes her, direkte, uden at køre selve CLI-scriptet.
 */

describe("flattenVerdictCounts", () => {
  it("laver én indgang pr. par+dom, ikke kun den dominerende (som den eksisterende bagning bruger)", () => {
    const freq = {
      pairs: [
        {
          key: "graes+vand",
          a: "graes",
          b: "vand",
          met: 1586,
          verdict: "near-miss",
          verdicts: { "near-miss": 976, clash: 610 },
        },
      ],
    };
    const flat = flattenVerdictCounts(freq);
    expect(flat).toHaveLength(2);
    expect(flat.map((f: { key: string }) => f.key).sort()).toEqual(["graes+vand:clash", "graes+vand:near-miss"]);
    const clash = flat.find((f: { verdict: string }) => f.verdict === "clash");
    expect(clash?.simulatedMet).toBe(610);
    expect(clash?.pair).toBe("graes+vand");
    expect(clash?.a).toBe("graes");
    expect(clash?.b).toBe("vand");
  });

  it("afviser en frekvensfil uden pairs-array", () => {
    expect(() => flattenVerdictCounts({})).toThrow(/pairs-array/);
    expect(() => flattenVerdictCounts(null)).toThrow(/pairs-array/);
  });

  it("virker på den rigtige docs/design/pair-frequency.json uden at fejle", () => {
    const flat = flattenVerdictCounts(realFreq);
    // Mindst så mange indgange som par (nogle har flere domme).
    expect(flat.length).toBeGreaterThanOrEqual(realFreq.pairs.length);
  });
});

describe("liveExportEntries", () => {
  it("accepterer et gyldigt entries-array", () => {
    const doc = { entries: [{ aId: "a", bId: "b", verdict: "inert", count: 3 }] };
    expect(liveExportEntries(doc)).toHaveLength(1);
  });

  it("afviser et dokument uden entries-array", () => {
    expect(() => liveExportEntries({})).toThrow(/entries-array/);
  });

  it("afviser en indgang der mangler et påkrævet felt", () => {
    expect(() => liveExportEntries({ entries: [{ aId: "a" }] })).toThrow(/ugyldig/);
    expect(() => liveExportEntries({ entries: [{ aId: "a", bId: "b", verdict: "inert", count: "3" }] })).toThrow(
      /ugyldig/,
    );
  });
});

describe("mergeLiveTraffic", () => {
  it("tilføjer liveCount til en allerede simuleret par+dom-indgang", () => {
    const flat = flattenVerdictCounts({
      pairs: [{ key: "a+b", a: "a", b: "b", verdict: "inert", verdicts: { inert: 10 } }],
    });
    const merged = mergeLiveTraffic(flat, [{ aId: "a", bId: "b", verdict: "inert", count: 4 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].liveCount).toBe(4);
    expect(merged[0].simulatedMet).toBe(10);
  });

  it("tilføjer en par+dom-indgang der KUN findes i levende trafik (aldrig simuleret)", () => {
    const merged = mergeLiveTraffic([], [{ aId: "x", bId: "y", verdict: "self", count: 2 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ key: "x+y:self", pair: "x+y", simulatedMet: 0, liveCount: 2 });
  });

  it("sorterer par-id'erne kanonisk uanset rækkefølgen i den levende post", () => {
    const flat = flattenVerdictCounts({
      pairs: [{ key: "a+b", a: "a", b: "b", verdict: "inert", verdicts: { inert: 1 } }],
    });
    const merged = mergeLiveTraffic(flat, [{ aId: "b", bId: "a", verdict: "inert", count: 7 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].liveCount).toBe(7);
  });

  it("uden levende trafik forbliver liveCount 0 for alle, og intet duplikeres", () => {
    const flat = flattenVerdictCounts({
      pairs: [{ key: "a+b", a: "a", b: "b", verdict: "inert", verdicts: { inert: 1 } }],
    });
    const merged = mergeLiveTraffic(flat, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].liveCount).toBe(0);
  });
});

describe("rankUncuredCandidates", () => {
  const merged = [
    { key: "a+b:inert", pair: "a+b", a: "a", b: "b", verdict: "inert", simulatedMet: 100, liveCount: 0 },
    { key: "c+d:clash", pair: "c+d", a: "c", b: "d", verdict: "clash", simulatedMet: 5, liveCount: 20 },
    { key: "e+f:self", pair: "e+f", a: "e", b: "f", verdict: "self", simulatedMet: 50, liveCount: 0 },
  ];

  it("udelukker allerede bagte (cured) par+dom-nøgler", () => {
    const ranked = rankUncuredCandidates(merged, new Set(["a+b:inert"]));
    expect(ranked.map((r: { key: string }) => r.key)).not.toContain("a+b:inert");
    expect(ranked).toHaveLength(2);
  });

  it("regner combinedScore = simuleret + levende*vægt, og bruger den til at ranke", () => {
    const ranked = rankUncuredCandidates(merged, new Set());
    // c+d: 5 + 20*10 = 205 (højest), a+b: 100, e+f: 50
    expect(ranked.map((r: { key: string }) => r.key)).toEqual(["c+d:clash", "a+b:inert", "e+f:self"]);
    expect(ranked[0].combinedScore).toBe(5 + 20 * LIVE_TRAFFIC_WEIGHT);
  });

  it("nummererer rank 1-baseret efter sortering", () => {
    const ranked = rankUncuredCandidates(merged, new Set());
    expect(ranked.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
  });

  it("respekterer limit", () => {
    const ranked = rankUncuredCandidates(merged, new Set(), { limit: 1 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].key).toBe("c+d:clash");
  });

  it("er deterministisk ved lige combinedScore — nøgle stigende afgør uafgjorte", () => {
    const tied = [
      { key: "z+z:inert", pair: "z+z", a: "z", b: "z", verdict: "inert", simulatedMet: 10, liveCount: 0 },
      { key: "a+a:inert", pair: "a+a", a: "a", b: "a", verdict: "inert", simulatedMet: 10, liveCount: 0 },
    ];
    const ranked = rankUncuredCandidates(tied, new Set());
    expect(ranked.map((r: { key: string }) => r.key)).toEqual(["a+a:inert", "z+z:inert"]);
  });

  it("uden en angivet limit returneres alle ikke-bagte kandidater", () => {
    const ranked = rankUncuredCandidates(merged, new Set());
    expect(ranked).toHaveLength(merged.length);
  });
});

describe("parseCliArgs", () => {
  it("uden flag er tilstanden legacy (live: null), write er slået fra", () => {
    const args = parseCliArgs([]);
    expect(args).toMatchObject({ live: null, write: false, limit: null, out: null });
  });

  it("læser --live=<sti>", () => {
    const args = parseCliArgs(["--live=docs/design/live-pair-stats.json"]);
    expect(args.live).toBe("docs/design/live-pair-stats.json");
  });

  it("læser --write som et rent flag", () => {
    const args = parseCliArgs(["--live=x.json", "--write"]);
    expect(args.write).toBe(true);
  });

  it("læser --limit=<n> som et tal", () => {
    const args = parseCliArgs(["--live=x.json", "--limit=42"]);
    expect(args.limit).toBe(42);
  });

  it("læser --out=<sti>", () => {
    const args = parseCliArgs(["--live=x.json", "--out=/tmp/foo"]);
    expect(args.out).toBe("/tmp/foo");
  });

  it("kaster ved en ugyldig --limit", () => {
    expect(() => parseCliArgs(["--limit=abe"])).toThrow(/ugyldig/);
    expect(() => parseCliArgs(["--limit=0"])).toThrow(/ugyldig/);
    expect(() => parseCliArgs(["--limit=-5"])).toThrow(/ugyldig/);
  });

  it("kaster ved et ukendt flag — fejler højlydt frem for stiltiende at ignorere en tastefejl", () => {
    expect(() => parseCliArgs(["--liv=x.json"])).toThrow(/ukendt flag/);
  });

  it("kan kombinere alle flag på én gang", () => {
    const args = parseCliArgs(["--live=a.json", "--limit=10", "--write", "--out=/tmp/b"]);
    expect(args).toEqual({ live: "a.json", limit: 10, write: true, out: "/tmp/b" });
  });
});
