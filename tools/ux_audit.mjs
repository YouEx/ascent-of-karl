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
      await p.click("#t-continue");
      await p.waitForTimeout(700);
    },
    isOpen: (p) => p.locator("#ending").isVisible(),
    closeControl: "#ending-restart",
  },
];

const results = [];
const record = (overlay, check, ok, detail = "") =>
  results.push({ overlay, check, ok, detail });

async function freshGame(browser) {
  const page = await browser.newPage({ viewport: MOBILE, hasTouch: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#title-screen .title-grid");
  await page.click("#t-new");
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
