import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpokenLine } from "../src/narrator/narrator";

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static playImpl: (audio: FakeAudio) => Promise<void> = async () => undefined;
  readonly src: string;
  volume = 1;
  paused = false;
  play = vi.fn(() => FakeAudio.playImpl(this));
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(src: string) {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

class FakeUtterance {
  readonly text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

const speech = {
  spoken: [] as FakeUtterance[],
  cancel: vi.fn(),
  getVoices: vi.fn(() => [
    { lang: "en-GB", name: "Daniel" } as SpeechSynthesisVoice,
  ]),
  speak: vi.fn((utterance: FakeUtterance) => {
    speech.spoken.push(utterance);
  }),
};
const listeners = new Map<string, () => void>();

const intro: SpokenLine = {
  id: "intro-act-1",
  variant: 0,
  text: "Karl begins.",
};
const pull: SpokenLine = {
  id: "pull-kulde",
  variant: 3,
  text: "The cold settles in. Karl needs something bright and hot.",
};

async function loadAudio(manifest: Record<string, number[]>) {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", speech);
  vi.stubGlobal("window", {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    }),
    speechSynthesis: speech,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
  );
  const audio = await import("../src/ui/audio");
  await audio.initAudio(true);
  return audio;
}

beforeEach(() => {
  vi.resetModules();
  FakeAudio.instances = [];
  FakeAudio.playImpl = async () => undefined;
  listeners.clear();
  speech.spoken = [];
  speech.cancel.mockClear();
  speech.getVoices.mockClear();
  speech.speak.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fortællerens tekst/lyd-paritet", () => {
  it("venter på recorded audio-end før beatet er færdigt", async () => {
    const audio = await loadAudio({ "intro-act-1": [0] });
    const playback = audio.playLine(intro, false);

    expect(playback.mode).toBe("recorded");
    let finished = false;
    void playback.done.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    FakeAudio.instances[0]!.dispatchEvent(new Event("ended"));
    await playback.done;
    expect(finished).toBe(true);
  });

  it("stopper stale recorded audio og siger præcis den synlige fallbacktekst", async () => {
    const audio = await loadAudio({ "intro-act-1": [0] });
    const first = audio.playLine(intro, false);
    FakeAudio.instances[0]!.volume = 0.2;

    const second = audio.playLine(pull, false);

    expect(second.mode).toBe("synthesized");
    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalled();
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]!.text).toBe(pull.text);
    expect(speech.spoken[0]!.lang).toBe("en-GB");

    speech.spoken[0]!.onend?.(new Event("end"));
    await second.done;
    await first.done;
  });

  it("går ærligt text-only hvis browseren ikke har speech synthesis", async () => {
    const audio = await loadAudio({ "intro-act-1": [0] });
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    (globalThis.window as { speechSynthesis?: unknown }).speechSynthesis =
      undefined;
    FakeAudio.instances[0] = new FakeAudio("audio/old.mp3");
    FakeAudio.instances[0]!.volume = 0.2;
    audio.playLine(intro, false);

    const playback = audio.playLine(pull, false);

    expect(playback.mode).toBe("text-only");
    await playback.done;
  });

  it("kan ikke genstarte en gammel afvist play-promise efter et nyt beat", async () => {
    let rejectPlay!: (reason: Error) => void;
    FakeAudio.playImpl = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      });
    const audio = await loadAudio({ "intro-act-1": [0] });
    audio.playLine(intro, false);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalledTimes(1);

    const fallback = audio.playLine(pull, false);
    rejectPlay(new Error("autoplay"));
    await Promise.resolve();
    await Promise.resolve();
    listeners.get("pointerdown")?.();

    expect(FakeAudio.instances[0]!.play).toHaveBeenCalledTimes(1);
    speech.spoken[0]!.onend?.(new Event("end"));
    await fallback.done;
  });
});
