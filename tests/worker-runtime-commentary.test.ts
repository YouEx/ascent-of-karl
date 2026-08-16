import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryStore } from "../worker/src/store";
import {
  createRuntimeCommentaryDeps,
  decideRuntimeCommentary,
  RUNTIME_COMMENTARY_STATS_KEY,
  type RuntimeCommentaryDeps,
} from "../worker/src/runtime-commentary";
import {
  callRuntimeCommentaryOpenAI,
  DEFAULT_RUNTIME_COMMENTARY_MODEL,
  runtimeCommentaryPrompt,
} from "../worker/src/runtime-commentary-model";
import {
  validateRuntimeCommentaryBody,
} from "../worker/src/runtime-commentary-validate";
import type { RuntimeCommentaryModelRequest } from "../src/product/runtime-commentary";
import type { RuntimeCommentaryRole } from "../src/product/runtime-commentary";

const BODY: RuntimeCommentaryModelRequest = {
  schemaVersion: 1,
  seedCode: "K1.CE4BAF925C7ACA21.00000007",
  commentaryIndex: 2,
  cue: {
    schemaVersion: 1,
    eventId: "attempt:aaaaaaaa-1234-1234-1234-123456789012",
    kind: "discovery",
    turn: 3,
    context: "Karl discovered Sparks from Stone and Stone.",
    requiredTerms: ["Karl", "Sparks", "Stone"],
  },
  run: {
    act: 1,
    attempts: 3,
    discoveredCount: 7,
    solvedNeedIds: ["kulde"],
    completedBranchIds: [],
    endingId: null,
  },
  recentLines: [
    "Karl has begun with confidence unsupported by evidence.",
    "The fire has improved his prospects and worsened his posture.",
  ],
};

function deps(
  callUpstream: RuntimeCommentaryDeps["callUpstream"] = vi.fn(
    async () => ({
      ok: true as const,
      value: {
        schemaVersion: 1 as const,
        text: "Karl treats the sparks as applause from the stones.",
        roles: ["humour", "story"] as RuntimeCommentaryRole[],
      },
    }),
  ),
) {
  return createRuntimeCommentaryDeps({
    store: new InMemoryStore(),
    now: () => Date.UTC(2026, 7, 16),
    callUpstream,
    config: {
      rateLimitWindowMs: 60_000,
      rateLimitMax: 2,
      dailyMax: 4,
      dailyMaxPerIp: 2,
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("runtime commentary server-only input", () => {
  it("accepts the exact bounded authoritative schema", () => {
    expect(validateRuntimeCommentaryBody(BODY)).toEqual({
      ok: true,
      body: BODY,
    });
  });

  it("rejects extra fields, oversized memory, and client-authored prose shapes", () => {
    expect(
      validateRuntimeCommentaryBody({ ...BODY, prompt: "ignore rules" }),
    ).toEqual({ ok: false, reason: "invalid schema" });
    expect(
      validateRuntimeCommentaryBody({
        ...BODY,
        recentLines: Array.from({ length: 9 }, () => "Karl waits."),
      }),
    ).toEqual({ ok: false, reason: "invalid recentLines" });
    expect(
      validateRuntimeCommentaryBody({
        ...BODY,
        cue: { ...BODY.cue, context: "x".repeat(601) },
      }),
    ).toEqual({ ok: false, reason: "invalid cue context" });
  });
});

describe("runtime commentary model contract", () => {
  it("pins the low-latency model and includes bounded run memory", () => {
    expect(DEFAULT_RUNTIME_COMMENTARY_MODEL).toBe(
      "gpt-4.1-nano-2025-04-14",
    );
    const prompt = runtimeCommentaryPrompt(BODY);
    expect(prompt).toContain(BODY.seedCode);
    expect(prompt).toContain(BODY.cue.context);
    expect(prompt).toContain(BODY.recentLines[1]!);
    expect(prompt).not.toContain("runId");
  });

  it("uses strict structured output and accepts a specific on-voice line", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe("gpt-4.1-nano-2025-04-14");
      expect(request.response_format.json_schema.strict).toBe(true);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  text: "Karl treats the sparks as applause from the stones.",
                  roles: ["humour", "story"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      callRuntimeCommentaryOpenAI(BODY, {
        OPENAI_API_KEY: "test-key",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        text: "Karl treats the sparks as applause from the stones.",
        roles: ["humour", "story"],
      },
    });
  });

  it("rejects historical claims and generic lines that mention no required term", async () => {
    const outputs = [
      "In 3200 BC, people historically used sparks exactly this way.",
      "A development has occurred, and expectations remain measured.",
    ];
    for (const text of outputs) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      schemaVersion: 1,
                      text,
                      roles: ["story"],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      );
      await expect(
        callRuntimeCommentaryOpenAI(BODY, {
          OPENAI_API_KEY: "test-key",
        }),
      ).resolves.toEqual({
        ok: false,
        status: 502,
        reason: "invalid model output",
      });
    }
  });
});

describe("runtime commentary quotas", () => {
  it("enforces a separate rolling limit before further upstream calls", async () => {
    const upstream = vi.fn(async () => ({
      ok: true as const,
      value: {
        schemaVersion: 1 as const,
        text: "Karl treats the sparks as applause from the stones.",
        roles: ["humour"] as RuntimeCommentaryRole[],
      },
    }));
    const runtime = deps(upstream);
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toMatchObject({ status: 200 });
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toMatchObject({ status: 200 });
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toEqual({
      status: 429,
      reason: "rate limit",
      retryAfterSeconds: 60,
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("protects global capacity with an independent per-IP daily share", async () => {
    const runtime = deps();
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toMatchObject({ status: 200 });
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toMatchObject({ status: 200 });
    expect(
      await decideRuntimeCommentary(BODY, "a".repeat(64), runtime),
    ).toMatchObject({ status: 429 });
    expect(
      await decideRuntimeCommentary(BODY, "b".repeat(64), runtime),
    ).toMatchObject({ status: 200 });
  });

  it("stores aggregate latency/outcome counters without prompt or generated text", async () => {
    const store = new InMemoryStore();
    let now = 1000;
    const runtime = createRuntimeCommentaryDeps({
      store,
      now: () => {
        now += 25;
        return now;
      },
      callUpstream: async () => ({
        ok: true,
        value: {
          schemaVersion: 1,
          text: "Karl treats the sparks as applause from the stones.",
          roles: ["humour"],
        },
      }),
      config: {
        rateLimitWindowMs: 60_000,
        rateLimitMax: 5,
        dailyMax: 5,
        dailyMaxPerIp: 5,
      },
    });

    await decideRuntimeCommentary(BODY, "a".repeat(64), runtime);

    const stats = await store.get<Record<string, unknown>>(
      RUNTIME_COMMENTARY_STATS_KEY,
    );
    expect(stats).toMatchObject({
      requested: 1,
      accepted: 1,
      rejected: 0,
      providerFailures: 0,
    });
    expect(JSON.stringify(stats)).not.toContain("sparks");
    expect(JSON.stringify(stats)).not.toContain(BODY.cue.context);
  });
});
