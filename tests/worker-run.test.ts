import { describe, expect, it } from "vitest";
import { Run } from "../worker/src/run-do";
import {
  createRunCapability,
  verifyRunCapability,
} from "../worker/src/run-auth";
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
} from "../worker/src/cf-types";

class FakeStorage implements DurableObjectStorage {
  readonly values = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    return new Map(
      [...this.values]
        .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => [key, value as T]),
    );
  }
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async setAlarm(): Promise<void> {}
}

class Stub implements DurableObjectStub {
  constructor(private readonly proposal: unknown) {}
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify(this.proposal), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

class DelayedStub implements DurableObjectStub {
  private release!: () => void;
  private readonly ready = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(private readonly proposal: unknown) {}

  resolve(): void {
    this.release();
  }

  async fetch(): Promise<Response> {
    await this.ready;
    return new Response(JSON.stringify(this.proposal), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

class FailingStub implements DurableObjectStub {
  calls = 0;

  async fetch(): Promise<Response> {
    this.calls++;
    return new Response(JSON.stringify({ error: "upstream" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

class CandidateStub implements DurableObjectStub {
  readonly bodies: unknown[] = [];

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      candidates?: { candidateKey?: string }[];
    };
    this.bodies.push(body);
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        candidateKey: body.candidates?.[0]?.candidateKey,
        presentationKey: "plain",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

class Namespace implements DurableObjectNamespace {
  constructor(private readonly stub: DurableObjectStub) {}
  idFromName(name: string): DurableObjectId {
    return { toString: () => name };
  }
  get(): DurableObjectStub {
    return this.stub;
  }
}

function request(
  path: string,
  options: RequestInit & { internal?: "init" | "verified" } = {},
) {
  const headers = new Headers(options.headers);
  if (options.internal === "init") headers.set("x-internal-run-init", "1");
  if (options.internal === "verified") {
    headers.set("x-internal-run-verified", "1");
    headers.set("x-internal-ip-hash", "a".repeat(64));
  }
  return new Request(`https://internal.example${path}`, {
    ...options,
    headers,
  });
}

describe("run capability and authoritative Run Durable Object", () => {
  it("signs, verifies, expires, and binds capability to run plus CSRF", async () => {
    const created = await createRunCapability({
      secret: "test-secret",
      runId: "run-1",
      now: 1_000_000,
      lifetimeSeconds: 60,
    });
    expect(
      await verifyRunCapability({
        secret: "test-secret",
        token: created.token,
        csrf: created.capability.csrf,
        runId: "run-1",
        now: 1_030_000,
      }),
    ).toEqual(created.capability);
    expect(
      await verifyRunCapability({
        secret: "test-secret",
        token: created.token,
        csrf: "wrong",
        runId: "run-1",
        now: 1_030_000,
      }),
    ).toBeNull();
    expect(
      await verifyRunCapability({
        secret: "test-secret",
        token: created.token,
        csrf: created.capability.csrf,
        runId: "run-1",
        now: 1_061_000,
      }),
    ).toBeNull();
  });

  it("defaults run capabilities to the full 30-day retention window", async () => {
    const now = 1_000_000;
    const created = await createRunCapability({
      secret: "test-secret",
      runId: "run-30d",
      now,
    });
    expect(created.capability.expiresAt).toBe(
      Math.floor(now / 1000) + 30 * 24 * 60 * 60,
    );
  });

  it("initializes once, commits canonical attempts, and is idempotent", async () => {
    const storage = new FakeStorage();
    const state: DurableObjectState = { storage };
    const run = new Run(state, {
      COORDINATOR: new Namespace(
        new Stub({
          schemaVersion: 1,
          candidateKey: "hybrid:graes+pind",
          presentationKey: "plain",
        }),
      ),
    });
    const init = await run.fetch(
      request("/api/v1/runs/run-1", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-1",
          seed: 42,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );
    expect(init.status).toBe(201);
    const initial = (await init.json()) as { snapshot: { discovered: string[] } };
    expect(initial.snapshot.discovered).toHaveLength(5);

    const body = {
      schemaVersion: 1,
      attemptId: "12345678-1234-1234-1234-123456789012",
      expectedRevision: 0,
      pair: ["sten", "sten"],
    };
    const first = await run.fetch(
      request("/api/v1/runs/run-1/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(first.status).toBe(200);
    const result = (await first.json()) as {
      revision: number;
      outcome: { kind: string };
    };
    expect(result.revision).toBe(1);
    expect(result.outcome.kind).toBe("discovery");

    const replay = await run.fetch(
      request("/api/v1/runs/run-1/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(await replay.json()).toEqual(result);
  });

  it("uses bounded generated selection and rejects stale revisions", async () => {
    const run = new Run(
      { storage: new FakeStorage() },
      {
        COORDINATOR: new Namespace(
          new Stub({
            schemaVersion: 1,
            candidateKey: "hybrid:graes+pind",
            presentationKey: "quiet-regret",
          }),
        ),
      },
    );
    await run.fetch(
      request("/api/v1/runs/run-2", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-2",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );
    const generated = await run.fetch(
      request("/api/v1/runs/run-2/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          attemptId: "abcdefab-1234-1234-1234-123456789012",
          expectedRevision: 0,
          pair: ["graes", "pind"],
        }),
      }),
    );
    expect(generated.status).toBe(200);
    const result = (await generated.json()) as {
      outcome: { kind: string; element?: { generatedOperation?: string } };
    };
    expect(result.outcome.kind).toBe("improvised");
    expect(result.outcome.element?.generatedOperation).toBe("hybrid");

    const stale = await run.fetch(
      request("/api/v1/runs/run-2/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          attemptId: "bbbbbbbb-1234-1234-1234-123456789012",
          expectedRevision: 0,
          pair: ["sten", "sten"],
        }),
      }),
    );
    expect(stale.status).toBe(409);
  });

  it("serializes concurrent attempts so only one revision commits", async () => {
    const delayed = new DelayedStub({
      schemaVersion: 1,
      candidateKey: "hybrid:graes+pind",
      presentationKey: "plain",
    });
    const run = new Run(
      { storage: new FakeStorage() },
      { COORDINATOR: new Namespace(delayed) },
    );
    await run.fetch(
      request("/api/v1/runs/run-3", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-3",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );
    const attempt = (attemptId: string) =>
      run.fetch(
        request("/api/v1/runs/run-3/attempts", {
          internal: "verified",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            attemptId,
            expectedRevision: 0,
            pair: ["graes", "pind"],
          }),
        }),
      );
    const first = attempt("aaaaaaaa-1234-1234-1234-123456789012");
    const second = attempt("bbbbbbbb-1234-1234-1234-123456789012");
    delayed.resolve();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      409,
    ]);
    const snapshot = await run.fetch(
      request("/api/v1/runs/run-3", {
        internal: "verified",
        method: "GET",
      }),
    );
    expect((await snapshot.json()).revision).toBe(1);
  });

  it("charges malformed attempts against the durable per-run quota", async () => {
    const run = new Run(
      { storage: new FakeStorage() },
      {
        COORDINATOR: new Namespace(
          new Stub({
            schemaVersion: 1,
            candidateKey: "hybrid:graes+pind",
            presentationKey: "plain",
          }),
        ),
      },
    );
    await run.fetch(
      request("/api/v1/runs/run-malformed", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-malformed",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );

    for (let attempt = 0; attempt < 30; attempt++) {
      expect(
        (
          await run.fetch(
            request("/api/v1/runs/run-malformed/attempts", {
              internal: "verified",
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{",
            }),
          )
        ).status,
      ).toBe(400);
    }

    const rejected = await run.fetch(
      request("/api/v1/runs/run-malformed/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(rejected.status).toBe(429);
  });

  it("charges model failures against the durable per-run quota", async () => {
    const failing = new FailingStub();
    const run = new Run(
      { storage: new FakeStorage() },
      { COORDINATOR: new Namespace(failing) },
    );
    await run.fetch(
      request("/api/v1/runs/run-model-failure", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-model-failure",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );

    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await run.fetch(
        request("/api/v1/runs/run-model-failure/attempts", {
          internal: "verified",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            attemptId: `${attempt.toString(16).padStart(8, "0")}-1234-1234-1234-123456789012`,
            expectedRevision: 0,
            pair: ["graes", "pind"],
          }),
        }),
      );
      expect(response.status).toBe(502);
    }

    const rejected = await run.fetch(
      request("/api/v1/runs/run-model-failure/attempts", {
        internal: "verified",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          attemptId: "ffffffff-1234-1234-1234-123456789012",
          expectedRevision: 0,
          pair: ["graes", "pind"],
        }),
      }),
    );
    expect(rejected.status).toBe(429);
    expect(failing.calls).toBe(30);
  });

  it("deletes expired run storage when its retention alarm fires", async () => {
    const storage = new FakeStorage();
    const run = new Run(
      { storage },
      {
        COORDINATOR: new Namespace(
          new Stub({
            schemaVersion: 1,
            candidateKey: "hybrid:graes+pind",
            presentationKey: "plain",
          }),
        ),
      },
    );
    await run.fetch(
      request("/api/v1/runs/run-expired", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-expired",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );
    expect(storage.values.has("run:v1")).toBe(true);

    await run.alarm();

    expect(storage.values.has("run:v1")).toBe(false);
    expect(
      (
        await run.fetch(
          request("/api/v1/runs/run-expired", {
            internal: "verified",
            method: "GET",
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("derives depth-2 and depth-3 candidate sets from authoritative run-local parents", async () => {
    const candidates = new CandidateStub();
    const run = new Run(
      { storage: new FakeStorage() },
      { COORDINATOR: new Namespace(candidates) },
    );
    await run.fetch(
      request("/api/v1/runs/run-nested", {
        internal: "init",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          runId: "run-nested",
          seed: 7,
          startedAt: "2026-08-16T08:00:00Z",
        }),
      }),
    );

    const attempt = async (
      attemptId: string,
      expectedRevision: number,
      pair: [string, string],
    ) => {
      const response = await run.fetch(
        request("/api/v1/runs/run-nested/attempts", {
          internal: "verified",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            attemptId,
            expectedRevision,
            pair,
          }),
        }),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as {
        outcome: {
          kind: string;
          element?: { id: string; depth: number };
        };
      };
    };

    const first = await attempt(
      "11111111-1234-1234-1234-123456789012",
      0,
      ["graes", "pind"],
    );
    expect(first.outcome.element?.depth).toBe(1);
    const second = await attempt(
      "22222222-1234-1234-1234-123456789012",
      1,
      [first.outcome.element!.id, "graes"],
    );
    expect(second.outcome.element?.depth).toBe(2);
    const third = await attempt(
      "33333333-1234-1234-1234-123456789012",
      2,
      [second.outcome.element!.id, "pind"],
    );
    expect(third.outcome.kind).toBe("improvise-rejected");

    expect(candidates.bodies).toHaveLength(3);
    expect(candidates.bodies[1]).toMatchObject({
      schemaVersion: 1,
      a: { id: first.outcome.element!.id, depth: 1 },
    });
    expect(
      (
        candidates.bodies[1] as {
          candidates: { element: { depth: number } }[];
        }
      ).candidates[0],
    ).toMatchObject({ element: { depth: 2 } });
    expect(candidates.bodies[2]).toMatchObject({
      schemaVersion: 1,
      a: { id: second.outcome.element!.id, depth: 2 },
    });
    expect(
      (
        candidates.bodies[2] as {
          candidates: { element: { depth: number } }[];
        }
      ).candidates[0],
    ).toMatchObject({ element: { depth: 3 } });
  });
});
