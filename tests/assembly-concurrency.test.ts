import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

function runPython(script: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [script], { cwd: ROOT });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

describe("fortæller-facit kan valideres samtidig", () => {
  it.each([
    "tools/voice/check_grammar_assembly.py",
    "tools/voice/check_pairs_assembly.py",
  ])("%s bruger ikke en delt scratch-fil", async (script) => {
    const results = await Promise.all(Array.from({ length: 4 }, () => runPython(script)));

    expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0]);
    expect(results.map((result) => result.stderr)).toEqual(["", "", "", ""]);
  }, 60_000);
});
