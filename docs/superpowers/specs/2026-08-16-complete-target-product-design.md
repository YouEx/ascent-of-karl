# Complete Target Product Build

**Approved:** 2026-08-16
**Status:** Implementing
**Authority:** `PRODUCT.md`

## 1. Scope

Implement every approved target capability:

- seeded viable starting elements, sidequests, and challenge sets;
- immutable archived lives;
- persistent authored-content compendium and replay targets;
- bounded generated gameplay that can advance authored progression;
- typed semantic product events and local event journal;
- online-required active-play architecture with read-only archives on outage;
- complete Svelte 5 UI replacement;
- differential old/new parity and atomic cutover.

The implementation may proceed before the external human playtest. Production
status still requires each capability's advancement gate.

## 2. Delivery boundary

This build changes source and may cut the shipped UI to Svelte after parity.
It does not claim production readiness for online-required gameplay without:

- a provisioned backend URL and secrets;
- production observability and quotas;
- privacy review;
- load/failure evidence;
- external product validation where the capability gate requires it.

Until those external conditions exist, online-required mode remains
environment-gated and production-off. The source implementation and outage
reader must nevertheless be complete and testable locally.

## 3. Domain model

### 3.1 Life plan

```ts
interface LifePlan {
  seedVersion: 1;
  seed: number;
  seedCode: string;
  contentRevision: string;
  openingId: string;
  startingElementIds: string[];
  sidequestIds: string[];
  challengeIds: string[];
}
```

The seed chooses only from exhaustively prevalidated plans. A plan must retain:

- at least one immediately usable recipe;
- solutions for every required need;
- a reachable age-up;
- at least one authored non-challenge ending within the turn limit;
- viable selected challenges and sidequests.

The full `LifePlan` is saved and never recomputed on resume.

### 3.2 Profile and lives

```ts
interface ProfileV2 {
  version: 2;
  activeLife: ActiveLife | null;
  archives: ArchivedLifeSummary[];
  compendium: Compendium;
}

interface ActiveLife {
  version: 1;
  lifeId: string;
  startedAt: string;
  plan: LifePlan;
  target: ReplayTarget | null;
  engine: GameStateV2;
  narrator: NarratorState;
  events: ProductEvent[];
}

interface ArchivedLife {
  version: 1;
  lifeId: string;
  startedAt: string;
  endedAt: string;
  outcome:
    | { kind: "ending"; endingId: string }
    | { kind: "abandoned" };
  plan: LifePlan;
  target: ReplayTarget | null;
  events: ProductEvent[];
  finalState: GameStateV2;
  historyCompleteness: "full" | "legacy-summary";
}
```

Archive insertion is immutable: use add semantics and reject duplicate life IDs.
Starting a new life archives an active life as abandoned instead of deleting it.

### 3.3 Authored completion

Completion keys are:

- `discovery:<canonical-id>`;
- `branch:<major-authored-branch-id>`;
- `ending:<authored-ending-id>`.

Base elements and inventions never enter the denominator. Authored branches or
endings reached through inventions do count.

The compendium exposes found, total, basis points, category counts, broad
unexplored areas, and replay targets without recipe spoilers.

## 4. Content contracts

Add:

- `content/life-variation.json`;
- `content/branches.json`;
- `content/invention-consequences.json`;
- `content/completion-manifest.json`;
- `content/migrations.json`.

`tools/validate.py` exhaustively verifies every admissible life-plan
cross-product and all content references.

Major branches use deterministic predicates only:

- canonical discovery;
- solved need;
- sidequest response;
- challenge result;
- flag;
- ending.

## 5. Bounded generated gameplay

The model never authors IDs, taxonomy, flags, solves, historical claims, branch
IDs, or ending IDs.

### 5.1 Proposal

The server derives at most four closed candidates from authoritative parent
elements. The model selects one:

```ts
interface ModelInventionProposalV1 {
  schemaVersion: 1;
  candidateKey: string;
  presentationKey: "plain" | "dry-pride" | "quiet-regret";
}
```

### 5.2 Deterministic validation

1. Validate request/session/revision/idempotency.
2. Resolve parents from authoritative run state.
3. Resolve canonical recipe first.
4. Enforce turn, invention, and depth limits.
5. Derive the closed candidate set.
6. Validate model output against that exact set.
7. Construct ID, taxonomy, depth, name, and flavor server-side.
8. Evaluate existing solve predicates.
9. Evaluate curated invention-consequence rules.
10. Commit outcome, effects, challenge state, attempt log, and revision
    atomically.

Infrastructure/model failure commits nothing and consumes no turn. A normal
deterministic rejection may consume the attempt according to the current rules.

## 6. Online-required runtime

### 6.1 Worker

Add one `RUNS` Durable Object per life while retaining the global coordinator for
model budgets and aggregate counters.

Target endpoints:

- `GET /api/v1/session`;
- `POST /api/v1/runs`;
- `GET /api/v1/runs/:runId`;
- `POST /api/v1/runs/:runId/attempts`;
- `DELETE /api/v1/runs/:runId`;
- `GET /healthz`.

Requests use attempt IDs and expected revisions. Retries are idempotent.

### 6.2 Browser

Active controls mount only after session readiness. Do not use
`navigator.onLine` as authority.

During outage:

- active play remains paused;
- new life, continue, and combine are unavailable;
- local active state is preserved;
- archived lives and compendium remain read-only;
- retry is explicit;
- no offline gameplay fallback silently changes the product.

The build retains an environment-gated local/offline compatibility mode for
tests and until production readiness is externally established.

## 7. Typed semantic product events

Define `ProductEventMap` for:

- `life.started`;
- `combination.attempted`;
- `discovery.canonical`;
- `invention.accepted`;
- `narrator.presented`;
- `need.updated`;
- `challenge.updated`;
- `chronicle.entry-recorded`;
- `compendium.progressed`;
- `fate.unlocked`;
- `life.archived`;
- `life.replay-started`;
- `platform.session-ready`.

Events have schema version, contiguous boot sequence, capability, scenario,
turn, and typed payload. They contain no random analytics session ID and no
automatic network transmission.

Emit synchronously to:

1. in-memory subscribers;
2. bounded fail-open local journal;
3. `window` `product:event` for parity tests.

## 8. Svelte UI architecture

Use Svelte 5 with Vite, not SvelteKit.

`src/ui/main.ts` becomes:

1. global CSS import;
2. controller creation;
3. `mount(App, { target, props })`;
4. readiness startup.

One `GameController` owns Engine, Narrator, persistence, session state, selected
elements, filters, overlays, Chronicle view state, narration queue,
improvisation coordination, and product-event publication.

Components consume immutable snapshots and invoke controller commands. They do
not instantiate the Engine, touch storage, fetch, choose narration, or mutate
saves.

### Semantic primitives

- `Action`;
- `IconButton`;
- `StoryEntry`;
- `CollectionEntry`;
- `StateNotice`;
- `OverlaySurface`;
- `Glyph`.

### Capability components

- `LifeStart`;
- `GameHeader`;
- `LivingChronicle`;
- `NarratorPage`;
- `OutcomePage`;
- `ChallengeBanner`;
- `ProblemPull`;
- `ElementTools`;
- `ElementGrid`;
- `CombineDock`;
- `ChronicleDrawer`;
- `Compendium`;
- `FateDialog`;
- `Replay`;
- `NetworkGate`.

Every capability root exposes `data-capability`. Meaningful state surfaces expose
`data-scenario` and `data-state`; interactions expose `data-action`. Native
semantic elements and ARIA remain authoritative.

Initial migration keeps global CSS and all judge/UX selector IDs/classes.

## 9. Parity and cutover

Keep a test-only legacy entry until Svelte parity passes. Both renderers receive
identical deterministic fixtures, storage, clock, seed, feature flags, and
network stubs.

Compare at each checkpoint:

- engine/narrator/profile state;
- ordered product events;
- save bytes and bidirectional loading;
- normalized DOM, roles, ARIA, IDs, classes, text, hidden/inert;
- focus, Escape, back, backdrop, touch;
- screenshots and existing judge metrics;
- requests, console errors, and page errors.

Cutover requires:

- all existing tests;
- product contracts/graph/context checks;
- exhaustive new domain tests;
- Svelte checks;
- differential parity;
- visual and UX gates;
- both Pages variants;
- existing bundle ceilings unless a separately measured and documented budget
  decision is approved.

The switch is atomic. No production hybrid renderer remains.

## 10. Security and privacy

- Generated gameplay uses server-owned parents and candidate sets.
- Raw IP, prompts, response bodies, run history, and player content are not
  logged.
- Edge overwrites internal identity/session headers.
- Request bodies and model time are bounded.
- Per-run, per-IP, and global quotas apply.
- Product telemetry remains local until a separate consent/hosting decision.
- Historical claims remain curated and sourced.

## 11. External production blockers

Source implementation may complete while these stay externally blocked:

- Worker deployment credentials/secrets;
- same-origin or secure capability deployment architecture;
- privacy approval;
- staging/load/failure evidence;
- external human playtest evidence;
- production observation window.

These blockers prevent `production` lifecycle status, not implementation.
