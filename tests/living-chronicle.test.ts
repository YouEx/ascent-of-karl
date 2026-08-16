import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
import headerSource from "../src/ui/components/game/GameHeader.svelte?raw";
import chronicleSource from "../src/ui/components/game/LivingChronicle.svelte?raw";
import bookSource from "../src/ui/book.ts?raw";
import styles from "../src/ui/style.css?raw";

function sourceBetween(start: string, end: string): string {
  const from = mainSource.indexOf(start);
  const to = mainSource.indexOf(end, from);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return mainSource.slice(from, to);
}

describe("living chronicle structure", () => {
  it("has one merged semantic story book and no standalone narrator section", () => {
    expect(chronicleSource).toContain('id="story-book"');
    expect(chronicleSource).toContain(
      'aria-label="Karl\'s living chronicle"',
    );
    expect(chronicleSource).not.toContain('<section id="narrator"');
    expect(chronicleSource).toContain('id="narrator-text"');
    expect(chronicleSource).toContain('id="story-outcome"');
    expect(chronicleSource).toContain(
      'class="story-turn-leaf" aria-hidden="true"',
    );
  });

  it("moves the current act into the header", () => {
    expect(headerSource).toContain('id="act-label"');
    expect(mainSource).toContain("function renderActLabel()");
    expect(mainSource).toContain("renderActLabel();");
  });

  it("opens the archive from a visible control with a book affordance", () => {
    // Kontrakten er at arkivet har en SYNLIG knap, og at knappens ikon lover
    // det knappen gør. Testen låste før `icons.help` og hed "question-mark
    // control" — men spørgsmålstegnet kom ind ved et uheld i eb52d3e, som
    // skiftede ikonet samtidig med at etiketten blev omdøbt til "Open the
    // chronicle archive". Et "?" betyder hjælp overalt ellers, så knappen
    // lovede hjælp og åbnede et arkiv. Testen holder nu på løftet.
    expect(headerSource).toContain(
      'aria-label="Open the chronicle archive"',
    );
    expect(headerSource).toContain("bookIcon");
    expect(headerSource).not.toContain("help");
    expect(styles).not.toMatch(/#book-btn\s*\{[^}]*display:\s*none/s);
  });

  it("shows only the narrator's current pull without a native tooltip", () => {
    const renderProblems = sourceBetween(
      "function renderProblems()",
      "const EMPTY_SLOT",
    );
    expect(renderProblems).toContain("narrator.currentPull()");
    expect(renderProblems).not.toContain("currentAct().problems");
    expect(renderProblems).not.toContain(".map(");
    expect(renderProblems).not.toContain("title=");
  });

  it("does not create native title tooltips in the game or archive", () => {
    expect(mainSource + headerSource + chronicleSource).not.toContain(" title=");
    expect(mainSource).not.toMatch(/\.title\s*=/);
    expect(bookSource).not.toMatch(/\.title\s*=/);
  });

  it("keeps the archive overlay-only at desktop widths", () => {
    const desktop = styles.slice(styles.indexOf("@media (min-width: 820px)"));
    expect(desktop).not.toMatch(
      /#book-panel\s*\{[^}]*position:\s*static/s,
    );
    expect(desktop).not.toMatch(
      /#book-panel\s*\{[^}]*visibility:\s*visible/s,
    );
  });

  it("builds the Living Chronicle with CSS rather than sliced frames", () => {
    expect(styles).toContain("#story-book");
    expect(styles).toContain(".story-cover");
    expect(styles).toContain(".story-page");
    expect(styles).not.toMatch(/#story-book[^}]*border-image/s);
    expect(styles).not.toMatch(
      /#story-book[^}]*(?:narrator-paper|chronicle-paper)/s,
    );
  });

  it("archives only the active life's event buffer and resumes that buffer explicitly", () => {
    expect(mainSource).toContain("productEvents.startLifeJournal(");
    expect(mainSource).toContain("events: productEvents.lifeJournal()");
    expect(mainSource).not.toContain("events: productEvents.journal()");
  });

  it("persists every completed attempt and each asynchronously queued narrator beat", () => {
    const presentLine = sourceBetween(
      "function presentLine",
      "function renderMute",
    );
    const performCombine = sourceBetween(
      "async function performCombine",
      "function selectElement",
    );
    expect(presentLine).toContain("void persistActiveLife();");
    expect(performCombine).toContain("await persistActiveLife();");
    expect(performCombine).toContain(
      "shouldPersistAttemptState(GENERATED_GAMEPLAY_ENABLED",
    );
  });

  it("waits for an accepted runtime ending beat to enter the life journal before archiving", () => {
    const performCombine = sourceBetween(
      "async function performCombine",
      "function selectElement",
    );
    expect(performCombine).toMatch(
      /queueRuntimeCommentary\(\s*commentaryCue,\s*ending !== null,\s*\)/,
    );
    expect(performCombine).toContain(
      "await runtimeCommentaryPresentation",
    );
    expect(
      performCombine.indexOf("await runtimeCommentaryPresentation"),
    ).toBeLessThan(performCombine.indexOf("archiveCurrentLife"));
  });

  it("updates the persistent compendium during play and renders its invention gallery", () => {
    expect(mainSource).toContain("applyLiveProgress(");
    expect(mainSource).toContain('class="compendium-inventions"');
    expect(mainSource).toContain("profile.compendium.inventions");
  });

  it("renders archived lives from causal events rather than a flat discovery-name list", () => {
    const archivedLife = sourceBetween(
      "async function renderArchivedLife",
      "// --- Achievements",
    );
    expect(archivedLife).toContain("chronicleEntriesForArchive(");
    expect(archivedLife).not.toContain("canonical.map");
  });
});
