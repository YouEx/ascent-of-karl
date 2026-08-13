/**
 * TASK-008: rene funktioner bag `tools/live_pair_export.mjs` — CLI'en der
 * henter den autentificerede admin-eksport (`GET /admin/pairs`,
 * `worker/src/coordinator-do.ts`s `handleAdminExport`) og skriver et
 * lokalt, versioneret artefakt under docs/design/ til brug for
 * `tools/prepare_pairs.ts`s høste-tilstand (`--live=<sti>`).
 *
 * INGEN rigtige netværkskald her — `fetchAllPages` tager altid en
 * injiceret `fetchImpl` ind, netop så denne fil (og dens tests) aldrig
 * selv rammer et rigtigt endpoint. Selve CLI'en (`live_pair_export.mjs`)
 * giver det ægte globale `fetch` ind som `fetchImpl`.
 *
 * `EXPECTED_SCHEMA_VERSION`/`KNOWN_VERDICTS` er BEVIDST duplikeret her
 * (samme mønster som Python↔TS-stemmeparitetens duplikerede konstanter):
 * denne fil er ren ESM uden byggetrin og kan ikke importere
 * `worker/src/stats.ts`/`worker/src/validate.ts` direkte. Ændres
 * `STATS_EXPORT_SCHEMA_VERSION` eller `KNOWN_VERDICTS` dér, skal de
 * opdateres her MANUELT — en bevidst, dokumenteret kobling, ikke en
 * tilfældig divergens.
 */

/** Se `worker/src/stats.ts`s `STATS_EXPORT_SCHEMA_VERSION` — hold i sync manuelt. */
export const EXPECTED_SCHEMA_VERSION = 1;

/** Se `worker/src/validate.ts`s `KNOWN_VERDICTS` — hold i sync manuelt, samme rækkefølge. */
export const KNOWN_VERDICTS = ["plausible", "near-miss", "clash", "absurd", "self", "inert", "locked"];

/**
 * Validerer FORMEN af ÉN sides eksport-svar, FØR dens `entries` bruges til
 * noget som helst — kaster tydeligt på en uventet `schemaVersion` (en
 * fremtidig, inkompatibel eksport-form skal ALDRIG stiltiende fejltolkes)
 * eller et manglende `entries`-array.
 */
export function validateExportPage(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("eksport-svar skal være et objekt");
  }
  if (payload.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`uventet schemaVersion i eksport-svar: ${payload.schemaVersion} (forventede ${EXPECTED_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(payload.entries)) {
    throw new Error("eksport-svar mangler et entries-array");
  }
  return payload;
}

/**
 * Validerer hver indgang mod den KANONISKE element-liste
 * (`content/elements.json`, indlæst af selve CLI'en og givet ind som
 * `knownElementIds`) og den kendte dom-liste — UAFHÆNGIGT af hvad worker'en
 * selv mener er gyldigt, netop fordi denne fil kører uden for workeren og
 * ikke skal stole blindt på dens svar.
 */
export function validateEntries(entries, knownElementIds) {
  for (const e of entries) {
    if (!e || typeof e.aId !== "string" || typeof e.bId !== "string") {
      throw new Error(`indgang mangler gyldige aId/bId: ${JSON.stringify(e)}`);
    }
    if (!knownElementIds.has(e.aId)) {
      throw new Error(`ukendt element-id (findes ikke i content/elements.json): ${e.aId}`);
    }
    if (!knownElementIds.has(e.bId)) {
      throw new Error(`ukendt element-id (findes ikke i content/elements.json): ${e.bId}`);
    }
    if (typeof e.verdict !== "string" || !KNOWN_VERDICTS.includes(e.verdict)) {
      throw new Error(`ukendt dom: ${JSON.stringify(e.verdict)}`);
    }
    if (typeof e.count !== "number" || !Number.isFinite(e.count) || e.count < 0) {
      throw new Error(`ugyldigt count for ${e.aId}+${e.bId}:${e.verdict}: ${JSON.stringify(e.count)}`);
    }
  }
  return entries;
}

/**
 * Henter ALLE sider fra admin-endpointet, og følger `nextCursor` indtil
 * den er `null` — samler alle `entries` til ÉN liste. Kaster FØR noget
 * kald overhovedet sker, hvis `url`/`token` mangler (ingen grund til at
 * ramme netværket med et kald der uundgåeligt ville fejle).
 */
export async function fetchAllPages({ url, token, fetchImpl, limit }) {
  if (!url) throw new Error("LIVE_NARRATOR_ADMIN_URL mangler");
  if (!token) throw new Error("LIVE_NARRATOR_ADMIN_TOKEN mangler");

  const entries = [];
  let cursor = null;
  let lastPage = null;

  do {
    const pageUrl = new URL(url);
    if (limit) pageUrl.searchParams.set("limit", String(limit));
    if (cursor) pageUrl.searchParams.set("cursor", cursor);

    const res = await fetchImpl(pageUrl.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      throw new Error("uautoriseret (401) — tjek LIVE_NARRATOR_ADMIN_TOKEN");
    }
    if (!res.ok) {
      throw new Error(`eksport fejlede: HTTP ${res.status}`);
    }

    const page = validateExportPage(await res.json());
    entries.push(...page.entries);
    lastPage = page;
    cursor = page.nextCursor ?? null;
  } while (cursor);

  return { ...lastPage, entries };
}

/**
 * Bygger selve artefaktet der skrives til disk. INTET token — denne
 * funktion får det aldrig ind som parameter overhovedet, så der ikke
 * findes noget token-felt at glemme at fjerne.
 */
export function buildLocalArtifact(merged, exportedAt) {
  return {
    schemaVersion: merged.schemaVersion,
    cacheNamespace: merged.cacheNamespace,
    voiceProfileVersion: merged.voiceProfileVersion,
    voiceProfileHash: merged.voiceProfileHash,
    generatedAt: merged.generatedAt,
    exportedAt,
    total: merged.entries.length,
    entries: merged.entries,
  };
}

/** Hvor det validerede, lokale artefakt skrives — forbrugt af `tools/prepare_pairs.ts --live=<sti>`. */
export const DEFAULT_OUT_PATH = "docs/design/live-pair-stats.json";

/**
 * Selve CLI-orkestreringen: læs miljø → hent alle sider → validér mod
 * kanonisk element-liste → byg artefakt → skriv til disk. ALLE eksterne
 * afhængigheder (miljø, fetch, filsystem, ur) er parametre med sikre
 * standardværdier — netop så denne funktion (og dermed hele CLI'ens
 * adfærd) kan testes med injicerede, ikke-rigtige afhængigheder, samme
 * mønster som resten af filen. Selve entry-point-filen
 * (`tools/live_pair_export.mjs`) kalder denne funktion ubetinget ved
 * modul-scope, uden yderligere logik — samme opdeling som
 * `tools/prepare_pairs.ts`/`tools/prepare_pairs_lib.mjs`.
 */
export async function run({
  env = process.env,
  fetchImpl = fetch,
  readFile,
  writeFile,
  outPath = DEFAULT_OUT_PATH,
  now = () => new Date().toISOString(),
} = {}) {
  const url = env.LIVE_NARRATOR_ADMIN_URL;
  const token = env.LIVE_NARRATOR_ADMIN_TOKEN;
  const limit = env.LIVE_NARRATOR_ADMIN_LIMIT ? Number.parseInt(env.LIVE_NARRATOR_ADMIN_LIMIT, 10) : undefined;

  const elements = JSON.parse(readFile("content/elements.json", "utf8"));
  const knownElementIds = new Set(elements.map((e) => e.id));

  const merged = await fetchAllPages({ url, token, fetchImpl, limit });
  validateEntries(merged.entries, knownElementIds);

  const artifact = buildLocalArtifact(merged, now());
  writeFile(outPath, JSON.stringify(artifact, null, 2) + "\n");
  return artifact;
}
