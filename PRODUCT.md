# The Ascent of Karl — Product Authority

**Status:** Current product authority
**Effective:** 2026-08-16
**Scope:** Product purpose, player-facing capabilities, success criteria, current
truth, approved target direction, and release gates.

## Authority

This document is the current human authority for the product.

- `docs/product/capabilities.json` and `docs/product/scenarios.json` are
  machine-readable contracts that must agree with this document.
- `PRD.md`, `ROADMAP.md`, `DESIGN.md`, plans, references, tests, and source code
  provide detail and evidence. They do not override this document.
- Generated graphs and context packs are derived evidence. They are never
  product authority.
- Every capability distinguishes **current truth** from an **approved target**.
  An approved target is not shipped behavior.

## Product promise

> Shape Karl's journey through what you combine, collect the history and fates
> you uncover, and hear the narrator turn every success and disaster into his
> story.

## Primary purpose

The Ascent of Karl is an **interactive story**. Combining is how the player
chooses what Karl tries, discovers, invents, solves, and becomes.

The game succeeds when a player's actions create a recognisable life for Karl,
and the resulting collection makes that life worth remembering and another life
worth beginning.

## The product loop

1. Begin a distinct, viable life with seeded variation.
2. Choose two things because the pairing may solve a need, create something,
   provoke the narrator, or change Karl's path.
3. Receive meaningful yield: a discovery, invention, consequence, specific joke,
   or actionable clue.
4. Add the result to this life's Chronicle and, where authored, to the persistent
   compendium.
5. Let accumulated choices create different priorities, branches, and fates.
6. Finish a life, inspect what remains undiscovered, and begin another with a
   named target.

## Player payoff and north star

The strongest session payoff is **collection growth**. Collection is not
separate from story: it is the visible record of the story the player authored.

The product north star is the player's **authored-content completion percentage**
across lives:

- canonical discoveries;
- major authored story branches;
- authored fates/endings.

Generated inventions are unbounded and therefore never enter the percentage
denominator. An authored discovery, branch, or ending unlocked through an
invention does count.

Every life has an immutable Chronicle. A separate persistent compendium tracks
authored completion across all archived lives.

Success criteria begin as observable qualitative outcomes. The first external
playtests establish baselines; numerical thresholds are added only when measured
evidence exists. Invented precision is not product truth.

## Core product principles

### Narrator: three required dimensions

The narrator's humour, guidance, and account of who Karl becomes are equally
important. A narrator change fails if it improves one by sacrificing another.

Evidence of success:

- players laugh at or quote a reaction;
- players act on guidance when stuck;
- players can describe the specific Karl produced by the run.

### Karl: comic mascot with accumulated scars

Karl is primarily the comic mascot, not a neutral player avatar. He remains
immediately recognisable across every life. Choices may accumulate through
expression, pose, props, costume, scars, reputation, and ending tableaux.

### History: credible story world

Historical logic makes Karl's world credible, surprising, and reason-able.
History is story texture and discovery, not curriculum or assessment.

Historical claims appear only on curated canonical content with verified
sources. Generated inventions carry no historical note or claim.

### Sandbox: secondary, integrated objective

Open-ended experimentation is a current secondary product objective.
Inventions may solve needs and unlock authored branches or endings after passing
deterministic validation. The invention remains outside finite completion; the
authored consequence it unlocks counts.

### Generated gameplay: bounded authority

The target product may let a model propose typed gameplay results. A
deterministic validator owns identity, tags, depth, eligibility, solvability,
progression effects, completion effects, and bounded consequences.

Accepted generated gameplay is run-local. Editorial promotion is required before
it becomes canonical. A second model is not a substitute for deterministic
validation.

### Online target and failure behavior

The approved target is online-required active play. This target cannot advance
to production until the backend is deployed, observable, quota-protected,
privacy-reviewed, load-tested, and proven under failure.

When the required network is unavailable:

- active play does not start or resume;
- local saves and archived lives remain intact;
- prior Chronicles and the compendium remain available read-only;
- the product never silently substitutes a materially different game.

### Accessibility: global completion gate

Accessibility is not one capability. It is a quality gate across all
capabilities.

No capability is complete if required meaning or action depends solely on sound,
colour, motion, hover, precision pointing, or fixed text size. Equivalent
information and action channels are required, with WCAG AA as the measurable
floor.

## Player-facing capability map

### 1. Begin a life

**Purpose:** Start one distinct archived Karl life and reach meaningful play
quickly.

**Player outcome:** The player understands the available starting possibilities
and begins a viable but meaningfully varied life.

**Current truth:** New, continue, and restart flows use a stored deterministic
LifePlan with five starting elements, two authored sidequests, two challenges,
and exhaustively validated opening witnesses.

**Approved target:** A stored deterministic seed selects a bounded starting
subset and sidequests while guaranteeing viable authored progression.

**Qualitative acceptance:**

- Players notice that a new life differs.
- Players understand the starting possibilities without explanation.
- Every generated seed retains a viable authored path.

**Lifecycle:** production → implementing

**Advancement gate:** Define and exhaustively verify seeded starting-pool and
sidequest viability before implementation.

### 2. Choose and combine

**Purpose:** Give the player the primary language for deciding what Karl tries.

**Player outcome:** A selected pair produces a meaningful result, reaction,
consequence, or clue.

**Current truth:** The player selects two elements. Canonical recipes win;
otherwise local compatibility returns a specific verdict and optional bounded
invention, while online mode commits through a revisioned authoritative run.

**Approved target:** Every valid attempt produces meaningful yield: a new
outcome or a specific humour, guidance, or story response.

**Qualitative acceptance:**

- Most valid attempts produce meaningful yield.
- Generic silence never follows an attempt.
- The player can distinguish result, reaction, and next possibility.

**Lifecycle:** production → implementing

**Advancement gate:** External playtest must establish where attempts still feel
empty or arbitrary.

### 3. Canonical discovery

**Purpose:** Deliver a collectible authored story milestone that expands future
possibilities.

**Player outcome:** The player recognises a new canonical result, sees collection
progress, and understands that the world has expanded.

**Current truth:** Canonical discoveries carry authored effects and now update
both the active life record and finite persistent completion.

**Approved target:** The discovery's newness, future utility, Chronicle entry,
and persistent completion effect are immediately legible.

**Qualitative acceptance:**

- Players recognise the result as new.
- Players understand that it expands future possibilities.
- Visible collection progress feels valuable.

**Lifecycle:** production → implementing

**Advancement gate:** The dual collection model must define canonical completion
and save compatibility.

### 4. Invention

**Purpose:** Provide alternative progression when a player's unscripted idea is
plausible or productively absurd.

**Player outcome:** A player-owned invention remains distinct from canon and can
meaningfully affect this life.

**Current truth:** The deterministic invention floor remains available for local
compatibility; the Worker can now select a closed generated candidate whose
taxonomy, effects, history rights, and run-local identity are validated
deterministically.

**Approved target:** A model may propose typed run-local gameplay under
deterministic validation; accepted inventions may solve needs and unlock
authored consequences without historical claims.

**Qualitative acceptance:**

- Inventions offer credible alternative progress.
- Players understand inventions are not historical canon.
- The result feels caused by the player's unscripted choice.

**Lifecycle:** playtest → implementing

**Advancement gate:** External improvisation playtest, deterministic gameplay
validator, and production backend readiness must all pass.

### 5. Narrator

**Purpose:** Make the game funny, keep the player moving, and turn play into the
story of this Karl.

**Player outcome:** The player laughs, receives useful guidance, and recognises a
coherent character arc across the life.

**Current truth:** The narrator retains its full priority chain and emits typed
humour/guidance/story evidence into each life journal.

**Approved target:** Humour, guidance, and story continuity remain equally
required across generated gameplay, seeded lives, longer memory, and online
production.

**Qualitative acceptance:**

- Players laugh at or quote a reaction.
- Players act on narrator guidance when stuck.
- Players can describe who their Karl became.

**Lifecycle:** production → implementing

**Advancement gate:** Playtest must independently evidence humour, guidance, and
story continuity.

### 6. Pursue needs

**Purpose:** Give clear short-term goals without reducing the game to one
prescribed recipe.

**Player outcome:** The player can name the next need and imagine multiple
possible solutions.

**Current truth:** Current Act problems, predicates, hints, canonical
discoveries, and validated inventions use the same deterministic solve rules.

**Approved target:** Canonical discoveries and validated inventions can provide
multiple legible paths to the same need.

**Qualitative acceptance:**

- Players can name the current goal.
- Players perceive multiple possible solution paths.
- Players do not feel railroaded.

**Lifecycle:** production → implementing

**Advancement gate:** Generated solutions must pass the same deterministic solve
predicates as canonical elements.

### 7. Face challenges and sidequests

**Purpose:** Create temporary priority conflicts that make lives diverge.

**Player outcome:** The player notices an interruption, chooses deliberately,
and later recognises its consequence.

**Current truth:** Each LifePlan selects a deterministic challenge subset and
authored branch-sidequests; their outcomes feed branch and Chronicle state.

**Approved target:** Seeded sidequests and challenges interrupt plans without
replacing the main story, and their consequences remain visible later.

**Qualitative acceptance:**

- Players notice the priority conflict.
- Players deliberately change or preserve their plan.
- Players connect a later outcome to the choice.

**Lifecycle:** production → implementing

**Advancement gate:** Seeded challenge selection must preserve life viability
and causal evidence.

### 8. Read one life's Chronicle

**Purpose:** Preserve the causal story of one distinct Karl life.

**Player outcome:** The player can reconstruct what this Karl tried, discovered,
invented, solved, and became.

**Current truth:** The Living Chronicle keeps its live pages and canonical
archive, while ProfileV2 stores immutable ended/abandoned lives and exposes
them read-only.

**Approved target:** Every archived life can be reconstructed from attempts,
discoveries, inventions, needs, challenges, branches, and fate.

**Qualitative acceptance:**

- Players reconstruct the causal story of one life.
- Players distinguish one archived Karl from another.
- Canonical history and inventions remain visibly distinct.

**Lifecycle:** production → implementing

**Advancement gate:** Versioned per-life archives and save migration must be
specified and tested.

### 9. Complete the master compendium

**Purpose:** Make finite authored completion legible and motivate another life
without revealing exact recipes.

**Player outcome:** The player understands completion, identifies a broad gap,
and chooses another life to pursue it.

**Current truth:** The master compendium persists a 197-entry authored
denominator across canonical discoveries, three major branches, and fifteen
fates; inventions remain a separate unbounded gallery.

**Approved target:** The compendium combines canonical discoveries, major
branches, and endings into a percentage while inventions remain in a separate
unbounded gallery.

**Qualitative acceptance:**

- Players understand what the completion percentage includes.
- Players identify an unexplored area without receiving an exact solution.
- Players choose another life to pursue the gap.

**Lifecycle:** proposed → implementing

**Advancement gate:** Define branch identity, completion denominator,
persistence, and migration before implementation.

### 10. Unlock a fate

**Purpose:** Reward exploration with a surprising, collectible ending.

**Player outcome:** The player unlocks a memorable fate, understands its cause,
and becomes curious about undiscovered endings.

**Current truth:** Authored endings unlock from deterministic state, archive the
completed life once, and update persistent fate completion.

**Approved target:** Each ending remains surprising but causally traceable, and
its rarity/conditions never require fabricated statistics.

**Qualitative acceptance:**

- The ending surprises the player.
- The player can trace why this life produced it.
- The player wants to collect more fates.

**Lifecycle:** production → implementing

**Advancement gate:** Persistent compendium semantics and ending provenance must
be defined.

### 11. Replay and optionally share

**Purpose:** Turn completion gaps, new seeds, sidequests, and alternative
progression into another distinct life. Sharing expresses the result but is not
required for progression.

**Player outcome:** The player names a new target and voluntarily begins another
life; sharing remains optional expression.

**Current truth:** Players can archive lives, inspect seed-coded summaries,
choose broad non-spoiler replay targets, and begin a new seeded life.

**Approved target:** Endings and compendium gaps present meaningful replay
targets; life summaries and seeds remain understandable outside the running
game.

**Qualitative acceptance:**

- Players name a different target or path.
- Players voluntarily begin another life.
- Shared summaries remain understandable without being required for progress.

**Lifecycle:** production → implementing

**Advancement gate:** Seed format, life archive, and compendium targets must be
implemented and playtested.

### 12. Play across devices

**Purpose:** Deliver the same meaningful, completable game on phone and desktop,
even when layout and input differ.

**Player outcome:** The player understands the same story, choices, feedback,
and collection on supported devices.

**Current truth:** A Svelte 5 semantic shell now serves the same responsive
mobile/desktop product; typed sessions, IndexedDB profiles, and Worker run APIs
exist, while production online-required mode remains readiness-gated.

**Approved target:** The Svelte replacement preserves meaning, behavior,
accessibility, events, and save compatibility across supported devices.

**Qualitative acceptance:**

- The same life is completable on phone and desktop.
- Layout differences do not change product meaning.
- Every capability passes equivalent-channel accessibility and WCAG AA.

**Lifecycle:** production → implementing

**Advancement gate:** Differential old/new parity must pass before Svelte
replaces the current UI.

## Active execution decision

Martin explicitly lifted the pre-playtest implementation freeze on 2026-08-16.
All approved target capabilities are now **implementing**. The external
playtest remains required production evidence for the capabilities whose
advancement gates name it; it is no longer an implementation blocker.

## Current and target architecture

### Current

- TypeScript + Vite.
- Deterministic core and content-driven gameplay.
- Svelte 5 owns the semantic DOM shell; the existing controller preserves
  behavior and side-effect ordering.
- Seeded LifePlans, ProfileV2 archives, authored compendium, replay targets, and
  typed local product events are implemented.
- Worker source includes run/session APIs, HMAC+CSRF capabilities, revisioned
  idempotent attempts, and bounded generated-gameplay selection.
- Public Pages builds keep online-required and Worker endpoints off until
  production readiness is externally established.

### Approved target

- Product truth infrastructure precedes and governs player-facing changes.
- Replace the UI with Svelte in one coordinated migration now.
- The first Svelte release preserves visual and behavioral parity; redesign and
  new target gameplay do not hide inside the framework migration.
- Cutover requires differential old/new parity across behavior, semantic DOM,
  visible copy, accessibility, screenshots, typed product events, and saves.
- Active play becomes online-required only after the production-readiness gate.

## Lifecycle vocabulary

Every capability and scenario uses one of:

1. `proposed`
2. `approved-target`
3. `implementing`
4. `playtest`
5. `production`
6. `retired`

## Hard product boundaries

- Implementation may proceed across approved targets, but no target behavior is
  `production` until its advancement gate passes.
- The product is entertainment, not curriculum or assessment.
- Historical claims require curated canonical content and verified sources.
- Generated graphs, screenshots, old references, and implementation comments
  are evidence, not product authority.
- Accessibility is a release gate, not a best-effort enhancement.
- Current behavior and approved target behavior must never be presented as the
  same fact.

## Open direction register

These are intentionally unresolved and must not be guessed by agents:

- monetisation model;
- final voice production method;
- production model/provider and hosting architecture;
- numerical feature thresholds before measured playtest baselines;
- the long-term breadth of open-ended sandbox play.

## Change protocol

For a player-facing capability change:

1. Update this document first when purpose, current truth, target direction, or
   qualitative acceptance changes.
2. Update the matching machine contract.
3. Run product-contract validation.
4. Regenerate the deterministic product graph.
5. Run known-answer context checks.
6. Change implementation and tests only after the contract is green.
