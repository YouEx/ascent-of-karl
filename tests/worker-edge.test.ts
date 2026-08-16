import { describe, expect, it, vi } from "vitest";
import worker from "../worker/src/index";
import { Coordinator, CACHE_MAX_AGE_MS, CLEANUP_INTERVAL_MS } from "../worker/src/coordinator-do";
import { BUDGET_KEY, CACHE_KEY_PREFIX, IP_BUDGET_KEY_PREFIX } from "../worker/src/coordinator";
import { pairCacheKey, promptNamespace } from "../worker/src/cache-key";
import { PROMPT_VERSION_INPUT, DEFAULT_MODEL } from "../worker/src/model";
import { VOICE_PROFILE_HASH } from "../worker/src/voice/gate";
import { INTERNAL_IP_HASH_HEADER, hashClientIp } from "../worker/src/ip";
import { createRunCapability } from "../worker/src/run-auth";
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
} from "../worker/src/cf-types";

/**
 * Kant og Durable Object-tilpasning (sikkerhedsrunde 2, punkt 1 og 4).
 *
 * `worker-security.test.ts` tester de RENE moduler (ip.ts, catalog.ts,
 * cleanup.ts, ...) i isolation. `worker-coordinator.test.ts` tester selve
 * beslutningen (`coordinator.ts`) med en hukommelsesattrap. DENNE fil tester
 * de to Cloudflare-TILPASNINGER selv — `index.ts`s standard-eksport og
 * `coordinator-do.ts`s `Coordinator`-klasse — med minimale, håndlavede
 * attrapper for `DurableObjectNamespace`/`DurableObjectState`, så hele
 * kæden fra en rå `Request` til det færdige svar kan bevises uden en rigtig
 * Cloudflare-runtime.
 */

class FakeStorage implements DurableObjectStorage {
  private map = new Map<string, unknown>();
  private alarm: number | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.map) {
      if (!options?.prefix || k.startsWith(options.prefix)) out.set(k, v as T);
    }
    return out;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm = typeof scheduledTime === "number" ? scheduledTime : scheduledTime.getTime();
  }
}

class FakeStub implements DurableObjectStub {
  public received: Request[] = [];
  constructor(private readonly handler: (req: Request) => Promise<Response>) {}
  async fetch(request: Request): Promise<Response> {
    this.received.push(request);
    return this.handler(request);
  }
}

class FakeNamespace implements DurableObjectNamespace {
  constructor(private readonly stub: FakeStub) {}
  idFromName(name: string): DurableObjectId {
    return { toString: () => name };
  }
  get(_id: DurableObjectId): DurableObjectStub {
    return this.stub;
  }
}

const SALT = "test-salt-ikke-en-rigtig-hemmelighed";

function nyCoordinator(env: Record<string, string | undefined> = {}) {
  const storage = new FakeStorage();
  const state: DurableObjectState = { storage };
  const coordinator = new Coordinator(state, {
    OPENAI_API_KEY: "unused-i-denne-test",
    RATE_LIMIT_MAX: "1000",
    DAILY_MAX_UPSTREAM_CALLS: "1000",
    DAILY_MAX_UPSTREAM_CALLS_PER_IP: "1000",
    ...env,
  });
  return { coordinator, storage };
}

/**
 * Forudfylder et cache-hit for et par+dom, så en test kan bevise
 * rate-limit-/alarm-adfærd UDEN nogensinde at forsøge et rigtigt
 * netværkskald til OpenAI (som `Coordinator`s helt rigtige
 * `callUpstreamOpenAI` ville gøre ved et cache-miss — ingen betalte/eksterne
 * kald må forekomme under test).
 */
/**
 * Navnerummet `Coordinator` selv vil udlede (sikkerhedsrunde 3, punkt 3;
 * udvidet i opfølgningen der lod `PROMPT_VERSION_INPUT` dække SYSTEM+DOMME+
 * brugerprompt-skabelonen, ikke kun SYSTEM; udvidet igen af TASK-007 til
 * også at folde `VOICE_PROFILE_HASH` ind): `nyCoordinator()` sætter ikke
 * `MODEL`, så den rigtige koordinator falder tilbage til `DEFAULT_MODEL` —
 * denne konstant skal matche PRÆCIS det, for at `saetCacheHit()` kan
 * forudfylde en nøgle koordinatoren selv ville slå op under.
 */
const TEST_NAMESPACE = promptNamespace(PROMPT_VERSION_INPUT, DEFAULT_MODEL, VOICE_PROFILE_HASH);

async function saetCacheHit(
  storage: FakeStorage,
  aId: string,
  bId: string,
  verdict: string,
  text: string,
): Promise<void> {
  await storage.put(CACHE_KEY_PREFIX + pairCacheKey(aId, bId, verdict, TEST_NAMESPACE), { text, createdAt: Date.now() });
}

function lavAnmodning(headers: Record<string, string>, body?: unknown): Request {
  return new Request("https://narrator.example/", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://karl.example", ...headers },
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify({ aId: "a", bId: "b", verdict: "inert" }),
  });
}

function runCreateReservationRequest(ipHash: string): Request {
  return new Request("https://internal.example/internal/run-create-reserve", {
    method: "POST",
    headers: { [INTERNAL_IP_HASH_HEADER]: ipHash },
  });
}

describe("index.ts: identiteten fastslås ved kanten, ikke inde i objektet (sikkerhedsrunde 2, punkt 1)", () => {
  it("keeps active play ready without Cartesia while reporting runtime voice separately", async () => {
    const stub = new FakeStub(async () => new Response(null));
    const response = await worker.fetch(
      new Request("https://narrator.example/healthz"),
      {
        OPENAI_API_KEY: "test-openai",
        RUN_AUTH_SECRET: "test-run-auth",
        IP_HASH_SALT: SALT,
        COORDINATOR: new FakeNamespace(stub),
        RUNS: new FakeNamespace(stub),
      } as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      runtimeCommentaryAvailable: true,
      runtimeVoiceAvailable: false,
    });
  });

  it("overskriver ALTID den interne header — en forfalsket header i den indkommende anmodning når aldrig igennem uændret", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    const env = {
      ALLOWED_ORIGINS: "",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const forfalsketHash = "f".repeat(64);
    const req = lavAnmodning({
      "cf-connecting-ip": "203.0.113.7",
      [INTERNAL_IP_HASH_HEADER]: forfalsketHash,
    });

    await worker.fetch(req, env as never);

    expect(stub.received).toHaveLength(1);
    const videresendtHash = stub.received[0]!.headers.get(INTERNAL_IP_HASH_HEADER);
    expect(videresendtHash).not.toBe(forfalsketHash);
    expect(videresendtHash).toBe(await hashClientIp("203.0.113.7", SALT));
  });

  it("bevarer metode og krop gennem videresendelsen", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, COORDINATOR: new FakeNamespace(stub) };
    const req = lavAnmodning({ "cf-connecting-ip": "203.0.113.7" }, { aId: "x", bId: "y", verdict: "clash" });

    await worker.fetch(req, env as never);

    const videresendt = stub.received[0]!;
    expect(videresendt.method).toBe("POST");
    expect(await videresendt.json()).toEqual({ aId: "x", bId: "y", verdict: "clash" });
  });

  it("fjerner altid klientens forsøg på at sætte generated-candidate-markøren", async () => {
    const stub = new FakeStub(async () =>
      new Response(JSON.stringify({ error: "missing internal candidates" }), {
        status: 503,
      }),
    );
    const env = {
      ALLOWED_ORIGINS: "",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const req = new Request("https://narrator.example/generated", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://karl.example",
        "cf-connecting-ip": "203.0.113.7",
        "x-internal-generated-candidates": "1",
      },
      body: JSON.stringify({ a: "graes", b: "pind", act: 1 }),
    });

    await worker.fetch(req, env as never);

    expect(
      stub.received[0]!.headers.get("x-internal-generated-candidates"),
    ).toBeNull();
  });

  it("fjerner altid klientens forsøg på at sætte runtime-commentary-markøren", async () => {
    const stub = new FakeStub(async () =>
      new Response(JSON.stringify({ error: "missing internal commentary" }), {
        status: 503,
      }),
    );
    const env = {
      ALLOWED_ORIGINS: "",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const request = new Request(
      "https://narrator.example/runtime-commentary",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://karl.example",
          "cf-connecting-ip": "203.0.113.7",
          "x-internal-runtime-commentary": "1",
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      },
    );

    await worker.fetch(request, env as never);

    expect(
      stub.received[0]!.headers.get("x-internal-runtime-commentary"),
    ).toBeNull();
  });

  it("fjerner altid klientens forsøg på at sætte runtime-TTS-markøren", async () => {
    const stub = new FakeStub(async () =>
      new Response(JSON.stringify({ error: "missing internal tts" }), {
        status: 503,
      }),
    );
    await worker.fetch(
      new Request("https://narrator.example/runtime-tts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://karl.example",
          "cf-connecting-ip": "203.0.113.7",
          "x-internal-runtime-tts": "1",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          text: "Karl waits for history to notice.",
        }),
      }),
      {
        ALLOWED_ORIGINS: "",
        IP_HASH_SALT: SALT,
        COORDINATOR: new FakeNamespace(stub),
      } as never,
    );

    expect(
      stub.received[0]!.headers.get("x-internal-runtime-tts"),
    ).toBeNull();
  });

  it("afviser offentlige /internal-ruter før Coordinator nås", async () => {
    const stub = new FakeStub(async () => new Response("should not run"));
    const env = {
      ALLOWED_ORIGINS: "",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const response = await worker.fetch(
      new Request(
        "https://narrator.example/internal/run-create-reserve",
        {
          method: "POST",
          headers: {
            origin: "https://karl.example",
            "cf-connecting-ip": "203.0.113.7",
          },
        },
      ),
      env as never,
    );

    expect(response.status).toBe(404);
    expect(stub.received).toHaveLength(0);
  });

  it("strips client-forged Run init and verified markers before the authenticated proxy", async () => {
    const secret = "run-auth-test-secret";
    const runId = "11111111-1111-1111-1111-111111111111";
    const capability = await createRunCapability({
      secret,
      runId,
      now: Date.now(),
    });
    const runStub = new FakeStub(async () =>
      new Response(JSON.stringify({ schemaVersion: 1, revision: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const coordinatorStub = new FakeStub(async () => new Response(null));
    const env = {
      ALLOWED_ORIGINS: "",
      IP_HASH_SALT: SALT,
      RUN_AUTH_SECRET: secret,
      COORDINATOR: new FakeNamespace(coordinatorStub),
      RUNS: new FakeNamespace(runStub),
    };
    const response = await worker.fetch(
      new Request(`https://narrator.example/api/v1/runs/${runId}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${capability.token}`,
          "content-type": "application/json",
          origin: "https://karl.example",
          "cf-connecting-ip": "203.0.113.7",
          "x-karl-csrf": capability.capability.csrf,
          "x-internal-run-init": "1",
          "x-internal-run-verified": "forged",
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(runStub.received).toHaveLength(1);
    expect(
      runStub.received[0]!.headers.get("x-internal-run-init"),
    ).toBeNull();
    expect(
      runStub.received[0]!.headers.get("x-internal-run-verified"),
    ).toBe("1");
  });

  it("routes authenticated commentary audio to the Run object without exposing capability headers", async () => {
    const secret = "run-auth-test-secret";
    const runId = "11111111-1111-1111-1111-111111111111";
    const capability = await createRunCapability({
      secret,
      runId,
      now: Date.now(),
    });
    const runStub = new FakeStub(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      }),
    );
    const coordinatorStub = new FakeStub(async () => new Response(null));
    const response = await worker.fetch(
      new Request(
        `https://narrator.example/api/v1/runs/${runId}/commentary/attempt%3Aabc/audio`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${capability.token}`,
            origin: "https://karl.example",
            "cf-connecting-ip": "203.0.113.7",
            "x-karl-csrf": capability.capability.csrf,
          },
        },
      ),
      {
        ALLOWED_ORIGINS: "",
        IP_HASH_SALT: SALT,
        RUN_AUTH_SECRET: secret,
        COORDINATOR: new FakeNamespace(coordinatorStub),
        RUNS: new FakeNamespace(runStub),
      } as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/pcm");
    expect(runStub.received).toHaveLength(1);
    expect(runStub.received[0]!.headers.get("authorization")).toBeNull();
    expect(runStub.received[0]!.headers.get("x-karl-csrf")).toBeNull();
    expect(
      runStub.received[0]!.headers.get("x-internal-run-verified"),
    ).toBe("1");
  });

  it("fejler LUKKET (503) uden `cf-connecting-ip` — objektet kaldes aldrig", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, COORDINATOR: new FakeNamespace(stub) };
    const req = lavAnmodning({}); // ingen cf-connecting-ip

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(503);
    expect(stub.received).toHaveLength(0);
  });

  it("fejler LUKKET (503) uden `IP_HASH_SALT` — objektet kaldes aldrig", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", COORDINATOR: new FakeNamespace(stub) }; // intet IP_HASH_SALT
    const req = lavAnmodning({ "cf-connecting-ip": "203.0.113.7" });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(503);
    expect(stub.received).toHaveLength(0);
  });

  it("afviser en ikke-tilladt oprindelse med 403 FØR IP-hash og objekt overhovedet røres", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = {
      ALLOWED_ORIGINS: "https://karl.example",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const req = new Request("https://narrator.example/", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ond-side.example" },
      body: JSON.stringify({ aId: "a", bId: "b", verdict: "inert" }),
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(403);
    expect(stub.received).toHaveLength(0);
  });

  it("lykkedes forespørgsel: objektets svar og CORS-headere når hele vejen tilbage", async () => {
    const stub = new FakeStub(
      async () => new Response(JSON.stringify({ text: "Karl frowns." }), { status: 200 }),
    );
    const env = {
      ALLOWED_ORIGINS: "https://karl.example",
      IP_HASH_SALT: SALT,
      COORDINATOR: new FakeNamespace(stub),
    };
    const req = new Request("https://narrator.example/", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://karl.example", "cf-connecting-ip": "1.2.3.4" },
      body: JSON.stringify({ aId: "a", bId: "b", verdict: "inert" }),
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://karl.example");
    expect(await res.json()).toEqual({ text: "Karl frowns." });
  });
});

describe("Coordinator (Durable Object): stoler KUN på den interne header, aldrig på cf-connecting-ip direkte (sikkerhedsrunde 2, punkt 1)", () => {
  it("afviser LUKKET (503) uden en gyldig intern header — selv med en ægte cf-connecting-ip til stede", async () => {
    const { coordinator, storage } = nyCoordinator();
    const req = new Request("https://internal/", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" }, // ingen intern header
      body: JSON.stringify({ aId: "sten", bId: "pind", verdict: "inert" }),
    });

    const res = await coordinator.fetch(req);

    expect(res.status).toBe(503);
    // Intet må være skrevet til lager af et forsøg, der aldrig fik en identitet.
    const rlEntries = await storage.list({ prefix: "rl:" });
    expect(rlEntries.size).toBe(0);
  });

  it("afviser en forkert formet header (ikke 64 hex-tegn) på samme måde som en manglende", async () => {
    const { coordinator } = nyCoordinator();
    const req = new Request("https://internal/", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: "ikke-en-hash" },
      body: JSON.stringify({ aId: "sten", bId: "pind", verdict: "inert" }),
    });

    const res = await coordinator.fetch(req);
    expect(res.status).toBe(503);
  });

  it("to forespørgsler med SAMME interne header men FORSKELLIG (eller ingen) cf-connecting-ip deler samme rate-limit-spand", async () => {
    const { coordinator, storage } = nyCoordinator({ RATE_LIMIT_MAX: "1" });
    const hash = "a".repeat(64);
    // Cachen forudfyldes: begge forespørgsler bliver cache-HITS, så testen
    // udelukkende måler rate limit — og aldrig rører et rigtigt opstrømskald.
    await saetCacheHit(storage, "sten", "pind", "inert", "Karl frowns at the stone and the stick.");

    const lavReq = (cfIp?: string) =>
      new Request("https://internal/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [INTERNAL_IP_HASH_HEADER]: hash,
          ...(cfIp ? { "cf-connecting-ip": cfIp } : {}),
        },
        body: JSON.stringify({ aId: "sten", bId: "pind", verdict: "inert" }),
      });

    const first = await coordinator.fetch(lavReq("1.1.1.1"));
    expect(first.status).toBe(200);

    // Anden forespørgsel: SAMME interne header, men en HELT ANDEN
    // (eller slet ingen) cf-connecting-ip. Rammer objektet stadig
    // rate-limit'et for hash'en (bevis på at cf-connecting-ip selv aldrig
    // læses inde i objektet), viser det 429 — uanset hvad "IP'en" nu påstår.
    const second = await coordinator.fetch(
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: hash },
        // Bemærk: INGEN cf-connecting-ip overhovedet denne gang.
        body: JSON.stringify({ aId: "graes", bId: "vand", verdict: "inert" }),
      }),
    );
    expect(second.status).toBe(429);
  });
});

describe("Coordinator: lager-livscyklus (sikkerhedsrunde 2, punkt 4 — 'no magic TTL')", () => {
  it("planlægger en oprydningsalarm ved første forespørgsel, og genplanlægger ikke en der allerede tikker", async () => {
    const { coordinator, storage } = nyCoordinator();
    expect(await storage.getAlarm()).toBeNull();
    // Cache-hit forudfyldt: testen måler alarm-planlægning, ikke selve
    // beslutningskæden, og skal aldrig forsøge et rigtigt opstrømskald.
    await saetCacheHit(storage, "sten", "pind", "inert", "Karl frowns at the stone and the stick.");

    const req = () =>
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: "b".repeat(64) },
        body: JSON.stringify({ aId: "sten", bId: "pind", verdict: "inert" }),
      });
    const r1 = await coordinator.fetch(req());
    expect(r1.status).toBe(200);
    const førsteAlarm = await storage.getAlarm();
    expect(førsteAlarm).not.toBeNull();

    const r2 = await coordinator.fetch(req());
    expect(r2.status).toBe(200);
    const andenAlarm = await storage.getAlarm();
    expect(andenAlarm).toBe(førsteAlarm); // uændret — ikke genplantet oven i en der allerede tikker
  });

  it("alarm() rydder døde rate-limit-poster og for gamle cache-poster, men lader friske poster stå, og genplanlægger næste alarm", async () => {
    const { coordinator, storage } = nyCoordinator({ RATE_LIMIT_WINDOW_SECONDS: "60" });
    const now = Date.now();

    // En død rate-limit-post: alle tidsstempler langt uden for 60-sekunders-vinduet.
    await storage.put("rl:dødIp", [now - 3_600_000]);
    // En frisk rate-limit-post: ét tidsstempel stadig inden for vinduet.
    await storage.put("rl:friskIp", [now - 1_000]);

    // En for gammel cache-post (længere end CACHE_MAX_AGE_MS).
    await storage.put("cache:v1:gammel+par:inert", { text: "gammel replik", createdAt: now - CACHE_MAX_AGE_MS - 1 });
    // En frisk cache-post.
    await storage.put("cache:v1:frisk+par:inert", { text: "frisk replik", createdAt: now });

    // Pr.-IP-budgetposter (sikkerhedsrunde 3, punkt 2): en for-gammel post
    // (hverken i dag eller i går) skal ryddes; dagens og gårsdagens skal stå.
    const idagNøgle = `${IP_BUDGET_KEY_PREFIX}idag`;
    const igårNøgle = `${IP_BUDGET_KEY_PREFIX}igaar`;
    const gammelNøgle = `${IP_BUDGET_KEY_PREFIX}gammel`;
    const iGaar = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const forLaengeSiden = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await storage.put(idagNøgle, { date: new Date(now).toISOString().slice(0, 10), count: 3 });
    await storage.put(igårNøgle, { date: iGaar, count: 7 });
    await storage.put(gammelNøgle, { date: forLaengeSiden, count: 1 });

    await coordinator.alarm();

    expect(await storage.get("rl:dødIp")).toBeUndefined();
    expect(await storage.get("rl:friskIp")).toBeDefined();
    expect(await storage.get("cache:v1:gammel+par:inert")).toBeUndefined();
    expect(await storage.get("cache:v1:frisk+par:inert")).toBeDefined();
    expect(await storage.get(idagNøgle)).toBeDefined();
    expect(await storage.get(igårNøgle)).toBeDefined();
    expect(await storage.get(gammelNøgle)).toBeUndefined();

    const nyAlarm = await storage.getAlarm();
    expect(nyAlarm).not.toBeNull();
    expect(nyAlarm!).toBeGreaterThan(now);
    expect(nyAlarm!).toBeLessThanOrEqual(now + CLEANUP_INTERVAL_MS + 1000);
  });

  it("bevarer run-oprettelsesreservationer i hele deres eget timevindue", async () => {
    const { coordinator, storage } = nyCoordinator({
      RATE_LIMIT_WINDOW_SECONDS: "60",
    });
    const now = Date.now();
    const quotaKey = "quota:run-create:v1";
    const recentIp = "a".repeat(64);
    const expiredIp = "b".repeat(64);
    await storage.put(quotaKey, {
      global: [now - 2 * 60_000, now - 60 * 60_000 - 1],
      perIp: {
        [recentIp]: [now - 30 * 60_000],
        [expiredIp]: [now - 60 * 60_000 - 1],
      },
    });

    await coordinator.alarm();

    expect(await storage.get(quotaKey)).toEqual({
      global: [now - 2 * 60_000],
      perIp: {
        [recentIp]: [now - 30 * 60_000],
      },
    });
  });
});

describe("Coordinator: rate limit reserveres FØR kroppen læses/parses (sikkerhedsrunde 3, punkt 1)", () => {
  it("20 for-store forespørgsler tæller hver ét rate-limit-slot (400); den 21. rammer selve rate-limiten (429) — intet budget er rørt", async () => {
    const { coordinator, storage } = nyCoordinator({ RATE_LIMIT_MAX: "20", DAILY_MAX_UPSTREAM_CALLS: "1000" });
    const hash = "c".repeat(64);
    // Rå tekst, ægte ASCII (1 byte/tegn): et body langt over LIMITS.bodyBytes
    // (6000) i RIGTIGE bytes — ikke bare en påstået Content-Length.
    const forStortBody = "x".repeat(7_000);
    const lavForStorForespørgsel = () =>
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: hash },
        body: forStortBody,
      });

    for (let i = 0; i < 20; i++) {
      const res = await coordinator.fetch(lavForStorForespørgsel());
      expect(res.status).toBe(400);
    }

    const rammerRateLimit = await coordinator.fetch(lavForStorForespørgsel());
    expect(rammerRateLimit.status).toBe(429);
    expect(rammerRateLimit.headers.get("retry-after")).toBeTruthy();

    // Intet af de 21 forsøg nåede nogensinde frem til budget-trinnet —
    // hverken det globale eller denne IP-hashs egen andel.
    expect(await storage.get(BUDGET_KEY)).toBeUndefined();
    expect(await storage.get(`${IP_BUDGET_KEY_PREFIX}${hash}`)).toBeUndefined();
  });

  it("misdannet JSON tæller ligeledes ét rate-limit-slot, ikke to — rate-limiten og 400'et deler samme forsøg", async () => {
    const { coordinator, storage } = nyCoordinator({ RATE_LIMIT_MAX: "2" });
    const hash = "d".repeat(64);
    const lavMisdannetForespørgsel = () =>
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: hash },
        body: "{ dette er ikke gyldig json",
      });

    const first = await coordinator.fetch(lavMisdannetForespørgsel());
    const second = await coordinator.fetch(lavMisdannetForespørgsel());
    expect(first.status).toBe(400);
    expect(second.status).toBe(400);

    // Tredje forsøg: rate-limit-vinduet (2) er brugt op af de to ovenstående
    // — hvis de fejlagtigt IKKE havde talt (dobbelt-fritaget), ville dette
    // stadig være et 400; i stedet er det 429, hvilket beviser at hvert
    // misdannet forsøg talte som PRÆCIS ét slot.
    const third = await coordinator.fetch(lavMisdannetForespørgsel());
    expect(third.status).toBe(429);
    expect(await storage.get(BUDGET_KEY)).toBeUndefined();
  });

  it("gyldige forespørgsler efter en for-stor forespørgsel deler stadig det SAMME rate-limit-vindue (ingen dobbelt-reservation)", async () => {
    const { coordinator, storage } = nyCoordinator({ RATE_LIMIT_MAX: "2" });
    const hash = "e".repeat(64);
    await saetCacheHit(storage, "sten", "pind", "inert", "Karl frowns at the stone and the stick.");

    const forStor = await coordinator.fetch(
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: hash },
        body: "x".repeat(7_000),
      }),
    );
    expect(forStor.status).toBe(400);

    // Vinduet (2) har nu ét slot tilbage — hvis det for-store forsøg
    // fejlagtigt havde talt to gange (én gang i decide(), én gang i den
    // nye reservation), ville dette allerede være 429.
    const gyldig = await coordinator.fetch(
      new Request("https://internal/", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_IP_HASH_HEADER]: hash },
        body: JSON.stringify({ aId: "sten", bId: "pind", verdict: "inert" }),
      }),
    );
    expect(gyldig.status).toBe(200);
  });
});

describe("Coordinator: oprettelse af authoritative runs er kvotebeskyttet", () => {
  it("tillader højst fem run-oprettelser pr. IP-hash i timevinduet", async () => {
    const { coordinator } = nyCoordinator();
    const ipHash = "a".repeat(64);

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (await coordinator.fetch(runCreateReservationRequest(ipHash))).status,
      ).toBe(204);
    }

    const rejected = await coordinator.fetch(
      runCreateReservationRequest(ipHash),
    );
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({
      error: "run creation rate limited",
      scope: "ip",
    });

  });

  it("håndhæver også det globale loft på tværs af forskellige IP-hashes", async () => {
    const { coordinator } = nyCoordinator();

    for (let attempt = 0; attempt < 100; attempt++) {
      const ipHash = attempt.toString(16).padStart(64, "0");
      expect(
        (await coordinator.fetch(runCreateReservationRequest(ipHash))).status,
      ).toBe(204);
    }

    const rejected = await coordinator.fetch(
      runCreateReservationRequest("f".repeat(64)),
    );
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({
      error: "run creation rate limited",
      scope: "global",
    });
  });

  describe("Coordinator: runtime commentary is internal and quota-protected", () => {
    const body = {
      schemaVersion: 1,
      seedCode: "K1.CE4BAF925C7ACA21.00000007",
      commentaryIndex: 0,
      cue: {
        schemaVersion: 1,
        eventId: "opening",
        kind: "opening",
        turn: 0,
        context: "Opening berry-slope. Karl begins with Stone and Stick.",
        requiredTerms: ["Karl", "Stone", "Stick"],
      },
      run: {
        act: 1,
        attempts: 0,
        discoveredCount: 5,
        solvedNeedIds: [],
        completedBranchIds: [],
        endingId: null,
      },
      recentLines: [],
    };

    it("rejects direct calls without the Run-owned internal marker", async () => {
      const { coordinator } = nyCoordinator();
      const response = await coordinator.fetch(
        new Request("https://internal/runtime-commentary", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [INTERNAL_IP_HASH_HEADER]: "a".repeat(64),
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(503);
    });

    it("returns only validated structured commentary for a marked Run request", async () => {
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
                      text: "Karl surveys the stone and stick as if they had applied for the position.",
                      roles: ["humour", "story"],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      );
      try {
        const { coordinator } = nyCoordinator();
        const response = await coordinator.fetch(
          new Request("https://internal/runtime-commentary", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [INTERNAL_IP_HASH_HEADER]: "a".repeat(64),
              "x-internal-runtime-commentary": "1",
            },
            body: JSON.stringify(body),
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          schemaVersion: 1,
          text: "Karl surveys the stone and stick as if they had applied for the position.",
          roles: ["humour", "story"],
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("does not spend global capacity when the per-IP quota rejects a request", async () => {
    const { coordinator } = nyCoordinator();
    const noisyIp = "a".repeat(64);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (await coordinator.fetch(runCreateReservationRequest(noisyIp))).status,
      ).toBe(204);
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      expect(
        (await coordinator.fetch(runCreateReservationRequest(noisyIp))).status,
      ).toBe(429);
    }

    expect(
      (
        await coordinator.fetch(
          runCreateReservationRequest("b".repeat(64)),
        )
      ).status,
    ).toBe(204);
  });
});
