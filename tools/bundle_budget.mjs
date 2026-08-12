#!/usr/bin/env node
/**
 * TEST-010, anden halvdel: første indlæsning vokser ikke.
 *
 * `tools/validate.py` vogter allerede CON-003's ≤ 60 KB gzip-loft for de
 * DOVENT hentede par-replikker (læser `content/narrator/pairs-act-*.json`
 * direkte — den fil har ikke adgang til `node_modules` i CI'ens
 * `validate-content`-job, se .github/workflows/ci.yml, og kan derfor aldrig
 * køre `vite build`). Det den IKKE fanger, er det modsatte fejlbillede: at
 * grammatikken, taksonomien eller noget helt tredje ved et uheld ender i
 * FØRSTE bundt i stedet for at blive lazy-loadet. Det kræver en rigtig build.
 *
 * Køres derfor herfra, som sidste skridt i `npm run build` (efter `vite
 * build`, se package.json) — ikke fra validate.py.
 *
 * To kontroller:
 *   1. Hovedbundtet (`dist/assets/index-*.js`) må ikke vokse ud over et
 *      loft. Baseline målt 2026-08-12: 303.528 bytes råt / 96.825 bytes
 *      gzip. Loftet er sat med rundt regnet 15 % luft — nok til almindelig
 *      vækst, stramt nok til at fange en pulje der ved en fejl blev importeret
 *      direkte i stedet for gennem `import()`. Ramler den: find hvad der
 *      voksede (`npx vite build` og læs chunk-rapporten), og flyt det bag
 *      en lazy-load, eller hæv loftet bevidst her — ligesom CON-003.
 *   2. Hver akt med bagte par-replikker (`content/narrator/pairs-act-*.json`)
 *      SKAL have sit eget separate chunk-navn i dist/. Findes chunket ikke,
 *      er filen smeltet sammen med hovedbundtet, og løftet i CON-003 er en
 *      løgn — det ville ikke stå i det gzip-tal validate.py måler, for det
 *      måler den rå indholdsfil, ikke den byggede chunk.
 *
 * Kør: node tools/bundle_budget.mjs (kræver `vite build` er kørt først)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = resolve(ROOT, "dist/assets");

/** Gzip-loft for hovedbundtet. Se baseline og begrundelse i filens hoved. */
const MAIN_BUNDLE_GZIP_BUDGET = 110 * 1024;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
}

if (!existsSync(ASSETS)) {
  fail(
    `dist/assets findes ikke — kør \`vite build\` (eller \`npm run build\`) før ${
      resolve(ROOT, "tools/bundle_budget.mjs").replace(ROOT + "/", "")
    }.`,
  );
  process.exit(1);
}

const assetFiles = readdirSync(ASSETS);

// --- Kontrol 1: hovedbundtets størrelse ---
const mainCandidates = assetFiles.filter((f) => /^index-.*\.js$/.test(f));
if (mainCandidates.length !== 1) {
  fail(
    `forventede præcis ét hovedbundt "index-*.js" i dist/assets, fandt ${mainCandidates.length}: ${mainCandidates.join(", ") || "(ingen)"}`,
  );
} else {
  const file = mainCandidates[0];
  const raw = readFileSync(resolve(ASSETS, file));
  const gzip = gzipSync(raw, { level: 9 });
  const rawKb = (raw.length / 1024).toFixed(1);
  const gzipKb = (gzip.length / 1024).toFixed(1);
  const budgetKb = (MAIN_BUNDLE_GZIP_BUDGET / 1024).toFixed(0);
  console.log(`hovedbundt ${file}: ${rawKb} KB råt, ${gzipKb} KB gzip (loft ${budgetKb} KB)`);
  if (gzip.length > MAIN_BUNDLE_GZIP_BUDGET) {
    fail(
      `${file}: ${gzipKb} KB gzip — over budgettet på ${budgetKb} KB for FØRSTE indlæsning. ` +
        "Noget der burde være lazy-loadet endte i hovedbundtet — se filens hoved.",
    );
  }
}

// --- Kontrol 2: hver bagt akt har sit eget lazy-loadede chunk ---
const bakedActFiles = readdirSync(resolve(ROOT, "content/narrator")).filter((f) =>
  /^pairs-act-\d+\.json$/.test(f),
);
for (const f of bakedActFiles) {
  const act = f.match(/^pairs-act-(\d+)\.json$/)[1];
  const chunkPattern = new RegExp(`^pairs-act-${act}-.*\\.js$`);
  const chunk = assetFiles.find((a) => chunkPattern.test(a));
  if (!chunk) {
    fail(
      `content/narrator/${f} findes, men intet separat "pairs-act-${act}-*.js"-chunk ligger i dist/assets — ` +
        "filen er smeltet sammen med hovedbundtet i stedet for at blive lazy-loadet (CON-003).",
    );
  } else {
    console.log(`akt ${act}: bagte replikker ligger i eget chunk (${chunk}) — adskilt fra hovedbundtet.`);
  }
}

if (process.exitCode) {
  console.error("\nBundtbudget FEJLEDE.");
} else {
  console.log("\n✅ Bundtbudget: første indlæsning vokser ikke, de bagte akter er stadig lazy-loadet.");
}
