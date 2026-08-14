import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runCapture, stopServer } from "../tools/judge/capture.mjs";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runProcessGroup } from "../tools/judge/process-group.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });
// Den rigtige Chromium-kørsel er fokuseret/opt-in ligesom test:visual. CI's
// ux-audit kører selve package-gaten efter browserinstallationen.
const FIDELITY_E2E =
  (process as unknown as { env?: Record<string, string | undefined> }).env
    ?.TITLE_FIDELITY_TESTS === "1";

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

describe("capture.mjs — registrerede viewports og browserbevis (TASK-003)", () => {
  it.runIf(FIDELITY_E2E)(
    "skriver PNG, DPR/image-metadata og resource bytes for hver registreret viewport",
    async () => {
      const outDir = mkdtempSync(join(SCRATCH_ROOT, "registered-"));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>`;
      const html = `<!doctype html>
        <html data-ready="true">
          <head>
            <style>#title-screen { background-image: url("/bg.svg"); }</style>
          </head>
          <body>
            <div id="title-screen">
              <img class="title-test-art" src="/asset.svg" style="width:4px;height:4px" alt="">
            </div>
          </body>
        </html>`;
      const server = createServer((request, response) => {
        const body = request.url?.startsWith("/asset.svg") || request.url?.startsWith("/bg.svg")
          ? svg
          : html;
        response.statusCode = 200;
        response.setHeader(
          "content-type",
          body === svg ? "image/svg+xml" : "text/html; charset=utf-8",
        );
        response.setHeader("content-length", String(body.length));
        response.setHeader("cache-control", "no-store");
        response.end(body);
      });
      await new Promise<void>((resolve) => {
        server.listen(5199, "127.0.0.1", resolve);
      });
      let stopped = false;

      const fixtureRegistry = {
        viewports: [
          { id: "fixture-a", width: 320, height: 240, dpr: 1, payloadClass: "desktop" },
          { id: "fixture-b", width: 400, height: 300, dpr: 2, payloadClass: "mobile" },
        ],
        screens: [
          { id: "title", scenario: "title-fresh", nativeWidth: 100, nativeHeight: 100, regions: [] },
        ],
      };

      try {
        await runCapture({
          want: "title",
          viewports: "registered",
          outDir,
          loadRegistryFn: vi.fn().mockResolvedValue(fixtureRegistry),
          startServerFn: vi.fn().mockResolvedValue(server),
          launchBrowser: () => chromium.launch({ headless: true }),
          stopServerFn: (fixtureServer: typeof server) =>
            new Promise<void>((resolve, reject) => {
              fixtureServer.close((error) => {
                stopped = true;
                if (error) reject(error);
                else resolve();
              });
            }),
        });

        for (const viewport of fixtureRegistry.viewports) {
          const metricsPath = join(outDir, "metrics", `title-${viewport.id}.json`);
          const resourcesPath = join(outDir, "resources", `title-${viewport.id}.json`);
          expect(existsSync(join(outDir, "render", `title-${viewport.id}.png`))).toBe(true);
          expect(existsSync(metricsPath)).toBe(true);
          expect(existsSync(resourcesPath)).toBe(true);

          const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
          expect(metrics.viewport).toEqual(viewport);
          expect(metrics.images).toHaveLength(1);
          expect(metrics.images[0]).toMatchObject({
            selector: "img.title-test-art",
            naturalWidth: 1,
            naturalHeight: 1,
            renderedWidth: 4,
            renderedHeight: 4,
            physicalWidth: 4 * viewport.dpr,
            physicalHeight: 4 * viewport.dpr,
            titleCritical: true,
          });
          expect(metrics.images[0].currentSrc).toMatch(/\/asset\.svg$/);

          const resources = JSON.parse(readFileSync(resourcesPath, "utf8"));
          expect(resources.viewport).toEqual(viewport);
          expect(resources.entries).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                url: expect.stringMatching(/\/asset\.svg$/),
                initiatorType: "img",
                criticalPayload: true,
                transferSize: expect.any(Number),
                decodedBodySize: expect.any(Number),
              }),
              expect.objectContaining({
                url: expect.stringMatching(/\/bg\.svg$/),
                initiatorType: "css",
                criticalPayload: true,
                transferSize: expect.any(Number),
                decodedBodySize: expect.any(Number),
              }),
            ]),
          );
        }
      } finally {
        if (!stopped) {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        rmSync(outDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
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
