/**
 * Optagelse — den visuelle dommers øjne.
 *
 * Starter selv en dev-server, sætter viewporten til referencens native mål,
 * booter spillet ind i det scenarie referencen viser, venter på at siden
 * faktisk er malet færdig, og skriver tre ting til disk:
 *
 *   render/<screen>.png        helskærmsbilledet
 *   render/<screen>/<id>.png   ét udsnit pr. region, klippet efter DOM-ankeret
 *   metrics/<screen>.json      boks og computed styles pr. anker
 *
 * Det tredje er det vigtigste. Kan et tal læses af getComputedStyle, skal
 * dommeren have TALLET — ikke gætte det ud af pixels. Forskellen er
 * "font-size er 15px, referencen måler ~19px" mod "teksten ser lille ud".
 *
 * Serveren startes og stoppes her (ikke antaget kørende): den dør, når dens
 * shell høstes, og en optagelse mod en død server giver et hvidt billede og
 * en score der ser ud som et sammenbrud.
 *
 * Kør:  node tools/judge/capture.mjs [--screen game|title|all] [--out DIR]
 * Se plan/architecture-visual-judge-1.md fase 3 (TASK-012, TASK-013).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
export { ORIGIN };
const REGISTRY = join(ROOT, "docs/design/reference/registry.json");

/** Felter dommeren får som tal. Alt her kan omsættes direkte til en rettelse. */
const STYLE_FIELDS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
  "letterSpacing", "textTransform", "color", "backgroundColor",
  "backgroundImage", "borderRadius", "borderWidth", "borderColor",
  "boxShadow", "opacity", "paddingTop", "paddingRight", "paddingBottom",
  "paddingLeft", "gap", "display", "justifyContent", "alignItems",
];

export async function startServer() {
  const proc = spawn(
    "npx",
    ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return proc;
    } catch {
      /* endnu ikke oppe */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill();
  throw new Error(`Dev-serveren kom ikke op på ${ORIGIN} inden for 30 s`);
}

export async function loadRegistry() {
  return JSON.parse(await readFile(REGISTRY, "utf8"));
}

/**
 * Optager én skærm. Returnerer måldata, så kalderen kan bruge dem uden at
 * læse dem tilbage fra disk.
 */
export async function captureScreen(browser, screen, outDir) {
  const page = await browser.newPage({
    viewport: { width: screen.nativeWidth, height: screen.nativeHeight },
    deviceScaleFactor: 1,
    // Reduceret bevægelse ville også fryse skrivemaskinen, men frysningen skal
    // komme fra ÉT sted (?freeze=1), så en fejl i den ene mekanisme ikke
    // skjules af den anden.
    reducedMotion: "no-preference",
  });

  const url = `${ORIGIN}/?scenario=${screen.scenario}&freeze=1`;
  await page.goto(url, { waitUntil: "load" });
  // Venter på et FAKTUM (siden er malet), ikke på et gæt (en timeout).
  await page.waitForSelector("html[data-ready='true']", { timeout: 20_000 });

  await mkdir(join(outDir, "render", screen.id), { recursive: true });
  await mkdir(join(outDir, "metrics"), { recursive: true });

  await page.screenshot({ path: join(outDir, "render", `${screen.id}.png`) });

  const metrics = { screen: screen.id, url, regions: {} };
  for (const region of screen.regions) {
    const loc = page.locator(region.anchor).first();
    const count = await loc.count();
    if (count === 0) {
      // Et manglende anker er et RESULTAT, ikke en fejl: det er præcis, hvad
      // "komponenten findes ikke endnu" ser ud som, og dommeren skal se det.
      metrics.regions[region.id] = { anchor: region.anchor, missing: true };
      continue;
    }
    const box = await loc.boundingBox();
    const styles = await loc.evaluate((node, fields) => {
      const cs = getComputedStyle(node);
      const out = {};
      for (const f of fields) out[f] = cs[f];
      out.textContent = (node.textContent ?? "").trim().slice(0, 200);
      out.childCount = node.children.length;
      return out;
    }, STYLE_FIELDS);

    metrics.regions[region.id] = { anchor: region.anchor, box, styles };

    if (box && box.width > 0 && box.height > 0) {
      await loc.screenshot({
        path: join(outDir, "render", screen.id, `${region.id}.png`),
      });
    }
  }

  await writeFile(
    join(outDir, "metrics", `${screen.id}.json`),
    JSON.stringify(metrics, null, 2),
  );
  await page.close();
  return metrics;
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const want = valueOf(args, "--screen") ?? "all";
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/latest");

  const registry = await loadRegistry();
  const screens = registry.screens.filter((s) => want === "all" || s.id === want);
  if (screens.length === 0) {
    throw new Error(
      `Ukendt skærm "${want}". Kendte: ${registry.screens.map((s) => s.id).join(", ")}`,
    );
  }

  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const screen of screens) {
      const m = await captureScreen(browser, screen, outDir);
      const missing = Object.entries(m.regions)
        .filter(([, v]) => v.missing)
        .map(([k]) => k);
      console.log(
        `optaget ${screen.id} (${screen.nativeWidth}×${screen.nativeHeight})` +
          (missing.length ? `  — manglende ankre: ${missing.join(", ")}` : ""),
      );
    }
    console.log(`→ ${outDir}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
