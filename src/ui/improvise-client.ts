import type { ImproviseCopy } from "../core/improvise";

export const IMPROVISE_TIMEOUT_MS = 2500;
const ENDPOINT =
  (import.meta.env?.VITE_IMPROVISE_URL as string | undefined) ?? "";

const NAME_CHARS = 48;
const NAME_WORDS = 3;
const FLAVOR_CHARS = 240;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const QUOTES = /["'`“”‘’«»]/;
const URL =
  /(?:https?:\/\/|www\.|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\/\S*)?)/i;
const PUNCTUATION_WILDERNESS = /[!?.,;:—–-]{3,}/;
const UNSAFE_PUNCTUATION = /[{}\[\]<>\\|@#$%^*_+=~\/]/;
const SAFE_NAME = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
const SAFE_FLAVOR = /^[\p{L}\p{N}\p{Zs}.,!?;:()—–-]+$/u;

export interface ImproviseRequest {
  a: string;
  b: string;
  act: number;
}

export type ImproviseCopyState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      copy: ImproviseCopy;
      latencyMs: number;
    }
  | {
      status: "fallback";
      reason:
        | "no-endpoint"
        | "noncanonical"
        | "network"
        | "response"
        | "timeout";
      latencyMs?: number;
      timeout: boolean;
    };

export class ImproviseClient {
  private readonly states = new Map<string, ImproviseCopyState>();
  private readonly inFlight = new Map<string, Promise<ImproviseCopyState>>();

  constructor(private readonly endpoint = ENDPOINT) {}

  private key(a: string, b: string, act: number): string {
    const [first, second] = a <= b ? [a, b] : [b, a];
    return `${first}+${second}:act:${act}`;
  }

  get(a: string, b: string, act: number): ImproviseCopy | undefined {
    const state = this.states.get(this.key(a, b, act));
    return state?.status === "ready" ? state.copy : undefined;
  }

  state(a: string, b: string, act: number): ImproviseCopyState {
    if (!this.endpoint) {
      return {
        status: "fallback",
        reason: "no-endpoint",
        timeout: false,
      };
    }
    return this.states.get(this.key(a, b, act)) ?? { status: "idle" };
  }

  async prefetch(req: ImproviseRequest): Promise<ImproviseCopyState> {
    if (!this.endpoint) return this.state(req.a, req.b, req.act);
    const key = this.key(req.a, req.b, req.act);
    const known = this.states.get(key);
    if (known && known.status !== "loading") return known;
    const busy = this.inFlight.get(key);
    if (busy) return busy;

    this.states.set(key, { status: "loading" });
    const pending = this.fetchCopy(req)
      .then((state) => {
        this.states.set(key, state);
        return state;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  private async fetchCopy(req: ImproviseRequest): Promise<ImproviseCopyState> {
    const startedAt = Date.now();
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, IMPROVISE_TIMEOUT_MS);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          a: req.a,
          b: req.b,
          act: req.act,
        }),
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          status: "fallback",
          reason: "response",
          latencyMs,
          timeout: false,
        };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return {
          status: "fallback",
          reason: "response",
          latencyMs,
          timeout: false,
        };
      }
      const copy = validateCopy(raw);
      return copy
        ? { status: "ready", copy, latencyMs }
        : {
            status: "fallback",
            reason: "response",
            latencyMs,
            timeout: false,
          };
    } catch {
      const latencyMs = Date.now() - startedAt;
      return {
        status: "fallback",
        reason: timedOut ? "timeout" : "network",
        latencyMs,
        timeout: timedOut,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeCommon(value: string): boolean {
  return (
    value === value.trim() &&
    !CONTROL_CHARS.test(value) &&
    !QUOTES.test(value) &&
    !URL.test(value) &&
    !PUNCTUATION_WILDERNESS.test(value) &&
    !UNSAFE_PUNCTUATION.test(value)
  );
}

/** Strikt svarskontrakt: eksakt {name,flavor}; ugyldigt bliver aldrig renset. */
function validateCopy(raw: unknown): ImproviseCopy | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "flavor" || keys[1] !== "name") {
    return undefined;
  }
  if (typeof body.name !== "string" || typeof body.flavor !== "string") {
    return undefined;
  }
  const { name, flavor } = body;
  if (
    name.length === 0 ||
    name.length > NAME_CHARS ||
    name.split(/\s+/).length > NAME_WORDS ||
    !SAFE_NAME.test(name) ||
    !safeCommon(name)
  ) {
    return undefined;
  }
  if (
    flavor.length === 0 ||
    flavor.length > FLAVOR_CHARS ||
    !SAFE_FLAVOR.test(flavor) ||
    !safeCommon(flavor)
  ) {
    return undefined;
  }
  return { name, flavor };
}
