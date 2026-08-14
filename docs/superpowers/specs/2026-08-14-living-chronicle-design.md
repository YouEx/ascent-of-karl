# Living Chronicle design

## Decision

Replace the separate narrator banner and always-visible chronicle panel with one
open-book component. The default game view shows the current narrator beat and
the outcome of the latest combination as a single story spread. The full
chronicle, inventions, and timeline move behind a `?` button in the header.

The user explicitly requested this direction. Autopilot selects the two-page
Living Chronicle variant because it preserves the narrator as the game's voice
while making every combination feel like the next page of Karl's story.

## Goals

- Make each combination visibly advance Karl's story.
- Remove the large duplicate paper panels from the default play surface.
- Keep detailed history available without competing with the current action.
- Move `Act N · <name>` into the persistent header.
- Preserve exact visible/spoken narrator parity.
- Preserve keyboard, screen-reader, reduced-motion, save/load, and mobile
  behavior.

## Non-goals

- No engine, recipe, narrator-priority, or content changes.
- No network dependency.
- No replacement of the existing archive data or timeline algorithms.
- No change to endings, age-up rules, improvisation rights, or production
  feature flags.

## Default composition

### Header

The header contains:

1. Product mark and `The Ascent of Karl`.
2. A live chapter label: `Act 1 · The Stone Age`.
3. Karl's remaining summers.
4. A `?` archive button with the existing unread/discovery badge.
5. Fates and restart controls.

The `?` label is visible as an icon but has the accessible name
`Open the chronicle archive`.

### Living Chronicle

Desktop shows an open two-page book:

- **Left page:** `The Narrator`, mute control, and the exact currently spoken
  line.
- **Right page:** the combination pair and its outcome.

Mobile shows the same information as one page with narrator first and outcome
second. It remains one semantic region; the visual fold is decorative.

The right page has four states:

| State | Content |
| --- | --- |
| Opening | A short invitation to make the first combination |
| Discovery | Glyph, name, flavor, historical note, and solved problem |
| Invention | Glyph, invention name, flavor, and solved problem |
| Failed/reused attempt | Pair recap and a concise outcome label; no fake discovery |

The narrator line remains the interpretive voice. The result page reports what
actually happened and never invents historical status.

### Progressive objective

The current screen incorrectly exposes every Act I problem at once. That shows
late-story needs such as `Karl wonders why` while Karl is still freezing,
hungry, and alone, even though the problem's own description assumes he is
already warm, fed, and accompanied. It spoils the story sequence and forces the
chips into a second row.

The default play surface therefore shows only `Narrator.currentPull()` as the
active objective. Solved and future problems live in the archive. Challenges
remain separate because they are time-sensitive interruptions, not chapter
objectives.

The objective uses a real accessible label. Native `title` tooltips are removed;
they currently cover the game with an unstyled browser popup. Any supporting
description is visible in the Living Chronicle or connected with
`aria-describedby`.

## Page-turn behavior

Every completed combination attempt starts one page-turn transition.

1. The engine resolves the attempt.
2. The UI builds an immutable page payload from the pair and outcome.
3. The current spread turns.
4. At the animation midpoint, the new result page and narrator beat become the
   visible current spread.
5. The exact visible narrator text is spoken.

Only one turn may be active. A newer attempt cancels the old visual transition
and displays the latest payload; narrator playback already follows the same
newest-beat-wins contract.

With `prefers-reduced-motion: reduce`, frozen judge scenarios, or unsupported 3D
transforms, content swaps immediately without animation. The decorative turning
leaf is `aria-hidden`.

## Discovery presentation

The Living Chronicle becomes the routine reveal surface. Common discoveries and
improvised inventions no longer open a second modal containing the same result.
Rare and unique discoveries keep their existing celebratory visual treatment,
but the celebration must not hide or replace the committed book page. Endings,
age-up banners, challenges, and fates remain separate overlays because they
change game mode rather than merely record an attempt.

## Archive overlay

The existing `BookView` remains the source of truth for:

- canonical discovery browsing;
- Karl's inventions;
- act navigation;
- timeline expansion.

It is no longer inline on desktop. The header `?` button opens it through the
existing `openOverlay()` path on every viewport. The archive retains at least
two exits: close button and browser back/Escape.

The current act still appears in archive navigation when needed for switching
acts, but the persistent chapter identity lives in the header.

## Component boundaries

### `story-page.ts`

Pure outcome-to-view-model logic:

- `StoryPagePayload`
- `openingStoryPage()`
- `storyPageForOutcome(pair, outcome)`

It has no DOM, audio, timers, or storage and is unit-tested directly.

### `story-book.ts`

Owns the Living Chronicle DOM:

- renders opening/current spreads;
- coordinates page-turn state;
- swaps content at the midpoint;
- exposes `present(payload, narratorLine)`;
- cancels stale turns;
- honors reduced motion and frozen scenarios.

It does not select narrator lines or mutate engine state.

### `main.ts`

Continues to own game orchestration:

- creates the story book;
- routes resolved outcomes to it;
- routes narrator beats to it;
- opens the archive overlay;
- updates the header act label.

### `book.ts`

Remains the archive renderer. Its data and timeline behavior stay intact.

## Accessibility

- The book is one labeled region: `Karl's living chronicle`.
- Narrator text remains `aria-live="polite"`.
- Outcome status uses a separate polite live region only when it differs from
  the narrator text.
- Decorative page leaves and folds are hidden from the accessibility tree.
- Archive, mute, fates, and restart remain real buttons with visible focus.
- Page-turn animation never moves focus.
- The archive button's badge is not read as a separate control.

## Visual direction

The book is a real CSS component, not stitched screenshots:

- one continuous leather/paper cover contour;
- two parchment pages with a central gutter;
- inset page edges and restrained paper grain from existing tokens/assets;
- warm ink, Fraunces narrative type, sans-serif utility labels;
- a single page-turn leaf with front/back paper faces;
- no PNG slices or `border-image` construction.

Painted glyphs remain illustrations. Component geometry, borders, shadows, and
states are HTML/CSS.

## Validation

1. Unit tests for all outcome-to-page mappings.
2. Structural tests for merged DOM, header act label, `?` archive button, and
   removal of the default inline chronicle.
3. Timer tests proving stale page turns cannot overwrite a newer attempt.
4. Reduced-motion tests proving immediate swaps.
5. Existing narration audit proving visible text equals spoken text.
6. Existing archive/timeline tests proving no data loss.
7. Browser checks at mobile, intermediate, and desktop viewports.
8. Accessibility tree and keyboard path:
   archive -> close/back -> mute -> fates -> restart.
9. Production build, Pages contracts, and visual regression.

## Acceptance criteria

- One open-book component replaces the two paper boxes in the default game.
- The header displays the current act and age name.
- Only the current unlocked story objective is visible; later problems are not
  spoiled.
- Every combination produces exactly one latest-wins page transition.
- The right page truthfully displays the resolved outcome.
- The narrator speaks exactly the text visible on the left page.
- The `?` button opens discoveries, inventions, and timeline in an overlay.
- The archive is not always visible on desktop.
- No native browser tooltip covers the objective rail.
- No stitched image slices construct the new book component.
- Reduced motion, keyboard navigation, mobile layout, save/load, and existing
  game rules remain intact.
