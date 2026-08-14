# Living Chronicle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate narrator and inline chronicle with one open-book story component that turns after every combination, moves the act label into the header, shows only the current story objective, and keeps full history behind a `?` archive button.

**Architecture:** Add a pure outcome-to-page mapper and a focused DOM controller for the book transition. `main.ts` remains the orchestrator, `BookView` remains the archive, and the engine/narrator remain unchanged. CSS owns the open-book material and page turn without stitched component images.

**Tech Stack:** TypeScript, Vite, Vitest, semantic HTML, CSS transforms, Playwright UX audit.

---

## File map

- Create `src/ui/story-page.ts`: pure `CombineOutcome` to story-page view model.
- Create `src/ui/story-book.ts`: DOM rendering and latest-wins page-turn controller.
- Create `tests/story-page.test.ts`: exhaustive outcome mapping tests.
- Create `tests/story-book.test.ts`: transition generation/reduced-motion tests without a browser DOM.
- Create `tests/living-chronicle.test.ts`: source-level integration contracts.
- Modify `src/ui/main.ts`: header act label, merged book markup, current objective, combination routing.
- Modify `src/ui/style.css`: open-book component, objective rail, archive overlay, responsive and reduced-motion rules.
- Modify `src/ui/icons.ts`: add a question-mark archive icon if one does not exist.
- Modify `src/ui/book.ts`: archive-only labels; retain discovery/invention/timeline behavior.
- Modify `DESIGN.md`: document the merged book and progressive objective contract before CSS changes.
- Modify `tools/ux_audit.mjs`: archive selector/name and merged-book browser checks.

### Task 1: Freeze the new structural contract

**Files:**
- Modify: `DESIGN.md`
- Create: `tests/living-chronicle.test.ts`

- [ ] **Step 1: Document the component before styling it**

Add a `Living Chronicle` subsection to `DESIGN.md` stating:

```markdown
The default game surface has one open-book component. Its left page is the
narrator; its right page is the latest combination outcome. The archive is an
overlay opened by the header question-mark button. Component geometry is CSS,
never PNG slices or border-image. Only Narrator.currentPull() is visible as the
current objective; later Act problems remain hidden until they become current.
```

- [ ] **Step 2: Write failing source-contract tests**

Create `tests/living-chronicle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
import styles from "../src/ui/style.css?raw";

describe("living chronicle structure", () => {
  it("has one merged story book and no standalone narrator section", () => {
    expect(mainSource).toContain('id="story-book"');
    expect(mainSource).not.toContain('<section id="narrator"');
    expect(mainSource).toContain('id="narrator-text"');
    expect(mainSource).toContain('id="story-outcome"');
  });

  it("moves the current act into the header", () => {
    expect(mainSource).toContain('id="act-label"');
    expect(mainSource).toContain("renderActLabel");
  });

  it("opens the archive from a question-mark control", () => {
    expect(mainSource).toContain('aria-label="Open the chronicle archive"');
    expect(mainSource).toContain("icons.help");
  });

  it("does not expose native problem tooltips", () => {
    const renderProblems = mainSource.slice(
      mainSource.indexOf("function renderProblems"),
      mainSource.indexOf("const EMPTY_SLOT"),
    );
    expect(renderProblems).not.toContain('title="${p.description}');
    expect(renderProblems).toContain("narrator.currentPull()");
  });

  it("builds the book with CSS rather than sliced frames", () => {
    expect(styles).toContain("#story-book");
    expect(styles).not.toMatch(/story-book[^}]*border-image/s);
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
npx vitest run tests/living-chronicle.test.ts
```

Expected: failures for missing `story-book`, `act-label`, `icons.help`, and
progressive objective rendering.

### Task 2: Map every outcome to a truthful story page

**Files:**
- Create: `src/ui/story-page.ts`
- Create: `tests/story-page.test.ts`

- [ ] **Step 1: Write exhaustive failing tests**

Use fixture `ElementDef` values and cover `discovery`, `known`, `gated`,
`nofuse`, `improvised`, and `improvise-rejected`.

```ts
import { describe, expect, it } from "vitest";
import { storyPageForOutcome } from "../src/ui/story-page";

it("uses canonical discovery copy without inventing history", () => {
  const page = storyPageForOutcome(stone, stick, discovery);
  expect(page).toMatchObject({
    kind: "discovery",
    pairLabel: "Stone + Stick",
    title: discovery.element.name,
    body: discovery.element.flavor,
    note: discovery.element.note,
    elementId: discovery.element.id,
  });
});

it("reports a failed pair without calling it a discovery", () => {
  const page = storyPageForOutcome(stone, grass, nofuse);
  expect(page.kind).toBe("attempt");
  expect(page.pairLabel).toBe("Stone + Grass");
  expect(page.title).toBe("No new discovery");
  expect(page.elementId).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run tests/story-page.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure mapper**

Create:

```ts
import type { CombineOutcome, ElementDef } from "../core/types";

export type StoryPageKind =
  | "opening"
  | "discovery"
  | "invention"
  | "known"
  | "blocked"
  | "attempt";

export interface StoryPagePayload {
  kind: StoryPageKind;
  pairLabel: string;
  kicker: string;
  title: string;
  body?: string;
  note?: string;
  solved?: string;
  elementId?: string;
  emoji?: string;
}

export function openingStoryPage(): StoryPagePayload {
  return {
    kind: "opening",
    pairLabel: "The first page",
    kicker: "Karl's story",
    title: "The page is waiting",
    body: "Combine two elements to write what happens next.",
  };
}

export function storyPageForOutcome(
  a: ElementDef,
  b: ElementDef,
  outcome: CombineOutcome,
): StoryPagePayload {
  const pairLabel = `${a.name} + ${b.name}`;
  switch (outcome.kind) {
    case "discovery":
      return {
        kind: "discovery",
        pairLabel,
        kicker: "Discovery",
        title: outcome.element.name,
        body: outcome.element.flavor,
        note: outcome.element.note,
        solved: outcome.solved?.name,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "improvised":
      return {
        kind: "invention",
        pairLabel,
        kicker: outcome.reused ? "Karl remembers" : "Karl invents",
        title: outcome.element.name,
        body: outcome.element.flavor,
        solved: outcome.solved?.name,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "known":
      return {
        kind: "known",
        pairLabel,
        kicker: "Already written",
        title: outcome.element.name,
        body: outcome.element.flavor,
        elementId: outcome.element.id,
        emoji: outcome.element.emoji,
      };
    case "gated":
      return {
        kind: "blocked",
        pairLabel,
        kicker: "Not yet",
        title: outcome.combo.result,
        body: outcome.unsolved.map((problem) => problem.name).join(", "),
      };
    case "nofuse":
      return {
        kind: "attempt",
        pairLabel,
        kicker: "Attempt",
        title: "No new discovery",
      };
    case "improvise-rejected":
      return {
        kind: "attempt",
        pairLabel,
        kicker: "Karl's idea",
        title: "It does not hold together",
      };
  }
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npx vitest run tests/story-page.test.ts
```

Expected: all outcome cases pass.

### Task 3: Build a latest-wins page-turn controller

**Files:**
- Create: `src/ui/story-book.ts`
- Create: `tests/story-book.test.ts`

- [ ] **Step 1: Test stale-turn cancellation and reduced motion**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageTurn } from "../src/ui/story-book";

afterEach(() => vi.useRealTimers());

it("lets only the newest turn reach its midpoint", () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const turn = new PageTurn(240);
  turn.start(() => seen.push("old"));
  turn.start(() => seen.push("new"));
  vi.advanceTimersByTime(120);
  expect(seen).toEqual(["new"]);
});

it("swaps immediately when motion is reduced", () => {
  const seen: string[] = [];
  const turn = new PageTurn(240);
  turn.start(() => seen.push("now"), true);
  expect(seen).toEqual(["now"]);
});
```

- [ ] **Step 2: Implement `PageTurn` and `StoryBook`**

`PageTurn` owns only timer generation. `StoryBook` owns DOM rendering:

```ts
export class PageTurn {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly durationMs: number) {}

  start(atMidpoint: () => void, immediate = false): void {
    this.cancel();
    const generation = ++this.generation;
    if (immediate) {
      atMidpoint();
      return;
    }
    this.timer = setTimeout(() => {
      if (generation === this.generation) atMidpoint();
    }, this.durationMs / 2);
  }

  cancel(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
```

`StoryBook.present(payload)` must:

1. add `is-turning`;
2. swap `#story-outcome` at midpoint;
3. remove `is-turning` at the end;
4. use `glyphHTML()` for `elementId`;
5. skip timers when reduced motion or judge freeze is active.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/story-book.test.ts tests/story-page.test.ts
```

Expected: all pass.

### Task 4: Merge the DOM and progressive objective

**Files:**
- Modify: `src/ui/main.ts`
- Modify: `src/ui/icons.ts`

- [ ] **Step 1: Add the archive icon and merged markup**

Add an outlined question-mark icon to `icons.help`. Replace the standalone
`#narrator` section with:

```html
<section id="story-book" aria-label="Karl's living chronicle">
  <div class="story-cover">
    <article class="story-page story-page-narrator">
      <div id="bubble-head">
        <span id="narrator-label">The Narrator</span>
        <button id="mute" class="icon-btn" aria-pressed="false"
                aria-label="Mute the narrator"></button>
      </div>
      <p id="narrator-text" aria-live="polite"></p>
    </article>
    <div class="story-gutter" aria-hidden="true"></div>
    <article id="story-outcome" class="story-page story-page-outcome"
             aria-live="polite"></article>
    <div class="story-turn-leaf" aria-hidden="true"></div>
  </div>
</section>
```

Add `<span id="act-label"></span>` to the header and change the book button to:

```html
<button id="book-btn" class="icon-btn"
        aria-label="Open the chronicle archive">
  ${icons.help}<span id="book-badge"></span>
</button>
```

- [ ] **Step 2: Add `renderActLabel()`**

```ts
function renderActLabel(): void {
  const act = engine.currentAct();
  el.actLabel.textContent = `Act ${act.act} · ${act.name}`;
}
```

Call it from `renderAll()` and after age-up.

- [ ] **Step 3: Show only the current unlocked objective**

Replace the `currentAct().problems.map(...)` loop with the current narrator pull:

```ts
function renderProblems(): void {
  const problem = narrator.currentPull();
  if (!problem) {
    el.problems.replaceChildren();
    el.problems.hidden = true;
    return;
  }
  el.problems.hidden = false;
  const mark = problem.icon ?? "○";
  el.problems.innerHTML = `
    <span class="problem wanted tint-${problem.tint ?? "neutral"}"
          data-problem="${problem.id}"
          aria-label="${problem.name}. ${problem.description}">
      ${problemGlyphHTML(problem.id, mark, "problem-icon")}
      <span>${problem.name}</span>
    </span>`;
}
```

Do not use `title`.

- [ ] **Step 4: Run structural tests**

Run:

```bash
npx vitest run tests/living-chronicle.test.ts tests/app-frame.test.ts
```

Expected: merged structure and progressive objective tests pass.

### Task 5: Route every attempt into the book

**Files:**
- Modify: `src/ui/main.ts`

- [ ] **Step 1: Instantiate the book controller**

```ts
const storyBook = new StoryBook(
  document.getElementById("story-book")!,
  document.getElementById("story-outcome")!,
  () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    isFrozen(),
);
storyBook.render(openingStoryPage());
```

- [ ] **Step 2: Present exactly one page per completed attempt**

Immediately after `performPlayerAttempt()`:

```ts
const page = storyPageForOutcome(
  engine.element(a),
  engine.element(b),
  outcome,
);
storyBook.present(page);
```

Do not call `present()` in any outcome-specific branch.

- [ ] **Step 3: Keep narrator parity unchanged**

Continue routing `line` through `say(line)` and `followUp` through
`sayAfter(followUp)`. `#narrator-text` remains the one visible text node passed
through `speak()`, so `playLine()` still speaks the exact visible text.

- [ ] **Step 4: Remove redundant routine discovery overlays**

Keep `showDiscoveryCard()` only for `rare` and `unique` tiers:

```ts
const tier = rarity.get(outcome.element.id)?.tier ?? "common";
if (!ending && tier !== "common") showDiscoveryCard(outcome);
```

Do not show an invention modal; the new book page is the reveal.

- [ ] **Step 5: Run narration and UI tests**

Run:

```bash
npx vitest run \
  tests/story-page.test.ts \
  tests/story-book.test.ts \
  tests/living-chronicle.test.ts \
  tests/narration-audio.test.ts \
  tests/narration-audit.test.ts
```

Expected: all pass.

### Task 6: Design the real open-book component

**Files:**
- Modify: `src/ui/style.css`

- [ ] **Step 1: Replace narrator and inline-book layout**

Build `#story-book` with token-based CSS:

```css
#story-book {
  position: sticky;
  top: 3.25rem;
  z-index: 15;
  perspective: 1400px;
}

.story-cover {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr);
  min-height: 230px;
  padding: 14px;
  border: 1px solid var(--tile-contour);
  border-radius: var(--radius-lg);
  background:
    var(--grain),
    linear-gradient(to bottom, var(--tile-lit), var(--tile-shade));
  background-blend-mode: overlay, normal;
  box-shadow:
    inset 0 0 0 3px var(--field-bevel),
    inset 0 0 0 4px var(--field-groove),
    var(--shadow-paper);
}

.story-page {
  min-width: 0;
  padding: clamp(1.25rem, 3vw, 2.5rem);
  color: var(--ink-warm);
  background:
    var(--grain),
    linear-gradient(100deg, var(--chronicle), var(--parchment));
  background-blend-mode: overlay, normal;
}

.story-gutter {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--valley-dark) 22%, transparent),
    transparent 45% 55%,
    color-mix(in srgb, var(--valley-dark) 18%, transparent)
  );
}
```

Use existing tokens only. Do not use `border-image`, PNG slices, or raw colors.

- [ ] **Step 2: Add one authored page turn**

```css
.story-turn-leaf {
  position: absolute;
  inset: 14px 14px 14px calc(50% + 8px);
  transform-origin: left center;
  pointer-events: none;
  backface-visibility: hidden;
  background:
    var(--grain),
    linear-gradient(100deg, var(--chronicle), var(--parchment));
  opacity: 0;
}

#story-book.is-turning .story-turn-leaf {
  opacity: 1;
  animation: story-page-turn 420ms var(--ease-out) both;
}

@keyframes story-page-turn {
  0% { transform: rotateY(0deg); }
  48% { box-shadow: -18px 4px 22px color-mix(in srgb, var(--valley-dark) 28%, transparent); }
  100% { transform: rotateY(-180deg); }
}
```

- [ ] **Step 3: Add mobile and reduced-motion behavior**

```css
@media (max-width: 819px) {
  .story-cover { grid-template-columns: 1fr; }
  .story-gutter { height: 1px; }
  .story-turn-leaf { inset: 14px; transform-origin: right center; }
}

@media (prefers-reduced-motion: reduce) {
  #story-book.is-turning .story-turn-leaf { animation: none; opacity: 0; }
}
```

- [ ] **Step 4: Make the archive overlay-only on every viewport**

Remove the desktop rule that places `#book-panel` inline. Keep it fixed and
opened only by `.open`.

- [ ] **Step 5: Run detector and focused tests**

Run:

```bash
impeccable detect src/ui/style.css --fast
npx vitest run tests/living-chronicle.test.ts tests/design-tokens.test.ts
```

Expected: no component-slice, raw-color, or structural findings.

### Task 7: Update archive and browser contracts

**Files:**
- Modify: `src/ui/book.ts`
- Modify: `tools/ux_audit.mjs`

- [ ] **Step 1: Rename archive-facing labels**

Keep `BookView` data intact. Change overlay labels from generic `The book` to
`Chronicle archive`, without changing timeline or invention rendering.

- [ ] **Step 2: Update UX audit**

The overlay entry remains `book-panel`, opened with `#book-btn`. Add checks:

```js
record(
  "Living Chronicle",
  "single-default-book",
  (await page.locator("#story-book").count()) === 1 &&
    !(await page.locator("#book-panel").isVisible()),
);

record(
  "Living Chronicle",
  "act-in-header",
  await page.locator("header #act-label").isVisible(),
);
```

Update the discovery-card audit to use a rare/unique fixture or remove it if no
routine discovery overlay remains.

- [ ] **Step 3: Run focused browser audit**

Run a production preview, then:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5199
node tools/ux_audit.mjs http://127.0.0.1:5199/
```

Expected: all archive exits, focus, merged-book, and header checks pass.

### Task 8: Final verification and commit

**Files:**
- All files above

- [ ] **Step 1: Run targeted feature gates**

```bash
npx vitest run \
  tests/story-page.test.ts \
  tests/story-book.test.ts \
  tests/living-chronicle.test.ts \
  tests/app-frame.test.ts \
  tests/design-tokens.test.ts \
  tests/narration-audio.test.ts \
  tests/narration-audit.test.ts
npm run audit:narration
npm run build
```

Expected: all green.

- [ ] **Step 2: Visually inspect real renders**

Capture desktop 1536x1024, mobile 390x844 DPR2, and 820px boundary. Verify:

- one open-book component;
- no late-story objective spoilers;
- no browser tooltip;
- page-turn leaf has no rectangular seam;
- archive is closed by default and reachable by `?`;
- narrator visible text equals spoken text;
- no overlap with problems, tools, dock, or mobile viewport.

- [ ] **Step 3: Run repository-required pre-commit gates**

```bash
npm test
npm run validate
```

Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add \
  DESIGN.md \
  docs/superpowers/specs/2026-08-14-living-chronicle-design.md \
  docs/superpowers/plans/2026-08-14-living-chronicle.md \
  src/ui/story-page.ts \
  src/ui/story-book.ts \
  src/ui/main.ts \
  src/ui/style.css \
  src/ui/icons.ts \
  src/ui/book.ts \
  tests/story-page.test.ts \
  tests/story-book.test.ts \
  tests/living-chronicle.test.ts \
  tools/ux_audit.mjs
git commit -m "feat(ui): turn Karl's story into a living chronicle" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: 4835fe91-54b1-4c52-ba77-d7449bbdb5a2"
```
