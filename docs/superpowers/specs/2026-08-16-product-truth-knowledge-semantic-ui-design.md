# Product Truth, Knowledge Graph, and Semantic UI Foundation

**Approved:** 2026-08-16
**Implementation boundary:** Truth infrastructure before external playtest;
Svelte and player-facing behavior after the gate.

## 1. Problem

Carl has strong but distributed product knowledge:

- `PRD.md` preserves historical and superseded decisions beside current ones;
- `ROADMAP.md` owns release sequencing and known exceptions;
- `DESIGN.md` owns visual meaning;
- content schemas and deterministic core own gameplay truth;
- tests encode important contracts that prose does not always name;
- visual references are evidence but are load-bearing art inputs, not current
  product authority.

Agents can therefore read a true sentence from the wrong authority, mistake an
approved target for shipped behavior, optimise a feature without knowing its
purpose, or preserve a stale reference because it looks machine-readable.

The foundation must answer, before implementation:

1. What is the app for?
2. What is each player-facing capability supposed to achieve?
3. What current behavior exists?
4. What target behavior is approved but unshipped?
5. What qualitative evidence means the capability works?
6. Which source, content, test, surface, event, and dependency owns it?

## 2. Authority model

Authority flows one way:

1. `PRODUCT.md` — current human product authority.
2. Versioned JSON capability/scenario contracts — validated machine
   representation of the approved authority.
3. Source/content/tests — implementation and evidence.
4. Deterministic product graph — generated relationship map.
5. Optional Graphify enrichment — separately marked inferred context.

Lower layers never override higher layers.

## 3. Product model

The product purpose, north star, hard boundaries, open decisions, current
architecture, target architecture, and twelve capability definitions live in
`PRODUCT.md`.

The product model deliberately separates:

- current truth from approved target;
- authored finite completion from unbounded inventions;
- a life Chronicle from the persistent compendium;
- qualitative acceptance now from numerical thresholds after measured
  playtests;
- historical canon from generated gameplay;
- cross-device capability from the global accessibility gate.

## 4. Contract model

### 4.1 Capability manifest

`docs/product/capabilities.json` contains:

- product-level anchors copied exactly from `PRODUCT.md`;
- lifecycle vocabulary;
- twelve durable player-facing capability records;
- current and target lifecycle state;
- advancement gate;
- dependencies;
- typed semantic events;
- ownership entrypoints and search terms.

Every capability requires:

`id`, `name`, `purpose`, `playerOutcome`, `currentTruth`, `approvedTarget`,
`qualitativeAcceptance`, `lifecycle`, `dependencies`, `semanticEvents`, and
`ownershipHints`.

### 4.2 Scenario manifest

`docs/product/scenarios.json` covers only states where actor, trigger,
destination, eligibility, or meaning materially changes. It is not an
exhaustive screenshot inventory.

Every scenario requires:

`id`, `capabilities`, `actor`, `trigger`, `playerJob`, `intendedOutcome`,
`primaryAction`, `currentBehavior`, `targetBehavior`, `adjacentScenarios`,
`semanticEvent`, and `evidenceSources`.

### 4.3 Curated relationships

`docs/product/product-graph-relations.json` holds only semantic edges that source
imports and contract references cannot prove, for example:

- inventions can unlock authored consequences;
- collection records story;
- accessibility gates every capability;
- the Svelte migration must preserve old/new parity.

## 5. Validation

Standard JSON Schemas validate shape through the repository-local strict schema
interpreter in `tools/product-knowledge/schema.mjs`. It implements the exact
JSON Schema keywords used by these contracts and has no network/install
dependency. Cross-contract validation additionally fails on:

- duplicate IDs;
- unknown capability/scenario dependencies;
- invalid lifecycle values or missing advancement gates;
- missing evidence/ownership files;
- ownership patterns that match nothing;
- duplicate semantic-event ownership;
- cyclic capability dependencies;
- product anchor text absent from `PRODUCT.md`;
- stale generated graph or metadata;
- dangling graph edges;
- a capability unreachable from the product root.

Coverage launches as ratchets rather than pretending the first mapping is
complete. Integrity and contradictions fail closed immediately.

## 6. Deterministic product graph

The graph exporter produces a compact directed graph from validated inputs.

### Node types

- product;
- principle;
- hard boundary;
- open decision;
- capability;
- scenario;
- lifecycle state;
- semantic event;
- source/content/test file.

### Edge types

- `serves`;
- `depends_on`;
- `gated_by`;
- `emits`;
- `implemented_by`;
- `specified_by`;
- `verified_by`;
- `transitions_to`;
- `imports`;
- curated semantic relationships.

Every edge records provenance as `CONTRACT`, `SOURCE`, or `CURATED`. Graphify
enrichment, when present, remains `INFERRED`/`AMBIGUOUS` and is never merged
silently into authoritative edges.

Committed outputs:

- `docs/product/generated/product-graph.json`;
- `docs/product/generated/product-graph.metadata.json`.

Caches, logs, extraction chunks, and HTML visualisations remain ignored.

## 7. Agent context compiler

`npm run product:context -- "<task or question>"` compiles a bounded,
purpose-first context pack.

Output order:

1. app purpose and north star;
2. matched capability purpose and player outcome;
3. qualitative acceptance;
4. current truth and approved target;
5. lifecycle and advancement gate;
6. relevant ambiguous scenarios;
7. semantic events;
8. owned source/content/tests;
9. dependencies and curated relationships;
10. hard boundaries and open decisions.

Task matching is deterministic token overlap against capability IDs, names,
aliases, purpose, outcomes, and search terms. Raw graph traversal expands the
matched capability neighborhood after ranking; it never dumps the full graph.

## 8. Known-answer gate

`docs/product/context-known-answers.json` versions 10–15 load-bearing questions.
Each fixture requires capability IDs, graph node IDs, source files, and product
concepts in the compiled context.

Initial questions cover:

- product purpose;
- completion definition;
- invention purpose and authority;
- narrator's three required dimensions;
- network-unavailable behavior;
- online production gate;
- generated-gameplay limits;
- seeded life variation;
- Svelte parity requirements;
- accessibility ownership.

The gate proves the graph can orient an agent, not merely that JSON is valid.

## 9. Semantic UI target

No Svelte code lands before the external playtest.

After the gate, the vanilla DOM UI is replaced in one coordinated Svelte
migration. The migration changes architecture and semantics first, not product
behavior or visual direction.

### Component model

Svelte uses semantic primitives plus capability-owned components:

- actions represent intent and consequence, not colour or size;
- story entries discriminate canonical discovery, invention, known result,
  blocked progress, and attempt;
- collection entries distinguish life Chronicle from persistent compendium;
- state notices distinguish blocking, retryable, informational, and terminal
  meaning;
- capability components compose primitives and own their state matrices.

Rendered output exposes stable:

- `data-capability`;
- `data-scenario`;
- `data-action`;
- `data-state`;
- typed product events.

### Cutover gate

Old and new UIs run against identical deterministic engine states. Cutover
requires parity in:

- gameplay behavior;
- visible text;
- semantic markup;
- accessibility;
- screenshots;
- typed product events;
- saved-state compatibility.

## 10. Telemetry boundary

Typed product events are defined and tested now. Before hosting and consent are
approved, they remain local playtest/export evidence. Network transmission is
off.

## 11. Implementation sequence

1. Write `PRODUCT.md`.
2. Add schemas and manifests.
3. Add fail-closed validation and ratchets.
4. Build deterministic graph and metadata.
5. Build task-aware context compiler.
6. Add known-answer queries.
7. Wire deterministic checks into CI.
8. Run external playtest.
9. Plan and execute parity-first Svelte replacement.

## 12. Non-goals for this implementation

- no Svelte dependency;
- no DOM or CSS change;
- no gameplay behavior change;
- no production telemetry;
- no online-required release;
- no expanded model authority;
- no graph-generated rewrite of human product authority.
