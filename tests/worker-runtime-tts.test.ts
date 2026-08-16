import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARTESIA_API_VERSION,
  CARTESIA_RUNTIME_MODEL,
  CARTESIA_RUNTIME_VOICE,
  callRuntimeTts,
  createRuntimeTtsDeps,
  decideRuntimeTts,
  RUNTIME_TTS_STATS_KEY,
} from "../worker/src/runtime-tts";
import { InMemoryStore } from "../worker/src/store";

afterEach(() => vi.restoreAllMocks());

describe("Cartesia runtime narrator speech", () => {
  it("pins the model snapshot, British voice and low-bandwidth PCM format", async () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://api.cartesia.ai/tts/bytes");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-key");
      expect(headers.get("cartesia-version")).toBe(
        CARTESIA_API_VERSION,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        model_id: "sonic-3.5-2026-05-04",
        transcript: "Karl waits for history to notice.",
        voice: "ef191366-f52f-447a-a398-ed8c0f2943a1",
        language: "en",
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: 24000,
        },
        generation_config: {
          speed: 0.96,
          emotion: "ironic",
        },
      });
      return new Response(audio, {
        status: 200,
        headers: { "content-type": "audio/raw" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    expect(CARTESIA_RUNTIME_MODEL).toBe("sonic-3.5-2026-05-04");
    expect(CARTESIA_RUNTIME_VOICE).toBe(
      "ef191366-f52f-447a-a398-ed8c0f2943a1",
    );
    const result = await callRuntimeTts(
      "Karl waits for history to notice.",
      { CARTESIA_API_KEY: "test-key" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      new Uint8Array(await result.response.arrayBuffer()),
    ).toEqual(audio);
  });

  it("fails closed without a provider key or usable upstream stream", async () => {
    await expect(
      callRuntimeTts("Karl waits.", {}),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      reason: "tts unavailable",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 502 })),
    );
    await expect(
      callRuntimeTts("Karl waits.", {
        CARTESIA_API_KEY: "test-key",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 502,
      reason: "tts upstream",
    });
  });

  it("stops the provider timeout once response headers arrive so a long body can finish", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        providerSignal = init?.signal as AbortSignal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              finish = () => {
                controller.enqueue(new Uint8Array([3, 4]));
                controller.close();
              };
            },
          }),
          { status: 200 },
        );
      }),
    );
    try {
      const result = await callRuntimeTts(
        "Karl waits for history to notice.",
        { CARTESIA_API_KEY: "test-key" },
      );
      expect(result.ok).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(providerSignal?.aborted).toBe(false);
      finish();
      if (result.ok) {
        expect(
          new Uint8Array(await result.response.arrayBuffer()),
        ).toEqual(new Uint8Array([1, 2, 3, 4]));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate-limits repeated synthesis independently of commentary text generation", async () => {
    const callUpstream = vi.fn(async () => ({
      ok: true as const,
      response: new Response(new Uint8Array([1, 2])),
    }));
    const deps = createRuntimeTtsDeps({
      store: new InMemoryStore(),
      now: () => Date.UTC(2026, 7, 16),
      callUpstream,
      config: {
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1,
        dailyMax: 5,
        dailyMaxPerIp: 2,
      },
    });

    expect(
      await decideRuntimeTts(
        {
          schemaVersion: 1,
          text: "Karl waits for history to notice.",
        },
        "a".repeat(64),
        deps,
      ),
    ).toMatchObject({ status: 200 });
    expect(
      await decideRuntimeTts(
        {
          schemaVersion: 1,
          text: "Karl waits for history to notice.",
        },
        "a".repeat(64),
        deps,
      ),
    ).toEqual({
      status: 429,
      reason: "rate limit",
      retryAfterSeconds: 60,
    });
    expect(callUpstream).toHaveBeenCalledTimes(1);
  });

  it("rejects extra client-shaped fields before provider budget", async () => {
    const callUpstream = vi.fn();
    const deps = createRuntimeTtsDeps({
      store: new InMemoryStore(),
      callUpstream,
      config: {
        rateLimitWindowMs: 60_000,
        rateLimitMax: 10,
        dailyMax: 10,
        dailyMaxPerIp: 5,
      },
    });
    expect(
      await decideRuntimeTts(
        {
          schemaVersion: 1,
          text: "Karl waits.",
          voice: "client-choice",
        },
        "a".repeat(64),
        deps,
      ),
    ).toEqual({ status: 400, reason: "invalid schema" });
    expect(callUpstream).not.toHaveBeenCalled();
  });

  it("stores aggregate TTS counters without retaining transcript text", async () => {
    const store = new InMemoryStore();
    let now = 1000;
    const deps = createRuntimeTtsDeps({
      store,
      now: () => {
        now += 20;
        return now;
      },
      callUpstream: async () => ({
        ok: true,
        response: new Response(new Uint8Array([1, 2])),
      }),
      config: {
        rateLimitWindowMs: 60_000,
        rateLimitMax: 5,
        dailyMax: 5,
        dailyMaxPerIp: 5,
      },
    });

    await decideRuntimeTts(
      {
        schemaVersion: 1,
        text: "Karl waits for history to notice.",
      },
      "a".repeat(64),
      deps,
    );

    const stats = await store.get<Record<string, unknown>>(
      RUNTIME_TTS_STATS_KEY,
    );
    expect(stats).toMatchObject({
      requested: 1,
      accepted: 1,
      providerFailures: 0,
    });
    expect(JSON.stringify(stats)).not.toContain("Karl waits");
  });
});
