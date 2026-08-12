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
 * alle kørsler. `--grain-opacity` (src/ui/tokens.css) bages derfor IND i
 * denne flises alfakanal via rect'ets SVG-opacity, og body::after selv
 * kører med `opacity: 1`, så laget ikke længere har brug for gruppe-
 * isolering.
 *
 * DET LØSTE DET IKKE: en ny 8-kørsels-test af netop denne bagte variant
 * viste PRÆCIS samme 43-pixel/delta-7-mønster igen (2 af 8), og hverken at
 * fjerne flise-gentagelsen (ét stort baggrundsbillede i stedet for ~88
 * fliser) eller at slå GPU-kompositering fra i Chromium-opstarten (testet
 * midlertidigt) ændrede noget. Konklusionen: årsagen er hverken indholdet,
 * opacitetsmetoden eller flisningen, men en mere grundlæggende
 * ikke-determinisme i Chromiums GPU-kompositering af et fladedækkende,
 * halvgennemsigtigt `mix-blend-mode`-lag — en grænse i browserens
 * rendering, ikke en fejl i denne fil. Den bagte alfa og `opacity: 1`
 * bevares alligevel: de fjerner indholds-generering som selvstændig
 * variabel og en overflødig kompositeringspasse, selvom de ikke alene
 * giver bit-identiske optagelser. TEST-001 er derfor lempet til en målt
 * pixel-tolerance i stedet for identisk SHA-256 — se
 * plan/architecture-visual-judge-1.md TASK-006/TEST-001 for tallene og
 * begrundelsen.
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
 * Kør: node tools/art/build_body_grain.mjs (og igen, hver gang
 * --grain-opacity ændres i src/ui/tokens.css — se CSS_GRAIN_OPACITY nedenfor).
 * Se plan/architecture-visual-judge-1.md TASK-006, TEST-001.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DST = resolve(ROOT, "src/assets/art/body-grain.png");
const SIZE = 140; // samme flisestørrelse som den oprindelige SVG (width/height=140)

// Præcis den samme filterformel, der stod i src/ui/tokens.css' body::after —
// kun rasterizeret én gang i stedet for ved hver repaint.
const RECT_OPACITY = 0.5; // uafhængig af CSS-tokenet — tuner selve støjtætheden
// SKAL matche --grain-opacity i src/ui/tokens.css. Bages ind her i stedet for
// at blive appliceret via CSS' `opacity`-egenskab på body::after, fordi den
// CSS-brøkopacitet selv (uafhængigt af live vs. statisk kilde) er en
// selvstændig kilde til ikke-determinisme — se den lange forklaring i
// tokens.css' body::after. Ændrer du tallet i tokens.css, opdatér det her og
// kør scriptet igen, ellers driver token og fil fra hinanden.
const CSS_GRAIN_OPACITY = 0.16;
const SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter>` +
  `<rect width='${SIZE}' height='${SIZE}' filter='url(#n)' opacity='${RECT_OPACITY * CSS_GRAIN_OPACITY}'/></svg>`;

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: SIZE, height: SIZE },
      deviceScaleFactor: 1,
    });
    // feTurbulence genererer støj i BÅDE farve- og alfakanalen; rect'ets
    // opacity (RECT_OPACITY × CSS_GRAIN_OPACITY) skalerer kun alfaen.
    // background-image i tokens.css lægger sig oven på siden med
    // mix-blend-mode:multiply, så alfaen afgør, hvor meget hvert pixel
    // griber ind. Skærmbilledet skal derfor bevare ægte per-pixel-alfa
    // (omitBackground + transparent body) — flader vi den mod hvidt her,
    // forsvinder alfavariationen, og fliseeffekten bliver mere ensartet end
    // den levende filter nogensinde var.
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml,${encodeURIComponent(SVG)}" width="${SIZE}" height="${SIZE}">` +
        `</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(DST, png);
    console.log(`→ ${DST} (${SIZE}×${SIZE})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
