import { Engine } from "../core/engine";
import { deserialize, serialize } from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import type { NarratorState, SpokenLine } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import { BookView } from "./book";
import { initAudio, playLine, stopAudio } from "./audio";

const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";
const MUTE_KEY = "kolde-karl-muted";
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";

const content = loadContent();
const engine = new Engine(content);
// Nyt seed pr. playthrough → nye variantvalg hver gang (docs/design/fortaelleren.md)
const narrator = new Narrator(engine, freshNarratorState((Math.random() * 2 ** 31) | 0));

// --- Save/load (autosave pr. opdagelse, PRD §4.1) ---
function save(): void {
  localStorage.setItem(SAVE_KEY, serialize(engine.getState(), new Date().toISOString()));
  localStorage.setItem(NARRATOR_SAVE_KEY, JSON.stringify(narrator.getState()));
}

function hasSave(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

function tryLoad(): boolean {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    engine.loadState(deserialize(raw));
    const nRaw = localStorage.getItem(NARRATOR_SAVE_KEY);
    narrator.loadState(nRaw ? (JSON.parse(nRaw) as NarratorState) : freshNarratorState());
    return true;
  } catch {
    return false;
  }
}

function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(NARRATOR_SAVE_KEY);
}

// --- Achievements: skæbner overlever på tværs af runs ---
function loadAchievements(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function unlockAchievement(endingId: string): boolean {
  const all = loadAchievements();
  if (all[endingId]) return false;
  all[endingId] = new Date().toISOString().slice(0, 10);
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(all));
  return true;
}

/**
 * Layout (docs/design/ui-mobile.md): kilden er én DOM; mobil og desktop
 * arrangerer den forskelligt via CSS. Værkstedet er en fast "dock" i
 * tommelfinger-zonen på mobil, og bogen åbnes som fuldskærms-sheet.
 */
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <h1>Kolde Karl</h1>
    <span id="age" title="Every attempt costs a summer of Karl's life"></span>
    <div class="header-actions">
      <button id="book-btn" class="icon-btn" aria-label="Open the chronicle">📖<span id="book-badge"></span></button>
      <button id="trophies" class="icon-btn" aria-label="Fates discovered">🏆</button>
      <button id="restart" class="icon-btn" aria-label="Start over">↺</button>
    </div>
  </header>

  <section id="narrator" aria-live="polite">
    <div id="bubble">
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button id="mute" class="icon-btn" aria-pressed="false" aria-label="Mute the narrator">🔊</button>
      </div>
      <p id="narrator-text"></p>
    </div>
  </section>

  <section id="problems" aria-label="Karl's problems"></section>

  <div id="tools">
    <input id="search" type="search" placeholder="Search elements…" aria-label="Search elements" autocomplete="off">
    <button id="filter-new" class="chip-btn" aria-pressed="false">✨ New</button>
  </div>

  <section id="grid" aria-label="Elements"></section>
  <p id="grid-empty" hidden>Nothing matches that. Karl checked twice.</p>

  <div id="dock">
    <div class="slot" id="slot-a">?</div>
    <span class="plus">+</span>
    <div class="slot" id="slot-b">?</div>
    <button id="combine" disabled>Combine</button>
  </div>

  <aside id="book-panel" aria-label="The chronicle of mankind">
    <button id="book-close" class="icon-btn" aria-label="Close the chronicle">✕</button>
    <section id="book"></section>
  </aside>

  <div id="banner" hidden></div>
  <div id="card" hidden></div>
  <div id="ending" hidden></div>
  <div id="trophy-modal" hidden></div>
  <div id="title-screen"></div>
`;

const el = {
  age: document.getElementById("age")!,
  problems: document.getElementById("problems")!,
  narratorText: document.getElementById("narrator-text")!,
  bubble: document.getElementById("bubble")!,
  muteBtn: document.getElementById("mute") as HTMLButtonElement,
  search: document.getElementById("search") as HTMLInputElement,
  filterNew: document.getElementById("filter-new") as HTMLButtonElement,
  grid: document.getElementById("grid")!,
  gridEmpty: document.getElementById("grid-empty")!,
  slotA: document.getElementById("slot-a")!,
  slotB: document.getElementById("slot-b")!,
  combineBtn: document.getElementById("combine") as HTMLButtonElement,
  bookPanel: document.getElementById("book-panel")!,
  bookBtn: document.getElementById("book-btn")!,
  bookBadge: document.getElementById("book-badge")!,
  bookClose: document.getElementById("book-close")!,
  banner: document.getElementById("banner")!,
  card: document.getElementById("card")!,
  ending: document.getElementById("ending")!,
  trophyModal: document.getElementById("trophy-modal")!,
  trophiesBtn: document.getElementById("trophies")!,
  restart: document.getElementById("restart")!,
  titleScreen: document.getElementById("title-screen")!,
};

const book = new BookView(engine, document.getElementById("book")!);

let selected: [string | null, string | null] = [null, null];
let typewriterTimer: ReturnType<typeof setInterval> | undefined;
let muted = localStorage.getItem(MUTE_KEY) === "1";
let lastLineText = "";
let lastAttemptAt: number | null = null;
let query = "";
let onlyNew = false;
/** Opdaget i denne session — får ✨-markering så de er til at finde i et stort grid */
const freshFinds = new Set<string>();

// --- Fortæller ---
function say(line: SpokenLine): void {
  playLine(line, muted);
  speak(line.text);
}

function speak(text: string): void {
  lastLineText = text;
  if (muted) return;
  if (typewriterTimer) clearInterval(typewriterTimer);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    el.narratorText.textContent = text;
    return;
  }
  el.narratorText.textContent = "";
  let i = 0;
  typewriterTimer = setInterval(() => {
    i++;
    el.narratorText.textContent = text.slice(0, i);
    if (i >= text.length && typewriterTimer) clearInterval(typewriterTimer);
  }, 18);
}

function renderMute(): void {
  el.muteBtn.textContent = muted ? "🔇" : "🔊";
  el.muteBtn.setAttribute("aria-label", muted ? "Unmute the narrator" : "Mute the narrator");
  el.muteBtn.setAttribute("aria-pressed", String(muted));
  el.bubble.classList.toggle("muted", muted);
  if (muted) {
    stopAudio();
    if (typewriterTimer) clearInterval(typewriterTimer);
    el.narratorText.textContent = "…";
  } else if (lastLineText) {
    speak(lastLineText);
  }
}

el.muteBtn.addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  renderMute();
});

// --- Render ---
function renderAge(): void {
  const spent = content.config.turnLimit - engine.remainingTurns();
  el.age.textContent = `⏳ ${Math.min(spent + 1, content.config.turnLimit)}/${content.config.turnLimit}`;
  el.age.title = `Summer ${Math.min(spent + 1, content.config.turnLimit)} of ${content.config.turnLimit} — every attempt costs one`;
  el.age.classList.toggle("age-late", engine.remainingTurns() <= 10);
}

function renderProblems(): void {
  el.problems.innerHTML = engine
    .currentAct()
    .problems.map((p) => {
      const done = engine.isSolved(p.id);
      return `<span class="problem ${done ? "solved" : ""}" title="${p.description}">${done ? "✓" : "○"} ${p.name}</span>`;
    })
    .join("");
}

function renderSlots(): void {
  const [a, b] = selected;
  el.slotA.textContent = a ? `${engine.element(a).emoji} ${engine.element(a).name}` : "?";
  el.slotB.textContent = b ? `${engine.element(b).emoji} ${engine.element(b).name}` : "?";
  el.slotA.classList.toggle("filled", !!a);
  el.slotB.classList.toggle("filled", !!b);
  el.combineBtn.disabled = !(a && b);
}

function renderGrid(): void {
  const q = query.trim().toLowerCase();
  const visible = engine.availableElements().filter((d) => {
    if (onlyNew && !freshFinds.has(d.id)) return false;
    return !q || d.name.toLowerCase().includes(q);
  });

  el.grid.innerHTML = "";
  for (const def of visible) {
    const btn = document.createElement("button");
    btn.className = `element ${freshFinds.has(def.id) ? "is-new" : ""}`;
    btn.dataset.id = def.id;
    btn.innerHTML = `<span class="emoji">${def.emoji}</span><span class="name">${def.name}</span>`;
    attachDrag(btn, def);
    el.grid.appendChild(btn);
  }
  el.gridEmpty.hidden = visible.length > 0;
}

function renderBookBadge(): void {
  const count = engine.availableElements().filter((e) => !e.base).length;
  el.bookBadge.textContent = String(count);
}

el.search.addEventListener("input", () => {
  query = el.search.value;
  renderGrid();
});

el.filterNew.addEventListener("click", () => {
  onlyNew = !onlyNew;
  el.filterNew.setAttribute("aria-pressed", String(onlyNew));
  el.filterNew.classList.toggle("active", onlyNew);
  renderGrid();
});

// --- Bogen som sheet på mobil, inline på desktop ---
function openBook(): void {
  el.bookPanel.classList.add("open");
  document.body.classList.add("book-open");
  book.render();
}

function closeBook(): void {
  el.bookPanel.classList.remove("open");
  document.body.classList.remove("book-open");
}

el.bookBtn.addEventListener("click", () =>
  el.bookPanel.classList.contains("open") ? closeBook() : openBook(),
);
el.bookClose.addEventListener("click", closeBook);

// --- Modaler ---
function showDiscoveryCard(outcome: Extract<CombineOutcome, { kind: "discovery" }>): void {
  const d = outcome.element;
  el.card.innerHTML = `
    <div class="card-inner">
      <div class="card-emoji">${d.emoji}</div>
      <h2>${d.name}</h2>
      <p>${d.flavor ?? ""}</p>
      ${d.note ? `<p class="note">📜 ${d.note}</p>` : ""}
      ${outcome.solved ? `<p class="solved-badge">✓ Problem solved: ${outcome.solved.name}</p>` : ""}
      <button id="card-close">Write it in the book</button>
    </div>`;
  el.card.hidden = false;
  document.getElementById("card-close")!.addEventListener("click", () => {
    el.card.hidden = true;
  });
}

function showAgeUpBanner(): void {
  const act = engine.currentAct();
  el.banner.innerHTML = `
    <div class="banner-inner">
      <h2>⚱️ A new age ⚱️</h2>
      <p>Act ${act.act}: ${act.name}</p>
      <button id="banner-close">Into the future</button>
    </div>`;
  el.banner.hidden = false;
  document.getElementById("banner-close")!.addEventListener("click", () => {
    el.banner.hidden = true;
    const intro = narrator.actIntro();
    if (intro) say(intro);
  });
}

function renderTrophyModal(): void {
  const unlocked = loadAchievements();
  const rows = content.endings
    .map((e) =>
      unlocked[e.id]
        ? `<div class="trophy unlocked"><span class="t-emoji">${e.emoji}</span>
             <div><strong>${e.achievement}</strong><br><small>${e.title} · ${unlocked[e.id]}</small></div></div>`
        : `<div class="trophy locked"><span class="t-emoji">❓</span>
             <div><strong>???</strong><br><small>An undiscovered fate</small></div></div>`,
    )
    .join("");
  el.trophyModal.innerHTML = `
    <div class="modal-inner">
      <h2>🏆 Karl's fates</h2>
      <p class="modal-sub">${Object.keys(unlocked).length}/${content.endings.length} discovered — each run can end differently</p>
      ${rows}
      <button id="trophy-close">Close</button>
    </div>`;
  el.trophyModal.hidden = false;
  document.getElementById("trophy-close")!.addEventListener("click", () => {
    el.trophyModal.hidden = true;
  });
}

el.trophiesBtn.addEventListener("click", renderTrophyModal);

function showEndingScreen(): void {
  const ending = engine.activeEnding();
  if (!ending) return;
  const isNew = unlockAchievement(ending.id);
  const state = engine.getState();
  document.body.classList.add("run-over");
  closeBook();
  el.ending.innerHTML = `
    <div class="ending-inner tone-${ending.tone}">
      <div class="ending-emoji">${ending.emoji}</div>
      <h2>${ending.title}</h2>
      <p class="ending-line">${lastLineText}</p>
      <p class="ending-stats">${state.attempts} summers lived · ${state.discovered.length} discoveries · ${state.flags.length} quirks</p>
      ${isNew
        ? `<p class="achievement">🏆 Achievement unlocked: <strong>${ending.achievement}</strong></p>`
        : `<p class="achievement known">🏆 ${ending.achievement}</p>`}
      <button id="ending-restart">Live again</button>
    </div>`;
  el.ending.hidden = false;
  document.getElementById("ending-restart")!.addEventListener("click", () => {
    clearSave();
    location.reload();
  });
}

// --- Spil-loop ---
function performCombine(a: string, b: string): void {
  if (engine.activeEnding()) return;
  const now = performance.now();
  const elapsedMs = lastAttemptAt === null ? undefined : now - lastAttemptAt;
  lastAttemptAt = now;

  const outcome = engine.combine(a, b);
  const line = narrator.react(a, b, outcome, elapsedMs);
  const ending = engine.activeEnding();

  if (outcome.kind === "discovery") {
    freshFinds.add(outcome.element.id);
    if (!ending) showDiscoveryCard(outcome);
    renderGrid();
    renderProblems();
    renderBookBadge();
    book.render(outcome.element.id);
    save();
    if (outcome.ageUp) showAgeUpBanner();
  }
  if (line) say(line);
  renderAge();
  if (ending) {
    save();
    showEndingScreen();
  }

  selected = [null, null];
  renderSlots();
}

// --- Interaktion: drag ovenpå et andet element er primær; tap-tap er fallback ---
const DRAG_THRESHOLD = 8;
let ghost: HTMLElement | null = null;

function selectElement(def: ElementDef): void {
  if (!selected[0]) selected[0] = def.id;
  else if (!selected[1]) selected[1] = def.id;
  else selected = [def.id, null];
  renderSlots();
}

function attachDrag(btn: HTMLButtonElement, def: ElementDef): void {
  btn.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    btn.setPointerCapture(down.pointerId);
    let moved = false;

    const onMove = (move: PointerEvent) => {
      if (
        !moved &&
        Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < DRAG_THRESHOLD
      ) {
        return;
      }
      if (!moved) {
        moved = true;
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = def.emoji;
        document.body.appendChild(ghost);
        btn.classList.add("dragging");
      }
      ghost!.style.left = `${move.clientX}px`;
      ghost!.style.top = `${move.clientY}px`;
      for (const other of document.querySelectorAll(".drop-target")) {
        other.classList.remove("drop-target");
      }
      const target = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>(".element, .slot");
      target?.classList.add("drop-target");
    };

    const onUp = (up: PointerEvent) => {
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerup", onUp);
      btn.removeEventListener("pointercancel", onUp);
      btn.classList.remove("dragging");
      ghost?.remove();
      ghost = null;
      for (const other of document.querySelectorAll(".drop-target")) {
        other.classList.remove("drop-target");
      }
      if (up.type === "pointercancel") return;

      if (!moved) {
        freshFinds.delete(def.id);
        btn.classList.remove("is-new");
        selectElement(def);
        return;
      }
      const target = document
        .elementFromPoint(up.clientX, up.clientY)
        ?.closest<HTMLElement>(".element, .slot");
      if (!target) return;
      // Slip på et element (også sig selv) → kombinér straks
      if (target.dataset.id) {
        performCombine(def.id, target.dataset.id);
      } else if (target.classList.contains("slot")) {
        // Slip i en slot i docken → læg elementet der
        if (target.id === "slot-a") selected[0] = def.id;
        else selected[1] = def.id;
        renderSlots();
      }
    };

    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onUp);
  });
}

el.combineBtn.addEventListener("click", () => {
  const [a, b] = selected;
  if (a && b) performCombine(a, b);
});

// Tryk på en fyldt slot for at tømme den
for (const [slot, index] of [[el.slotA, 0], [el.slotB, 1]] as const) {
  slot.addEventListener("click", () => {
    selected[index] = null;
    renderSlots();
  });
}

el.restart.addEventListener("click", () => {
  if (!confirm("Start over completely? Karl forgets everything. He's good at that.")) return;
  clearSave();
  location.reload();
});

// --- Titelskærm: første interaktion låser også lyd op (autoplay-politik) ---
function showTitleScreen(): void {
  const canContinue = hasSave();
  const unlocked = Object.keys(loadAchievements()).length;
  el.titleScreen.innerHTML = `
    <div class="title-inner">
      <h1>Kolde Karl</h1>
      <p class="tagline">A stone-age man. A sarcastic narrator. Fifty summers to make history — or a mess.</p>
      <div class="title-actions">
        ${canContinue ? `<button id="t-continue" class="primary">Continue</button>` : ""}
        <button id="t-new" class="${canContinue ? "" : "primary"}">${canContinue ? "New life" : "Begin"}</button>
        <button id="t-fates">🏆 Fates ${unlocked}/${content.endings.length}</button>
      </div>
      <p class="title-hint">Drag one element onto another to combine them.</p>
    </div>`;
  el.titleScreen.hidden = false;

  document.getElementById("t-new")!.addEventListener("click", () => {
    clearSave();
    startGame(false);
  });
  document.getElementById("t-continue")?.addEventListener("click", () => startGame(true));
  document.getElementById("t-fates")!.addEventListener("click", renderTrophyModal);
}

function startGame(resume: boolean): void {
  const resumed = resume && tryLoad();
  el.titleScreen.hidden = true;
  renderAll();
  if (engine.activeEnding()) {
    lastLineText = lastLineText || `${engine.activeEnding()!.title}.`;
    showEndingScreen();
    return;
  }
  // Titelskærmens knap er brugerinteraktionen der låser autoplay op
  void initAudio(true).then(() => {
    const opening = resumed ? narrator.resume() : narrator.actIntro();
    if (opening) say(opening);
  });
}

function renderAll(): void {
  renderAge();
  renderProblems();
  renderSlots();
  renderGrid();
  renderMute();
  renderBookBadge();
  book.render();
}

// --- Opstart ---
renderAll();
showTitleScreen();
