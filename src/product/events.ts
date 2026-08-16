import {
  EVENT_CAPABILITY,
  EVENT_SCENARIOS,
  type CapabilityId,
  type ProductEventType,
  type ScenarioId,
} from "./generated/contracts";
import {
  appendProductEvent,
  clearProductEventJournal,
  readProductEventJournal,
  type KeyValueStorage,
} from "./local-event-store";

type Pair = readonly [string, string];
type Verdict =
  | "locked"
  | "near-miss"
  | "self"
  | "inert"
  | "clash"
  | "plausible"
  | "absurd";

export interface ProductEventMap {
  "life.started": {
    mode: "new" | "continue" | "replay";
    seed: number;
    saveVersion: 1 | 2;
    act: number;
  };
  "combination.attempted": {
    pair: Pair;
    outcome:
      | "discovery"
      | "known"
      | "gated"
      | "nofuse"
      | "improvised"
      | "improvise-rejected";
    resultId: string | null;
    verdict: Verdict | null;
    rejectionReason:
      | "canonical-recipe"
      | "verdict"
      | "depth-limit"
      | "run-limit"
      | null;
  };
  "discovery.canonical": {
    pair: Pair;
    elementId: string;
    solvedNeedId: string | null;
    ageUp: boolean;
    endingDeflected: boolean;
  };
  "invention.accepted": {
    pair: Pair;
    elementId: string;
    reused: boolean;
    solvedNeedId: string | null;
    solvedChallengeId: string | null;
    copySource: "fallback" | "worker-copy";
    historicalClaim: false;
  };
  "narrator.presented": {
    lineId: string;
    variant: number;
    text: string;
    roles: readonly ("humour" | "guidance" | "story")[];
    audioMode: "recorded" | "synthesized" | "text-only" | "muted";
  };
  "need.updated": {
    cause: "life-started" | "attempt" | "age-up" | "challenge";
    activeNeedId: string | null;
    needs: readonly {
      id: string;
      required: boolean;
      status: "active" | "solved";
    }[];
  };
  "challenge.updated": {
    challengeId: string;
    status: "spawned" | "ticking" | "solved" | "failed";
    turnsLeft: number | null;
    resolvedByElementId: string | null;
  };
  "chronicle.entry-recorded": {
    entryId: string;
    kind:
      | "canonical-discovery"
      | "invention"
      | "known-result"
      | "blocked-progress"
      | "attempt"
      | "fate";
    relatedId: string | null;
    canonical: boolean;
  };
  "compendium.progressed": {
    reason: "discovery" | "branch" | "fate" | "load";
    completed: number;
    total: number;
  };
  "fate.unlocked": {
    endingId: string;
    newlyUnlocked: boolean;
    cause: "combination" | "challenge" | "turn-limit";
    totalUnlocked: number;
  };
  "life.archived": {
    lifeId: string;
    outcome: "ending" | "abandoned";
    historyCompleteness: "full" | "legacy-summary";
  };
  "life.replay-started": {
    fromEndingId: string;
    target:
      | {
          kind: "discovery" | "branch" | "fate" | "seed" | "invention-path";
          id: string;
        }
      | null;
    nextSeed: number;
  };
  "platform.session-ready": {
    status: "ready" | "network-unavailable";
    onlineRequired: boolean;
    activePlayAllowed: boolean;
    archivesReadable: boolean;
  };
}

export type ProductEvent<K extends ProductEventType> = Readonly<{
  schemaVersion: 1;
  sequence: number;
  type: K;
  capability: CapabilityId;
  scenario: ScenarioId;
  turn: number;
  payload: Readonly<ProductEventMap[K]>;
}>;

export type AnyProductEvent = {
  [K in ProductEventType]: ProductEvent<K>;
}[ProductEventType];

export type ProductEventInput<K extends ProductEventType> = Readonly<{
  type: K;
  scenario: ScenarioId;
  turn: number;
  payload: ProductEventMap[K];
}>;

type Subscriber = (event: AnyProductEvent) => void;

export interface ProductEventBusOptions {
  storage?: KeyValueStorage | null;
  dispatch?: (event: AnyProductEvent) => void;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export class ProductEventBus {
  private sequence = 0;
  private lifeEvents: AnyProductEvent[] | null = null;
  private readonly subscribers = new Set<Subscriber>();
  private readonly storage: KeyValueStorage | null;
  private readonly dispatch?: (event: AnyProductEvent) => void;

  constructor(options: ProductEventBusOptions = {}) {
    this.storage = options.storage ?? null;
    this.dispatch = options.dispatch;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  emit<K extends ProductEventType>(
    input: ProductEventInput<K>,
  ): ProductEvent<K> {
    if (!Number.isInteger(input.turn) || input.turn < 0) {
      throw new Error(`product event turn must be a non-negative integer`);
    }
    const validScenarios: readonly ScenarioId[] =
      EVENT_SCENARIOS[input.type];
    if (!validScenarios.includes(input.scenario)) {
      throw new Error(
        `${input.type} is not valid in product scenario ${input.scenario}`,
      );
    }
    const event = deepFreeze({
      schemaVersion: 1 as const,
      sequence: ++this.sequence,
      type: input.type,
      capability: EVENT_CAPABILITY[input.type],
      scenario: input.scenario,
      turn: input.turn,
      payload: structuredClone(input.payload),
    }) as ProductEvent<K>;

    appendProductEvent(this.storage, event as AnyProductEvent);
    this.lifeEvents?.push(event as AnyProductEvent);
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event as AnyProductEvent);
      } catch {
        // Evidence observers cannot block the authoritative transition.
      }
    }
    try {
      this.dispatch?.(event as AnyProductEvent);
    } catch {
      // The browser test bridge is optional evidence.
    }
    return event;
  }

  journal(): AnyProductEvent[] {
    return readProductEventJournal(this.storage);
  }

  exportJournal(): string {
    return `${JSON.stringify(this.journal(), null, 2)}\n`;
  }

  clearJournal(): void {
    clearProductEventJournal(this.storage);
  }

  startLifeJournal(existing: readonly AnyProductEvent[] = []): void {
    this.lifeEvents = existing.map((event) => structuredClone(event));
    this.sequence = Math.max(
      this.sequence,
      ...existing.map((event) => event.sequence),
      0,
    );
  }

  lifeJournal(): AnyProductEvent[] {
    return structuredClone(this.lifeEvents ?? []);
  }

  endLifeJournal(): void {
    this.lifeEvents = null;
  }
}

export function createBrowserProductEventBus(): ProductEventBus {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return new ProductEventBus({
    storage,
    dispatch(event) {
      window.dispatchEvent(
        new CustomEvent<AnyProductEvent>("product:event", { detail: event }),
      );
    },
  });
}
