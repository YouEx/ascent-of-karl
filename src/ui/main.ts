import { Engine } from "../core/engine";
import { deserialize, serialize } from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import type { NarratorState, SpokenLine } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import { BookView } from "./book";
import { initAudio, playLine, stopAudio } from "./audio";
import { closeTopOverlay, initOverlays, openOverlay } from "./overlay";
import { RARITY_LABEL, computeRarity } from "../core/rarity";
import { icons } from "./icons";
import { PlaytestLog } from "./playtest";

// Nøglerne beholder deres oprindelige "kolde-karl"-navn selv om spillet er
// omdøbt til The Ascent of Karl: de står i spillernes browsere, og en omdøbning
// ville smide alle gemte spil og skæbner væk for at rette et navn ingen ser.
const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";
const MUTE_KEY = "kolde-karl-muted";
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";

const content = loadContent();
const engine = new Engine(content);
const playtest = new PlaytestLog();
// Challenges spawner ud fra dette seed — nyt pr. liv, gemt i saven, så et
// genindlæst run ikke kan ryste terningerne igen.
engine.loadState({ ...engine.getState(), seed: (Math.random() * 2 ** 31) | 0 });
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
    <h1>The Ascent of Karl</h1>
    <span id="age" title="Every attempt costs a summer of Karl's life"></span>
    <div class="header-actions">
      <button id="book-btn" class="icon-btn" aria-label="Open the chronicle">${icons.book}<span id="book-badge"></span></button>
      <button id="trophies" class="icon-btn" aria-label="Fates discovered">${icons.trophy}</button>
      <button id="restart" class="icon-btn" aria-label="Start over">${icons.restart}</button>
    </div>
  </header>

  <section id="narrator" aria-live="polite">
    <div id="bubble">
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button id="mute" class="icon-btn" aria-pressed="false" aria-label="Mute the narrator">${icons.soundOn}</button>
      </div>
      <p id="narrator-text"></p>
    </div>
  </section>

  <section id="challenge" hidden aria-live="assertive"></section>
  <section id="problems" aria-label="Karl's problems"></section>

  <div id="tools">
    <input id="search" type="search" placeholder="Search elements…" aria-label="Search elements" autocomplete="off">
    <button id="filter-new" class="chip-btn" aria-pressed="false">New finds</button>
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
    <button id="book-close" class="icon-btn" aria-label="Close the chronicle">${icons.close}</button>
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
  challenge: document.getElementById("challenge")!,
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

// Sjældenhed udledes én gang af indholdet — den kan ikke ændre sig i et run
const rarity = computeRarity(content);

const book = new BookView(engine, document.getElementById("book")!);

let selected: [string | null, string | null] = [null, null];
let typewriterTimer: ReturnType<typeof setInterval> | undefined;
let muted = localStorage.getItem(MUTE_KEY) === "1";
let lastLineText = "";
let lastAttemptAt: number | null = null;
let runStartedAt = performance.now();
let query = "";
let onlyNew = false;
/** Opdaget i denne session — får en okker prik, så de er til at finde i et stort grid */
const freshFinds = new Set<string>();

// --- Fortæller ---
/**
 * Fortælleren taler i takter. En opdagelse kan give to: hvad der skete, og
 * hvad historien vil herfra. De køes, så anden takt først skrives ud når
 * første er færdig — ellers ville trækket overskrive sin egen optakt.
 */
let lineQueue: SpokenLine[] = [];
let queueTimer: ReturnType<typeof setTimeout> | undefined;
/** Pause mellem to takter, så det læses som et åndedrag og ikke som én tekst */
const BEAT_PAUSE_MS = 900;

function say(line: SpokenLine): void {
  if (queueTimer) clearTimeout(queueTimer);
  lineQueue = [];
  playLine(line, muted);
  speak(line.text);
}

/** Læg en efterfølgende takt i kø bag den, der spiller nu. */
function sayAfter(line: SpokenLine | undefined): void {
  if (!line) return;
  lineQueue.push(line);
  scheduleNextBeat();
}

function scheduleNextBeat(): void {
  if (queueTimer || lineQueue.length === 0) return;
  // Mutet fortæller skriver ikke, så der er ingen skrivetid at vente på.
  const wait = muted ? BEAT_PAUSE_MS : typewriterMsLeft() + BEAT_PAUSE_MS;
  queueTimer = setTimeout(() => {
    queueTimer = undefined;
    const next = lineQueue.shift();
    if (!next) return;
    playLine(next, muted);
    speak(next.text);
    scheduleNextBeat();
  }, wait);
}

/** Skrivehastighed for skrivemaskine-effekten (ms pr. tegn) */
const TYPE_MS = 18;
/** Tegn der mangler at blive skrevet ud — driver pausen mellem to takter */
let typewriterLeft = 0;

function typewriterMsLeft(): number {
  return typewriterLeft * TYPE_MS;
}

function speak(text: string): void {
  lastLineText = text;
  if (muted) return;
  if (typewriterTimer) clearInterval(typewriterTimer);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    typewriterLeft = 0;
    el.narratorText.textContent = text;
    return;
  }
  el.narratorText.textContent = "";
  let i = 0;
  typewriterLeft = text.length;
  typewriterTimer = setInterval(() => {
    i++;
    typewriterLeft = text.length - i;
    el.narratorText.textContent = text.slice(0, i);
    if (i >= text.length && typewriterTimer) clearInterval(typewriterTimer);
  }, TYPE_MS);
}

function renderMute(): void {
  el.muteBtn.innerHTML = muted ? icons.soundOff : icons.soundOn;
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
  // Det problem fortælleren peger på markeres, så hans hensigt altid er
  // synlig uden at han skal gentage sig. Dét er det, der gør ulydighed
  // til et valg frem for et tilfælde.
  const pulled = narrator.currentPull()?.id;
  el.problems.innerHTML = engine
    .currentAct()
    .problems.map((p) => {
      const done = engine.isSolved(p.id);
      const wanted = !done && p.id === pulled;
      const cls = `problem${done ? " solved" : ""}${wanted ? " wanted" : ""}`;
      const hint = wanted ? " — the narrator wants this next" : "";
      return `<span class="${cls}" title="${p.description}${hint}">${done ? "✓" : wanted ? "→" : "○"} ${p.name}</span>`;
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
  renderSelection();
}

/**
 * Markér de valgte elementer i griddet. Uden dette var den eneste synlige
 * markering browserens fokus-ring på den sidst klikkede knap — så det så ud
 * som om kun ét af de to valgte var aktivt.
 *
 * Opdaterer klasser på eksisterende knapper i stedet for at gentegne
 * griddet, så scroll-position og fokus ikke ryger ved hvert valg.
 */
function renderSelection(): void {
  for (const btn of el.grid.querySelectorAll<HTMLElement>(".element")) {
    const id = btn.dataset.id!;
    const count = selected.filter((s) => s === id).length;
    btn.classList.toggle("is-selected", count > 0);
    // Samme element i begge slots (fx sten + sten) — vis at det tæller to gange
    btn.classList.toggle("is-selected-twice", count === 2);
    btn.setAttribute("aria-pressed", String(count > 0));
  }
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
    attachSelect(btn, def);
    el.grid.appendChild(btn);
  }
  el.gridEmpty.hidden = visible.length > 0;
  renderSelection();
}

function renderBookBadge(): void {
  const count = engine.availableElements().filter((e) => !e.base).length;
  el.bookBadge.textContent = String(count);
  // Et "0"-badge er støj: mærket findes for at sige "der er noget nyt derinde".
  el.bookBadge.hidden = count === 0;
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
  openOverlay(el.bookPanel, {
    label: "The book — your encyclopedia of history",
    onClose: () => {
      el.bookPanel.classList.remove("open");
      document.body.classList.remove("book-open");
    },
  });
}

function closeBook(): void {
  if (el.bookPanel.classList.contains("open")) closeTopOverlay();
}

el.bookBtn.addEventListener("click", () =>
  el.bookPanel.classList.contains("open") ? closeBook() : openBook(),
);
el.bookClose.addEventListener("click", closeBook);

// --- Modaler ---
function showDiscoveryCard(outcome: Extract<CombineOutcome, { kind: "discovery" }>): void {
  const d = outcome.element;
  // "Write it in the book" antydede et valg der ikke findes — opdagelsen er
  // allerede skrevet ind. Kortet er en belønning, ikke en formular: emojien
  // står i centrum med stråler bagved, og knappen bekræfter bare.
  //
  // Sjældenheden (src/core/rarity.ts) styrer hvor stort det fejres: common
  // får et roligt pop, rare får stråler og gnister, unique får hele showet.
  const tier = rarity.get(d.id)?.tier ?? "common";
  const sparks = tier === "unique" ? 16 : tier === "rare" ? 8 : 0;
  el.card.innerHTML = `
    <div class="card-inner tier-${tier}">
      <p class="card-kicker">${RARITY_LABEL[tier]}</p>
      <div class="card-stage">
        ${tier === "common" ? "" : '<div class="card-rays" aria-hidden="true"></div>'}
        ${tier === "unique" ? '<div class="card-halo" aria-hidden="true"></div>' : ""}
        <div class="card-burst" aria-hidden="true">
          ${Array.from({ length: sparks }, (_, i) =>
            `<i style="--i:${i};--n:${sparks}"></i>`).join("")}
        </div>
        <div class="card-emoji">${d.emoji}</div>
      </div>
      <h2>${d.name}</h2>
      <p class="card-flavor">${d.flavor ?? ""}</p>
      ${d.note ? `<p class="note">📜 ${d.note}</p>` : ""}
      ${outcome.solved ? `<p class="solved-badge">✓ Problem solved: ${outcome.solved.name}</p>` : ""}
      <button id="card-close">Nice</button>
    </div>`;
  el.card.hidden = false;
  openOverlay(el.card, {
    label: `Discovered: ${d.name}`,
    // Combine-knappen deaktiveres når slots ryddes, så den kan ikke tage
    // fokus tilbage. Bogen er det naturlige næste sted efter en opdagelse.
    fallbackFocus: () => el.bookBtn,
    onClose: () => {
      el.card.hidden = true;
    },
  });
  document
    .getElementById("card-close")!
    .addEventListener("click", () => closeTopOverlay());
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
  // Uanset hvordan banneret lukkes (knap, baggrund, Esc, back) skal
  // akt-introen lyde — ellers straffes spilleren for at lukke "forkert".
  openOverlay(el.banner, {
    label: `A new age: Act ${act.act}, ${act.name}`,
    onClose: () => {
      el.banner.hidden = true;
      const intro = narrator.actIntro();
      if (intro) say(intro);
    },
  });
  document
    .getElementById("banner-close")!
    .addEventListener("click", () => closeTopOverlay());
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
      <div class="modal-head">
        <div>
          <h2>Karl's fates</h2>
          <p class="modal-sub">${Object.keys(unlocked).length}/${content.endings.length} discovered — each run can end differently</p>
        </div>
        <button id="trophy-close" class="icon-btn" aria-label="Close">${icons.close}</button>
      </div>
      ${rows}
    </div>`;
  el.trophyModal.hidden = false;
  openOverlay(el.trophyModal, {
    label: "Karl's fates",
    onClose: () => {
      el.trophyModal.hidden = true;
    },
  });
  document
    .getElementById("trophy-close")!
    .addEventListener("click", () => closeTopOverlay());
}

el.trophiesBtn.addEventListener("click", renderTrophyModal);

function showEndingScreen(): void {
  const ending = engine.activeEnding();
  if (!ending) return;
  const isNew = unlockAchievement(ending.id);
  // Carl the Lucky: hele livet igennem uden ét eneste challenge.
  // Ved 3 %-stigende-til-15 % sker det i under 1 % af alle runs.
  const lucky = engine.neverChallenged() && unlockAchievement("carl-the-lucky");
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
        ? `<p class="achievement">Achievement unlocked: <strong>${ending.achievement}</strong></p>`
        : `<p class="achievement known">${ending.achievement}</p>`}
      ${lucky
        ? `<p class="achievement">Achievement unlocked: <strong>Carl the Lucky</strong><br>
             <small>A whole life, and the world never once came for him.</small></p>`
        : ""}
      <button id="ending-restart">Live again</button>
      <button id="ending-stats" class="secondary">Copy playtest log</button>
    </div>`;
  el.ending.hidden = false;
  // Terminal (se docs/design/ux-checklist.md §1): runnet ER slut, så der er
  // ingen tilstand at vende tilbage til. "Live again" er den fremadrettede
  // handling der opløser den — derfor ingen baggrundsklik/Esc/back her.
  openOverlay(el.ending, {
    label: `Karl's fate: ${ending.title}`,
    terminal: true,
    onClose: () => {
      el.ending.hidden = true;
    },
  });
  document.getElementById("ending-restart")!.addEventListener("click", () => {
    clearSave();
    location.reload();
  });
  // Playtest-hjælp (ROADMAP prioritet 2): hele loggen, ikke kun dette run.
  // En tester der spiller tre gange skal kunne nøjes med at kopiere én gang.
  document.getElementById("ending-stats")!.addEventListener("click", async (e) => {
    const payload = JSON.stringify(playtest.read());
    const btn = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(payload);
      btn.textContent = "Copied ✓";
    } catch {
      // Uden clipboard-adgang (usikker kontekst, afvist tilladelse) er
      // dataene stadig spillerens: læg dem et sted de kan markeres.
      const out = document.createElement("textarea");
      out.className = "playtest-dump";
      out.readOnly = true;
      out.value = payload;
      btn.replaceWith(out);
      out.select();
    }
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
  // Beregnes FØR save() nedenfor: followUp() bogfører hvad fortælleren bad
  // om og hvor tit han er blevet trodset. Kørte den efter gemmet, ville en
  // genindlæsning nulstille hans hukommelse om sine egne opfordringer.
  const followUp = ending ? undefined : narrator.followUp(outcome);

  // Blindgyden er det eneste datapunkt der ikke kan rekonstrueres bagefter
  if (outcome.kind === "nothing") playtest.miss(a, b, engine.getState().attempts);

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
  // Anden takt: fortælleren peger videre — eller bemærker at han lige blev
  // ignoreret. Køes bag historiereplikken, så den ikke overskriver sin optakt.
  sayAfter(followUp);
  renderAge();
  renderChallenge();
  if (ending) {
    // Runnet slutter HER, ikke når skærmen vises: en genindlæsning på
    // slutskærmen viser den igen, og så ville runnet blive talt to gange
    // med en varighed på nul minutter.
    playtest.run({
      ending: ending.id,
      summers: engine.getState().attempts,
      discoveries: engine.getState().discovered.length,
      solved: engine.getState().solvedProblems,
      flags: engine.getState().flags,
      minutes: Math.round((performance.now() - runStartedAt) / 60000),
    });
    save();
    showEndingScreen();
  }

  selected = [null, null];
  renderSlots();
}

/**
 * Interaktion: tap-tap (PRD §2.1 afviger bevidst fra drag).
 *
 * Drag blev fjernet 2026-08-07: griddet er blevet langt nok til at kræve
 * scroll, og en drag-gestus der starter på et element stjæler den lodrette
 * bevægelse fra scrollen. Man kunne ikke komme ned i listen uden at samle
 * noget op. Tap-tap kan begge dele uden at slås om den samme bevægelse.
 */
function selectElement(def: ElementDef): void {
  if (!selected[0]) selected[0] = def.id;
  else if (!selected[1]) selected[1] = def.id;
  else selected = [def.id, null];
  renderSlots();
}

function attachSelect(btn: HTMLButtonElement, def: ElementDef): void {
  btn.addEventListener("click", () => {
    freshFinds.delete(def.id);
    btn.classList.remove("is-new");
    selectElement(def);
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

/**
 * Båndene bag Karl. Rent dekorative (aria-hidden) og bevidst i SVG frem for
 * billede: de skal kunne farves med tokens og skalere skarpt på ethvert
 * viewport. `slice` bevarer kurvernes proportioner og beskærer i stedet for at
 * strække dem — en ikke-uniform skalering ville gøre stregtykkelsen ujævn.
 */
const RIBBONS = `
  <svg class="ribbons" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <path class="r1" d="M-140 196 C 210 74, 386 344, 716 226 S 1168 96, 1580 202"/>
    <path class="r2" d="M-140 316 C 200 176, 372 470, 706 340 S 1160 196, 1580 312"/>
    <path class="r3" d="M-140 398 C 260 306, 430 578, 830 434 S 1252 336, 1580 412"/>
    <path class="r4" d="M-140 686 C 246 548, 388 872, 726 752 S 1186 630, 1580 690"/>
    <path class="r5" d="M-140 782 C 306 700, 512 952, 906 828 S 1304 716, 1580 776"/>
    <path class="r6" d="M-140 872 C 286 806, 470 1024, 886 918 S 1298 826, 1580 878"/>
  </svg>`;

function showTitleScreen(): void {
  const canContinue = hasSave();
  const unlocked = Object.keys(loadAchievements()).length;
  el.titleScreen.innerHTML = `
    ${RIBBONS}
    <div class="title-grid">
      <div class="title-copy">
        <h1>The Ascent<span> of Karl</span></h1>
        <p class="title-sub">reinvent history, badly</p>
        <p class="tagline">A stone-age man. A sarcastic narrator. Fifty summers to make history — or a mess.</p>
        <div class="title-actions">
          ${canContinue ? `<button id="t-continue" class="primary">Continue</button>` : ""}
          <button id="t-new" class="${canContinue ? "" : "primary"}">${canContinue ? "New life" : "Begin"}</button>
          <button id="t-fates">Fates <span class="fates-count">${unlocked}/${content.endings.length}</span></button>
        </div>
        <p class="title-hint">Drag one element onto another to combine them.</p>
      </div>
      <div class="title-art">
        <img src="karl.webp" width="594" height="712"
             alt="Karl, a bewildered stone-age man in a yellow fur, holding a rock" />
      </div>
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
  runStartedAt = performance.now();
  renderAll();
  const resumedEnding = engine.activeEnding();
  if (resumedEnding) {
    // Genoptaget afsluttet run: fortællerens sidste ord er ikke i hukommelsen
    // længere, så vi henter replikkens første variant som gengivelse.
    if (!lastLineText) {
      const def = narrator.line(resumedEnding.line);
      lastLineText = def.variants[0] ?? `${resumedEnding.title}.`;
    }
    el.narratorText.textContent = lastLineText;
    showEndingScreen();
    return;
  }
  // Titelskærmens knap er brugerinteraktionen der låser autoplay op
  void initAudio(true).then(() => {
    const opening = resumed ? narrator.resume() : narrator.actIntro();
    if (opening) say(opening);
    // Historien får sin retning med det samme. Uden et erklæret mål fra
    // første takt er de første kombinationer bare famlen — og der er intet
    // at trodse.
    sayAfter(narrator.openingPull());
    save();
  });
}

/**
 * Challenge-banneret. Bevidst placeret ØVERST og med aria-live="assertive":
 * en frist der løber er ikke noget man må overse, og den er den eneste
 * situation i spillet hvor tid faktisk presser.
 */
function renderChallenge(): void {
  const ch = engine.activeChallenge();
  if (!ch) {
    el.challenge.hidden = true;
    return;
  }
  const { def, active } = ch;
  const urgent = active.turnsLeft <= 2;
  el.challenge.innerHTML = `
    <div class="challenge-inner${urgent ? " urgent" : ""}">
      <span class="ch-emoji">${def.emoji}</span>
      <div class="ch-body">
        <strong>${def.title}</strong>
        <span class="ch-turns">${active.turnsLeft} summer${active.turnsLeft === 1 ? "" : "s"} to find a way out</span>
      </div>
    </div>`;
  el.challenge.hidden = false;
}

function renderAll(): void {
  renderAge();
  renderChallenge();
  renderProblems();
  renderSlots();
  renderGrid();
  renderMute();
  renderBookBadge();
  book.render();
}

// --- Opstart ---
initOverlays();
renderAll();
showTitleScreen();
