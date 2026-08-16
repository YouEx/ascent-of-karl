import { describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeCommentary,
  waitForRuntimePresentation,
} from "../src/ui/runtime-commentary-client";
import type { SpokenLine } from "../src/narrator/narrator";
import type { RunCredentials } from "../src/product/session";
import type { RuntimeCommentaryCue } from "../src/product/runtime-commentary";

const credentials: RunCredentials = {
  runId: "run-1",
  token: "token",
  csrf: "csrf",
  expiresAt: 4_102_444_800,
};
const cue: RuntimeCommentaryCue = {
  schemaVersion: 1,
  eventId: "opening",
  kind: "opening",
  turn: 0,
  context: "Karl begins.",
  requiredTerms: ["Karl"],
};

describe("runtime commentary browser preparation", () => {
  it("prepares a runtime line and provider stream without blocking gameplay state", async () => {
    const audio = new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "audio/pcm" },
    });
    const client = {
      commentary: vi.fn(async () => ({
        schemaVersion: 1 as const,
        eventId: "opening",
        text: "Karl begins with the confidence of a man who has not checked the inventory.",
        roles: ["humour", "story"] as const,
        audioAvailable: true,
      })),
      commentaryAudio: vi.fn(async () => audio),
    };

    await expect(
      prepareRuntimeCommentary({
        client,
        credentials,
        cue,
        currentTurn: () => 0,
      }),
    ).resolves.toEqual({
      line: {
        id: "runtime:opening",
        variant: 0,
        text: "Karl begins with the confidence of a man who has not checked the inventory.",
        roles: ["humour", "story"],
        source: "runtime-llm",
      },
      audio,
    });
  });

  it("drops stale commentary when the player has already advanced", async () => {
    let turn = 0;
    const client = {
      commentary: vi.fn(async () => {
        turn = 1;
        return {
          schemaVersion: 1 as const,
          eventId: "opening",
          text: "Karl begins with confidence.",
          roles: ["humour"] as const,
          audioAvailable: false,
        };
      }),
      commentaryAudio: vi.fn(),
    };

    await expect(
      prepareRuntimeCommentary({
        client,
        credentials,
        cue,
        currentTurn: () => turn,
      }),
    ).resolves.toBeNull();
  });

  it("keeps exact-text commentary when provider audio fails", async () => {
    const client = {
      commentary: vi.fn(async () => ({
        schemaVersion: 1 as const,
        eventId: "opening",
        text: "Karl begins with confidence.",
        roles: ["humour"] as const,
        audioAvailable: true,
      })),
      commentaryAudio: vi.fn(async () => {
        throw new Error("tts down");
      }),
    };

    await expect(
      prepareRuntimeCommentary({
        client,
        credentials,
        cue,
        currentTurn: () => 0,
      }),
    ).resolves.toMatchObject({
      line: {
        text: "Karl begins with confidence.",
        source: "runtime-llm",
      },
      audio: undefined,
    });
  });

  it("cancels a queued ending line when presentation misses its deadline", async () => {
    vi.useFakeTimers();
    const line: SpokenLine = {
      id: "runtime:ending",
      variant: 0,
      text: "Karl reaches the end with timing still unresolved.",
    };
    const enqueue = vi.fn();
    const cancel = vi.fn();
    try {
      const waiting = waitForRuntimePresentation({
        line,
        enqueue,
        cancel,
        timeoutMs: 8000,
      });
      expect(enqueue).toHaveBeenCalledWith(line);
      await vi.advanceTimersByTimeAsync(8001);
      await expect(waiting).resolves.toBe(false);
      expect(cancel).toHaveBeenCalledWith(line.id);

      line.onPresent?.();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
