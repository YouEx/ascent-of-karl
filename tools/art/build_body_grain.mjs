#!/usr/bin/env node
/**
 * Bager filmkornet i body::after til en statisk fil.
 *
 * Hvorfor (kilde 1): laget brugte en levende `feTurbulence`-filter (SVG)
 * direkte i baggrundsbilledet. Chromium rasterizerer den filtertype ikke
 * bit-for-bit ens fra kørsel til kørsel — to optagelser af IDENTISK tilstand
 * (`node tools/judge/capture.mjs --screen game` kørt to gange) endte
 * lejlighedsvis med forskellig SHA-256 og ~43 forskellige pixel, maks.
 * kanaldelta 7/255. Det gør enhver dommerscore ureproducerbar
 * (TASK-006/TEST-001).
 *
 * Bekræftet ved eksperiment: samme optagelse med body::after midlertidigt
 * skjult (`display: none`) gav byte-identiske filer på tværs af to kørsler.
 * Filteret er skyldig, ikke fonte/animationer/billeder — de er allerede
 * låst af markReadyWhenPainted() og [data-freeze="true"].
 *
 * Løsningen er IKKE at slukke kornet under frysning — det ville måle en
 * fladere overflade end den, spillere rent faktisk ser, og gøre
 * materiality-metrikken uretfærdig (den findes netop for at fange forskellen
 * på malet tekstur og flad CSS). Løsningen er at gøre kornet statisk: dette
 * script render selve den eksisterende SVG i en rigtig browser ÉN gang og
 * gemmer resultatet som en almindelig PNG-flise.
 *
 * Hvorfor (kilde 2, fundet ved efterprøvning af selve rettelsen — 5-8
 * kørsler i træk, ikke kun to): selv med den statiske flise gentog PRÆCIS
 * samme 43-pixel/delta-7-mønster sig i en mindre andel af kørslerne (1 af
 * 5, 2 af 5, 2 af 8 på tværs af tre uafhængige målerækker). Mistanke faldt
 * på CSS' `opacity`-egenskab på body::after: enhver brøkopacitet
 * (0 < x < 1) tvinger Chromium til en isoleret gruppe-komposit (laget
 * renderes til en offscreen-buffer, som SÅ alfa-blandes ind med `opacity`
 * som faktor), mens `opacity: 0` og `opacity: 1` begge var deterministiske i
 * alle kørsler. Grain-opaciteten (config.grainOpacity, se nedenfor) bages
 * derfor IND i denne flises alfakanal via rect'ets SVG-opacity, og
 * body::after selv kører med `opacity: 1`, så laget ikke længere har brug
 * for gruppe-isolering.
 *
 * DET LØSTE DET IKKE: en ny 8-kørsels-test af netop denne bagte variant
 * viste PRÆCIS samme 43-pixel/delta-7-mønster igen (2 af 8), og hverken at
 * fjerne flise-gentagelsen (ét stort baggrundsbillede i stedet for ~88
 * fliser) eller at slå GPU-kompositering fra i Chromium-opstarten
 * (--disable-gpu-compositing, testet midlertidigt) ændrede noget — hvilket
 * AFKRÆFTER GPU'en som en isoleret, selvstændig skyldig snarere end at
 * bekræfte den: havde GPU-kompositeringen alene været årsagen, ville en
 * CPU-baseret kompositeringssti have givet deterministiske resultater.
 * Konklusionen er derfor bredere og mere forsigtig end først antaget:
 * hverken indholdet, opacitetsmetoden, flisningen eller GPU'en specifikt,
 * men en mere grundlæggende ikke-determinisme i Chromiums rendering/
 * kompositering af et fladedækkende, halvgennemsigtigt
 * `mix-blend-mode`-lag — en grænse i browseren, ikke en fejl i denne fil,
 * og et eksperiment der ikke indsnævrer skylden til ét bestemt
 * undersystem. Den bagte alfa og `opacity: 1` bevares alligevel: de fjerner
 * indholds-generering som selvstændig variabel og en overflødig
 * kompositeringspasse, selvom de ikke alene giver bit-identiske optagelser.
 * TEST-001 er derfor lempet til en målt pixel-tolerance i stedet for
 * identisk SHA-256, håndhævet eksekverbart af `npm run judge:determinism`
 * — se plan/architecture-visual-judge-1.md TASK-006/TEST-001 for tallene
 * og begrundelsen.
 *
 * Udseendet er uændret i begge tilfælde — det er bogstaveligt talt ét
 * billede af den samme støj, med samme effektive opacity — og filen
 * genererer ikke længere sit eget indhold ved hver kørsel, hvilket fjerner
 * kilde 1 helt. Kilde 2 er en resterende, accepteret tolerance, ikke noget
 * denne fil kan lukke helt.
 *
 * Kører i Node+Playwright, ikke Python som de øvrige tools/art/build_*.py:
 * feTurbulence er en browser-renderingsfunktion, og Playwright er allerede
 * en devDependency (bruges af tools/judge/capture.mjs). At tilføje et
 * SVG-filter-bibliotek til Python for denne ene flise ville være en tungere
 * afhængighed for et lettere formål.
 *
 * Bageparametrene (størrelse, feTurbulence-indstillinger, opaciteter,
 * outputsti) står i tools/art/body-grain.config.json — ÉN kilde, ikke
 * konstanter duplikeret i denne fil. Grain-opacitet er dermed et
 * asset-genereringsparameter, ikke et levende CSS-token: src/ui/tokens.css
 * har ikke længere en `--grain-opacity`-egenskab at drive ud af sync med
 * dette script (Revideret 2026-08-12).
 *
 * Kør: node tools/art/build_body_grain.mjs (og igen, hver gang
 * tools/art/body-grain.config.json ændres).
 * Kør: node tools/art/build_body_grain.mjs --check for at bekræfte, at den
 * COMMITTEDE PNG stadig stemmer overens med config'ens deklarerede
 * størrelse — uden at duplikere SIZE som en anden konstant (læser selve
 * filens PNG-header). Se plan/architecture-visual-judge-1.md TASK-006,
 * TEST-001.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG_PATH = resolve(ROOT, "tools/art/body-grain.config.json");

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

function buildSvg(config) {
  const { size, baseFrequency, numOctaves, rectOpacity, grainOpacity } = config;
  // Præcis den samme filterformel, der stod i src/ui/tokens.css' body::after
  // dengang laget var levende — kun rasterizeret én gang i stedet for ved
  // hver repaint. feTurbulence genererer støj i BÅDE farve- og alfakanalen;
  // rect'ets opacity (rectOpacity × grainOpacity) skalerer kun alfaen.
  const opacity = rectOpacity * grainOpacity;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='${numOctaves}'/></filter>` +
    `<rect width='${size}' height='${size}' filter='url(#n)' opacity='${opacity}'/></svg>`;
}

/** Læser bredde/højde direkte af PNG-headeren (IHDR), uden noget
 *  billedbibliotek — signaturen er 8 byte, så følger en 4-byte
 *  chunk-længde, en 4-byte chunk-type ("IHDR") og så bredde/højde som to
 *  4-byte big-endian heltal. Bruges af --check, så kontrollen læser den
 *  FAKTISKE committede fils reelle mål, ikke endnu en hardkodet konstant. */
function readPngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${path} ligner ikke en gyldig PNG (mangler IHDR-chunk)`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * --check: beviser at config og den committede fil er enige, uden at
 * gengenerere pixlerne (feTurbulence-rasterisering er netop IKKE
 * bit-for-bit reproducerbar — se kilde 2 ovenfor — så en pixel-for-pixel
 * sammenligning ville selv være flaky). Det, der SKAL stemme overens, og
 * som ikke afhænger af rasterizerings-støj, er stien og dimensionerne.
 */
async function check() {
  const config = await loadConfig();
  const dst = resolve(ROOT, config.output);
  const fails = [];

  let actual;
  try {
    actual = readPngSize(dst);
  } catch (err) {
    fails.push(`${dst}: ${err.message}`);
  }
  if (actual && (actual.width !== config.size || actual.height !== config.size)) {
    fails.push(
      `${dst} er ${actual.width}×${actual.height}, men ` +
        `${CONFIG_PATH} siger size=${config.size} (forventer ${config.size}×${config.size})`,
    );
  }

  if (fails.length) {
    fails.forEach((f) => console.error("FEJL:", f));
    console.error(`--check: ${fails.length} uoverensstemmelse(r) mellem config og committet asset`);
    return 1;
  }
  console.log(`--check: ${dst} stemmer overens med ${CONFIG_PATH} (${config.size}×${config.size})`);
  return 0;
}

async function build() {
  const config = await loadConfig();
  const dst = resolve(ROOT, config.output);
  const svg = buildSvg(config);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: config.size, height: config.size },
      deviceScaleFactor: 1,
    });
    // background-image i tokens.css lægger sig oven på siden med
    // mix-blend-mode:multiply, så alfaen afgør, hvor meget hvert pixel
    // griber ind. Skærmbilledet skal derfor bevare ægte per-pixel-alfa
    // (omitBackground + transparent body) — flader vi den mod hvidt her,
    // forsvinder alfavariationen, og fliseeffekten bliver mere ensartet end
    // den levende filter nogensinde var.
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${config.size}" height="${config.size}">` +
        `</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(dst, png);
    console.log(`→ ${dst} (${config.size}×${config.size})`);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    process.exit(await check());
  }
  await build();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
