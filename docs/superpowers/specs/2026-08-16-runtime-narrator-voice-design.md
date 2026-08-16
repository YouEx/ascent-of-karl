# Runtime Narrator Commentary and Voice Design

**Status:** Approved for implementation
**Date:** 2026-08-16
**Product authority:** `PRODUCT.md`, capability `narrator.react`

## Goal

Give every Karl life a recognisable, run-specific narrator thread without
delaying gameplay, granting a model gameplay authority, or downloading models
to the player's device.

## Product behavior

Runtime commentary is an additional follow-up beat. It does not replace the
authored narrator's immediate humour, guidance, or story beat.

The source emits commentary only for significant moments:

1. life opening;
2. canonical discovery;
3. accepted invention;
4. challenge spawned, solved, or failed;
5. newly completed major branch;
6. ending.

One attempt produces at most one cue. Priority is ending, challenge, major
branch, invention, then discovery. Minor attempts retain the existing authored,
baked-pair, grammar, live-pair, and generic fallback paths.

Gameplay commits and renders before runtime commentary starts. If commentary,
TTS, or the network fails, the existing narrator remains complete and no loading
indicator or error enters the play flow.

## Provider decision

### Text

- Provider: OpenAI.
- Model: pinned `gpt-4.1-nano-2025-04-14`.
- Reason: official low-latency, no-reasoning model with streaming and strict
  structured output support; it reuses the Worker's existing OpenAI secret.
- Output: strict JSON `{ text, roles }`.
- Maximum text: 260 characters, one or two sentences.

### Speech

- Provider: Cartesia.
- Model: pinned `sonic-3.5-2026-05-04`.
- Voice: Archie, en-GB male,
  `ef191366-f52f-447a-a398-ed8c0f2943a1`.
- Endpoint: `POST https://api.cartesia.ai/tts/bytes`.
- Format: raw signed 16-bit little-endian PCM, 24 kHz, mono.
- Reason: official sub-90 ms model latency, stable British voice, and streamed
  byte response from complete short transcripts.

Browser-local inference is rejected for the first production design. It adds a
large first-use download, WebGPU/device variance, memory pressure, and a second
voice-model download. The hosted split pipeline adds no app startup payload.

## Architecture

### Authoritative cue creation

`worker/src/run-do.ts` derives cues from authoritative state. The browser never
authors cue type, entities, branch, challenge, ending, or prompt context.

Each cue contains:

- stable `eventId`;
- `kind`;
- turn;
- server-owned display context;
- required specificity terms.

The opening cue is created with the run. Attempt cues are derived by comparing
state before and after the committed transition.

### Run-local memory

The Run Durable Object retains every accepted commentary record without
eviction. The bound is 51 event IDs: one opening plus the 50-turn ceiling.

- cue;
- accepted text;
- semantic roles;
- normalized text hash.

The model receives the last eight accepted lines plus current run state. A line
whose normalized text duplicates a prior line is rejected. Repeating the same
`eventId` returns the same stored result and never calls the model twice.

No raw IP, capability, user identifier, or client-authored prose reaches the
model.

### Coordinator boundary

The Run object calls an internal Coordinator endpoint. The public edge strips
the internal marker from all client requests. The Coordinator:

- validates the exact server-only request schema;
- applies an independent rolling limit and daily global/per-IP budgets;
- calls OpenAI;
- validates strict output, length, specificity, voice policy, roles, and absence
  of historical claims;
- returns text only.

The model may write commentary. It cannot set identifiers, taxonomy, state,
progression, completion, history, branches, endings, or narrator memory.

### Browser flow

`SessionClient` requests commentary by `eventId`. The response is queued only
if it arrives within 2.5 seconds and the active life still matches the cue turn.

The client immediately starts an authenticated audio request. `audio.ts` reads
the streamed PCM response through Web Audio and schedules chunks without waiting
for the complete file. A new narrator beat cancels the old stream.

If provider audio fails, the exact runtime text uses the existing British
browser-TTS fallback. If no British browser voice exists, the beat is text-only.

### Persistence and evidence

Accepted commentary is persisted in the Run object. The browser emits the
existing `narrator.presented` event with a new `source` field:

- `authored`;
- `runtime-llm`.

The life journal therefore records the exact text and actual audio mode. Audio
bytes are not persisted or transmitted elsewhere.

## Failure behavior

- Commentary model unavailable: omit the follow-up beat.
- Commentary timeout: omit the follow-up beat.
- Invalid or duplicate text: omit the follow-up beat.
- Cartesia unavailable: use exact-text browser TTS.
- Browser TTS unavailable: show exact text only.
- Rate or daily limit reached: omit the follow-up beat until retry time.
- Missing provider secrets: health reports commentary/TTS unavailable, but
  active gameplay remains available when its existing requirements pass.

## Security and privacy

- `OPENAI_API_KEY` and `CARTESIA_API_KEY` are Worker secrets.
- Run capability plus CSRF protects commentary and audio routes.
- Audio endpoint ignores client text and synthesizes only stored accepted text.
- The edge removes all runtime-commentary internal headers.
- Prompt context is bounded server-owned gameplay state.
- Generated commentary cannot contain factual historical claims.
- Provider/model/voice snapshots are pinned.

## Observability

Store counters only, never prompt or generated text:

- requested;
- accepted;
- model rejected;
- duplicate rejected;
- model latency;
- audio requested;
- audio provider failure;
- browser fallback mode through product events.

Production promotion requires measured p50/p95 commentary latency, TTS
time-to-first-audio, voice-gate acceptance, duplicate rate, and playtest evidence
for humour, guidance, and story continuity.

## Validation

1. Unit tests for cue priority, exact schemas, prompt context, duplicate
   rejection, quotas, idempotency, and TTS request construction.
2. Worker tests proving public clients cannot forge internal context or audio
   text.
3. Audio tests proving streamed PCM starts incrementally, cancels cleanly, and
   falls back to exact-text browser TTS.
4. Browser test proving gameplay renders before commentary and provider failure
   is invisible.
5. Full content, product, Worker, Svelte, parity, UX, Pages, and narration
   audits.

## External gates

Source completion does not production-enable the feature. Deployment still
requires Cartesia credentials, Worker deployment, privacy approval,
observability, load/failure evidence, and external playtesting.
