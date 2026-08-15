#!/usr/bin/env node
/**
 * Optager tests/improvise-feature-off-layout.json på ny.
 *
 * Hvorfor findes den: den forrige baseline var håndlavet, og den nåede at
 * fryse en FEJL. Den registrerede scrollWidth 473 på et 390 px viewport —
 * altså 83 px vandret overløb på mobil — som "forventet". Da overløbet blev
 * rettet, begyndte testen at dumpe den KORREKTE build og ville have bestået
 * den ødelagte. En baseline uden optager rådner, fordi ingen tør genskabe den
 * i hånden.
 *
 * Derfor er dette script en port, ikke bare en skriver: det NÆGTER at optage
 * et layout med vandret overløb. Tal kan ændre sig frit; invarianten kan ikke
 * fryses væk igen.
 *
 *   node tools/record_layout_baseline.mjs          # optag og skriv
 *   node tools/record_layout_baseline.mjs --dry    # vis hvad der ville ske
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { ORIGIN, startServer, stopServer } from "./judge/capture.mjs";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { createVisualRunDir } from "./judge/visual-regression.mjs";

const BASELINE_PATH = "tests/improvise-feature-off-layout.json";
const SCENARIO = "/?scenario=act1-opening&freeze=1";

export function assertNoHorizontalOverflow(name, clientWidth, scrollWidth) {
  if (scrollWidth > clientWidth) {
    throw new Error(
      `${name}: vandret overløb (scrollWidth ${scrollWidth} > clientWidth ${clientWidth}). ` +
        "Baseline nægter at fryse et overløb — ret layoutet først.",
    );
  }
}

async function measure(browser, viewport, selectors, runDir, name) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ORIGIN}${SCENARIO}`, { waitUntil: "load" });
  await page.waitForSelector("html[data-ready='true']");
  const measured = await page.evaluate((selectorList) => {
    const rects = {};
    for (const selector of selectorList) {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`selektor findes ikke i DOM'en: ${selector}`);
      rects[selector] = {
        x: Number(rect.x.toFixed(3)),
        y: Number(rect.y.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
      };
    }
    const style = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`selektor findes ikke i DOM'en: ${selector}`);
      return getComputedStyle(element);
    };
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rects,
      styles: {
        headerFlexWrap: style("header").flexWrap,
        toolsFlexWrap: style("#tools").flexWrap,
        dockDisplay: style("#dock").display,
        dockGridTemplateColumns: style("#dock").gridTemplateColumns,
        narratorTop: style("#bubble").top,
        bookWidth: style("#book-panel").width,
      },
    };
  }, selectors);

  assertNoHorizontalOverflow(name, measured.clientWidth, measured.scrollWidth);

  const shot = join(runDir, `${name}.png`);
  await page.screenshot({ path: shot });
  const signature = JSON.parse(
    execFileSync("python3", ["tools/screenshot_signature.py", shot], {
      stdio: "pipe",
    }).toString("utf8"),
  );
  await page.close();
  return { ...measured, signature };
}

/** Gengiver filens håndskrevne format præcist: rect-objekter på én linje og
 * signaturer i blokke à 24 tal. Uden det bliver en genoptagelse til en diff på
 * 500 linjer, hvor de tre tal der faktisk flyttede sig ikke kan ses. Formatet
 * er bevist ved rundtur i tests/layout-baseline-recorder.test.ts. */
export function serialiseBaseline(baseline) {
  const rect = (r) =>
    `{ "x": ${r.x}, "y": ${r.y}, "width": ${r.width}, "height": ${r.height} }`;
  const lines = [];
  lines.push("{");
  lines.push(`  "schemaVersion": ${baseline.schemaVersion},`);
  lines.push(`  "sourceCommit": ${JSON.stringify(baseline.sourceCommit)},`);
  if (baseline.recordedAt !== undefined) {
    lines.push(`  "recordedAt": ${JSON.stringify(baseline.recordedAt)},`);
  }
  if (baseline.note !== undefined) {
    lines.push(`  "note": ${JSON.stringify(baseline.note)},`);
  }
  lines.push(`  "maxRectDelta": ${baseline.maxRectDelta},`);
  lines.push(`  "maxSignatureMeanDelta": ${baseline.maxSignatureMeanDelta},`);
  lines.push(`  "selectors": [`);
  lines.push(
    baseline.selectors.map((s) => `    ${JSON.stringify(s)}`).join(",\n"),
  );
  lines.push(`  ],`);
  lines.push(`  "viewports": {`);
  const viewportNames = Object.keys(baseline.viewports);
  viewportNames.forEach((name, viewportIndex) => {
    const v = baseline.viewports[name];
    lines.push(`    ${JSON.stringify(name)}: {`);
    lines.push(`      "width": ${v.width},`);
    lines.push(`      "height": ${v.height},`);
    lines.push(`      "isMobile": ${v.isMobile},`);
    lines.push(`      "clientWidth": ${v.clientWidth},`);
    lines.push(`      "scrollWidth": ${v.scrollWidth},`);
    lines.push(`      "rects": {`);
    const selectors = Object.keys(v.rects);
    selectors.forEach((selector, index) => {
      const tail = index === selectors.length - 1 ? "" : ",";
      lines.push(
        `        ${JSON.stringify(selector)}: ${rect(v.rects[selector])}${tail}`,
      );
    });
    lines.push(`      },`);
    lines.push(`      "styles": {`);
    const styleKeys = Object.keys(v.styles);
    styleKeys.forEach((key, index) => {
      const tail = index === styleKeys.length - 1 ? "" : ",";
      lines.push(
        `        ${JSON.stringify(key)}: ${JSON.stringify(v.styles[key])}${tail}`,
      );
    });
    lines.push(`      },`);
    lines.push(`      "signature": [`);
    for (let i = 0; i < v.signature.length; i += 24) {
      const chunk = v.signature.slice(i, i + 24).join(",");
      const tail = i + 24 >= v.signature.length ? "" : ",";
      lines.push(`        ${chunk}${tail}`);
    }
    lines.push(`      ]`);
    lines.push(`    }${viewportIndex === viewportNames.length - 1 ? "" : ","}`);
  });
  lines.push(`  }`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const runDir = createVisualRunDir(process.cwd());
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, viewport] of Object.entries(baseline.viewports)) {
      const measured = await measure(
        browser,
        viewport,
        baseline.selectors,
        runDir,
        name,
      );
      Object.assign(viewport, measured);
      console.log(
        `${name}: clientWidth ${measured.clientWidth}, scrollWidth ${measured.scrollWidth} — intet overløb`,
      );
    }
  } finally {
    await browser.close();
    await stopServer(server);
    rmSync(runDir, { recursive: true, force: true });
  }

  baseline.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    stdio: "pipe",
  })
    .toString("utf8")
    .trim();
  baseline.recordedAt = new Date().toISOString().slice(0, 10);

  if (dry) {
    console.log("--dry: skrev ikke", BASELINE_PATH);
    return;
  }
  writeFileSync(BASELINE_PATH, serialiseBaseline(baseline), "utf8");
  console.log(`skrev ${BASELINE_PATH} @ ${baseline.sourceCommit.slice(0, 7)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
