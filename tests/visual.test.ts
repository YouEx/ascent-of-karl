// TASK-030: den langsomme, ægte visuelle regressionstest. Kører den
// RIGTIGE optagelse (bygger, server via vite preview, en rigtig Chromium
// via Playwright) og den rigtige Python-scoring — sekunder, ikke
// millisekunder, derfor et eget spor (npm run test:visual, se
// vitest.visual.config.ts) og udelukket fra npm test's hurtige sti
// (vite.config.ts's exclude).
//
// Sammenligner mod tests/visual-baseline.json (TASK-029, seedet fra en
// eksplicit accepteret, frisk måling på commit 429849d) og fejler, hvis
// ét overall- ELLER aspekttal falder mere end 0,02 under sit baseline-tal —
// samme margen og samme fire-decimalers normalisering
// som accept-portens egen maxDrop i tools/judge/apply.mjs (CON-002), så
// "regression" betyder det samme overalt i systemet.
//
// Capture-CLI'en køres i sin egen procesgruppe. Ved timeout/non-zero exit
// rammes gruppen med sin konkrete PID (aldrig pkill/killall), så Vite og
// Chromium ikke kan overleve den testproces, der ejede dem.
import { describe, expect, it } from "vitest";
import { rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
// @ts-expect-error — dommerværktøjerne er ren JavaScript uden typedeklaration.
import { runProcessGroup } from "../tools/judge/process-group.mjs";
// @ts-expect-error — dommerværktøjerne er ren JavaScript uden typedeklaration.
import { collectScoreRegressions } from "../tools/judge/score-tolerance.mjs";
// @ts-expect-error — dommerværktøjerne er ren JavaScript uden typedeklaration.
import { createVisualRunDir } from "../tools/judge/visual-regression.mjs";
// @ts-expect-error — capture-værktøjet er ren JavaScript uden typedeklaration.
import { ORIGIN, startServer, stopServer } from "../tools/judge/capture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASELINE_PATH = join(ROOT, "tests/visual-baseline.json");
const FEATURE_OFF_LAYOUT_PATH = join(
  ROOT,
  "tests/improvise-feature-off-layout.json",
);
const MAX_DROP = 0.02;

// Vitest's eget testtimeout — kald under det er hver for sig kortere
// (capture ~30-60s, scoring et par sekunder), men bygning+browser-boot kan
// svinge på en travl maskine.
const TEST_TIMEOUT_MS = 180_000;

describe("TASK-030: langsom visuel regression mod tests/visual-baseline.json", () => {
  it(
    "optager og måler live, og fejler hvis et overall- eller aspekttal falder mere end 0,02",
    async () => {
      const runDir = createVisualRunDir(ROOT);
      try {
        await runProcessGroup(
          process.execPath,
          ["tools/judge/capture.mjs", "--screen", "all", "--out", runDir],
          { cwd: ROOT, timeoutMs: 150_000 },
        );
        const { stdout: scoresRaw } = await runProcessGroup(
          "python3",
          ["tools/judge/metrics.py", "--run", runDir, "--json"],
          { cwd: ROOT, timeoutMs: 60_000 },
        );
        const scores = JSON.parse(scoresRaw);
        const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

        expect(baseline.schemaVersion).toBe(1);
        expect(baseline.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(baseline.maxDrop).toBe(MAX_DROP);
        expect(Object.keys(baseline.screens).sort()).toEqual(Object.keys(scores.screens).sort());

        for (const [screenId, screenBaseline] of Object.entries(baseline.screens) as [
          string,
          { regions: Record<string, Record<string, number>> },
        ][]) {
          const measuredScreen = scores.screens[screenId];
          expect(measuredScreen, `${screenId}: findes ikke i den nye måling`).toBeTruthy();
          expect(Object.keys(screenBaseline.regions).sort()).toEqual(
            Object.keys(measuredScreen.regions).sort(),
          );
        }

        const regressions = collectScoreRegressions(baseline, scores, {
          maxDrop: baseline.maxDrop,
        });
        expect(
          regressions,
          regressions.map((entry: any) => `${entry.region}: fald ${entry.drop.toFixed(4)}`).join("\n"),
        ).toEqual([]);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "matcher main-layout og screenshot-signatur feature-off på mobil og desktop",
    async () => {
      const baseline = JSON.parse(
        readFileSync(FEATURE_OFF_LAYOUT_PATH, "utf8"),
      );
      const runDir = createVisualRunDir(ROOT);
      let server;
      let browser;
      try {
        server = await startServer();
        browser = await chromium.launch({ headless: true });
        for (const [name, expected] of Object.entries(
          baseline.viewports,
        ) as [string, any][]) {
          const page = await browser.newPage({
            viewport: { width: expected.width, height: expected.height },
            screen: { width: expected.width, height: expected.height },
            isMobile: expected.isMobile,
            hasTouch: expected.isMobile,
            deviceScaleFactor: 1,
          });
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.goto(
            `${ORIGIN}/?scenario=act1-opening&freeze=1`,
            { waitUntil: "load" },
          );
          await page.waitForSelector("html[data-ready='true']");
          const actual = await page.evaluate((selectors) => {
            const rects: Record<string, Record<string, number>> = {};
            for (const selector of selectors) {
              const rect = document
                .querySelector(selector)
                ?.getBoundingClientRect();
              if (!rect) continue;
              rects[selector] = {
                x: Number(rect.x.toFixed(3)),
                y: Number(rect.y.toFixed(3)),
                width: Number(rect.width.toFixed(3)),
                height: Number(rect.height.toFixed(3)),
              };
            }
            const header = getComputedStyle(
              document.querySelector("header")!,
            );
            const tools = getComputedStyle(
              document.querySelector("#tools")!,
            );
            const dock = getComputedStyle(
              document.querySelector("#dock")!,
            );
            const narrator = getComputedStyle(
              document.querySelector("#narrator")!,
            );
            const book = getComputedStyle(
              document.querySelector("#book-panel")!,
            );
            return {
              featureEnabled:
                document.documentElement.hasAttribute(
                  "data-improvise-enabled",
                ),
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              rects,
              styles: {
                headerFlexWrap: header.flexWrap,
                toolsFlexWrap: tools.flexWrap,
                dockDisplay: dock.display,
                dockGridTemplateColumns: dock.gridTemplateColumns,
                narratorTop: narrator.top,
                bookWidth: book.width,
              },
            };
          }, baseline.selectors);

          expect(actual.featureEnabled, `${name}: feature-root`).toBe(false);
          expect(actual.clientWidth, `${name}: clientWidth`).toBe(
            expected.clientWidth,
          );
          expect(actual.scrollWidth, `${name}: scrollWidth`).toBe(
            expected.scrollWidth,
          );
          expect(actual.styles, `${name}: computed styles`).toEqual(
            expected.styles,
          );
          for (const [selector, expectedRect] of Object.entries(
            expected.rects,
          ) as [string, Record<string, number>][]) {
            const actualRect = actual.rects[selector];
            expect(actualRect, `${name}: ${selector}`).toBeTruthy();
            for (const field of ["x", "y", "width", "height"]) {
              expect(
                Math.abs(actualRect![field]! - expectedRect[field]!),
                `${name}: ${selector}.${field}`,
              ).toBeLessThanOrEqual(baseline.maxRectDelta);
            }
          }

          const screenshotPath = join(runDir, `${name}.png`);
          await page.screenshot({ path: screenshotPath });
          const signature = JSON.parse(
            execFileSync(
              "python3",
              ["tools/screenshot_signature.py", screenshotPath],
              { cwd: ROOT, stdio: "pipe" },
            ).toString("utf8"),
          ) as number[];
          const meanDelta =
            signature.reduce(
              (sum, value, index) =>
                sum + Math.abs(value - expected.signature[index]),
              0,
            ) / signature.length;
          expect(
            meanDelta,
            `${name}: screenshot-signatur`,
          ).toBeLessThanOrEqual(baseline.maxSignatureMeanDelta);
          await page.close();
        }
      } finally {
        if (browser) await browser.close();
        if (server) await stopServer(server);
        rmSync(runDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
