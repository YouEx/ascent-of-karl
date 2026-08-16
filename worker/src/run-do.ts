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
import {
  attemptCommentaryCue,
  openingCommentaryCue,
  runtimeCommentaryModelRequest,
  runtimeCommentaryTextHash,
  trimRuntimeCommentaryMemory,
  type RuntimeCommentaryCue,
  type RuntimeCommentaryRecord,
  type RuntimeCommentaryResult,
  type RuntimeCommentaryRole,
} from "../../src/product/runtime-commentary";
import {
  RUNTIME_TTS_INTERNAL_HEADER,
  type RuntimeTtsEnv,
} from "./runtime-tts";

const RUN_KEY = "run:v1";
export const RUN_INTERNAL_VERIFIED_HEADER = "x-internal-run-verified";
export const RUN_INTERNAL_INIT_HEADER = "x-internal-run-init";
export const RUNTIME_COMMENTARY_INTERNAL_HEADER =
  "x-internal-runtime-commentary";
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
  openingCue?: RuntimeCommentaryCue;
  commentary?: RuntimeCommentaryRecord[];
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
  commentaryCue?: RuntimeCommentaryCue;
}

interface RunEnv extends RuntimeTtsEnv {
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

function validCommentaryRequest(
  body: unknown,
): body is { schemaVersion: 1; eventId: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") === "eventId,schemaVersion" &&
    value.schemaVersion === 1 &&
    typeof value.eventId === "string" &&
    /^[a-z0-9:-]{1,96}$/i.test(value.eventId)
  );
}

function validRuntimeCommentaryResponse(
  body: unknown,
): body is {
  schemaVersion: 1;
  text: string;
  roles: RuntimeCommentaryRole[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return (
    value.schemaVersion === 1 &&
    typeof value.text === "string" &&
    Array.isArray(value.roles) &&
    value.roles.length > 0 &&
    value.roles.every((role) =>
      ["humour", "guidance", "story"].includes(String(role)),
    )
  );
}

interface RunOperationResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class Run {
  private readonly gate = new SerialGate();
  private readonly commentaryInFlight = new Map<
    string,
    Promise<RunOperationResponse>
  >();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: RunEnv,
  ) {}

  private async load(): Promise<StoredRun | undefined> {
    const run = await this.state.storage.get<StoredRun>(RUN_KEY);
    if (!run) return undefined;
    run.commentary ??= [];
    return run;
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
    const pathname = new URL(request.url).pathname;
    const audioMatch = /\/commentary\/([^/]+)\/audio$/.exec(
      pathname,
    );
    if (audioMatch) {
      return this.handleCommentaryAudio(
        request,
        decodeURIComponent(audioMatch[1]!),
      );
    }
    if (pathname.endsWith("/commentary")) {
      return this.handleCommentary(request);
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
        openingCue: openingCommentaryCue(content, engine.getState()),
        commentary: [],
      };
      await this.state.storage.put(RUN_KEY, run);
      await this.state.storage.setAlarm(Date.now() + ACTIVE_RETENTION_MS);
      return json(201, {
        schemaVersion: 1,
        revision: 0,
        snapshot: run.state,
        commentaryCue: run.openingCue,
      });
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
    const before = structuredClone(run.state);
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
    const commentaryCue = attemptCommentaryCue({
      attemptId: body.attemptId,
      content,
      before,
      after: run.state,
      outcome,
    });
    const response: RunAttemptResponse = {
      schemaVersion: 1,
      attemptId: body.attemptId,
      revision: run.revision,
      outcome,
      snapshot: run.state,
      ...(commentaryCue ? { commentaryCue } : {}),
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

  private commentaryCue(
    run: StoredRun,
    eventId: string,
  ): RuntimeCommentaryCue | undefined {
    if (run.openingCue?.eventId === eventId) return run.openingCue;
    return run.attempts
      .map((attempt) => attempt.response.commentaryCue)
      .find((cue) => cue?.eventId === eventId);
  }

  private operationResponse(result: RunOperationResponse): Response {
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "content-type": "application/json",
        ...(result.headers ?? {}),
      },
    });
  }

  private commentaryResult(
    record: RuntimeCommentaryRecord,
  ): RuntimeCommentaryResult {
    return {
      schemaVersion: 1,
      eventId: record.eventId,
      text: record.text,
      roles: record.roles,
      audioAvailable: Boolean(this.env.CARTESIA_API_KEY),
    };
  }

  private async handleCommentary(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json(405, { error: "POST only" });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "bad json" });
    }
    if (!validCommentaryRequest(body)) {
      return json(400, { error: "invalid commentary request" });
    }
    const prepared = await this.gate.run(async () => {
      const run = await this.load();
      if (!run) {
        return {
          kind: "response" as const,
          result: {
            status: 404,
            body: { error: "run not found" },
          },
        };
      }
      const prior = run.commentary?.find(
        (record) => record.eventId === body.eventId,
      );
      if (prior) {
        return {
          kind: "response" as const,
          result: {
            status: 200,
            body: this.commentaryResult(prior),
          },
        };
      }
      const cue = this.commentaryCue(run, body.eventId);
      if (!cue) {
        return {
          kind: "response" as const,
          result: {
            status: 404,
            body: { error: "commentary cue not found" },
          },
        };
      }
      const existing = this.commentaryInFlight.get(body.eventId);
      if (existing) {
        return { kind: "pending" as const, promise: existing };
      }
      const modelRequest = runtimeCommentaryModelRequest({
        state: run.state,
        cue,
        records: run.commentary ?? [],
      });
      const promise = this.generateCommentary(
        request,
        body.eventId,
        cue,
        modelRequest,
      ).finally(() => {
        this.commentaryInFlight.delete(body.eventId);
      });
      this.commentaryInFlight.set(body.eventId, promise);
      return { kind: "pending" as const, promise };
    });
    if (prepared.kind === "response") {
      return this.operationResponse(prepared.result);
    }
    return this.operationResponse(await prepared.promise);
  }

  private async generateCommentary(
    request: Request,
    eventId: string,
    cue: RuntimeCommentaryCue,
    modelRequest: ReturnType<typeof runtimeCommentaryModelRequest>,
  ): Promise<RunOperationResponse> {
    const coordinatorId = this.env.COORDINATOR.idFromName("global");
    const headers = new Headers({
      "content-type": "application/json",
      [RUNTIME_COMMENTARY_INTERNAL_HEADER]: "1",
    });
    const ipHash = request.headers.get(INTERNAL_IP_HASH_HEADER);
    if (ipHash) headers.set(INTERNAL_IP_HASH_HEADER, ipHash);
    const response = await this.env.COORDINATOR.get(coordinatorId).fetch(
      new Request("https://internal.example/runtime-commentary", {
        method: "POST",
        headers,
        body: JSON.stringify(modelRequest),
      }),
    );
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      return {
        status: response.status,
        body: { error: "runtime commentary unavailable" },
        ...(retryAfter
          ? { headers: { "retry-after": retryAfter } }
          : {}),
      };
    }
    const generated: unknown = await response.json();
    if (!validRuntimeCommentaryResponse(generated)) {
      return {
        status: 502,
        body: { error: "invalid runtime commentary" },
      };
    }
    const normalizedHash = runtimeCommentaryTextHash(generated.text);
    return this.gate.run(async () => {
      const run = await this.load();
      if (!run) {
        return { status: 404, body: { error: "run not found" } };
      }
      const prior = run.commentary?.find(
        (record) => record.eventId === eventId,
      );
      if (prior) {
        return {
          status: 200,
          body: this.commentaryResult(prior),
        };
      }
      if (
        run.commentary?.some(
          (record) => record.normalizedHash === normalizedHash,
        )
      ) {
        return {
          status: 502,
          body: { error: "duplicate runtime commentary" },
        };
      }
      const record: RuntimeCommentaryRecord = {
        schemaVersion: 1,
        eventId,
        cue,
        text: generated.text,
        roles: generated.roles,
        normalizedHash,
      };
      run.commentary = trimRuntimeCommentaryMemory([
        ...(run.commentary ?? []),
        record,
      ]);
      await this.state.storage.put(RUN_KEY, run);
      await this.state.storage.setAlarm(
        Date.now() +
          (run.status === "ended"
            ? ENDED_RETENTION_MS
            : ACTIVE_RETENTION_MS),
      );
      return {
        status: 200,
        body: this.commentaryResult(record),
      };
    });
  }

  private async handleCommentaryAudio(
    request: Request,
    eventId: string,
  ): Promise<Response> {
    if (request.method !== "GET") {
      return json(405, { error: "GET only" });
    }
    const prepared = await this.gate.run(async () => {
      const run = await this.load();
      if (!run) {
        return {
          ok: false as const,
          response: json(404, { error: "run not found" }),
        };
      }
      const record = run.commentary?.find(
        (entry) => entry.eventId === eventId,
      );
      if (!record) {
        return {
          ok: false as const,
          response: json(404, {
            error: "runtime commentary not found",
          }),
        };
      }
      return { ok: true as const, text: record.text };
    });
    if (!prepared.ok) return prepared.response;
    const id = this.env.COORDINATOR.idFromName("global");
    const headers = new Headers({
      "content-type": "application/json",
      [RUNTIME_TTS_INTERNAL_HEADER]: "1",
    });
    const ipHash = request.headers.get(INTERNAL_IP_HASH_HEADER);
    if (ipHash) headers.set(INTERNAL_IP_HASH_HEADER, ipHash);
    return this.env.COORDINATOR.get(id).fetch(
      new Request("https://internal.example/runtime-tts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          schemaVersion: 1,
          text: prepared.text,
        }),
      }),
    );
  }

  async alarm(): Promise<void> {
    await this.state.storage.delete(RUN_KEY);
  }
}
