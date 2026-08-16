import { reserveBudget, type BudgetRecord } from "./budget";
import { SerialGate, InFlightRegistry } from "./concurrency";
import type { KeyValueStore } from "./store";
import {
  resolveGeneratedBody,
  resolveGeneratedSelectionBody,
  type CanonicalGeneratedBody,
  type GeneratedCatalogResult,
} from "./generated-catalog";
import {
  type GeneratedUpstreamResult,
} from "./generated-model";
import {
  validateImproviseBody,
  type ImproviseWireRequest,
} from "./improvise-validate";
import type { GeneratedGameplayProposal } from "../../src/core/generated-validator";

const CACHE_PREFIX = "generated-cache:";
const BUDGET_KEY = "budget:generated";
const IP_BUDGET_PREFIX = "budget:generated:ip:";

export interface GeneratedConfig {
  dailyMax: number;
  dailyMaxPerIp: number;
  cacheNamespace: string;
}

export interface GeneratedDeps {
  store: KeyValueStore;
  now: () => number;
  callUpstream: (body: CanonicalGeneratedBody) => Promise<GeneratedUpstreamResult>;
  resolveCanonical: (wire: ImproviseWireRequest) => GeneratedCatalogResult;
  config: GeneratedConfig;
  gate: SerialGate;
  inFlight: InFlightRegistry<GeneratedUpstreamResult>;
}

export type GeneratedResponse =
  | { status: 200; value: GeneratedGameplayProposal }
  | { status: 400; reason: string }
  | { status: 429; retryAfterSeconds: number; reason: string }
  | { status: 503; retryAfterSeconds: number; reason: string }
  | { status: 502 | 504; reason: string };

export function createGeneratedDeps(options: {
  store: KeyValueStore;
  config: GeneratedConfig;
  callUpstream: GeneratedDeps["callUpstream"];
  resolveCanonical?: GeneratedDeps["resolveCanonical"];
  now?: () => number;
}): GeneratedDeps {
  return {
    store: options.store,
    config: options.config,
    callUpstream: options.callUpstream,
    resolveCanonical: options.resolveCanonical ?? resolveGeneratedBody,
    now: options.now ?? (() => Date.now()),
    gate: new SerialGate(),
    inFlight: new InFlightRegistry<GeneratedUpstreamResult>(),
  };
}

function cacheKey(
  body: CanonicalGeneratedBody,
  namespace: string,
): string {
  return `${CACHE_PREFIX}${namespace}:${body.a.id}+${body.b.id}:act:${body.act}`;
}

export async function decideGenerated(
  rawBody: unknown,
  ipHash: string,
  deps: GeneratedDeps,
): Promise<GeneratedResponse> {
  const validated = validateImproviseBody(rawBody);
  if (!validated.ok) {
    return { status: 400, reason: validated.reason };
  }
  return decideResolvedGenerated(
    deps.resolveCanonical(validated.body),
    ipHash,
    deps,
  );
}

export async function decideGeneratedSelection(
  rawBody: unknown,
  ipHash: string,
  deps: GeneratedDeps,
): Promise<GeneratedResponse> {
  return decideResolvedGenerated(
    resolveGeneratedSelectionBody(rawBody),
    ipHash,
    deps,
  );
}

async function decideResolvedGenerated(
  canonical: GeneratedCatalogResult,
  ipHash: string,
  deps: GeneratedDeps,
): Promise<GeneratedResponse> {
  const decision = await deps.gate.run(async () => {
    if (!canonical.ok) {
      return { kind: "response" as const, response: { status: 400 as const, reason: canonical.reason } };
    }
    const key = cacheKey(canonical.body, deps.config.cacheNamespace);
    const cached = await deps.store.get<GeneratedGameplayProposal>(key);
    if (cached) return { kind: "response" as const, response: { status: 200 as const, value: cached } };
    const existing = deps.inFlight.get(key);
    if (existing) return { kind: "pending" as const, promise: existing };

    const now = deps.now();
    const global = reserveBudget(
      await deps.store.get<BudgetRecord>(BUDGET_KEY),
      now,
      deps.config.dailyMax,
    );
    if (!global.ok) {
      return {
        kind: "response" as const,
        response: {
          status: 503 as const,
          reason: "daily budget",
          retryAfterSeconds: global.retryAfterSeconds,
        },
      };
    }
    const ipKey = IP_BUDGET_PREFIX + ipHash;
    const perIp = reserveBudget(
      await deps.store.get<BudgetRecord>(ipKey),
      now,
      deps.config.dailyMaxPerIp,
    );
    if (!perIp.ok) {
      return {
        kind: "response" as const,
        response: {
          status: 429 as const,
          reason: "per-ip daily budget",
          retryAfterSeconds: perIp.retryAfterSeconds,
        },
      };
    }
    await deps.store.put(BUDGET_KEY, global.record);
    await deps.store.put(ipKey, perIp.record);
    const promise = deps.inFlight.start(key, async () => {
      const result = await deps.callUpstream(canonical.body);
      if (result.ok) await deps.store.put(key, result.value);
      return result;
    });
    return { kind: "pending" as const, promise };
  });
  if (decision.kind === "response") return decision.response;
  const result = await decision.promise;
  return result.ok
    ? { status: 200, value: result.value }
    : { status: result.status === 504 ? 504 : 502, reason: result.reason };
}
