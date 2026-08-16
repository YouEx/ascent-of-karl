import { describe, expect, it } from "vitest";
import {
  ProductEventBus,
  type AnyProductEvent,
} from "../src/product/events";
import type { KeyValueStorage } from "../src/product/local-event-store";
import { PRODUCT_EVENT_STORAGE_KEY } from "../src/product/generated/contracts";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function lifeStarted(bus: ProductEventBus, seed: number) {
  return bus.emit({
    type: "life.started",
    scenario: "life.fresh-start",
    turn: 0,
    payload: { mode: "new", seed, saveVersion: 2, act: 1 },
  });
}

describe("typed product events", () => {
  it("derives capability, assigns contiguous sequence and freezes payload", () => {
    const bus = new ProductEventBus();
    const first = lifeStarted(bus, 7);
    const second = bus.emit({
      type: "need.updated",
      scenario: "need.active",
      turn: 0,
      payload: {
        cause: "life-started",
        activeNeedId: "kulde",
        needs: [{ id: "kulde", required: true, status: "active" }],
      },
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(first.capability).toBe("life.begin");
    expect(second.capability).toBe("guidance.needs");
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.payload)).toBe(true);
  });

  it("rejects invalid scenarios and turns before recording evidence", () => {
    const storage = new MemoryStorage();
    const bus = new ProductEventBus({ storage });
    expect(() =>
      bus.emit({
        type: "life.started",
        scenario: "attempt.no-fuse",
        turn: 0,
        payload: { mode: "new", seed: 1, saveVersion: 2, act: 1 },
      }),
    ).toThrow("life.started is not valid in product scenario attempt.no-fuse");
    expect(() =>
      bus.emit({
        type: "life.started",
        scenario: "life.fresh-start",
        turn: -1,
        payload: { mode: "new", seed: 1, saveVersion: 2, act: 1 },
      }),
    ).toThrow("product event turn must be a non-negative integer");
    expect(bus.journal()).toEqual([]);
  });

  it("persists a bounded local journal without timestamps or session ids", () => {
    const storage = new MemoryStorage();
    const bus = new ProductEventBus({ storage });
    for (let seed = 0; seed < 510; seed++) lifeStarted(bus, seed);
    const journal = bus.journal();
    expect(journal).toHaveLength(500);
    expect(journal[0]!.payload).toMatchObject({ seed: 10 });
    const raw = storage.getItem(PRODUCT_EVENT_STORAGE_KEY)!;
    expect(raw).not.toContain("timestamp");
    expect(raw).not.toContain("sessionId");
  });

  it("keeps authoritative transitions alive when observers or storage fail", () => {
    const delivered: AnyProductEvent[] = [];
    const failingStorage: KeyValueStorage = {
      getItem() {
        throw new Error("unavailable");
      },
      setItem() {
        throw new Error("full");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    const bus = new ProductEventBus({
      storage: failingStorage,
      dispatch(event) {
        delivered.push(event);
      },
    });
    bus.subscribe(() => {
      throw new Error("observer bug");
    });
    const event = lifeStarted(bus, 9);
    expect(event.sequence).toBe(1);
    expect(delivered).toEqual([event]);
    expect(bus.journal()).toEqual([]);
  });

  it("exports explicit local evidence and clears it", () => {
    const storage = new MemoryStorage();
    const bus = new ProductEventBus({ storage });
    lifeStarted(bus, 42);
    expect(JSON.parse(bus.exportJournal())).toHaveLength(1);
    bus.clearJournal();
    expect(bus.journal()).toEqual([]);
  });

  it("keeps an explicit per-life journal separate from the global evidence log", () => {
    const storage = new MemoryStorage();
    const bus = new ProductEventBus({ storage });
    bus.startLifeJournal();
    const firstLife = lifeStarted(bus, 1);
    expect(bus.lifeJournal()).toEqual([firstLife]);

    bus.startLifeJournal();
    const secondLife = lifeStarted(bus, 2);
    expect(bus.lifeJournal()).toEqual([secondLife]);
    expect(bus.journal()).toEqual([firstLife, secondLife]);
  });

  it("resumes a life journal without reusing event sequence numbers", () => {
    const original = new ProductEventBus();
    original.startLifeJournal();
    lifeStarted(original, 7);
    const existing = original.lifeJournal();

    const resumed = new ProductEventBus();
    resumed.startLifeJournal(existing);
    const next = resumed.emit({
      type: "need.updated",
      scenario: "need.active",
      turn: 1,
      payload: {
        cause: "attempt",
        activeNeedId: "kulde",
        needs: [{ id: "kulde", required: true, status: "active" }],
      },
    });
    expect(next.sequence).toBe(existing[0]!.sequence + 1);
    expect(resumed.lifeJournal()).toEqual([...existing, next]);
  });
});
