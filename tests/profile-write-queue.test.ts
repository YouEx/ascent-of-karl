import { describe, expect, it } from "vitest";
import { SerialWriteQueue } from "../src/persistence/write-queue";

describe("profile persistence write queue", () => {
  it("never lets a later profile save overtake an earlier write", async () => {
    const queue = new SerialWriteQueue();
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      started.push("first");
      await firstGate;
    });
    const second = queue.run(async () => {
      started.push("second");
    });

    await Promise.resolve();
    expect(started).toEqual(["first"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(started).toEqual(["first", "second"]);
  });

  it("continues after a failed write without hiding that failure", async () => {
    const queue = new SerialWriteQueue();
    const first = queue.run(async () => {
      throw new Error("storage failed");
    });
    const second = queue.run(async () => "saved");

    await expect(first).rejects.toThrow("storage failed");
    await expect(second).resolves.toBe("saved");
  });
});
