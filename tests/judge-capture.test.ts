import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runCapture, stopServer } from "../tools/judge/capture.mjs";

const registry = {
  screens: [
    { id: "game", nativeWidth: 100, nativeHeight: 100, regions: [] },
    { id: "title", nativeWidth: 100, nativeHeight: 100, regions: [] },
  ],
};

describe("capture.mjs — selvstændig ressourcelevetid", () => {
  it("lukker browser og preview-server efter en vellykket optagelse", async () => {
    const server = {};
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = { close };
    const captureScreenFn = vi.fn().mockResolvedValue({ regions: {} });
    const stopServerFn = vi.fn().mockResolvedValue(undefined);

    const result = await runCapture({
      want: "all",
      outDir: ".judge/test",
      loadRegistryFn: vi.fn().mockResolvedValue(registry),
      startServerFn: vi.fn().mockResolvedValue(server),
      launchBrowser: vi.fn().mockResolvedValue(browser),
      captureScreenFn,
      stopServerFn,
    });

    expect(result.map((entry: any) => entry.screen.id)).toEqual(["game", "title"]);
    expect(captureScreenFn).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stopServerFn).toHaveBeenCalledWith(server);
  });

  it("dræber preview-serveren og bevarer den oprindelige fejl, hvis browseren ikke kan starte", async () => {
    const server = {};
    const stopServerFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCapture({
        want: "title",
        outDir: ".judge/test",
        loadRegistryFn: vi.fn().mockResolvedValue(registry),
        startServerFn: vi.fn().mockResolvedValue(server),
        launchBrowser: vi.fn().mockRejectedValue(new Error("Chromium kunne ikke starte")),
        captureScreenFn: vi.fn(),
        stopServerFn,
      }),
    ).rejects.toThrow("Chromium kunne ikke starte");

    expect(stopServerFn).toHaveBeenCalledWith(server);
  });

  it("lukker browser og server, hvis selve optagelsen fejler", async () => {
    const server = {};
    const close = vi.fn().mockResolvedValue(undefined);
    const stopServerFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCapture({
        want: "title",
        outDir: ".judge/test",
        loadRegistryFn: vi.fn().mockResolvedValue(registry),
        startServerFn: vi.fn().mockResolvedValue(server),
        launchBrowser: vi.fn().mockResolvedValue({ close }),
        captureScreenFn: vi.fn().mockRejectedValue(new Error("screenshot fejlede")),
        stopServerFn,
      }),
    ).rejects.toThrow("screenshot fejlede");

    expect(close).toHaveBeenCalledTimes(1);
    expect(stopServerFn).toHaveBeenCalledWith(server);
  });

  it("venter på at en rigtig underproces er afsluttet", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    await stopServer(child, { timeoutMs: 1_000 });

    expect(child.killed).toBe(true);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
