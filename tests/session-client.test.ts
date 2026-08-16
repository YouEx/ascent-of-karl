import { describe, expect, it, vi } from "vitest";
import {
  RunRevisionConflict,
  SessionClient,
} from "../src/ui/session-client";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const credentials = {
  runId: "11111111-1111-1111-1111-111111111111",
  token: "token",
  csrf: "csrf",
  expiresAt: 4_102_444_800,
};

describe("online-required session client", () => {
  it("keeps local compatibility ready when online mode is disabled", async () => {
    const fetch = vi.fn();
    const client = new SessionClient({
      baseUrl: "",
      onlineRequired: false,
      fetch,
    });
    expect(await client.readiness()).toEqual({
      status: "ready",
      onlineRequired: false,
      activePlayAllowed: true,
      archivesReadable: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed for active play but preserves archive readability", async () => {
    const client = new SessionClient({
      baseUrl: "https://api.example",
      onlineRequired: true,
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    expect(await client.readiness()).toEqual({
      status: "network-unavailable",
      onlineRequired: true,
      activePlayAllowed: false,
      archivesReadable: true,
      reason: "network",
    });
  });

  it("creates a run and sends capability plus CSRF on attempts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          ...credentials,
          schemaVersion: 1,
          revision: 0,
          snapshot: { act: 1 },
        }, 201),
      )
      .mockResolvedValueOnce(
        json({
          schemaVersion: 1,
          attemptId: "attempt-12345678",
          revision: 1,
          outcome: { kind: "discovery" },
          snapshot: { act: 1 },
        }),
      );
    const client = new SessionClient({
      baseUrl: "https://api.example/",
      onlineRequired: true,
      fetch,
    });
    const created = await client.createRun(42);
    expect(created.credentials).toEqual(credentials);
    await client.attempt(credentials, {
      attemptId: "attempt-12345678",
      expectedRevision: 0,
      pair: ["sten", "sten"],
    });
    const attempt = fetch.mock.calls[1]!;
    expect(attempt[0]).toBe(
      `https://api.example/api/v1/runs/${credentials.runId}/attempts`,
    );
    const headers = attempt[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-karl-csrf")).toBe("csrf");
  });

  it("surfaces revision conflicts with the authoritative snapshot", async () => {
    const client = new SessionClient({
      baseUrl: "https://api.example",
      onlineRequired: true,
      fetch: vi.fn(async () =>
        json({ error: "revision conflict", revision: 4, snapshot: { act: 2 } }, 409),
      ),
    });
    await expect(
      client.attempt(credentials, {
        attemptId: "attempt-12345678",
        expectedRevision: 2,
        pair: ["sten", "sten"],
      }),
    ).rejects.toEqual(new RunRevisionConflict(4, { act: 2 }));
  });

  it("rotates a near-expiry capability before loading the run", async () => {
    const rotated = {
      ...credentials,
      token: "rotated",
      csrf: "rotated-csrf",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
    const updated = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(rotated))
      .mockResolvedValueOnce(
        json({ schemaVersion: 1, revision: 3, snapshot: { act: 2 } }),
      );
    const client = new SessionClient({
      baseUrl: "https://api.example",
      onlineRequired: true,
      fetch,
      credentialsUpdated: updated,
    });
    await client.loadRun({
      ...credentials,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("/capability");
    expect(updated).toHaveBeenCalledWith(rotated);
    const headers = fetch.mock.calls[1]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer rotated");
  });

  it("requests idempotent commentary and its authenticated PCM stream", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          schemaVersion: 1,
          eventId: "attempt:abc",
          text: "Karl files the invention under avoidable.",
          roles: ["humour"],
          audioAvailable: true,
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { "content-type": "audio/pcm" },
        }),
      );
    const client = new SessionClient({
      baseUrl: "https://api.example",
      onlineRequired: true,
      fetch,
    });

    expect(
      await client.commentary(credentials, "attempt:abc"),
    ).toMatchObject({
      eventId: "attempt:abc",
      audioAvailable: true,
    });
    const audio = await client.commentaryAudio(
      credentials,
      "attempt:abc",
    );
    expect(audio.headers.get("content-type")).toBe("audio/pcm");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example/api/v1/runs/${credentials.runId}/commentary`,
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `https://api.example/api/v1/runs/${credentials.runId}/commentary/attempt%3Aabc/audio`,
    );
    for (const call of fetch.mock.calls) {
      const callHeaders = call[1]?.headers as Headers;
      expect(callHeaders.get("authorization")).toBe("Bearer token");
      expect(callHeaders.get("x-karl-csrf")).toBe("csrf");
    }
  });
});
