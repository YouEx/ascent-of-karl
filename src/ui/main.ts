import { Engine } from "../core/engine";
import { improvisedElementId } from "../core/improvise";
import { judgePair } from "../core/verdict";
import { deserialize, serialize } from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import { LiveNarrator } from "../narrator/live";
import { loadPairs } from "../narrator/pairs";
import type { NarratorState, SpokenLine } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import { BookView } from "./book";
import { initAudio, playLine, stopAudio } from "./audio";
import { closeTopOverlay, initOverlays, openOverlay } from "./overlay";
import { RARITY_LABEL, computeRarity } from "../core/rarity";
import { icons } from "./icons";
import { glyphHTML, problemGlyphHTML } from "./art";
import { TITLE_WORDMARKS } from "./title-art";
import { PlaytestLog } from "./playtest";
import {
  IMPROVISE_ENABLED,
  improvisationRejectionStatus,
  performPlayerAttempt,
  shouldPrefetchImprovisedCopy,
  shouldPersistAttemptState,
} from "./improvise-flow";
import {
  renderElementTileContent,
  elementOriginClass,
  escapeHTML,
  renderCopyStatus,
  renderInventionSummaryHTML,
  renderSlotContent,
} from "./improvise-view";
import {
  CopyGenerationGuard,
  ImproviseClient,
  settleCurrentCopy,
  type ImproviseCopyState,
} from "./improvise-client";
import { summarizeInventions } from "./run-summary";
import { StoryBook } from "./story-book";
import { openingStoryPage, storyPageForOutcome } from "./story-page";
import { ImprovisationPlaytestLog } from "./improvise-playtest";
import {
  activeScenario,
  bootSeed,
  isFrozen,
  markReadyWhenPainted,
  resetStorageForScenario,
} from "./scenario";

// Nøglerne beholder deres oprindelige "kolde-karl"-navn selv om spillet er
// omdøbt til The Ascent of Karl: de står i spillernes browsere, og en omdøbning
// ville smide alle gemte spil og skæbner væk for at rette et navn ingen ser.
const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";
const MUTE_KEY = "kolde-karl-muted";
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";

// Et scenarie må ikke arve browserens historik: en maskine med et halvspillet
// run ville måle noget helt andet end en ren. Ryddes FØR engine bygges.
resetStorageForScenario([SAVE_KEY, NARRATOR_SAVE_KEY, ACHIEVEMENTS_KEY]);

const content = loadContent();
const engine = new Engine(content);
const playtest = new PlaytestLog();
const improvisationPlaytest = IMPROVISE_ENABLED
  ? new ImprovisationPlaytestLog()
  : null;
// Challenges spawner ud fra dette seed — nyt pr. liv, gemt i saven, så et
// genindlæst run ikke kan ryste terningerne igen. bootSeed() er fast under
// frysning, så to optagelser af samme scenarie er identiske.
engine.loadState({ ...engine.getState(), seed: bootSeed() });
// Nyt seed pr. playthrough → nye variantvalg hver gang (docs/design/fortaelleren.md)
const narrator = new Narrator(engine, freshNarratorState(bootSeed()));

// De bagte par-replikker hentes i deres eget bundt (CON-003), så første
// indlæsning ikke vokser. Hentningen startes med det samme og venter ikke på
// noget: lander filen først efter spillerens første forsøg, svarer
// grammatikken i mellemtiden — den er skrevet netop for at kunne bære alene.
const pairsReady = loadPairs(engine.currentAct().act).then((data) => {
  if (data) narrator.attachPairs(data);
});

// Sidste udvej for de par ingen har skrevet om: en replik hentet mens
// spilleren stadig vælger. Er der ingen endpoint bygget ind, gør den
// ingenting overhovedet — laget er en forbedring af halen, ikke en
// afhængighed, og spillet skal kunne spilles offline uden at mangle noget.
const live = new LiveNarrator();
if (live.enabled) narrator.attachLive(live);

// Produktflag og endpoint er to uafhængige kontrakter. Flaget åbner den
// deterministiske feature; URL'en forbedrer kun copy, hvis den findes.
const improviseClient = IMPROVISE_ENABLED ? new ImproviseClient() : null;
if (IMPROVISE_ENABLED) {
  document.documentElement.dataset.improviseEnabled = "true";
}

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
    <span class="mark" aria-hidden="true"></span>
    <h1>The Ascent of Karl</h1>
    <span id="act-label"></span>
    <span id="age"></span>
    <div class="header-actions">
      <button id="book-btn" class="icon-btn" aria-label="Open the chronicle archive">${icons.book}<span id="book-badge"></span></button>
      <button id="trophies" class="icon-btn" aria-label="Fates discovered">${icons.titleTrophy}</button>
      <button id="restart" class="icon-btn" aria-label="Start over">${icons.restart}</button>
    </div>
  </header>

  <section id="story-book" aria-label="Karl's living chronicle">
    <div class="story-cover">
      <article id="bubble" class="story-page story-page-narrator">
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button id="mute" class="icon-btn" aria-pressed="false" aria-label="Mute the narrator">${icons.soundOn}</button>
      </div>
        <p id="narrator-text" aria-live="polite"></p>
      </article>
      <div class="story-gutter" aria-hidden="true"></div>
      <article id="story-outcome" class="story-page story-page-outcome" aria-live="polite"></article>
      <div class="story-turn-leaf" aria-hidden="true"></div>
    </div>
  </section>

  <section id="challenge" hidden aria-live="assertive"></section>
  <section id="problems" aria-label="Karl's problems"></section>

  <div id="tools">
    <input id="search" type="search" placeholder="Search elements…" aria-label="Search elements" autocomplete="off">
    <button id="filter-new" class="chip-btn" aria-pressed="false">New finds</button>
    <button id="filter-done" class="chip-btn" aria-pressed="false"
            aria-label="Hide finished elements that lead nowhere further">Hide finished</button>
  </div>

  <section id="grid" aria-label="Elements"></section>
  <p id="grid-empty" hidden>Nothing matches that. Karl checked twice.</p>

  <div id="dock">
    <div class="slot" id="slot-a"></div>
    <span class="plus">+</span>
    <div class="slot" id="slot-b"></div>
    <button id="combine" disabled>Combine</button>
  </div>
  ${IMPROVISE_ENABLED ? '<div id="improvise-status-host"></div>' : ""}

  <aside id="book-panel" aria-label="Chronicle archive">
    <button id="book-close" class="icon-btn" aria-label="Close the chronicle archive">${icons.close}</button>
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
  actLabel: document.getElementById("act-label")!,
  problems: document.getElementById("problems")!,
  challenge: document.getElementById("challenge")!,
  narratorText: document.getElementById("narrator-text")!,
  bubble: document.getElementById("bubble")!,
  muteBtn: document.getElementById("mute") as HTMLButtonElement,
  search: document.getElementById("search") as HTMLInputElement,
  filterNew: document.getElementById("filter-new") as HTMLButtonElement,
  filterDone: document.getElementById("filter-done") as HTMLButtonElement,
  grid: document.getElementById("grid")!,
  gridEmpty: document.getElementById("grid-empty")!,
  slotA: document.getElementById("slot-a")!,
  slotB: document.getElementById("slot-b")!,
  combineBtn: document.getElementById("combine") as HTMLButtonElement,
  improviseStatus: document.getElementById("improvise-status-host"),
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

const book = new BookView(
  engine,
  document.getElementById("book")!,
  IMPROVISE_ENABLED,
);

/**
 * Bogens højre side. Frysning og reduceret bevægelse behandles ens: siden
 * skiftes med det samme, så en optagelse af samme tilstand aldrig fanger et
 * halvvendt blad.
 */
const storyBook = new StoryBook(
  document.getElementById("story-book")!,
  document.getElementById("story-outcome")!,
  () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    isFrozen(),
);
storyBook.render(openingStoryPage());

let selected: [string | null, string | null] = [null, null];
let typewriterTimer: ReturnType<typeof setInterval> | undefined;
let muted = localStorage.getItem(MUTE_KEY) === "1";
let lastLineText = "";
let lastAttemptAt: number | null = null;
let runStartedAt = performance.now();
let query = "";
let onlyNew = false;
/**
 * Skjul de ting, der ikke indgår i nogen opskrift.
 *
 * De er ikke fejl — de er enden på en vej, og et af spillets bedste øjeblikke.
 * Men de bliver liggende i hånden, og spilleren vælger to ting ad gangen, så
 * hver færdig ting gør alle senere valg ringere. Med dem lagt til side falder
 * søgerummet fra 17.205 par til 3.403, og andelen af par der giver noget
 * stiger fra 1,3 % til 6,8 %. Det er spillerens valg, ikke vores: knappen er
 * slået fra som udgangspunkt.
 */
let hideDone = false;
/** Opdaget i denne session — får en okker prik, så de er til at finde i et stort grid */
const freshFinds = new Set<string>();
/** Status der skal overleve, når slots ryddes efter selve forsøget. */
let settledImproviseStatus: { text: string; cls: string } | null = null;
/** Et prefetch observeres kun én gang, selv om renderSlots() kaldes igen. */
const observedCopyGenerations = new Set<number>();
const copyGenerations = new CopyGenerationGuard();
/** Forsøg der brugte fallback, mens copy stadig var i luften. */
const pendingCopySummers = new Map<string, number[]>();

// --- Fortæller ---
/**
 * Fortælleren taler i takter. En opdagelse kan give to: hvad der skete, og
 * hvad historien vil herfra. De køes, så anden takt først skrives ud når
 * første er færdig — ellers ville trækket overskrive sin egen optakt.
 */
let lineQueue: SpokenLine[] = [];
let queueTimer: ReturnType<typeof setTimeout> | undefined;
let queueScheduled = false;
let beatGeneration = 0;
let currentBeatDone: Promise<void> = Promise.resolve();
/** Pause mellem to takter, så det læses som et åndedrag og ikke som én tekst */
const BEAT_PAUSE_MS = 900;
// Tipkortet skal kunne læses færdigt af en langsom læser, før det bladrer.
const TIP_ROTATE_MS = 7000;

function say(line: SpokenLine): void {
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = undefined;
  queueScheduled = false;
  beatGeneration++;
  lineQueue = [];
  currentBeatDone = presentLine(line);
}

/** Læg en efterfølgende takt i kø bag den, der spiller nu. */
function sayAfter(line: SpokenLine | undefined): void {
  if (!line) return;
  lineQueue.push(line);
  scheduleNextBeat();
}

function scheduleNextBeat(): void {
  if (queueScheduled || lineQueue.length === 0) return;
  queueScheduled = true;
  const generation = beatGeneration;
  void currentBeatDone.then(() => {
    if (generation !== beatGeneration) return;
    queueTimer = setTimeout(() => {
      queueTimer = undefined;
      if (generation !== beatGeneration) return;
      queueScheduled = false;
      const next = lineQueue.shift();
      if (!next) return;
      beatGeneration++;
      currentBeatDone = presentLine(next);
      scheduleNextBeat();
    }, BEAT_PAUSE_MS);
  });
}

/** Skrivehastighed for skrivemaskine-effekten (ms pr. tegn) */
const TYPE_MS = 18;
/** Tegn der mangler at blive skrevet ud — driver pausen mellem to takter */
let typewriterLeft = 0;
let resolveTypewriter: (() => void) | undefined;

function typewriterMsLeft(): number {
  return typewriterLeft * TYPE_MS;
}

function finishTypewriter(): void {
  if (typewriterTimer) clearInterval(typewriterTimer);
  typewriterTimer = undefined;
  typewriterLeft = 0;
  const resolve = resolveTypewriter;
  resolveTypewriter = undefined;
  resolve?.();
}

function speak(text: string): Promise<void> {
  finishTypewriter();
  lastLineText = text;
  if (muted) return Promise.resolve();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Frysning behandles som reduceret bevægelse: linjen står færdig med det
  // samme. En halvskrevet replik ("…who has spen") er den mest åbenlyse måde
  // to optagelser af samme tilstand kan blive forskellige på.
  if (reducedMotion || isFrozen()) {
    typewriterLeft = 0;
    el.narratorText.textContent = text;
    return Promise.resolve();
  }
  el.narratorText.textContent = "";
  let i = 0;
  typewriterLeft = text.length;
  return new Promise<void>((resolve) => {
    resolveTypewriter = resolve;
    typewriterTimer = setInterval(() => {
      i++;
      typewriterLeft = text.length - i;
      el.narratorText.textContent = text.slice(0, i);
      if (i >= text.length) finishTypewriter();
    }, TYPE_MS);
  });
}

function presentLine(line: SpokenLine): Promise<void> {
  const playback = playLine(line, muted);
  const textDone = speak(line.text);
  window.dispatchEvent(
    new CustomEvent("narration:beat-start", {
      detail: {
        id: line.id,
        variant: line.variant,
        text: line.text,
        audioMode: playback.mode,
      },
    }),
  );
  return Promise.all([playback.done, textDone]).then(() => {
    window.dispatchEvent(
      new CustomEvent("narration:beat-complete", {
        detail: {
          id: line.id,
          variant: line.variant,
          text: line.text,
          audioMode: playback.mode,
        },
      }),
    );
  });
}

function renderMute(): void {
  el.muteBtn.innerHTML = muted ? icons.soundOff : icons.soundOn;
  el.muteBtn.setAttribute("aria-label", muted ? "Unmute the narrator" : "Mute the narrator");
  el.muteBtn.setAttribute("aria-pressed", String(muted));
  el.bubble.classList.toggle("muted", muted);
  if (muted) {
    stopAudio();
    finishTypewriter();
    el.narratorText.textContent = "…";
  } else if (lastLineText) {
    void speak(lastLineText);
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
  // Bægeret er et billede skåret ud af referencen, ikke en emoji: ⏳ tegnes
  // forskelligt på hver platform og lå 12 px for bredt. Se #age::before i CSS.
  el.age.textContent = `${Math.min(spent + 1, content.config.turnLimit)}/${content.config.turnLimit}`;
  el.age.setAttribute(
    "aria-label",
    `Summer ${Math.min(spent + 1, content.config.turnLimit)} of ${content.config.turnLimit} — every attempt costs one`,
  );
  el.age.classList.toggle("age-late", engine.remainingTurns() <= 10);
}

function renderActLabel(): void {
  const act = engine.currentAct();
  // Aktens NAVN er det første der må vige: på 390 px skubbede "· The Stone
  // Age" hele header-action-rækken ud af ruden. Nummeret bærer betydningen,
  // navnet er smykket — så navnet får sit eget element, som CSS kan skjule.
  el.actLabel.innerHTML =
    `Act ${act.act}<span class="act-name"> · ${escapeHTML(act.name)}</span>`;
}

function renderProblems(): void {
  const problem = narrator.currentPull();
  if (!problem) {
    el.problems.replaceChildren();
    el.problems.hidden = true;
    return;
  }
  el.problems.hidden = false;
  const mark = problem.icon ?? "○";
  const tint = problem.tint ? ` tint-${problem.tint}` : "";
  el.problems.innerHTML = `
    <span class="problem wanted${tint}" data-problem="${problem.id}"
          aria-label="${problem.name}. ${problem.description}">
      ${problemGlyphHTML(problem.id, mark, "problem-icon")}
      <span>${problem.name}</span>
    </span>`;
}

/**
 * Det tomme felts tekst. Referencen skriver en invitation i to linjer i
 * stedet for et spørgsmålstegn — "?" fortæller hverken hvad feltet vil have
 * eller hvordan man giver det. Ligger her frem for i index.html, fordi
 * renderSlots() skriver over markup'en ved første kald alligevel.
 */
const EMPTY_SLOT =
  '<span class="slot-empty">' +
  '<b>Select an element</b>' +
  '<i>Choose from below</i>' +
  "</span>";

function copyKey(a: string, b: string, act: number): string {
  return `${[a, b].sort().join("+")}:act:${act}`;
}

function renderImproviseState(state: ImproviseCopyState): void {
  if (!el.improviseStatus) return;
  el.improviseStatus.innerHTML = renderCopyStatus(state);
}

function renderSettledImproviseStatus(): void {
  if (!el.improviseStatus) return;
  if (!settledImproviseStatus) {
    el.improviseStatus.innerHTML = renderCopyStatus({ status: "idle" });
    return;
  }
  const status = document.createElement("p");
  status.className = `improvise-status ${settledImproviseStatus.cls}`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = settledImproviseStatus.text;
  el.improviseStatus.replaceChildren(status);
}

function settleImproviseStatus(text: string, cls: string): void {
  settledImproviseStatus = { text, cls };
  renderSettledImproviseStatus();
}

function applyLateCopy(
  a: string,
  b: string,
  state: Extract<ImproviseCopyState, { status: "ready" }>,
): void {
  const id = improvisedElementId(a, b);
  const enhanced = engine.enhanceImprovisedCopy(id, state.copy);
  if (!enhanced) return;
  save();
  renderGrid();
  renderBookBadge();
  book.render(enhanced.id);
  if (selected.includes(enhanced.id)) renderSlots();
  if (!el.card.hidden && el.card.dataset.elementId === enhanced.id) {
    const title = el.card.querySelector("h2");
    const flavor = el.card.querySelector(".card-flavor");
    if (title) title.textContent = enhanced.name;
    if (flavor) flavor.textContent = enhanced.flavor ?? "";
    el.card.setAttribute("aria-label", `Karl invented: ${enhanced.name}`);
  }
}

function prefetchImprovisedCopy(a: string, b: string): void {
  if (!IMPROVISE_ENABLED || !improviseClient) return;
  const act = engine.currentAct().act;
  const key = copyKey(a, b, act);
  const generation = copyGenerations.begin(key);
  if (engine.matchCombo(a, b)) {
    renderImproviseState({ status: "idle" });
    return;
  }
  if (!shouldPrefetchImprovisedCopy(engine, a, b)) {
    renderImproviseState({ status: "idle" });
    return;
  }
  const first = engine.element(a);
  const second = engine.element(b);
  const judgment = judgePair(engine, first, second);
  if (judgment.verdict !== "plausible" && judgment.verdict !== "absurd") {
    renderImproviseState({ status: "idle" });
    return;
  }
  if (first.origin === "improvised" || second.origin === "improvised") {
    renderImproviseState({
      status: "fallback",
      reason: "noncanonical",
      timeout: false,
    });
    return;
  }

  const request = { a, b, act };
  const pending = improviseClient.prefetch(request);
  renderImproviseState(improviseClient.state(a, b, act));
  if (observedCopyGenerations.has(generation)) return;
  observedCopyGenerations.add(generation);
  void settleCurrentCopy(
    pending,
    copyGenerations,
    generation,
    key,
    (state) => {
      if (state.status === "ready") applyLateCopy(a, b, state);
      if (
        (state.status === "ready" || state.status === "fallback") &&
        state.latencyMs !== undefined
      ) {
        for (const summer of pendingCopySummers.get(key) ?? []) {
          improvisationPlaytest?.network(a, b, act, summer, {
            latencyMs: state.latencyMs,
            timeout: state.status === "fallback" && state.timeout,
          });
        }
        pendingCopySummers.delete(key);
      }
      const [selectedA, selectedB] = selected;
      if (
        selectedA &&
        selectedB &&
        copyKey(selectedA, selectedB, engine.currentAct().act) === key
      ) {
        renderImproviseState(state);
      }
    },
  ).then((applied) => {
    if (!applied) pendingCopySummers.delete(key);
  });
}

function renderSlots(): void {
  const [a, b] = selected;
  // innerHTML frem for textContent: brikken kan være et maleri, ikke et tegn.
  // Navnene kommer fra content/elements.json, ikke fra spilleren.
  el.slotA.innerHTML = a ? renderSlotContent(engine.element(a)) : EMPTY_SLOT;
  el.slotB.innerHTML = b ? renderSlotContent(engine.element(b)) : EMPTY_SLOT;
  el.slotA.classList.toggle("filled", !!a);
  el.slotB.classList.toggle("filled", !!b);
  for (const [slot, id] of [[el.slotA, a], [el.slotB, b]] as const) {
    if (id) {
      slot.setAttribute("role", "button");
      slot.setAttribute("tabindex", "0");
      slot.setAttribute(
        "aria-label",
        `Remove ${engine.element(id).name} from the combination`,
      );
    } else {
      slot.removeAttribute("role");
      slot.removeAttribute("tabindex");
      slot.removeAttribute("aria-label");
    }
  }
  el.combineBtn.disabled = !(a && b);
  if (a && b) {
    prefetchLine(a, b);
    prefetchImprovisedCopy(a, b);
  } else if (!a && !b) {
    renderSettledImproviseStatus();
  } else {
    renderImproviseState({ status: "idle" });
  }
  renderSelection();
}

/**
 * Bed om en replik til parret NU, mens spillerens hånd stadig er på vej mod
 * knappen. Det er hele grunden til at hooket sidder i renderSlots(): her er
 * parret kendt, og der går typisk et sekund eller mere, før det bliver brugt.
 *
 * Dommen regnes ud på forhånd med motorens egen judgePair(). Den er ren og
 * ser samme tilstand som ved trykket, så den kan ikke afvige — og skulle den
 * mod forventning gøre det, rammer opslaget bare forbi, og grammatikken
 * taler. Ingen af delene kan gå ud over spilleren.
 */
function prefetchLine(a: string, b: string): void {
  if (!live.enabled) return;
  const ea = engine.element(a);
  const eb = engine.element(b);
  // Findes parret som opskrift, er der ikke noget at undskylde.
  if (engine.matchCombo(a, b)) return;
  const { verdict } = judgePair(engine, ea, eb);
  const problems = engine
    .currentActProblems()
    .filter((p) => !engine.isSolved(p.id));
  void live.prefetch({
    a: ea,
    b: eb,
    verdict,
    needId: problems[0]?.id,
    summer: engine.getState().attempts,
  });
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
    // En nyfunden ting bliver stående, selv hvis den er færdig — ellers ville
    // belønningen forsvinde i samme sekund den blev givet.
    if (hideDone && d.terminal && !freshFinds.has(d.id)) return false;
    return !q || d.name.toLowerCase().includes(q);
  });

  el.grid.innerHTML = "";
  for (const def of visible) {
    const btn = document.createElement("button");
    btn.className = `element ${elementOriginClass(def, IMPROVISE_ENABLED)} ${
      freshFinds.has(def.id) ? "is-new" : ""
    } ${def.terminal ? "is-done" : ""}`;
    btn.dataset.id = def.id;
    if (def.terminal) {
      btn.setAttribute(
        "aria-label",
        `${def.name}. Finished; nothing combines with it.`,
      );
    }
    btn.innerHTML = renderElementTileContent(def, IMPROVISE_ENABLED);
    attachSelect(btn, def);
    el.grid.appendChild(btn);
  }
  el.gridEmpty.hidden = visible.length > 0;
  renderSelection();
}

function renderBookBadge(): void {
  const count = activeScenario()?.blankChronicle
    ? 0
    : engine.availableElements().filter((e) => !e.base).length;
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

el.filterDone.addEventListener("click", () => {
  hideDone = !hideDone;
  el.filterDone.setAttribute("aria-pressed", String(hideDone));
  el.filterDone.classList.toggle("active", hideDone);
  renderGrid();
});

// --- Chronicle archive: overlay på alle viewports ---
function openBook(): void {
  el.bookPanel.classList.add("open");
  document.body.classList.add("book-open");
  book.render();
  openOverlay(el.bookPanel, {
    label: "Chronicle archive",
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
        <div class="card-emoji">${glyphHTML(d.id, d.emoji, "card-glyph")}</div>
      </div>
      <h2>${d.name}</h2>
      <p class="card-flavor">${d.flavor ?? ""}</p>
      ${d.note ? `<p class="note">📜 ${d.note}</p>` : ""}
      ${outcome.solved ? `<p class="solved-badge">✓ Problem solved: ${outcome.solved.name}</p>` : ""}
      <button id="card-close">Nice</button>
    </div>`;
  el.card.dataset.elementId = d.id;
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
  const inventionSummary = summarizeInventions(state.improvisedElements);
  document.body.classList.add("run-over");
  closeBook();
  el.ending.innerHTML = `
    <div class="ending-inner tone-${ending.tone}">
      <div class="ending-emoji">${ending.emoji}</div>
      <h2>${ending.title}</h2>
      <p class="ending-line">${lastLineText}</p>
      <p class="ending-stats">${state.attempts} summers lived · ${state.discovered.length} discoveries · ${state.flags.length} quirks</p>
      ${renderInventionSummaryHTML(inventionSummary, IMPROVISE_ENABLED)}
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
    const payload = JSON.stringify(
      IMPROVISE_ENABLED
        ? {
            base: playtest.read(),
            improvisation: improvisationPlaytest?.read() ?? {
              version: 2,
              runs: [],
            },
          }
        : playtest.read(),
    );
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

  const actAtAttempt = engine.currentAct().act;
  const attemptedImprovisation =
    IMPROVISE_ENABLED && !engine.matchCombo(a, b);
  const copyState = attemptedImprovisation
    ? improviseClient?.state(a, b, actAtAttempt)
    : undefined;
  const readyCopy = copyState?.status === "ready"
    ? copyState.copy
    : undefined;
  const outcome = performPlayerAttempt(
    engine,
    a,
    b,
    IMPROVISE_ENABLED,
    readyCopy,
  );
  const line = narrator.react(a, b, outcome, elapsedMs);
  const ending = engine.activeEnding();

  // Ét sideskift pr. afsluttet forsøg — her, ikke i udfaldsgrenene nedenfor.
  // Lå kaldet i grenene, ville "no fuse" og afviste indfald ingen side få, og
  // bogen ville tie præcis når spilleren mest har brug for at se hvad der skete.
  storyBook.present(
    storyPageForOutcome(engine.element(a), engine.element(b), outcome),
  );
  // Beregnes FØR save() nedenfor: followUp() bogfører hvad fortælleren bad
  // om og hvor tit han er blevet trodset. Kørte den efter gemmet, ville en
  // genindlæsning nulstille hans hukommelse om sine egne opfordringer.
  const followUp = ending ? undefined : narrator.followUp(outcome);

  // Blindgyden er det eneste datapunkt der ikke kan rekonstrueres bagefter
  if (outcome.kind === "nofuse") playtest.miss(a, b, engine.getState().attempts);

  if (
    attemptedImprovisation &&
    (outcome.kind === "improvised" ||
      outcome.kind === "improvise-rejected")
  ) {
    const summer = engine.getState().attempts;
    const solvedChallenge =
      outcome.challenge?.kind === "solved"
        ? outcome.challenge.def.id
        : null;
    improvisationPlaytest?.improvisation({
      a,
      b,
      act: actAtAttempt,
      summer,
      outcome:
        outcome.kind === "improvise-rejected"
          ? "rejected"
          : outcome.reused
            ? "reused"
            : "accepted",
      solvedNeed:
        outcome.kind === "improvised" ? outcome.solved?.id ?? null : null,
      solvedChallenge,
      source: readyCopy ? "worker-copy" : "fallback",
      latencyMs:
        copyState?.status === "ready" ||
        copyState?.status === "fallback"
          ? copyState.latencyMs ?? null
          : null,
      timeout:
        copyState?.status === "fallback" ? copyState.timeout : false,
    });
    if (copyState?.status === "loading") {
      const key = copyKey(a, b, actAtAttempt);
      const summers = pendingCopySummers.get(key) ?? [];
      summers.push(summer);
      pendingCopySummers.set(key, summers);
    }
  }

  if (outcome.kind === "discovery") {
    settledImproviseStatus = null;
    freshFinds.add(outcome.element.id);
    // Bogens side ER afsløringen nu. Kortet ville lægge sig oven på den og
    // sige det samme igen, så det er forbeholdt de fund der fortjener et stop.
    if (!ending && (rarity.get(outcome.element.id)?.tier ?? "common") !== "common") {
      showDiscoveryCard(outcome);
    }
    renderGrid();
    renderProblems();
    renderBookBadge();
    book.render(outcome.element.id);
    save();
    if (outcome.ageUp) showAgeUpBanner();
  }
  if (outcome.kind === "improvised") {
    if (!outcome.reused) freshFinds.add(outcome.element.id);
    renderGrid();
    renderProblems();
    renderBookBadge();
    book.render(outcome.element.id);
    save();
    settleImproviseStatus(
      outcome.reused
        ? `Karl has already invented ${outcome.element.name}.`
        : `${outcome.element.name} joined Karl's inventions.`,
      outcome.reused ? "is-ready" : "is-accepted",
    );
  }
  if (outcome.kind === "improvise-rejected") {
    settleImproviseStatus(improvisationRejectionStatus(outcome), "is-rejected");
  }
  if (shouldPersistAttemptState(IMPROVISE_ENABLED, outcome)) save();
  if (line) say(line);
  // Anden takt: fortælleren peger videre — eller bemærker at han lige blev
  // ignoreret. Køes bag historiereplikken, så den ikke overskriver sin optakt.
  sayAfter(followUp);
  renderAge();
  renderActLabel();
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
    improvisationPlaytest?.run({
      ending: ending.id,
      inventions: summarizeInventions(
        engine.getState().improvisedElements,
      ),
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
  settledImproviseStatus = null;
  if (!selected[0]) {
    copyGenerations.abandon();
    selected[0] = def.id;
  }
  else if (!selected[1]) selected[1] = def.id;
  else {
    copyGenerations.abandon();
    selected = [def.id, null];
  }
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
  const clearSlot = () => {
    copyGenerations.abandon();
    selected[index] = null;
    renderSlots();
  };
  slot.addEventListener("click", clearSlot);
  slot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    clearSlot();
  });
}

el.restart.addEventListener("click", () => {
  if (!confirm("Start over completely? Karl forgets everything. He's good at that.")) return;
  clearSave();
  location.reload();
});

// --- Titelskærm: første interaktion låser også lyd op (autoplay-politik) ---

/**
 * Titelskærmens tips. Prikkerne under kortet i referencen lover et kartotek,
 * man kan bladre i — så skal der også være noget at blade i. Ét kort med tre
 * prikker, der ikke gør noget, er en tegning af en funktion.
 */
const TITLE_TIPS = [
  { tile: "fire", title: "Fire: Best invention. Ever.", body: "Some combinations change everything." },
  { tile: "sten", title: "The narrator has opinions.", body: "He will tell you what to do. He is not always right." },
  { tile: "fire", title: "Fifty summers. That is all.", body: "Every attempt costs one, even the stupid ones." },
];

let tipIndex = 0;
let tipTimer: ReturnType<typeof setInterval> | undefined;

function renderTip(): void {
  const host = document.getElementById("t-tip");
  if (!host) return;
  const tip = TITLE_TIPS[tipIndex]!;
  host.innerHTML = `
    <div class="tile tile-${tip.tile}" aria-hidden="true"></div>
    <div class="tip-text">
      <strong>${tip.title}</strong>
      <span>${tip.body}</span>
    </div>
    <div class="tip-dots" role="tablist" aria-label="Tips">
      ${TITLE_TIPS.map((_, i) => `
        <button role="tab" data-tip="${i}" aria-selected="${i === tipIndex}"
                aria-label="Tip ${i + 1} of ${TITLE_TIPS.length}"></button>`).join("")}
    </div>`;
  host.querySelectorAll<HTMLButtonElement>("[data-tip]").forEach((dot) => {
    dot.addEventListener("click", () => {
      tipIndex = Number(dot.dataset.tip);
      // Bladrer man selv, holder karrusellen op med at bladre for én. Ellers
      // hopper kortet væk under fingeren et par sekunder senere.
      if (tipTimer) clearInterval(tipTimer);
      tipTimer = undefined;
      renderTip();
    });
  });
}

/**
 * Mens titelskærmen vises, ligger resten af spillets DOM stadig bagved —
 * kun visuelt dækket af titlens faste, uigennemsigtige lag (#title-screen er
 * `position: fixed; inset: 0`). Uden dette lækker Tab-rækkefølgen og
 * skærmlæserens fokus ind i usynlige spil-knapper (søgefelt, elementkort,
 * dock) FØR titlens egne — TASK-021's krævede rækkefølge (Begin → Fates →
 * trofæ → lyd) kan ikke holde, hvis ti skjulte knapper kommer først.
 * `inert` fjerner baggrunden fra fokus og tilgængelighedstræet uden at røre
 * dens layout eller synlige tilstand.
 *
 * #trophy-modal er undtaget: den er ganske vist en søskende til
 * #title-screen inde i #app, men titlens EGEN Fates-knap åbner den samme
 * modal (renderTrophyModal, se el.trophiesBtn) — CSS'ens z-index løfter den
 * allerede over titlen for netop den sti. Var den også inert, ville modalen
 * ses, men hverken kunne fokuseres, læses op eller lukkes med musen: synlig,
 * men en blindgyde. Så længe den er #trophy-modal[hidden], fjerner det alene
 * den fra fokus og tilgængelighedstræet — undtagelsen har derfor ingen
 * virkning før den rent faktisk vises.
 */
function setBackgroundInert(inert: boolean): void {
  for (const child of Array.from(app.children)) {
    if (child.id === "title-screen" || child.id === "trophy-modal") continue;
    child.toggleAttribute("inert", inert);
  }
}

function showTitleScreen(): void {
  const canContinue = hasSave();
  const unlocked = Object.keys(loadAchievements()).length;
  const crowded = canContinue ? " crowded" : "";
  el.titleScreen.innerHTML = `
    <div class="title-stage">
      <div class="title-panel">
        <h1 class="title-mark title-block">
          <span class="title-mark-semantic">The Ascent of Karl</span>
          <picture class="title-wordmark" aria-hidden="true">
            <source media="(max-width: 900px)"
                    srcset="${TITLE_WORDMARKS.mobile.src}"
                    width="${TITLE_WORDMARKS.mobile.width}"
                    height="${TITLE_WORDMARKS.mobile.height}">
            <img class="title-wordmark-art"
                 data-title-layer="wordmark"
                 src="${TITLE_WORDMARKS.desktop.src}"
                 width="${TITLE_WORDMARKS.desktop.width}"
                 height="${TITLE_WORDMARKS.desktop.height}"
                 sizes="(max-width: 900px) min(61vw, 218px), min(34.36vw, 545px)"
                 alt="" aria-hidden="true"
                 loading="eager" fetchpriority="high">
          </picture>
        </h1>
        <p class="title-sub title-block">reinvent history, badly</p>
        <p class="title-tagline title-block">
          A stone-age man. A sarcastic narrator.<br>
          Fifty summers to make history — or a mess.
        </p>
        <div class="title-divider title-block" aria-hidden="true"></div>
        <div class="title-actions title-block${crowded}">
          <button id="t-primary" class="title-action btn-stone">
            <span class="title-action-icon" aria-hidden="true">${icons.titleSpiral}</span>
            <span class="title-action-label">${canContinue ? "Continue" : "Begin"}</span>
          </button>
          ${canContinue ? `<button id="t-new" class="title-action btn-quiet">
            <span class="title-action-icon" aria-hidden="true">${icons.restart}</span>
            <span class="title-action-label">New life</span>
          </button>` : ""}
          <button id="t-fates" class="title-action btn-quiet">
            <span class="title-action-icon" aria-hidden="true">${icons.titleTrophy}</span>
            <span class="title-action-label">Fates</span>
            <span class="title-action-count fates-count">${unlocked}/${content.endings.length}</span>
          </button>
        </div>
        <p class="title-hint title-block">
          <span class="orn-tap" aria-hidden="true"></span>Tap one element, then a second — that is a combination.
        </p>
        <div id="t-tip" class="title-tip title-block"></div>
      </div>
      ${canContinue ? "" : `
      <div class="title-chip">
        <span class="figure" aria-hidden="true">${icons.titleCave}</span>
        <div>
          <strong>Welcome, inventor.</strong>
          <span>Ready to make history?</span>
        </div>
      </div>`}
      <div class="title-tools">
        <button id="t-trophies" aria-label="Fates you have reached">${icons.titleTrophy}</button>
        <button id="t-sound" aria-pressed="${muted}"
                aria-label="${muted ? "Unmute the narrator" : "Mute the narrator"}">${muted ? icons.soundOff : icons.soundOn}</button>
      </div>
    </div>`;
  el.titleScreen.hidden = false;
  setBackgroundInert(true);

  renderTip();
  if (tipTimer) clearInterval(tipTimer);
  // Under frysning står kortet stille. En karrusel der bladrer, gør enhver
  // optagelse til et lodtrækningsresultat.
  if (!isFrozen()) {
    tipTimer = setInterval(() => {
      tipIndex = (tipIndex + 1) % TITLE_TIPS.length;
      renderTip();
    }, TIP_ROTATE_MS);
  }

  document.getElementById("t-primary")!.addEventListener("click", () => {
    if (canContinue) return startGame(true);
    clearSave();
    startGame(false);
  });
  document.getElementById("t-new")?.addEventListener("click", () => {
    clearSave();
    startGame(false);
  });
  document.getElementById("t-fates")!.addEventListener("click", renderTrophyModal);
  document.getElementById("t-trophies")!.addEventListener("click", renderTrophyModal);
  // Tandhjulet i referencen har ingen skærm at pege på: spillet har én
  // indstilling, og det er lyden. Så er det den, knappen er.
  document.getElementById("t-sound")!.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    renderMute();
    showTitleScreen();
  });
}

function startGame(resume: boolean): void {
  const resumed = resume && tryLoad();
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = undefined;
  el.titleScreen.hidden = true;
  setBackgroundInert(false);
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
  renderActLabel();
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
applyScenario();

/**
 * Sætter spillet i den tilstand en reference viser, og melder klar.
 *
 * Tilstanden sættes DIREKTE frem for at klikke sig frem: en klikvej er både
 * langsom og skrøbelig, og fejler den, får man en tavs forkert måling i
 * stedet for en fejl. Se plan/architecture-visual-judge-1.md fase 1.
 */
function applyScenario(): void {
  const spec = activeScenario();
  if (spec) {
    if (spec.discovered) {
      engine.loadState({
        ...engine.getState(),
        discovered: [...spec.discovered],
      });
    }
    if (spec.tipIndex !== undefined) {
      tipIndex = spec.tipIndex;
      renderTip();
    }
    if (spec.start) {
      el.titleScreen.hidden = true;
      setBackgroundInert(false);
      runStartedAt = performance.now();
      renderAll();
    }
    for (const selector of spec.hiddenSelectors ?? []) {
      document.querySelector(selector)?.remove();
    }
    if (spec.narratorText) {
      lastLineText = spec.narratorText;
      el.narratorText.textContent = spec.narratorText;
    }
  }
  // Flaget sættes altid, også uden scenarie: harnessen skal kunne optage
  // spillet som det er, uden at kende til scenarier. De bagte replikker
  // ventes ind først, så to optagelser af samme scenarie hører det samme —
  // ellers ville tidspunktet for en netværkshentning kunne ændre teksten.
  void pairsReady.then(() => markReadyWhenPainted());
}
