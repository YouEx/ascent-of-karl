import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

function runPython(source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawn("python3", ["-c", source], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

describe("Python-validatorens par-kontrakt", () => {
  it("matcher motorens reachability for conditional-only og blandede opskrifter", async () => {
    const result = await runPython(`
import json
from tools.validate import _baked_lookup_reachable

conditional = {"pair": ["a", "b"], "result": "c", "requiresFlags": ["open"]}
unconditional = {"pair": ["a", "b"], "result": "d"}
print(json.dumps({
  "conditional_nonlocked": _baked_lookup_reachable("plausible", [conditional]),
  "conditional_locked": _baked_lookup_reachable("locked", [conditional]),
  "mixed_locked": _baked_lookup_reachable("locked", [conditional, unconditional]),
}))
`);

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      conditional_nonlocked: false,
      conditional_locked: true,
      mixed_locked: false,
    });
  });

  it("tillader {partner} i en near-miss, fordi værdien kommer fra aktuel evidence", async () => {
    const result = await runPython(`
import json
from tools.check_pairs import check_pairs_data, load_jobs, load_names

data = {"pairs": [{
  "key": "hjul+spyd",
  "verdict": "near-miss",
  "variants": [
    "The wheel met the spear. The {right} belongs with the {partner}, elsewhere.",
    "Karl compared the wheel and the spear. The {right} has plans with the {partner}.",
  ],
}]}
print(json.dumps(check_pairs_data(data, jobs=load_jobs(), names=load_names())))
`);

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });
});
