import { describe, expect, it } from "vitest";
import worker from "../worker/src/index";
import { Coordinator } from "../worker/src/coordinator-do";
import { BUDGET_KEY, IP_BUDGET_KEY_PREFIX } from "../worker/src/coordinator";
import { ADMIN_VERIFIED_HEADER } from "../worker/src/admin";
import { STATS_KEY_PREFIX, statsKey, type PairStatsRecord } from "../worker/src/stats";
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
} from "../worker/src/cf-types";

/**
 * TASK-008: den autentificerede admin-eksport (`GET /admin/pairs`).
 *
 * Samme håndlavede attrap-mønster som `tests/worker-edge.test.ts` (egne
 * lokale kopier, ikke delt på tværs af testfiler, jf. den etablerede
 * konvention i dette repo). To niveauer testes hver for sig, ligesom
 * `worker-edge.test.ts` allerede adskiller `index.ts` fra `Coordinator`:
 *   - `index.ts`: selve token-godkendelsen, origin-omgåelsen, at det RÅ
 *     token ALDRIG videresendes.
 *   - `coordinator-do.ts`: selve eksport-payloaden, sideinddeling,
 *     metodetjek, forsvar-i-dybden-tjekket af `ADMIN_VERIFIED_HEADER`, og
 *     at admin-stien aldrig rører model eller budget.
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
const TOKEN = "det-rigtige-admin-token-til-tests";

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

function adminRequest(headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`https://narrator.example/admin/pairs${query}`, {
    method: "GET",
    headers,
  });
}

async function seedStat(storage: FakeStorage, aId: string, bId: string, verdict: string, count: number): Promise<void> {
  const rec: PairStatsRecord = {
    aId,
    bId,
    verdict: verdict as PairStatsRecord["verdict"],
    count,
    cacheHits: 0,
    upstreamCalls: count,
    firstSeen: 1000,
    lastSeen: 2000,
  };
  await storage.put(statsKey(aId, bId, verdict), rec);
}

describe("index.ts: /admin/pairs kræver et bearer-token, og omgår oprindelsespolitikken", () => {
  it("afviser MED 401 uden nogen ADMIN_EXPORT_TOKEN konfigureret — fejler LUKKET, DO'en kaldes aldrig", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, COORDINATOR: new FakeNamespace(stub) }; // intet ADMIN_EXPORT_TOKEN
    const req = adminRequest({ authorization: `Bearer ${TOKEN}` });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(401);
    expect(stub.received).toHaveLength(0);
  });

  it("afviser MED 401 ved manglende Authorization-header", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = adminRequest();

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(401);
    expect(stub.received).toHaveLength(0);
  });

  it("afviser MED 401 ved et forkert token", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = adminRequest({ authorization: "Bearer forkert-token" });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(401);
    expect(stub.received).toHaveLength(0);
  });

  it("afviser MED 405 en ikke-GET anmodning, selv med korrekt token", async () => {
    const stub = new FakeStub(async () => new Response("skulle ikke kaldes", { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = new Request("https://narrator.example/admin/pairs", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(405);
    expect(stub.received).toHaveLength(0);
  });

  it("godkender med korrekt token og videresender til Durable Object'et med ADMIN_VERIFIED_HEADER sat", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = adminRequest({ authorization: `Bearer ${TOKEN}` });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(200);
    expect(stub.received).toHaveLength(1);
    expect(stub.received[0]!.headers.get(ADMIN_VERIFIED_HEADER)).toBe("1");
  });

  it("videresender ALDRIG det rå Authorization-token til Durable Object'et", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = adminRequest({ authorization: `Bearer ${TOKEN}` });

    await worker.fetch(req, env as never);

    expect(stub.received[0]!.headers.get("authorization")).toBeNull();
  });

  it("omgår oprindelsespolitikken — en IKKE-tilladt origin blokerer stadig den almindelige POST-strøm, men ikke /admin/pairs", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    const env = {
      ALLOWED_ORIGINS: "https://karl.example",
      IP_HASH_SALT: SALT,
      ADMIN_EXPORT_TOKEN: TOKEN,
      COORDINATOR: new FakeNamespace(stub),
    };

    // Den almindelige narrator-strøm: en forbudt origin afvises MED 403.
    const narratorReq = new Request("https://narrator.example/", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ond-side.example" },
      body: JSON.stringify({ aId: "a", bId: "b", verdict: "inert" }),
    });
    const narratorRes = await worker.fetch(narratorReq, env as never);
    expect(narratorRes.status).toBe(403);

    // /admin/pairs sætter slet ingen origin, og skal stadig lykkes med korrekt token.
    const adminReq = adminRequest({ authorization: `Bearer ${TOKEN}` });
    const adminRes = await worker.fetch(adminReq, env as never);
    expect(adminRes.status).toBe(200);
  });

  it("videresender query-strengen (limit/cursor) uændret til Durable Object'et", async () => {
    const stub = new FakeStub(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    const env = { ALLOWED_ORIGINS: "", IP_HASH_SALT: SALT, ADMIN_EXPORT_TOKEN: TOKEN, COORDINATOR: new FakeNamespace(stub) };
    const req = adminRequest({ authorization: `Bearer ${TOKEN}` }, "?limit=5&cursor=10");

    await worker.fetch(req, env as never);

    const forwardedUrl = new URL(stub.received[0]!.url);
    expect(forwardedUrl.searchParams.get("limit")).toBe("5");
    expect(forwardedUrl.searchParams.get("cursor")).toBe("10");
  });
});

describe("Coordinator (Durable Object): /admin/pairs — forsvar-i-dybden, payload, sideinddeling", () => {
  it("afviser MED 401 hvis ADMIN_VERIFIED_HEADER mangler — stoler ALDRIG blindt på routing alene", async () => {
    const { coordinator } = nyCoordinator();
    const res = await coordinator.fetch(adminRequest());
    expect(res.status).toBe(401);
  });

  it("afviser MED 405 en ikke-GET anmodning, selv med ADMIN_VERIFIED_HEADER sat", async () => {
    const { coordinator } = nyCoordinator();
    const req = new Request("https://internal/admin/pairs", {
      method: "POST",
      headers: { [ADMIN_VERIFIED_HEADER]: "1" },
    });
    const res = await coordinator.fetch(req);
    expect(res.status).toBe(405);
  });

  it("returnerer en gyldig eksport-payload med det dokumenterede skema", async () => {
    const { coordinator, storage } = nyCoordinator();
    await seedStat(storage, "baer", "ler", "plausible", 5);

    const res = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      cacheNamespace: string;
      voiceProfileVersion: number;
      voiceProfileHash: string;
      total: number;
      entries: PairStatsRecord[];
      nextCursor: string | null;
    };
    expect(body.schemaVersion).toBeGreaterThan(0);
    expect(typeof body.cacheNamespace).toBe("string");
    expect(typeof body.voiceProfileHash).toBe("string");
    expect(body.total).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.aId).toBe("baer");
    expect(body.entries[0]!.count).toBe(5);
  });

  it("respekterer limit/cursor query-parametre", async () => {
    const { coordinator, storage } = nyCoordinator();
    await seedStat(storage, "a0", "b0", "plausible", 10);
    await seedStat(storage, "a1", "b1", "plausible", 9);
    await seedStat(storage, "a2", "b2", "plausible", 8);

    const firstPage = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }, "?limit=1"));
    const firstBody = (await firstPage.json()) as { entries: PairStatsRecord[]; nextCursor: string | null };
    expect(firstBody.entries).toHaveLength(1);
    expect(firstBody.entries[0]!.aId).toBe("a0");
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await coordinator.fetch(
      adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }, `?limit=1&cursor=${firstBody.nextCursor}`),
    );
    const secondBody = (await secondPage.json()) as { entries: PairStatsRecord[] };
    expect(secondBody.entries).toHaveLength(1);
    expect(secondBody.entries[0]!.aId).toBe("a1");
  });

  it("eksporten afslører ALDRIG IP-hashes, budget-tal eller cache-tekst — kun stats-formede felter", async () => {
    const { coordinator, storage } = nyCoordinator();
    await seedStat(storage, "baer", "ler", "plausible", 1);
    // Andre, følsomme poster i SAMME lager — eksporten må ikke lække dem.
    await storage.put(`${IP_BUDGET_KEY_PREFIX}${"a".repeat(64)}`, { date: "2026-01-01", count: 42 });
    await storage.put(BUDGET_KEY, { date: "2026-01-01", count: 999 });
    await storage.put("cache:v1:hemmelig+tekst:inert", { text: "En hemmelig, genereret linje.", createdAt: 1 });

    const res = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));
    const raw = await res.text();

    expect(raw).not.toContain("a".repeat(64));
    expect(raw).not.toContain("En hemmelig, genereret linje");
    expect(raw).not.toContain("999");
  });

  it("admin-stien rører ALDRIG budgettet eller kalder modellen", async () => {
    const { coordinator, storage } = nyCoordinator({ DAILY_MAX_UPSTREAM_CALLS: "0" }); // ville normalt afvise ALT opstrøms
    await seedStat(storage, "baer", "ler", "plausible", 1);

    const res = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));
    expect(res.status).toBe(200); // upåvirket af et udtømt dagligt loft — admin er en helt anden sti

    expect(await storage.get(BUDGET_KEY)).toBeUndefined(); // budgettet er urørt
  });

  it("gentagne admin-kald rammer til sidst admin-ratelimiten (samme mekanisme som narrator-strømmen, egen nøgle)", async () => {
    const { coordinator } = nyCoordinator({ RATE_LIMIT_MAX: "2" });

    const first = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));
    const second = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));
    const third = await coordinator.fetch(adminRequest({ [ADMIN_VERIFIED_HEADER]: "1" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });
});

describe("Coordinator: alarm() rydder også forældede stats-poster (TASK-008)", () => {
  it("fjerner en stats-post uden aktivitet i STATS_MAX_AGE_MS, men lader en fersk post stå", async () => {
    const { coordinator, storage } = nyCoordinator();
    const now = Date.now();
    const NINETY_ONE_DAYS = 91 * 24 * 60 * 60 * 1000;

    await storage.put(`${STATS_KEY_PREFIX}gammel+par:inert`, {
      aId: "gammel",
      bId: "par",
      verdict: "inert",
      count: 1,
      cacheHits: 0,
      upstreamCalls: 1,
      firstSeen: now - NINETY_ONE_DAYS,
      lastSeen: now - NINETY_ONE_DAYS,
    });
    await storage.put(`${STATS_KEY_PREFIX}frisk+par:inert`, {
      aId: "frisk",
      bId: "par",
      verdict: "inert",
      count: 1,
      cacheHits: 0,
      upstreamCalls: 1,
      firstSeen: now,
      lastSeen: now,
    });

    await coordinator.alarm();

    expect(await storage.get(`${STATS_KEY_PREFIX}gammel+par:inert`)).toBeUndefined();
    expect(await storage.get(`${STATS_KEY_PREFIX}frisk+par:inert`)).toBeDefined();
  });
});
