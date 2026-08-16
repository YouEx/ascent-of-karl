import { reserveBudget, type BudgetRecord } from "./budget";
import { SerialGate } from "./concurrency";
import { checkRollingWindow } from "./limiter";
import type { KeyValueStore } from "./store";
import type { RuntimeCommentaryModelRequest } from "../../src/product/runtime-commentary";
import {
  validateRuntimeCommentaryBody,
} from "./runtime-commentary-validate";
import type {
  RuntimeCommentaryUpstreamResult,
} from "./runtime-commentary-model";

export const RUNTIME_COMMENTARY_RATE_PREFIX =
  "rl:runtime-commentary:";
export const RUNTIME_COMMENTARY_IP_BUDGET_PREFIX =
  "budget:runtime-commentary:ip:";
export const RUNTIME_COMMENTARY_STATS_KEY =
  "stats:runtime-commentary:v1";
const RUNTIME_COMMENTARY_BUDGET_KEY =
  "budget:runtime-commentary";

interface RuntimeCommentaryStats {
  requested: number;
  accepted: number;
  rejected: number;
  providerFailures: number;
  totalLatencyMs: number;
  lastSeen: number;
}

export interface RuntimeCommentaryConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  dailyMax: number;
  dailyMaxPerIp: number;
}

export interface RuntimeCommentaryDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (
    body: RuntimeCommentaryModelRequest,
  ) => Promise<RuntimeCommentaryUpstreamResult>;
  config: RuntimeCommentaryConfig;
  gate: SerialGate;
}

export type RuntimeCommentaryResponse =
  | {
      status: 200;
      value: Extract<RuntimeCommentaryUpstreamResult, { ok: true }>["value"];
    }
  | { status: 400; reason: string }
  | { status: 429; reason: string; retryAfterSeconds: number }
  | { status: 503; reason: string; retryAfterSeconds: number }
  | { status: 502 | 504; reason: string };

export function createRuntimeCommentaryDeps(options: {
  store: KeyValueStore;
  callUpstream: RuntimeCommentaryDeps["callUpstream"];
  config: RuntimeCommentaryConfig;
  now?: () => number;
}): RuntimeCommentaryDeps {
  return {
    store: options.store,
    callUpstream: options.callUpstream,
    config: options.config,
    now: options.now ?? (() => Date.now()),
    gate: new SerialGate(),
  };
}

export async function decideRuntimeCommentary(
  rawBody: unknown,
  ipHash: string,
  deps: RuntimeCommentaryDeps,
): Promise<RuntimeCommentaryResponse> {
  const validated = validateRuntimeCommentaryBody(rawBody);
  if (!validated.ok) {
    return { status: 400, reason: validated.reason };
  }
  const reservation = await deps.gate.run(async () => {
    const now = deps.now();
    const rateKey = RUNTIME_COMMENTARY_RATE_PREFIX + ipHash;
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
      await deps.store.get<BudgetRecord>(
        RUNTIME_COMMENTARY_BUDGET_KEY,
      ),
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
    const ipKey = RUNTIME_COMMENTARY_IP_BUDGET_PREFIX + ipHash;
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
    await deps.store.put(
      RUNTIME_COMMENTARY_BUDGET_KEY,
      global.record,
    );
    await deps.store.put(ipKey, perIp.record);
    return { ok: true as const };
  });
  if (!reservation.ok) return reservation.response;

  const startedAt = deps.now();
  const upstream = await deps.callUpstream(validated.body);
  const finishedAt = deps.now();
  await deps.gate.run(async () => {
    const current =
      (await deps.store.get<RuntimeCommentaryStats>(
        RUNTIME_COMMENTARY_STATS_KEY,
      )) ?? {
        requested: 0,
        accepted: 0,
        rejected: 0,
        providerFailures: 0,
        totalLatencyMs: 0,
        lastSeen: finishedAt,
      };
    current.requested++;
    current.totalLatencyMs += Math.max(0, finishedAt - startedAt);
    current.lastSeen = finishedAt;
    if (upstream.ok) current.accepted++;
    else if (upstream.reason === "invalid model output") {
      current.rejected++;
    } else {
      current.providerFailures++;
    }
    await deps.store.put(RUNTIME_COMMENTARY_STATS_KEY, current);
  });
  if (!upstream.ok) {
    return {
      status: upstream.status,
      reason: upstream.reason,
    };
  }
  return { status: 200, value: upstream.value };
}
