#!/usr/bin/env node
/**
 * Samlet titel-fidelity-kørsel: frisk produktionscapture ved alle registrerede
 * viewports efterfulgt af den pinnede Python-dommer.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessGroup } from "./process-group.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runTitleFidelity({
  outDir,
  runProcessFn = runProcessGroup,
} = {}) {
  const target = resolve(ROOT, outDir ?? ".judge/title-fidelity");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });

  try {
    const capture = await runProcessFn(
      process.execPath,
      [
        "tools/judge/capture.mjs",
        "--screen",
        "title",
        "--viewports",
        "registered",
        "--out",
        target,
      ],
      { cwd: ROOT, timeoutMs: 240_000 },
    );
    if (capture.stdout.trim()) process.stdout.write(capture.stdout);
    if (capture.stderr.trim()) process.stderr.write(capture.stderr);

    const scored = await runProcessFn(
      "python3",
      [
        "tools/judge/title_fidelity.py",
        "--run",
        target,
        "--viewports",
        "registered",
        "--json",
      ],
      { cwd: ROOT, timeoutMs: 120_000 },
    );
    if (scored.stderr.trim()) process.stderr.write(scored.stderr);
    return JSON.parse(scored.stdout);
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function printResult(result, outDir) {
  for (const [viewportId, viewport] of Object.entries(result.viewports)) {
    const values = Object.entries(viewport.metrics)
      .map(([name, value]) => `${name}=${value.toFixed(6)}`)
      .join("  ");
    console.log(`${viewportId}  ${values}`);
  }
  console.log(
    result.failing.length
      ? `fejler: ${result.failing.join(", ")}`
      : "alle håndhævede gates består",
  );
  console.log(`→ ${outDir}/title-fidelity.json`);
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/title-fidelity");
  const result = await runTitleFidelity({ outDir });
  printResult(result, outDir);
  if (result.failing.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
