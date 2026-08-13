import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMPROVISE_TIMEOUT_MS,
  ImproviseClient,
} from "../src/ui/improvise-client";

const request = { a: "baer", b: "ler", act: 1 };
const validCopy = {
  name: "Clay berries",
  flavor: "Karl wraps the berries in clay and calls the delay preparation.",
};

describe("ImproviseClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("er eksplicit offline uden URL og foretager intet netværkskald", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new ImproviseClient("");

    expect(await client.prefetch(request)).toEqual({
      status: "fallback",
      reason: "no-endpoint",
      timeout: false,
    });
    expect(client.get(request.a, request.b, request.act)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("venter aldrig: prefetch starter, mens get kun læser allerede-klar copy", async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => response));
    const client = new ImproviseClient("https://example.invalid/improvise");

    const pending = client.prefetch(request);

    expect(client.state(request.a, request.b, request.act)).toEqual({
      status: "loading",
    });
    expect(client.get(request.a, request.b, request.act)).toBeUndefined();

    release(new Response(JSON.stringify(validCopy), { status: 200 }));
    await expect(pending).resolves.toMatchObject({
      status: "ready",
      copy: validCopy,
    });
  });

  it("sender eksakt {a,b,act} og nøgler copy på sorteret par plus akt", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(validCopy), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ImproviseClient("https://example.invalid/improvise");

    await client.prefetch(request);

    const [, init] = (
      fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]
    )[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      a: "baer",
      b: "ler",
      act: 1,
    });
    expect(client.get("ler", "baer", 1)).toEqual(validCopy);
    expect(client.get("baer", "ler", 2)).toBeUndefined();
  });

  it.each([
    ["ekstra felt", { ...validCopy, traits: ["edible"] }],
    ["manglende felt", { name: validCopy.name }],
    ["forkert type", { name: validCopy.name, flavor: 3 }],
    ["for mange navneord", { ...validCopy, name: "Four whole invented words" }],
    ["URL", { ...validCopy, flavor: "Read https://example.com for the truth." }],
    ["citationstegn", { ...validCopy, name: "\"Clay berries\"" }],
    ["kontroltegn", { ...validCopy, flavor: "Clay\u0007 berries." }],
    ["tegnsætningsvildnis", { ...validCopy, flavor: "Karl approves!!! Maybe." }],
  ])("afviser strengt svar med %s", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const client = new ImproviseClient("https://example.invalid/improvise");

    const state = await client.prefetch(request);

    expect(state).toMatchObject({
      status: "fallback",
      reason: "response",
      timeout: false,
    });
    expect(client.get(request.a, request.b, request.act)).toBeUndefined();
  });

  it("falder eksplicit tilbage efter præcis 2,5 sekunder uden at levere copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      ),
    );
    const client = new ImproviseClient("https://example.invalid/improvise");

    const pending = client.prefetch(request);
    await vi.advanceTimersByTimeAsync(IMPROVISE_TIMEOUT_MS);
    const state = await pending;

    expect(state).toEqual({
      status: "fallback",
      reason: "timeout",
      latencyMs: IMPROVISE_TIMEOUT_MS,
      timeout: true,
    });
    expect(client.get(request.a, request.b, request.act)).toBeUndefined();
  });

  it("gemmer en eksplicit netværksfejltilstand med latency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        throw new TypeError("offline");
      }),
    );
    const client = new ImproviseClient("https://example.invalid/improvise");

    const pending = client.prefetch(request);
    await vi.advanceTimersByTimeAsync(40);
    const state = await pending;

    expect(state).toEqual({
      status: "fallback",
      reason: "network",
      latencyMs: 40,
      timeout: false,
    });
  });

  it("coalescer samtidige reads af samme par og akt", async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new ImproviseClient("https://example.invalid/improvise");

    const first = client.prefetch(request);
    const second = client.prefetch({ a: "ler", b: "baer", act: 1 });
    release(new Response(JSON.stringify(validCopy), { status: 200 }));

    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
