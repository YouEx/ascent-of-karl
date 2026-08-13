// TASK-030: den langsomme, ægte visuelle regressionstest. Kører den
// RIGTIGE optagelse (bygger, server via vite preview, en rigtig Chromium
// via Playwright) og den rigtige Python-scoring — sekunder, ikke
// millisekunder, derfor et eget spor (npm run test:visual, se
// vitest.visual.config.ts) og udelukket fra npm test's hurtige sti
// (vite.config.ts's exclude).
//
// Sammenligner mod tests/visual-baseline.json (TASK-029, seedet fra en
// eksplicit accepteret, frisk måling på commit 429849d) og fejler, hvis
// EN region falder mere end 0,02 under sit baseline-tal — samme margen
// som accept-portens egen maxDrop i tools/judge/apply.mjs (CON-002), så
// "regression" betyder det samme overalt i systemet.
//
// Kun én server ad gangen (CON-004): capture.mjs's egen main() bygger,
// starter og lukker vite preview på fast port 5199 i en finally-blok, så
// vi genbruger CLI'en i stedet for at duplikere serverstyringen her.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASELINE_PATH = join(ROOT, "tests/visual-baseline.json");
const MAX_DROP = 0.02; // samme værdi som apply.mjs's acceptGate({ maxDrop })

// Vitest's eget testtimeout — kald under det er hver for sig kortere
// (capture ~30-60s, scoring et par sekunder), men bygning+browser-boot kan
// svinge på en travl maskine.
const TEST_TIMEOUT_MS = 180_000;

describe("TASK-030: langsom visuel regression mod tests/visual-baseline.json", () => {
  it(
    "optager og måler live, og fejler hvis en region er faldet mere end 0,02 under baseline",
    () => {
      const runDir = mkdtempSync(join(ROOT, ".judge", "visual-test-"));
      try {
        execFileSync(
          "node",
          ["tools/judge/capture.mjs", "--screen", "all", "--out", runDir],
          { cwd: ROOT, stdio: "pipe", timeout: 150_000 },
        );
        const scoresRaw = execFileSync(
          "python3",
          ["tools/judge/metrics.py", "--run", runDir, "--json"],
          { cwd: ROOT, timeout: 60_000 },
        );
        const scores = JSON.parse(scoresRaw.toString("utf8"));
        const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

        expect(baseline.schemaVersion).toBe(1);
        expect(baseline.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(baseline.maxDrop).toBe(MAX_DROP);
        expect(Object.keys(baseline.screens).sort()).toEqual(Object.keys(scores.screens).sort());

        const regressions: string[] = [];
        for (const [screenId, screenBaseline] of Object.entries(baseline.screens) as [
          string,
          { regions: Record<string, number> },
        ][]) {
          const measuredScreen = scores.screens[screenId];
          if (!measuredScreen) {
            regressions.push(`${screenId}: findes ikke i den nye måling`);
            continue;
          }
          expect(Object.keys(screenBaseline.regions).sort()).toEqual(
            Object.keys(measuredScreen.regions).sort(),
          );
          for (const [regionId, baseScore] of Object.entries(screenBaseline.regions)) {
            const region = measuredScreen.regions[regionId];
            if (!region) {
              regressions.push(`${screenId}/${regionId}: regionen findes ikke i den nye måling`);
              continue;
            }
            const drop = baseScore - region.overall;
            if (drop > MAX_DROP) {
              regressions.push(
                `${screenId}/${regionId}: faldt ${drop.toFixed(4)} under baseline ` +
                  `(${baseScore} → ${region.overall.toFixed(4)})`,
              );
            }
          }
        }

        expect(regressions, regressions.join("\n")).toEqual([]);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
