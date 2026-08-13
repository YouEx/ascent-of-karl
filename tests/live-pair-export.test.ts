import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — hjælpefilen er ren ESM uden typedeklaration.
import { EXPECTED_SCHEMA_VERSION, KNOWN_VERDICTS, buildLocalArtifact, fetchAllPages, run, validateEntries, validateExportPage } from "../tools/live_pair_export_lib.mjs";

/**
 * TASK-008: de RENE funktioner bag `tools/live_pair_export.mjs` (CLI'en der
 * henter `GET /admin/pairs` og skriver et lokalt, versioneret artefakt
 * under docs/design/). INGEN rigtige netværkskald her — `fetchAllPages`
 * tager altid en injiceret `fetchImpl`, se `fetchImpl`-parameteren.
 */

function fakeResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe("validateExportPage", () => {
  it("accepterer en gyldig side", () => {
    const payload = { schemaVersion: EXPECTED_SCHEMA_VERSION, entries: [], nextCursor: null };
    expect(validateExportPage(payload)).toBe(payload);
  });

  it("afviser en uventet schemaVersion", () => {
    expect(() => validateExportPage({ schemaVersion: 999, entries: [] })).toThrow(/schemaVersion/);
  });

  it("afviser et svar uden entries-array", () => {
    expect(() => validateExportPage({ schemaVersion: EXPECTED_SCHEMA_VERSION })).toThrow(/entries/);
  });

  it("afviser et ikke-objekt", () => {
    expect(() => validateExportPage(null)).toThrow(/objekt/);
    expect(() => validateExportPage("skal fejle")).toThrow(/objekt/);
  });
});

describe("validateEntries", () => {
  const knownIds = new Set(["graes", "vand", "sten"]);

  it("accepterer gyldige indgange mod den kanoniske element-liste og de kendte domme", () => {
    const entries = [{ aId: "graes", bId: "vand", verdict: "clash", count: 5 }];
    expect(validateEntries(entries, knownIds)).toBe(entries);
  });

  it("afviser et ukendt aId/bId (ikke i content/elements.json)", () => {
    expect(() => validateEntries([{ aId: "ukendt-ting", bId: "vand", verdict: "clash", count: 1 }], knownIds)).toThrow(
      /ukendt element-id/,
    );
    expect(() => validateEntries([{ aId: "graes", bId: "ukendt-ting", verdict: "clash", count: 1 }], knownIds)).toThrow(
      /ukendt element-id/,
    );
  });

  it("afviser en ukendt dom", () => {
    expect(() => validateEntries([{ aId: "graes", bId: "vand", verdict: "ikke-en-dom", count: 1 }], knownIds)).toThrow(
      /ukendt dom/,
    );
  });

  it("afviser et negativt eller ikke-numerisk count", () => {
    expect(() => validateEntries([{ aId: "graes", bId: "vand", verdict: "clash", count: -1 }], knownIds)).toThrow(
      /count/,
    );
    expect(() =>
      validateEntries([{ aId: "graes", bId: "vand", verdict: "clash", count: "5" }], knownIds),
    ).toThrow(/count/);
  });

  it("accepterer alle kendte domme", () => {
    for (const verdict of KNOWN_VERDICTS) {
      expect(() => validateEntries([{ aId: "graes", bId: "vand", verdict, count: 1 }], knownIds)).not.toThrow();
    }
  });
});

describe("fetchAllPages", () => {
  it("kaster FØR noget netværkskald hvis url eller token mangler", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchAllPages({ url: "", token: "t", fetchImpl })).rejects.toThrow(/LIVE_NARRATOR_ADMIN_URL/);
    await expect(fetchAllPages({ url: "https://x/admin/pairs", token: "", fetchImpl })).rejects.toThrow(
      /LIVE_NARRATOR_ADMIN_TOKEN/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("henter én side og returnerer dens entries, uændret", async () => {
    const page = { schemaVersion: EXPECTED_SCHEMA_VERSION, cacheNamespace: "v1", entries: [{ aId: "a", bId: "b", verdict: "inert", count: 1 }], nextCursor: null };
    const fetchImpl = vi.fn(async () => fakeResponse(200, page));

    const result = await fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "hemmelig", fetchImpl });

    expect(result.entries).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sætter Authorization: Bearer <token> på hvert kald", async () => {
    const page = { schemaVersion: EXPECTED_SCHEMA_VERSION, entries: [], nextCursor: null };
    const fetchImpl = vi.fn(async () => fakeResponse(200, page));

    await fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "mit-hemmelige-token", fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mit-hemmelige-token");
  });

  it("følger nextCursor på tværs af flere sider og samler alle entries", async () => {
    const pageA = {
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      entries: [{ aId: "a", bId: "b", verdict: "inert", count: 1 }],
      nextCursor: "10",
    };
    const pageB = {
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      entries: [{ aId: "c", bId: "d", verdict: "self", count: 2 }],
      nextCursor: null,
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(200, pageA)).mockResolvedValueOnce(fakeResponse(200, pageB));

    const result = await fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "t", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.entries).toHaveLength(2);
    const secondCallUrl = new URL(fetchImpl.mock.calls[1]![0] as string);
    expect(secondCallUrl.searchParams.get("cursor")).toBe("10");
  });

  it("kaster en tydelig fejl ved 401, uden at afsløre mere end statuskoden", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(401, { error: "unauthorized" }));
    await expect(fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "forkert", fetchImpl })).rejects.toThrow(
      /uautoriseret|401/i,
    );
  });

  it("kaster en tydelig fejl ved andre fejlende statuskoder", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(500, { error: "server error" }));
    await expect(fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "t", fetchImpl })).rejects.toThrow(
      /500/,
    );
  });

  it("kaster hvis en side har en uventet schemaVersion, selv midt i sideinddeling", async () => {
    const badPage = { schemaVersion: 999, entries: [], nextCursor: null };
    const fetchImpl = vi.fn(async () => fakeResponse(200, badPage));
    await expect(fetchAllPages({ url: "https://narrator.example/admin/pairs", token: "t", fetchImpl })).rejects.toThrow(
      /schemaVersion/,
    );
  });
});

describe("buildLocalArtifact", () => {
  it("bygger artefaktet UDEN noget token-felt, med exportedAt og et total-tal", () => {
    const merged = {
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      cacheNamespace: "v1",
      voiceProfileVersion: 3,
      voiceProfileHash: "abc123",
      generatedAt: 1700000000000,
      entries: [{ aId: "a", bId: "b", verdict: "inert", count: 1 }],
    };
    const artifact = buildLocalArtifact(merged, "2026-01-01T00:00:00.000Z");

    expect(artifact.total).toBe(1);
    expect(artifact.exportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(artifact.entries).toEqual(merged.entries);
    expect(JSON.stringify(artifact)).not.toContain("token");
    expect(JSON.stringify(artifact).toLowerCase()).not.toContain("authorization");
  });
});

describe("run() — selve CLI-orkestreringen, med injicerede afhængigheder (INGEN rigtig fetch/disk)", () => {
  const fakeElements = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  function deps(overrides: Record<string, unknown> = {}) {
    const written: Array<{ path: string; content: string }> = [];
    return {
      env: { LIVE_NARRATOR_ADMIN_URL: "https://narrator.example/admin/pairs", LIVE_NARRATOR_ADMIN_TOKEN: "hemmelig" },
      fetchImpl: vi.fn(async () =>
        fakeResponse(200, {
          schemaVersion: EXPECTED_SCHEMA_VERSION,
          cacheNamespace: "v1",
          voiceProfileVersion: 2,
          voiceProfileHash: "hash123",
          generatedAt: 1700000000000,
          entries: [{ aId: "a", bId: "b", verdict: "inert", count: 3 }],
          nextCursor: null,
        }),
      ),
      readFile: vi.fn(() => JSON.stringify(fakeElements)),
      writeFile: vi.fn((path: string, content: string) => {
        written.push({ path, content });
      }),
      outPath: "docs/design/live-pair-stats.test.json",
      now: () => "2026-02-02T00:00:00.000Z",
      __written: written,
      ...overrides,
    };
  }

  it("henter, validerer og skriver artefaktet via de injicerede afhængigheder, uden nogen rigtig fetch/disk", async () => {
    const d = deps();
    const artifact = await run(d);

    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.writeFile).toHaveBeenCalledTimes(1);
    expect(artifact.total).toBe(1);
    expect(artifact.entries[0]).toMatchObject({ aId: "a", bId: "b", verdict: "inert", count: 3 });
    expect(artifact.exportedAt).toBe("2026-02-02T00:00:00.000Z");

    const [writtenPath, writtenContent] = d.writeFile.mock.calls[0] as [string, string];
    expect(writtenPath).toBe("docs/design/live-pair-stats.test.json");
    expect(JSON.parse(writtenContent)).toMatchObject({ total: 1 });
    expect(writtenContent).not.toContain("hemmelig"); // token må ALDRIG stå i den skrevne fil
  });

  it("skriver ALDRIG artefaktet hvis en indgang har et ukendt element-id (fejler før write)", async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        fakeResponse(200, {
          schemaVersion: EXPECTED_SCHEMA_VERSION,
          entries: [{ aId: "ukendt-element", bId: "b", verdict: "inert", count: 1 }],
          nextCursor: null,
        }),
      ),
    });

    await expect(run(d)).rejects.toThrow(/ukendt element-id/);
    expect(d.writeFile).not.toHaveBeenCalled();
  });

  it("skriver ALDRIG artefaktet ved 401 — fejler tydeligt før noget filsystemkald", async () => {
    const d = deps({ fetchImpl: vi.fn(async () => fakeResponse(401, { error: "unauthorized" })) });

    await expect(run(d)).rejects.toThrow(/401|uautoriseret/i);
    expect(d.writeFile).not.toHaveBeenCalled();
  });

  it("bruger LIVE_NARRATOR_ADMIN_LIMIT fra miljøet som limit-parameter, hvis sat", async () => {
    const d = deps({ env: { LIVE_NARRATOR_ADMIN_URL: "https://narrator.example/admin/pairs", LIVE_NARRATOR_ADMIN_TOKEN: "t", LIVE_NARRATOR_ADMIN_LIMIT: "17" } });
    await run(d);
    const calledUrl = new URL((d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("limit")).toBe("17");
  });
});
