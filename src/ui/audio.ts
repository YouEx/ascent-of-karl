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

let manifest: Record<string, number[]> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentSettle: (() => void) | null = null;
let pending: PendingPlayback | null = null;
let unlocked = false;

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

/** Stop igangværende recorded/synthesized audio (bruges ved mute/nyt beat). */
export function stopAudio(): void {
  stopCurrentPlayback();
}
