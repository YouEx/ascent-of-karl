#!/usr/bin/env node
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BUILD_ROOT = path.join(ROOT, ".graphify-build");
const LOG_PATH = path.join(BUILD_ROOT, "semantic-enrichment.log");
const MAX_TAIL_BYTES = 8000;

function tail(file) {
  let fd;
  try {
    const { size } = statSync(file);
    const length = Math.min(size, MAX_TAIL_BYTES);
    if (length === 0) return "";
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    if (length === size) return text;
    const firstLine = text.indexOf("\n");
    return firstLine === -1 ? text : text.slice(firstLine + 1);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

mkdirSync(BUILD_ROOT, { recursive: true });
const log = openSync(LOG_PATH, "w");
let result;
try {
  result = spawnSync(
    "graphify",
    [".", "--mode", "deep", "--directed", "--no-viz"],
    {
      cwd: ROOT,
      stdio: ["ignore", log, log],
      env: process.env,
    },
  );
} finally {
  closeSync(log);
}

if (result.error) {
  console.error(
    `Could not start graphify: ${result.error.message}\n` +
      "Install graphifyy or run semantic enrichment through the graphify skill.",
  );
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(
    `graphify exited ${result.status}; see ${path.relative(ROOT, LOG_PATH)}\n` +
      tail(LOG_PATH),
  );
  process.exitCode = 1;
} else {
  console.log(
    "Semantic enrichment written to graphify-out/. It is inferred evidence, " +
      "not product authority and not merged into the deterministic graph.",
  );
}
