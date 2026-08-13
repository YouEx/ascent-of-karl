import {
  validateImproviseCopy,
  type ImproviseCopy,
} from "../core/improvise";

export const IMPROVISE_TIMEOUT_MS = 2500;
const ENDPOINT =
  (import.meta.env?.VITE_IMPROVISE_URL as string | undefined) ?? "";


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
      const copy = validateImproviseCopy(raw);
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

/** Holder async copy bundet til den senest relevante selection. */
export class CopyGenerationGuard {
  private generation = 0;
  private activeKey: string | null = null;

  begin(key: string): number {
    if (this.activeKey === key) return this.generation;
    this.generation++;
    this.activeKey = key;
    return this.generation;
  }

  abandon(): void {
    this.generation++;
    this.activeKey = null;
  }

  isCurrent(generation: number, key: string): boolean {
    return this.generation === generation && this.activeKey === key;
  }
}

/**
 * Guardet kontrolleres efter await og FØR callbacken. Alle save-/render-
 * sideeffekter skal ligge i callbacken, så en forladt selection er inert.
 */
export async function settleCurrentCopy<T>(
  pending: Promise<T>,
  guard: CopyGenerationGuard,
  generation: number,
  key: string,
  apply: (state: T) => void,
): Promise<boolean> {
  const state = await pending;
  if (!guard.isCurrent(generation, key)) return false;
  apply(state);
  return true;
}
