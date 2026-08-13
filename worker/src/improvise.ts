/**
 * Improvisationens egen beslutningskæde. Den genbruger de små primitiver
 * (budget, limiter, gate, in-flight, storage), men ændrer ikke fortællerens
 * eksisterende koordinator eller dens kontrakt.
 */

import { reserveBudget, type BudgetRecord } from "./budget";
import { checkRollingWindow } from "./limiter";
import { SerialGate, InFlightRegistry } from "./concurrency";
import type { KeyValueStore } from "./store";
import {
  resolveCanonicalImproviseBody,
  type CanonicalImproviseBody,
  type CanonicalImproviseResult,
} from "./catalog";
import {
  validateImproviseBody,
  type ImproviseWireRequest,
} from "./improvise-validate";
import type { ImproviseCopy } from "./improvise-output";
import type { ImproviseUpstreamResult } from "./improvise-model";
import {
  recordImproviseStats,
  type CachedImprovisation,
  type ImproviseStatsOutcome,
} from "./improvise-stats";

export const IMPROVISE_RATE_LIMIT_KEY_PREFIX = "rl:improvise:";
export const IMPROVISE_BUDGET_KEY = "budget:improvise";
export const IMPROVISE_IP_BUDGET_KEY_PREFIX = "budget:improvise:ip:";
export const IMPROVISE_CACHE_KEY_PREFIX = "improv-cache:";

export interface ImproviseConfig {
  rateLimitWindowMs: number;
  rateLimitMax: number;
  dailyMax: number;
  dailyMaxPerIp: number;
  cacheNamespace: string;
}

export interface ImproviseDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (body: CanonicalImproviseBody) => Promise<ImproviseUpstreamResult>;
  resolveCanonical: (wire: ImproviseWireRequest) => CanonicalImproviseResult;
  config: ImproviseConfig;
  gate: SerialGate;
  inFlight: InFlightRegistry<ImproviseUpstreamResult>;
}

export type ImproviseResponse =
  | { status: 200; value: ImproviseCopy }
  | { status: 400; reason: string }
  | { status: 429; retryAfterSeconds: number; reason: string }
  | { status: 503; retryAfterSeconds: number; reason: string }
  | { status: 502; reason: string };

export function createImproviseDeps(partial: {
  store: KeyValueStore;
  callUpstream: ImproviseDeps["callUpstream"];
  config: ImproviseConfig;
  now?: () => number;
  resolveCanonical?: ImproviseDeps["resolveCanonical"];
}): ImproviseDeps {
  return {
    store: partial.store,
    callUpstream: partial.callUpstream,
    config: partial.config,
    now: partial.now ?? (() => Date.now()),
    resolveCanonical: partial.resolveCanonical ?? resolveCanonicalImproviseBody,
    gate: new SerialGate(),
    inFlight: new InFlightRegistry<ImproviseUpstreamResult>(),
  };
}

export function improviseCacheKey(
  aId: string,
  bId: string,
  namespace: string,
): string {
  const [first, second] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${IMPROVISE_CACHE_KEY_PREFIX}${namespace}:${first}+${second}`;
}

export async function reserveImproviseRateLimitSlot(
  ipHash: string,
  deps: Pick<ImproviseDeps, "store" | "now" | "config" | "gate">,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return deps.gate.run(async () => {
    const key = IMPROVISE_RATE_LIMIT_KEY_PREFIX + ipHash;
    const existing = (await deps.store.get<number[]>(key)) ?? [];
    const decision = checkRollingWindow(
      existing,
      deps.now(),
      deps.config.rateLimitWindowMs,
      deps.config.rateLimitMax,
    );
    if (decision.allowed) await deps.store.put(key, decision.timestamps);
    return {
      allowed: decision.allowed,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  });
}

type Decision =
  | { kind: "reject"; response: ImproviseResponse }
  | { kind: "hit"; value: ImproviseCopy }
  | { kind: "pending"; promise: Promise<ImproviseUpstreamResult> };

export async function decideImprovise(
  rawBody: unknown,
  ipHash: string,
  deps: ImproviseDeps,
): Promise<ImproviseResponse> {
  const decision: Decision = await deps.gate.run(async () => {
    const validated = validateImproviseBody(rawBody);
    if (!validated.ok) {
      return { kind: "reject", response: { status: 400, reason: validated.reason } };
    }

    const canonical = deps.resolveCanonical(validated.body);
    if (!canonical.ok) {
      return { kind: "reject", response: { status: 400, reason: canonical.reason } };
    }

    const { a, b, act } = canonical.body;
    const key = improviseCacheKey(a.id, b.id, deps.config.cacheNamespace);
    const recordStats = (outcome: ImproviseStatsOutcome) =>
      recordImproviseStats(deps.store, deps.now(), a.id, b.id, outcome);

    const cached = await deps.store.get<CachedImprovisation>(key);
    if (cached) {
      await recordStats("hit");
      return { kind: "hit", value: cached.value };
    }

    const existingInFlight = deps.inFlight.get(key);
    if (existingInFlight) {
      await recordStats("other");
      return { kind: "pending", promise: existingInFlight };
    }

    const globalRecord = await deps.store.get<BudgetRecord>(IMPROVISE_BUDGET_KEY);
    const globalReservation = reserveBudget(globalRecord, deps.now(), deps.config.dailyMax);
    if (!globalReservation.ok) {
      await recordStats("other");
      return {
        kind: "reject",
        response: {
          status: 503,
          retryAfterSeconds: globalReservation.retryAfterSeconds,
          reason: "daily budget",
        },
      };
    }

    const ipBudgetKey = IMPROVISE_IP_BUDGET_KEY_PREFIX + ipHash;
    const ipRecord = await deps.store.get<BudgetRecord>(ipBudgetKey);
    const ipReservation = reserveBudget(ipRecord, deps.now(), deps.config.dailyMaxPerIp);
    if (!ipReservation.ok) {
      await recordStats("other");
      return {
        kind: "reject",
        response: {
          status: 429,
          retryAfterSeconds: ipReservation.retryAfterSeconds,
          reason: "per-ip daily budget",
        },
      };
    }

    await deps.store.put(IMPROVISE_BUDGET_KEY, globalReservation.record);
    await deps.store.put(ipBudgetKey, ipReservation.record);
    await recordStats("upstream");

    const body = canonical.body;
    const promise = deps.inFlight.start(key, async () => {
      const result = await deps.callUpstream(body);
      if (result.ok) {
        await deps.store.put<CachedImprovisation>(key, {
          aId: a.id,
          bId: b.id,
          act,
          value: result.value,
          createdAt: deps.now(),
        });
      }
      return result;
    });
    return { kind: "pending", promise };
  });

  if (decision.kind === "reject") return decision.response;
  if (decision.kind === "hit") return { status: 200, value: decision.value };

  const result = await decision.promise;
  return result.ok
    ? { status: 200, value: result.value }
    : { status: 502, reason: result.reason };
}
