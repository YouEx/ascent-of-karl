#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { stopProcessGroup } from "./judge/process-group.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function assertNarrationParity(events) {
  const open = [];
  for (const event of events) {
    if (event.phase === "start") {
      if (open.length) {
        throw new Error(
          `${event.id} startede før ${open[open.length - 1].id} var færdig`,
        );
      }
      if (!["recorded", "synthesized", "muted"].includes(event.audioMode)) {
        throw new Error(
          `${event.id} blev vist med audioMode=${event.audioMode}`,
        );
      }
      open.push(event);
      continue;
    }

    const started = open.pop();
    if (!started) throw new Error(`${event.id} sluttede uden start`);
    for (const key of ["id", "variant", "text", "audioMode"]) {
      if (started[key] !== event[key]) {
        throw new Error(
          `${event.id}: ${key} ændrede sig mellem tekst- og lydbeat`,
        );
      }
    }
  }
  if (open.length) throw new Error(`${open[0].id} blev aldrig færdig`);
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Serveren er ikke klar endnu.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite svarede ikke på ${url}`);
}

async function waitForSettled(page, minimumStarts) {
  await page.waitForFunction(
    (minimum) => {
      const audit = window.__narrationAudit;
      const starts = audit.events.filter((entry) => entry.phase === "start");
      const completes = audit.events.filter(
        (entry) => entry.phase === "complete",
      );
      return starts.length >= minimum && starts.length === completes.length;
    },
    minimumStarts,
    { timeout: 15_000 },
  );
}

async function selectPair(page, a, b) {
  await page.locator(`.element[data-id="${a}"]`).click();
  await page.locator(`.element[data-id="${b}"]`).click();
  await page.locator("#combine").click();
}

/**
 * Almindelige fund afsløres på bogens side og har intet kort. Kun rare/unique
 * åbner overlejringen, så auditen må ikke ANTAGE at den er der — den skal
 * lukke den hvis den kom, og ellers gå videre.
 */
async function dismissDiscoveryCard(page) {
  const close = page.locator("#card-close");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

async function runAudit(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      window.__narrationAudit = {
        events: [],
        recorded: [],
        synthesized: [],
      };
      window.addEventListener("narration:beat-start", (event) => {
        window.__narrationAudit.events.push({
          phase: "start",
          ...event.detail,
        });
      });
      window.addEventListener("narration:beat-complete", (event) => {
        window.__narrationAudit.events.push({
          phase: "complete",
          ...event.detail,
        });
      });

      class AuditAudio extends EventTarget {
        constructor(url) {
          super();
          this.src = url;
          this.volume = 1;
          this.currentTime = 0;
        }
        play() {
          window.__narrationAudit.recorded.push(this.src);
          setTimeout(() => this.dispatchEvent(new Event("ended")), 80);
          return Promise.resolve();
        }
        pause() {}
      }
      class AuditUtterance {
        constructor(text) {
          this.text = text;
          this.lang = "";
          this.voice = null;
          this.rate = 1;
          this.pitch = 1;
          this.onend = null;
          this.onerror = null;
        }
      }
      const speech = {
        cancel() {},
        getVoices() {
          return [{ lang: "en-GB", name: "Daniel" }];
        },
        speak(utterance) {
          window.__narrationAudit.synthesized.push(utterance.text);
          setTimeout(() => utterance.onend?.(new Event("end")), 80);
        },
      };
      Object.defineProperty(window, "Audio", {
        value: AuditAudio,
        configurable: true,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: AuditUtterance,
        configurable: true,
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: speech,
        configurable: true,
      });
    });

    const url = new URL(baseUrl);
    url.searchParams.set("scenario", "title-fresh");
    url.searchParams.set("freeze", "1");
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.locator("#t-primary").click();
    await waitForSettled(page, 2);

    await selectPair(page, "sten", "pind");
    await dismissDiscoveryCard(page);
    await waitForSettled(page, 4);

    await selectPair(page, "graes", "graes");
    await dismissDiscoveryCard(page);
    await waitForSettled(page, 5);

    const result = await page.evaluate(() => ({
      ...window.__narrationAudit,
      visible: document.querySelector("#narrator-text")?.textContent ?? "",
    }));
    assertNarrationParity(result.events);

    const starts = result.events.filter((entry) => entry.phase === "start");
    const intro = starts[0];
    const pull = starts[1];
    const bridge = starts.find((entry) =>
      entry.id.startsWith("bridge-discovery-"),
    );
    if (intro?.id !== "intro-act-1" || intro.audioMode !== "recorded") {
      throw new Error("Introen brugte ikke sin recorded lyd");
    }
    // Pull'et må ALDRIG stå tavst — men om det er indspillet eller sagt af
    // browseren afhænger af, hvor langt indtalingen er nået. Bandt vi
    // auditten til "synthesized" her, ville den fejle hver gang en replik BLEV
    // indtalt, altså straffe præcis den bevægelse projektet ønsker
    // (docs/design/fortaelleren.md, "Stemmeenheden"). Kontrakten er, at
    // beatet siges, og at det sagte er den synlige tekst.
    if (pull?.id !== "pull-kulde") {
      throw new Error("Åbningens andet beat var ikke pull-kulde");
    }
    if (!["recorded", "synthesized"].includes(pull.audioMode)) {
      throw new Error(`Åbningens pull stod tavst (${pull.audioMode})`);
    }
    if (pull.audioMode === "synthesized" && !result.synthesized.includes(pull.text)) {
      throw new Error("Pull-teksten og den syntetiserede tale var forskellige");
    }
    // Bridge'en interpolerer begge elementnavne i spiltiden og kan derfor
    // aldrig indtales på forhånd. Den er dermed auditens blivende bevis for,
    // at exact-text-fallbacken virker.
    if (
      !bridge ||
      bridge.audioMode !== "synthesized" ||
      !/stone axe/i.test(bridge.text) ||
      !/rope/i.test(bridge.text) ||
      !/warm|heat|cold/i.test(bridge.text)
    ) {
      throw new Error("Rope fik ikke en kontekstuel, oplæst story bridge");
    }
    if (!result.synthesized.includes(bridge.text)) {
      throw new Error("Bridge-teksten og den syntetiserede tale var forskellige");
    }
    if (result.visible !== starts[starts.length - 1].text) {
      throw new Error("Den synlige sluttekst matcher ikke sidste lydbeat");
    }

    console.log(
      `✅ Narration parity: ${starts.length} beats · ` +
        `${result.recorded.length} recorded · ` +
        `${result.synthesized.length} synthesized`,
    );
    console.log(`✅ Story bridge: ${bridge.text}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const supplied = process.argv[2];
  const baseUrl = supplied ?? "http://127.0.0.1:5199/";
  let server;
  try {
    if (!supplied) {
      server = spawn(
        process.execPath,
        [
          resolve(ROOT, "node_modules/vite/bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          "5199",
          "--strictPort",
        ],
        {
          cwd: ROOT,
          detached: process.platform !== "win32",
          stdio: "ignore",
        },
      );
      await waitForUrl(baseUrl);
    }
    await runAudit(baseUrl);
  } finally {
    if (server) await stopProcessGroup(server);
  }
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
