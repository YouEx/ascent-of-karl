#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  ORIGIN as CAPTURE_ORIGIN,
  startServer,
  stopServer,
} from "../judge/capture.mjs";
import {
  captureSnapshot,
  captureFixtureScreenshot,
  containsOrderedSubsequence,
  createDiagnostics,
  eventTypes,
  normalizeParitySnapshot,
  runFixtureFlow,
  urlFor,
} from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINES = path.join(ROOT, "tests/parity/legacy");
const requestedOrigin = process.argv.find((argument) =>
  argument.startsWith("http"),
);
let ownedServer;
const ORIGIN = requestedOrigin ?? CAPTURE_ORIGIN;
const scratch = mkdtempSync(path.join(ROOT, ".judge", "parity-"));
let succeeded = false;

function stable(value) {
  return JSON.stringify(value);
}

if (!requestedOrigin) ownedServer = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  for (const file of readdirSync(BASELINES)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const baseline = JSON.parse(readFileSync(path.join(BASELINES, file), "utf8"));
    const { fixture } = baseline;
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
    if (
      fixture.expectedEvents &&
      !containsOrderedSubsequence(
        eventTypes(snapshot.productEvents),
        fixture.expectedEvents,
      )
    ) {
      throw new Error(
        `${fixture.id}: missing ordered product events ${fixture.expectedEvents.join(
          " -> ",
        )}; got ${eventTypes(snapshot.productEvents).join(" -> ")}`,
      );
    }
    if (
      stable(normalizeParitySnapshot(snapshot, baseline.snapshot, fixture)) !==
      stable(
        normalizeParitySnapshot(
          baseline.snapshot,
          baseline.snapshot,
          fixture,
        ),
      )
    ) {
      writeFileSync(
        path.join(scratch, `${fixture.id}-actual.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
      throw new Error(
        `${fixture.id}: DOM/copy/focus/save/network differs; actual in ${path.relative(
          ROOT,
          path.join(scratch, `${fixture.id}-actual.json`),
        )}`,
      );
    }
    const actualPng = path.join(scratch, `${fixture.id}.png`);
    await captureFixtureScreenshot(page, fixture, actualPng);
    execFileSync(
      "python3",
      [
        "-c",
        [
          "from PIL import Image, ImageChops",
          "import sys",
          "a=Image.open(sys.argv[1]).convert('RGBA')",
          "b=Image.open(sys.argv[2]).convert('RGBA')",
          "assert a.size==b.size, (a.size,b.size)",
          "d=ImageChops.difference(a,b)",
          "assert d.getbbox() is None, f'{sum(1 for p in d.getdata() if p!=(0,0,0,0))} pixels differ'",
        ].join(";"),
        path.join(BASELINES, `${fixture.id}.png`),
        actualPng,
      ],
      { stdio: "inherit" },
    );
    await page.close();
    console.log(`parity ${fixture.id}: exact`);
  }
  succeeded = true;
} finally {
  await browser.close();
  if (ownedServer) await stopServer(ownedServer);
  if (succeeded) rmSync(scratch, { recursive: true, force: true });
}
