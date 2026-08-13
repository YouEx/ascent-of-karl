import { execFile } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, "artifacts");
const URL = process.env.PLAYTEST_URL ?? "http://127.0.0.1:5199/";
const SAVE_KEY = "kolde-karl-save-v1";
const IMPROVISATION_LOG_KEY = "karl-playtest-improvisation-v2";
const RUN_CAP = 6;
const WEBP_ARGS = [
  "-strip",
  "-colorspace",
  "sRGB",
  "-define",
  "webp:method=6",
  "-define",
  "webp:thread-level=0",
  "-define",
  "webp:use-sharp-yuv=1",
  "-define",
  "webp:exact=true",
  "-quality",
  "82",
];

const RUNS = [
  {
    id: "run-01-desktop-seed-163",
    seed: 163,
    viewport: { width: 1440, height: 1000 },
    input: "keyboard",
    reloadAfterCap: true,
  },
  {
    id: "run-02-mobile-seed-230",
    seed: 230,
    viewport: { width: 390, height: 844 },
    input: "tap",
    mobile: true,
    reloadAfterCap: false,
  },
  {
    id: "run-03-desktop-seed-432",
    seed: 432,
    viewport: { width: 1280, height: 900 },
    input: "mouse",
    reloadAfterCap: false,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pairKey(a, b) {
  return [a, b].sort().join("+");
}

async function readBrowserState(page) {
  return page.evaluate(
    ({ saveKey, improvisationLogKey }) => {
      const save = JSON.parse(localStorage.getItem(saveKey) ?? "null");
      const improvisation = JSON.parse(
        localStorage.getItem(improvisationLogKey) ??
          '{"version":2,"runs":[],"current":[]}',
      );
      return {
        state: save?.state ?? null,
        improvisation,
      };
    },
    { saveKey: SAVE_KEY, improvisationLogKey: IMPROVISATION_LOG_KEY },
  );
}

function feedbackAssessment(label, narrator, status) {
  if (label === "absurd-cold") {
    return {
      understandable: /cold/i.test(narrator),
      note:
        "The line names the solved need; the absurdity is legible from the standing-stone/grass invention.",
    };
  }
  if (label === "rejected-self") {
    return {
      understandable: /could not/i.test(status),
      note:
        "The toast clearly rejects the attempt, but the narrator's joke does not always explain the self-pair specifically.",
    };
  }
  if (label === "depth-1") {
    return {
      understandable: /hunger|shallow|step/i.test(narrator),
      note:
        "The narrator connects the accepted invention to the still-unsolved hunger need.",
    };
  }
  if (label === "plausible-hunger") {
    return {
      understandable: /hunger/i.test(narrator),
      note: "The line explicitly says the invention answers Karl's hunger.",
    };
  }
  if (label === "depth-limit") {
    return {
      understandable: /cannot be taken any further/i.test(status),
      note: "The status states the depth boundary directly.",
    };
  }
  if (label === "reuse") {
    return {
      understandable: /already invented/i.test(status),
      note: "The status distinguishes reuse from a new invention.",
    };
  }
  if (label === "run-limit") {
    return {
      understandable: /all 6 inventions/i.test(status),
      note:
        "The cap toast is explicit. A simultaneously spawned challenge owns the narrator line, so the cap's narrator family is masked in this turn.",
    };
  }
  return null;
}

async function capture(page, runDir, filename, fullPage = false) {
  assert(
    filename.endsWith(".webp"),
    `Final evidence filename must be WebP: ${filename}`,
  );
  const output = path.join(runDir, filename);
  const temporary = `${output}.tmp.png`;
  try {
    await page.screenshot({ path: temporary, fullPage });
    await execFileAsync("magick", [
      temporary,
      ...WEBP_ARGS,
      output,
    ]);
    const converted = await stat(output);
    assert(converted.size > 0, `ImageMagick created an empty WebP: ${filename}`);
  } catch (error) {
    await rm(output, { force: true });
    throw new Error(
      `Failed to convert ${filename} with ImageMagick: ${error.message}`,
    );
  } finally {
    await rm(temporary, { force: true });
  }
  return path.relative(HERE, output);
}

async function requireImageMagick() {
  try {
    const { stdout } = await execFileAsync("magick", ["-version"]);
    assert(
      /\bwebp\b/i.test(stdout),
      "ImageMagick is installed without WebP support",
    );
  } catch (error) {
    throw new Error(
      `ImageMagick 7 with WebP support is required before capture: ${error.message}`,
    );
  }
}

async function useControl(page, locator, input) {
  if (input === "keyboard") {
    await locator.focus();
    await page.keyboard.press("Enter");
    return;
  }
  if (input === "tap") {
    await locator.tap();
    return;
  }
  await locator.click();
}

async function runPlaytest(browser, config) {
  const runDir = path.join(ARTIFACTS, config.id);
  await mkdir(runDir, { recursive: true });
  const context = await browser.newContext({
    viewport: config.viewport,
    screen: config.viewport,
    reducedMotion: "reduce",
    isMobile: config.mobile ?? false,
    hasTouch: config.mobile ?? false,
    deviceScaleFactor: config.mobile ? 2 : 1,
  });
  await context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new globalThis.URL(URL).origin },
  );
  await context.addInitScript((seed) => {
    let calls = 0;
    const seeded = seed / 2147483648;
    Math.random = () => (calls++ < 2 ? seeded : 0.5);
  }, config.seed);

  const page = await context.newPage();
  const browserRequests = [];
  page.on("request", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType())) {
      browserRequests.push({
        method: request.method(),
        url: request.url(),
      });
    }
  });

  const attempts = [];
  const screenshots = [];
  let persistence = null;

  try {
    await page.goto(URL, { waitUntil: "networkidle" });
    screenshots.push(await capture(page, runDir, "01-title.webp"));
    const featureState = await page.evaluate(() => ({
      enabled:
        document.documentElement.dataset.improviseEnabled === "true",
      statusHost: document.getElementById("improvise-status-host") !== null,
    }));
    assert(featureState.enabled, `${config.id}: feature flag was not enabled`);
    assert(featureState.statusHost, `${config.id}: improvisation status UI missing`);

    await useControl(page, page.locator("#t-primary"), config.input);
    await page.waitForSelector("#grid .element");
    await page.waitForFunction(
      (saveKey) => localStorage.getItem(saveKey) !== null,
      SAVE_KEY,
    );

    async function attempt(a, b, options) {
      const controlInput =
        options.input ?? (config.input === "tap" ? "tap" : "mouse");
      const before = await readBrowserState(page);
      assert(before.state, `${config.id}/${options.label}: save state missing`);

      const first = page.locator(`#grid .element[data-id="${a}"]`);
      const second = page.locator(`#grid .element[data-id="${b}"]`);
      assert(
        (await first.count()) === 1 && (await second.count()) === 1,
        `${config.id}/${options.label}: pair is not available: ${a} + ${b}`,
      );

      await useControl(page, first, controlInput);
      await useControl(page, second, controlInput);
      if (options.selectionScreenshot) {
        screenshots.push(
          await capture(page, runDir, options.selectionScreenshot),
        );
      }
      await useControl(
        page,
        page.locator("#combine"),
        controlInput,
      );
      await page.waitForTimeout(80);

      const cardVisible = await page.locator("#card").isVisible();
      const cardText = cardVisible
        ? (await page.locator("#card").innerText()).trim()
        : null;
      if (options.cardScreenshot) {
        assert(cardVisible, `${config.id}/${options.label}: expected card missing`);
        screenshots.push(
          await capture(page, runDir, options.cardScreenshot),
        );
      }

      const narrator = (await page.locator("#narrator-text").innerText()).trim();
      const status = (
        await page.locator("#improvise-status-host").innerText()
      ).trim();
      const after = await readBrowserState(page);
      assert(after.state, `${config.id}/${options.label}: state missing after attempt`);

      const beforeIds = new Set(before.state.discovered);
      const newDiscoveries = after.state.discovered.filter(
        (id) => !beforeIds.has(id),
      );
      const beforeSolved = new Set(before.state.solvedProblems);
      const newlySolved = after.state.solvedProblems.filter(
        (id) => !beforeSolved.has(id),
      );
      const newImprovisation =
        after.state.improvisedElements.length >
        before.state.improvisedElements.length
          ? after.state.improvisedElements.at(-1)
          : null;
      const logBefore = before.improvisation.current ?? [];
      const logAfter = after.improvisation.current ?? [];
      const improvisationRecord =
        logAfter.length > logBefore.length ? logAfter.at(-1) : null;
      const outcome = improvisationRecord
        ? improvisationRecord.outcome
        : newDiscoveries.length
          ? "canonical-discovery"
          : "canonical-known";

      const record = {
        label: options.label,
        pair: pairKey(a, b),
        parents: [a, b],
        expectedVerdict: options.verdict ?? null,
        outcome,
        canonicalResult: options.canonicalResult ?? null,
        invention: newImprovisation
          ? {
              id: newImprovisation.id,
              name: newImprovisation.name,
              depth: newImprovisation.depth,
              kind: newImprovisation.kind,
              stuff: newImprovisation.stuff,
              traits: newImprovisation.traits,
            }
          : null,
        narrator,
        statusToast: status,
        solvedNeed:
          improvisationRecord?.solvedNeed ?? newlySolved[0] ?? null,
        solvedChallenge:
          improvisationRecord?.solvedChallenge ?? null,
        turn: after.state.attempts,
        cap: {
          used: after.state.improvisedElements.length,
          limit: RUN_CAP,
          remaining:
            RUN_CAP - after.state.improvisedElements.length,
        },
        challenge: after.state.challenges.active,
        cardText,
        agentFeedback: feedbackAssessment(
          options.label,
          narrator,
          status,
        ),
      };
      attempts.push(record);

      if (options.expectedOutcome) {
        assert(
          outcome === options.expectedOutcome,
          `${config.id}/${options.label}: ${outcome} != ${options.expectedOutcome}`,
        );
      }
      if (options.expectedNeed) {
        assert(
          record.solvedNeed === options.expectedNeed,
          `${config.id}/${options.label}: did not solve ${options.expectedNeed}`,
        );
      }
      if (options.expectedDepth) {
        assert(
          newImprovisation?.depth === options.expectedDepth,
          `${config.id}/${options.label}: depth ${newImprovisation?.depth} != ${options.expectedDepth}`,
        );
      }
      if (options.expectedStatus) {
        assert(
          status.includes(options.expectedStatus),
          `${config.id}/${options.label}: status "${status}" missing "${options.expectedStatus}"`,
        );
      }
      if (options.expectedCap !== undefined) {
        assert(
          after.state.improvisedElements.length === options.expectedCap,
          `${config.id}/${options.label}: cap use mismatch`,
        );
      }
      if (options.canonicalResult) {
        assert(
          newDiscoveries.includes(options.canonicalResult),
          `${config.id}/${options.label}: canonical result ${options.canonicalResult} missing`,
        );
      }

      if (options.toastScreenshot) {
        screenshots.push(
          await capture(page, runDir, options.toastScreenshot),
        );
      }
      if (cardVisible) await page.locator("#card-close").click();
      return newImprovisation?.id ?? options.canonicalResult ?? null;
    }

    await attempt("sten", "sten", {
      label: "canonical-priority",
      canonicalResult: "gnister",
      expectedOutcome: "canonical-discovery",
      cardScreenshot: "02-canonical-priority-sparks.webp",
      selectionScreenshot:
        config.mobile ? "02a-mobile-tap-selection.webp" : undefined,
      input: config.input,
    });
    await attempt("ler", "vand", {
      label: "canonical-mud",
      canonicalResult: "mudder",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("sten", "mudder", {
      label: "canonical-standing-stone",
      canonicalResult: "bautasten",
      expectedOutcome: "canonical-discovery",
    });
    const cold = await attempt("graes", "bautasten", {
      label: "absurd-cold",
      verdict: "absurd",
      expectedOutcome: "accepted",
      expectedNeed: "kulde",
      expectedDepth: 3,
      expectedCap: 1,
      cardScreenshot: "03-absurd-cold-invention.webp",
    });
    await attempt("sten", "pind", {
      label: "canonical-tool",
      canonicalResult: "stenoekse",
      expectedOutcome: "canonical-discovery",
      expectedNeed: "vaerktoej",
    });
    await attempt("sten", "vand", {
      label: "canonical-round-stone",
      canonicalResult: "rullesten",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("baer", "sten", {
      label: "canonical-cave-painting",
      canonicalResult: "hulemaleri",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("baer", "vand", {
      label: "canonical-juice",
      canonicalResult: "saft",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("ler", "ler", {
      label: "rejected-self",
      expectedOutcome: "rejected",
      expectedStatus: "could not make",
      expectedCap: 1,
      toastScreenshot: "04-rejected-self-toast.webp",
    });
    const depth1 = await attempt("sten", "graes", {
      label: "depth-1",
      verdict: "plausible",
      expectedOutcome: "accepted",
      expectedDepth: 1,
      expectedCap: 2,
    });
    await attempt("stenoekse", "sten", {
      label: "canonical-ore",
      canonicalResult: "malm",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("rullesten", "stenoekse", {
      label: "canonical-wheel",
      canonicalResult: "hjul",
      expectedOutcome: "canonical-discovery",
    });
    const depth2 = await attempt(depth1, "stenoekse", {
      label: "depth-2",
      verdict: "plausible",
      expectedOutcome: "accepted",
      expectedDepth: 2,
      expectedCap: 3,
    });
    const hunger = await attempt("baer", "stenoekse", {
      label: "plausible-hunger",
      verdict: "plausible",
      expectedOutcome: "accepted",
      expectedNeed: "sult",
      expectedDepth: 2,
      expectedCap: 4,
      cardScreenshot: "05-plausible-hunger-invention.webp",
    });
    const depth3 = await attempt(depth2, hunger, {
      label: "depth-3",
      verdict: "plausible",
      expectedOutcome: "accepted",
      expectedDepth: 3,
      expectedCap: 5,
      cardScreenshot: "06-depth-3-invention.webp",
    });
    await attempt(depth3, cold, {
      label: "depth-limit",
      verdict: "plausible",
      expectedOutcome: "rejected",
      expectedStatus: "cannot be taken any further",
      expectedCap: 5,
      toastScreenshot: "07-depth-limit-toast.webp",
    });
    await attempt("graes", "bautasten", {
      label: "reuse",
      verdict: "absurd",
      expectedOutcome: "reused",
      expectedStatus: "already invented",
      expectedCap: 5,
      toastScreenshot: "08-reuse-toast.webp",
    });
    await attempt("gnister", "stenoekse", {
      label: "cap-sixth-invention",
      verdict: "plausible",
      expectedOutcome: "accepted",
      expectedDepth: 2,
      expectedCap: 6,
    });
    await attempt("saft", "stenoekse", {
      label: "run-limit",
      verdict: "absurd",
      expectedOutcome: "rejected",
      expectedStatus: "all 6 inventions",
      expectedCap: 6,
      toastScreenshot: "09-run-limit-and-challenge.webp",
    });

    const beforeBook = await readBrowserState(page);
    assert(
      beforeBook.state.improvisedElements.length === RUN_CAP,
      `${config.id}: chronicle opened before cap six`,
    );
    if (config.mobile) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      await page.locator("#book-btn").click();
      await page.waitForTimeout(80);
    } else {
      await page.locator("#book-panel").scrollIntoViewIfNeeded();
    }
    const chronicleText = (await page.locator("#book-panel").innerText()).trim();
    assert(
      chronicleText.includes("Karl's inventions") &&
        chronicleText.includes(String(RUN_CAP)),
      `${config.id}: chronicle did not show the six inventions`,
    );
    screenshots.push(
      await capture(page, runDir, "10-chronicle-six-inventions.webp"),
    );
    if (config.mobile) await page.locator("#book-close").click();

    if (config.reloadAfterCap) {
      const beforeReload = await readBrowserState(page);
      assert(
        beforeReload.state.challenges.active,
        `${config.id}: capped turn did not leave a challenge to persist`,
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("#t-primary");
      assert(
        (await page.locator("#t-primary").innerText()).trim() === "Continue",
        `${config.id}: reload did not offer Continue`,
      );
      screenshots.push(
        await capture(page, runDir, "11-reload-continue-title.webp"),
      );
      await page.locator("#t-primary").click();
      await page.waitForSelector("#grid .element");
      await page.waitForFunction(
        (saveKey) => localStorage.getItem(saveKey) !== null,
        SAVE_KEY,
      );
      await page.waitForTimeout(80);
      const afterReload = await readBrowserState(page);
      const challengeText = (await page.locator("#challenge").innerText()).trim();
      assert(
        afterReload.state.attempts === beforeReload.state.attempts,
        `${config.id}: reload refunded a summer`,
      );
      assert(
        afterReload.state.improvisedElements.length === RUN_CAP,
        `${config.id}: reload reset the cap`,
      );
      assert(
        afterReload.state.challenges.active?.id ===
          beforeReload.state.challenges.active.id &&
          afterReload.state.challenges.active?.turnsLeft ===
            beforeReload.state.challenges.active.turnsLeft,
        `${config.id}: reload changed the active challenge`,
      );
      persistence = {
        before: {
          attempts: beforeReload.state.attempts,
          inventions: beforeReload.state.improvisedElements.length,
          challenge: beforeReload.state.challenges.active,
        },
        after: {
          attempts: afterReload.state.attempts,
          inventions: afterReload.state.improvisedElements.length,
          challenge: afterReload.state.challenges.active,
          challengeText,
        },
      };
      screenshots.push(
        await capture(page, runDir, "12-resumed-challenge.webp"),
      );
    }

    await attempt("baer", "baer", {
      label: "canonical-seed",
      canonicalResult: "froe",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("pind", "pind", {
      label: "canonical-boomerang",
      canonicalResult: "boomerang",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("froe", "graes", {
      label: "canonical-bird",
      canonicalResult: "fugl",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("fugl", "boomerang", {
      label: "canonical-feather",
      canonicalResult: "fjer",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("fjer", "fjer", {
      label: "canonical-wings",
      canonicalResult: "vinger",
      expectedOutcome: "canonical-discovery",
    });
    await attempt("vinger", "bautasten", {
      label: "ending-icarus",
      canonicalResult: "flyveforsoeg",
      expectedOutcome: "canonical-discovery",
    });

    await page.waitForSelector("#ending:not([hidden])");
    const endingText = (await page.locator("#ending").innerText()).trim();
    assert(
      endingText.includes("The Flight of Karl") &&
        endingText.includes("Karl's inventions"),
      `${config.id}: ending summary missing invention/run summary`,
    );
    screenshots.push(
      await capture(page, runDir, "13-ending-run-summary.webp"),
    );

    await page.locator("#ending-stats").click();
    await page.waitForTimeout(80);
    let shareText;
    if (await page.locator(".playtest-dump").isVisible().catch(() => false)) {
      shareText = await page.locator(".playtest-dump").inputValue();
    } else {
      shareText = await page.evaluate(() => navigator.clipboard.readText());
    }
    const sharePayload = JSON.parse(shareText);
    assert(
      sharePayload.improvisation?.runs?.length === 1,
      `${config.id}: copied playtest log missing completed improvisation run`,
    );
    screenshots.push(
      await capture(page, runDir, "14-copied-playtest-log.webp"),
    );

    const final = await readBrowserState(page);
    const result = {
      schemaVersion: 1,
      run: config,
      url: URL,
      featureState,
      offlineProof: {
        improviseRequests: browserRequests.filter((request) =>
          /\/improvise(?:$|\?)/.test(request.url),
        ),
      },
      goal:
        "Solve cold, tools, and hunger as absurdly as the discovered pool permits while using only the normal UI.",
      attempts,
      persistence,
      chronicleText,
      endingText,
      sharePayload,
      finalState: final.state,
      screenshots,
    };
    assert(
      result.offlineProof.improviseRequests.length === 0,
      `${config.id}: offline run unexpectedly called /improvise`,
    );
    await writeFile(
      path.join(runDir, "run-log.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    await writeFile(
      path.join(runDir, "share-payload.json"),
      `${JSON.stringify(sharePayload, null, 2)}\n`,
    );
    return result;
  } finally {
    await context.close();
  }
}

await requireImageMagick();
await rm(ARTIFACTS, { recursive: true, force: true });
await mkdir(ARTIFACTS, { recursive: true });

const browser = await chromium.launch();
const results = [];
try {
  for (const config of RUNS) {
    results.push(await runPlaytest(browser, config));
    console.log(`✓ ${config.id}`);
  }
} finally {
  await browser.close();
}

await writeFile(
  path.join(ARTIFACTS, "summary.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runs: results.map((result) => ({
        id: result.run.id,
        seed: result.run.seed,
        viewport: result.run.viewport,
        input: result.run.input,
        ending: result.finalState.ended,
        summers: result.finalState.attempts,
        solvedProblems: result.finalState.solvedProblems,
        inventions: result.finalState.improvisedElements.length,
        persistence: result.persistence,
        screenshots: result.screenshots,
      })),
    },
    null,
    2,
  )}\n`,
);

const integrity = await execFileAsync(process.execPath, [
  path.join(HERE, "verify-evidence.mjs"),
]);
console.log(integrity.stdout.trim());
