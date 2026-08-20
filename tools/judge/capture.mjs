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
 * Kør:  node tools/judge/capture.mjs [--screen game|title|all]
 *        [--viewports native|registered] [--out DIR]
 * Se plan/architecture-visual-judge-1.md fase 3 (TASK-012, TASK-013, CON-004).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessGroup, signalTree } from "./process-group.mjs";

const POSIX = process.platform !== "win32";

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
/**
 * Byg via procesgruppe-køreren, ikke rå spawn. Den gamle kode åbnede en pipe
 * på barnets stdout uden nogensinde at læse den: skriver vite mere end
 * pipe-bufferen (64 KB) rummer, blokerer barnet for evigt på sin egen write,
 * og build() — som ingen timeout havde — venter lige så længe. Køreren tømmer
 * begge strømme, kører barnet i sin egen gruppe og har en øvre grænse, så en
 * hængende build dør med et spor i stedet for at æde hele dommerens budget.
 */
export async function build({ timeoutMs = 180_000, runProcessFn = runProcessGroup } = {}) {
  await runProcessFn("npx", ["vite", "build"], { cwd: ROOT, timeoutMs });
}

/** Fasemarkør på stderr med forbrugt tid. stderr, fordi en dræbt proces kun
 * efterlader det, forælderen allerede har set — og fordi markørerne skal kunne
 * læses i CI-loggen uden at forurene stdout, som dommeren videresender. */
const startedAt = Date.now();
export function phase(message) {
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stderr.write(`[capture +${seconds}s] ${message}\n`);
}

/**
 * Preview-serveren lever i sin EGEN procesgruppe (se `detached` nedenfor), og
 * det er netop hvad der gør den farlig: når dommeren dræber capture.mjs' gruppe
 * ved timeout, dør capture.mjs uden at køre sin `finally`, og previewen
 * overlever som forældreløs med port 5199 i hånden. Næste CI-trin starter sin
 * egen server på samme port, bind'et fejler i baggrunden, `wait-on` får svar fra
 * den GAMLE server — og ux-auditten rapporterer grønt på et forældet `dist/`.
 *
 * Node kører hverken `exit`-hooks eller udestående `finally` på et rent SIGTERM,
 * så signalet skal håndteres eksplicit: dræb træet, og kald derefter
 * process.exit(), som får `exit`-hooken til at fange alt, der måtte være
 * tilbage. Handlerne installeres én gang, uanset hvor mange servere der startes,
 * så gentagne kald ikke lækker lyttere.
 */
const liveServers = new Set();
let orphanGuardArmed = false;
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function killLiveServers() {
  for (const server of liveServers) {
    if (server.exitCode != null || server.signalCode != null) continue;
    try {
      signalTree(server, "SIGKILL");
    } catch {
      /* oprydning må aldrig skjule den fejl, der udløste nedlukningen */
    }
  }
  liveServers.clear();
}

function armOrphanGuard(server) {
  liveServers.add(server);
  server.once?.("exit", () => liveServers.delete(server));
  if (orphanGuardArmed) return;
  orphanGuardArmed = true;
  process.on("exit", killLiveServers);
  for (const signal of Object.keys(SIGNAL_EXIT_CODE)) {
    process.on(signal, () => {
      killLiveServers();
      process.exit(SIGNAL_EXIT_CODE[signal]);
    });
  }
}

export async function startServer() {
  phase("bygger produktionsbundtet");
  await build();
  phase("build færdig — starter vite preview");
  const proc = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    // detached: `npx` er en indpakning, ikke selve serveren. Et SIGTERM til
    // indpakningen efterlader `vite` som forældreløs på Linux, og barnebarnet
    // holder de arvede pipes åbne — så capture.mjs aldrig kan afslutte, og
    // dommeren venter hele sit budget på et `close`, der aldrig kommer.
    // Egen procesgruppe gør det muligt at dræbe hele træet.
    // stdout ignoreres frem for at pipes: en pipe, ingen læser, er en
    // deadlock, der venter på en tilstrækkelig snakkesalig server.
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], detached: POSIX },
  );
  proc.stderr?.on("data", () => {});
  armOrphanGuard(proc);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        phase(`preview svarer på ${ORIGIN}`);
        return proc;
      }
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
      try { signalTree(server, "SIGKILL"); } catch { finish(); }
    }, timeoutMs);

    try {
      if (!signalTree(server, "SIGTERM")) finish();
    } catch {
      finish();
    }
  });
}

export async function loadRegistry() {
  return JSON.parse(await readFile(REGISTRY, "utf8"));
}

function captureName(screen, viewport) {
  return viewport?.registered ? `${screen.id}-${viewport.id}` : screen.id;
}

function nativeViewport(screen) {
  return {
    id: `${screen.id}-native`,
    width: screen.nativeWidth,
    height: screen.nativeHeight,
    dpr: 1,
    payloadClass: "desktop",
    registered: false,
  };
}

/**
 * page.evaluate er den eneste Playwright-kald uden egen timeout: hænger et
 * `await` inde i browseren — her en decode() på et billede, der aldrig bliver
 * færdigt — venter Node for evigt. Løftet kan ikke annulleres, men kalderen
 * lukker browseren i sin finally, så en overskredet frist ender som en navngiven
 * fejl i stedet for tavs død i dommerens samlede budget.
 */
async function withDeadline(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} nåede ikke at svare inden ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Optager én skærm. Returnerer måldata, så kalderen kan bruge dem uden at
 * læse dem tilbage fra disk.
 */
/**
 * Måler hver region på en malet side og melder dem, der ikke kan fotograferes.
 *
 * Udskilt af `captureScreen`, fordi løkken ellers kun kunne nås gennem en ægte
 * browser. Den eneste test af den var derfor en grep efter tekststrenge i denne
 * fil — og den ville stadig være grøn, hvis `unrenderable` aldrig blev fyldt.
 * En strukturel påstand, der ikke kan fejle, er ikke en test. Her tages `page`
 * og `warn` ind, så adfærden kan efterprøves med en stub: hvad der havner i
 * `unrenderable`, og at der faktisk råbes op.
 *
 * @param {{
 *   page: any;
 *   screen: any;
 *   outDir: string;
 *   name: string;
 *   warn?: (message: string) => void;
 * }} options
 */
export async function measureRegions({
  page,
  screen,
  outDir,
  name,
  warn = console.error,
}) {
  /** @type {Record<string, any>} */
  const regions = {};
  const unrenderable = [];

  for (const region of screen.regions) {
    const loc = page.locator(region.anchor).first();
    const count = await loc.count();
    if (count === 0) {
      // Et manglende anker er et RESULTAT, ikke en fejl: det er præcis, hvad
      // "komponenten findes ikke endnu" ser ud som, og dommeren skal se det.
      regions[region.id] = { anchor: region.anchor, missing: true };
      if (region.mode !== "rect") unrenderable.push(`${region.id} (${region.anchor})`);
      continue;
    }
    const box = await loc.boundingBox();
    const visible = await loc.isVisible();
    const styles = await loc.evaluate((node, fields) => {
      const cs = getComputedStyle(node);
      const out = {};
      for (const f of fields) out[f] = cs[f];
      out.textContent = (node.textContent ?? "").trim().slice(0, 200);
      out.childCount = node.children.length;
      return out;
    }, STYLE_FIELDS);

    regions[region.id] = { anchor: region.anchor, box, styles, visible };

    // Et skjult anker er også et RESULTAT, på linje med et manglende: krøniken
    // fylder hele viewporten med `visibility: hidden`, indtil spilleren åbner
    // den. Boksen er altså stor, mens elementet aldrig kan fotograferes —
    // uden dette tjek venter loc.screenshot() sine fulde 30 s og river hele
    // kørslen ned. Det ramte `npm run judge`, `judge:once` og
    // `judge:determinism`; title-fidelity gik fri, fordi den kun tager
    // titelskærme.
    if (box && box.width > 0 && box.height > 0 && visible) {
      await loc.screenshot({
        path: join(outDir, "render", name, `${region.id}.png`),
        timeout: 15_000,
      });
    } else if (region.mode !== "rect") {
      // …men et resultat, ingen ser, er ingen nytte til. Uden crop scorer
      // metrics.py regionen som en flad 0 med `missing: true`, og fordi
      // accept-gaten reagerer på ÆNDRINGER over 0,02, kan et fastlåst nul
      // aldrig flytte sig igen. Regionen trækker altså skærmen ned for evigt,
      // lydløst. Det ramte `narrator`, hvis anker `#narrator` slet ikke fandtes
      // i DOM'en. Regioner i `rect`-tilstand klippes ud af helskærmsbilledet og
      // har aldrig brug for et crop — de er undtaget.
      unrenderable.push(`${region.id} (${region.anchor})`);
    }
  }

  if (unrenderable.length > 0) {
    warn(
      `⚠️  ${screen.id}: ${unrenderable.length} region(er) kan ikke fotograferes og scorer 0 for altid — ${unrenderable.join(", ")}`,
    );
  }

  return { regions, unrenderable };
}

export async function captureScreen(
  browser,
  screen,
  outDir,
  selectedViewport = nativeViewport(screen),
  fidelityCapture = {},
) {
  const viewport = {
    ...selectedViewport,
    registered: selectedViewport.registered ?? false,
  };
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    // Chromium's mobile emulation rasteriser can return height*dpr-1. Vi
    // tester CSS-viewports og fysisk DPR, ikke browser-UA-emulering.
    isMobile: false,
    hasTouch: viewport.payloadClass === "mobile",
    // Reduceret bevægelse ville også fryse skrivemaskinen, men frysningen skal
    // komme fra ÉT sted (?freeze=1), så en fejl i den ene mekanisme ikke
    // skjules af den anden.
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const name = captureName(screen, viewport);

  try {
    const url = `${ORIGIN}/?scenario=${screen.scenario}&freeze=1`;
    phase(`${name}: åbner ${viewport.width}×${viewport.height}@${viewport.dpr}x`);
    await page.goto(url, { waitUntil: "load" });
    // Venter på et FAKTUM (siden er malet), ikke på et gæt (en timeout).
    await page.waitForSelector("html[data-ready='true']", { timeout: 20_000 });
    phase(`${name}: siden er malet`);

    await mkdir(join(outDir, "render", name), { recursive: true });
    await mkdir(join(outDir, "metrics"), { recursive: true });
    await mkdir(join(outDir, "resources"), { recursive: true });

    const screenshot = await page.screenshot();
    const capture = {
      pixelWidth: screenshot.readUInt32BE(16),
      pixelHeight: screenshot.readUInt32BE(20),
    };
    await writeFile(join(outDir, "render", `${name}.png`), screenshot);

    const browserEvidence = await withDeadline(page.evaluate(async ({ dpr, config, payloadClass }) => {
      const titleRoot = document.querySelector("#title-screen");
      const criticalSources = new Set();
      const titleElements = titleRoot
        ? [titleRoot, ...titleRoot.querySelectorAll("*")]
        : [];
      const addCssUrls = (backgroundImage) => {
        for (const match of backgroundImage.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)) {
          criticalSources.add(new URL(match[1], document.baseURI).href);
        }
      };
      for (const element of titleElements) {
        addCssUrls(getComputedStyle(element).backgroundImage);
        addCssUrls(getComputedStyle(element, "::before").backgroundImage);
        addCssUrls(getComputedStyle(element, "::after").backgroundImage);
      }

      const selectorFor = (image) => {
        if (image.id) return `#${image.id}`;
        const classes = [...image.classList].map((name) => `.${name}`).join("");
        return `${image.tagName.toLowerCase()}${classes}`;
      };
      const images = [...document.images].map((image) => {
        const box = image.getBoundingClientRect();
        const currentSrc = image.currentSrc || image.src;
        const titleCritical = Boolean(titleRoot?.contains(image));
        if (titleCritical && currentSrc) criticalSources.add(currentSrc);
        return {
          selector: selectorFor(image),
          currentSrc,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          renderedWidth: box.width,
          renderedHeight: box.height,
          physicalWidth: box.width * dpr,
          physicalHeight: box.height * dpr,
          titleCritical,
        };
      });

      const layers = [...document.querySelectorAll("img[data-title-layer]")].map((image) => {
        const box = image.getBoundingClientRect();
        return {
          layerId: image.getAttribute("data-title-layer"),
          selector: selectorFor(image),
          sourceKind: "img",
          currentSrc: image.currentSrc || image.src,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          renderedWidth: box.width,
          renderedHeight: box.height,
          physicalWidth: box.width * dpr,
          physicalHeight: box.height * dpr,
          titleCritical: Boolean(titleRoot?.contains(image)),
          complete: image.complete,
        };
      });

      const parseUrl = (value) => {
        const match = value?.match(/url\((?:"|')?([^"')]+)(?:"|')?\)/);
        return match ? new URL(match[1], document.baseURI).href : "";
      };
      const stage = document.querySelector(config.sceneAssetSelector ?? ".title-stage");
      const panel = document.querySelector(".title-panel");
      let characterDataUrl = "";
      let character = {
        measurementSource: "asset",
        canonicalWidth: config.canonicalCharacterSize?.width ?? 0,
        canonicalHeight: config.canonicalCharacterSize?.height ?? 0,
        uiOverlapPixels: 0,
      };
      let seam = {
        axis: "vertical",
        kind: "missing",
        physicalX: -1,
        physicalY: -1,
        physicalHeight: 0,
      };
      if (stage) {
        const stageStyle = getComputedStyle(stage);
        const variable = stageStyle.getPropertyValue(config.sceneCssVariable ?? "--scene-src");
        const sceneLayer = document.querySelector('img[data-title-layer="scene"]');
        const sceneUrl = sceneLayer?.currentSrc
          || parseUrl(getComputedStyle(stage, "::after").backgroundImage)
          || parseUrl(stageStyle.backgroundImage)
          || parseUrl(variable);
        if (sceneUrl) {
          const source = sceneLayer ?? new Image();
          if (!sceneLayer) source.src = sceneUrl;
          await source.decode();
          const normalized = config.characterRectNormalized ?? [0, 0, 1, 1];
          const sourceRect = {
            x: normalized[0] * source.naturalWidth,
            y: normalized[1] * source.naturalHeight,
            width: normalized[2] * source.naturalWidth,
            height: normalized[3] * source.naturalHeight,
          };
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sourceRect.width));
          canvas.height = Math.max(1, Math.round(sourceRect.height));
          const context = canvas.getContext("2d");
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(
            source,
            sourceRect.x,
            sourceRect.y,
            sourceRect.width,
            sourceRect.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const pixelData = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          for (let index = 0; index < pixelData.data.length; index += 4) {
            pixelData.data[index + 3] = 255;
          }
          context.putImageData(pixelData, 0, 0);
          characterDataUrl = canvas.toDataURL("image/png");
          character = {
            ...character,
            assetUrl: sceneUrl,
            naturalWidth: source.naturalWidth,
            naturalHeight: source.naturalHeight,
            sourceRect,
          };

          const stageBox = stage.getBoundingClientRect();
          const panelBox = panel?.getBoundingClientRect();
          const pseudo = getComputedStyle(stage, "::after");
          if (payloadClass !== "mobile" && pseudo.display !== "none") {
            const renderedSceneWidth =
              source.naturalWidth * stageBox.height / source.naturalHeight;
            const x = stageBox.right - renderedSceneWidth;
            const y = stageBox.top + stageBox.height * 0.04;
            const end = Math.min(
              panelBox?.top ?? stageBox.top + stageBox.height * 0.16,
              stageBox.top + stageBox.height * 0.16,
            );
            seam = {
              axis: "vertical",
              kind: "scene-extension",
              physicalX: x * dpr,
              physicalY: y * dpr,
              physicalHeight: Math.max(1, end - y) * dpr,
              physicalWidth: 200 * dpr,
            };
          } else if (panelBox) {
            seam = {
              axis: "vertical",
              kind: "scene-parchment",
              physicalX: panelBox.left * dpr,
              physicalY: panelBox.top * dpr,
              physicalHeight: panelBox.height * dpr,
              physicalWidth: 1,
            };
          }
        }
      }

      const resources = performance.getEntriesByType("resource").map((entry) => ({
        url: entry.name,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
        encodedBodySize: entry.encodedBodySize,
        initiatorType: entry.initiatorType,
        criticalPayload: criticalSources.has(entry.name),
      }));
      return {
        images,
        layers,
        geometry: { seam, character },
        characterDataUrl,
        criticalSources: [...criticalSources].sort(),
        resources,
      };
    }, {
      dpr: viewport.dpr,
      config: fidelityCapture,
      payloadClass: viewport.payloadClass,
    }), 60_000, `${name}: browserbevis`);
    phase(`${name}: bevis indsamlet`);

    const characterRelativePath = join("render", `${name}-character.png`);
    if (browserEvidence.characterDataUrl) {
      const encoded = browserEvidence.characterDataUrl.split(",", 2)[1];
      await writeFile(join(outDir, characterRelativePath), Buffer.from(encoded, "base64"));
      browserEvidence.geometry.character.cropPath = characterRelativePath;
    }

    const metrics = {
      screen: screen.id,
      url,
      viewport: {
        id: viewport.id,
        width: viewport.width,
        height: viewport.height,
        dpr: viewport.dpr,
        payloadClass: viewport.payloadClass,
      },
      capture,
      images: browserEvidence.images,
      layers: browserEvidence.layers,
      geometry: browserEvidence.geometry,
      criticalSources: browserEvidence.criticalSources,
      regions: {},
    };
    const { regions, unrenderable } = await measureRegions({
      page,
      screen,
      outDir,
      name,
    });
    metrics.regions = regions;
    metrics.unrenderable = unrenderable;

    await writeFile(
      join(outDir, "metrics", `${name}.json`),
      JSON.stringify(metrics, null, 2),
    );
    await writeFile(
      join(outDir, "resources", `${name}.json`),
      JSON.stringify({
        screen: screen.id,
        url,
        viewport: metrics.viewport,
        entries: browserEvidence.resources,
      }, null, 2),
    );
    return metrics;
  } finally {
    await context.close().catch((err) => {
      console.error(`kunne ikke lukke viewport-contexten pænt: ${err.message}`);
    });
  }
}

/**
 * Den selvstændige capture-CLI's fulde levetid, gjort importerbar så både
 * succes- og fejlstier kan prøves. Registry valideres før serverstart; efter
 * serverstart lukkes browser og preview altid, også hvis Chromium-launch eller
 * et screenshot fejler.
 */
export async function runCapture({
  want = "all",
  viewports = "native",
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
      const selectedViewports = viewports === "registered"
        ? registry.viewports.map((viewport) => ({ ...viewport, registered: true }))
        : [nativeViewport(screen)];
      for (const viewport of selectedViewports) {
        const metrics = await captureScreenFn(
          browser,
          screen,
          outDir,
          viewport,
          registry.goalMetrics?.capture ?? {},
        );
        results.push({ screen, viewport, metrics });
      }
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
  const viewports = valueOf(args, "--viewports") ?? "native";
  if (!["native", "registered"].includes(viewports)) {
    throw new Error(`Ukendt --viewports "${viewports}". Brug native eller registered.`);
  }
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/latest");

  const results = await runCapture({ want, viewports, outDir });
  for (const { screen, viewport, metrics } of results) {
    const missing = Object.entries(metrics.regions)
      .filter(([, value]) => value.missing)
      .map(([k]) => k);
    console.log(
      `optaget ${screen.id}/${viewport.id} (${viewport.width}×${viewport.height} DPR${viewport.dpr})` +
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
