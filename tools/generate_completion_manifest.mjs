#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const COMPLETION_MANIFEST_PATH = "content/completion-manifest.json";

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));
}

function sourceRevision(sources) {
  const hash = createHash("sha256");
  for (const source of sources) {
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(path.join(ROOT, source), "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export function completionManifest() {
  const sources = [
    "content/elements.json",
    "content/branches.json",
    "content/endings.json",
  ];
  const elements = readJson(sources[0]);
  const branches = readJson(sources[1]);
  const endings = readJson(sources[2]);
  return {
    schemaVersion: 1,
    contentRevision: sourceRevision(sources),
    discoveries: elements
      .filter((element) => !element.base)
      .map((element) => element.id)
      .sort(),
    branches: branches
      .filter((branch) => branch.importance === "major")
      .map((branch) => branch.id)
      .sort(),
    endings: endings.map((ending) => ending.id).sort(),
  };
}

export function completionManifestText() {
  return `${JSON.stringify(completionManifest(), null, 2)}\n`;
}

const expected = completionManifestText();
const output = path.join(ROOT, COMPLETION_MANIFEST_PATH);
if (process.argv.includes("--check")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== expected) {
    console.error(
      `${COMPLETION_MANIFEST_PATH} is stale; run npm run completion:generate`,
    );
    process.exitCode = 1;
  } else {
    console.log("Completion manifest is current.");
  }
} else {
  writeFileSync(output, expected, "utf8");
  const manifest = completionManifest();
  console.log(
    `Wrote ${COMPLETION_MANIFEST_PATH}: ` +
      `${manifest.discoveries.length} discoveries, ` +
      `${manifest.branches.length} branches, ${manifest.endings.length} endings.`,
  );
}
