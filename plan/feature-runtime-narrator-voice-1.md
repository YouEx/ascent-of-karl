---
goal: Build Run-Specific Runtime Narrator Commentary and Streaming Voice
version: 1.0
date_created: 2026-08-16
last_updated: 2026-08-16
owner: Martin
status: 'Complete'
tags: [feature, narrator, llm, tts, worker, audio]
---

# Introduction

![Status: Complete](https://img.shields.io/badge/status-Complete-brightgreen)

Implement hosted run-specific narrator commentary with a pinned low-latency
OpenAI text model and pinned Cartesia British voice. Preserve immediate authored
beats, deterministic gameplay, local evidence, and fail-silent fallback.

## 1. Requirements & Constraints

- **REQ-001**: Generate one run-specific follow-up line for each significant
  opening, discovery, invention, challenge, major branch, or ending cue.
- **REQ-002**: Gameplay must commit and render before commentary generation.
- **REQ-003**: Repeating an event ID must return the same stored commentary.
- **REQ-004**: Runtime commentary must use the last eight accepted run-local
  lines and bounded authoritative state.
- **REQ-005**: Stream provider audio as 24 kHz signed 16-bit mono PCM and fall
  back to exact-text British browser TTS.
- **SEC-001**: Only Run Durable Objects may construct model prompt context.
- **SEC-002**: The model cannot author gameplay state, IDs, history, progression,
  branches, endings, or completion.
- **SEC-003**: The audio route synthesizes stored accepted text only.
- **SEC-004**: Edge routing strips all internal commentary markers.
- **SEC-005**: Runtime commentary has independent rolling and daily quotas.
- **CON-001**: Use `gpt-4.1-nano-2025-04-14`.
- **CON-002**: Use `sonic-3.5-2026-05-04` with Cartesia Archie voice
  `ef191366-f52f-447a-a398-ed8c0f2943a1`.
- **CON-003**: Do not add browser-local model weights or startup downloads.
- **CON-004**: Public Pages builds keep runtime commentary disabled.
- **GUD-001**: Runtime commentary is an additive narrator beat, never a
  replacement for authored guidance.
- **PAT-001**: Write failing behavior tests before implementation.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Update authority, contracts, and executable design.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `PRODUCT.md`, `docs/product/capabilities.json`, `docs/product/events.json`, and generated contracts with runtime commentary current/target truth and event source. | ✅ | 2026-08-16 |
| TASK-002 | Add `docs/superpowers/specs/2026-08-16-runtime-narrator-voice-design.md` and this plan; regenerate the product graph. | ✅ | 2026-08-16 |

### Implementation Phase 2

- GOAL-002: Implement authoritative cues and run-local commentary memory.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | Add `src/product/runtime-commentary.ts` types and pure cue selection helpers. | ✅ | 2026-08-16 |
| TASK-004 | Extend `worker/src/run-do.ts` stored state, initialization, attempt responses, cue derivation, idempotent commentary records, and commentary/audio routes. | ✅ | 2026-08-16 |
| TASK-005 | Add unit tests for cue priority, idempotency, bounded memory, duplicate rejection, and authoritative context. | ✅ | 2026-08-16 |

### Implementation Phase 3

- GOAL-003: Implement model generation, validation, and quotas.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Add `worker/src/runtime-commentary-validate.ts`, `runtime-commentary-model.ts`, and `runtime-commentary.ts` with exact schemas, voice gate, specificity checks, and pinned model. | ✅ | 2026-08-16 |
| TASK-007 | Add internal Coordinator routing, independent rolling/global/per-IP quotas, and cleanup. | ✅ | 2026-08-16 |
| TASK-008 | Strip the internal marker at `worker/src/index.ts` and expose capability-protected public commentary routes only. | ✅ | 2026-08-16 |

### Implementation Phase 4

- GOAL-004: Implement streaming Cartesia speech and browser playback.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Add `worker/src/runtime-tts.ts` with pinned Cartesia model, voice, exact request body, and streamed PCM response. | ✅ | 2026-08-16 |
| TASK-010 | Extend `src/ui/session-client.ts` with commentary JSON and authenticated audio stream methods. | ✅ | 2026-08-16 |
| TASK-011 | Extend `src/ui/audio.ts` with cancellable incremental PCM playback and exact-text browser-TTS fallback. | ✅ | 2026-08-16 |
| TASK-012 | Integrate cue requests and stale-response guards in `src/ui/main.ts`; emit runtime source in `narrator.presented`. | ✅ | 2026-08-16 |

### Implementation Phase 5

- GOAL-005: Close deployment, observability, and release gates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Update `worker/wrangler.toml`, health/session capability fields, CORS audio headers, and `docs/deployment/live-narrator.md`; no new browser build variable is required because the layer follows the existing online-runtime gate. | ✅ | 2026-08-16 |
| TASK-014 | Add Worker, client, audio, browser, product-contract, and security tests; wire any browser-only gate into CI. | ✅ | 2026-08-16 |
| TASK-015 | Run full unit, product, content, Svelte, Worker dry-run, Pages, parity, narration, UX, outage, and visual-layout gates. | ✅ | 2026-08-16 |
| TASK-016 | Run one blocker-only review, close findings, commit, push, and verify exact-head CI/deploy/live artifacts. | ✅ | 2026-08-16 |

## 3. Alternatives

- **ALT-001**: Browser-local WebGPU LLM and TTS. Rejected because model weights,
  first-use loading, memory, and device support contradict the loading goal.
- **ALT-002**: OpenAI text and OpenAI TTS. Simpler secret management, but no
  generally available pinned custom British narrator voice and slower voice
  specialization than Cartesia.
- **ALT-003**: Replace authored narrator beats with runtime output. Rejected
  because network/model failure would weaken humour, guidance, and story.

## 4. Dependencies

- **DEP-001**: Existing Cloudflare Worker, Coordinator, Run Durable Objects,
  run capabilities, and OpenAI secret.
- **DEP-002**: OpenAI Chat Completions structured output for
  `gpt-4.1-nano-2025-04-14`.
- **DEP-003**: Cartesia `POST /tts/bytes`, model
  `sonic-3.5-2026-05-04`, and Archie en-GB voice.
- **DEP-004**: Browser Web Audio API and existing speech-synthesis fallback.

## 5. Files

- **FILE-001**: `src/product/runtime-commentary.ts`.
- **FILE-002**: `worker/src/runtime-commentary*.ts` and
  `worker/src/runtime-tts.ts`.
- **FILE-003**: `worker/src/run-do.ts`, `coordinator-do.ts`, `index.ts`, and
  `wrangler.toml`.
- **FILE-004**: `src/ui/session-client.ts`, `audio.ts`, and `main.ts`.
- **FILE-005**: Product authority, contracts, deployment docs, tests, CI, and
  product graph artifacts.

## 6. Testing

- **TEST-001**: Cue priority and server-owned context are deterministic.
- **TEST-002**: Commentary event IDs are idempotent and memory is bounded.
- **TEST-003**: Invalid, duplicate, historical, or off-voice output is rejected.
- **TEST-004**: Public clients cannot forge internal prompt context or audio
  text.
- **TEST-005**: Cartesia request uses pinned model/voice and streams PCM.
- **TEST-006**: Browser PCM playback starts incrementally, cancels, and falls
  back to exact text.
- **TEST-007**: Commentary never delays gameplay and stale responses are
  discarded.
- **TEST-008**: Existing authored narration, parity, Pages, and outage behavior
  remain green.

## 7. Risks & Assumptions

- **RISK-001**: Runtime commentary becomes repetitive. Mitigate with recent-line
  context, normalized duplicate rejection, and measured eval fixtures.
- **RISK-002**: Dynamic beats make the narrator verbose. Mitigate with
  significant-cue priority and one cue per attempt.
- **RISK-003**: TTS latency exceeds text latency. Mitigate with streamed PCM and
  immediate browser-TTS fallback.
- **RISK-004**: Provider drift changes voice. Mitigate with pinned model and
  voice IDs.
- **ASSUMPTION-001**: Hosted inference is approved by the user's “build it”
  instruction after the recommended architecture was presented.
- **ASSUMPTION-002**: Provider credentials and production enable remain external
  operational gates; source completion does not fabricate them.

## 8. Related Specifications / Further Reading

- [`../docs/superpowers/specs/2026-08-16-runtime-narrator-voice-design.md`](../docs/superpowers/specs/2026-08-16-runtime-narrator-voice-design.md)
- [OpenAI GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano)
- [Cartesia Sonic 3.5](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest)
- [Cartesia TTS bytes API](https://docs.cartesia.ai/api-reference/tts/bytes)
