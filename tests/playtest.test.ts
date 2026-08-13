import { describe, expect, it } from "vitest";
import {
  PlaytestLog,
  type LogStorage,
  type RunRecord,
} from "../src/ui/playtest";

type ImprovisationCapableLog = PlaytestLog & {
  improvisation?: (record: {
    a: string;
    b: string;
    act: number;
    summer: number;
    outcome: "accepted" | "rejected" | "reused";
    solvedNeed: string | null;
    solvedChallenge: string | null;
    source: "fallback" | "worker-copy";
    latencyMs: number | null;
    timeout: boolean;
  }) => void;
  improvisationNetwork?: (
    a: string,
    b: string,
    act: number,
    summer: number,
    network: { latencyMs: number; timeout: boolean },
  ) => void;
};

const noInventions = { total: 0, names: [] };

/** Hukommelses-storage, så testene ikke kræver en browser. */
function fakeStorage(seed: Record<string, string> = {}): LogStorage {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("PlaytestLog", () => {
  it("tæller det samme forgæves forsøg uanset rækkefølgen af de to elementer", () => {
    const log = new PlaytestLog(fakeStorage());
    log.miss("ild", "vand", 3);
    log.miss("vand", "ild", 9);

    const only = log.read().misses[0]!;
    expect(log.read().misses).toHaveLength(1);
    expect(only.pair).toBe("ild+vand");
    expect(only.count).toBe(2);
    // Første gang er det interessante: hvor tidligt forventede spilleren det?
    expect(only.firstSummer).toBe(3);
  });

  it("sorterer de hyppigste forsøg øverst — det er dem indholdet mangler", () => {
    const log = new PlaytestLog(fakeStorage());
    log.miss("a", "b", 1);
    log.miss("c", "d", 2);
    log.miss("c", "d", 5);

    expect(log.read().misses.map((m) => m.pair)).toEqual(["c+d", "a+b"]);
  });

  it("overlever en genindlæsning midt i et run", () => {
    const storage = fakeStorage();
    new PlaytestLog(storage).miss("ild", "vand", 3);

    expect(new PlaytestLog(storage).read().misses[0]!.count).toBe(1);
  });

  it("samler flere runs, så en tester der spiller igen ikke overskriver sig selv", () => {
    const storage = fakeStorage();
    const log = new PlaytestLog(storage);
    log.miss("ild", "vand", 3);
    log.run({ ending: "alderdom", summers: 50, discoveries: 20, minutes: 18, solved: [], flags: [], inventions: noInventions });
    log.miss("sten", "sten", 2);
    log.run({ ending: "ulve", summers: 31, discoveries: 12, minutes: 9, solved: ["ulve"], flags: ["ram"], inventions: noInventions });

    const out = log.read();
    expect(out.runs.map((r) => r.ending)).toEqual(["alderdom", "ulve"]);
    // Forsøgene hører til det run de skete i — ellers kan man ikke se om
    // blindgyden var noget man lærte af eller blev ved med at ramme.
    expect(out.runs[0]!.misses).toEqual(["ild+vand"]);
    expect(out.runs[1]!.misses).toEqual(["sten+sten"]);
    // ... men totalen tæller stadig på tværs
    expect(out.misses).toHaveLength(2);
  });

  it("er tom og uden krav på et første besøg", () => {
    const out = new PlaytestLog(fakeStorage()).read();
    expect(out.runs).toEqual([]);
    expect(out.misses).toEqual([]);
  });

  it("starter forfra frem for at kaste, hvis loggen er blevet ulæselig", () => {
    // En halvskrevet localStorage-værdi må aldrig kunne forhindre nogen i at
    // spille — instrumentet er mindre vigtigt end spillet det måler.
    const storage = fakeStorage({ "karl-playtest-v1": "{ikke json" });
    const log = new PlaytestLog(storage);

    expect(log.read().misses).toEqual([]);
    expect(() => log.miss("ild", "vand", 1)).not.toThrow();
    expect(log.read().misses).toHaveLength(1);
  });

  it("lader spillet køre videre selv om der ikke må skrives til storage", () => {
    // Safaris private mode kaster på setItem når kvoten er nul.
    const storage: LogStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };

    expect(() => new PlaytestLog(storage).miss("ild", "vand", 1)).not.toThrow();
  });

  it("logger improvisationsforsøget i et fast, persondatafrit skema", () => {
    const log = new PlaytestLog(fakeStorage()) as ImprovisationCapableLog;
    expect(typeof log.improvisation).toBe("function");
    expect(typeof log.improvisationNetwork).toBe("function");
    if (!log.improvisation || !log.improvisationNetwork) return;

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
    log.improvisationNetwork("baer", "ler", 1, 3, {
      latencyMs: 2500,
      timeout: true,
    });
    log.run({
      ending: "alderdom",
      summers: 50,
      discoveries: 20,
      minutes: 18,
      solved: ["sult"],
      flags: [],
      inventions: { total: 1, names: ["Clay berries"] },
    } as Omit<RunRecord, "misses" | "improvisations">);

    const record = log.read().runs[0]!.improvisations[0]!;
    expect(record).toEqual({
      pair: "baer+ler",
      act: 1,
      summer: 3,
      outcome: "accepted",
      solvedNeed: "sult",
      solvedChallenge: "ulve",
      source: "fallback",
      latencyMs: 2500,
      timeout: true,
    });
    expect(Object.keys(record).sort()).toEqual([
      "act",
      "latencyMs",
      "outcome",
      "pair",
      "solvedChallenge",
      "solvedNeed",
      "source",
      "summer",
      "timeout",
    ]);
    expect(log.read().runs[0]!.inventions).toEqual({
      total: 1,
      names: ["Clay berries"],
    });
  });

  it("bevarer accepted/rejected/reused og worker-copy som lukkede værdier", () => {
    const log = new PlaytestLog(fakeStorage()) as ImprovisationCapableLog;
    expect(typeof log.improvisation).toBe("function");
    if (!log.improvisation) return;
    for (const [index, outcome] of [
      "accepted",
      "rejected",
      "reused",
    ].entries()) {
      log.improvisation({
        a: "a",
        b: `b-${index}`,
        act: 1,
        summer: index + 1,
        outcome: outcome as "accepted" | "rejected" | "reused",
        solvedNeed: null,
        solvedChallenge: null,
        source: index === 0 ? "worker-copy" : "fallback",
        latencyMs: index === 0 ? 80 : null,
        timeout: false,
      });
    }
    log.run({
      ending: "alderdom",
      summers: 50,
      discoveries: 20,
      minutes: 18,
      solved: [],
      flags: [],
      inventions: noInventions,
    } as Omit<RunRecord, "misses" | "improvisations">);

    expect(log.read().runs[0]!.improvisations.map((entry) => entry.outcome)).toEqual([
      "accepted",
      "rejected",
      "reused",
    ]);
    expect(log.read().runs[0]!.improvisations[0]!.source).toBe("worker-copy");
  });
});
