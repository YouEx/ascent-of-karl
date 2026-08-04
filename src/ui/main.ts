import { Engine } from "../core/engine";
import { deserialize, serialize } from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import type { NarratorState } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import { BookView } from "./book";

const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";

const content = loadContent();
const engine = new Engine(content);
const narrator = new Narrator(engine);

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

// --- DOM-skelet: bogen øverst, værkstedet nederst (docs/design/bogen.md) ---
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <h1>Kolde Karl</h1>
    <div id="act-name"></div>
    <button id="reset" title="Start forfra">↺ Forfra</button>
  </header>
  <section id="book" aria-label="Menneskehedens leksikon"></section>
  <section id="problems" aria-label="Karls problemer"></section>
  <section id="narrator" aria-live="polite">
    <span id="narrator-label">Fortælleren</span>
    <p id="narrator-text"></p>
  </section>
  <section id="workbench">
    <div class="slot" id="slot-a">?</div>
    <span class="plus">+</span>
    <div class="slot" id="slot-b">?</div>
    <button id="combine" disabled>Kombinér</button>
  </section>
  <p id="drag-hint">Træk et element ovenpå et andet — eller tryk på to og kombinér.</p>
  <section id="grid" aria-label="Elementer"></section>
  <div id="banner" hidden></div>
  <div id="card" hidden></div>
`;

const el = {
  actName: document.getElementById("act-name")!,
  problems: document.getElementById("problems")!,
  narratorText: document.getElementById("narrator-text")!,
  slotA: document.getElementById("slot-a")!,
  slotB: document.getElementById("slot-b")!,
  combineBtn: document.getElementById("combine") as HTMLButtonElement,
  grid: document.getElementById("grid")!,
  banner: document.getElementById("banner")!,
  card: document.getElementById("card")!,
  reset: document.getElementById("reset")!,
};

const book = new BookView(engine, document.getElementById("book")!);

let selected: [string | null, string | null] = [null, null];
let typewriterTimer: ReturnType<typeof setInterval> | undefined;

// --- Fortæller-tekst med typewriter; ny replik afbryder elegant (PRD §4.3) ---
function speak(text: string): void {
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

function renderProblems(): void {
  const act = engine.currentAct();
  el.actName.textContent = `Akt ${act.act}: ${act.name}`;
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

function refreshAfterDiscovery(): void {
  renderGrid();
  renderProblems();
  book.render();
  save();
}

function showDiscoveryCard(outcome: Extract<CombineOutcome, { kind: "discovery" }>): void {
  const d = outcome.element;
  el.card.innerHTML = `
    <div class="card-inner">
      <div class="card-emoji">${d.emoji}</div>
      <h2>${d.name}</h2>
      <p>${d.flavor ?? ""}</p>
      ${d.note ? `<p class="note">📜 ${d.note}</p>` : ""}
      ${outcome.solved ? `<p class="solved-badge">✓ Problem løst: ${outcome.solved.name}</p>` : ""}
      <button id="card-close">Skriv i bogen</button>
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
      <h2>⚱️ Ny epoke ⚱️</h2>
      <p>Akt ${act.act}: ${act.name}</p>
      <button id="banner-close">Ind i fremtiden</button>
    </div>`;
  el.banner.hidden = false;
  document.getElementById("banner-close")!.addEventListener("click", () => {
    el.banner.hidden = true;
    const intro = narrator.actIntro();
    if (intro) speak(intro.text);
  });
}

function performCombine(a: string, b: string): void {
  const outcome = engine.combine(a, b);
  const line = narrator.react(a, b, outcome);

  if (outcome.kind === "discovery") {
    showDiscoveryCard(outcome);
    refreshAfterDiscovery();
    if (outcome.ageUp) showAgeUpBanner();
  }
  if (line) speak(line.text);

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
  if (!confirm("Start helt forfra? Karl glemmer alt. Det er han god til.")) return;
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(NARRATOR_SAVE_KEY);
  location.reload();
});

// --- Opstart ---
const resumed = tryLoad();
renderProblems();
renderSlots();
renderGrid();
book.render();
if (resumed) {
  speak("Nå. Du er tilbage. Karl har ventet. Det har jeg også, men mig spørger ingen til.");
} else {
  const intro = narrator.actIntro();
  if (intro) speak(intro.text);
}
