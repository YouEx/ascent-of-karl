#!/usr/bin/env node
/**
 * TASK-029: høst cachede improvisationer som UBETROEDE review-kandidater.
 *
 * Værktøjet skriver aldrig kanonisk content. Produktion kræver en eksplicit
 * `--url` til GET /admin/improvisations og læser kun admin-tokenet fra
 * LIVE_NARRATOR_ADMIN_TOKEN. Offline audit bruger `--input <fixture.json>`.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT_PATH = "content/drafts/harvested.json";
export const HARVEST_LIMITS = Object.freeze({
  exportSchemaVersion: 2,
  artifactSchemaVersion: 1,
  pageSize: 200,
  maxPages: 100,
  maxRows: 10_000,
  maxRowsPerPage: 500,
  maxPageBytes: 1_000_000,
  maxInputBytes: 16_000_000,
  idChars: 64,
  minAct: 1,
  maxAct: 5,
  nameChars: 48,
  nameWords: 3,
  flavorChars: 240,
  promptNamespaceChars: 128,
  cursorChars: 256,
});

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_ENV = "LIVE_NARRATOR_ADMIN_TOKEN";
const PAGE_FIELDS = [
  "counts",
  "entries",
  "generatedAt",
  "nextCursor",
  "promptNamespace",
  "schemaVersion",
  "total",
];
const COUNT_FIELDS = ["cacheHits", "cached", "requests", "upstreamCalls"];
const ROW_FIELDS = [
  "aId",
  "act",
  "bId",
  "cacheHits",
  "count",
  "createdAt",
  "firstSeen",
  "flavor",
  "lastSeen",
  "name",
  "upstreamCalls",
];
const ID = /^[a-z0-9-]+$/;
const NAMESPACE = /^[0-9a-f]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const QUOTES = /["'`“”‘’«»]/;
const URL_LIKE =
  /(?:https?:\/\/|www\.|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\/\S*)?)/i;
const PUNCTUATION_WILDERNESS = /[!?.,;:—–-]{3,}/;
const UNSAFE_PUNCTUATION = /[{}\[\]<>\\|@#$%^*_+=~\/]/;
const SAFE_NAME = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
const SAFE_FLAVOR = /^[\p{L}\p{N}\p{Zs}.,!?;:()—–-]+$/u;

class HarvestError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarvestError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactFields(value, expected, label) {
  if (!isPlainObject(value)) {
    throw new HarvestError(`${label} skal være et objekt med eksakt skema`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((field, index) => field !== wanted[index])
  ) {
    throw new HarvestError(`${label} har ukendte eller manglende felter`);
  }
  return value;
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HarvestError(`${label} skal være et ikke-negativt sikkert heltal`);
  }
  return value;
}

function requireBoundedString(value, maxChars, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxChars
  ) {
    throw new HarvestError(`${label} skal være en ikke-tom bounded streng`);
  }
  return value;
}

function isSafeCopyCommon(value) {
  return (
    value === value.trim() &&
    !CONTROL_CHARS.test(value) &&
    !QUOTES.test(value) &&
    !URL_LIKE.test(value) &&
    !PUNCTUATION_WILDERNESS.test(value) &&
    !UNSAFE_PUNCTUATION.test(value)
  );
}

function validateCopy(name, flavor, label) {
  requireBoundedString(name, HARVEST_LIMITS.nameChars, `${label}.name`);
  requireBoundedString(flavor, HARVEST_LIMITS.flavorChars, `${label}.flavor`);
  if (
    name.split(/\s+/).length > HARVEST_LIMITS.nameWords ||
    !SAFE_NAME.test(name) ||
    !isSafeCopyCommon(name)
  ) {
    throw new HarvestError(`${label}.name bryder den bounded copy-kontrakt`);
  }
  if (!SAFE_FLAVOR.test(flavor) || !isSafeCopyCommon(flavor)) {
    throw new HarvestError(`${label}.flavor bryder den bounded copy-kontrakt`);
  }
}

function validateRow(raw, canonicalElements, index) {
  const label = `entries[${index}]`;
  const row = requireExactFields(raw, ROW_FIELDS, label);
  const aId = requireBoundedString(row.aId, HARVEST_LIMITS.idChars, `${label}.aId`);
  const bId = requireBoundedString(row.bId, HARVEST_LIMITS.idChars, `${label}.bId`);
  if (!ID.test(aId) || !ID.test(bId)) {
    throw new HarvestError(`${label} har ugyldigt kanonisk forælder-id`);
  }
  const a = canonicalElements.get(aId);
  const b = canonicalElements.get(bId);
  if (!a) throw new HarvestError(`${label} har ukendt aId`);
  if (!b) throw new HarvestError(`${label} har ukendt bId`);
  if (aId > bId) {
    throw new HarvestError(`${label} har ikke kanonisk sorterede forældre`);
  }

  if (
    !Number.isInteger(row.act) ||
    row.act < HARVEST_LIMITS.minAct ||
    row.act > HARVEST_LIMITS.maxAct
  ) {
    throw new HarvestError(`${label}.act ligger uden for aktgrænsen`);
  }
  if (
    !Number.isInteger(a.act) ||
    !Number.isInteger(b.act) ||
    a.act > row.act ||
    b.act > row.act
  ) {
    throw new HarvestError(`${label} bruger en forælder der ikke er tilgængelig i akten`);
  }

  validateCopy(row.name, row.flavor, label);
  const createdAt = requireSafeInteger(row.createdAt, `${label}.createdAt`);
  const count = requireSafeInteger(row.count, `${label}.count`);
  const cacheHits = requireSafeInteger(row.cacheHits, `${label}.cacheHits`);
  const upstreamCalls = requireSafeInteger(
    row.upstreamCalls,
    `${label}.upstreamCalls`,
  );
  const firstSeen = requireSafeInteger(row.firstSeen, `${label}.firstSeen`);
  const lastSeen = requireSafeInteger(row.lastSeen, `${label}.lastSeen`);
  if (cacheHits + upstreamCalls > count) {
    throw new HarvestError(`${label} har tællinger større end count`);
  }
  if (firstSeen > lastSeen || createdAt > lastSeen) {
    throw new HarvestError(`${label} har tidsstempler i ugyldig rækkefølge`);
  }

  return {
    aId,
    bId,
    act: row.act,
    name: row.name,
    flavor: row.flavor,
    createdAt,
    count,
    cacheHits,
    upstreamCalls,
    firstSeen,
    lastSeen,
  };
}

function cursorFor(row) {
  return `${row.aId}~${row.bId}~${row.act}`;
}

export function validateExportPage(raw, canonicalElements) {
  if (!(canonicalElements instanceof Map)) {
    throw new HarvestError("kanonisk elementkatalog mangler");
  }
  const page = requireExactFields(raw, PAGE_FIELDS, "eksportside");
  if (page.schemaVersion !== HARVEST_LIMITS.exportSchemaVersion) {
    throw new HarvestError(
      `uventet schemaVersion: forventede ${HARVEST_LIMITS.exportSchemaVersion}`,
    );
  }
  const promptNamespace = requireBoundedString(
    page.promptNamespace,
    HARVEST_LIMITS.promptNamespaceChars,
    "promptNamespace",
  );
  if (!NAMESPACE.test(promptNamespace)) {
    throw new HarvestError("promptNamespace har ugyldig form");
  }
  const generatedAt = requireSafeInteger(page.generatedAt, "generatedAt");
  const total = requireSafeInteger(page.total, "total");
  if (total > HARVEST_LIMITS.maxRows) {
    throw new HarvestError(`total overskrider maksimum på ${HARVEST_LIMITS.maxRows} rækker`);
  }

  const counts = requireExactFields(page.counts, COUNT_FIELDS, "counts");
  const normalizedCounts = {
    cached: requireSafeInteger(counts.cached, "counts.cached"),
    requests: requireSafeInteger(counts.requests, "counts.requests"),
    cacheHits: requireSafeInteger(counts.cacheHits, "counts.cacheHits"),
    upstreamCalls: requireSafeInteger(
      counts.upstreamCalls,
      "counts.upstreamCalls",
    ),
  };
  if (normalizedCounts.cached !== total) {
    throw new HarvestError("counts.cached skal være lig total");
  }
  if (
    normalizedCounts.cacheHits + normalizedCounts.upstreamCalls >
    normalizedCounts.requests
  ) {
    throw new HarvestError("globale tællinger er indbyrdes ugyldige");
  }

  if (!Array.isArray(page.entries)) {
    throw new HarvestError("eksportside.entries skal være et array");
  }
  if (page.entries.length > HARVEST_LIMITS.maxRowsPerPage) {
    throw new HarvestError(
      `eksportsiden overskrider maksimum på ${HARVEST_LIMITS.maxRowsPerPage} rækker`,
    );
  }
  if (page.entries.length > total) {
    throw new HarvestError("eksportsiden indeholder flere rækker end total");
  }
  const entries = page.entries.map((entry, index) =>
    validateRow(entry, canonicalElements, index),
  );
  const pageRequests = entries.reduce((sum, entry) => sum + entry.count, 0);
  const pageCacheHits = entries.reduce((sum, entry) => sum + entry.cacheHits, 0);
  const pageUpstreamCalls = entries.reduce(
    (sum, entry) => sum + entry.upstreamCalls,
    0,
  );
  if (
    pageRequests > normalizedCounts.requests ||
    pageCacheHits > normalizedCounts.cacheHits ||
    pageUpstreamCalls > normalizedCounts.upstreamCalls
  ) {
    throw new HarvestError("sidens rækketællinger overstiger eksportens totaler");
  }

  let nextCursor = null;
  if (page.nextCursor !== null) {
    nextCursor = requireBoundedString(
      page.nextCursor,
      HARVEST_LIMITS.cursorChars,
      "nextCursor",
    );
    if (CONTROL_CHARS.test(nextCursor) || entries.length === 0) {
      throw new HarvestError("nextCursor har ugyldig form");
    }
    if (nextCursor !== cursorFor(entries.at(-1))) {
      throw new HarvestError("nextCursor matcher ikke sidens stabile cursor-after-key");
    }
  }

  return {
    schemaVersion: page.schemaVersion,
    promptNamespace,
    generatedAt,
    total,
    counts: normalizedCounts,
    entries,
    nextCursor,
  };
}

export function assertCollectionBounds(pageCount, rowCount) {
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 0 ||
    pageCount > HARVEST_LIMITS.maxPages
  ) {
    throw new HarvestError(
      `høsten overskrider maksimum på ${HARVEST_LIMITS.maxPages} sider`,
    );
  }
  if (
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    rowCount > HARVEST_LIMITS.maxRows
  ) {
    throw new HarvestError(
      `høsten overskrider maksimum på ${HARVEST_LIMITS.maxRows} rækker`,
    );
  }
}

function validateAdminUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HarvestError("--url skal være en gyldig, eksplicit URL");
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new HarvestError("--url må ikke indeholde login, fragment eller query");
  }
  if (url.pathname !== "/admin/improvisations") {
    throw new HarvestError("--url skal pege præcist på /admin/improvisations");
  }
  const loopback = ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
    url.hostname,
  );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new HarvestError("--url skal bruge HTTPS (HTTP tillades kun lokalt)");
  }
  return url;
}

async function readBoundedResponseText(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > HARVEST_LIMITS.maxPageBytes) {
      throw new HarvestError("eksportens body er for stor");
    }
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > HARVEST_LIMITS.maxPageBytes) {
      throw new HarvestError("eksportens body er for stor");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > HARVEST_LIMITS.maxPageBytes) {
      await reader.cancel();
      throw new HarvestError("eksportens body er for stor");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HarvestError(`${label} er ikke gyldig JSON`);
  }
}

function addPageToCollection(page, state) {
  assertCollectionBounds(state.pageCount + 1, state.entries.length + page.entries.length);
  if (
    state.promptNamespace !== null &&
    state.promptNamespace !== page.promptNamespace
  ) {
    throw new HarvestError("promptNamespace ændrede sig mellem sider");
  }
  state.promptNamespace ??= page.promptNamespace;
  for (const entry of page.entries) {
    const key = cursorFor(entry);
    if (state.identities.has(key)) {
      throw new HarvestError(`dublet i stabil pair+act-identitet: ${key}`);
    }
    state.identities.add(key);
    state.entries.push(entry);
  }
  state.pageCount += 1;
}

export async function fetchAllPages({
  url,
  token,
  fetchImpl = fetch,
  canonicalElements,
}) {
  const endpoint = validateAdminUrl(url);
  if (typeof token !== "string" || token.length === 0) {
    throw new HarvestError(`${TOKEN_ENV} mangler`);
  }

  const state = {
    pageCount: 0,
    promptNamespace: null,
    entries: [],
    identities: new Set(),
  };
  const seenCursors = new Set();
  let cursor = null;

  while (true) {
    assertCollectionBounds(state.pageCount + 1, state.entries.length);
    if (state.entries.length === HARVEST_LIMITS.maxRows) {
      throw new HarvestError(
        `høsten overskrider maksimum på ${HARVEST_LIMITS.maxRows} rækker`,
      );
    }
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set("limit", String(HARVEST_LIMITS.pageSize));
    if (cursor !== null) pageUrl.searchParams.set("cursor", cursor);

    let response;
    try {
      response = await fetchImpl(pageUrl.toString(), {
        method: "GET",
        headers: { authorization: ["Bearer", token].join(" ") },
      });
    } catch {
      throw new HarvestError("netværksfejl under hentning af admin-eksport");
    }

    if (response.status === 401 || response.status === 403) {
      throw new HarvestError(`uautoriseret (${response.status}); tjek ${TOKEN_ENV}`);
    }
    if (!response.ok) {
      throw new HarvestError(`admin-eksport fejlede med HTTP ${response.status}`);
    }

    let body;
    try {
      body = await readBoundedResponseText(response);
    } catch (error) {
      if (error instanceof HarvestError) throw error;
      throw new HarvestError("kunne ikke læse admin-eksportens body");
    }
    const page = validateExportPage(
      parseJson(body, "admin-eksportens body"),
      canonicalElements,
    );
    if (
      page.nextCursor !== null &&
      seenCursors.has(page.nextCursor)
    ) {
      throw new HarvestError("nextCursor gentager sig; cursor-cyklus afvist");
    }
    addPageToCollection(page, state);

    if (page.nextCursor === null) {
      return {
        promptNamespace: state.promptNamespace,
        entries: state.entries,
      };
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function readBoundedFile(path, maxBytes, label) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    throw new HarvestError(`${label} kunne ikke læses`);
  }
  if (size > maxBytes) {
    throw new HarvestError(`${label} overskrider maksimum på ${maxBytes} bytes`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new HarvestError(`${label} kunne ikke læses`);
  }
}

function fixturePages(document) {
  if (Array.isArray(document)) return document;
  if (isPlainObject(document) && "schemaVersion" in document) return [document];
  const envelope = requireExactFields(document, ["pages"], "offline-fixture");
  if (!Array.isArray(envelope.pages)) {
    throw new HarvestError("offline-fixture.pages skal være et array");
  }
  return envelope.pages;
}

function collectOfflinePages(pages, canonicalElements) {
  if (pages.length === 0) {
    throw new HarvestError("offline-fixture skal indeholde mindst én eksportside");
  }
  assertCollectionBounds(pages.length, 0);
  const state = {
    pageCount: 0,
    promptNamespace: null,
    entries: [],
    identities: new Set(),
  };
  const seenCursors = new Set();

  pages.forEach((rawPage, index) => {
    const page = validateExportPage(rawPage, canonicalElements);
    if (
      page.nextCursor !== null &&
      seenCursors.has(page.nextCursor)
    ) {
      throw new HarvestError("offline-fixture indeholder en cursor-cyklus");
    }
    addPageToCollection(page, state);
    const isLast = index === pages.length - 1;
    if (!isLast && page.nextCursor === null) {
      throw new HarvestError("offline-fixture har sider efter en afsluttende null-cursor");
    }
    if (isLast && page.nextCursor !== null) {
      throw new HarvestError("offline-fixture mangler siden efter sidste cursor");
    }
    if (page.nextCursor !== null) {
      seenCursors.add(page.nextCursor);
    }
  });

  return {
    promptNamespace: state.promptNamespace,
    entries: state.entries,
  };
}

function loadCanonicalElements(root) {
  const path = resolve(root, "content/elements.json");
  const document = parseJson(
    readBoundedFile(path, HARVEST_LIMITS.maxInputBytes, "content/elements.json"),
    "content/elements.json",
  );
  if (!Array.isArray(document)) {
    throw new HarvestError("content/elements.json skal være et array");
  }
  const catalog = new Map();
  for (const [index, element] of document.entries()) {
    if (
      !isPlainObject(element) ||
      typeof element.id !== "string" ||
      !Number.isInteger(element.act)
    ) {
      throw new HarvestError(`content/elements.json har ugyldig post ved indeks ${index}`);
    }
    if (catalog.has(element.id)) {
      throw new HarvestError(`content/elements.json har dublet-id: ${element.id}`);
    }
    catalog.set(element.id, { id: element.id, act: element.act });
  }
  return catalog;
}

export function buildHarvestArtifact({ promptNamespace, entries }) {
  const byIdentity = new Map();
  for (const entry of entries) {
    const key = cursorFor(entry);
    let candidate = byIdentity.get(key);
    if (!candidate) {
      candidate = {
        reviewStatus: "untrusted",
        pair: [entry.aId, entry.bId],
        act: entry.act,
        copyVariants: [],
      };
      byIdentity.set(key, candidate);
    }
    candidate.copyVariants.push({
      name: entry.name,
      flavor: entry.flavor,
      createdAt: entry.createdAt,
      count: entry.count,
      cacheHits: entry.cacheHits,
      upstreamCalls: entry.upstreamCalls,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
    });
  }

  const ranked = [...byIdentity.values()].map((candidate) => {
    candidate.copyVariants.sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.lastSeen !== left.lastSeen) return right.lastSeen - left.lastSeen;
      if (left.name !== right.name) return left.name < right.name ? -1 : 1;
      if (left.flavor !== right.flavor) return left.flavor < right.flavor ? -1 : 1;
      return left.createdAt - right.createdAt;
    });
    return {
      candidate,
      count: candidate.copyVariants.reduce((sum, variant) => sum + variant.count, 0),
      lastSeen: Math.max(...candidate.copyVariants.map((variant) => variant.lastSeen)),
    };
  });

  ranked.sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    if (right.lastSeen !== left.lastSeen) return right.lastSeen - left.lastSeen;
    const leftPair = left.candidate.pair.join("+");
    const rightPair = right.candidate.pair.join("+");
    if (leftPair !== rightPair) return leftPair < rightPair ? -1 : 1;
    return left.candidate.act - right.candidate.act;
  });

  return {
    schemaVersion: HARVEST_LIMITS.artifactSchemaVersion,
    kind: "improvisation-review-candidates",
    trust: "untrusted",
    promotion: "manual-only",
    promptNamespace,
    candidateCount: ranked.length,
    candidates: ranked.map(({ candidate }) => candidate),
  };
}

function atomicWrite(path, content) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporary = resolve(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Kun oprydning; den oprindelige skrivefejl returneres nedenfor.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // Filen kan mangle, fx hvis rename allerede lykkedes.
    }
    throw new HarvestError("kunne ikke skrive harvest-output atomisk");
  }
}

function resolveOutputPath(root, output) {
  const path = isAbsolute(output) ? resolve(output) : resolve(root, output);
  const contentRoot = resolve(root, "content");
  const draftRoot = resolve(root, "content/drafts");
  const insideContent =
    path === contentRoot || (!relative(contentRoot, path).startsWith("..") && path !== contentRoot);
  const insideDrafts =
    path === draftRoot || (!relative(draftRoot, path).startsWith("..") && path !== draftRoot);
  if (insideContent && !insideDrafts) {
    throw new HarvestError(
      "harvest-output må ikke pege på kanonisk content; brug content/drafts/ eller en ekstern sti",
    );
  }
  return path;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new HarvestError(`${flag} kræver en værdi`);
  }
  return value;
}

export function parseCliArgs(argv) {
  let url = null;
  let input = null;
  let output = DEFAULT_OUTPUT_PATH;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--url") {
      url = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--input") {
      input = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--output") {
      output = readValue(argv, index, flag);
      index += 1;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else {
      throw new HarvestError(`ukendt flag: ${flag}`);
    }
  }

  if ((url === null) === (input === null)) {
    throw new HarvestError("angiv enten --url eller --input, men ikke begge");
  }
  if (url !== null) {
    validateAdminUrl(url);
    return { mode: "production", url, output, dryRun };
  }
  return { mode: "offline", input, output, dryRun };
}

export async function runHarvest({
  args,
  env = process.env,
  fetchImpl = fetch,
  root = SCRIPT_ROOT,
  log = console.log,
}) {
  const outputPath = resolveOutputPath(root, args.output);
  const canonicalElements = loadCanonicalElements(root);
  let merged;

  if (args.mode === "production") {
    const token = env[TOKEN_ENV];
    merged = await fetchAllPages({
      url: args.url,
      token,
      fetchImpl,
      canonicalElements,
    });
  } else {
    const inputPath = isAbsolute(args.input)
      ? resolve(args.input)
      : resolve(root, args.input);
    const text = readBoundedFile(
      inputPath,
      HARVEST_LIMITS.maxInputBytes,
      "offline-fixture",
    );
    const pages = fixturePages(parseJson(text, "offline-fixture"));
    merged = collectOfflinePages(pages, canonicalElements);
  }

  const artifact = buildHarvestArtifact(merged);
  const content = JSON.stringify(artifact, null, 2) + "\n";
  if (args.dryRun) {
    log(`DRY-RUN: ${artifact.candidateCount} kandidat(er); ingen fil skrevet.`);
    return {
      artifact,
      candidateCount: artifact.candidateCount,
      outputPath,
      written: false,
    };
  }

  atomicWrite(outputPath, content);
  log(`${artifact.candidateCount} kandidat(er) skrevet til ${args.output}.`);
  return {
    artifact,
    candidateCount: artifact.candidateCount,
    outputPath,
    written: true,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Høst fejlede: ${error instanceof HarvestError ? error.message : "ugyldige argumenter"}`,
    );
    process.exitCode = 1;
  }

  if (args) {
    runHarvest({ args }).catch((error) => {
      console.error(
        `Høst fejlede: ${error instanceof HarvestError ? error.message : "uventet intern fejl"}`,
      );
      process.exitCode = 1;
    });
  }
}
