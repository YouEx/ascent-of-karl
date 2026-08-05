import { Engine } from "../core/engine";
import { deserialize, serialize } from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import type { NarratorState } from "../narrator/narrator";
import type { SpokenLine } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import { BookView } from "./book";
import { initAudio, playLine, stopAudio } from "./audio";

const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";
const MUTE_KEY = "kolde-karl-muted";

const content = loadContent();
const engine = new Engine(content);
// Nyt seed pr. playthrough → nye variantvalg hver gang (docs/design/fortaelleren.md)
const narrator = new Narrator(engine, freshNarratorState((Math.random() * 2 ** 31) | 0));

// --- Autosave pr. opdagelse (PRD §4.1) ---
function save(): void {
  localStorage.setItem(SAVE_KEY, serialize(engine.getState(), new Date().toISOString()));
  localStorage.setItem(NARRATOR_SAVE_KEY, JSON.stringify(narrator.getState()));
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

// --- DOM-skelet: bogen er primær; fortælleren taler fra en boble der peger ud af skærmen ---
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <h1>Kolde Karl</h1>
    <div id="act-name"></div>
    <span id="age" title="Every attempt costs a summer of Karl's life"></span>
    <button id="trophies" title="Fates discovered">🏆</button>
    <button id="reset" title="Start over">↺ Start over</button>
  </header>
  <section id="narrator" aria-live="polite">
    <div id="bubble">
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button id="mute" aria-pressed="false" title="Mute the narrator">🔊</button>
      </div>
      <p id="narrator-text"></p>
    </div>
  </section>
  <section id="book" aria-label="The chronicle of mankind"></section>
  <section id="problems" aria-label="Karl's problems"></section>
  <section id="workbench">
    <div class="slot" id="slot-a">?</div>
    <span class="plus">+</span>
    <div class="slot" id="slot-b">?</div>
    <button id="combine" disabled>Combine</button>
  </section>
  <p id="drag-hint">Drag one element onto another — or tap two and combine.</p>
  <section id="grid" aria-label="Elements"></section>
  <div id="banner" hidden></div>
  <div id="card" hidden></div>
  <div id="ending" hidden></div>
  <div id="trophy-modal" hidden></div>
`;

const el = {
  actName: document.getElementById("act-name")!,
  problems: document.getElementById("problems")!,
  narratorText: document.getElementById("narrator-text")!,
  muteBtn: document.getElementById("mute") as HTMLButtonElement,
  bubble: document.getElementById("bubble")!,
  slotA: document.getElementById("slot-a")!,
  slotB: document.getElementById("slot-b")!,
  combineBtn: document.getElementById("combine") as HTMLButtonElement,
  grid: document.getElementById("grid")!,
  banner: document.getElementById("banner")!,
  card: document.getElementById("card")!,
  ending: document.getElementById("ending")!,
  trophyModal: document.getElementById("trophy-modal")!,
  trophiesBtn: document.getElementById("trophies")!,
  age: document.getElementById("age")!,
  reset: document.getElementById("reset")!,
};

const book = new BookView(engine, document.getElementById("book")!);

let selected: [string | null, string | null] = [null, null];
let typewriterTimer: ReturnType<typeof setInterval> | undefined;
let muted = localStorage.getItem(MUTE_KEY) === "1";
let lastLineText = "";
let lastAttemptAt: number | null = null;

// --- Fortæller-replik: tekst med typewriter + evt. lydfil; ny replik afbryder elegant (PRD §4.3) ---
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
  el.muteBtn.title = muted ? "Unmute the narrator" : "Mute the narrator";
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

// --- Achievements: skæbner overlever på tværs af runs (localStorage) ---
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";

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

function renderTrophyModal(): void {
  const unlocked = loadAchievements();
  const rows = content.endings
    .map((e) => {
      if (unlocked[e.id]) {
        return `<div class="trophy unlocked"><span class="t-emoji">${e.emoji}</span>
          <div><strong>${e.achievement}</strong><br><small>${e.title} · ${unlocked[e.id]}</small></div></div>`;
      }
      return `<div class="trophy locked"><span class="t-emoji">❓</span>
        <div><strong>???</strong><br><small>An undiscovered fate</small></div></div>`;
    })
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

function renderAge(): void {
  const spent = content.config.turnLimit - engine.remainingTurns();
  el.age.textContent = `⏳ Summer ${Math.min(spent + 1, content.config.turnLimit)} of ${content.config.turnLimit}`;
  el.age.classList.toggle("age-late", engine.remainingTurns() <= 10);
}

function showEndingScreen(): void {
  const ending = engine.activeEnding();
  if (!ending) return;
  const isNew = unlockAchievement(ending.id);
  const state = engine.getState();
  document.body.classList.add("run-over");
  el.ending.innerHTML = `
    <div class="ending-inner tone-${ending.tone}">
      <div class="ending-emoji">${ending.emoji}</div>
      <h2>${ending.title}</h2>
      <p class="ending-line">${lastLineText}</p>
      <p class="ending-stats">${state.attempts} summers lived · ${state.discovered.length} discoveries · ${state.flags.length} quirks</p>
      ${isNew ? `<p class="achievement">🏆 Achievement unlocked: <strong>${ending.achievement}</strong></p>` : `<p class="achievement known">🏆 ${ending.achievement}</p>`}
      <button id="ending-restart">Live again</button>
    </div>`;
  el.ending.hidden = false;
  document.getElementById("ending-restart")!.addEventListener("click", () => {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(NARRATOR_SAVE_KEY);
    location.reload();
  });
}

function renderProblems(): void {
  const act = engine.currentAct();
  el.actName.textContent = `Act ${act.act}: ${act.name}`;
  el.problems.innerHTML = act.problems
    .map((p) => {
      const done = engine.isSolved(p.id);
      return `<span class="problem ${done ? "solved" : ""}" title="${p.description}">${done ? "✓" : "○"} ${p.name}</span>`;
    })
    .join("");
}

function renderSlots(): void {
  const [a, b] = selected;
  el.slotA.textContent = a ? `${engine.element(a).emoji} ${engine.element(a).name}` : "?";
  el.slotB.textContent = b ? `${engine.element(b).emoji} ${engine.element(b).name}` : "?";
  el.combineBtn.disabled = !(a && b);
}

function renderGrid(): void {
  el.grid.innerHTML = "";
  for (const def of engine.availableElements()) {
    const btn = document.createElement("button");
    btn.className = "element";
    btn.dataset.id = def.id;
    btn.innerHTML = `<span class="emoji">${def.emoji}</span><span class="name">${def.name}</span>`;
    attachDrag(btn, def);
    el.grid.appendChild(btn);
  }
}

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

function performCombine(a: string, b: string): void {
  if (engine.activeEnding()) return;
  const now = performance.now();
  const elapsedMs = lastAttemptAt === null ? undefined : now - lastAttemptAt;
  lastAttemptAt = now;

  const outcome = engine.combine(a, b);
  const line = narrator.react(a, b, outcome, elapsedMs);
  const ending = engine.activeEnding();

  if (outcome.kind === "discovery") {
    if (!ending) showDiscoveryCard(outcome);
    renderGrid();
    renderProblems();
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
// (docs/design/bogen.md — pointer events dækker både mus og touch)
const DRAG_THRESHOLD = 8;
let ghost: HTMLElement | null = null;

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
      for (const other of el.grid.querySelectorAll(".element.drop-target")) {
        other.classList.remove("drop-target");
      }
      const target = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>(".element");
      target?.classList.add("drop-target");
    };

    const onUp = (up: PointerEvent) => {
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerup", onUp);
      btn.removeEventListener("pointercancel", onUp);
      btn.classList.remove("dragging");
      ghost?.remove();
      ghost = null;
      for (const other of el.grid.querySelectorAll(".element.drop-target")) {
        other.classList.remove("drop-target");
      }
      if (up.type === "pointercancel") return;

      if (!moved) {
        // Tap-fallback: vælg til slots
        if (!selected[0]) selected[0] = def.id;
        else if (!selected[1]) selected[1] = def.id;
        else selected = [def.id, null];
        renderSlots();
        return;
      }
      const target = document
        .elementFromPoint(up.clientX, up.clientY)
        ?.closest<HTMLElement>(".element");
      // Slip på et element (også sig selv: sten + sten) → kombinér
      if (target?.dataset.id) performCombine(def.id, target.dataset.id);
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

el.reset.addEventListener("click", () => {
  if (!confirm("Start over completely? Karl forgets everything. He's good at that.")) return;
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(NARRATOR_SAVE_KEY);
  location.reload();
});

// --- Opstart ---
const resumed = tryLoad();
renderProblems();
renderSlots();
renderGrid();
renderMute();
renderAge();
book.render();
if (engine.activeEnding()) {
  // Runnet var allerede slut da vi gemte — vis slutningen igen
  const e = engine.activeEnding()!;
  lastLineText = lastLineText || `${e.title}.`;
  showEndingScreen();
} else {
  void initAudio().then(() => {
    const opening = resumed ? narrator.resume() : narrator.actIntro();
    if (opening) say(opening);
  });
}
