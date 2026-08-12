/**
 * Den tynde Cloudflare-tilpasning: forbinder Durable Object'ens rigtige
 * `storage` til den rene beslutning i `coordinator.ts`, og oversætter
 * resultatet til et rigtigt `Response`-objekt. Al LOGIK bor andre steder —
 * denne klasse pakker anmodningen ud, kalder `decide()`, pakker svaret ind.
 *
 * Én navngivet, global instans er hele koordinatoren (SEC-003/TASK-002-004):
 * lav spiltrafik gør ét globalt Durable Object til den simpleste pålidelige
 * løsning — ingen sharding, ingen KV ved siden af, ét stateful binding.
 */

import type { DurableObjectState } from "./cf-types";
import {
  createCoordinatorDeps,
  decide,
  type CoordinatorDeps,
  type CoordinatorResponse,
} from "./coordinator";
import { toNonNegativeInt, toPositiveInt } from "./env";
import { clientIpFromRequest, hashClientIp } from "./ip";
import { isBodyTooLarge } from "./validate";
import { callUpstreamOpenAI, type ModelEnv } from "./model";

export interface CoordinatorEnv extends ModelEnv {
  /** Saltet i IP-hashen. Uden det er hashen stadig ensrettet, men gættelig. */
  IP_HASH_SALT?: string;
  /** Sekunder i det rullende vindue (TASK-002). Se wrangler.toml for den målte default. */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** Kald tilladt pr. IP-hash pr. vindue (TASK-002). */
  RATE_LIMIT_MAX?: string;
  /** Globalt UTC-døgnloft over kald der når opstrøms (TASK-003). */
  DAILY_MAX_UPSTREAM_CALLS?: string;
}

// Konservative defaults, brugt hvis en var mangler i wrangler.toml. De
// RIGTIGE, målte tal bor i wrangler.toml's kommentarer og i
// plan/feature-live-narrator-1.md — disse er kun et sikkerhedsnet.
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_DAILY_MAX_UPSTREAM_CALLS = 350;

interface AdapterResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

/** Oversætter den rene beslutning til det HTTP-svar workeren skal give. */
function responseFor(result: CoordinatorResponse): AdapterResponse {
  if (result.status === 200) return { status: 200, body: { text: result.text } };
  if (result.status === 400) return { status: 400, body: { error: "bad request" } };
  if (result.status === 429) {
    return { status: 429, body: { error: "rate limited" }, retryAfterSeconds: result.retryAfterSeconds };
  }
  if (result.status === 503) {
    return {
      status: 503,
      body: { error: "daily budget exhausted" },
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
  return { status: 502, body: { error: "upstream" } };
}

export class Coordinator {
  private deps: CoordinatorDeps | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CoordinatorEnv,
  ) {}

  private getDeps(): CoordinatorDeps {
    if (!this.deps) {
      this.deps = createCoordinatorDeps({
        store: this.state.storage,
        callUpstream: (body) => callUpstreamOpenAI(body, this.env),
        config: {
          rateLimitWindowMs:
            toPositiveInt(this.env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS) * 1000,
          rateLimitMax: toPositiveInt(this.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
          dailyMax: toNonNegativeInt(this.env.DAILY_MAX_UPSTREAM_CALLS, DEFAULT_DAILY_MAX_UPSTREAM_CALLS),
        },
      });
    }
    return this.deps;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    // Størrelsen tjekkes på råteksten, FØR parsing — et kæmpe body skal ikke
    // engang JSON.parse'es, endsige røre budgettet.
    const rawText = await req.text();
    if (isBodyTooLarge(rawText)) {
      return new Response(JSON.stringify({ error: "body too large" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ error: "bad json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const ip = clientIpFromRequest(req);
    const ipHash = await hashClientIp(ip, this.env.IP_HASH_SALT ?? "karl-live-narrator");

    const result = await decide(parsed, ipHash, this.getDeps());
    const { status, body, retryAfterSeconds } = responseFor(result);

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);

    return new Response(JSON.stringify(body), { status, headers });
  }
}
