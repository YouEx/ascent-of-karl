import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import {
  deserializeProfile,
  migrateLegacyProfile,
  serialize,
  serializeProfile,
} from "../src/core/save";
import { freshNarratorState } from "../src/narrator/narrator";

const content = loadContent();

describe("profile V2 migration", () => {
  it("migrates an active V1 save without inventing Chronicle history", () => {
    const engine = new Engine(content);
    engine.combine("sten", "sten");
    engine.combine("gnister", "graes");
    const input = {
      saveJson: serialize(engine.getState(), "2026-08-16T07:00:00Z"),
      narrator: freshNarratorState(),
      achievements: {},
      content,
      lifeId: "legacy-active",
      startedAt: "2026-08-16T07:00:00Z",
      migratedAt: "2026-08-16T08:00:00Z",
    };
    const first = migrateLegacyProfile(input);
    const second = migrateLegacyProfile(input);
    expect(second).toEqual(first);
    expect(first.archives).toEqual([]);
    expect(first.profile.activeLife?.lifeId).toBe("legacy-active");
    expect(first.profile.activeLife?.events).toEqual([]);
    expect(first.profile.compendium.unlocks).toHaveProperty("discovery:ild");
  });

  it("creates one legacy-summary archive for an already-ended save", () => {
    const engine = new Engine(content);
    const state = engine.getState();
    state.ended = "et-helt-liv";
    const result = migrateLegacyProfile({
      saveJson: serialize(state, "2026-08-16T07:00:00Z"),
      narrator: freshNarratorState(),
      achievements: { "et-helt-liv": "2026-08-15" },
      content,
      lifeId: "legacy-ended",
      startedAt: "2026-08-16T07:00:00Z",
      migratedAt: "2026-08-16T08:00:00Z",
    });
    expect(result.profile.activeLife).toBeNull();
    expect(result.archives).toHaveLength(1);
    expect(result.archives[0]?.historyCompleteness).toBe("legacy-summary");
    expect(result.profile.compendium.unlocks).toHaveProperty(
      "ending:et-helt-liv",
    );
  });

  it("round-trips a V2 profile and rejects unknown versions", () => {
    const engine = new Engine(content);
    const profile = migrateLegacyProfile({
      saveJson: serialize(engine.getState(), "2026-08-16T07:00:00Z"),
      narrator: freshNarratorState(),
      achievements: {},
      content,
      lifeId: "legacy-active",
      startedAt: "2026-08-16T07:00:00Z",
      migratedAt: "2026-08-16T08:00:00Z",
    }).profile;
    expect(
      deserializeProfile(
        serializeProfile(profile, "2026-08-16T08:00:00Z"),
      ),
    ).toEqual(profile);
    expect(() =>
      deserializeProfile('{"version":3,"profile":{}}'),
    ).toThrow("Ukendt profil-version: 3");
  });
});
