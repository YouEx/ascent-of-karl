---
goal: Implement Product Truth, Deterministic Product Knowledge, and Agent Context Infrastructure
version: 1.0
date_created: 2026-08-16
last_updated: 2026-08-16
owner: Martin
status: 'Completed'
tags: [architecture, product, context, knowledge-graph, contracts]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Implement the approved pre-playtest truth infrastructure for The Ascent of
Karl. The implementation establishes human authority, validated machine
contracts, a deterministic directed product graph, a purpose-first agent
context compiler, and known-answer CI gates. It must not add Svelte or change
player-facing behavior.

## 1. Requirements & Constraints

- **REQ-001**: Create root `PRODUCT.md` as the current human authority for
  product purpose, twelve player capabilities, current truth, approved target,
  qualitative acceptance, lifecycle, hard boundaries, and open decisions.
- **REQ-002**: Store machine-readable capability and ambiguous-scenario
  contracts as versioned JSON validated by JSON Schema.
- **REQ-003**: Generate a compact directed graph from approved contracts,
  source imports, ownership hints, tests, and curated semantic relationships.
- **REQ-004**: Compile bounded purpose-first agent context from a natural
  language task or an explicit capability ID.
- **REQ-005**: Prove graph usefulness with versioned known-answer queries.
- **REQ-006**: Commit deterministic graph, metadata, manifests, and fixtures;
  ignore caches, logs, extraction chunks, and visualisations.
- **REQ-007**: Define typed semantic product events for local
  playtest/export use without enabling production telemetry.
- **REQ-008**: Keep current behavior and approved target explicitly separate
  in every capability and target scenario.
- **SEC-001**: Product graph outputs must contain no environment values,
  secrets, raw IPs, admin tokens, model keys, or local machine paths.
- **CON-001**: Do not add Svelte, change DOM/CSS, alter gameplay, enable
  improvisation in production, deploy the Worker, or transmit telemetry.
- **CON-002**: Respect `ROADMAP.md` item 2: no player-facing implementation
  before the external playtest.
- **CON-003**: Generated graph or Graphify enrichment must never override
  `PRODUCT.md` or validated contracts.
- **GUD-001**: Fail closed on contradictions and integrity failures; use
  ratchets for incomplete ownership coverage.
- **GUD-002**: Keep context packs purpose-first and bounded rather than
  dumping the entire graph.
- **PAT-001**: Follow existing deterministic tooling patterns:
  stable JSON, explicit schemas, committed generated artifacts, and tests that
  prove a gate can fail.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Establish product authority and validated contracts.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `PRODUCT.md` and `docs/superpowers/specs/2026-08-16-product-truth-knowledge-semantic-ui-design.md` with the approved decisions. | ✅ | 2026-08-16 |
| TASK-002 | Add JSON Schemas under `docs/product/schema/` for capabilities, scenarios, curated relations, and known-answer fixtures. | ✅ | 2026-08-16 |
| TASK-003 | Add `docs/product/capabilities.json`, `docs/product/scenarios.json`, and `docs/product/product-graph-relations.json`. | ✅ | 2026-08-16 |
| TASK-004 | Implement `tools/product-knowledge/schema.mjs` and `validate.mjs` with strict JSON Schema shape validation and cross-contract integrity checks. | ✅ | 2026-08-16 |

### Implementation Phase 2

- **GOAL-002**: Generate and verify the deterministic product graph.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Implement stable node/edge helpers and repository import scanning in `tools/product-knowledge/relations.mjs`. | ✅ | 2026-08-16 |
| TASK-006 | Implement `tools/product-knowledge/export.mjs` to generate `docs/product/generated/product-graph.json` and metadata, including `--check` drift mode. | ✅ | 2026-08-16 |
| TASK-007 | Add `.graphifyignore` and document optional semantic enrichment as non-authoritative manual output. | ✅ | 2026-08-16 |

### Implementation Phase 3

- **GOAL-003**: Deliver task-aware agent context and known-answer evidence.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Implement `tools/product-knowledge/context.mjs` with explicit capability and deterministic natural-language matching modes. | ✅ | 2026-08-16 |
| TASK-009 | Add `docs/product/context-known-answers.json` and implement `tools/product-knowledge/known-answers.mjs`. | ✅ | 2026-08-16 |
| TASK-010 | Generate and verify initial committed graph, metadata, and known-answer results. | ✅ | 2026-08-16 |

### Implementation Phase 4

- **GOAL-004**: Integrate gates, verify behavior safety, and ship.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Add package scripts, focused Vitest coverage, and the `npm run product:check` CI step. | ✅ | 2026-08-16 |
| TASK-012 | Run product gates, unit tests, typecheck, content validation, builds, and generated-artifact drift checks. | ✅ | 2026-08-16 |
| TASK-013 | Run blocker-only review, close its findings, update this plan to `Completed`, and prepare the verified commit. | ✅ | 2026-08-16 |

## 3. Alternatives

- **ALT-001**: Make Graphify output authoritative. Rejected because inferred
  edges and corpus drift cannot decide product intent.
- **ALT-002**: Store product truth only in prose. Rejected because agents and
  CI need validated IDs, relationships, lifecycle state, and known answers.
- **ALT-003**: Implement Svelte simultaneously. Rejected by the external
  playtest gate and because framework migration must have a stable truth model
  and differential parity contract first.

## 4. Dependencies

- **DEP-001**: Repository-local strict JSON Schema interpreter covering the
  draft-2020 keywords used by the committed schemas; no package install or
  network dependency.
- **DEP-002**: Existing Node.js 22 CI runtime for deterministic ESM tools.
- **DEP-003**: Existing Vitest test runner and repository content/source files.
- **DEP-004**: Optional local Graphify installation for manual semantic
  enrichment; deterministic product checks must not require it.

## 5. Files

- **FILE-001**: `PRODUCT.md` — human product authority.
- **FILE-002**: `docs/product/schema/*.schema.json` — machine contract schemas.
- **FILE-003**: `docs/product/capabilities.json` — product and capability
  contracts.
- **FILE-004**: `docs/product/scenarios.json` — ambiguous state contracts.
- **FILE-005**: `docs/product/product-graph-relations.json` — curated semantic
  edges.
- **FILE-006**: `docs/product/context-known-answers.json` — context acceptance
  fixtures.
- **FILE-007**: `docs/product/generated/product-graph.json` and metadata —
  committed deterministic outputs.
- **FILE-008**: `tools/product-knowledge/*.mjs` — validation, graph export,
  context compilation, and known-answer tools.
- **FILE-009**: `tests/product-*.test.ts` — focused contract and graph tests.
- **FILE-010**: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`,
  `.gitignore`, and `.graphifyignore` — integration and exclusions.

## 6. Testing

- **TEST-001**: Schema and cross-reference validation passes on committed
  contracts and fails on duplicate IDs, unknown dependencies, missing files,
  duplicate events, cycles, and stale authority anchors.
- **TEST-002**: Graph export is byte-deterministic and `--check` fails after a
  contract mutation.
- **TEST-003**: Graph integrity has no dangling edges, duplicate IDs, secret
  paths, or unreachable capabilities.
- **TEST-004**: Context compiler returns purpose-first bounded packs for
  explicit capability IDs and natural-language tasks.
- **TEST-005**: Known-answer queries require expected capabilities, nodes,
  source files, and concepts.
- **TEST-006**: Existing unit, content, typecheck, worker, build, and Pages
  artifact gates remain green.

## 7. Risks & Assumptions

- **RISK-001**: Product contracts duplicate prose and drift. Mitigation:
  authority-anchor checks and generated drift gates.
- **RISK-002**: Ownership hints become a manual file inventory. Mitigation:
  list stable entrypoints and derive imports/tests from source.
- **RISK-003**: Natural-language matching returns plausible but irrelevant
  context. Mitigation: explicit capability mode, deterministic scoring, and
  known-answer fixtures.
- **RISK-004**: Graphify scans generated media or vendor trees. Mitigation:
  committed `.graphifyignore` and manual, non-CI enrichment.
- **ASSUMPTION-001**: The approved decisions captured in `PRODUCT.md` supersede
  conflicting historical product statements but not their rationale.
- **ASSUMPTION-002**: Numerical feature thresholds remain intentionally absent
  until external playtest evidence establishes baselines.

## 8. Related Specifications / Further Reading

- [`PRODUCT.md`](../PRODUCT.md)
- [`docs/superpowers/specs/2026-08-16-product-truth-knowledge-semantic-ui-design.md`](../docs/superpowers/specs/2026-08-16-product-truth-knowledge-semantic-ui-design.md)
- [`PRD.md`](../PRD.md)
- [`ROADMAP.md`](../ROADMAP.md)
- [`DESIGN.md`](../DESIGN.md)
