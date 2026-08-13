import { describe, expect, it } from "vitest";
import {
  ImprovisationPlaytestLog,
  type ImprovisationLogV2,
} from "../src/ui/improvise-playtest";
import type { LogStorage } from "../src/ui/playtest";

function fakeStorage(seed: Record<string, string> = {}): LogStorage & {
  raw(key: string): string | null;
} {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    raw: (key) => data.get(key) ?? null,
  };
}

describe("ImprovisationPlaytestLog v2", () => {
  it("gemmer forsøg og bounded run-summary i en separat eksakt v2-shape", () => {
    const storage = fakeStorage();
    const log = new ImprovisationPlaytestLog(storage);
    log.improvisation({
      a: "ler",
      b: "baer",
      act: 1,
      summer: 3,
      outcome: "accepted",
      solvedNeed: "sult",
      solvedChallenge: "ulve",
      source: "fallback",
      latencyMs: null,
      timeout: false,
    });
    log.network("baer", "ler", 1, 3, {
      latencyMs: 2500,
      timeout: true,
    });
    log.run({
      ending: "alderdom",
      inventions: { total: 1, names: ["Clay berries"] },
    });

    expect(log.read()).toEqual({
      version: 2,
      runs: [{
        ending: "alderdom",
        inventions: { total: 1, names: ["Clay berries"] },
        improvisations: [{
          pair: "baer+ler",
          act: 1,
          summer: 3,
          outcome: "accepted",
          solvedNeed: "sult",
          solvedChallenge: "ulve",
          source: "fallback",
          latencyMs: 2500,
          timeout: true,
        }],
      }],
    } satisfies ImprovisationLogV2);
    expect(JSON.parse(storage.raw("karl-playtest-improvisation-v2")!)).toEqual({
      version: 2,
      runs: log.read().runs,
      current: [],
    });
  });

  it("rører aldrig den historiske v1-nøgle", () => {
    const v1 = JSON.stringify({
      version: 1,
      runs: [],
      misses: {},
      current: [],
    });
    const storage = fakeStorage({ "karl-playtest-v1": v1 });
    const log = new ImprovisationPlaytestLog(storage);

    log.improvisation({
      a: "a",
      b: "b",
      act: 1,
      summer: 1,
      outcome: "rejected",
      solvedNeed: null,
      solvedChallenge: null,
      source: "fallback",
      latencyMs: null,
      timeout: false,
    });

    expect(storage.raw("karl-playtest-v1")).toBe(v1);
    expect(storage.raw("karl-playtest-improvisation-v2")).not.toBeNull();
  });

  it("starter tomt ved ulæselig eller forkert version uden at omskrive v1", () => {
    const v1 = '{"version":1,"runs":[],"misses":{},"current":[]}';
    const storage = fakeStorage({
      "karl-playtest-v1": v1,
      "karl-playtest-improvisation-v2": '{"version":1}',
    });

    expect(new ImprovisationPlaytestLog(storage).read()).toEqual({
      version: 2,
      runs: [],
    });
    expect(storage.raw("karl-playtest-v1")).toBe(v1);
  });
});
