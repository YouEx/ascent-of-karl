import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import { deriveLifePlan } from "../src/core/seed";
import { openingCommentaryCue } from "../src/product/runtime-commentary";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { ORIGIN, startServer, stopServer } from "../tools/judge/capture.mjs";

const runtimeDescribe =
  process.env.RUNTIME_COMMENTARY_BROWSER_TESTS === "1"
    ? describe
    : describe.skip;

runtimeDescribe("runtime commentary browser flow", () => {
  let browser: Browser;
  let page: Page;
  let appServer: Awaited<ReturnType<typeof startServer>>;
  const prior = {
    url: process.env.VITE_GAME_API_URL,
    required: process.env.VITE_ONLINE_REQUIRED,
    ready: process.env.VITE_ONLINE_TARGET_READY,
  };

  beforeAll(async () => {
    const content = loadContent();
    const plan = deriveLifePlan(
      content.lifeVariation!,
      content.completionManifest!.contentRevision,
      7,
    );
    const engine = new Engine(content, undefined, { lifePlan: plan });
    const state = engine.getState();
    process.env.VITE_GAME_API_URL = ORIGIN;
    process.env.VITE_ONLINE_REQUIRED = "true";
    process.env.VITE_ONLINE_TARGET_READY = "true";
    appServer = await startServer();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];
    const networkRequests: string[] = [];
    page.on("console", (message) =>
      consoleMessages.push(`${message.type()}: ${message.text()}`),
    );
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) =>
      networkRequests.push(`${request.method()} ${request.url()}`),
    );
    await page.addInitScript(
      ({ snapshot, commentaryCue }) => {
        const originalFetch = window.fetch.bind(window);
        let releaseCommentary!: () => void;
        const commentaryGate = new Promise<void>((resolve) => {
          releaseCommentary = resolve;
        });
        const runtimeWindow = window as unknown as {
          __runtimeApiCounts: {
            session: number;
            runs: number;
            commentary: number;
          };
          __releaseRuntimeCommentary: () => void;
        };
        runtimeWindow.__runtimeApiCounts = {
          session: 0,
          runs: 0,
          commentary: 0,
        };
        runtimeWindow.__releaseRuntimeCommentary = releaseCommentary;
        window.fetch = async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
            location.href,
          );
          if (url.pathname.endsWith("/audio/manifest.json")) {
            return new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (url.pathname === "/api/v1/session") {
            runtimeWindow.__runtimeApiCounts.session++;
            return new Response(
              JSON.stringify({
                schemaVersion: 1,
                onlineRequired: true,
                status: "ready",
                activePlayAllowed: true,
                archivesReadable: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }
          if (
            url.pathname === "/api/v1/runs" &&
            (init?.method ?? "GET") === "POST"
          ) {
            runtimeWindow.__runtimeApiCounts.runs++;
            return new Response(
              JSON.stringify({
                schemaVersion: 1,
                runId: "11111111-1111-1111-1111-111111111111",
                token: "token",
                csrf: "csrf",
                expiresAt: 4_102_444_800,
                revision: 0,
                snapshot,
                commentaryCue,
              }),
              {
                status: 201,
                headers: { "content-type": "application/json" },
              },
            );
          }
          if (url.pathname.endsWith("/commentary")) {
            runtimeWindow.__runtimeApiCounts.commentary++;
            await commentaryGate;
            return new Response(
              JSON.stringify({
                schemaVersion: 1,
                eventId: "opening",
                text: "Karl begins with five objects and the confidence of a man who counted none of them.",
                roles: ["humour", "story"],
                audioAvailable: false,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }
          return originalFetch(input, init);
        };
      },
      {
        snapshot: state,
        commentaryCue: openingCommentaryCue(content, state),
      },
    );
    await page.goto(`${ORIGIN}/?freeze=1`, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready='true']");
    const initial = await page.evaluate(() => ({
      networkGateHidden: document
        .querySelector("#network-gate")
        ?.hasAttribute("hidden"),
      titleHidden: document
        .querySelector("#title-screen")
        ?.hasAttribute("hidden"),
      onlineRequired:
        document.documentElement.dataset.onlineRequired,
      gameApiConfigured:
        document.documentElement.dataset.gameApiConfigured,
    }));
    if (!initial.networkGateHidden || initial.titleHidden) {
      throw new Error(
        `runtime API was not ready: ${JSON.stringify({
          initial,
          consoleMessages,
          pageErrors,
          networkRequests,
          resources: await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .map((entry) => entry.name)
              .filter((name) => name.includes("/assets/index-")),
          ),
        })}`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    await page
      ?.evaluate(() =>
        (
          window as unknown as {
            __releaseRuntimeCommentary?: () => void;
          }
        ).__releaseRuntimeCommentary?.(),
      )
      .catch(() => undefined);
    await browser?.close();
    if (appServer) await stopServer(appServer);
    if (prior.url === undefined) delete process.env.VITE_GAME_API_URL;
    else process.env.VITE_GAME_API_URL = prior.url;
    if (prior.required === undefined) delete process.env.VITE_ONLINE_REQUIRED;
    else process.env.VITE_ONLINE_REQUIRED = prior.required;
    if (prior.ready === undefined) delete process.env.VITE_ONLINE_TARGET_READY;
    else process.env.VITE_ONLINE_TARGET_READY = prior.ready;
  }, 30_000);

  it(
    "renders gameplay before delayed commentary and presents it as a later beat",
    async () => {
      await page.evaluate(() =>
        document.querySelector<HTMLButtonElement>("#t-primary")?.click(),
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector("#title-screen")
            ?.hasAttribute("hidden"),
      );
      await page.waitForSelector("#grid .element");
      const counts = await page.evaluate(
        () =>
          (
            window as unknown as {
              __runtimeApiCounts: {
                session: number;
                runs: number;
                commentary: number;
              };
            }
          ).__runtimeApiCounts,
      );
      expect(counts.session).toBeGreaterThan(0);
      expect(counts.runs).toBe(1);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("karl-run-capability-v1"),
        ),
      ).not.toBeNull();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __runtimeApiCounts: { commentary: number };
                }
              ).__runtimeApiCounts.commentary,
          ),
        )
        .toBe(1);

      expect(
        await page.locator("#grid .element").count(),
      ).toBeGreaterThan(0);
      expect(
        await page.locator("#narrator-text").textContent(),
      ).not.toContain("five objects");

      await page.evaluate(() =>
        (
          window as unknown as {
            __releaseRuntimeCommentary: () => void;
          }
        ).__releaseRuntimeCommentary(),
      );

      await page.waitForTimeout(4000);
      const observed = await page.evaluate(() => ({
        text: document.querySelector("#narrator-text")?.textContent,
        events: JSON.parse(
          localStorage.getItem("karl-product-events-v1") ?? "[]",
        ).map(
          (event: {
            type: string;
            payload?: { source?: string; text?: string };
          }) => ({
            type: event.type,
            source: event.payload?.source,
            text: event.payload?.text,
          }),
        ),
      }));
      expect(observed).toMatchObject({
        text: expect.stringContaining("five objects"),
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "narrator.presented",
            source: "runtime-llm",
            text: expect.stringContaining("five objects"),
          }),
        ]),
      });
    },
    15_000,
  );
});
