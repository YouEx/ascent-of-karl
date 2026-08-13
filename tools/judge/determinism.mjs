#!/usr/bin/env node
/**
 * Determinisme-porten — TEST-001 som eksekverbar kode, ikke kun prosa.
 *
 * Planen sagde længe "to optagelser skal give identisk SHA-256". Det gør de
 * ikke (se src/ui/tokens.css' body::after og tools/art/build_body_grain.mjs
 * for hele diagnosen): Chromiums rendering/kompositering af grain-laget er
 * ikke bit-for-bit reproducerbar, selv efter kornet blev bagt til en statisk
 * fil. Kravet blev derfor lempet til en MÅLT tolerance — men en tolerance,
 * der kun står som tekst i en plan, er en påstand. Dette script er den, der
 * rent faktisk fælder dom.
 *
 * To trin, i rækkefølge:
 *   1. Komparatorens egen selvtest (determinism_compare.py --selftest) —
 *      beviser med syntetiske, kendte billeder at grænsen (100 afvigende
 *      pixel, maks. kanaldelta 12/255) består PRÆCIS på grænsen og fejler
 *      lige over den, på BEGGE akser. Kører FØRST: et målebånd, man ikke har
 *      efterprøvet, må ikke få lov at dømme noget som helst.
 *   2. `--runs` (mindst 8, default 8) uafhængige optagelser af samme skærm
 *      mod produktions-previewet (CON-004). Hver optagelse er en FRISK
 *      Chromium-PROCES (chromium.launch() pr. kørsel, ikke én genbrugt
 *      browser med flere sidegenindlæsninger) — det er nøjagtigt den
 *      metodologi, der oprindeligt afslørede ikke-determinismen
 *      (`node tools/judge/capture.mjs --screen game` kørt flere gange, hver
 *      gang en ny proces). At genbruge én browserinstans ville teste en
 *      anden, svagere hypotese end den, defekten faktisk blev fundet under.
 *      Alle par sammenlignes (C(runs,2) par), ikke kun mod én kanonisk
 *      kørsel, så den rapporterede værste afvigelse er den SANDE værste på
 *      tværs af samtlige kørsler.
 *
 * Serveren (vite build + vite preview) startes ÉN gang og genbruges til alle
 * kørsler — det er selve indholdet, der skal være stabilt for at teste
 * RENDERINGENS determinisme; at genstarte serveren for hver kørsel ville
 * blot gentage byggeriet uden at styrke testen.
 *
 * Kør: node tools/judge/determinism.mjs [--runs N] [--screen game] [--out DIR]
 * Se plan/architecture-visual-judge-1.md TASK-006, TEST-001.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureScreen, loadRegistry, startServer, stopServer } from "./capture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMPARATOR = join(ROOT, "tools/judge/determinism_compare.py");
const MIN_RUNS = 8;
const MAX_PIXELS = 100;
const MAX_DELTA = 12;

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function runComparatorSelftest() {
  console.log("· komparator-selvtest (syntetiske grænsetilfælde: 100/12 består, 101 eller 13 fejler)…");
  const res = spawnSync("python3", [COMPARATOR, "--selftest"], { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error("determinisme-komparatorens SELVTEST fejlede — stopper før nogen rigtig optagelse. Et uefterprøvet målebånd må ikke dømme.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(valueOf(args, "--runs") ?? MIN_RUNS);
  if (!Number.isInteger(runs) || runs < MIN_RUNS) {
    throw new Error(`TEST-001 kræver mindst ${MIN_RUNS} kørsler i én invokation, fik --runs ${runs}`);
  }
  const screenId = valueOf(args, "--screen") ?? "game";
  const outDir = resolve(ROOT, valueOf(args, "--out") ?? ".judge/determinism");

  runComparatorSelftest();

  const registry = await loadRegistry();
  const screen = registry.screens.find((s) => s.id === screenId);
  if (!screen) {
    throw new Error(`ukendt skærm "${screenId}". Kendte: ${registry.screens.map((s) => s.id).join(", ")}`);
  }

  rmSync(outDir, { recursive: true, force: true });

  console.log("· bygger og starter produktions-previewet (CON-004)…");
  const server = await startServer();
  const paths = [];
  try {
    for (let i = 1; i <= runs; i++) {
      // FRISK browserproces pr. kørsel — se filhovedet for hvorfor.
      const browser = await chromium.launch();
      try {
        const runDir = join(outDir, `run${i}`);
        await captureScreen(browser, screen, runDir);
        paths.push(join(runDir, "render", `${screen.id}.png`));
        console.log(`  kørsel ${i}/${runs} optaget`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await stopServer(server);
  }

  const nPairs = (paths.length * (paths.length - 1)) / 2;
  console.log(`· sammenligner ${paths.length} kørsler parvist (${nPairs} par), grænse ${MAX_PIXELS}px / delta ${MAX_DELTA}…`);
  const res = spawnSync(
    "python3",
    [
      COMPARATOR,
      "--paths", ...paths,
      "--max-pixels", String(MAX_PIXELS),
      "--max-delta", String(MAX_DELTA),
      "--out", outDir,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  process.exit(res.status ?? 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
