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
 * Gzip-lofter for hovedbundtet. Se den historiske baseline i git.
 *
 * Der bygges TO varianter (tools/build_pages.mjs' plan), og de er ikke lige
 * store: produktionsroden har improvisationen slået fra, playtest-varianten har
 * den slået til. Ét fælles loft ville derfor blive sat af den STØRSTE variant og
 * lade den mindste — den offentlige første indlæsning, som TEST-010 findes for
 * at beskytte — sejle med over 2 KB ubevogtet luft. Hver variant har sit eget
 * loft af præcis den grund.
 *
 * Målt med værktøjets egen komprimering (level 9).
 *
 * 2026-08-16 ændrede selve UI-arkitekturen fra håndskrevet DOM til Svelte 5.
 * Det er ikke en almindelig feature, som må gemme sig under det gamle loft:
 * den compiler/runtime, som nu EJER alle skærmflader, koster målt ~19 KB gzip.
 * Martin bad eksplicit om hele target-arkitekturen, og budgetbeslutningen er
 * derfor nulstillet én gang til den nye arkitekturs målte baseline — ikke
 * løftet lidt efter lidt for en række lokale imports.
 *
 * Målt efter Svelte-shell, semantic events, seeded life/compendium core og
 * bounded generated-gameplay core:
 *
 *   produktionsrod  dist/assets/index-*.js                137.0 KB   (loft 140 KB)
 *   playtest        dist/playtest/.../assets/index-*.js   måles af build:pages
 *   løst vite build dist/assets/index-*.js                måles af npm run build
 *
 * Stigningen fra shell-baselinen til 137 KB er den målte target-runtime:
 * ProfileV2/IndexedDB archives, compendium/replay, typed product events,
 * authoritative session client and online outage gate. De er del af samme
 * godkendte arkitekturleverance, ikke løbende features efter nulstillingen.
 *
 * Historikken bag playtest-loftet: da titelskærmens illustrationer gik fra
 * bitmap til SVG (2026-08-14), voksede JS-chunken, mens welcome-figure.webp —
 * et 69x61 udklip, der blev hentet EAGERLY som `background-image` — forsvandt
 * helt. Aktivet vejede 2.368 B (efterprøvet med `git cat-file -s` på blobben i
 * a439cc6), så den samlede første indlæsning faldt, selv om loftet måler JS
 * alene.
 *
 * Advarsel til den næste, der måler: `npx vite build` giver en TREDJE chunk,
 * som ikke er nogen af de to udgivne varianter. Kun `npm run build:pages`
 * producerer de tal, lofterne her handler om. En tidligere note i denne fil
 * afviste en sænkning af produktionsloftet ud fra netop den forveksling — den
 * afvisning var forkert, og sænkningen er gennemført her.
 *
 * Den tredje chunk har sit eget loft, fordi den findes i praksis: `npm run
 * build`, `npm run preview` og `npm run judge:capture` bygger alle sådan en.
 * Den udgives ingen steder, så loftet er en røgalarm — det fanger en løbsk
 * import lokalt — ikke den kontrakt, TEST-010 håndhæver:
 *
 *   løst `vite build`  dist/assets/index-*.js                113.029 B  (loft 113.664)
 *
 * At måle den mod produktionsloftet ville melde rødt på en variant, ingen
 * bruger nogensinde henter.
 *
 * Reglen efter denne arkitektur-nulstilling er igen den oprindelige: et loft
 * må kun hæves sammen med et regnskab, hvor den samlede første indlæsning for
 * DEN variant falder. Vokser den, er svaret at gøre ændringen billigere — ikke
 * at flytte loftet.
 */
export const MAIN_BUNDLE_GZIP_BUDGET = 140 * 1024;
export const PLAYTEST_BUNDLE_GZIP_BUDGET = 142 * 1024;
export const LOCAL_BUNDLE_GZIP_BUDGET = 142 * 1024;

/**
 * Loftet hører til VARIANTEN, ikke til stien.
 *
 * Stien alene er ikke nok, og det er ikke teoretisk: `npm run judge:capture`
 * kører et rent `vite build`, som skriver improvisations-bundtet — det STORE —
 * ind i `dist/`, hvor produktionsloftet ellers gælder. Målingen så da ud som en
 * budgetoverskridelse, selv om produktionsvarianten var uændret. Den forveksling
 * fik i første omgang en anmeldelses helt korrekte fund afvist.
 *
 * Er mappen bygget af build:pages, ved artifactet selv, hvad det er:
 * `pages-build.json` navngiver varianten, og den afgør loftet.
 *
 * Findes kontrakten ikke, er mappen et løst `vite build`. Så er svaret hverken
 * produktions- eller playtestloftet — begge ville måle den mod en variant, den
 * ikke er — men LOCAL_BUNDLE_GZIP_BUDGET. Stien konsulteres aldrig: en
 * kontraktløs `dist/playtest/`-mappe findes ikke i praksis, og et gæt ud fra
 * mappenavne var netop den fejl, der skulle væk.
 */
export function budgetForOutDir(outDir = "dist", root = ROOT) {
  const absolute = isAbsolute(outDir) ? outDir : resolve(root, outDir);
  const contractPath = resolve(absolute, "pages-build.json");
  if (existsSync(contractPath)) {
    try {
      const variant = JSON.parse(readFileSync(contractPath, "utf8")).variant;
      if (typeof variant === "string") {
        return variant.includes("playtest")
          ? PLAYTEST_BUNDLE_GZIP_BUDGET
          : MAIN_BUNDLE_GZIP_BUDGET;
      }
    } catch {
      // Ulæselig kontrakt: mappen kan ikke gøre rede for sig selv, og så
      // gælder røgalarmen — ikke et gæt på en udgivet variant.
    }
  }
  return LOCAL_BUNDLE_GZIP_BUDGET;
}

/** Er mappen bygget af build:pages, eller er det et løst `vite build`? */
export function isPagesArtifact(outDir = "dist", root = ROOT) {
  const absolute = isAbsolute(outDir) ? outDir : resolve(root, outDir);
  return existsSync(resolve(absolute, "pages-build.json"));
}

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
  budget = budgetForOutDir(outDir, root),
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
    const outDir = parseOutDir(process.argv.slice(2));
    if (!isPagesArtifact(outDir)) {
      console.warn(
        `⚠️  ${outDir} har ingen pages-build.json — mappen er et løst \`vite build\`, ikke en udgivet ` +
          "variant. Den måles mod det lokale røgalarmsloft; kør `npm run build:pages` for at måle det, der faktisk udgives.",
      );
    }
    checkBundleBudget({ outDir });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
