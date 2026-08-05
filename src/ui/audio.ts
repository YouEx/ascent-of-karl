import type { SpokenLine } from "../narrator/narrator";

/**
 * Fortæller-audio (PRD §4.3): replik-id + variant → lydfil, med tekst-fallback.
 * Manifestet genereres af tools/generate_audio.py — findes det ikke, er
 * spillet bare tekst-only. En ny replik afbryder den gamle med et hurtigt
 * fade (ducking), og browserens autoplay-blokering håndteres ved at udskyde
 * første afspilning til første brugerinteraktion.
 */

let manifest: Record<string, number[]> | null = null;
let current: HTMLAudioElement | null = null;
let pending: string | null = null;
let unlocked = false;

export async function initAudio(): Promise<void> {
  try {
    const resp = await fetch("audio/manifest.json");
    if (resp.ok) manifest = (await resp.json()) as Record<string, number[]>;
  } catch {
    manifest = null; // ingen lyd tilgængelig — tekst-fallback
  }
  // Autoplay er blokeret indtil første interaktion; afspil evt. ventende replik dér
  const unlock = () => {
    unlocked = true;
    if (pending) {
      playUrl(pending);
      pending = null;
    }
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function fadeOutAndStop(audio: HTMLAudioElement): void {
  const step = () => {
    audio.volume = Math.max(0, audio.volume - 0.2);
    if (audio.volume > 0) setTimeout(step, 30);
    else audio.pause();
  };
  step();
}

function playUrl(url: string): void {
  if (current) fadeOutAndStop(current);
  current = new Audio(url);
  current.play().catch(() => {
    // Autoplay blokeret — gem til første interaktion
    pending = url;
  });
}

/** Afspil replikkens lydfil hvis den findes i manifestet (og lyden ikke er mutet). */
export function playLine(line: SpokenLine, muted: boolean): void {
  if (muted || !manifest) return;
  if (!manifest[line.id]?.includes(line.variant)) return;
  const url = `audio/${line.id}.v${line.variant}.mp3`;
  if (!unlocked) {
    pending = url;
    return;
  }
  playUrl(url);
}

/** Stop igangværende afspilning (bruges når fortælleren mutes). */
export function stopAudio(): void {
  if (current) fadeOutAndStop(current);
  pending = null;
}
