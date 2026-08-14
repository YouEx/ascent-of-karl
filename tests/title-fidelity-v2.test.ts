import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCRIPT = join(ROOT, "tools/judge/title_fidelity.py");
const REFERENCE = join(ROOT, "docs/design/reference/title-2026-08-11.webp");
const SCRATCH_ROOT = join(ROOT, ".judge", "test-scratch");
const E2E =
  (process as unknown as { env?: Record<string, string | undefined> }).env
    ?.TITLE_FIDELITY_TESTS === "1";

function run(args: string[]) {
  try {
    const stdout = execFileSync("python3", [SCRIPT, ...args], {
      cwd: ROOT,
      stdio: "pipe",
    }).toString("utf8");
    return { status: 0, stderr: "", json: JSON.parse(stdout) };
  } catch (caught) {
    const error = caught as {
      status?: number;
      stdout?: { toString(encoding?: string): string };
      stderr?: { toString(encoding?: string): string };
    };
    const stdout = error.stdout?.toString("utf8") ?? "";
    return {
      status: error.status ?? 1,
      stderr: error.stderr?.toString("utf8") ?? "",
      json: stdout ? JSON.parse(stdout) : undefined,
    };
  }
}

describe.runIf(E2E)("title-fidelity-v2 — mål og kontrakter", () => {
  let scratch: string;
  let registryPath: string;
  let verticalPath: string;
  let horizontalPath: string;
  let characterPath: string;
  let flatCharacterPath: string;
  let validContracts: any;

  const writeJson = (name: string, value: unknown) => {
    const path = join(scratch, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  const geometry = (
    imageWidth = 100,
    imageHeight = 80,
    seamX = 50,
    cropPath = characterPath,
    overlap = 0,
  ) => ({
    capture: { pixelWidth: imageWidth, pixelHeight: imageHeight },
    seam: {
      axis: "vertical",
      kind: "scene-extension",
      physicalX: seamX,
      physicalY: 0,
      physicalHeight: imageHeight,
    },
    character: {
      measurementSource: "asset",
      cropPath,
      canonicalWidth: 32,
      canonicalHeight: 32,
      uiOverlapPixels: overlap,
    },
  });

  beforeAll(() => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_ROOT, "title-fidelity-v2-"));
    const generator = `
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

root = Path(${JSON.stringify(scratch)})
h, w = 80, 100
vertical = np.zeros((h, w, 3), dtype=np.uint8)
vertical[:, :50] = (255, 0, 0)
vertical[:, 50:] = (0, 255, 0)
Image.fromarray(vertical).save(root / "vertical.png")
horizontal = np.zeros((h, w, 3), dtype=np.uint8)
horizontal[:40] = (255, 0, 0)
horizontal[40:] = (0, 255, 0)
Image.fromarray(horizontal).save(root / "horizontal.png")
yy, xx = np.mgrid[:32, :32]
character = np.stack([
    (xx * 7 + yy * 3) % 256,
    (xx * 2 + yy * 11) % 256,
    (xx * 13 + yy * 5) % 256,
], axis=-1).astype(np.uint8)
Image.fromarray(character).save(root / "character.png")
Image.fromarray(np.full((32, 32, 3), 120, dtype=np.uint8)).save(root / "character-flat.png")

yy, xx = np.mgrid[:64, :64]
scene = np.stack([
    60 + xx * 2,
    80 + yy * 2,
    70 + ((xx + yy) % 7) * 3,
], axis=-1).clip(0, 255).astype(np.uint8)
Image.fromarray(scene).save(root / "scene-master.png")
Image.fromarray(scene).save(root / "scene-export.png")
rng = np.random.default_rng(20260814)
Image.fromarray(rng.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)).save(root / "scene-unrelated.png")
checker = ((xx + yy) % 2 * 255).astype(np.uint8)
Image.fromarray(np.repeat(checker[..., None], 3, axis=2)).save(root / "scene-checker.png")
noisy = np.clip(scene.astype(np.int16) + rng.integers(-45, 46, size=scene.shape), 0, 255).astype(np.uint8)
Image.fromarray(noisy).save(root / "scene-noisy.png")
Image.fromarray(scene).save(root / "paper-reference.png")
Image.fromarray(scene).save(root / "paper-reconstructed.png")

rgba = np.zeros((32, 32, 4), dtype=np.uint8)
rgba[7:25, 6:26, :3] = (66, 44, 28)
rgba[7:25, 6:26, 3] = 255
Image.fromarray(rgba).save(root / "alpha-good.png")
transparent = np.zeros((32, 32, 4), dtype=np.uint8)
Image.fromarray(transparent).save(root / "alpha-transparent.png")
shifted = np.roll(rgba, 10, axis=1)
Image.fromarray(shifted).save(root / "alpha-shifted.png")
`;
    execFileSync("python3", ["-c", generator], { cwd: ROOT, stdio: "pipe" });

    verticalPath = join(scratch, "vertical.png");
    horizontalPath = join(scratch, "horizontal.png");
    characterPath = join(scratch, "character.png");
    flatCharacterPath = join(scratch, "character-flat.png");
    registryPath = writeJson("registry.json", {
      viewports: [
        { id: "fixture", width: 100, height: 80, dpr: 1, payloadClass: "desktop" },
        { id: "fixture-dpr2", width: 100, height: 80, dpr: 2, payloadClass: "mobile" },
      ],
      goalMetrics: {
        algorithmVersion: "title-fidelity-v2",
        capture: {
          canonicalCharacterSize: { width: 32, height: 32 },
          requiredLayers: ["scene", "foreground", "parchment", "wordmark"],
        },
        gates: {
          captureDimensions: { viewports: "all" },
          sceneSeamGradient: { max: 4, viewports: "all" },
          titleInkOccupancy: { min: 0, max: 100, viewports: ["fixture", "fixture-dpr2"] },
          bottomLeftDarkShare: { min: 0, max: 100, viewports: ["fixture", "fixture-dpr2"] },
          characterEvidence: { viewports: "all" },
          characterDetailVariance: { min: 1, max: 5000, viewports: "all" },
          globalEdgeDensity: { min: 0, max: 100, viewports: "all" },
          layerManifest: {
            viewports: "all",
            forbidCss: true,
            forbidInline: true,
            minimumNaturalArea: 1024,
          },
          payloadBytes: { desktopMax: 1000, mobileMax: 500 },
          noUpscale: { maxPhysicalScale: 1, viewports: "all" },
          assetContracts: {
            sceneRetention: {
              required: { "scene-main": [64, 64] },
              similarityMin: 0.9,
              detailRatioMin: 0.9,
              detailRatioMax: 1.1,
              varianceMin: 1,
              varianceMax: 5000,
            },
            parchmentRetention: {
              required: { "paper-main": [64, 64] },
              similarityMin: 0.9,
              energyRatioMin: 0.8,
              energyRatioMax: 1.2,
              sampleMin: 0.8,
              sampleMax: 1.2,
              energyMax: 40,
            },
            alphaEdges: {
              required: {
                scene: [32, 32],
                foreground: [32, 32],
                parchment: [32, 32],
                wordmark: [32, 32],
              },
              transitionPxMax: 1,
              fringePxMax: 1,
              coverageMin: 0.1,
              coverageMax: 0.9,
              opaqueMin: 0.05,
              transparentMin: 0.05,
              largestComponentMin: 0.1,
              similarityMin: 0.9,
              backgrounds: ["#000000", "#ffffff", "parchment"],
            },
          },
        },
      },
    });

    const layers = ["scene", "foreground", "parchment", "wordmark"].map(
      (layerId, index) => ({
        layerId,
        sourceKind: "img",
        currentSrc: `http://example.test/${layerId}.webp`,
        naturalWidth: 200,
        naturalHeight: 160,
        renderedWidth: 50,
        renderedHeight: 40,
        physicalWidth: 50,
        physicalHeight: 40,
        titleCritical: true,
        complete: true,
        index,
      }),
    );
    const resources = {
      entries: layers.map((layer) => ({
        url: layer.currentSrc,
        transferSize: 100,
        encodedBodySize: 80,
        decodedBodySize: 200,
        initiatorType: "img",
      })),
    };
    const metrics = {
      viewport: { id: "fixture", width: 100, height: 80, dpr: 1 },
      capture: { pixelWidth: 100, pixelHeight: 80 },
      layers,
    };
    validContracts = {
      sceneRetention: [
        {
          id: "scene-main",
          master: join(scratch, "scene-master.png"),
          export: join(scratch, "scene-export.png"),
        },
      ],
      parchmentRetention: [
        {
          id: "paper-main",
          reference: join(scratch, "paper-reference.png"),
          reconstructed: join(scratch, "paper-reconstructed.png"),
          samples: [
            {
              id: "full",
              referenceRect: [0, 0, 64, 64],
              reconstructedRect: [0, 0, 64, 64],
            },
          ],
        },
      ],
      alphaEdges: ["scene", "foreground", "parchment", "wordmark"].map((id) => ({
        id,
        source: join(scratch, "alpha-good.png"),
        image: join(scratch, "alpha-good.png"),
        parchment: "#ecdcc7",
      })),
      captureContracts: [
        {
          viewport: "fixture",
          resources: writeJson("resources.json", resources),
          metrics: writeJson("metrics.json", metrics),
        },
      ],
    };
  }, 30_000);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("bruger eksplicit kvantiseret Rec.709 og måler kolonner normal på den lodrette join", () => {
    const correct = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-correct.json", geometry()),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);
    const shifted = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-shifted.json", geometry(100, 80, 30)),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);
    const wrongAxis = run([
      "--image", horizontalPath,
      "--geometry", writeJson("geometry-horizontal.json", geometry()),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);

    expect(correct.status, correct.stderr).toBe(0);
    expect(correct.json.algorithmVersion).toBe("title-fidelity-v2");
    expect(correct.json.metrics.sceneSeamGradient).toBe(128);
    expect(shifted.json.metrics.sceneSeamGradient).toBe(0);
    expect(wrongAxis.json.metrics.sceneSeamGradient).toBe(0);
    expect(correct.json.raw.luma).toBe("Rec.709 rounded uint8");
    expect(correct.json.raw.seam.axis).toBe("vertical");
  }, 30_000);

  it("validerer screenshotets fysiske dimensioner som viewport×DPR", () => {
    const wrong = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-wrong-size.json", geometry(99, 80)),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
      "--fail-on-gate",
    ]);
    expect(wrong.status).toBe(1);
    expect(wrong.json.failing).toContain("captureDimensions");

    const dprImage = join(scratch, "dpr2.png");
    execFileSync("python3", [
      "-c",
      `from PIL import Image; Image.open(${JSON.stringify(verticalPath)}).resize((200,160)).save(${JSON.stringify(dprImage)})`,
    ]);
    const correct = run([
      "--image", dprImage,
      "--geometry", writeJson("geometry-dpr2.json", {
        ...geometry(200, 160, 100),
        seam: {
          axis: "vertical",
          kind: "scene-extension",
          physicalX: 100,
          physicalY: 0,
          physicalHeight: 160,
        },
      }),
      "--viewport", "fixture-dpr2",
      "--registry", registryPath,
      "--json",
    ]);
    expect(correct.json.gates.captureDimensions.pass).toBe(true);
  });

  it("måler kun det asset-ankrede Karl-crop i kanonisk størrelse og afviser UI-overlap", () => {
    const detailed = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-character.json", geometry()),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);
    const flat = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-character-flat.json", geometry(100, 80, 50, flatCharacterPath)),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);
    const overlap = run([
      "--image", verticalPath,
      "--geometry", writeJson("geometry-character-overlap.json", geometry(100, 80, 50, characterPath, 1)),
      "--viewport", "fixture",
      "--registry", registryPath,
      "--json",
    ]);
    expect(detailed.json.metrics.characterDetailVariance).toBeGreaterThan(
      flat.json.metrics.characterDetailVariance,
    );
    expect(detailed.json.raw.character.measurementSource).toBe("asset");
    expect(detailed.json.raw.character.canonicalSize).toEqual([32, 32]);
    expect(overlap.json.failing).toContain("characterEvidence");
  });

  it("kræver præcis scene/foreground/parchment/wordmark med reelle bytes og mål", () => {
    const valid = run([
      "--contracts", writeJson("contracts-valid.json", validContracts),
      "--registry", registryPath,
      "--json",
    ]);
    expect(valid.json.captureContracts[0].layerManifest.pass).toBe(true);
    expect(valid.json.captureContracts[0].payloadBytes.pass).toBe(true);
    expect(valid.json.captureContracts[0].noUpscale.pass).toBe(true);

    const base = JSON.parse(JSON.stringify(validContracts));
    const metricsPath = base.captureContracts[0].metrics;
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    metrics.layers = ["scene", "foreground", "parchment", "wordmark"].map(
      (layerId) => ({
        layerId,
        sourceKind: "img",
        currentSrc: "http://example.test/one.gif",
        naturalWidth: 1,
        naturalHeight: 1,
        renderedWidth: 1,
        renderedHeight: 1,
        physicalWidth: 1,
        physicalHeight: 1,
        complete: true,
      }),
    );
    base.captureContracts[0].metrics = writeJson("metrics-harmless.json", metrics);
    base.captureContracts[0].resources = writeJson("resources-harmless.json", {
      entries: [{
        url: "http://example.test/one.gif",
        transferSize: 43,
        encodedBodySize: 20,
        decodedBodySize: 4,
        initiatorType: "img",
      }],
    });
    const harmless = run([
      "--contracts", writeJson("contracts-harmless.json", base),
      "--registry", registryPath,
      "--json",
    ]);
    expect(harmless.json.captureContracts[0].layerManifest.pass).toBe(false);
    expect(harmless.json.captureContracts[0].noUpscale.pass).toBe(false);
  });

  it("afviser zero-byte, CSS- og data-URI-lag", () => {
    const make = (name: string, mutate: (metrics: any, resources: any) => void) => {
      const value = JSON.parse(JSON.stringify(validContracts));
      const metrics = JSON.parse(readFileSync(value.captureContracts[0].metrics, "utf8"));
      const resources = JSON.parse(readFileSync(value.captureContracts[0].resources, "utf8"));
      mutate(metrics, resources);
      value.captureContracts[0].metrics = writeJson(`${name}-metrics.json`, metrics);
      value.captureContracts[0].resources = writeJson(`${name}-resources.json`, resources);
      return run([
        "--contracts", writeJson(`${name}-contracts.json`, value),
        "--registry", registryPath,
        "--json",
      ]).json.captureContracts[0];
    };

    const zero = make("zero", (_metrics, resources) => {
      resources.entries[0].transferSize = 0;
      resources.entries[0].encodedBodySize = 0;
    });
    const css = make("css", (metrics) => {
      metrics.layers[0].sourceKind = "css-background";
    });
    const inline = make("inline", (metrics) => {
      metrics.layers[0].currentSrc = "data:image/png;base64,AAAA";
    });
    expect(zero.payloadBytes.pass).toBe(false);
    expect(css.layerManifest.pass).toBe(false);
    expect(inline.layerManifest.pass).toBe(false);
  });

  it("failer lukket på tomme, transparente, uvedkommende, checkerboard- og overskarpe assetkontrakter", () => {
    const empty = run([
      "--contracts", writeJson("contracts-empty.json", {}),
      "--registry", registryPath,
      "--json",
      "--fail-on-gate",
    ]);
    expect(empty.status).toBe(1);
    expect(empty.json.failing).toEqual(expect.arrayContaining([
      "scene-main/sceneDetailRetention",
      "paper-main/parchmentBlankRetention",
      "scene/alphaEdge",
      "foreground/alphaEdge",
      "parchment/alphaEdge",
      "wordmark/alphaEdge",
    ]));

    const mutate = (name: string, fn: (value: any) => void) => {
      const value = JSON.parse(JSON.stringify(validContracts));
      fn(value);
      return run([
        "--contracts", writeJson(`${name}.json`, value),
        "--registry", registryPath,
        "--json",
      ]).json;
    };
    const transparent = mutate("contracts-transparent", (value) => {
      value.alphaEdges[0].image = join(scratch, "alpha-transparent.png");
    });
    const unrelated = mutate("contracts-unrelated", (value) => {
      value.sceneRetention[0].export = join(scratch, "scene-unrelated.png");
    });
    const checker = mutate("contracts-checker", (value) => {
      value.sceneRetention[0].master = join(scratch, "scene-checker.png");
      value.sceneRetention[0].export = join(scratch, "scene-checker.png");
    });
    const noisy = mutate("contracts-noisy", (value) => {
      value.sceneRetention[0].export = join(scratch, "scene-noisy.png");
    });
    const shifted = mutate("contracts-alpha-shifted", (value) => {
      value.alphaEdges[0].image = join(scratch, "alpha-shifted.png");
    });
    const unknown = mutate("contracts-unknown-id", (value) => {
      value.sceneRetention.push({
        ...value.sceneRetention[0],
        id: "scene-surprise",
      });
    });
    const duplicate = mutate("contracts-duplicate-id", (value) => {
      value.alphaEdges.push({ ...value.alphaEdges[0] });
    });
    expect(transparent.failing).toContain("scene/alphaEdge");
    expect(unrelated.failing).toContain("scene-main/sceneDetailRetention");
    expect(checker.failing).toContain("scene-main/sceneDetailRetention");
    expect(noisy.failing).toContain("scene-main/sceneDetailRetention");
    expect(shifted.failing).toContain("scene/alphaEdge");
    expect(unknown.failing).toContain("assetContracts/schema");
    expect(duplicate.failing).toContain("assetContracts/schema");
  }, 30_000);

  it("består den kanoniske reference med v2-provenance uden maskinlokale fixtures", () => {
    const result = run([
      "--image", REFERENCE,
      "--viewport", "target-native",
      "--json",
      "--fail-on-gate",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.algorithmVersion).toBe("title-fidelity-v2");
    expect(result.json.source.sha256).toBe(
      "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850",
    );
    expect(result.json.metrics).toMatchObject({
      captureDimensions: 1,
      sceneSeamGradient: 1.15,
      titleInkOccupancy: 27.30138713745271,
      bottomLeftDarkShare: 41.24500864175458,
      characterEvidence: 1,
      characterDetailVariance: 484.75304054892945,
      globalEdgeDensity: 6.8085033356384494,
    });
    expect(result.json.failing).toEqual([]);
  }, 30_000);
});
