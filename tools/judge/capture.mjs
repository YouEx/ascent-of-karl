/**
 * Optagelse — den visuelle dommers øjne.
 *
 * Bygger spillet og server det bundtede resultat med `vite preview`
 * (CON-004), sætter viewporten til referencens native mål, booter spillet
 * ind i det scenarie referencen viser, venter på at siden faktisk er malet
 * færdig, og skriver tre ting til disk:
 *
 *   render/<screen>.png        helskærmsbilledet
 *   render/<screen>/<id>.png   ét udsnit pr. region, klippet efter DOM-ankeret
 *   metrics/<screen>.json      boks og computed styles pr. anker
 *
 * Det tredje er det vigtigste. Kan et tal læses af getComputedStyle, skal
 * dommeren have TALLET — ikke gætte det ud af pixels. Forskellen er
 * "font-size er 15px, referencen måler ~19px" mod "teksten ser lille ud".
 *
 * Hvorfor preview og ikke dev-serveren: målt 2026-08-12 i en A/B mellem de
 * to på samme commit — to optagelser mod dev er byte-identiske, to mod
 * preview er byte-identiske, men dev ≠ preview (op til 2/255 i header og de
 * flader, der arver dens baggrund). Årsagen er CSS-minificeringen: kilden
 * skriver `rgb(74 48 33 / 0.15)`, prod-bundtet skriver `#4a302126` — en hex-
 * alfa på 38/255 = 0,149, afrundet fra 0,15. Dev-serveren giver browseren
 * decimaltallet ufortyndet; kun prod-bundtet får den afrunding, spillerne
 * rent faktisk ser. Dommeren skal måle det spillerne får, ikke kilden før
 * minificering — derfor bygges der her, hver gang, før serveren startes.
 *
 * Serveren startes og stoppes her (ikke antaget kørende): den dør, når dens
 * shell høstes, og en optagelse mod en død server giver et hvidt billede og
 * en score der ser ud som et sammenbrud.
 *
 * Kør:  node tools/judge/capture.mjs [--screen game|title|all] [--out DIR]
 * Se plan/architecture-visual-judge-1.md fase 3 (TASK-012, TASK-013, CON-004).
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

/** Bygger produktionsbundtet, som `startServer` derefter server (CON-004).
 *  Eksporteret så loop.mjs kan genbygge `dist/` MELLEM iterationer uden at
 *  genstarte server eller browser: `vite preview` er en statisk filserver,
 *  den hot-reloader ikke, men Vites indholds-hashede filnavne gør et
 *  in-place-genbyg sikkert — en frisk sidenavigation henter altid det
 *  `index.html`, der peger på den nyeste hash. Uden dette ville accept-
 *  porten sammenligne to identiske optagelser hver eneste iteration, fordi
 *  serveren blev ved med at servere den GAMLE tuning.css-tilstand. Bekræftet
 *  empirisk 2026-08-12: genbyg ændrede `index-BMhE9eiG.css` til
 *  `index-GPzA5hkr.css` uden serverneutstart, og den nye fil bar den
 *  injicerede tokenværdi. */
export async function build() {
  await new Promise((res, rej) => {
    const proc = spawn("npx", ["vite", "build"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d;
    });
    proc.on("exit", (code) => {
      if (code === 0) res();
      else rej(new Error(`vite build fejlede (kode ${code}):\n${stderr}`));
    });
  });
}

export async function startServer() {
  await build();
  const proc = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
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
  await stopServer(proc);
  throw new Error(`Preview-serveren kom ikke op på ${ORIGIN} inden for 30 s`);
}

/**
 * Lukker preview-processen og venter på dens exit, så port 5199 faktisk er
 * frigivet, før kalderen fortsætter. SIGKILL er kun en sidste udvej efter
 * timeout; funktionen kaster aldrig fra oprydning og kan derfor ikke skjule
 * den fejl, der udløste en finally-blok.
 */
export async function stopServer(server, { timeoutMs = 5_000 } = {}) {
  if (!server || server.exitCode != null || server.signalCode != null) return;

  // Små injicerede procesdoubler i enhedstest har kun kill(). Den rigtige
  // ChildProcess har once()/removeListener() og går gennem ventestien nedenfor.
  if (typeof server.once !== "function") {
    try { server.kill?.(); } catch { /* oprydning må ikke skjule hovedfejlen */ }
    return;
  }

  await new Promise((resolveDone) => {
    let done = false;
    let forceTimer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(forceTimer);
      server.removeListener?.("exit", finish);
      resolveDone();
    };

    server.once("exit", finish);
    forceTimer = setTimeout(() => {
      try { server.kill("SIGKILL"); } catch { finish(); }
    }, timeoutMs);

    try {
      if (!server.kill("SIGTERM")) finish();
    } catch {
      finish();
    }
  });
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

/**
 * Den selvstændige capture-CLI's fulde levetid, gjort importerbar så både
 * succes- og fejlstier kan prøves. Registry valideres før serverstart; efter
 * serverstart lukkes browser og preview altid, også hvis Chromium-launch eller
 * et screenshot fejler.
 */
export async function runCapture({
  want = "all",
  outDir,
  loadRegistryFn = loadRegistry,
  startServerFn = startServer,
  launchBrowser = () => chromium.launch(),
  captureScreenFn = captureScreen,
  stopServerFn = stopServer,
} = {}) {
  const registry = await loadRegistryFn();
  const screens = registry.screens.filter((s) => want === "all" || s.id === want);
  if (screens.length === 0) {
    throw new Error(
      `Ukendt skærm "${want}". Kendte: ${registry.screens.map((s) => s.id).join(", ")}`,
    );
  }

  let server;
  let browser;
  try {
    server = await startServerFn();
    browser = await launchBrowser();
    const results = [];
    for (const screen of screens) {
      const metrics = await captureScreenFn(browser, screen, outDir);
      results.push({ screen, metrics });
    }
    return results;
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        console.error(`kunne ikke lukke browseren pænt under oprydning: ${err.message}`);
      });
    }
    try {
      if (server) await stopServerFn(server);
    } catch (err) {
      console.error(`kunne ikke lukke preview-serveren pænt under oprydning: ${err.message}`);
    }
  }
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const want = valueOf(args, "--screen") ?? "all";
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/latest");

  const results = await runCapture({ want, outDir });
  for (const { screen, metrics } of results) {
    const missing = Object.entries(metrics.regions)
      .filter(([, value]) => value.missing)
      .map(([k]) => k);
    console.log(
      `optaget ${screen.id} (${screen.nativeWidth}×${screen.nativeHeight})` +
        (missing.length ? `  — manglende ankre: ${missing.join(", ")}` : ""),
    );
  }
  console.log(`→ ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
