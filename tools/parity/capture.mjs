#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  FIXTURES,
  captureFixtureScreenshot,
  captureSnapshot,
  createDiagnostics,
  runFixtureFlow,
  urlFor,
} from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT = path.join(ROOT, "tests/parity/legacy");
const ORIGIN =
  process.argv.find((argument) => argument.startsWith("http")) ??
  "https://youex.github.io/ascent-of-karl/";

mkdirSync(OUTPUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const fixture of FIXTURES) {
    const page = await browser.newPage({
      viewport: { width: fixture.width, height: fixture.height },
      screen: { width: fixture.width, height: fixture.height },
      isMobile: fixture.isMobile,
      hasTouch: fixture.isMobile,
      deviceScaleFactor: 1,
    });
    const diagnostics = createDiagnostics(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(urlFor(ORIGIN, fixture.scenario), {
      waitUntil: "load",
    });
    await page.waitForSelector("html[data-ready='true']");
    await runFixtureFlow(page, fixture);
    const snapshot = await captureSnapshot(page, fixture, diagnostics);
    writeFileSync(
      path.join(OUTPUT, `${fixture.id}.json`),
      `${JSON.stringify({ fixture, snapshot }, null, 2)}\n`,
    );
    await captureFixtureScreenshot(
      page,
      fixture,
      path.join(OUTPUT, `${fixture.id}.png`),
    );
    await page.close();
    console.log(`captured ${fixture.id} from ${ORIGIN}`);
  }
} finally {
  await browser.close();
}
