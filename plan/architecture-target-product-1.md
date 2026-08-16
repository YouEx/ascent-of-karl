---
goal: Build the Complete Approved Target Product
version: 1.0
date_created: 2026-08-16
last_updated: 2026-08-16
owner: Martin
status: 'In progress'
tags: [architecture, svelte, gameplay, backend, persistence, migration]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

Implement every approved target capability in dependency order: domain model,
generated gameplay, online runtime, semantic events, Svelte UI, differential
parity, and atomic cutover. External production credentials/evidence remain
separate operational gates.

## 1. Requirements & Constraints

- **REQ-001**: Implement deterministic seeded viable life plans with randomized
  starting elements, sidequests, and challenge pools.
- **REQ-002**: Implement immutable life archives and a persistent compendium for
  canonical discoveries, major branches, and endings.
- **REQ-003**: Exclude inventions from the completion denominator while counting
  authored consequences unlocked through inventions.
- **REQ-004**: Implement typed bounded generated gameplay chosen from
  server-derived candidates and validated deterministically.
- **REQ-005**: Implement online session/run APIs and honest read-only archives
  during backend outage.
- **REQ-006**: Implement typed semantic product events and local-only journal.
- **REQ-007**: Replace the vanilla UI with Svelte 5 in one atomic parity-first
  migration.
- **REQ-008**: Preserve current visual design, behavior, selectors, feature
  flags, save compatibility, and Pages contracts during Svelte cutover.
- **REQ-009**: Implement an old-vs-Svelte differential harness for state, events,
  saves, DOM, copy, accessibility, screenshots, and network behavior.
- **REQ-010**: Keep every target out of `production` lifecycle until its
  advancement gate passes.
- **SEC-001**: Models cannot author identifiers, taxonomy, progression effects,
  completion effects, historical claims, branches, or endings.
- **SEC-002**: Worker requests are bounded, idempotent, revision-checked, and
  quota-protected; infrastructure failures commit nothing.
- **SEC-003**: Product events and archives never transmit automatically.
- **CON-001**: Use Svelte with Vite, not SvelteKit, router, state library, or CSS
  framework.
- **CON-002**: Keep `src/ui/style.css`, `tokens.css`, and `tuning.css` visually
  unchanged until differential parity passes.
- **CON-003**: Production online enable remains blocked on credentials,
  observability, privacy, load/failure evidence, and external validation.
- **GUD-001**: One controller owns mutable runtime state; components receive
  immutable views and callback commands.
- **GUD-002**: Core modules remain DOM/network/storage independent.
- **PAT-001**: Use typed discriminated unions, deterministic transitions,
  explicit migration steps, and mutation-proven fail-closed tests.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Update authority, contracts, dependencies, and baseline evidence.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Lift the pre-playtest implementation freeze in `PRODUCT.md`, `ROADMAP.md`, `CLAUDE.md`, and capability lifecycle contracts while retaining production gates. | ✅ | 2026-08-16 |
| TASK-002 | Add this design and plan; regenerate product graph and known-answer context. | ✅ | 2026-08-16 |
| TASK-003 | Install pinned Svelte 5/Vite-plugin/svelte-check dependencies and add Svelte compiler configuration without changing the production entry. | ✅ | 2026-08-16 |
| TASK-004 | Capture current DOM/storage/events/visual/bundle baselines for differential comparison. | ✅ | 2026-08-16 |

### Implementation Phase 2

- **GOAL-002**: Build seeded lives, archives, compendium, and save migration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Add `content/life-variation.json`, `branches.json`, `completion-manifest.json`, and `migrations.json`; validate every reference and admissible plan. | ✅ | 2026-08-16 |
| TASK-006 | Implement `src/core/seed.ts`, `viability.ts`, `branches.ts`, `compendium.ts`, `chronicle.ts`, `life.ts`, and `replay.ts`. | ✅ | 2026-08-16 |
| TASK-007 | Extend `GameState`, challenge/decision ordering, and `ContentBundle` for LifePlan, branches, sidequests, and authored consequences. | ✅ | 2026-08-16 |
| TASK-008 | Implement ProfileV2, IndexedDB profile/archive stores, immutable archive finalization, and idempotent V1 migration. | ✅ | 2026-08-16 |
| TASK-009 | Extend run summaries and selectors for life ID, seed, branches, authored unlocks, completion, and replay targets. | ✅ | 2026-08-16 |

### Implementation Phase 3

- **GOAL-003**: Build semantic events and bounded generated gameplay.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Add event and semantic-UI JSON schemas/contracts plus generated TypeScript IDs/payloads. | ✅ | 2026-08-16 |
| TASK-011 | Implement synchronous typed event bus, bounded local journal, window bridge, and deterministic event order. | ✅ | 2026-08-16 |
| TASK-012 | Implement closed candidate derivation, typed proposal validation, deterministic construction, and curated generated effects. | ✅ | 2026-08-16 |
| TASK-013 | Integrate generated outcomes with needs, challenges, branches, endings, Chronicle, compendium, and save/profile state. | ✅ | 2026-08-16 |

### Implementation Phase 4

- **GOAL-004**: Build online-required runtime source and outage reader.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Add Worker run/session/auth/generated-model modules and one RUNS Durable Object per life. | ✅ | 2026-08-16 |
| TASK-015 | Implement session, run, attempt, snapshot, delete, and health endpoints with idempotency/revision/quota/security gates. | ✅ | 2026-08-16 |
| TASK-016 | Implement browser session client, active-play gate, retry reconciliation, and environment-gated local compatibility mode. | ✅ | 2026-08-16 |
| TASK-017 | Implement read-only Chronicle/compendium access while active play is unavailable. | ✅ | 2026-08-16 |

### Implementation Phase 5

- **GOAL-005**: Build the complete Svelte UI against one controller.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Keep `src/ui/main.ts` as the single controller module while extracting persistence, session, event, life, generated-gameplay, Chronicle, and replay services; remove its ownership of the static DOM shell. | ✅ | 2026-08-16 |
| TASK-019 | Build semantic Svelte primitives with stable IDs/classes/ARIA/data attributes and no scoped visual drift. | ✅ | 2026-08-16 |
| TASK-020 | Port title, game header, Chronicle, narrator/outcome, needs/challenges, tools/grid/dock, archive/compendium, overlays, ending/replay, and network gate. | ✅ | 2026-08-16 |
| TASK-021 | Convert source-text UI tests to rendered behavior tests while retaining CSS and selector contract assertions. | ✅ | 2026-08-16 |

### Implementation Phase 6

- **GOAL-006**: Prove parity and atomically cut over.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | Add test-only legacy/Svelte entries, deterministic parity fixtures, normalizers, and comparators. | ✅ | 2026-08-16 |
| TASK-023 | Close state/event/save/DOM/copy/accessibility/network differences across all product scenarios and representative viewports. | ✅ | 2026-08-16 |
| TASK-024 | Close screenshot/judge/layout differences and satisfy the measured Svelte architecture budget. | ✅ | 2026-08-16 |
| TASK-025 | Switch production entry to Svelte, remove legacy shell ownership from the entry, and retain rollback evidence. | ✅ | 2026-08-16 |

### Implementation Phase 7

- **GOAL-007**: Complete source verification and ship.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Run full unit, Python, Svelte, Worker, content, product, parity, visual, UX, build, Pages, and live-deploy gates. | ✅ | 2026-08-16 |
| TASK-027 | Run spec and blocker-only implementation review; close every finding within the fixed review budget. | ✅ | 2026-08-16 |
| TASK-028 | Commit, push, verify exact-head CI/deploy/live artifacts, and record external production blockers separately. | | |

## 3. Alternatives

- **ALT-001**: Incremental hybrid Svelte migration. Rejected by the approved
  big-bang cutover and risk of two permanent render systems.
- **ALT-002**: Let the model emit gameplay taxonomy/effects directly. Rejected
  because deterministic truth and historical safety would be impossible.
- **ALT-003**: Keep local fallback during online outage. Rejected because it
  silently substitutes a materially different product.

## 4. Dependencies

- **DEP-001**: `svelte@5.56.8`.
- **DEP-002**: `@sveltejs/vite-plugin-svelte@6.2.4` for Vite 6 compatibility.
- **DEP-003**: `svelte-check@4.7.5`.
- **DEP-004**: Existing TypeScript, Vite, Vitest, Playwright, Worker, and
  Cloudflare Durable Object infrastructure.
- **DEP-005**: Production credentials, provider, deployment architecture,
  privacy approval, and external evidence for final online enable.

## 5. Files

- **FILE-001**: `src/core/{seed,viability,life,chronicle,branches,compendium,replay}.ts`.
- **FILE-002**: `src/persistence/{profile-store,indexeddb-profile-store}.ts`.
- **FILE-003**: `src/product/{events,semantic,session}.ts` and generated IDs.
- **FILE-004**: `content/{life-variation,branches,invention-consequences,completion-manifest,migrations}.json`.
- **FILE-005**: `worker/src/{run-do,run-auth,generated-model}.ts` plus routing/config.
- **FILE-006**: `src/ui/app/*`, `src/ui/App.svelte`, and semantic/capability Svelte components.
- **FILE-007**: `tools/parity/*`, parity fixtures, and rendered Svelte tests.
- **FILE-008**: Product contracts, schemas, graph, docs, package/config, bundle budgets, CI, and deployment docs.

## 6. Testing

- **TEST-001**: Exhaustive life-plan viability, deterministic seed vectors, and order independence.
- **TEST-002**: Archive immutability, V1 migration, compendium denominator, and replay target safety.
- **TEST-003**: Adversarial generated proposals cannot author IDs/taxonomy/effects/history; canonical-first and atomicity hold.
- **TEST-004**: Worker auth, CSRF/capability, idempotency, revisions, concurrency, quotas, timeout, and storage failures.
- **TEST-005**: Typed event payloads/order, local journal bound, no automatic transmission, and semantic DOM contracts.
- **TEST-006**: Differential old/Svelte state, save, DOM, copy, accessibility, event, network, and screenshot parity.
- **TEST-007**: Existing content, visual judge, UX, Pages, bundle, Worker, and live-deploy gates remain green.

## 7. Risks & Assumptions

- **RISK-001**: Svelte runtime exceeds existing bundle budgets. Mitigation:
  delete legacy renderers, preserve global CSS, lazy-load archives/modals, and
  fail rather than silently raise ceilings.
- **RISK-002**: Life variation creates unwinnable runs. Mitigation: exhaustive
  finite-plan validation and saved complete LifePlan.
- **RISK-003**: Generated gameplay corrupts authored truth. Mitigation: closed
  candidate sets and deterministic consequence rules.
- **RISK-004**: Online-required architecture cannot deploy same-origin on current
  GitHub Pages. Mitigation: complete source behind environment gates and retain
  production status as externally blocked.
- **ASSUMPTION-001**: Martin's 2026-08-16 instruction supersedes the earlier
  implementation freeze but not production readiness gates.
- **ASSUMPTION-002**: Initial Svelte cutover preserves the current visual world;
  redesign follows only after parity.

## 8. Related Specifications / Further Reading

- [`PRODUCT.md`](../PRODUCT.md)
- [`docs/superpowers/specs/2026-08-16-complete-target-product-design.md`](../docs/superpowers/specs/2026-08-16-complete-target-product-design.md)
- [`docs/superpowers/specs/2026-08-16-product-truth-knowledge-semantic-ui-design.md`](../docs/superpowers/specs/2026-08-16-product-truth-knowledge-semantic-ui-design.md)
- [`DESIGN.md`](../DESIGN.md)
- [`ROADMAP.md`](../ROADMAP.md)
