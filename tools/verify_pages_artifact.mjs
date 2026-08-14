#!/usr/bin/env node
/**
 * Verificerer det færdige GitHub Pages-artifact uden en browser.
 *
 * Kontrollen binder HTML, entry-bundle og den deterministiske buildkontrakt
 * sammen for både root og /playtest/improvisation/. Dermed fejler manglende,
 * stale eller krydslinkede outputs før upload.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_PATH = "playtest/improvisation";
const ROOT_URL = "https://youex.github.io/ascent-of-karl/";
const PREVIEW_URL = `${ROOT_URL}playtest/improvisation/`;
const PREVIEW_MARKER =
  '<meta name="playtest-build" content="improvisation-offline-non-production">';
const ROBOTS_MARKER = '<meta name="robots" content="noindex,nofollow">';
const FEATURE_MARKER = 'dataset.improviseEnabled="true"';

function fail(message) {
  throw new Error(`Pages-artifact: ${message}`);
}

function readRequired(path, label) {
  if (!existsSync(path)) fail(`${label} mangler: ${path}`);
  return readFileSync(path, "utf8");
}

function contractAt(dir, expected) {
  const path = resolve(dir, "pages-build.json");
  let contract;
  try {
    contract = JSON.parse(readRequired(path, `${expected} buildkontrakt`));
  } catch (error) {
    fail(
      `${expected} buildkontrakt kan ikke læses: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    contract.schema !== 1 ||
    contract.variant !== expected ||
    typeof contract.entry !== "string"
  ) {
    fail(`${expected} buildkontrakt er stale eller ugyldig`);
  }
  const shouldEnable = expected === "improvisation-playtest";
  const expectedUrl = shouldEnable ? PREVIEW_URL : ROOT_URL;
  if (
    contract.publicUrl !== expectedUrl ||
    contract.improvisationEnabled !== shouldEnable ||
    contract.improviseUrl !== "" ||
    contract.narratorUrl !== ""
  ) {
    fail(`${expected} har en ugyldig feature-/Worker-kontrakt`);
  }
  return contract;
}

function localReferences(html) {
  return Array.from(
    html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi),
    (match) => match[1],
  ).filter(
    (reference) =>
      !/^(?:[a-z]+:|\/\/|#)/i.test(reference) &&
      !reference.startsWith("data:"),
  );
}

function moduleEntry(html, label) {
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const source = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (source) return source;
  }
  fail(`${label} mangler et module-entry i index.html`);
}

function normalizedReference(reference) {
  return decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, "");
}

function inspectVariant(root, relativeDir, expectedVariant) {
  const dir = resolve(root, relativeDir);
  const htmlPath = resolve(dir, "index.html");
  const html = readRequired(htmlPath, `${expectedVariant} index.html`);
  const contract = contractAt(dir, expectedVariant);

  for (const reference of localReferences(html)) {
    const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    const target = resolve(dir, clean);
    const inside = target === dir || target.startsWith(`${dir}${sep}`);
    if (!inside) {
      fail(`${expectedVariant} har et krydslink uden for sin outputmappe: ${reference}`);
    }
    if (!existsSync(target)) {
      fail(`${expectedVariant} reference mangler: ${reference}`);
    }
  }

  const entryReference = moduleEntry(html, expectedVariant);
  const entry = normalizedReference(entryReference);
  if (entry !== contract.entry) {
    fail(
      `${expectedVariant} entry er stale: index.html=${entry}, kontrakt=${contract.entry}`,
    );
  }
  const entryPath = resolve(dir, entry);
  if (!entryPath.startsWith(`${dir}${sep}`) || !existsSync(entryPath)) {
    fail(`${expectedVariant} entry mangler eller krydslinker: ${entry}`);
  }
  const bundle = readRequired(entryPath, `${expectedVariant} entry`);
  const enabled = bundle.includes(FEATURE_MARKER);
  if (enabled !== contract.improvisationEnabled) {
    fail(`${expectedVariant} bundle matcher ikke feature-kontrakten`);
  }

  return { dir, html, contract, entry, entryPath, bundle };
}

function textFiles(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...textFiles(path));
    } else if (/\.(?:css|html|js|json|webmanifest|txt)$/i.test(name)) {
      result.push(path);
    }
  }
  return result;
}

/**
 * @param {{
 *   root?: string;
 *   forbiddenStrings?: string[];
 *   log?: (message: string) => void;
 * }} options
 */
export function verifyPagesArtifact({
  root = resolve(REPO_ROOT, "dist"),
  forbiddenStrings = [],
  log = console.log,
} = {}) {
  const absoluteRoot = resolve(root);
  const production = inspectVariant(
    absoluteRoot,
    ".",
    "production-root",
  );
  const preview = inspectVariant(
    absoluteRoot,
    PREVIEW_PATH,
    "improvisation-playtest",
  );

  if (
    production.html.includes(PREVIEW_MARKER) ||
    production.html.includes(ROBOTS_MARKER)
  ) {
    fail("production-root er fejlagtigt mærket som playtest/noindex");
  }
  if (
    !preview.html.includes(PREVIEW_MARKER) ||
    !preview.html.includes(ROBOTS_MARKER)
  ) {
    fail("preview mangler non-production playtest/noindex-metadata");
  }
  if (
    production.entry === preview.entry ||
    production.bundle === preview.bundle
  ) {
    fail("root og preview har samme stale entry-bundle");
  }

  const forbidden = [...new Set(forbiddenStrings.filter(Boolean))];
  if (forbidden.length > 0) {
    for (const path of textFiles(absoluteRoot)) {
      const text = readFileSync(path, "utf8");
      const leaked = forbidden.find((value) => text.includes(value));
      if (leaked) {
        fail(
          `forbudt Worker-/ambient-værdi fundet i ${relative(absoluteRoot, path)}`,
        );
      }
    }
  }

  log(`root: ${production.entry} (improvisation off)`);
  log(`preview: ${preview.entry} (improvisation on, offline)`);
  log("✅ Pages-artifact: lokale assets, build modes og metadata er konsistente.");
  return {
    root: { entry: production.entry },
    preview: { entry: preview.entry },
  };
}

function cliRoot(argv) {
  const at = argv.indexOf("--dir");
  if (at === -1) return resolve(REPO_ROOT, "dist");
  const value = argv[at + 1];
  if (!value || value.startsWith("-")) {
    fail("brug --dir <artifactmappe>");
  }
  return resolve(REPO_ROOT, value);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    verifyPagesArtifact({
      root: cliRoot(process.argv.slice(2)),
      forbiddenStrings: [
        process.env.VITE_IMPROVISE_URL ?? "",
        process.env.VITE_NARRATOR_URL ?? "",
      ],
    });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
