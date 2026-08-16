import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeneratedDeps,
  decideGenerated,
} from "../worker/src/generated";
import {
  resolveGeneratedBody,
  resolveGeneratedSelectionBody,
} from "../worker/src/generated-catalog";
import {
  callGeneratedOpenAI,
  generatedPrompt,
} from "../worker/src/generated-model";
import { InMemoryStore } from "../worker/src/store";
import { loadContent } from "../src/content";
import { deriveGeneratedCandidateSet } from "../src/core/generated-candidates";
import { buildFallbackElement } from "../src/core/improvise";

const BODY = { a: "baer", b: "ler", act: 1 };

function deps(
  callUpstream: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return createGeneratedDeps({
    store: new InMemoryStore(),
    now: () => Date.UTC(2026, 7, 16),
    callUpstream,
    config: {
      dailyMax: 100,
      dailyMaxPerIp: 25,
      cacheNamespace: "test-v1",
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Worker bounded generated-gameplay selection", () => {
  it("derives candidates entirely from bundled canonical ids", () => {
    const resolved = resolveGeneratedBody(BODY);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.body.candidates.length).toBeGreaterThan(0);
    expect(resolved.body.candidates.length).toBeLessThanOrEqual(4);
    expect(generatedPrompt(resolved.body)).not.toContain("historical note");
    expect(
      resolveGeneratedBody({ a: "invented-client-id", b: "ler", act: 1 }),
    ).toEqual({ ok: false, reason: "unknown a" });
  });

  it("returns and caches only an offered proposal", async () => {
    const resolved = resolveGeneratedBody(BODY);
    if (!resolved.ok) throw new Error(resolved.reason);
    const proposal = {
      schemaVersion: 1 as const,
      candidateKey: resolved.body.candidates[0]!.candidateKey,
      presentationKey: "plain" as const,
    };
    const upstream = vi.fn(async () => ({ ok: true as const, value: proposal }));
    const generatedDeps = deps(upstream);
    expect(
      await decideGenerated(BODY, "a".repeat(64), generatedDeps),
    ).toEqual({ status: 200, value: proposal });
    expect(
      await decideGenerated(BODY, "a".repeat(64), generatedDeps),
    ).toEqual({ status: 200, value: proposal });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("fails before budget for unknown client ids", async () => {
    const upstream = vi.fn();
    expect(
      await decideGenerated(
        { a: "client-text", b: "ler", act: 1 },
        "a".repeat(64),
        deps(upstream),
      ),
    ).toEqual({ status: 400, reason: "unknown a" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a model key outside the freshly derived candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schemaVersion: 1,
                    candidateKey: "not-offered",
                    presentationKey: "plain",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const resolved = resolveGeneratedBody(BODY);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(
      await callGeneratedOpenAI(resolved.body, {
        OPENAI_API_KEY: "test-key",
      }),
    ).toEqual({
      ok: false,
      status: 502,
      reason: "invalid model output",
    });
  });

  it("accepts a closed candidate set whose authoritative parent is a depth-2 invention", () => {
    const content = loadContent();
    const grass = content.elements.find((element) => element.id === "graes")!;
    const stick = content.elements.find((element) => element.id === "pind")!;
    const depth1 = buildFallbackElement(grass, stick);
    const depth2 = buildFallbackElement(depth1, grass);
    const candidates = deriveGeneratedCandidateSet(depth2, stick);

    const resolved = resolveGeneratedSelectionBody({
      schemaVersion: 1,
      a: depth2,
      b: stick,
      act: 1,
      candidates,
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.body.a.id).toBe(depth2.id);
    expect(resolved.body.candidates[0]?.element.depth).toBe(3);
  });

  it("rejects a candidate set altered after deterministic derivation", () => {
    const content = loadContent();
    const grass = content.elements.find((element) => element.id === "graes")!;
    const stick = content.elements.find((element) => element.id === "pind")!;
    const candidates = deriveGeneratedCandidateSet(grass, stick);
    const altered = structuredClone(candidates);
    altered[0]!.candidateKey = "client-authored";

    expect(
      resolveGeneratedSelectionBody({
        schemaVersion: 1,
        a: grass,
        b: stick,
        act: 1,
        candidates: altered,
      }),
    ).toEqual({ ok: false, reason: "candidate set mismatch" });
  });
});
