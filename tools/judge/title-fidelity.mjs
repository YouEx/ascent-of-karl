#!/usr/bin/env node
/**
 * Samlet titel-fidelity-kørsel: frisk produktionscapture ved alle registrerede
 * viewports efterfulgt af den pinnede Python-dommer.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessGroup } from "./process-group.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JUDGE_ROOT = join(ROOT, ".judge");

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function isInside(base, candidate) {
  const rel = relative(base, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function resolveSafeOutputPath(value = ".judge/title-fidelity") {
  const target = resolve(ROOT, value);
  if (!isInside(JUDGE_ROOT, target)) {
    throw new Error(`usikker --out: skal være en dedikeret efterkommer under ${JUDGE_ROOT}`);
  }

  const rel = relative(JUDGE_ROOT, target);
  const segments = rel.split(sep);
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || (segments.length === 1 && segments[0].length < 8)
  ) {
    throw new Error("usikker --out: brug en navngivet, dedikeret run-mappe under .judge");
  }

  if (existsSync(JUDGE_ROOT) && lstatSync(JUDGE_ROOT).isSymbolicLink()) {
    throw new Error("usikker .judge: symlink er ikke tilladt");
  }
  let current = JUDGE_ROOT;
  for (const segment of segments) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`usikker --out: symlink-komponent er ikke tilladt (${current})`);
    }
  }

  if (existsSync(JUDGE_ROOT)) {
    const realJudge = realpathSync(JUDGE_ROOT);
    let ancestor = target;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const realAncestor = realpathSync(ancestor);
    if (realAncestor !== realJudge && !isInside(realJudge, realAncestor)) {
      throw new Error("usikker --out: den eksisterende sti undslipper repoets .judge");
    }
  }
  return target;
}

export async function runTitleFidelity({
  outDir,
  runProcessFn = runProcessGroup,
} = {}) {
  const target = resolveSafeOutputPath(outDir);
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

export function exitCodeForResult(result, { requireGreen = false } = {}) {
  return requireGreen && result.failing.length ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/title-fidelity");
  const requireGreen = args.includes("--require-green");
  const result = await runTitleFidelity({ outDir });
  printResult(result, outDir);
  if (result.failing.length && !requireGreen) {
    console.log("audit-mode: røde mål er bevis i Phase A; brug --require-green efter Phase D");
  }
  process.exitCode = exitCodeForResult(result, { requireGreen });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
