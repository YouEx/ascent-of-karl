import { reserveBudget, type BudgetRecord } from "./budget";
import { SerialGate } from "./concurrency";
import { checkRollingWindow } from "./limiter";
import type { KeyValueStore } from "./store";

export const CARTESIA_API_VERSION = "2026-08-14";
export const CARTESIA_RUNTIME_MODEL =
  "sonic-3.5-2026-05-04";
export const CARTESIA_RUNTIME_VOICE =
  "ef191366-f52f-447a-a398-ed8c0f2943a1";
export const RUNTIME_TTS_SAMPLE_RATE = 24000;
export const RUNTIME_TTS_INTERNAL_HEADER = "x-internal-runtime-tts";
export const RUNTIME_TTS_RATE_PREFIX = "rl:runtime-tts:";
export const RUNTIME_TTS_IP_BUDGET_PREFIX =
  "budget:runtime-tts:ip:";
export const RUNTIME_TTS_STATS_KEY = "stats:runtime-tts:v1";
const RUNTIME_TTS_BUDGET_KEY = "budget:runtime-tts";

interface RuntimeTtsStats {
  requested: number;
  accepted: number;
  providerFailures: number;
  totalLatencyMs: number;
  lastSeen: number;
}

export interface RuntimeTtsEnv {
  CARTESIA_API_KEY?: string;
}

export type RuntimeTtsResult =
  | { ok: true; response: Response }
  | { ok: false; status: 502 | 503 | 504; reason: string };

export interface RuntimeTtsConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  dailyMax: number;
  dailyMaxPerIp: number;
}

export interface RuntimeTtsDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (text: string) => Promise<RuntimeTtsResult>;
  config: RuntimeTtsConfig;
  gate: SerialGate;
}

export type RuntimeTtsResponse =
  | { status: 200; response: Response }
  | { status: 400; reason: string }
  | { status: 429; reason: string; retryAfterSeconds: number }
  | { status: 503; reason: string; retryAfterSeconds?: number }
  | { status: 502 | 504; reason: string };

export async function callRuntimeTts(
  text: string,
  env: RuntimeTtsEnv,
): Promise<RuntimeTtsResult> {
  if (!env.CARTESIA_API_KEY) {
    return { ok: false, status: 503, reason: "tts unavailable" };
  }
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CARTESIA_API_KEY}`,
        "cartesia-version": CARTESIA_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model_id: CARTESIA_RUNTIME_MODEL,
        transcript: text,
        voice: CARTESIA_RUNTIME_VOICE,
        language: "en",
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: RUNTIME_TTS_SAMPLE_RATE,
        },
        generation_config: {
          speed: 0.96,
          emotion: "ironic",
        },
      }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, status: 504, reason: "tts timeout or network" };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !response.body) {
    return { ok: false, status: 502, reason: "tts upstream" };
  }
  return { ok: true, response };
}

export function createRuntimeTtsDeps(options: {
  store: KeyValueStore;
  callUpstream: RuntimeTtsDeps["callUpstream"];
  config: RuntimeTtsConfig;
  now?: () => number;
}): RuntimeTtsDeps {
  return {
    store: options.store,
    callUpstream: options.callUpstream,
    config: options.config,
    now: options.now ?? (() => Date.now()),
    gate: new SerialGate(),
  };
}

function validateRuntimeTtsBody(
  raw: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid schema" };
  }
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "schemaVersion,text" ||
    value.schemaVersion !== 1 ||
    typeof value.text !== "string" ||
    value.text.length < 20 ||
    value.text.length > 260 ||
    value.text.includes("\n")
  ) {
    return { ok: false, reason: "invalid schema" };
  }
  return { ok: true, text: value.text };
}

export async function decideRuntimeTts(
  rawBody: unknown,
  ipHash: string,
  deps: RuntimeTtsDeps,
): Promise<RuntimeTtsResponse> {
  const validated = validateRuntimeTtsBody(rawBody);
  if (!validated.ok) return { status: 400, reason: validated.reason };

  const reservation = await deps.gate.run(async () => {
    const now = deps.now();
    const rateKey = RUNTIME_TTS_RATE_PREFIX + ipHash;
    const rate = checkRollingWindow(
      (await deps.store.get<number[]>(rateKey)) ?? [],
      now,
      deps.config.rateLimitWindowMs,
      deps.config.rateLimitMax,
    );
    if (!rate.allowed) {
      return {
        ok: false as const,
        response: {
          status: 429 as const,
          reason: "rate limit",
          retryAfterSeconds: rate.retryAfterSeconds,
        },
      };
    }
    const global = reserveBudget(
      await deps.store.get<BudgetRecord>(RUNTIME_TTS_BUDGET_KEY),
      now,
      deps.config.dailyMax,
    );
    if (!global.ok) {
      return {
        ok: false as const,
        response: {
          status: 503 as const,
          reason: "daily budget",
          retryAfterSeconds: global.retryAfterSeconds,
        },
      };
    }
    const ipKey = RUNTIME_TTS_IP_BUDGET_PREFIX + ipHash;
    const perIp = reserveBudget(
      await deps.store.get<BudgetRecord>(ipKey),
      now,
      deps.config.dailyMaxPerIp,
    );
    if (!perIp.ok) {
      return {
        ok: false as const,
        response: {
          status: 429 as const,
          reason: "per-ip daily budget",
          retryAfterSeconds: perIp.retryAfterSeconds,
        },
      };
    }
    await deps.store.put(rateKey, rate.timestamps);
    await deps.store.put(RUNTIME_TTS_BUDGET_KEY, global.record);
    await deps.store.put(ipKey, perIp.record);
    return { ok: true as const };
  });
  if (!reservation.ok) return reservation.response;

  const startedAt = deps.now();
  const upstream = await deps.callUpstream(validated.text);
  const finishedAt = deps.now();
  await deps.gate.run(async () => {
    const current =
      (await deps.store.get<RuntimeTtsStats>(
        RUNTIME_TTS_STATS_KEY,
      )) ?? {
        requested: 0,
        accepted: 0,
        providerFailures: 0,
        totalLatencyMs: 0,
        lastSeen: finishedAt,
      };
    current.requested++;
    current.totalLatencyMs += Math.max(0, finishedAt - startedAt);
    current.lastSeen = finishedAt;
    if (upstream.ok) current.accepted++;
    else current.providerFailures++;
    await deps.store.put(RUNTIME_TTS_STATS_KEY, current);
  });
  if (!upstream.ok) {
    return { status: upstream.status, reason: upstream.reason };
  }
  return { status: 200, response: upstream.response };
}
