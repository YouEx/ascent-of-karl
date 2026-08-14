/**
 * UX-dommer — håndhæver docs/design/ux-checklist.md i en rigtig browser.
 *
 * Baggrund: en spiller sad fast i en modal, fordi den kun havde én vej ud.
 * Unit tests kunne ikke fange det; det kræver en rigtig browser med rigtig
 * history og rigtigt fokus. Kør: node tools/ux_audit.mjs [url]
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:5199/";
const MOBILE = { width: 390, height: 844 };

/**
 * Registret over overlejringer. Tilføjer du en ny overlejring til spillet og
 * ikke her, er den ikke dækket — og så er vi tilbage hvor vi startede.
 */
const OVERLAYS = [
  {
    id: "book-panel",
    name: "Bogen",
    open: async (p) => {
      await p.click("#book-btn");
      await p.waitForTimeout(350);
    },
    isOpen: (p) => p.locator("#book-panel.open").count().then((n) => n > 0),
    closeControl: "#book-close",
  },
  {
    id: "trophy-modal",
    name: "Trofæer",
    open: async (p) => {
      await p.click("#trophies");
      await p.waitForTimeout(250);
    },
    isOpen: (p) => p.locator("#trophy-modal").isVisible(),
    closeControl: "#trophy-close",
  },
  {
    id: "card",
    name: "Opdagelseskort",
    open: async (p) => {
      await p.locator('#grid .element[data-id="sten"]').click();
      await p.locator('#grid .element[data-id="sten"]').click();
      await p.click("#combine");
      await p.waitForTimeout(500);
    },
    isOpen: (p) => p.locator("#card").isVisible(),
    closeControl: "#card-close",
  },
  {
    id: "ending",
    name: "Slutskærm (terminal)",
    // Terminal: runnet er slut, "Live again" er den fremadrettede handling.
    // Undtaget fra lukke-checks — men ikke fra fokus og aria.
    terminal: true,
    open: async (p) => {
      await p.evaluate(() => {
        localStorage.setItem("kolde-karl-save-v1", JSON.stringify({
          version: 1,
          savedAt: "2026-08-07T00:00:00Z",
          state: {
            act: 1,
            discovered: ["sten", "pind", "graes", "vand", "ler", "baer",
              "larver", "dyr", "stamme", "nabo", "fugl", "korn", "okse",
              "gnister", "ild", "stenoekse", "spyd", "koed", "fjer",
              "vinger", "bautasten", "flyveforsoeg"],
            flags: [],
            solvedProblems: [],
            attempts: 31,
            ended: "icarus",
          },
        }));
      });
      await p.reload();
      // #t-primary er ét knap-id for både "Continue" og "Begin" — etiketten
      // skifter med save-tilstanden, id'et gør ikke. Her FINDES der en save,
      // så knappen hedder "Continue".
      await p.click("#t-primary");
      await p.waitForTimeout(700);
    },
    isOpen: (p) => p.locator("#ending").isVisible(),
    closeControl: "#ending-restart",
  },
];

const results = [];
const record = (overlay, check, ok, detail = "") =>
  results.push({ overlay, check, ok, detail });

/**
 * Stopper PÅ titelskærmen — modsat freshGame(), der altid klikker sig videre.
 * Titlen gør resten af #app `inert`, så den ligger uden for fokus og
 * tilgængelighedstræet mens den vises (TASK-021). Men #trophy-modal er en
 * SØSKENDE til #title-screen inde i #app, ikke en del af spillets baggrund —
 * åbner man den fra titlen (Fates-knappen), skal den regel ikke gælde den.
 */
async function freshTitle(browser) {
  const page = await browser.newPage({ viewport: MOBILE, hasTouch: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#title-screen #t-fates");
  return page;
}

/**
 * Titlens Fates-knap åbner samme #trophy-modal som spillets trofæ-knap —
 * men mens titlen er fremme, gør setBackgroundInert(true) hele resten af
 * #app inert, herunder søskenden #trophy-modal selv, hvis den ikke er
 * eksplicit undtaget. Følgen: modalen ses, men kan hverken fokuseres,
 * læses op eller lukkes med musen — en fælde uden nogen udgang.
 */
async function auditTitleFatesModal(browser) {
  const page = await freshTitle(browser);
  await page.click("#t-fates");
  await page.waitForTimeout(250);

  const notInert = await page.evaluate(
    () => !document.getElementById("trophy-modal")?.hasAttribute("inert"),
  );
  record("Titlens Fates", "trophy-not-inert", notInert);

  const focusInside = await page.evaluate(
    () => !!document.getElementById("trophy-modal")?.contains(document.activeElement),
  );
  record("Titlens Fates", "focus-in", focusInside);

  // Interaktivitet: den synlige lukkeknap skal faktisk kunne klikkes.
  // inert blokerer museklik i hele undertræet, selvom modalen ser åben ud —
  // derfor tester vi den rigtige effekt (lukker den?), ikke kun at knappen
  // findes i DOM'en.
  await page.click("#trophy-close").catch(() => {});
  await page.waitForTimeout(250);
  const closed = await page
    .locator("#trophy-modal")
    .isVisible()
    .then((v) => !v);
  record("Titlens Fates", "close-click-works", closed);

  await page.close();
}

/**
 * En rigtig mobilbrowser kan udvide layout-viewportun til sidens bredeste
 * baggrundsindhold, selv om visual viewport stadig er 390 px. Titlen er
 * `position: fixed`, så `inset: 0` følger den udvidede layout-viewport og kan
 * ellers centrere hele pergamentet uden for den synlige rude.
 */
async function auditTitleMobileViewport(browser) {
  const page = await browser.newPage({
    viewport: MOBILE,
    screen: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#title-screen #t-primary");

  const layout = await page.evaluate(() => {
    const title = document.getElementById("title-screen")?.getBoundingClientRect();
    const panel = document.querySelector(".title-panel")?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      title: title && { left: title.left, width: title.width, height: title.height },
      panel: panel && { left: panel.left, right: panel.right },
    };
  });
  const epsilon = 0.5;
  record(
    "Titlens mobilrude",
    "visual-width",
    !!layout.title &&
      Math.abs(layout.title.left) <= epsilon &&
      layout.title.width <= layout.clientWidth + epsilon,
    layout.title
      ? `${Math.round(layout.title.width)}px mod ${layout.clientWidth}px`
      : "titlen mangler",
  );
  record(
    "Titlens mobilrude",
    "visual-height",
    !!layout.title && layout.title.height <= layout.clientHeight + epsilon,
    layout.title
      ? `${Math.round(layout.title.height)}px mod ${layout.clientHeight}px`
      : "titlen mangler",
  );
  record(
    "Titlens mobilrude",
    "panel-in-viewport",
    !!layout.panel &&
      layout.panel.left >= -epsilon &&
      layout.panel.right <= layout.clientWidth + epsilon,
    layout.panel
      ? `${Math.round(layout.panel.left)}–${Math.round(layout.panel.right)}px`
      : "panelet mangler",
  );

  const semantics = await page.evaluate(() => {
    const heading = document.querySelector("#title-screen h1");
    const semantic = document.querySelector(".title-mark-semantic");
    const image = document.querySelector('img[data-title-layer="wordmark"]');
    const title = document.getElementById("title-screen");
    const panel = document.querySelector(".title-panel")?.getBoundingClientRect();
    const box = image?.getBoundingClientRect();
    const style = semantic ? getComputedStyle(semantic) : null;
    return {
      headingCount: document.querySelectorAll("#title-screen h1").length,
      headingText: heading?.textContent?.replace(/\s+/g, " ").trim(),
      semanticVisibleToAT:
        !!style && style.display !== "none" && style.visibility !== "hidden",
      decorativeImage:
        image?.getAttribute("alt") === "" &&
        image?.getAttribute("aria-hidden") === "true",
      currentSrc: image?.currentSrc ?? "",
      complete: image?.complete ?? false,
      noUpscale:
        !!box &&
        box.width * devicePixelRatio <= (image?.naturalWidth ?? 0) + 0.5 &&
        box.height * devicePixelRatio <= (image?.naturalHeight ?? 0) + 0.5,
      inPanel:
        !!box &&
        !!panel &&
        box.left >= panel.left - 0.5 &&
        box.right <= panel.right + 0.5 &&
        box.top >= panel.top - 0.5 &&
        box.bottom <= panel.bottom + 0.5,
      noHorizontalScroll:
        !!title && title.scrollWidth <= title.clientWidth + 0.5,
      rendered: box && [box.width, box.height],
      natural: image && [image.naturalWidth, image.naturalHeight],
    };
  });
  record(
    "Titlens semantik",
    "single-accessible-heading",
    semantics.headingCount === 1 &&
      semantics.headingText === "The Ascent of Karl" &&
      semantics.semanticVisibleToAT,
    `${semantics.headingCount} h1 · ${semantics.headingText ?? "intet navn"}`,
  );
  record(
    "Titlens semantik",
    "decorative-mobile-wordmark",
    semantics.decorativeImage &&
      semantics.complete &&
      semantics.currentSrc.includes("wordmark-mobile"),
    semantics.currentSrc.split("/").pop() || "wordmark mangler",
  );
  record(
    "Titlens semantik",
    "wordmark-no-upscale",
    semantics.noUpscale,
    `${semantics.rendered?.map(Math.round).join("×") ?? "?"} CSS ved DPR2 mod ${
      semantics.natural?.join("×") ?? "?"
    } native`,
  );
  record("Titlens semantik", "wordmark-in-panel", semantics.inPanel);
  record(
    "Titlens mobilrude",
    "no-horizontal-scroll",
    semantics.noHorizontalScroll,
  );

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  const focusOrder = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    focusOrder.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return "";
        return active.id || (
          active.dataset.tip === undefined ? active.tagName : `tip-${active.dataset.tip}`
        );
      }),
    );
  }
  const expectedFocusOrder = [
    "t-primary",
    "t-fates",
    "tip-0",
    "tip-1",
    "tip-2",
    "t-trophies",
    "t-sound",
  ];
  record(
    "Titlens semantik",
    "focus-order",
    JSON.stringify(focusOrder) === JSON.stringify(expectedFocusOrder),
    focusOrder.join(" → "),
  );

  await page.click("#t-fates");
  await page.waitForTimeout(250);
  const trophy = await page.evaluate(() => {
    const modal = document.getElementById("trophy-modal")?.getBoundingClientRect();
    const inner = document.querySelector("#trophy-modal .modal-inner")?.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      modal: modal && { left: modal.left, right: modal.right, width: modal.width },
      inner: inner && { left: inner.left, right: inner.right },
    };
  });
  record(
    "Titlens mobilrude",
    "trophy-visual-width",
    !!trophy.modal &&
      trophy.modal.left >= -epsilon &&
      trophy.modal.right <= trophy.clientWidth + epsilon,
    trophy.modal
      ? `${Math.round(trophy.modal.width)}px mod ${trophy.clientWidth}px`
      : "modalen mangler",
  );
  record(
    "Titlens mobilrude",
    "trophy-panel-in-viewport",
    !!trophy.inner &&
      trophy.inner.left >= -epsilon &&
      trophy.inner.right <= trophy.clientWidth + epsilon,
    trophy.inner
      ? `${Math.round(trophy.inner.left)}–${Math.round(trophy.inner.right)}px`
      : "modalens indhold mangler",
  );

  await page.close();
}

async function auditGameMobileViewport(browser) {
  const page = await freshGame(browser);
  if (await page.locator("#improvise-status-host").count()) {
    await page.locator('#grid .element[data-id="sten"]').click();
    await page.locator('#grid .element[data-id="ler"]').click();
  }
  const epsilon = 0.5;
  const layout = await page.evaluate(() => {
    const dock = document.getElementById("dock")?.getBoundingClientRect();
    const status = document
      .getElementById("improvise-status-host")
      ?.getBoundingClientRect();
    return {
      featureEnabled: document.documentElement.hasAttribute(
        "data-improvise-enabled",
      ),
      featureMarkup: document.getElementById("improvise-status-host") !== null,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dock:
        dock &&
        {
          left: dock.left,
          right: dock.right,
          width: dock.width,
          top: dock.top,
        },
      status:
        status &&
        {
          left: status.left,
          right: status.right,
          width: status.width,
          bottom: status.bottom,
        },
    };
  });
  if (!layout.featureEnabled) {
    record(
      "Spillets mobilrude",
      "feature-root-absent",
      !layout.featureEnabled,
    );
    record(
      "Spillets mobilrude",
      "feature-markup-absent",
      !layout.featureMarkup,
    );
  } else {
    record(
      "Spillets mobilrude",
      "no-horizontal-scroll",
      layout.scrollWidth <= layout.clientWidth + epsilon,
      `${Math.round(layout.scrollWidth)}px mod ${layout.clientWidth}px`,
    );
    record(
      "Spillets mobilrude",
      "dock-in-viewport",
      !!layout.dock &&
        layout.dock.left >= -epsilon &&
        layout.dock.right <= layout.clientWidth + epsilon,
      layout.dock
        ? `${Math.round(layout.dock.left)}–${Math.round(layout.dock.right)}px`
        : "dokken mangler",
    );
    if (layout.status) {
      record(
        "Spillets mobilrude",
        "copy-status-in-viewport",
        layout.status.left >= -epsilon &&
          layout.status.right <= layout.clientWidth + epsilon,
        `${Math.round(layout.status.left)}–${Math.round(layout.status.right)}px`,
      );
      record(
        "Spillets mobilrude",
        "copy-status-above-dock",
        !!layout.dock && layout.status.bottom <= layout.dock.top + epsilon,
        layout.dock
          ? `${Math.round(layout.status.bottom)}px mod dock-top ${Math.round(
              layout.dock.top,
            )}px`
          : "dokken mangler",
      );
    }
  }
  await page.close();
}

async function freshGame(browser) {
  const page = await browser.newPage({ viewport: MOBILE, hasTouch: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Vent på selve knappen, ikke på en layout-beholder. Titelskærmen er nu
  // bygget om tre gange, og hver gang tog en omdøbt wrapper (.title-grid →
  // .title-panel) CI med i faldet, uden at der var noget i vejen med spillet.
  // Knappen, vi er ved at trykke på, er det eneste, testen faktisk afhænger af.
  // Med tømt localStorage hedder #t-primary "Begin"; #t-new findes kun, når
  // der ER en save at komme videre fra.
  await page.waitForSelector("#title-screen #t-primary");
  await page.click("#t-primary");
  await page.waitForSelector("#grid .element");
  await page.waitForTimeout(300);
  return page;
}

async function auditOverlay(browser, o) {
  // --- lukkekontrol findes og er stor nok ---
  {
    const page = await freshGame(browser);
    await o.open(page);
    const btn = page.locator(o.closeControl);
    const visible = await btn.isVisible().catch(() => false);
    const box = visible ? await btn.boundingBox() : null;
    const bigEnough = !!box && box.width >= 44 && box.height >= 44;
    record(o.name, "close-control", visible && bigEnough,
      box ? `${Math.round(box.width)}×${Math.round(box.height)}px` : "mangler");

    // --- aria ---
    const aria = await page.evaluate((id) => {
      const e = document.getElementById(id);
      return {
        role: e?.getAttribute("role"),
        modal: e?.getAttribute("aria-modal"),
        label: e?.getAttribute("aria-label"),
      };
    }, o.id);
    record(o.name, "aria",
      aria.role === "dialog" && aria.modal === "true" && !!aria.label,
      `role=${aria.role} modal=${aria.modal} label=${aria.label ? "ja" : "nej"}`);

    // --- fokus flyttet ind ---
    const focusInside = await page.evaluate(
      (id) => !!document.getElementById(id)?.contains(document.activeElement),
      o.id,
    );
    record(o.name, "focus-in", focusInside);

    // --- baggrunden scroller ikke ---
    const locked = await page.evaluate(() =>
      document.body.classList.contains("overlay-open") &&
      getComputedStyle(document.body).overflow === "hidden");
    record(o.name, "scroll-lock", locked);

    await page.close();
  }

  // Terminale overlejringer har bevidst ingen lukkeveje (se ux-checklist §1).
  // De skal stadig bestå fokus og aria ovenfor — derfor stopper vi først her.
  if (o.terminal) return;

  // --- klik på baggrunden lukker ---
  {
    const page = await freshGame(browser);
    await o.open(page);
    const box = await page.locator(`#${o.id}`).boundingBox();
    if (box) {
      // Klik i overkanten af overlejringen, uden for indholdsboksen
      await page.mouse.click(box.x + box.width / 2, box.y + 6);
      await page.waitForTimeout(350);
    }
    record(o.name, "backdrop", !(await o.isOpen(page)));
    await page.close();
  }

  // --- Esc lukker ---
  {
    const page = await freshGame(browser);
    await o.open(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    record(o.name, "escape", !(await o.isOpen(page)));
    await page.close();
  }

  // --- browserens back lukker overlejringen, ikke spillet ---
  {
    const page = await freshGame(browser);
    await o.open(page);
    await page.goBack();
    await page.waitForTimeout(400);
    const closed = !(await o.isOpen(page));
    // Spillet skal stadig være i gang — ikke navigeret væk
    const stillInGame = await page.locator("#grid").count().then((n) => n > 0);
    record(o.name, "history", closed && stillInGame,
      stillInGame ? "" : "navigerede væk fra spillet!");
    await page.close();
  }

  // --- fokus vender tilbage til udløseren ---
  {
    const page = await freshGame(browser);
    await o.open(page);
    await page.click(o.closeControl);
    await page.waitForTimeout(300);
    const restored = await page.evaluate(
      () => document.activeElement !== document.body &&
            document.activeElement?.tagName !== "HTML",
    );
    record(o.name, "focus-restore", restored);
    await page.close();
  }
}

// Brug en forudinstalleret binær hvis miljøet peger på én, ellers lad
// Playwright selv finde sin egen — så virker dommeren både lokalt og i CI.
const execPath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
for (const o of OVERLAYS) await auditOverlay(browser, o);
await auditTitleFatesModal(browser);
await auditTitleMobileViewport(browser);
await auditGameMobileViewport(browser);
await browser.close();

// --- rapport ---
const byOverlay = new Map();
for (const r of results) {
  if (!byOverlay.has(r.overlay)) byOverlay.set(r.overlay, []);
  byOverlay.get(r.overlay).push(r);
}
console.log("\n🔎 UX-dommer — docs/design/ux-checklist.md\n");
for (const [name, checks] of byOverlay) {
  console.log(`  ${name}`);
  for (const c of checks) {
    console.log(`    ${c.ok ? "✓" : "✗"} ${c.check}${c.detail ? "  (" + c.detail + ")" : ""}`);
  }
  console.log();
}
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`❌ ${failed.length}/${results.length} checks fejlede`);
  process.exit(1);
}
console.log(`✅ Alle ${results.length} checks bestået`);
