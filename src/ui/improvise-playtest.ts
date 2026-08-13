import { pairKey } from "../core/engine";
import type { LogStorage } from "./playtest";
import type { InventionSummary } from "./run-summary";

const KEY = "karl-playtest-improvisation-v2";

export interface ImprovisationRecordV2 {
  pair: string;
  act: number;
  summer: number;
  outcome: "accepted" | "rejected" | "reused";
  solvedNeed: string | null;
  solvedChallenge: string | null;
  source: "fallback" | "worker-copy";
  latencyMs: number | null;
  timeout: boolean;
}

export type ImprovisationInputV2 = Omit<ImprovisationRecordV2, "pair"> & {
  a: string;
  b: string;
};

export interface ImprovisationRunV2 {
  ending: string;
  inventions: InventionSummary;
  improvisations: ImprovisationRecordV2[];
}

export interface ImprovisationLogV2 {
  version: 2;
  runs: ImprovisationRunV2[];
}

interface StoredV2 extends ImprovisationLogV2 {
  current: ImprovisationRecordV2[];
}

function empty(): StoredV2 {
  return { version: 2, runs: [], current: [] };
}

export class ImprovisationPlaytestLog {
  constructor(private readonly storage: LogStorage = localStorage) {}

  improvisation(record: ImprovisationInputV2): void {
    this.update((data) => {
      data.current.push({
        pair: pairKey(record.a, record.b),
        act: record.act,
        summer: record.summer,
        outcome: record.outcome,
        solvedNeed: record.solvedNeed,
        solvedChallenge: record.solvedChallenge,
        source: record.source,
        latencyMs: record.latencyMs,
        timeout: record.timeout,
      });
    });
  }

  network(
    a: string,
    b: string,
    act: number,
    summer: number,
    network: { latencyMs: number; timeout: boolean },
  ): void {
    this.update((data) => {
      const pair = pairKey(a, b);
      const current = [...data.current].reverse().find(
        (entry) =>
          entry.pair === pair &&
          entry.act === act &&
          entry.summer === summer,
      );
      const completed = [...data.runs]
        .reverse()
        .flatMap((run) => [...run.improvisations].reverse())
        .find(
          (entry) =>
            entry.pair === pair &&
            entry.act === act &&
            entry.summer === summer,
        );
      const target = current ?? completed;
      if (!target) return;
      target.latencyMs = network.latencyMs;
      target.timeout = network.timeout;
    });
  }

  run(summary: Omit<ImprovisationRunV2, "improvisations">): void {
    this.update((data) => {
      data.runs.push({
        ...summary,
        improvisations: data.current,
      });
      data.current = [];
    });
  }

  read(): ImprovisationLogV2 {
    const data = this.load();
    return { version: 2, runs: data.runs };
  }

  private load(): StoredV2 {
    const raw = this.storage.getItem(KEY);
    if (!raw) return empty();
    try {
      const parsed = JSON.parse(raw) as StoredV2;
      if (
        parsed?.version !== 2 ||
        !Array.isArray(parsed.runs) ||
        !Array.isArray(parsed.current)
      ) {
        return empty();
      }
      return parsed;
    } catch {
      return empty();
    }
  }

  private update(mutate: (data: StoredV2) => void): void {
    const data = this.load();
    mutate(data);
    try {
      this.storage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Telemetri må aldrig blokere spillet.
    }
  }
}
