import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(ROOT, "artifacts");
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MINIMUMS = {
  "run-01-desktop-seed-163": { width: 1440, height: 1000 },
  "run-02-mobile-seed-230": { width: 780, height: 1688 },
  "run-03-desktop-seed-432": { width: 1280, height: 900 },
};

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function sameMembers(first, second) {
  return (
    first.size === second.size &&
    [...first].every((entry) => second.has(entry))
  );
}

const errors = [];
const allFiles = await filesUnder(ROOT);
const artifactFiles = await filesUnder(ARTIFACTS);
const pngs = allFiles.filter((file) => file.toLowerCase().endsWith(".png"));
if (pngs.length) {
  errors.push(`PNG remains: ${pngs.map(relative).join(", ")}`);
}

for (const file of allFiles.filter((entry) =>
  /\.(?:json|md)$/i.test(entry)
)) {
  if ((await readFile(file, "utf8")).includes(".png")) {
    errors.push(`PNG reference remains in ${relative(file)}`);
  }
}

const totalBytes = (
  await Promise.all(allFiles.map(async (file) => (await stat(file)).size))
).reduce((sum, size) => sum + size, 0);
if (totalBytes > MAX_TOTAL_BYTES) {
  errors.push(
    `Evidence root is ${(totalBytes / 1024 / 1024).toFixed(2)} MB; limit is 12 MB`,
  );
}

const summary = JSON.parse(
  await readFile(path.join(ARTIFACTS, "summary.json"), "utf8"),
);
const summaryReferences = new Set();
for (const run of summary.runs ?? []) {
  const expectedMinimum = MINIMUMS[run.id];
  if (!expectedMinimum) errors.push(`Unknown run in summary: ${run.id}`);
  for (const screenshot of run.screenshots ?? []) {
    summaryReferences.add(screenshot);
    if (!screenshot.endsWith(".webp")) {
      errors.push(`Summary reference is not WebP: ${screenshot}`);
    }
  }
  const runLogPath = path.join(ARTIFACTS, run.id, "run-log.json");
  const runLog = JSON.parse(await readFile(runLogPath, "utf8"));
  const runReferences = new Set(runLog.screenshots ?? []);
  const expectedReferences = new Set(run.screenshots ?? []);
  if (!sameMembers(runReferences, expectedReferences)) {
    errors.push(`Summary/run-log screenshot mismatch for ${run.id}`);
  }
}

const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
const readmeReferences = new Set(
  [...readme.matchAll(/`(artifacts\/[^`]+\.webp)`/g)].map(
    (match) => match[1],
  ),
);
for (const screenshot of readmeReferences) {
  if (!summaryReferences.has(screenshot)) {
    errors.push(`README screenshot is absent from summary: ${screenshot}`);
  }
}

const webps = artifactFiles.filter((file) =>
  file.toLowerCase().endsWith(".webp")
);
const actualWebps = new Set(webps.map(relative));
if (!sameMembers(actualWebps, summaryReferences)) {
  for (const missing of [...summaryReferences].filter(
    (entry) => !actualWebps.has(entry),
  )) {
    errors.push(`Referenced screenshot missing: ${missing}`);
  }
  for (const extra of [...actualWebps].filter(
    (entry) => !summaryReferences.has(entry),
  )) {
    errors.push(`Unreferenced WebP: ${extra}`);
  }
}

try {
  const { stdout } = await execFileAsync("magick", ["-version"]);
  if (!/\bwebp\b/i.test(stdout)) {
    throw new Error("ImageMagick is installed without WebP support");
  }
} catch (error) {
  throw new Error(
    `ImageMagick is required for evidence verification: ${error.message}`,
  );
}

for (const file of webps) {
  const bytes = await readFile(file);
  const fileSize = bytes.byteLength;
  if (fileSize > MAX_FILE_BYTES) {
    errors.push(
      `${relative(file)} is ${(fileSize / 1024 / 1024).toFixed(2)} MB; per-file limit is 2 MB`,
    );
  }
  if (
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    errors.push(`${relative(file)} does not have WebP magic bytes`);
    continue;
  }
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (["EXIF", "ICCP", "XMP "].includes(chunk)) {
      errors.push(`${relative(file)} retains metadata chunk ${chunk.trim()}`);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  const { stdout } = await execFileAsync("magick", [
    "identify",
    "-format",
    "%m %w %h",
    file,
  ]);
  const [format, widthText, heightText] = stdout.trim().split(/\s+/);
  const width = Number(widthText);
  const height = Number(heightText);
  if (format !== "WEBP") errors.push(`${relative(file)} identifies as ${format}`);
  const runId = relative(file).split("/")[1];
  const minimum = MINIMUMS[runId];
  if (
    !minimum ||
    width < minimum.width ||
    height < minimum.height
  ) {
    errors.push(
      `${relative(file)} is ${width}x${height}; minimum is ` +
        `${minimum?.width ?? "?"}x${minimum?.height ?? "?"}`,
    );
  }
}

if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `✓ ${webps.length} referenced WebPs · ${(totalBytes / 1024 / 1024).toFixed(2)} MB total · no PNGs`,
);
