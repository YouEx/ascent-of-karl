import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import {
  applyCompletionUnlocks,
  applyLiveProgress,
  completionKeys,
  completionStatus,
  freshCompendium,
} from "../src/core/compendium";

const content = loadContent();
const manifest = content.completionManifest!;

describe("authored-content compendium", () => {
  it("has a finite denominator of canonical discoveries, major branches and endings", () => {
    expect(manifest.discoveries).toHaveLength(179);
    expect(manifest.branches).toEqual([
      "hulekunstner",
      "larvemanden",
      "overleveren",
    ]);
    expect(manifest.endings).toHaveLength(15);
    expect(completionKeys(manifest)).toHaveLength(197);
  });

  it("is idempotent and excludes invention ids outside the manifest", () => {
    const provenance = {
      firstLifeId: "life-1",
      unlockedAt: "2026-08-16T08:00:00Z",
      viaInvention: true,
    };
    const first = applyCompletionUnlocks(
      freshCompendium(),
      ["discovery:ild", "branch:overleveren"],
      provenance,
    );
    const second = applyCompletionUnlocks(
      first,
      ["discovery:ild", "branch:overleveren"],
      { ...provenance, firstLifeId: "life-2" },
    );
    expect(second).toEqual(first);
    expect(
      completionStatus(manifest, {
        ...second,
        unlocks: {
          ...second.unlocks,
          "discovery:improv-unknown": provenance,
        },
      }).found,
    ).toBe(2);
  });

  it("reports deterministic basis points without display rounding", () => {
    const compendium = applyCompletionUnlocks(
      freshCompendium(),
      ["discovery:ild", "branch:overleveren", "ending:et-helt-liv"],
      {
        firstLifeId: "life-1",
        unlockedAt: "2026-08-16T08:00:00Z",
        viaInvention: false,
      },
    );
    const status = completionStatus(manifest, compendium);
    expect(status.found).toBe(3);
    expect(status.total).toBe(197);
    expect(status.basisPoints).toBe(Math.floor((3 * 10000) / 197));
  });

  it("updates authored completion and the invention gallery during an active life", () => {
    const engine = new Engine(content);
    engine.combine("sten", "sten");
    const invented = engine.attempt("graes", "pind");
    expect(invented.kind).toBe("improvised");
    const next = applyLiveProgress(
      freshCompendium(),
      content,
      engine.getState(),
      {
        firstLifeId: "life-live",
        unlockedAt: "2026-08-16T08:00:00Z",
        viaInvention: true,
      },
    );

    expect(next.unlocks).toHaveProperty("discovery:gnister");
    expect(next.inventions).toEqual([
      {
        id: invented.kind === "improvised" ? invented.element.id : "",
        name: invented.kind === "improvised" ? invented.element.name : "",
        parents:
          invented.kind === "improvised"
            ? invented.element.parents
            : ["", ""],
        firstLifeId: "life-live",
      },
    ]);
    expect(
      applyLiveProgress(next, content, engine.getState(), {
        firstLifeId: "life-other",
        unlockedAt: "2026-08-16T09:00:00Z",
        viaInvention: false,
      }),
    ).toEqual(next);
  });
});
