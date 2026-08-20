export const FIXTURES = [
  {
    id: "title-mobile",
    scenario: "title-fresh",
    width: 390,
    height: 844,
    isMobile: true,
    scope: "#title-screen",
    flow: "none",
  },
  {
    id: "title-desktop",
    scenario: "title-fresh",
    width: 1366,
    height: 768,
    isMobile: false,
    scope: "#title-screen",
    flow: "none",
  },
  {
    id: "game-mobile",
    scenario: "act1-opening",
    width: 390,
    height: 844,
    isMobile: true,
    scope: "#app",
    flow: "none",
  },
  {
    id: "game-desktop",
    scenario: "act1-opening",
    width: 1448,
    height: 1086,
    isMobile: false,
    scope: "#app",
    flow: "none",
  },
  {
    id: "start-desktop",
    scenario: "title-fresh",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#story-book",
    screenshotScope: "#story-book",
    flow: "start",
    expectedEvents: ["life.started"],
    ignoreSaveFields: ["discovered"],
  },
  {
    id: "select-desktop",
    scenario: "act1-opening",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#dock",
    screenshotScope: "#dock",
    flow: "select",
  },
  {
    id: "discovery-desktop",
    scenario: "act1-opening",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#story-book",
    screenshotScope: "#story-book",
    flow: "discovery",
    expectedEvents: [
      "combination.attempted",
      "discovery.canonical",
      "chronicle.entry-recorded",
    ],
  },
  {
    id: "no-fuse-desktop",
    scenario: "act1-opening",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#story-book",
    screenshotScope: "#story-book",
    flow: "no-fuse",
    expectedEvents: [
      "combination.attempted",
      "chronicle.entry-recorded",
    ],
  },
  {
    id: "archive-desktop",
    scenario: "act1-opening",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#book-panel",
    screenshotScope: "#book-panel",
    flow: "archive",
  },
  {
    id: "modal-desktop",
    scenario: "title-fresh",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#trophy-modal",
    screenshotScope: "#trophy-modal",
    flow: "modal",
  },
  {
    id: "ending-desktop",
    scenario: "act1-opening",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#ending",
    screenshotScope: "#ending",
    flow: "ending",
    expectedEvents: ["life.started"],
  },
  {
    id: "resume-desktop",
    scenario: "title-fresh",
    width: 1366,
    height: 900,
    isMobile: false,
    scope: "#story-book",
    screenshotScope: "#story-book",
    flow: "resume",
    expectedEvents: ["life.started"],
    ignoreSaveFields: ["discovered"],
  },
];

const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_KEY = "kolde-karl-narrator-v1";
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";
const PRODUCT_EVENTS_KEY = "karl-product-events-v1";

export function urlFor(origin, scenario) {
  const url = new URL(origin);
  url.searchParams.set("scenario", scenario);
  url.searchParams.set("freeze", "1");
  url.searchParams.set("parity", "1");
  return url.href;
}

function parseJson(raw) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { invalid: true };
  }
}

export function normalizeSave(raw) {
  const parsed = parseJson(raw);
  if (parsed === null || parsed.invalid) return parsed;
  const state = parsed.state ?? {};
  return {
    version: parsed.version,
    state: {
      act: state.act,
      discovered: state.discovered,
      flags: state.flags,
      solvedProblems: state.solvedProblems,
      attempts: state.attempts,
      ended: state.ended ?? null,
      seed: state.seed,
    },
  };
}

export function normalizeParitySnapshot(snapshot, baseline, fixture) {
  const comparable = structuredClone(snapshot);
  if (
    fixture.scope !== "#title-screen"
    && Array.isArray(comparable.app?.children)
  ) {
    comparable.app.children = comparable.app.children.filter(
      (child) => child.attributes?.id !== "title-screen",
    );
  }
  if (baseline.productEvents === null) comparable.productEvents = null;
  for (const field of fixture.ignoreSaveFields ?? []) {
    if (comparable.save?.state) delete comparable.save.state[field];
  }
  for (const event of comparable.productEvents ?? []) {
    if (["synthesized", "text-only"].includes(event.payload?.audioMode)) {
      event.payload.audioMode = "fallback";
    }
  }
  return comparable;
}

function normalizeAchievements(raw) {
  const parsed = parseJson(raw);
  if (!parsed || parsed.invalid || typeof parsed !== "object") return parsed;
  return Object.keys(parsed).sort();
}

function normalizeEvents(raw) {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    turn: event.turn,
    payload: event.payload,
  }));
}

function cleanOrigin(page) {
  const url = new URL(page.url());
  url.search = "";
  return url.href;
}

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function narrationCount(page) {
  return page.evaluate(() => window.__karlParityNarrationStarted ?? 0);
}

async function waitForNarration(page, previous, additional) {
  await page.waitForFunction(
    ({ prior, count }) =>
      (window.__karlParityNarrationStarted ?? 0) >= prior + count,
    { prior: previous, count: additional },
  );
}

async function begin(page) {
  const narrationBefore = await narrationCount(page);
  await page.click("#t-primary");
  await page.waitForFunction(
    () => document.querySelector("#title-screen")?.hasAttribute("hidden"),
  );
  await page.waitForSelector("#grid .element");
  await waitForNarration(page, narrationBefore, 2);
  await settle(page);
}

async function select(page, id) {
  await page.click(`#grid .element[data-id="${id}"]`);
  await settle(page);
}

async function combine(page, a, b, narrationBeats = 1) {
  await select(page, a);
  await select(page, b);
  await page.waitForSelector("#combine:not([disabled])");
  const narrationBefore = await narrationCount(page);
  await page.click("#combine");
  await waitForNarration(page, narrationBefore, narrationBeats);
  await settle(page);
}

export async function runFixtureFlow(page, fixture) {
  await page.evaluate(() => {
    if (window.__karlParityNarrationListenerInstalled) return;
    window.__karlParityNarrationStarted = 0;
    window.__karlParityNarrationListenerInstalled = true;
    window.addEventListener("narration:beat-start", () => {
      window.__karlParityNarrationStarted++;
    });
  });
  switch (fixture.flow) {
    case "none":
      break;
    case "start":
      await begin(page);
      break;
    case "select":
      await select(page, "sten");
      break;
    case "discovery":
      await combine(page, "sten", "sten", 2);
      await page.waitForSelector('#grid .element[data-id="gnister"]');
      await page.waitForFunction(
        () =>
          !document.querySelector("#slot-a")?.hasAttribute("data-entity-id") &&
          !document.querySelector("#slot-b")?.hasAttribute("data-entity-id"),
      );
      break;
    case "no-fuse": {
      const before = await page.locator("#narrator-text").textContent();
      await combine(page, "baer", "ler");
      await page.waitForFunction(
        (prior) =>
          document.querySelector("#narrator-text")?.textContent !== prior,
        before,
      );
      break;
    }
    case "archive":
      await page.click("#book-btn");
      await page.waitForFunction(() =>
        document.querySelector("#book-panel")?.classList.contains("open"),
      );
      break;
    case "modal":
      await page.click("#t-fates");
      await page.waitForSelector("#trophy-modal:not([hidden])");
      break;
    case "resume":
      await begin(page);
      await page.waitForFunction(
        (key) => localStorage.getItem(key) !== null,
        SAVE_KEY,
      );
      await page.goto(cleanOrigin(page), { waitUntil: "load" });
      await page.waitForSelector("#t-primary");
      await page.click("#t-primary");
      await page.waitForFunction(
        () => document.querySelector("#title-screen")?.hasAttribute("hidden"),
      );
      await settle(page);
      break;
    case "ending":
      await combine(page, "sten", "sten", 2);
      await page.waitForSelector('#grid .element[data-id="gnister"]');
      await page.waitForFunction(
        (key) => localStorage.getItem(key) !== null,
        SAVE_KEY,
      );
      await page.evaluate((key) => {
        const parsed = JSON.parse(localStorage.getItem(key));
        parsed.state.ended = "et-helt-liv";
        localStorage.setItem(key, JSON.stringify(parsed));
      }, SAVE_KEY);
      await page.goto(cleanOrigin(page), { waitUntil: "load" });
      await page.waitForSelector("#t-primary");
      await page.click("#t-primary");
      await page.waitForSelector("#ending:not([hidden])");
      await settle(page);
      break;
    default:
      throw new Error(`Unknown parity flow ${fixture.flow}`);
  }
  await page.addStyleTag({
    content: "[data-parity-addition]{display:none!important}",
  });
  await settle(page);
}

export function createDiagnostics(page) {
  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push(
      `${request.method()} ${new URL(request.url()).pathname}: ${
        request.failure()?.errorText ?? "failed"
      }`,
    ),
  );
  return { pageErrors, failedRequests };
}

export async function captureSnapshot(page, fixture, diagnostics) {
  const browserSnapshot = await page.evaluate((scopeSelector) => {
    const ignoredAttributes = new Set([
      "data-capability",
      "data-scenario",
      "data-action",
      "data-state",
      "data-entity-id",
      "data-parity-addition",
    ]);
    const scope = document.querySelector(scopeSelector);
    if (!scope) throw new Error(`Missing parity scope ${scopeSelector}`);
    function element(node) {
      if (node.hasAttribute("data-parity-addition")) return null;
      const normalizeAttribute = (attribute) => {
        if (attribute.name === "src" || attribute.name === "srcset") {
          try {
            const pathname = new URL(attribute.value, location.href).pathname;
            const assets = pathname.indexOf("/assets/");
            return assets >= 0 ? pathname.slice(assets) : pathname;
          } catch {
            return attribute.value;
          }
        }
        return attribute.value;
      };
      return {
        tag: node.tagName.toLowerCase(),
        attributes: Object.fromEntries(
          [...node.attributes]
            .filter((attribute) => !ignoredAttributes.has(attribute.name))
            .map((attribute) => [
              attribute.name,
              normalizeAttribute(attribute),
            ])
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        text:
          node.children.length === 0
            ? (node.textContent ?? "").replace(/\s+/g, " ").trim()
            : "",
        children: [...node.children].map(element).filter(Boolean),
      };
    }
    return {
      title: document.title,
      html: {
        lang: document.documentElement.lang,
        dataReady: document.documentElement.dataset.ready,
      },
      app: element(scope),
      focusOrder: [
        ...scope.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ),
      ]
        .filter((node) => !node.closest("[data-parity-addition]"))
        .map((node) => node.id || node.getAttribute("aria-label") || node.tagName),
      activeElement:
        document.activeElement?.id ||
        document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.tagName ||
        null,
      storage: {
        save: localStorage.getItem("kolde-karl-save-v1"),
        narrator: localStorage.getItem("kolde-karl-narrator-v1"),
        achievements: localStorage.getItem("kolde-karl-achievements"),
        productEvents: localStorage.getItem("karl-product-events-v1"),
      },
    };
  }, fixture.scope);

  return {
    schemaVersion: 2,
    title: browserSnapshot.title,
    html: browserSnapshot.html,
    app: browserSnapshot.app,
    focusOrder: browserSnapshot.focusOrder,
    activeElement: browserSnapshot.activeElement,
    save: normalizeSave(browserSnapshot.storage.save),
    narrator: parseJson(browserSnapshot.storage.narrator),
    achievements: normalizeAchievements(browserSnapshot.storage.achievements),
    productEvents: normalizeEvents(browserSnapshot.storage.productEvents),
    errors: [...diagnostics.pageErrors],
    failedRequests: [...diagnostics.failedRequests],
  };
}

export function eventTypes(events) {
  return Array.isArray(events) ? events.map((event) => event.type) : [];
}

export function containsOrderedSubsequence(actual, expected) {
  let cursor = 0;
  for (const value of actual) {
    if (value === expected[cursor]) cursor++;
  }
  return cursor === expected.length;
}

export async function captureFixtureScreenshot(page, fixture, targetPath) {
  if (fixture.screenshotScope) {
    await page.locator(fixture.screenshotScope).screenshot({ path: targetPath });
    return;
  }
  await page.screenshot({ path: targetPath, fullPage: false });
}
