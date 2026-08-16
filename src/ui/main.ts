import { Engine } from "../core/engine";
import { improvisedElementId } from "../core/improvise";
import { judgePair } from "../core/verdict";
import {
  deserialize,
  migrateLegacyProfile,
  serialize,
} from "../core/save";
import { Narrator, freshNarratorState } from "../narrator/narrator";
import { LiveNarrator } from "../narrator/live";
import { loadPairs } from "../narrator/pairs";
import type { NarratorState, SpokenLine } from "../narrator/narrator";
import { loadContent } from "../content";
import type { CombineOutcome, ElementDef } from "../core/types";
import type { GameState } from "../core/engine";
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
import { deriveLifePlan, randomSeed } from "../core/seed";
import { createBrowserProductEventBus } from "../product/events";
import { SessionClient } from "./session-client";
import { RunRevisionConflict } from "./session-client";
import type { RunCredentials } from "../product/session";
import {
  applyArchivedLife,
  archiveLife,
  createActiveLife,
  freshProfile,
  type ProfileV2,
} from "../core/life";
import {
  applyLiveProgress,
  completionStatus,
} from "../core/compendium";
import { chronicleEntriesForArchive } from "../core/chronicle";
import {
  migrateArchivedLifeToCurrentContent,
  migrateProfileToCurrentContent,
} from "../core/content-migrations";
import {
  selectReplayTargets,
  type ReplayTarget,
} from "../core/replay";
import {
  InMemoryProfileStore,
  type ProfileStore,
} from "../persistence/profile-store";
import { IndexedDbProfileStore } from "../persistence/indexeddb-profile-store";
import { SerialWriteQueue } from "../persistence/write-queue";
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
import { mount } from "svelte";
import App from "./App.svelte";

// Nøglerne beholder deres oprindelige "kolde-karl"-navn selv om spillet er
// omdøbt til The Ascent of Karl: de står i spillernes browsere, og en omdøbning
// ville smide alle gemte spil og skæbner væk for at rette et navn ingen ser.
const SAVE_KEY = "kolde-karl-save-v1";
const NARRATOR_SAVE_KEY = "kolde-karl-narrator-v1";
const MUTE_KEY = "kolde-karl-muted";
const ACHIEVEMENTS_KEY = "kolde-karl-achievements";
const REPLAY_TARGET_KEY = "karl-replay-target-v1";
const RUN_CREDENTIALS_KEY = "karl-run-capability-v1";
let profileStore: ProfileStore = new InMemoryProfileStore();
const profileWrites = new SerialWriteQueue();
let profile: ProfileV2 = freshProfile();
let persistenceError: string | null = null;
let profileMigrationError: string | null = null;
let runCredentials: RunCredentials | null = readRunCredentials();
let runRevision = 0;

function readRunCredentials(): RunCredentials | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RUN_CREDENTIALS_KEY) ?? "null",
    ) as Partial<RunCredentials> | null;
    if (
      !parsed ||
      typeof parsed.runId !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.csrf !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed as RunCredentials;
  } catch {
    return null;
  }
}

function storeRunCredentials(credentials: RunCredentials | null): void {
  runCredentials = credentials;
  if (credentials) {
    localStorage.setItem(RUN_CREDENTIALS_KEY, JSON.stringify(credentials));
  } else {
    localStorage.removeItem(RUN_CREDENTIALS_KEY);
  }
}

// Et scenarie må ikke arve browserens historik: en maskine med et halvspillet
// run ville måle noget helt andet end en ren. Ryddes FØR engine bygges.
resetStorageForScenario([SAVE_KEY, NARRATOR_SAVE_KEY, ACHIEVEMENTS_KEY]);

const content = loadContent();
const initialSeed = bootSeed();
const engine = new Engine(content, undefined, {
  lifePlan: deriveLifePlan(
    content.lifeVariation!,
    content.completionManifest!.contentRevision,
    initialSeed,
  ),
});
const productEvents = createBrowserProductEventBus();
const sessionClient = new SessionClient({
  baseUrl: import.meta.env.VITE_GAME_API_URL ?? "",
  onlineRequired: import.meta.env.VITE_ONLINE_REQUIRED === "true",
  credentialsUpdated: storeRunCredentials,
});
let activePlayBlocked = sessionClient.onlineRequired;
if (
  sessionClient.onlineRequired &&
  import.meta.env.VITE_ONLINE_TARGET_READY !== "true"
) {
  throw new Error(
    "VITE_ONLINE_REQUIRED requires VITE_ONLINE_TARGET_READY=true after external production gates pass",
  );
}
const GENERATED_GAMEPLAY_ENABLED =
  IMPROVISE_ENABLED || sessionClient.onlineRequired;
const playtest = new PlaytestLog();
const improvisationPlaytest = GENERATED_GAMEPLAY_ENABLED
  ? new ImprovisationPlaytestLog()
  : null;
// Nyt seed pr. playthrough → nye variantvalg hver gang (docs/design/fortaelleren.md)
const narrator = new Narrator(engine, freshNarratorState(initialSeed));

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
if (GENERATED_GAMEPLAY_ENABLED) {
  document.documentElement.dataset.improviseEnabled = "true";
}

// --- Save/load (autosave pr. opdagelse, PRD §4.1) ---
function save(): void {
  localStorage.setItem(SAVE_KEY, serialize(engine.getState(), new Date().toISOString()));
  localStorage.setItem(NARRATOR_SAVE_KEY, JSON.stringify(narrator.getState()));
  void persistActiveLife();
}

function hasSave(): boolean {
  return (
    (sessionClient.onlineRequired && runCredentials !== null) ||
    profile.activeLife !== null ||
    localStorage.getItem(SAVE_KEY) !== null
  );
}

function tryLoad(): boolean {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      engine.loadState(deserialize(raw));
      const nRaw = localStorage.getItem(NARRATOR_SAVE_KEY);
      narrator.loadState(
        nRaw ? (JSON.parse(nRaw) as NarratorState) : freshNarratorState(),
      );
      return true;
    } catch {
      // A valid ProfileV2 active life may still exist.
    }
  }
  if (profile.activeLife) {
    engine.loadState(profile.activeLife.engine);
    narrator.loadState(profile.activeLife.narrator);
    return true;
  }
  return false;
}

async function clearSave(): Promise<boolean> {
  if (activePlayBlocked || profileMigrationError) return false;
  if (profile.activeLife) {
    const archived = await archiveCurrentLife({ kind: "abandoned" });
    if (!archived) return false;
  }
  if (runCredentials) {
    await sessionClient.deleteRun(runCredentials).catch(() => undefined);
  }
  storeRunCredentials(null);
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(NARRATOR_SAVE_KEY);
  return true;
}

async function initializeProfile(): Promise<void> {
  try {
    profileStore = await IndexedDbProfileStore.open();
  } catch {
    profileStore = new InMemoryProfileStore();
  }
  const stored = await profileStore.loadProfile();
  if (stored) {
    const storedArchives = await profileStore.listArchives();
    try {
      const migratedProfile = migrateProfileToCurrentContent(
        content,
        stored,
      );
      const migratedArchives = storedArchives.map((archive) =>
        migrateArchivedLifeToCurrentContent(content, archive),
      );
      if (
        JSON.stringify(migratedProfile) !== JSON.stringify(stored) ||
        JSON.stringify(migratedArchives) !== JSON.stringify(storedArchives)
      ) {
        await profileWrites.run(() =>
          profileStore.replaceAll(migratedProfile, migratedArchives),
        );
      }
      profile = migratedProfile;
      profileMigrationError = null;
      if (migratedProfile.activeLife) {
        productEvents.startLifeJournal(migratedProfile.activeLife.events);
        engine.loadState(migratedProfile.activeLife.engine);
        narrator.loadState(migratedProfile.activeLife.narrator);
      } else {
        productEvents.endLifeJournal();
      }
    } catch (error) {
      profile = stored;
      productEvents.endLifeJournal();
      profileMigrationError =
        error instanceof Error ? error.message : String(error);
      showPersistenceError(
        "This save uses unsupported content. It remains untouched and read-only.",
      );
      setActivePlayBlocked(true);
    }
    await renderProfileMeta();
    return;
  }

  const legacySave = localStorage.getItem(SAVE_KEY);
  if (!legacySave) {
    profile = freshProfile();
    productEvents.endLifeJournal();
    const snapshot = structuredClone(profile);
    await profileWrites.run(() => profileStore.saveProfile(snapshot));
    await renderProfileMeta();
    return;
  }
  let startedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(legacySave) as { savedAt?: string };
    if (typeof parsed.savedAt === "string") startedAt = parsed.savedAt;
  } catch {
    // migrateLegacyProfile reports the real malformed-save error below.
  }
  try {
    const migrated = migrateLegacyProfile({
      saveJson: legacySave,
      narrator: (() => {
        try {
          return JSON.parse(
            localStorage.getItem(NARRATOR_SAVE_KEY) ?? "null",
          ) ?? freshNarratorState();
        } catch {
          return freshNarratorState();
        }
      })(),
      achievements: loadAchievements(),
      content,
      lifeId: crypto.randomUUID(),
      startedAt,
      migratedAt: new Date().toISOString(),
    });
    if (migrated.archives.length > 0) {
      for (const archive of migrated.archives) {
        await profileStore.finalizeLife(migrated.profile, archive);
      }
    } else {
      await profileStore.saveProfile(migrated.profile);
    }
    profile = migrated.profile;
    if (profile.activeLife) {
      productEvents.startLifeJournal(profile.activeLife.events);
      engine.loadState(profile.activeLife.engine);
      narrator.loadState(profile.activeLife.narrator);
    } else {
      productEvents.endLifeJournal();
    }
  } catch {
    // Keep the source V1 save untouched. A transient storage failure must not
    // let an empty ProfileV2 shadow a recoverable life on the next boot.
    profile = freshProfile();
    showPersistenceError("Could not migrate this life. The original save is still intact.");
  }
  await renderProfileMeta();
}

function beginProfileLife(
  seed = engine.getState().seed,
  target: ReplayTarget | null = null,
): void {
  if (activePlayBlocked || profileMigrationError) return;
  const active = createActiveLife({
    content,
    lifeId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    seed,
    target,
  });
  productEvents.startLifeJournal();
  profile = { ...profile, activeLife: active };
  engine.loadState(active.engine);
  narrator.loadState(active.narrator);
  const snapshot = structuredClone(profile);
  void profileWrites
    .run(() => profileStore.saveProfile(snapshot))
    .catch(() => {
      showPersistenceError(
        "Could not save the new life. Local recovery remains available.",
      );
    });
}

async function persistActiveLife(): Promise<void> {
  if (!profile.activeLife) return;
  profile = {
    ...profile,
    activeLife: {
      ...profile.activeLife,
      engine: engine.getState(),
      narrator: narrator.getState(),
      events: productEvents.lifeJournal(),
    },
  };
  const snapshot = structuredClone(profile);
  try {
    await profileWrites.run(() => profileStore.saveProfile(snapshot));
  } catch {
    // localStorage V1 remains a synchronous compatibility save.
    showPersistenceError("Could not save the life archive. Local recovery remains available.");
  }
}

async function archiveCurrentLife(
  outcome:
    | { kind: "ending"; endingId: string }
    | { kind: "abandoned" },
): Promise<boolean> {
  const active = profile.activeLife;
  if (!active) return true;
  const current = {
    ...active,
    engine: engine.getState(),
    narrator: narrator.getState(),
    events: productEvents.lifeJournal(),
  };
  const archive = archiveLife(current, outcome, new Date().toISOString());
  const nextProfile = applyArchivedLife(
    { ...profile, activeLife: current },
    content,
    archive,
  );
  try {
    await profileWrites.run(() =>
      profileStore.finalizeLife(nextProfile, archive),
    );
  } catch {
    showPersistenceError(
      "Could not archive this life. Nothing was deleted; retry before starting another.",
    );
    return false;
  }
  profile = nextProfile;
  productEvents.emit({
    type: "life.archived",
    scenario:
      outcome.kind === "ending" ? "ending.unlocked" : "replay.named-target",
    turn: engine.getState().attempts,
    payload: {
      lifeId: archive.lifeId,
      outcome: outcome.kind,
      historyCompleteness: archive.historyCompleteness,
    },
  });
  productEvents.endLifeJournal();
  persistenceError = null;
  renderPersistenceError();
  await renderProfileMeta();
  return true;
}

function showPersistenceError(message: string): void {
  persistenceError = message;
  renderPersistenceError();
}

function renderPersistenceError(): void {
  el.persistenceError.hidden = persistenceError === null;
  el.persistenceErrorText.textContent = persistenceError ?? "";
}

async function renderProfileMeta(): Promise<void> {
  const archives = await profileStore.listArchives();
  el.lifeArchive.dataset.state = archives.length ? "filled" : "empty";
  el.lifeArchiveList.innerHTML = archives.length
    ? archives
        .map(
          (archive) => `<div class="life-archive-row">
            <div>
              <strong>${escapeHTML(archiveTitle(archive.outcome))}</strong>
              <span>${escapeHTML(archive.plan.seedCode)}</span>
            </div>
            <button data-action="archive.open-life" data-life-id="${escapeHTML(
              archive.lifeId,
            )}">Read life</button>
          </div>`,
        )
        .join("")
    : `<p>No archived lives yet. Karl is working on that.</p>`;
  for (const button of el.lifeArchiveList.querySelectorAll<HTMLButtonElement>(
    "[data-life-id]",
  )) {
    button.addEventListener("click", () => {
      void renderArchivedLife(button.dataset.lifeId ?? "");
    });
  }

  function archiveTitle(
    outcome:
      | { kind: "ending"; endingId: string }
      | { kind: "abandoned" },
  ): string {
    if (outcome.kind === "abandoned") return "Abandoned life";
    return (
      content.endings.find((ending) => ending.id === outcome.endingId)?.title ??
      outcome.endingId
    );
  }
  const status = completionStatus(content.completionManifest!, profile.compendium);
  const inventionNames = new Map([
    ...content.elements.map((element) => [element.id, element.name] as const),
    ...profile.compendium.inventions.map(
      (invention) => [invention.id, invention.name] as const,
    ),
  ]);
  el.compendium.dataset.state = status.found ? "filled" : "empty";
  el.compendiumStatus.innerHTML = `<div class="compendium-meter">
    <strong>${status.found}/${status.total} authored entries</strong>
    <progress value="${status.found}" max="${status.total}" aria-label="Authored completion"></progress>
    <span>${(status.basisPoints / 100).toFixed(2)}% complete</span>
  </div>
  <section class="replay-targets" aria-labelledby="replay-targets-title">
    <h3 id="replay-targets-title">Paths still open</h3>
    ${selectReplayTargets(content, profile.compendium)
      .slice(0, 3)
      .map(
        (target, index) =>
          `<button data-replay-target="${index}">${escapeHTML(target.label)}</button>`,
      )
      .join("")}
  </section>
  <section class="compendium-inventions" aria-labelledby="compendium-inventions-title">
    <h3 id="compendium-inventions-title">Invention gallery</h3>
    ${
      profile.compendium.inventions.length
        ? `<ul>${profile.compendium.inventions
            .map(
              (invention) => `<li>
                <strong>${escapeHTML(invention.name)}</strong>
                <span>${escapeHTML(
                  invention.parents
                    .map((id) => inventionNames.get(id) ?? id)
                    .join(" + "),
                )}</span>
              </li>`,
            )
            .join("")}</ul>`
        : "<p>No inventions archived yet.</p>"
    }
  </section>`;
  const targets = selectReplayTargets(content, profile.compendium).slice(0, 3);
  for (const button of el.compendiumStatus.querySelectorAll<HTMLButtonElement>(
    "[data-replay-target]",
  )) {
    button.disabled = activePlayBlocked || profileMigrationError !== null;
    button.addEventListener("click", () => {
      if (activePlayBlocked || profileMigrationError) return;
      const target = targets[Number(button.dataset.replayTarget)];
      if (!target) return;
      const lastOutcome = profile.archives.at(-1)?.outcome;
      sessionStorage.setItem(
        REPLAY_TARGET_KEY,
        JSON.stringify({
          target,
          fromEndingId:
            lastOutcome?.kind === "ending"
              ? lastOutcome.endingId
              : "unknown",
        }),
      );
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(NARRATOR_SAVE_KEY);
      location.reload();
    });
  }
}

async function renderArchivedLife(lifeId: string): Promise<void> {
  const archive = await profileStore.loadArchive(lifeId);
  if (!archive) return;
  const entries = chronicleEntriesForArchive(content, archive);
  el.lifeArchiveList.innerHTML += `<article class="archive-detail">
    <h3>${escapeHTML(archive.plan.seedCode)}</h3>
    <p>${
      archive.finalState.discovered.filter((id) =>
        content.completionManifest!.discoveries.includes(id),
      ).length
    } canonical discoveries · ${
      archive.finalState.completedBranchIds?.length ?? 0
    } major branches</p>
    ${
      entries.length
        ? `<ol class="archive-chronicle">${entries
            .map(
              (entry) => `<li data-entry-kind="${entry.kind}">
                <span>Summer ${entry.turn}</span>
                <p>${escapeHTML(entry.text)}</p>
              </li>`,
            )
            .join("")}</ol>`
        : "<p>No causal event history is available for this legacy life.</p>"
    }
  </article>`;
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
app.dataset.capability = "platform.cross-device";
mount(App, {
  target: app,
  props: {
    icons,
    improvisationEnabled: GENERATED_GAMEPLAY_ENABLED,
  },
});

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
  networkGate: document.getElementById("network-gate")!,
  networkRetry: document.getElementById("network-retry") as HTMLButtonElement,
  networkArchives: document.getElementById(
    "network-archives",
  ) as HTMLButtonElement,
  lifeArchive: document.getElementById("life-archive")!,
  lifeArchiveList: document.getElementById("life-archive-list")!,
  compendium: document.getElementById("compendium")!,
  compendiumStatus: document.getElementById("compendium-status")!,
  persistenceError: document.getElementById("persistence-error")!,
  persistenceErrorText: document.getElementById("persistence-error-text")!,
  persistenceRetry: document.getElementById(
    "persistence-retry",
  ) as HTMLButtonElement,
};

// Sjældenhed udledes én gang af indholdet — den kan ikke ændre sig i et run
const rarity = computeRarity(content);

const book = new BookView(
  engine,
  document.getElementById("book")!,
  GENERATED_GAMEPLAY_ENABLED,
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
  const roles = new Set<"humour" | "guidance" | "story">();
  if (/hint|gate|pull|need/i.test(line.id)) roles.add("guidance");
  if (/intro|story|ageup|ending|challenge|decision/i.test(line.id)) {
    roles.add("story");
  }
  if (roles.size === 0 || /pair|fail|generic|improv/i.test(line.id)) {
    roles.add("humour");
  }
  const narratorScenario = engine.activeEnding()
    ? "ending.unlocked"
    : engine.activeChallenge()
      ? "challenge.active"
      : "need.active";
  productEvents.emit({
    type: "narrator.presented",
    scenario: narratorScenario,
    turn: engine.getState().attempts,
    payload: {
      lineId: line.id,
      variant: line.variant,
      text: line.text,
      roles: [...roles],
      audioMode: playback.mode,
    },
  });
  void persistActiveLife();
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
  const dock = document.getElementById("dock")!;
  dock.dataset.state =
    a && b ? "selected-twice" : a || b ? "selected-once" : "empty";
  for (const [slot, id] of [[el.slotA, a], [el.slotB, b]] as const) {
    if (id) {
      slot.dataset.action = "selection.remove";
      slot.dataset.entityId = id;
      slot.setAttribute("role", "button");
      slot.setAttribute("tabindex", "0");
      slot.setAttribute(
        "aria-label",
        `Remove ${engine.element(id).name} from the combination`,
      );
    } else {
      delete slot.dataset.action;
      delete slot.dataset.entityId;
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
    btn.className = `element ${elementOriginClass(def, GENERATED_GAMEPLAY_ENABLED)} ${
      freshFinds.has(def.id) ? "is-new" : ""
    } ${def.terminal ? "is-done" : ""}`;
    btn.dataset.id = def.id;
    btn.dataset.action = "element.select";
    btn.dataset.entityId = def.id;
    if (def.terminal) {
      btn.setAttribute(
        "aria-label",
        `${def.name}. Finished; nothing combines with it.`,
      );
    }
    btn.innerHTML = renderElementTileContent(def, GENERATED_GAMEPLAY_ENABLED);
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
  void renderProfileMeta();
  openOverlay(el.bookPanel, {
    label: "Chronicle archive",
    onClose: () => {
      el.bookPanel.classList.remove("open");
      document.body.classList.remove("book-open");
      if (activePlayBlocked) {
        queueMicrotask(() => {
          el.networkGate.hidden = false;
          document.body.classList.add("overlay-open");
        });
      }
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
      ${renderInventionSummaryHTML(inventionSummary, GENERATED_GAMEPLAY_ENABLED)}
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
    void clearSave().then((cleared) => {
      if (cleared) location.reload();
    });
  });
  // Playtest-hjælp (ROADMAP prioritet 2): hele loggen, ikke kun dette run.
  // En tester der spiller tre gange skal kunne nøjes med at kopiere én gang.
  document.getElementById("ending-stats")!.addEventListener("click", async (e) => {
    const payload = JSON.stringify(
      GENERATED_GAMEPLAY_ENABLED
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
function outcomeScenario(outcome: CombineOutcome) {
  switch (outcome.kind) {
    case "discovery":
      return "attempt.canonical-discovery" as const;
    case "known":
      return "attempt.known-result" as const;
    case "gated":
      return "progress.age-up-blocked" as const;
    case "nofuse":
      return "attempt.no-fuse" as const;
    case "improvised":
      return "attempt.invention" as const;
    case "improvise-rejected":
      return "attempt.invention-rejected" as const;
  }
}

function emitAttemptProductEvents(
  a: string,
  b: string,
  outcome: CombineOutcome,
  copySource: "fallback" | "worker-copy",
): void {
  const state = engine.getState();
  const scenario = outcomeScenario(outcome);
  const pair = [a, b].sort() as [string, string];
  const resultId =
    outcome.kind === "discovery" ||
    outcome.kind === "known" ||
    outcome.kind === "improvised"
      ? outcome.element.id
      : null;
  productEvents.emit({
    type: "combination.attempted",
    scenario,
    turn: state.attempts,
    payload: {
      pair,
      outcome: outcome.kind,
      resultId,
      verdict:
        outcome.kind === "nofuse" ||
        (outcome.kind === "improvise-rejected" && "verdict" in outcome)
          ? outcome.verdict ?? null
          : null,
      rejectionReason:
        outcome.kind === "improvise-rejected" ? outcome.reason : null,
    },
  });

  if (outcome.kind === "discovery") {
    productEvents.emit({
      type: "discovery.canonical",
      scenario,
      turn: state.attempts,
      payload: {
        pair,
        elementId: outcome.element.id,
        solvedNeedId: outcome.solved?.id ?? null,
        ageUp: outcome.ageUp,
        endingDeflected: outcome.endingDeflected ?? false,
      },
    });
  } else if (outcome.kind === "improvised") {
    productEvents.emit({
      type: "invention.accepted",
      scenario,
      turn: state.attempts,
      payload: {
        pair,
        elementId: outcome.element.id,
        reused: outcome.reused,
        solvedNeedId: outcome.solved?.id ?? null,
        solvedChallengeId:
          outcome.challenge?.kind === "solved"
            ? outcome.challenge.def.id
            : null,
        copySource,
        historicalClaim: false,
      },
    });
  }

  productEvents.emit({
    type: "need.updated",
    scenario: outcome.kind === "gated" ? "progress.age-up-blocked" : "need.active",
    turn: state.attempts,
    payload: {
      cause: outcome.kind === "discovery" && outcome.ageUp ? "age-up" : "attempt",
      activeNeedId: narrator.currentPull()?.id ?? null,
      needs: engine.currentActProblems().map((problem) => ({
        id: problem.id,
        required: problem.required,
        status: engine.isSolved(problem.id) ? "solved" : "active",
      })),
    },
  });

  if (outcome.challenge) {
    productEvents.emit({
      type: "challenge.updated",
      scenario: "challenge.active",
      turn: state.attempts,
      payload: {
        challengeId: outcome.challenge.def.id,
        status: outcome.challenge.kind,
        turnsLeft:
          outcome.challenge.kind === "ticking"
            ? outcome.challenge.turnsLeft
            : null,
        resolvedByElementId:
          outcome.challenge.kind === "solved"
            ? outcome.challenge.by.id
            : null,
      },
    });
  }

  productEvents.emit({
    type: "chronicle.entry-recorded",
    scenario,
    turn: state.attempts,
    payload: {
      entryId: `${state.seed}:${state.attempts}:${outcome.kind}`,
      kind:
        outcome.kind === "discovery"
          ? "canonical-discovery"
          : outcome.kind === "improvised"
            ? "invention"
            : outcome.kind === "known"
              ? "known-result"
              : outcome.kind === "gated"
                ? "blocked-progress"
                : "attempt",
      relatedId: resultId,
      canonical: outcome.kind === "discovery" || outcome.kind === "known",
    },
  });
}

function updateLiveCompendium(outcome: CombineOutcome): void {
  const active = profile.activeLife;
  if (!active) return;
  const before = profile.compendium;
  const beforeKeys = new Set(Object.keys(before.unlocks));
  const next = applyLiveProgress(before, content, engine.getState(), {
    firstLifeId: active.lifeId,
    unlockedAt: new Date().toISOString(),
    viaInvention: outcome.kind === "improvised",
  });
  const addedKeys = Object.keys(next.unlocks).filter(
    (key) => !beforeKeys.has(key),
  );
  const inventionsChanged =
    next.inventions.length !== before.inventions.length;
  if (addedKeys.length === 0 && !inventionsChanged) return;

  profile = { ...profile, compendium: next };
  if (addedKeys.length > 0) {
    const status = completionStatus(content.completionManifest!, next);
    const reason = addedKeys.some((key) => key.startsWith("ending:"))
      ? "fate"
      : addedKeys.some((key) => key.startsWith("branch:"))
        ? "branch"
        : "discovery";
    productEvents.emit({
      type: "compendium.progressed",
      scenario:
        reason === "fate"
          ? "ending.unlocked"
          : outcome.kind === "improvised"
            ? "attempt.invention"
            : "attempt.canonical-discovery",
      turn: engine.getState().attempts,
      payload: {
        reason,
        completed: status.found,
        total: status.total,
      },
    });
  }
  void renderProfileMeta();
}

async function performCombine(a: string, b: string): Promise<void> {
  if (activePlayBlocked) return;
  if (engine.activeEnding()) return;
  const now = performance.now();
  const elapsedMs = lastAttemptAt === null ? undefined : now - lastAttemptAt;
  lastAttemptAt = now;

  const actAtAttempt = engine.currentAct().act;
  const attemptedImprovisation =
    GENERATED_GAMEPLAY_ENABLED && !engine.matchCombo(a, b);
  const copyState = attemptedImprovisation
    ? improviseClient?.state(a, b, actAtAttempt)
    : undefined;
  const readyCopy = copyState?.status === "ready"
    ? copyState.copy
    : undefined;
  let outcome: CombineOutcome;
  if (sessionClient.onlineRequired) {
    if (!runCredentials) {
      showNetworkOutage();
      return;
    }
    el.combineBtn.disabled = true;
    document.getElementById("dock")!.dataset.state = "busy";
    try {
      const remote = await sessionClient.attempt<GameState, CombineOutcome>(
        runCredentials,
        {
          attemptId: crypto.randomUUID(),
          expectedRevision: runRevision,
          pair: [a, b],
        },
      );
      runRevision = remote.revision;
      engine.loadState(remote.snapshot);
      outcome = remote.outcome;
    } catch (error) {
      if (error instanceof RunRevisionConflict) {
        runRevision = error.revision;
        engine.loadState(error.snapshot as GameState);
        renderAll();
      } else {
        showNetworkOutage();
      }
      renderSlots();
      return;
    }
  } else {
    outcome = performPlayerAttempt(
      engine,
      a,
      b,
      IMPROVISE_ENABLED,
      readyCopy,
    );
  }
  const line = narrator.react(a, b, outcome, elapsedMs);
  const ending = engine.activeEnding();
  emitAttemptProductEvents(
    a,
    b,
    outcome,
    readyCopy ? "worker-copy" : "fallback",
  );
  updateLiveCompendium(outcome);

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
  if (shouldPersistAttemptState(GENERATED_GAMEPLAY_ENABLED, outcome)) save();
  if (line) say(line);
  // Anden takt: fortælleren peger videre — eller bemærker at han lige blev
  // ignoreret. Køes bag historiereplikken, så den ikke overskriver sin optakt.
  sayAfter(followUp);
  renderAge();
  renderActLabel();
  renderChallenge();
  if (!ending) await persistActiveLife();
  if (ending) {
    const achievements = loadAchievements();
    productEvents.emit({
      type: "fate.unlocked",
      scenario: "ending.unlocked",
      turn: engine.getState().attempts,
      payload: {
        endingId: ending.id,
        newlyUnlocked: !Object.hasOwn(achievements, ending.id),
        cause:
          outcome.challenge?.kind === "failed"
            ? "challenge"
            : engine.remainingTurns() === 0
              ? "turn-limit"
              : "combination",
        totalUnlocked:
          Object.keys(achievements).length +
          (Object.hasOwn(achievements, ending.id) ? 0 : 1),
      },
    });
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
    const archived = await archiveCurrentLife({
      kind: "ending",
      endingId: ending.id,
    });
    if (archived) {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(NARRATOR_SAVE_KEY);
    }
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
  if (activePlayBlocked) return;
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
  if (a && b) void performCombine(a, b);
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
  if (activePlayBlocked) return;
  if (!confirm("Start over completely? Karl forgets everything. He's good at that.")) return;
  void clearSave().then((cleared) => {
    if (cleared) location.reload();
  });
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

function setActivePlayBlocked(blocked: boolean): void {
  const locked = blocked || profileMigrationError !== null;
  activePlayBlocked = locked;
  for (const selector of [
    "#challenge",
    "#problems",
    "#tools",
    "#grid",
    "#grid-empty",
    "#dock",
    "#improvise-status-host",
  ]) {
    document.querySelector(selector)?.toggleAttribute("inert", locked);
  }
  el.restart.toggleAttribute("inert", locked);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-replay-target]",
  )) {
    button.disabled = locked;
  }
  document.documentElement.dataset.activePlay =
    locked ? "blocked" : "available";
}

function showNetworkOutage(): void {
  setActivePlayBlocked(true);
  el.networkGate.hidden = false;
  el.titleScreen.hidden = true;
  document.body.classList.add("overlay-open");
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
          <button id="t-primary" class="title-action btn-stone" data-action="${canContinue ? "life.continue" : "life.begin"}">
            <span class="title-action-icon" aria-hidden="true">${icons.titleSpiral}</span>
            <span class="title-action-label">${canContinue ? "Continue" : "Begin"}</span>
          </button>
          ${canContinue ? `<button id="t-new" class="title-action btn-quiet" data-action="life.new">
            <span class="title-action-icon" aria-hidden="true">${icons.restart}</span>
            <span class="title-action-label">New life</span>
          </button>` : ""}
          <button id="t-fates" class="title-action btn-quiet" data-action="fates.open">
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
        <button id="t-trophies" aria-label="Fates you have reached" data-action="fates.open">${icons.titleTrophy}</button>
        <button id="t-sound" aria-pressed="${muted}"
                aria-label="${muted ? "Unmute the narrator" : "Mute the narrator"}" data-action="narrator.mute">${muted ? icons.soundOff : icons.soundOn}</button>
      </div>
    </div>`;
  el.titleScreen.hidden = false;
  el.titleScreen.dataset.scenario = canContinue
    ? "life.continue"
    : "life.fresh-start";
  el.titleScreen.dataset.state = canContinue ? "resumable" : "fresh";
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
    if (canContinue) return void startGame(true);
    void clearSave().then((cleared) => {
      if (cleared) void startGame(false);
    });
  });
  document.getElementById("t-new")?.addEventListener("click", () => {
    void clearSave().then((cleared) => {
      if (cleared) void startGame(false);
    });
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

async function startGame(resume: boolean): Promise<void> {
  if (activePlayBlocked || profileMigrationError) {
    if (profileMigrationError) {
      showPersistenceError(
        "This save cannot be resumed on the current content revision. The original data is untouched.",
      );
    }
    return;
  }
  let resumed = false;
  let replay:
    | { target: ReplayTarget; fromEndingId: string }
    | null = null;
  if (!resumed) {
    try {
      replay = JSON.parse(sessionStorage.getItem(REPLAY_TARGET_KEY) ?? "null");
    } catch {
      replay = null;
    }
  }
  if (sessionClient.onlineRequired) {
    try {
      if (resume && runCredentials) {
        const remote = await sessionClient.loadRun<GameState>(runCredentials);
        runRevision = remote.revision;
        engine.loadState(remote.snapshot);
        resumed = true;
        if (!profile.activeLife) {
          beginProfileLife(remote.snapshot.seed, null);
          engine.loadState(remote.snapshot);
        }
      } else {
        const seed = isFrozen() ? initialSeed : randomSeed();
        const remote = await sessionClient.createRun(seed);
        storeRunCredentials(remote.credentials);
        runRevision = remote.revision;
        beginProfileLife(seed, replay?.target ?? null);
        engine.loadState(remote.snapshot as GameState);
      }
    } catch {
      showNetworkOutage();
      return;
    }
  } else {
    resumed = resume && tryLoad();
    if (!resumed) {
      const seed = isFrozen() ? initialSeed : randomSeed();
      beginProfileLife(seed, replay?.target ?? null);
    }
  }
  if (!resumed) {
    const seed = engine.getState().seed;
    if (replay) {
      productEvents.emit({
        type: "life.replay-started",
        scenario: "replay.named-target",
        turn: 0,
        payload: {
          fromEndingId: replay.fromEndingId,
          target:
            replay.target.kind === "ending"
              ? { kind: "fate", id: replay.target.endingId }
              : replay.target.kind === "branch"
                ? { kind: "branch", id: replay.target.branchId }
                : {
                    kind: "discovery",
                    id: `act-${replay.target.act}:${replay.target.area}`,
                  },
          nextSeed: seed,
        },
      });
      sessionStorage.removeItem(REPLAY_TARGET_KEY);
    }
  }
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = undefined;
  el.titleScreen.hidden = true;
  setBackgroundInert(false);
  runStartedAt = performance.now();
  const state = engine.getState();
  productEvents.emit({
    type: "life.started",
    scenario: resumed ? "life.continue" : "life.fresh-start",
    turn: state.attempts,
    payload: {
      mode: resumed ? "continue" : replay ? "replay" : "new",
      seed: state.seed,
      saveVersion: 1,
      act: state.act,
    },
  });
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
    el.challenge.dataset.state = "idle";
    return;
  }
  el.challenge.dataset.state = "active";
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
el.networkRetry.addEventListener("click", () => void establishSession());
el.networkArchives.addEventListener("click", () => {
  el.networkGate.hidden = true;
  openBook();
});
el.persistenceRetry.addEventListener("click", () => {
  void (async () => {
    if (profileMigrationError) return;
    try {
      const snapshot = structuredClone(profile);
      await profileWrites.run(() => profileStore.saveProfile(snapshot));
      persistenceError = null;
      renderPersistenceError();
    } catch {
      showPersistenceError("Saving still failed. The compatibility save remains intact.");
    }
  })();
});
const profileInitialized = initializeProfile();
void establishSession();

async function establishSession(): Promise<void> {
  await profileInitialized;
  el.networkRetry.disabled = true;
  const readiness = await sessionClient.readiness();
  productEvents.emit({
    type: "platform.session-ready",
    scenario:
      readiness.status === "ready"
        ? "platform.session-ready"
        : "network.unavailable",
    turn: engine.getState().attempts,
    payload: {
      status: readiness.status,
      onlineRequired: readiness.onlineRequired,
      activePlayAllowed: readiness.activePlayAllowed,
      archivesReadable: readiness.archivesReadable,
    },
  });
  el.networkRetry.disabled = false;
  renderAll();
  if (!readiness.activePlayAllowed) {
    showNetworkOutage();
    void markReadyWhenPainted();
    return;
  }
  setActivePlayBlocked(false);
  el.networkGate.hidden = true;
  document.body.classList.remove("overlay-open");
  showTitleScreen();
  applyScenario();
}

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
