import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { runTitleFidelity } from "../tools/judge/title-fidelity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCRIPT = join(ROOT, "tools/judge/title_fidelity.py");
const REFERENCE = join(ROOT, "docs/design/reference/title-2026-08-11.webp");
const CURRENT =
  "/Users/martin/.copilot/session-state/9c29f629-2e15-4c0e-994f-c19bcd860d45/files/carl-current-title-1536.png";
const SCRATCH_ROOT = join(ROOT, ".judge", "test-scratch");
// Default `npm test` må ikke kræve OpenCV eller køre langsomme billedmålinger.
// Den fokuserede TDD-runde sætter flaget; CI kører den faktiske package-gate.
const FIDELITY_E2E =
  (process as unknown as { env?: Record<string, string | undefined> }).env
    ?.TITLE_FIDELITY_TESTS === "1";
const PYTHON_JUDGE_AVAILABLE = (() => {
  if (!FIDELITY_E2E) return false;
  try {
    execFileSync(
      "python3",
      [
        "-c",
        [
          "from importlib.metadata import version",
          "expected={'Pillow':'11.3.0','numpy':'2.0.2','scipy':'1.13.1','opencv-python-headless':'4.13.0.92','pytest':'8.4.2'}",
          "assert all(version(name)==want for name,want in expected.items())",
        ].join(";"),
      ],
      { cwd: ROOT, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
})();

function run(args: string[]) {
  try {
    const stdout = execFileSync("python3", [SCRIPT, ...args], {
      cwd: ROOT,
      stdio: "pipe",
    }).toString("utf8");
    return { status: 0, stdout, stderr: "", json: JSON.parse(stdout) };
  } catch (caught) {
    const error = caught as {
      status?: number;
      stdout?: { toString(encoding?: string): string };
      stderr?: { toString(encoding?: string): string };
    };
    const stdout = error.stdout?.toString("utf8") ?? "";
    return {
      status: error.status ?? 1,
      stdout,
      stderr: error.stderr?.toString("utf8") ?? "",
      json: stdout ? JSON.parse(stdout) : undefined,
    };
  }
}

function expectMetric(
  actual: Record<string, number>,
  name: string,
  expected: number,
  tolerance: number,
) {
  expect(actual[name], name).toBeGreaterThanOrEqual(expected - tolerance);
  expect(actual[name], name).toBeLessThanOrEqual(expected + tolerance);
}

describe.runIf(PYTHON_JUDGE_AVAILABLE)(
  "title_fidelity.py — kalibrerede skærmmetrikker (TASK-002)",
  () => {
  it(
    "matcher den SHA-pinnede godkendte reference og består de fem billedgates",
    () => {
      const result = run([
        "--image",
        REFERENCE,
        "--viewport",
        "target-native",
        "--json",
        "--fail-on-gate",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.json.algorithmVersion).toBe("title-fidelity-v1");
      expect(result.json.viewport).toEqual({
        id: "target-native",
        width: 1586,
        height: 992,
        dpr: 1,
      });
      expect(result.json.source.sha256).toBe(
        "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850",
      );
      expectMetric(result.json.metrics, "sceneSeamGradient", 2.61, 0.2);
      expectMetric(result.json.metrics, "titleInkOccupancy", 27.4, 0.2);
      expectMetric(result.json.metrics, "bottomLeftDarkShare", 41.3, 0.25);
      expectMetric(result.json.metrics, "characterDetailVariance", 336, 5);
      expectMetric(result.json.metrics, "globalEdgeDensity", 6.78, 0.1);
      expect(result.json.failing).toEqual([]);
    },
    30_000,
  );

  it.runIf(existsSync(CURRENT))(
    "matcher den SHA-pinnede nuværende capture og fejler præcis de fem target-native-billedgates",
    () => {
      const result = run([
        "--image",
        CURRENT,
        "--viewport",
        "target-native",
        "--json",
        "--fail-on-gate",
      ]);

      expect(result.status).toBe(1);
      expect(result.json.source.sha256).toBe(
        "082d979dd4c6c3f9b84bb763cd354b39502ce1ad4758cda94f087f77f95a575b",
      );
      expectMetric(result.json.metrics, "sceneSeamGradient", 13.18, 0.25);
      expectMetric(result.json.metrics, "titleInkOccupancy", 20.5, 0.2);
      expectMetric(result.json.metrics, "bottomLeftDarkShare", 14.5, 0.25);
      expectMetric(result.json.metrics, "characterDetailVariance", 174, 5);
      expectMetric(result.json.metrics, "globalEdgeDensity", 4.84, 0.1);
      expect(result.json.failing).toEqual([
        "sceneSeamGradient",
        "titleInkOccupancy",
        "bottomLeftDarkShare",
        "characterDetailVariance",
        "globalEdgeDensity",
      ]);
    },
    30_000,
  );
  },
);

describe.runIf(PYTHON_JUDGE_AVAILABLE)(
  "title_fidelity.py — asset-, payload- og no-upscale-kontrakter",
  () => {
  let scratch: string;
  let contractsPath: string;

  beforeAll(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_ROOT, "title-fidelity-"));
    const generator = `
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(${JSON.stringify(scratch)})
rng = np.random.default_rng(20260814)
texture = rng.integers(40, 220, size=(64, 64, 3), dtype=np.uint8)
Image.fromarray(texture, "RGB").save(root / "texture.png")
rgba = np.zeros((16, 16, 4), dtype=np.uint8)
rgba[4:12, 4:12, :3] = (66, 44, 28)
rgba[4:12, 4:12, 3] = 255
Image.fromarray(rgba, "RGBA").save(root / "edge.png")
`;
    expect(() =>
      execFileSync("python3", ["-c", generator], {
        cwd: ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();

    const resourcesPath = join(scratch, "resources.json");
    const metricsPath = join(scratch, "metrics.json");
    writeFileSync(
      resourcesPath,
      JSON.stringify({
        viewport: { id: "mobile-390", width: 390, height: 844, dpr: 2 },
        entries: [
          {
            url: "http://example.test/title.webp",
            transferSize: 350001,
            decodedBodySize: 700000,
            initiatorType: "img",
            criticalPayload: true,
          },
        ],
      }),
    );
    writeFileSync(
      metricsPath,
      JSON.stringify({
        viewport: { id: "mobile-390", width: 390, height: 844, dpr: 2 },
        images: [
          {
            selector: ".title-scene",
            currentSrc: "http://example.test/title.webp",
            naturalWidth: 780,
            naturalHeight: 1688,
            renderedWidth: 390.5,
            renderedHeight: 844,
            physicalWidth: 781,
            physicalHeight: 1688,
            titleCritical: true,
          },
        ],
      }),
    );

    contractsPath = join(scratch, "contracts.json");
    writeFileSync(
      contractsPath,
      JSON.stringify({
        sceneRetention: [
          {
            id: "scene-ok",
            master: join(scratch, "texture.png"),
            export: join(scratch, "texture.png"),
          },
        ],
        parchmentRetention: [
          {
            id: "paper-ok",
            reference: join(scratch, "texture.png"),
            reconstructed: join(scratch, "texture.png"),
            samples: [
              {
                id: "full",
                referenceRect: [0, 0, 64, 64],
                reconstructedRect: [0, 0, 64, 64],
              },
            ],
          },
        ],
        alphaEdges: [
          {
            id: "edge-ok",
            image: join(scratch, "edge.png"),
            parchment: "#ecdcc7",
          },
        ],
        captureContracts: [
          {
            viewport: "mobile-390",
            resources: resourcesPath,
            metrics: metricsPath,
          },
        ],
      }),
    );
    },
  );

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it(
    "måler retention og alpha mod de frosne gates",
    () => {
      const result = run(["--contracts", contractsPath, "--json"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.json.assetContracts.sceneRetention[0]).toMatchObject({
        id: "scene-ok",
        value: 1,
        pass: true,
      });
      expect(result.json.assetContracts.parchmentRetention[0]).toMatchObject({
        id: "paper-ok",
        value: 1,
        minimumSample: 1,
        pass: true,
      });
      expect(result.json.assetContracts.alphaEdges[0]).toMatchObject({
        id: "edge-ok",
        alphaTransitionPx: 0,
        fringePx: 0,
        pass: true,
      });
    },
    30_000,
  );

  it(
    "fælder payload over 350 kB og enhver fysisk opskalering på DPR2",
    () => {
      const result = run(["--contracts", contractsPath, "--json"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.json.captureContracts[0].payloadBytes).toMatchObject({
        value: 350001,
        limit: 350000,
        pass: false,
      });
      expect(result.json.captureContracts[0].noUpscale.pass).toBe(false);
      expect(result.json.failing).toEqual([
        "mobile-390/payloadBytes",
        "mobile-390/noUpscale",
      ]);
    },
    30_000,
  );
});

describe("title-fidelity.mjs — orkestrering og CI-kontrakt (TASK-004)", () => {
  it("rydder stale output og kører registered capture før Python-dommeren", async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    const outDir = mkdtempSync(join(SCRATCH_ROOT, "title-orchestrator-"));
    writeFileSync(join(outDir, "stale.txt"), "må ikke overleve");
    const resultFixture = {
      algorithmVersion: "title-fidelity-v1",
      viewports: {},
      failing: ["target-native/sceneSeamGradient"],
    };
    const runProcessFn = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(resultFixture),
        stderr: "",
        code: 0,
      });

    try {
      const result = await runTitleFidelity({ outDir, runProcessFn });
      expect(existsSync(join(outDir, "stale.txt"))).toBe(false);
      expect(result).toEqual(resultFixture);
      expect(runProcessFn).toHaveBeenNthCalledWith(
        1,
        process.execPath,
        [
          "tools/judge/capture.mjs",
          "--screen",
          "title",
          "--viewports",
          "registered",
          "--out",
          outDir,
        ],
        expect.objectContaining({ cwd: ROOT }),
      );
      expect(runProcessFn).toHaveBeenNthCalledWith(
        2,
        "python3",
        [
          "tools/judge/title_fidelity.py",
          "--run",
          outDir,
          "--viewports",
          "registered",
          "--json",
        ],
        expect.objectContaining({ cwd: ROOT }),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("pinner Python-miljøet, package-kommandoen og udvider kun ux-audit-jobbet", () => {
    const requirements = readFileSync(
      join(ROOT, "tools/judge/requirements.txt"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/);
    expect(requirements).toEqual([
      "Pillow==11.3.0",
      "numpy==2.0.2",
      "scipy==1.13.1",
      "opencv-python-headless==4.13.0.92",
      "pytest==8.4.2",
    ]);

    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["judge:title-fidelity"]).toBe(
      "node tools/judge/title-fidelity.mjs",
    );

    const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(workflow.match(/npm run judge:title-fidelity/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/^  title-fidelity:/m);
    const uxJob = workflow.slice(workflow.indexOf("  ux-audit:"));
    expect(uxJob).toMatch(/actions\/setup-python@v5/);
    expect(uxJob).toMatch(/pip install -r tools\/judge\/requirements\.txt/);
    expect(uxJob).toMatch(/npx playwright install --with-deps chromium/);
    expect(uxJob).toMatch(
      /id: title-fidelity[\s\S]*continue-on-error: true[\s\S]*npm run judge:title-fidelity/,
    );
    expect(uxJob).toMatch(
      /name: UX-audit[\s\S]*npm run ux[\s\S]*steps\.title-fidelity\.outcome == 'failure'[\s\S]*exit 1/,
    );
  });
});
