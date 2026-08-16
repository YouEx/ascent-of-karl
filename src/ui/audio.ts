import type { SpokenLine } from "../narrator/narrator";

/**
 * Fortæller-audio (PRD §4.3): replik-id + variant → lydfil, med browser-TTS
 * som eksakt fallback for dynamiske eller endnu ikke indtalte replikker.
 *
 * Hver synlig replik får dermed én af fire eksplicitte tilstande. En ny
 * replik stopper ALTID den gamle afspilning, også når den nye ikke findes i
 * manifestet. Det er selve tekst/lyd-paritetskontrakten.
 */

export type NarrationPlaybackMode =
  | "recorded"
  | "synthesized"
  | "text-only"
  | "muted";

export interface NarrationPlayback {
  mode: NarrationPlaybackMode;
  done: Promise<void>;
}

interface PendingPlayback {
  start: () => void;
  settle: () => void;
}

interface RuntimePcmPlayback {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  sources: Set<AudioBufferSourceNode>;
  cancelled: boolean;
  settle: () => void;
}

let manifest: Record<string, number[]> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentSettle: (() => void) | null = null;
let pending: PendingPlayback | null = null;
let unlocked = false;
let runtimeAudioContext: AudioContext | null = null;
let currentRuntimePlayback: RuntimePcmPlayback | null = null;

function resolved(mode: NarrationPlaybackMode): NarrationPlayback {
  return { mode, done: Promise.resolve() };
}

function synthesis(): SpeechSynthesis | undefined {
  if (typeof speechSynthesis !== "undefined") return speechSynthesis;
  if (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined"
  ) {
    return window.speechSynthesis;
  }
  return undefined;
}

function settleCurrent(): void {
  const settle = currentSettle;
  currentSettle = null;
  currentAudio = null;
  currentUtterance = null;
  settle?.();
}

/**
 * Stop uden overlap. Det gamle 150 ms fade lod den forrige sætning fortsætte
 * under begyndelsen af den nye, hvilket er præcis den parity-fejl modulet skal
 * forhindre.
 */
function stopCurrentPlayback(): void {
  const runtime = currentRuntimePlayback;
  currentRuntimePlayback = null;
  if (runtime) {
    runtime.cancelled = true;
    void runtime.reader?.cancel().catch(() => undefined);
    for (const source of runtime.sources) {
      try {
        source.stop();
      } catch {
        // A source that already ended needs no further action.
      }
    }
    runtime.sources.clear();
    runtime.settle();
  }

  pending?.settle();
  pending = null;

  if (currentAudio) {
    currentAudio.pause();
    try {
      currentAudio.currentTime = 0;
    } catch {
      // Safari kan afvise currentTime før metadata; pause er nok.
    }

  }
  synthesis()?.cancel();
  settleCurrent();
}

function getRuntimeAudioContext(): AudioContext | null {
  if (runtimeAudioContext) return runtimeAudioContext;
  const Context = globalThis.AudioContext;
  if (typeof Context !== "function") return null;
  try {
    runtimeAudioContext = new Context();
    return runtimeAudioContext;
  } catch {
    return null;
  }
}

/**
 * @param unlockedByGesture Sæt når spillet startes fra et klik (titelskærmen) —
 * så er browserens autoplay-politik allerede opfyldt.
 */
export async function initAudio(unlockedByGesture = false): Promise<void> {
  unlocked = unlocked || unlockedByGesture;
  try {
    const resp = await fetch("audio/manifest.json");
    manifest = resp.ok
      ? ((await resp.json()) as Record<string, number[]>)
      : null;
  } catch {
    manifest = null;
  }

  const unlock = () => {
    unlocked = true;
    const queued = pending;
    pending = null;
    queued?.start();
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function recordedPlayback(line: SpokenLine): NarrationPlayback {
  let settled = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const settle = () => {
    if (settled) return;
    settled = true;
    if (currentAudio === audio) {
      currentAudio = null;
      currentSettle = null;
    }
    resolveDone();
  };
  const url = `audio/${line.id}.v${line.variant}.mp3`;
  const audio = new Audio(url);
  currentAudio = audio;
  currentSettle = settle;
  audio.addEventListener("ended", settle, { once: true });
  audio.addEventListener("error", settle, { once: true });

  const start = () => {
    void audio.play().catch(() => {
      // Afspilning kan stadig blive afvist af browseren. Behold den som
      // pending til næste fysiske handling frem for at lade køen løbe forbi.
      if (!settled && currentAudio === audio) {
        pending = { start, settle };
      }
    });
  };

  if (unlocked) start();
  else pending = { start, settle };

  return { mode: "recorded", done };
}

function selectBritishVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const british = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("en-gb"),
  );
  return (
    british.find((voice) =>
      /daniel|thomas|google uk english male/i.test(voice.name),
    ) ?? british[0]
  );
}

/**
 * `getVoices()` er asynkron i Chrome: første kald returnerer en TOM liste,
 * indtil browseren fyrer `voiceschanged`. Sætter man da `utterance.voice =
 * null`, taler systemets STANDARDstemme — på en dansk Mac altså Karls
 * engelske replik med dansk stemme. Derfor to regler:
 *
 *  1. Stemmelisten cachees, så snart den findes, og vi lytter efter
 *     `voiceschanged` i stedet for at spørge én gang og opgive.
 *  2. Findes ingen britisk stemme, TIER spillet (text-only) i stedet for at
 *     tale i en tilfældig stemme. En manglende stemme er ærlig; en forkert
 *     stemme er en fortællerfejl. Introen er indspillet, så det koster ikke
 *     åbningen noget, at listen typisk først er varm efter første beat.
 */
let cachedVoice: SpeechSynthesisVoice | null = null;
let listeningForVoices = false;

function listenForVoices(synth: SpeechSynthesis): void {
  if (listeningForVoices) return;
  listeningForVoices = true;
  const refresh = () => {
    cachedVoice = selectBritishVoice(synth.getVoices?.() ?? []) ?? null;
  };
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", refresh);
  } else {
    synth.onvoiceschanged = refresh;
  }
}

function britishVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  if (cachedVoice) return cachedVoice;
  listenForVoices(synth);
  cachedVoice = selectBritishVoice(synth.getVoices?.() ?? []) ?? null;
  return cachedVoice ?? undefined;
}

function synthesizedPlayback(line: SpokenLine): NarrationPlayback | undefined {
  const synth = synthesis();
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    return undefined;
  }

  const voice = britishVoice(synth);
  if (!voice) return undefined;

  let settled = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const settle = () => {
    if (settled) return;
    settled = true;
    if (currentUtterance === utterance) {
      currentUtterance = null;
      currentSettle = null;
    }
    resolveDone();
  };

  const utterance = new SpeechSynthesisUtterance(line.text);
  utterance.lang = "en-GB";
  utterance.voice = voice;
  utterance.rate = 0.95;
  utterance.pitch = 0.96;
  utterance.onend = settle;
  utterance.onerror = settle;
  currentUtterance = utterance;
  currentSettle = settle;

  const start = () => synth.speak(utterance);
  if (unlocked) start();
  else pending = { start, settle };

  return { mode: "synthesized", done };
}

/**
 * Afspil replikkens lyd og returnér et completion-signal til beat-køen.
 * Mangler en præindspillet fil, siges den EKSAKTE synlige tekst med lokal
 * browser-TTS. Findes heller ikke det, går spillet ærligt text-only.
 */
export function playLine(
  line: SpokenLine,
  muted: boolean,
): NarrationPlayback {
  stopCurrentPlayback();
  if (muted) return resolved("muted");

  if (manifest?.[line.id]?.includes(line.variant)) {
    return recordedPlayback(line);
  }

  return synthesizedPlayback(line) ?? resolved("text-only");
}

function pcmSamples(
  chunk: Uint8Array,
  remainder: number | null,
): { samples: Float32Array; remainder: number | null } {
  const bytes =
    remainder === null
      ? chunk
      : new Uint8Array([remainder, ...chunk]);
  const completeLength = bytes.length - (bytes.length % 2);
  const samples = new Float32Array(completeLength / 2);
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    completeLength,
  );
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return {
    samples,
    remainder:
      completeLength < bytes.length ? bytes[bytes.length - 1]! : null,
  };
}

/**
 * Plays Cartesia's authenticated raw PCM response incrementally. The line is
 * already visible and accepted before this runs; provider failure therefore
 * falls back to the same exact browser-TTS/text behavior as any other dynamic
 * narrator line.
 */
export function playRuntimeLine(
  line: SpokenLine,
  response: Response,
  muted: boolean,
): NarrationPlayback {
  stopCurrentPlayback();
  if (muted) return resolved("muted");
  if (!response.ok || !response.body) {
    return synthesizedPlayback(line) ?? resolved("text-only");
  }
  const context = getRuntimeAudioContext();
  const sampleRate = Number(
    response.headers.get("x-audio-sample-rate") ?? "24000",
  );
  if (
    !context ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 48000
  ) {
    return synthesizedPlayback(line) ?? resolved("text-only");
  }

  let settled = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const state: RuntimePcmPlayback = {
    reader: response.body.getReader(),
    sources: new Set(),
    cancelled: false,
    settle() {
      if (settled) return;
      settled = true;
      if (currentRuntimePlayback === state) {
        currentRuntimePlayback = null;
      }
      resolveDone();
    },
  };
  currentRuntimePlayback = state;

  void (async () => {
    try {
      await context.resume();
      let nextStart = context.currentTime + 0.03;
      let remainder: number | null = null;
      let streamEnded = false;
      const finishIfDone = () => {
        if (
          streamEnded &&
          state.sources.size === 0 &&
          !state.cancelled
        ) {
          state.settle();
        }
      };
      while (!state.cancelled) {
        const result = await state.reader!.read();
        if (result.done) {
          streamEnded = true;
          finishIfDone();
          break;
        }
        const converted = pcmSamples(result.value, remainder);
        remainder = converted.remainder;
        if (converted.samples.length === 0) continue;
        const buffer = context.createBuffer(
          1,
          converted.samples.length,
          sampleRate,
        );
        buffer.getChannelData(0).set(converted.samples);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        state.sources.add(source);
        source.onended = () => {
          state.sources.delete(source);
          finishIfDone();
        };
        source.start(nextStart);
        nextStart += converted.samples.length / sampleRate;
      }
    } catch {
      if (state.cancelled) return;
      void state.reader?.cancel().catch(() => undefined);
      state.reader = null;
      for (const source of state.sources) {
        try {
          source.stop();
        } catch {
          // A source that already ended needs no further action.
        }
      }
      state.sources.clear();
      currentRuntimePlayback = null;
      const fallback =
        synthesizedPlayback(line) ?? resolved("text-only");
      void fallback.done.then(state.settle);
    }
  })();

  return { mode: "synthesized", done };
}

/** Stop igangværende recorded/synthesized audio (bruges ved mute/nyt beat). */
export function stopAudio(): void {
  stopCurrentPlayback();
}
