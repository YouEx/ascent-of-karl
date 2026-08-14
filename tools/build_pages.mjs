#!/usr/bin/env node
/**
 * Bygger ét GitHub Pages-artifact med to deterministiske varianter:
 *
 *   dist/                         production-root, improvisation off
 *   dist/playtest/improvisation/  unlisted offline playtest, on
 *
 * Root bygges altid først. Vites andet --emptyOutDir peger kun på den
 * indlejrede preview-mappe og kan derfor ikke slette root-outputtet.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkBundleBudget } from "./bundle_budget.mjs";
import { verifyPagesArtifact } from "./verify_pages_artifact.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_URL = "https://youex.github.io/ascent-of-karl/";
const PREVIEW_URL = `${ROOT_URL}playtest/improvisation/`;
const PLAYTEST_META = [
  '    <meta name="robots" content="noindex,nofollow">',
  '    <meta name="playtest-build" content="improvisation-offline-non-production">',
].join("\n");
const ROOT_OG_URL = `<meta property="og:url" content="${ROOT_URL}" />`;

function safeEnvironment(parent, enabled) {
  return {
    ...parent,
    NODE_ENV: "production",
    VITE_IMPROVISE_ENABLED: enabled ? "true" : "false",
    VITE_IMPROVISE_URL: "",
    VITE_NARRATOR_URL: "",
  };
}

export function createPagesBuildPlan(parentEnv = process.env) {
  return [
    {
      variant: "production-root",
      outDir: "dist",
      publicUrl: ROOT_URL,
      enabled: false,
      env: {
        ...safeEnvironment(parentEnv, false),
        KARL_PAGES_VARIANT: "production-root",
      },
    },
    {
      variant: "improvisation-playtest",
      outDir: "dist/playtest/improvisation",
      publicUrl: PREVIEW_URL,
      enabled: true,
      env: {
        ...safeEnvironment(parentEnv, true),
        KARL_PAGES_VARIANT: "improvisation-playtest",
      },
    },
  ];
}

function runViteBuild(step, root) {
  const vite = resolve(root, "node_modules/vite/bin/vite.js");
  return new Promise((resolveDone, reject) => {
    const child = spawn(
      process.execPath,
      [vite, "build", "--outDir", step.outDir, "--emptyOutDir"],
      {
        cwd: root,
        env: step.env,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveDone();
        return;
      }
      reject(
        new Error(
          `${step.variant} build fejlede (${signal ? `signal ${signal}` : `kode ${code}`})`,
        ),
      );
    });
  });
}

function markPreview(indexPath) {
  let html = readFileSync(indexPath, "utf8");
  if (!html.includes(ROOT_OG_URL) || !html.includes("  </head>")) {
    throw new Error("Preview-index mangler forventet root-metadata");
  }
  html = html
    .replace(ROOT_OG_URL, `<meta property="og:url" content="${PREVIEW_URL}" />`)
    .replace("  </head>", `${PLAYTEST_META}\n  </head>`);
  writeFileSync(indexPath, html);
}

export async function buildPages({
  root = ROOT,
  parentEnv = process.env,
  runner = runViteBuild,
  log = console.log,
} = {}) {
  const plan = createPagesBuildPlan(parentEnv);
  const forbiddenStrings = [
    parentEnv.VITE_IMPROVISE_URL ?? "",
    parentEnv.VITE_NARRATOR_URL ?? "",
  ].filter(Boolean);

  for (const step of plan) {
    log(`\nBygger ${step.variant} → ${step.outDir}`);
    await runner(step, root);
    if (step.enabled) {
      markPreview(resolve(root, step.outDir, "index.html"));
    }
    checkBundleBudget({ root, outDir: step.outDir, log });
  }

  return verifyPagesArtifact({
    root: resolve(root, "dist"),
    forbiddenStrings,
    log,
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  buildPages().catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
