import { loadContent } from "../../src/content";
import { Engine, type GameState } from "../../src/core/engine";
import { deriveLifePlan } from "../../src/core/seed";
import type { GeneratedGameplayProposal } from "../../src/core/generated-validator";
import { deriveGeneratedCandidateSet } from "../../src/core/generated-candidates";
import type {
  DurableObjectNamespace,
  DurableObjectState,
} from "./cf-types";
import { INTERNAL_IP_HASH_HEADER } from "./ip";
import { SerialGate } from "./concurrency";
import { GENERATED_INTERNAL_CANDIDATES_HEADER } from "./generated-catalog";

const RUN_KEY = "run:v1";
export const RUN_INTERNAL_VERIFIED_HEADER = "x-internal-run-verified";
export const RUN_INTERNAL_INIT_HEADER = "x-internal-run-init";
const MAX_IDEMPOTENCY = 50;
const ACTIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ENDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredAttempt {
  attemptId: string;
  revision: number;
  response: RunAttemptResponse;
}

interface StoredRun {
  schemaVersion: 1;
  runId: string;
  revision: number;
  startedAt: string;
  status: "active" | "ended";
  state: GameState;
  attempts: StoredAttempt[];
  rateTimestamps: number[];
}

interface RunInitRequest {
  schemaVersion: 1;
  runId: string;
  seed: number;
  startedAt: string;
}

interface RunAttemptRequest {
  schemaVersion: 1;
  attemptId: string;
  expectedRevision: number;
  pair: [string, string];
}

interface RunAttemptResponse {
  schemaVersion: 1;
  attemptId: string;
  revision: number;
  outcome: unknown;
  snapshot: GameState;
}

interface RunEnv {
  COORDINATOR: DurableObjectNamespace;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validAttempt(body: unknown): body is RunAttemptRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Partial<RunAttemptRequest>;
  return (
    value.schemaVersion === 1 &&
    typeof value.attemptId === "string" &&
    /^[0-9a-f-]{16,64}$/i.test(value.attemptId) &&
    Number.isInteger(value.expectedRevision) &&
    Array.isArray(value.pair) &&
    value.pair.length === 2 &&
    value.pair.every((id) => typeof id === "string" && id.length <= 96)
  );
}

export class Run {
  private readonly gate = new SerialGate();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: RunEnv,
  ) {}

  private async load(): Promise<StoredRun | undefined> {
    return this.state.storage.get<StoredRun>(RUN_KEY);
  }

  private async generatedProposal(
    request: Request,
    run: StoredRun,
    engine: Engine,
    pair: [string, string],
  ): Promise<GeneratedGameplayProposal | Response> {
    const id = this.env.COORDINATOR.idFromName("global");
    const stub = this.env.COORDINATOR.get(id);
    const headers = new Headers({
      "content-type": "application/json",
      [GENERATED_INTERNAL_CANDIDATES_HEADER]: "1",
    });
    const ipHash = request.headers.get(INTERNAL_IP_HASH_HEADER);
    if (ipHash) headers.set(INTERNAL_IP_HASH_HEADER, ipHash);
    const first = engine.element(pair[0]);
    const second = engine.element(pair[1]);
    const candidates = deriveGeneratedCandidateSet(first, second);
    const response = await stub.fetch(
      new Request("https://internal.example/generated", {
        method: "POST",
        headers,
        body: JSON.stringify({
          schemaVersion: 1,
          a: first,
          b: second,
          act: run.state.act,
          candidates,
        }),
      }),
    );
    if (!response.ok) {
      return json(response.status, {
        error: "generated gameplay unavailable",
        retryAfter: response.headers.get("retry-after"),
      });
    }
    return (await response.json()) as GeneratedGameplayProposal;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get(RUN_INTERNAL_INIT_HEADER) === "1") {
      return this.gate.run(() => this.initialize(request));
    }

    if (request.headers.get(RUN_INTERNAL_VERIFIED_HEADER) !== "1") {
      return json(503, { error: "missing verified run capability" });
    }
    return this.gate.run(() => this.handleVerified(request));
  }

  private async initialize(request: Request): Promise<Response> {
      if (request.method !== "POST") return json(405, { error: "POST only" });
      if (await this.load()) return json(409, { error: "run exists" });
      const body = (await request.json()) as RunInitRequest;
      const content = loadContent();
      const variation = content.lifeVariation;
      const revision = content.completionManifest?.contentRevision;
      if (
        body.schemaVersion !== 1 ||
        !variation ||
        !revision ||
        typeof body.runId !== "string" ||
        !Number.isInteger(body.seed) ||
        typeof body.startedAt !== "string"
      ) {
        return json(400, { error: "invalid run init" });
      }
      const plan = deriveLifePlan(variation, revision, body.seed);
      const engine = new Engine(content, undefined, { lifePlan: plan });
      const run: StoredRun = {
        schemaVersion: 1,
        runId: body.runId,
        revision: 0,
        startedAt: body.startedAt,
        status: "active",
        state: engine.getState(),
        attempts: [],
        rateTimestamps: [],
      };
      await this.state.storage.put(RUN_KEY, run);
      await this.state.storage.setAlarm(Date.now() + ACTIVE_RETENTION_MS);
      return json(201, { schemaVersion: 1, revision: 0, snapshot: run.state });
  }

  private async handleVerified(request: Request): Promise<Response> {
    const run = await this.load();
    if (!run) return json(404, { error: "run not found" });
    if (request.method === "GET") {
      return json(200, {
        schemaVersion: 1,
        revision: run.revision,
        status: run.status,
        snapshot: run.state,
      });
    }
    if (request.method === "DELETE") {
      await this.state.storage.delete(RUN_KEY);
      return json(200, { deleted: true });
    }
    if (request.method !== "POST") return json(405, { error: "method" });

    const now = Date.now();
    run.rateTimestamps = (run.rateTimestamps ?? []).filter(
      (timestamp) => now - timestamp < 60_000,
    );
    if (run.rateTimestamps.length >= 30) {
      return new Response(
        JSON.stringify({ error: "run rate limited" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "60",
          },
        },
      );
    }
    run.rateTimestamps.push(now);
    // Reserve the slot durably before parsing/model work, so malformed and
    // failed requests cannot bypass the per-run ceiling.
    await this.state.storage.put(RUN_KEY, run);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "bad json" });
    }
    if (!validAttempt(body)) return json(400, { error: "invalid attempt" });
    const prior = run.attempts.find((entry) => entry.attemptId === body.attemptId);
    if (prior) return json(200, prior.response);
    if (body.expectedRevision !== run.revision) {
      return json(409, {
        error: "revision conflict",
        revision: run.revision,
        snapshot: run.state,
      });
    }
    if (run.status !== "active") return json(409, { error: "run ended" });

    const content = loadContent();
    const engine = new Engine(content, run.state);
    let outcome;
    try {
      if (engine.matchCombo(body.pair[0], body.pair[1])) {
        outcome = engine.combine(body.pair[0], body.pair[1]);
      } else {
        const proposal = await this.generatedProposal(
          request,
          run,
          engine,
          body.pair,
        );
        if (proposal instanceof Response) return proposal;
        outcome = engine.attemptGenerated(body.pair[0], body.pair[1], proposal);
      }
    } catch (error) {
      return json(400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    run.revision++;
    run.state = engine.getState();
    run.status = run.state.ended ? "ended" : "active";
    const response: RunAttemptResponse = {
      schemaVersion: 1,
      attemptId: body.attemptId,
      revision: run.revision,
      outcome,
      snapshot: run.state,
    };
    run.attempts.push({ attemptId: body.attemptId, revision: run.revision, response });
    run.attempts = run.attempts.slice(-MAX_IDEMPOTENCY);
    await this.state.storage.put(RUN_KEY, run);
    await this.state.storage.setAlarm(
      Date.now() +
        (run.status === "ended" ? ENDED_RETENTION_MS : ACTIVE_RETENTION_MS),
    );
    return json(200, response);
  }

  async alarm(): Promise<void> {
    await this.state.storage.delete(RUN_KEY);
  }
}
