#!/usr/bin/env node
/**
 * Verificerer det færdige GitHub Pages-artifact uden en browser.
 *
 * Vite skriver selv pages-build.json fra den resolverede compile-time env,
 * entry-hashen og Rollups komplette chunkgraf. Denne fil validerer kontrakten
 * mod de faktiske bytes og følger statiske/dynamiske imports, preload-assets,
 * import.meta-URL'er og CSS-URL'er inden for hver variants egen rod.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  dirname,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_PATH = "playtest/improvisation";
const ROOT_URL = "https://youex.github.io/ascent-of-karl/";
const PREVIEW_URL = `${ROOT_URL}playtest/improvisation/`;
const PREVIEW_MARKER =
  '<meta name="playtest-build" content="improvisation-offline-non-production">';
const ROBOTS_MARKER = '<meta name="robots" content="noindex,nofollow">';
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`Pages-artifact: ${message}`);
}

function readRequired(path, label) {
  if (!existsSync(path)) fail(`${label} mangler: ${path}`);
  return readFileSync(path, "utf8");
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  );
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
    contract.schema !== 2 ||
    contract.variant !== expected ||
    typeof contract.entry !== "string" ||
    !SHA256.test(contract.entrySha256 ?? "") ||
    !contract.env ||
    typeof contract.modules !== "object" ||
    contract.modules === null ||
    Array.isArray(contract.modules)
  ) {
    fail(`${expected} buildkontrakt er stale eller ugyldig`);
  }

  const shouldEnable = expected === "improvisation-playtest";
  const expectedUrl = shouldEnable ? PREVIEW_URL : ROOT_URL;
  if (
    contract.publicUrl !== expectedUrl ||
    contract.env.mode !== "production" ||
    contract.env.VITE_IMPROVISE_ENABLED !==
      (shouldEnable ? "true" : "false") ||
    contract.env.VITE_IMPROVISE_URL !== "" ||
    contract.env.VITE_NARRATOR_URL !== "" ||
    contract.env.VITE_GAME_API_URL !== "" ||
    contract.env.VITE_ONLINE_REQUIRED !== "false" ||
    contract.env.VITE_ONLINE_TARGET_READY !== "false"
  ) {
    fail(`${expected} har en ugyldig resolveret feature-/Worker-kontrakt`);
  }

  for (const [file, module] of Object.entries(contract.modules)) {
    if (
      !module ||
      typeof module !== "object" ||
      !SHA256.test(module.sha256 ?? "") ||
      !stringArray(module.imports) ||
      !stringArray(module.dynamicImports) ||
      !stringArray(module.preloads)
    ) {
      fail(`${expected} har ugyldig modulmetadata for ${file}`);
    }
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

function cleanReference(reference) {
  try {
    return decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  } catch {
    fail(`ugyldig URL-kodning i reference: ${reference}`);
  }
}

function normalizedHtmlReference(reference) {
  return cleanReference(reference).replace(/^\.\//, "");
}

function hasParentSegment(reference) {
  return cleanReference(reference)
    .replaceAll("\\", "/")
    .split("/")
    .includes("..");
}

function assertOutputName(reference, label) {
  const clean = cleanReference(reference).replaceAll("\\", "/");
  if (
    !clean ||
    clean.startsWith("/") ||
    /^[a-z]+:/i.test(clean) ||
    hasParentSegment(clean) ||
    posix.normalize(clean) !== clean
  ) {
    fail(`${label} har et ../-krydslink eller ugyldigt outputnavn: ${reference}`);
  }
  return clean;
}

function isInside(path, dir) {
  return path === dir || path.startsWith(`${dir}${sep}`);
}

function assertVariantTarget(dir, variant, target, reference, label) {
  if (!isInside(target, dir)) {
    fail(`${variant} har et ../-krydslink i ${label}: ${reference}`);
  }
  if (
    variant === "production-root" &&
    isInside(target, resolve(dir, PREVIEW_PATH))
  ) {
    fail(`${variant} krydslinker til preview i ${label}: ${reference}`);
  }
  if (!existsSync(target)) {
    fail(`${variant} reference mangler i ${label}: ${reference}`);
  }
}

function resolveModuleReference(dir, variant, moduleName, reference, label) {
  const clean = cleanReference(reference).replaceAll("\\", "/");
  if (hasParentSegment(clean)) {
    fail(`${variant} har et ../-krydslink i ${moduleName}: ${reference}`);
  }
  if (!clean.startsWith("./")) {
    fail(`${variant} har en ikke-relativ ${label} i ${moduleName}: ${reference}`);
  }
  const outputName = posix.normalize(
    posix.join(posix.dirname(moduleName), clean),
  );
  const target = resolve(dir, outputName);
  assertVariantTarget(dir, variant, target, reference, `${moduleName} ${label}`);
  return outputName;
}

function resolveRootReference(dir, variant, reference, label) {
  const outputName = assertOutputName(reference.replace(/^\.\//, ""), label);
  const target = resolve(dir, outputName);
  assertVariantTarget(dir, variant, target, reference, label);
  return outputName;
}

function scanModuleReferences(code) {
  const dynamicImports = Array.from(
    code.matchAll(/\bimport\s*\(\s*(["'])([^"'`]+)\1\s*\)/g),
    (match) => match[2],
  );
  const sideEffectImports = Array.from(
    code.matchAll(/\bimport\s*(["'])([^"']+)\1/g),
    (match) => match[2],
  );
  const fromImports = Array.from(
    code.matchAll(
      /\b(?:import|export)\s+(?!\()[^;"']{0,500}?\bfrom\s*(["'])([^"']+)\1/g,
    ),
    (match) => match[2],
  );
  const importMetaAssets = Array.from(
    code.matchAll(
      /new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g,
    ),
    (match) => match[2],
  );
  const preloadAssets = [];
  for (const match of code.matchAll(/\.f\s*=\s*\[([^\]]*)\]/g)) {
    preloadAssets.push(
      ...Array.from(
        match[1].matchAll(/(["'])([^"']+)\1/g),
        (literal) => literal[2],
      ),
    );
  }
  return {
    imports: [...new Set([...sideEffectImports, ...fromImports])],
    dynamicImports: [...new Set(dynamicImports)],
    importMetaAssets: [...new Set(importMetaAssets)],
    preloadAssets: [...new Set(preloadAssets)],
  };
}

function sameStrings(actual, expected) {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function verifyCssGraph(dir, variant, initialCss) {
  const pending = [...new Set(initialCss)];
  const seen = new Set();
  while (pending.length > 0) {
    const css = pending.pop();
    if (!css || seen.has(css)) continue;
    seen.add(css);
    const path = resolve(dir, css);
    assertVariantTarget(dir, variant, path, css, "CSS-graf");
    const source = readRequired(path, `${variant} CSS`);
    const references = [
      ...Array.from(
        source.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)'"]+))\s*\)/gi),
        (match) => match[2] ?? match[3],
      ),
      ...Array.from(
        source.matchAll(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1/gi),
        (match) => match[2],
      ),
    ].filter(
      (reference) =>
        reference &&
        !/^(?:data:|[a-z]+:|\/\/|#)/i.test(reference),
    );
    for (const reference of references) {
      const outputName = resolveModuleReference(
        dir,
        variant,
        css,
        reference,
        "CSS-reference",
      );
      if (outputName.endsWith(".css")) pending.push(outputName);
    }
  }
}

function verifyModuleGraph(dir, variant, contract) {
  const moduleNames = Object.keys(contract.modules).map((name) =>
    assertOutputName(name, `${variant} modul`),
  );
  if (!moduleNames.includes(contract.entry)) {
    fail(`${variant} entry findes ikke i den deklarerede modulgraph`);
  }

  const css = new Set();
  for (const moduleName of moduleNames) {
    const metadata = contract.modules[moduleName];
    const path = resolve(dir, moduleName);
    assertVariantTarget(dir, variant, path, moduleName, "modulgraph");
    const actualHash = fileSha256(path);
    if (actualHash !== metadata.sha256) {
      fail(`${variant} SHA256/hash mismatch for ${moduleName}`);
    }
    for (const dependency of [
      ...metadata.imports,
      ...metadata.dynamicImports,
      ...metadata.preloads,
    ]) {
      const outputName = resolveRootReference(
        dir,
        variant,
        dependency,
        `${moduleName} dependency`,
      );
      if (
        (metadata.imports.includes(dependency) ||
          metadata.dynamicImports.includes(dependency) ||
          outputName.endsWith(".js")) &&
        !contract.modules[outputName]
      ) {
        fail(`${variant} mangler lazy/import-modulmetadata for ${outputName}`);
      }
      if (outputName.endsWith(".css")) css.add(outputName);
    }

    const source = readRequired(path, `${variant} modul`);
    const scanned = scanModuleReferences(source);
    const actualImports = scanned.imports.map((reference) =>
      resolveModuleReference(
        dir,
        variant,
        moduleName,
        reference,
        "statisk import",
      ),
    );
    const actualDynamic = scanned.dynamicImports.map((reference) =>
      resolveModuleReference(
        dir,
        variant,
        moduleName,
        reference,
        "dynamisk import",
      ),
    );
    if (!sameStrings(actualImports, metadata.imports)) {
      fail(`${variant} statisk importgraf er stale for ${moduleName}`);
    }
    if (!sameStrings(actualDynamic, metadata.dynamicImports)) {
      fail(`${variant} dynamisk importgraf er stale for ${moduleName}`);
    }
    for (const reference of scanned.importMetaAssets) {
      resolveModuleReference(
        dir,
        variant,
        moduleName,
        reference.startsWith(".") ? reference : `./${reference}`,
        "import.meta-asset",
      );
    }
    for (const reference of scanned.preloadAssets) {
      const outputName = resolveRootReference(
        dir,
        variant,
        reference,
        `${moduleName} preload`,
      );
      if (outputName.endsWith(".css")) css.add(outputName);
    }
  }

  const reachable = new Set();
  const pending = [contract.entry];
  while (pending.length > 0) {
    const moduleName = pending.pop();
    if (!moduleName || reachable.has(moduleName)) continue;
    reachable.add(moduleName);
    const metadata = contract.modules[moduleName];
    if (!metadata) {
      fail(`${variant} modulgraph mangler ${moduleName}`);
    }
    for (const dependency of [
      ...metadata.imports,
      ...metadata.dynamicImports,
      ...metadata.preloads.filter((name) => name.endsWith(".js")),
    ]) {
      pending.push(dependency);
    }
  }
  const unreachable = moduleNames.filter((name) => !reachable.has(name));
  if (unreachable.length > 0) {
    fail(`${variant} har uopnåelige/stale chunks: ${unreachable.join(", ")}`);
  }

  const entryHash = fileSha256(resolve(dir, contract.entry));
  if (entryHash !== contract.entrySha256) {
    fail(`${variant} entry SHA256/hash matcher ikke buildkontrakten`);
  }
  verifyCssGraph(dir, variant, css);
  return { entryHash, css: [...css] };
}

function inspectVariant(root, relativeDir, expectedVariant) {
  const dir = resolve(root, relativeDir);
  const htmlPath = resolve(dir, "index.html");
  const html = readRequired(htmlPath, `${expectedVariant} index.html`);
  const contract = contractAt(dir, expectedVariant);
  const htmlCss = [];

  for (const reference of localReferences(html)) {
    const outputName = assertOutputName(
      normalizedHtmlReference(reference),
      `${expectedVariant} index.html`,
    );
    const target = resolve(dir, outputName);
    assertVariantTarget(
      dir,
      expectedVariant,
      target,
      reference,
      "index.html",
    );
    if (outputName.endsWith(".css")) htmlCss.push(outputName);
  }

  const entry = normalizedHtmlReference(moduleEntry(html, expectedVariant));
  if (entry !== contract.entry) {
    fail(
      `${expectedVariant} entry er stale: index.html=${entry}, kontrakt=${contract.entry}`,
    );
  }
  const graph = verifyModuleGraph(dir, expectedVariant, contract);
  verifyCssGraph(dir, expectedVariant, htmlCss);

  return { dir, html, contract, entry, entryHash: graph.entryHash };
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
  if (production.entryHash === preview.entryHash) {
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
  log("✅ Pages-artifact: env, hashes og hele modulgrafen er konsistente.");
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

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  try {
    verifyPagesArtifact({
      root: cliRoot(process.argv.slice(2)),
      forbiddenStrings: [
        process.env.VITE_IMPROVISE_URL ?? "",
        process.env.VITE_NARRATOR_URL ?? "",
        process.env.VITE_GAME_API_URL ?? "",
      ],
    });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
