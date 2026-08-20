import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import captureSource from "../tools/judge/capture.mjs?raw";
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

describe("capture.mjs — karakterbevis", () => {
  it("resampler asset-croppet med høj browserkvalitet", () => {
    expect(captureSource).toContain("imageSmoothingEnabled = true");
    expect(captureSource).toContain('imageSmoothingQuality = "high"');
    expect(captureSource).toContain("pixelData.data[index + 3] = 255");
  });
});

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
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><path fill="#6b4e32" d="M0 0h100v80H0z"/><path fill="#d6a45d" d="M45 10h35v60H45z"/></svg>`;
      const html = `<!doctype html>
        <html data-ready="true">
          <head>
            <style>
              * { box-sizing:border-box }
              html,body,#title-screen { width:100%;height:100%;margin:0 }
              .title-stage { position:absolute;inset:0;--scene-src:url("/legacy-scene.svg");background:url("/bg.svg") }
              .title-stage::after { content:"";position:absolute;inset:0;background:var(--scene-src) right center/auto 100% no-repeat }
              .title-panel { position:absolute;left:12%;top:10%;width:36%;height:80%;background:#e8d7bd }
              [data-title-layer] { position:absolute;width:10px;height:8px;object-fit:fill }
            </style>
          </head>
          <body>
            <div id="title-screen">
              <div class="title-stage"><div class="title-panel"></div></div>
              <img data-title-layer="scene" src="/scene.svg" style="left:1px;top:1px" alt="">
              <img data-title-layer="foreground" src="/foreground.svg" style="left:12px;top:1px" alt="">
              <img data-title-layer="parchment" src="/parchment.svg" style="left:23px;top:1px" alt="">
              <img data-title-layer="wordmark" src="/wordmark.svg" style="left:34px;top:1px" alt="">
            </div>
          </body>
        </html>`;
      const server = createServer((request, response) => {
        const body = request.url?.endsWith(".svg")
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

      const actualRegistry = JSON.parse(
        readFileSync(join(HERE, "..", "docs/design/reference/registry.json"), "utf8"),
      );
      const fixtureRegistry = {
        viewports: actualRegistry.viewports,
        goalMetrics: {
          capture: {
            canonicalCharacterSize: { width: 64, height: 64 },
            sceneAssetSelector: ".title-stage",
            sceneCssVariable: "--scene-src",
            characterRectNormalized: [0.4, 0.1, 0.4, 0.8],
            requiredLayers: ["scene", "foreground", "parchment", "wordmark"],
          },
        },
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
          expect(metrics.capture).toEqual({
            pixelWidth: viewport.width * viewport.dpr,
            pixelHeight: viewport.height * viewport.dpr,
          });
          expect(metrics.layers.map((layer: any) => layer.layerId).sort()).toEqual([
            "foreground",
            "parchment",
            "scene",
            "wordmark",
          ]);
          expect(metrics.geometry.seam).toMatchObject({
            axis: "vertical",
            physicalX: expect.any(Number),
            physicalHeight: expect.any(Number),
          });
          expect(metrics.geometry.character).toMatchObject({
            measurementSource: "asset",
            canonicalWidth: 64,
            canonicalHeight: 64,
            uiOverlapPixels: 0,
          });
          expect(
            existsSync(join(outDir, "render", `title-${viewport.id}-character.png`)),
          ).toBe(true);

          const resources = JSON.parse(readFileSync(resourcesPath, "utf8"));
          expect(resources.viewport).toEqual(viewport);
          for (const layerId of ["scene", "foreground", "parchment", "wordmark"]) {
            expect(resources.entries).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  url: expect.stringMatching(new RegExp(`/${layerId}\\.svg$`)),
                  initiatorType: "img",
                  transferSize: expect.any(Number),
                  decodedBodySize: expect.any(Number),
                }),
              ]),
            );
          }
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

/**
 * Regression: preview-serveren startes som `npx vite preview`, hvor `npx` blot
 * er en indpakning. Da stopServer kun signalerede indpakningen, overlevede
 * `vite` som forældreløs på CI's Linux, holdt de arvede pipes åbne og forhindrede
 * capture.mjs i nogensinde at afslutte — dommeren brændte hele sit budget på et
 * `close`, der aldrig kom, og døde tavst efter 240 s (CI-kørsel 31871036465).
 */
describe("stopServer — indpakning og server dør sammen", () => {
  it("dræber også barnebarnet, ikke kun den npx-lignende indpakning", async () => {
    const dir = mkdtempSync(join(SCRATCH_ROOT, "stop-server-tree-"));
    const pidPath = join(dir, "pids.json");
    try {
      const wrapper = spawn(process.execPath, ["-e", TREE_SCRIPT, pidPath, "wait"], {
        stdio: "ignore",
        detached: (process as unknown as { platform: string }).platform !== "win32",
      });
      const deadline = Date.now() + 5_000;
      while (!existsSync(pidPath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const pids = JSON.parse(readFileSync(pidPath, "utf8"));
      expect(processAlive(pids.grandchild)).toBe(true);

      await stopServer(wrapper, { timeoutMs: 2_000 });

      await waitForDead(pids.parent);
      await waitForDead(pids.grandchild);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Testen ovenfor beviser, at stopServer dræber et helt træ — men den leverer
 * selv `detached` til sin egen indpakning og importerer aldrig startServer.
 * Fjernede nogen `detached` fra produktionskoden, ville den altså blive
 * ubekymret grøn, mens CI hang igen. De to påstande her binder derfor kilden:
 * previewen skal starte i sin egen procesgruppe, OG den gruppe skal have en
 * vagt, der dræber den, når capture.mjs selv bliver dræbt. Uden vagten
 * overlever previewen som forældreløs på port 5199, næste CI-trins bind fejler
 * tavst, og ux-auditten måler den gamle server i stedet for det nye `dist/`
 * (efterprøvet: uden vagten svarede porten stadig 200 efter drabet).
 */
describe("preview-serverens procesgruppe er fastholdt i kilden", () => {
  const captureSource = readFileSync(
    join(HERE, "..", "tools", "judge", "capture.mjs"),
    "utf8",
  );

  it("startServer spawner previewen i sin egen gruppe", () => {
    expect(captureSource).toMatch(
      /"vite",\s*"preview"[\s\S]{0,900}?detached:\s*POSIX/,
    );
  });

  it("gruppen får en vagt, så den ikke kan overleve sin forælder", () => {
    expect(captureSource).toMatch(/armOrphanGuard\(proc\);/);
    expect(captureSource).toMatch(/process\.on\("exit",\s*killLiveServers\)/);
    expect(captureSource).toMatch(/SIGTERM:\s*143/);
  });
});

/**
 * Den kritiske fejl, denne fil skal forhindre i at komme igen: en ny funktion
 * blev indsat MELLEM captureScreen's JSDoc og dens `function`-nøgleord, så
 * `export` bandt sig til den nye funktion i stedet. `npm run judge`,
 * `judge:once` og `judge:determinism` døde derefter allerede ved modulindlæsning
 * — og CI så det ikke, fordi CI kun kører title-fidelity, som starter
 * capture.mjs som KOMMANDO og aldrig importerer den. Testen importerer modulet
 * præcis som scripts'ene gør.
 */
describe("capture.mjs' offentlige flade", () => {
  /**
   * Listen håndskrives ikke. Første udgave af denne test opremsede fem navne
   * og glemte `loadRegistry` — som ligger præcis der i filen, hvor det
   * oprindelige `export` blev tabt. En håndholdt liste over en anden fils
   * import er den samme driftklasse, den skal fange. Navnene læses derfor ud
   * af importørerne selv.
   */
  const IMPORTERS = [
    "tools/judge/determinism.mjs",
    "tools/judge/loop.mjs",
    "tests/judge-capture.test.ts",
    "tests/visual.test.ts",
  ];

  function importedNames() {
    const names = new Set<string>();
    for (const file of IMPORTERS) {
      const source = readFileSync(join(HERE, "..", file), "utf8");
      for (const match of source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"[^"]*capture\.mjs"/g,
      )) {
        for (const raw of (match[1] ?? "").split(",")) {
          const name = (raw.trim().split(/\s+as\s+/)[0] ?? "").trim();
          if (name) names.add(name);
        }
      }
    }
    return [...names].sort();
  }

  it("eksporterer stadig alt, dommerens scripts importerer", async () => {
    const mod = (await import(
      // @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
      "../tools/judge/capture.mjs"
    )) as Record<string, unknown>;

    const required = importedNames();
    expect(required).toContain("loadRegistry");
    expect(required.length).toBeGreaterThanOrEqual(6);

    const missing = required.filter((name) => mod[name] === undefined);
    expect(missing).toEqual([]);
  });

  it("holder ORIGIN som en brugbar oprindelse, ikke bare defineret", () => {
    // ORIGIN er en const, ikke en funktion: en typeof-kontrol for "function"
    // ville have blåstemplet en tabt eksport her.
    return import(
      // @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
      "../tools/judge/capture.mjs"
    ).then((mod: Record<string, unknown>) => {
      expect(typeof mod.ORIGIN).toBe("string");
      expect(String(mod.ORIGIN)).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);
    });
  });
});
