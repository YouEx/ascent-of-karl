/**
 * Genererer delekort og app-ikoner ud fra tools/social/card.html.
 *
 * Kør:  npm run social
 *
 * Scriptet starter sin EGEN Vite-server på en ledig port. Det er bevidst:
 * en manuel "husk at starte dev-serveren først"-instruktion er en fælde,
 * og et portnummer skrevet i en README holder op med at passe den dag nogen
 * ændrer et script. Sæt SOCIAL_ORIGIN for at pege på en server der allerede
 * kører.
 *
 * Hvorfor generere frem for at tegne i et billedprogram: aktiverne skal
 * kunne genskabes deterministisk når designsystemet ændrer sig. Kortet
 * henter de samme tokens og den samme karl.webp som spillet selv.
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, rm, stat, rename } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC = join(ROOT, "public");

/**
 * Kilde-element, udfil og skalering. Delekortet ender som JPEG: kortet har
 * filmkorn over en blød gradient, og det er præcis det motiv PNG er dårligst
 * til (1,1 MB mod 100 kB). Ikonerne SKAL være PNG (manifest + apple-touch),
 * så de tages ned i vægt med farvereduktion i stedet — 192 farver UDEN
 * dithering, fordi dithering både støjer synligt og firedobler filen.
 */
const TARGETS = [
  { sel: "#og", file: "og-image.jpg", scale: 1, jpegQuality: 88 },
  { sel: "#icon512", file: "icon-512.png", scale: 1, colors: 192 },
  { sel: "#icon512", file: "icon-192.png", scale: 192 / 512, colors: 192 },
  { sel: "#icon512", file: "apple-touch-icon.png", scale: 180 / 512, colors: 192 },
  { sel: "#icon32", file: "favicon-32.png", scale: 1 },
];

/** ImageMagick er en hård afhængighed — sig det ligeud frem for at fejle midtvejs. */
async function requireMagick() {
  try {
    await run("magick", ["-version"]);
  } catch {
    throw new Error("`magick` (ImageMagick) mangler. Installér med: brew install imagemagick");
  }
}

let server;
let browser;
try {
  await requireMagick();
  await mkdir(PUBLIC, { recursive: true });

  let origin = process.env.SOCIAL_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    const { createServer } = await import("vite");
    // port: 0 = lad OS'et vælge en ledig port. Ingen konflikt med en
    // dev-server der allerede kører, og intet hardkodet portnummer at glemme.
    server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: "warn" });
    await server.listen();
    origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  }

  browser = await chromium.launch();

  for (const { sel, file, scale, jpegQuality, colors } of TARGETS) {
    const out = join(PUBLIC, file);
    // Skriv ALTID til en midlertidig fil først. Ellers ville et aktiv uden
    // efterbehandling (favicon'et) blive skrevet direkte oven i den rigtige
    // fil — og en fejl bagefter ville efterlade public/ i stykker.
    const raw = `${out}.raw.png`;

    try {
      // Ny kontekst pr. aktiv: deviceScaleFactor kan ikke ændres på en åben
      // side, og nedskalering i browseren giver skarpere kanter end sips.
      const ctx = await browser.newContext({ deviceScaleFactor: scale });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      // requestfailed dækker det response-hændelsen IKKE gør: afbrudte
      // forbindelser, DNS-fejl, blokerede porte. Uden den ville et manglende
      // karl.webp give et tomt kort med et grønt flueben.
      page.on("requestfailed", (r) =>
        errors.push(`${r.failure()?.errorText ?? "request failed"} ${r.url()}`),
      );

      await page.goto(`${origin}/tools/social/card.html`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);

      // Billed-integritet skal tjekkes eksplicit. Vite-dev-serveren svarer
      // med index.html og status 200 på en ukendt sti (SPA-fallback), så et
      // manglende karl.webp giver hverken 404 eller requestfailed — kun et
      // <img> der ikke kan afkode. Uden dette tjek genererede scriptet
      // glad-og-grønt kort HELT UDEN Karl på. Verificeret 2026-08-11.
      const broken = await page.evaluate(() =>
        [...document.images]
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.src),
      );
      if (broken.length) errors.push(`billede kunne ikke indlæses: ${broken.join(", ")}`);

      await page.locator(sel).screenshot({ path: raw });
      await ctx.close();

      if (errors.length) throw new Error(`${file}: ${errors.join(", ")}`);

      if (jpegQuality || colors) {
        const args = [raw, "-strip"];
        if (colors) args.push("+dither", "-colors", String(colors));
        if (jpegQuality) args.push("-quality", String(jpegQuality));
        args.push(out);
        await run("magick", args);
      } else {
        await rename(raw, out);
      }
    } finally {
      // Ryd op uanset hvordan vi forlod blokken. public/ kopieres direkte til
      // dist/, så en efterladt .raw.png ville blive deployet.
      await rm(raw, { force: true });
    }

    const kb = Math.round((await stat(out)).size / 1024);
    console.log(`✅ ${file} (${kb} kB)`);
  }
} finally {
  await browser?.close();
  await server?.close();
}
