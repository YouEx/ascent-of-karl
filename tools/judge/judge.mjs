#!/usr/bin/env node
/**
 * Vision-laget — dommerens øjne bliver til dommerens ord.
 *
 * Pakker hver region (referenceudsnit, renderudsnit, overlejring, diff-
 * heatmap, de fem metrikker, DOM-boks/computed styles, registryets vægt/
 * tærskel/note og relevante allowedDeviations) og sender det til en vision-
 * model, som skal svare med et findings-dokument formet nøjagtigt som
 * finding.schema.json. Svaret valideres mod BÅDE skemaets semantik og
 * runtime-registret (validate-finding.mjs) — ugyldig JSON eller et fund, der
 * peger på en region/et token, der ikke findes, genforespørges ÉN gang med
 * fejlene vedhæftet. Fejler den anden gang, stopper vi højlydt: en tom
 * findings-liste returneret som "success" ville få sløjfen til at tro, den
 * er færdig, når den reelt bare ikke fik noget brugbart ud af modellen.
 *
 * To veje ind:
 *   --fixture <findings.json>   netværksfri. Læses og valideres ÉN gang
 *                                (en statisk fil giver samme resultat igen —
 *                                en retry ville ikke ændre noget). Bruges af
 *                                tests og af de deterministiske accept/
 *                                afvis-kørsler, TDD-kravet forbyder betalte
 *                                modelkald i verifikation.
 *   rigtig model                kræver VISUAL_JUDGE_API_KEY og
 *                                VISUAL_JUDGE_MODEL i miljøet (valgfri
 *                                VISUAL_JUDGE_ENDPOINT, standard er OpenAIs
 *                                chat/completions). Ingen nøgle hardkodes
 *                                eller committes — mangler de, fejler dette
 *                                modul med det samme og henviser til
 *                                --fixture.
 *
 * Systempromten (SYSTEM_PROMPT) er bevidst på engelsk — modellen svarer
 * angiveligt mere pålideligt på engelske instruktioner — mens denne fil,
 * dens kommentarer og dens tests er danske, som resten af kodebasen.
 *
 * Kør:  node tools/judge/judge.mjs --run .judge/<run> --screen game [--fixture findings.json]
 * Se plan/architecture-visual-judge-1.md REQ-005, REQ-006, TASK-018/019/020.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFindings, loadKnownTokens } from "./validate-finding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = path.join(ROOT, "docs/design/reference/registry.json");
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const readJson = (p, fallback) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;

const toBase64 = (p) => (fs.existsSync(p) ? fs.readFileSync(p).toString("base64") : null);

/**
 * Pakker ÉN regions payload — ren funktion, ingen disk-adgang. Billeder er
 * allerede indlæste base64-strenge (eller null, hvis de mangler — fx et
 * anker der endnu ikke findes i DOM'en). Adskilt fra `loadRegionPayloads`
 * (den urene loader nedenfor) netop så denne kan enhedstestes uden en
 * rigtig capture-kørsel.
 */
export function buildRegionPayload({ region, images = {}, metrics, score, allowedDeviations = [] }) {
  return {
    id: region.id,
    rect: region.rect,
    weight: region.weight,
    threshold: region.threshold,
    note: region.note ?? null,
    allowedDeviations,
    metrics: score
      ? {
          structure: score.structure,
          tone: score.tone,
          ink: score.ink,
          geometry: score.geometry,
          materiality: score.materiality,
          overall: score.overall,
          raw: score.raw ?? {},
        }
      : null,
    dom: {
      missing: !!metrics?.missing,
      box: metrics?.box ?? null,
      styles: metrics?.styles ?? null,
    },
    images: {
      reference: images.ref ?? null,
      render: images.render ?? null,
      blend: images.blend ?? null,
      heat: images.heat ?? null,
    },
  };
}

/**
 * Urent: læser en allerede kørt captures/score/overlejrings-mappe fra disk
 * og bygger alle regionspayloads for én skærm. Kræver en rigtig kørsel
 * (capture.mjs → metrics.py → overlay.py), så den prøves ikke direkte i
 * Vitest — kun end-to-end via de rigtige fixture-drevne verifikationskørsler.
 */
export function loadRegionPayloads(run, screenId, registry) {
  const screen = registry.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`ukendt skærm "${screenId}"`);

  const metricsDoc = readJson(path.join(run, "metrics", `${screenId}.json`), { regions: {} });
  const scoresDoc = readJson(path.join(run, "scores.json"), { screens: {} });
  const screenScore = scoresDoc.screens?.[screenId] ?? { regions: {} };
  const overlayDir = path.join(run, "overlay", screenId);
  const deviationsFor = (id) =>
    (registry.allowedDeviations ?? []).filter((d) => (d.regions ?? []).includes(id));

  return screen.regions.map((region) =>
    buildRegionPayload({
      region,
      images: {
        ref: toBase64(path.join(overlayDir, `${region.id}-ref.png`)),
        render: toBase64(path.join(overlayDir, `${region.id}-render.png`)),
        blend: toBase64(path.join(overlayDir, `${region.id}-blend.png`)),
        heat: toBase64(path.join(overlayDir, `${region.id}-heat.png`)),
      },
      metrics: metricsDoc.regions?.[region.id] ?? null,
      score: screenScore.regions?.[region.id] ?? null,
      allowedDeviations: deviationsFor(region.id),
    }),
  );
}

/**
 * Modellens instruktioner (TASK-020). Anti-prosa er ikke én regel, men fem,
 * der hver lukker en konkret vej til en ubrugelig dom:
 *   - JSON-kun lukker friteksts-svar, markdown-hegn og "her er min analyse".
 *   - mindste-ændring lukker en model, der foreslår fem rettelser når én
 *     ville gøre det, og dermed gør ruteringen og accept-porten sværere at
 *     følge.
 *   - talbelagt evidence lukker selvsikre påstande uden grundlag.
 *   - from/to med enheder lukker et token-forslag, ruteren ikke kan skrive
 *     til CSS uden at gætte en enhed.
 *   - missing-asset frem for CSS-efterligning er selve grunden til at
 *     defekt-ordforrådet er lukket (finding.schema.json's $comment).
 *   - DESIGN.md/allowedDeviations-autoritet forhindrer, at en dokumenteret,
 *     bevidst afvigelse rapporteres som en fejl, sløjfen så bruger
 *     iterationer på at "rette".
 */
export const SYSTEM_PROMPT = `You are a strict visual QA judge comparing a hand-painted reference UI against the live rendered game. For each region you receive: a reference crop, the current render crop, a blended overlay, and a diff heatmap, plus five metrics (structure, tone, ink, geometry, materiality) and their overall score, the DOM bounding box and computed styles, the region's weight/threshold/note from the design registry, any allowedDeviations that apply to it, and keys the accept-gate has already rejected earlier this run.

Respond with JSON only — no prose, no markdown fences, no commentary before or after the JSON object. Any output that is not a single valid JSON object is a failure.

For every defect you report:
- Propose the smallest change that closes the gap. Prefer one precise, minimal fix over several speculative ones.
- "evidence" must cite an actual number drawn from the metrics or computed styles you were given — never a vibe, never "looks small" without a figure.
- A token fix must include "from" and "to" with explicit units (px, %, a full 6-digit hex, etc.) — never a bare number without a unit, never a directional word like "larger" or "darker" in place of a value.
- If the gap is a missing illustration, painted texture, or asset, report a missing-asset fix instead. Never propose a CSS trick (gradient, box-shadow, filter, pseudo-element) to simulate painted art — that is explicitly forbidden and will be rejected.
- DESIGN.md and the provided allowedDeviations are the authority over raw reference pixels wherever they apply. A documented, reasoned deviation is not a defect — do not report it as one.
- Only propose an automatic token fix for a defect that a single CSS custom property can genuinely resolve. Anything structural (layout, markup, new elements) must be a structure fix; a structure fix is never applied automatically, it always waits for a person.`;

/**
 * Bygger den fulde besked til modellen. Ren funktion: `regionPayloads` er
 * allerede færdigbyggede objekter (se ovenfor), ingen disk-adgang her.
 */
export function buildPrompt(screenId, regionPayloads, { rejectedKeys = [] } = {}) {
  return {
    system: SYSTEM_PROMPT,
    user: JSON.stringify({ screen: screenId, regions: regionPayloads, rejectedKeys }),
  };
}

/**
 * Rigtigt modelkald — native `fetch`, ingen ny afhængighed. Kun kaldt når
 * hverken `--fixture` er givet, og kun efter env-gatet ovenfor i
 * `getFindings` har bekræftet, at nøgle og model faktisk er sat.
 */
export async function callVisionModel({ apiKey, model, endpoint, system, user, fetchImpl = fetch }) {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vision-modellen svarede ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("vision-modellen svarede uden tekstindhold");
  }
  return text;
}

function parseModelJson(text) {
  try {
    return { ok: true, doc: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `ugyldig JSON fra modellen: ${e.message}` };
  }
}

/**
 * Henter fund for én skærm. Se filens toptekst for de to veje ind.
 *
 * `callModel` er injicerbar (default: den rigtige `callVisionModel`) —
 * derfor kan retry-logikken testes fuldt ud uden noget netværk: testene
 * injicerer en falsk `callModel`, der returnerer ugyldig/gyldig tekst efter
 * ønske og tæller kald.
 */
export async function getFindings({
  run,
  screen,
  fixture,
  context = {},
  regionPayloads = [],
  rejectedKeys = [],
  callModel = callVisionModel,
  env = process.env,
} = {}) {
  if (fixture) {
    const doc = readJson(path.resolve(fixture), null);
    if (!doc) throw new Error(`--fixture: kunne ikke læse ${fixture}`);
    const errs = validateFindings(doc, context);
    if (errs.length) {
      throw new Error(
        `--fixture ${fixture} er ugyldig mod finding.schema.json/registry:\n` +
          errs.map((e) => "  · " + e).join("\n"),
      );
    }
    return doc;
  }

  const apiKey = env.VISUAL_JUDGE_API_KEY;
  const model = env.VISUAL_JUDGE_MODEL;
  if (!apiKey || !model) {
    throw new Error(
      "VISUAL_JUDGE_API_KEY og VISUAL_JUDGE_MODEL skal være sat i miljøet for at spørge en rigtig vision-model. " +
        "Brug --fixture <findings.json> for en netværksfri/deterministisk kørsel.",
    );
  }
  const endpoint = env.VISUAL_JUDGE_ENDPOINT || DEFAULT_ENDPOINT;
  const { system, user } = buildPrompt(screen, regionPayloads, { rejectedKeys });

  let lastErrors = [];
  let promptUser = user;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await callModel({ apiKey, model, endpoint, system, user: promptUser });
    const parsed = parseModelJson(text);
    if (parsed.ok) {
      const errs = validateFindings(parsed.doc, context);
      if (errs.length === 0) return parsed.doc;
      lastErrors = errs;
    } else {
      lastErrors = [parsed.error];
    }
    // Anden (og sidste) forespørgsel får fejlene med, så modellen faktisk
    // har en chance for at rette sig selv frem for at gentage samme fejl.
    promptUser = `${user}\n\nYOUR PREVIOUS ANSWER WAS INVALID. Fix these errors and answer again, with valid JSON only:\n${lastErrors
      .map((e) => "- " + e)
      .join("\n")}`;
  }
  // ALDRIG et tomt success-resultat her — en løkke, der tror den er færdig
  // fordi dommeren ikke leverede noget brugbart, er værre end en løkke der
  // stopper og siger hvorfor.
  throw new Error(
    `vision-modellen gav ugyldigt output to gange i træk:\n` + lastErrors.map((e) => "  · " + e).join("\n"),
  );
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const run = path.resolve(ROOT, valueOf(args, "--run") ?? ".judge/latest");
  const screen = valueOf(args, "--screen");
  const fixture = valueOf(args, "--fixture");
  if (!screen) {
    console.error("brug: node tools/judge/judge.mjs --run <dir> --screen <id> [--fixture <findings.json>]");
    process.exit(2);
  }

  const registry = readJson(REGISTRY_PATH, { screens: [], allowedDeviations: [] });
  const knownRegions = new Set(registry.screens.flatMap((s) => s.regions.map((r) => r.id)));
  const knownTokens = loadKnownTokens();
  const context = { knownRegions, knownTokens };

  const ledger = readJson(path.join(run, "ledger.json"), { iterations: [], rejected: [] });
  const rejectedKeys = [...new Set((ledger.rejected ?? []).flatMap((r) => [r.key, ...(r.consolidatedFrom ?? [])]))];

  // Kun brug for regionspayloads (og dermed en rigtig capture-kørsel), når
  // der faktisk skal bygges en prompt til en model — en --fixture-kørsel
  // behøver hverken billeder eller en captured run.
  const regionPayloads = fixture ? [] : loadRegionPayloads(run, screen, registry);

  const doc = await getFindings({ run, screen, fixture, context, regionPayloads, rejectedKeys, env: process.env });

  fs.mkdirSync(run, { recursive: true });
  const outPath = path.join(run, `findings-${screen}.json`);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`→ ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
