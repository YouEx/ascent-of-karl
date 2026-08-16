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

class FakeAudioBuffer {
  readonly data: Float32Array;

  constructor(length: number) {
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeBufferSource {
  static autoEnd = true;
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn(() => {
    if (FakeBufferSource.autoEnd) {
      queueMicrotask(() => this.onended?.());
    }
  });
  stop = vi.fn();
  connect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 1;
  readonly destination = {};
  readonly sources: FakeBufferSource[] = [];
  resume = vi.fn(async () => undefined);

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBuffer(
    _channels: number,
    length: number,
    _sampleRate: number,
  ): FakeAudioBuffer {
    return new FakeAudioBuffer(length);
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
}

const voiceHandlers: Array<() => void> = [];
const defaultVoices = [
  { lang: "en-GB", name: "Daniel" } as SpeechSynthesisVoice,
];

const speech = {
  spoken: [] as FakeUtterance[],
  cancel: vi.fn(),
  addEventListener: vi.fn((type: string, listener: () => void) => {
    if (type === "voiceschanged") voiceHandlers.push(listener);
  }),
  getVoices: vi.fn(() => defaultVoices),
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
  vi.stubGlobal("AudioContext", FakeAudioContext);
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
  speech.getVoices.mockReturnValue(defaultVoices);
  speech.addEventListener.mockClear();
  voiceHandlers.length = 0;
  speech.speak.mockClear();
  FakeAudioContext.instances = [];
  FakeBufferSource.autoEnd = true;
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

describe("fortællerens stemmevalg", () => {
  it("tier hellere end at tale i systemets standardstemme, når listen endnu er tom", async () => {
    speech.getVoices.mockReturnValue([]);
    const audio = await loadAudio({});

    const playback = audio.playLine(pull, false);

    expect(playback.mode).toBe("text-only");
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("tier, når browseren slet ikke har en britisk stemme", async () => {
    speech.getVoices.mockReturnValue([
      { lang: "da-DK", name: "Sara" } as SpeechSynthesisVoice,
      { lang: "en-US", name: "Samantha" } as SpeechSynthesisVoice,
    ]);
    const audio = await loadAudio({});

    expect(audio.playLine(pull, false).mode).toBe("text-only");
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it("tager stemmen i brug, når Chrome udgiver listen bagefter (voiceschanged)", async () => {
    speech.getVoices.mockReturnValue([]);
    const audio = await loadAudio({});
    expect(audio.playLine(pull, false).mode).toBe("text-only");

    speech.getVoices.mockReturnValue([
      { lang: "en-GB", name: "Daniel" } as SpeechSynthesisVoice,
    ]);
    voiceHandlers.forEach((handler) => handler());

    const playback = audio.playLine(pull, false);
    expect(playback.mode).toBe("synthesized");
    expect(speech.spoken.at(-1)?.voice?.name).toBe("Daniel");
  });

  it("foretrækker den britiske dokumentarstemme frem for den første den bedste", async () => {
    speech.getVoices.mockReturnValue([
      { lang: "en-GB", name: "Arthur" } as SpeechSynthesisVoice,
      { lang: "en-GB", name: "Daniel" } as SpeechSynthesisVoice,
    ]);
    const audio = await loadAudio({});

    audio.playLine(pull, false);
    expect(speech.spoken.at(-1)?.voice?.name).toBe("Daniel");
  });
});

describe("streamet runtime-fortællerstemme", () => {
  it("afspiller første PCM-chunk før resten af strømmen er landet", async () => {
    const audio = await loadAudio({});
    let finish!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 255, 127]));
        finish = () => {
          controller.enqueue(new Uint8Array([0, 128, 0, 0]));
          controller.close();
        };
      },
    });

    const playback = audio.playRuntimeLine(
      {
        id: "runtime:opening",
        variant: 0,
        text: "Karl waits for history to notice.",
      },
      new Response(stream, {
        headers: {
          "content-type": "audio/pcm",
          "x-audio-sample-rate": "24000",
        },
      }),
      false,
    );

    await vi.waitFor(() => {
      expect(FakeAudioContext.instances[0]?.sources).toHaveLength(1);
    });
    expect(playback.mode).toBe("synthesized");
    expect(
      FakeAudioContext.instances[0]!.sources[0]!.buffer!.data[1],
    ).toBeCloseTo(32767 / 32768);

    finish();
    await playback.done;
    expect(FakeAudioContext.instances[0]!.sources).toHaveLength(2);
  });

  it("cancels the PCM reader and scheduled sources when a new beat starts", async () => {
    const audio = await loadAudio({});
    FakeBufferSource.autoEnd = false;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 255, 127]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const runtime = audio.playRuntimeLine(
      {
        id: "runtime:opening",
        variant: 0,
        text: "Karl waits for history to notice.",
      },
      new Response(stream, {
        headers: { "x-audio-sample-rate": "24000" },
      }),
      false,
    );
    await vi.waitFor(() => {
      expect(FakeAudioContext.instances[0]?.sources).toHaveLength(1);
    });

    const authored = audio.playLine(pull, false);

    await runtime.done;
    expect(cancelled).toBe(true);
    expect(
      FakeAudioContext.instances[0]!.sources[0]!.stop,
    ).toHaveBeenCalled();
    speech.spoken[0]!.onend?.(new Event("end"));
    await authored.done;
  });

  it("falls back to exact-text browser TTS when PCM is unavailable", async () => {
    const audio = await loadAudio({});
    const runtime = audio.playRuntimeLine(
      {
        id: "runtime:opening",
        variant: 0,
        text: "Karl waits for history to notice.",
      },
      new Response(null, { status: 503 }),
      false,
    );

    expect(runtime.mode).toBe("synthesized");
    expect(speech.spoken.at(-1)?.text).toBe(
      "Karl waits for history to notice.",
    );
    speech.spoken.at(-1)?.onend?.(new Event("end"));
    await runtime.done;
  });

  it("stops scheduled PCM before exact-text fallback after a mid-stream failure", async () => {
    const audio = await loadAudio({});
    FakeBufferSource.autoEnd = false;
    let fail!: (error: Error) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 0, 255, 127]));
        fail = (error) => controller.error(error);
      },
    });
    const playback = audio.playRuntimeLine(
      {
        id: "runtime:opening",
        variant: 0,
        text: "Karl waits for history to notice.",
      },
      new Response(stream, {
        headers: { "x-audio-sample-rate": "24000" },
      }),
      false,
    );
    await vi.waitFor(() => {
      expect(FakeAudioContext.instances[0]?.sources).toHaveLength(1);
    });

    fail(new Error("stream broke"));

    await vi.waitFor(() => {
      expect(speech.spoken.at(-1)?.text).toBe(
        "Karl waits for history to notice.",
      );
    });
    expect(
      FakeAudioContext.instances[0]!.sources[0]!.stop,
    ).toHaveBeenCalled();
    speech.spoken.at(-1)?.onend?.(new Event("end"));
    await playback.done;
  });
});
