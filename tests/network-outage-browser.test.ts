import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
// @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
import { ORIGIN, startServer, stopServer } from "../tools/judge/capture.mjs";

const environment =
  (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env ?? {};
const outageDescribe =
  environment.OUTAGE_BROWSER_TESTS === "1" ? describe : describe.skip;

outageDescribe("online-required outage browser behavior", () => {
  let browser: Browser;
  let page: Page;
  let server: Awaited<ReturnType<typeof startServer>>;
  const prior = {
    url: environment.VITE_GAME_API_URL,
    required: environment.VITE_ONLINE_REQUIRED,
    ready: environment.VITE_ONLINE_TARGET_READY,
  };

  beforeAll(async () => {
    environment.VITE_GAME_API_URL = "http://127.0.0.1:9";
    environment.VITE_ONLINE_REQUIRED = "true";
    environment.VITE_ONLINE_TARGET_READY = "true";
    server = await startServer();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(ORIGIN, { waitUntil: "load" });
    await page.waitForSelector("#network-gate:not([hidden])");
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (server) await stopServer(server);
    if (prior.url === undefined) delete environment.VITE_GAME_API_URL;
    else environment.VITE_GAME_API_URL = prior.url;
    if (prior.required === undefined) delete environment.VITE_ONLINE_REQUIRED;
    else environment.VITE_ONLINE_REQUIRED = prior.required;
    if (prior.ready === undefined) delete environment.VITE_ONLINE_TARGET_READY;
    else environment.VITE_ONLINE_TARGET_READY = prior.ready;
  }, 30_000);

  it("makes active play inert while Retry and archived reading remain operable", async () => {
    const controls = await page.evaluate(() => ({
      tools: document.querySelector("#tools")?.hasAttribute("inert"),
      grid: document.querySelector("#grid")?.hasAttribute("inert"),
      dock: document.querySelector("#dock")?.hasAttribute("inert"),
      restart: document.querySelector("#restart")?.hasAttribute("inert"),
      retry: !(document.querySelector("#network-retry") as HTMLButtonElement)
        .disabled,
      archives: !(
        document.querySelector("#network-archives") as HTMLButtonElement
      ).disabled,
    }));
    expect(controls).toEqual({
      tools: true,
      grid: true,
      dock: true,
      restart: true,
      retry: true,
      archives: true,
    });

    await page.click("#network-archives");
    await page.waitForFunction(() =>
      document.querySelector("#book-panel")?.classList.contains("open"),
    );
    expect(await page.locator("#network-gate").isHidden()).toBe(true);
    expect(
      await page.locator("#life-archive").getAttribute("inert"),
    ).toBeNull();
    const replayTarget = page.locator("[data-replay-target]").first();
    expect(await replayTarget.isDisabled()).toBe(true);
    const beforeReplay = await page.evaluate(() => ({
      url: location.href,
      save: localStorage.getItem("kolde-karl-save-v1"),
      narrator: localStorage.getItem("kolde-karl-narrator-v1"),
    }));
    await page.evaluate(() =>
      document
        .querySelector<HTMLButtonElement>("[data-replay-target]")
        ?.click(),
    );
    expect(
      await page.evaluate(() => ({
        url: location.href,
        save: localStorage.getItem("kolde-karl-save-v1"),
        narrator: localStorage.getItem("kolde-karl-narrator-v1"),
      })),
    ).toEqual(beforeReplay);
    await page.click("#book-close");
    await page.waitForSelector("#network-gate:not([hidden])");
  });

  it("ignores programmatic select, combine and restart commands while blocked", async () => {
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    const before = await page.evaluate(() => ({
      save: localStorage.getItem("kolde-karl-save-v1"),
      dock: document.querySelector("#dock")?.getAttribute("data-state"),
    }));

    await page.evaluate(() => {
      const elements = [
        ...document.querySelectorAll<HTMLButtonElement>("#grid .element"),
      ].slice(0, 2);
      elements.forEach((element) => element.click());
      document.querySelector<HTMLButtonElement>("#combine")?.click();
      document.querySelector<HTMLButtonElement>("#restart")?.click();
    });

    expect(
      await page.evaluate(() => ({
        save: localStorage.getItem("kolde-karl-save-v1"),
        dock: document.querySelector("#dock")?.getAttribute("data-state"),
      })),
    ).toEqual(before);
    expect(dialogs).toBe(0);
  });
});
