import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { createVisualRunDir } from "../tools/judge/visual-regression.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

let cleanRoot: string | undefined;

afterEach(() => {
  if (cleanRoot) rmSync(cleanRoot, { recursive: true, force: true });
  cleanRoot = undefined;
});

describe("visual-regression — ren checkout", () => {
  it("opretter .judge før mkdtemp, når arbejdsroden ikke har mappen endnu", () => {
    cleanRoot = mkdtempSync(join(SCRATCH_ROOT, "clean-root-"));
    expect(existsSync(join(cleanRoot, ".judge"))).toBe(false);

    const runDir = createVisualRunDir(cleanRoot);

    expect(existsSync(join(cleanRoot, ".judge"))).toBe(true);
    expect(runDir.startsWith(join(cleanRoot, ".judge", "visual-test-"))).toBe(true);
    expect(existsSync(runDir)).toBe(true);
  });
});
