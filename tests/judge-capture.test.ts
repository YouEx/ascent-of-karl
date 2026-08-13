import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runCapture, stopServer } from "../tools/judge/capture.mjs";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runProcessGroup } from "../tools/judge/process-group.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

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

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(processAlive(pid), `proces ${pid} lever stadig`).toBe(false);
}

const TREE_SCRIPT = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const pidPath = process.argv[1];
const mode = process.argv[2];
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(pidPath, JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }));
if (mode === "error") setTimeout(() => process.exit(7), 100);
else setInterval(() => {}, 1000);
`;

describe("process-group — timeout/error efterlader ingen efterkommere", () => {
  it("dræber både barn og barnebarn ved timeout uden pkill/killall", async () => {
    const dir = mkdtempSync(join(SCRATCH_ROOT, "process-timeout-"));
    const pidPath = join(dir, "pids.json");
    try {
      await expect(
        runProcessGroup(process.execPath, ["-e", TREE_SCRIPT, pidPath, "timeout"], {
          timeoutMs: 500,
        }),
      ).rejects.toThrow(/timeout/i);
      expect(existsSync(pidPath)).toBe(true);
      const pids = JSON.parse(readFileSync(pidPath, "utf8"));
      await waitForDead(pids.parent);
      await waitForDead(pids.grandchild);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dræber barnebarnet, når barnet afslutter med fejl", async () => {
    const dir = mkdtempSync(join(SCRATCH_ROOT, "process-error-"));
    const pidPath = join(dir, "pids.json");
    try {
      await expect(
        runProcessGroup(process.execPath, ["-e", TREE_SCRIPT, pidPath, "error"], {
          timeoutMs: 2_000,
        }),
      ).rejects.toThrow(/kode 7/i);
      expect(existsSync(pidPath)).toBe(true);
      const pids = JSON.parse(readFileSync(pidPath, "utf8"));
      await waitForDead(pids.parent);
      await waitForDead(pids.grandchild);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
