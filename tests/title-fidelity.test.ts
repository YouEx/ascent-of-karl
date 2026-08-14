import { describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { exitCodeForResult, resolveSafeOutputPath, runTitleFidelity } from "../tools/judge/title-fidelity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCRATCH_ROOT = join(ROOT, ".judge", "test-scratch");

describe("title-fidelity.mjs — sikker orkestrering", () => {
  it("afviser destruktive --out-stier før oprydning eller processtart", async () => {
    const outside = mkdtempSync(join(dirname(ROOT), "fidelity-outside-"));
    const sentinel = join(outside, "BEVAR-MIG");
    writeFileSync(sentinel, "urørt");
    const symlink = join(ROOT, ".judge", "fidelity-symlink-escape");
    mkdirSync(join(ROOT, ".judge"), { recursive: true });
    symlinkSync(outside, symlink, "dir");
    const runProcessFn = vi.fn();
    const home =
      (process as unknown as { env?: Record<string, string | undefined> }).env
        ?.HOME ?? dirname(dirname(ROOT));

    try {
      for (const unsafe of [
        ROOT,
        dirname(ROOT),
        home,
        outside,
        join(ROOT, ".judge"),
        join(ROOT, ".judge", "x"),
        join(ROOT, ".judge", "..", "escape"),
        join(symlink, "nested-run"),
      ]) {
        expect(() => resolveSafeOutputPath(unsafe), unsafe).toThrow(
          /sikker|dedikeret|symlink|\.judge/i,
        );
        await expect(
          runTitleFidelity({ outDir: unsafe, runProcessFn }),
          unsafe,
        ).rejects.toThrow();
      }
      expect(readFileSync(sentinel, "utf8")).toBe("urørt");
      expect(runProcessFn).not.toHaveBeenCalled();
    } finally {
      rmSync(symlink, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepterer kun en navngivet efterkommer under repoets .judge", () => {
    const safe = resolve(ROOT, ".judge", "fidelity-review-v2");
    expect(resolveSafeOutputPath(".judge/fidelity-review-v2")).toBe(safe);
    expect(resolveSafeOutputPath(safe)).toBe(safe);
  });

  it("rydder stale output og kører registered capture før Python-dommeren", async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    const outDir = mkdtempSync(join(SCRATCH_ROOT, "title-orchestrator-"));
    writeFileSync(join(outDir, "stale.txt"), "må ikke overleve");
    const resultFixture = {
      algorithmVersion: "title-fidelity-v2",
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

  it("er audit som standard og kræver eksplicit --require-green i fase D", () => {
    const red = { failing: ["target-native/sceneSeamGradient"] };
    expect(exitCodeForResult(red, { requireGreen: false })).toBe(0);
    expect(exitCodeForResult(red, { requireGreen: true })).toBe(1);
    expect(exitCodeForResult({ failing: [] }, { requireGreen: true })).toBe(0);
  });
});

describe("titel-fidelity — CI- og provenancekontrakt", () => {
  it("pinner miljøet og kører den portable suite uden at gøre Phase A-main rød", () => {
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
    const uxJob = workflow.slice(workflow.indexOf("  ux-audit:"));
    expect(workflow).not.toMatch(/^  title-fidelity:/m);
    expect(uxJob).toMatch(/actions\/setup-python@v5/);
    expect(uxJob).toMatch(/pip install -r tools\/judge\/requirements\.txt/);
    expect(uxJob).toMatch(/npx playwright install --with-deps chromium/);
    expect(uxJob).toMatch(
      /TITLE_FIDELITY_TESTS=1 npx vitest run tests\/title-fidelity-v2\.test\.ts tests\/judge-capture\.test\.ts/,
    );
    expect(uxJob).toMatch(/npm run judge:title-fidelity/);
    expect(uxJob).not.toMatch(
      /run: npm run judge:title-fidelity[^\n]*--require-green/,
    );
    expect(uxJob).not.toMatch(/continue-on-error|Fæld jobbet på titel-fidelity/);
  });

  it("har ingen maskinlokal current-fixture og dokumenterer stacked merge", () => {
    const sources = [
      "tests/title-fidelity-v2.test.ts",
      "tools/judge/title_fidelity.py",
      "docs/design/reference/registry.json",
    ].map((path) => readFileSync(join(ROOT, path), "utf8")).join("\n");
    const machineHome = new RegExp(["/", "Users", "/"].join(""));
    const sessionState = ["session", "state"].join("-");
    expect(sources).not.toMatch(machineHome);
    expect(sources).not.toContain(sessionState);
    expect(sources).not.toContain("currentCalibration");
    expect(
      readFileSync(join(ROOT, "docs/design/title-fidelity-ci.md"), "utf8"),
    ).toMatch(/stacked|Phase A|--require-green|Phase D/i);
  });
});
