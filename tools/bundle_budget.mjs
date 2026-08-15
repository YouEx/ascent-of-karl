#!/usr/bin/env node
/**
 * TEST-010: første indlæsning vokser ikke.
 *
 * Validatoren måler de rå, dovent hentede par-replikker. Denne kontrol måler
 * det byggede hovedbundt og beviser samtidig, at hver bagt akt fortsat ligger
 * i sit eget lazy chunk. Funktionen er genbrugelig, så Pages-buildet kan
 * kontrollere både production-root og den indlejrede playtest-preview.
 *
 * Kør:
 *   node tools/bundle_budget.mjs
 *   node tools/bundle_budget.mjs --dir dist/playtest/improvisation
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Gzip-loft for hovedbundtet. Se den historiske baseline i git.
 *
 * Hævet fra 110 til 111 KB da titelskærmens illustrationer gik fra bitmap til
 * SVG (2026-08-14). Regnskabet, så hævelsen kan efterprøves — tallene er målt
 * med `npm run bundle-budget` og `git cat-file -s` på det slettede blob:
 *
 *   hovedbundt   112.200 → 113.029 B gzip   (+829 B)
 *   welcome-figure.webp                      (−2.368 B)
 *   ---------------------------------------------------
 *   første indlæsning                        −1.539 B
 *
 * welcome-figure.webp var et 69x61 bitmap-udklip, der blev hentet EAGERLY som
 * `background-image` på titelskærmen. Det er nu tegnet i icons.ts og hentes
 * ikke længere. Loftet måler kun JS-chunken, så den flytning ser ud som vækst,
 * selv om det TEST-010 er sat til at beskytte — "første indlæsning vokser
 * ikke" — beviseligt faldt. Loftet flytter derfor med kunsten, én gang.
 *
 * Loftet må IKKE sænkes tilbage til 110 KB: 110 KB = 112.640 B, og bundtet har
 * ikke været under det tal siden SVG-flytningen (målt 113.041 B ved 4423ea9 og
 * 113.029 B nu). Et review har foreslået sænkningen ud fra 111.300 B — det tal
 * kan ikke genskabes med en ren `vite build` på nogen af de to commits.
 *
 * Reglen for næste gang: loftet må kun hæves sammen med et regnskab som
 * ovenstående, hvor den samlede første indlæsning falder. Vokser den, er
 * svaret at gøre ændringen billigere — ikke at flytte loftet.
 */
export const MAIN_BUNDLE_GZIP_BUDGET = 111 * 1024;

/**
 * @param {{
 *   root?: string;
 *   outDir?: string;
 *   log?: (message: string) => void;
 *   budget?: number;
 * }} options
 */
export function checkBundleBudget({
  root = ROOT,
  outDir = "dist",
  log = console.log,
  budget = MAIN_BUNDLE_GZIP_BUDGET,
} = {}) {
  const absoluteOutDir = isAbsolute(outDir) ? outDir : resolve(root, outDir);
  const assets = resolve(absoluteOutDir, "assets");
  const failures = [];

  if (!existsSync(assets)) {
    throw new Error(
      `${outDir}/assets findes ikke — byg outputtet før bundtbudgettet køres.`,
    );
  }

  const assetFiles = readdirSync(assets);
  const mainCandidates = assetFiles.filter((file) =>
    /^index-.*\.js$/.test(file),
  );
  let main;

  if (mainCandidates.length !== 1) {
    failures.push(
      `forventede præcis ét hovedbundt "index-*.js" i ${outDir}/assets, ` +
        `fandt ${mainCandidates.length}: ${mainCandidates.join(", ") || "(ingen)"}`,
    );
  } else {
    const file = mainCandidates[0];
    const raw = readFileSync(resolve(assets, file));
    const gzip = gzipSync(raw, { level: 9 });
    main = {
      file,
      rawBytes: raw.length,
      gzipBytes: gzip.length,
      budgetBytes: budget,
    };
    const rawKb = (raw.length / 1024).toFixed(1);
    const gzipKb = (gzip.length / 1024).toFixed(1);
    const budgetKb = (budget / 1024).toFixed(0);
    log(
      `${outDir}: hovedbundt ${file}: ${rawKb} KB råt, ${gzipKb} KB gzip ` +
        `(loft ${budgetKb} KB)`,
    );
    if (gzip.length > budget) {
      failures.push(
        `${outDir}/${file}: ${gzipKb} KB gzip — over budgettet på ` +
          `${budgetKb} KB for første indlæsning.`,
      );
    }
  }

  const narratorDir = resolve(root, "content/narrator");
  const bakedActFiles = readdirSync(narratorDir).filter((file) =>
    /^pairs-act-\d+\.json$/.test(file),
  );
  const lazyChunks = [];
  for (const file of bakedActFiles) {
    const act = file.match(/^pairs-act-(\d+)\.json$/)?.[1];
    if (!act) continue;
    const pattern = new RegExp(`^pairs-act-${act}-.*\\.js$`);
    const chunk = assetFiles.find((asset) => pattern.test(asset));
    if (!chunk) {
      failures.push(
        `content/narrator/${file} findes, men intet separat ` +
          `"pairs-act-${act}-*.js"-chunk ligger i ${outDir}/assets.`,
      );
      continue;
    }
    lazyChunks.push(chunk);
    log(`${outDir}: akt ${act} er lazy-loadet i ${chunk}.`);
  }

  if (failures.length > 0) {
    throw new Error(`Bundtbudget FEJLEDE:\n- ${failures.join("\n- ")}`);
  }

  log(`✅ Bundtbudget OK: ${outDir}`);
  return { outDir, main, lazyChunks };
}

function parseOutDir(argv) {
  const at = argv.indexOf("--dir");
  if (at === -1) return "dist";
  const value = argv[at + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("Brug: node tools/bundle_budget.mjs --dir <outputmappe>");
  }
  return value;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    checkBundleBudget({ outDir: parseOutDir(process.argv.slice(2)) });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
