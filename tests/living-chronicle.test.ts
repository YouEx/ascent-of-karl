import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
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
    expect(mainSource).toContain(
      '<section id="story-book" aria-label="Karl\'s living chronicle">',
    );
    expect(mainSource).not.toContain('<section id="narrator"');
    expect(mainSource).toContain('id="narrator-text"');
    expect(mainSource).toContain('id="story-outcome"');
    expect(mainSource).toContain('class="story-turn-leaf" aria-hidden="true"');
  });

  it("moves the current act into the header", () => {
    expect(mainSource).toContain('id="act-label"');
    expect(mainSource).toContain("function renderActLabel()");
    expect(mainSource).toContain("renderActLabel();");
  });

  it("opens the archive from a visible question-mark control", () => {
    expect(mainSource).toContain(
      'aria-label="Open the chronicle archive"',
    );
    expect(mainSource).toContain("icons.help");
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
    expect(mainSource).not.toContain(" title=");
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
});
