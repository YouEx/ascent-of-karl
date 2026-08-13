/**
 * Bygger skrive-opgaverne til de bagte par-replikker.
 *
 * En bagt replik er kun bedre end grammatikken hvis den ved noget grammatikken
 * ikke kan vide: at det ER en sten og et stykke vand, hvad de hver især er for
 * noget, og hvad Karl regnede med der ville ske. Så skribenten skal have det
 * hele med — begge navne, begge flavor-tekster, taksonomien, dommen og tre
 * ægte eksempler i samme dom at spille op imod.
 *
 * Skriver én brief pr. batch til content/narrator/drafts/briefs/.
 * Kørsel: npx vite-node tools/prepare_pairs.ts
 *
 * TASK-008 tilføjer en ANDEN, valgfri tilstand ved siden af — "høstning":
 * fletter det simulerede møde-tal (denne fils oprindelige datakilde) med
 * ÆGTE, høstet trafik fra produktionen (`worker/src/stats.ts` via
 * `tools/live_pair_export.mjs`s lokale eksport-artefakt), og foreslår
 * NÆSTE bage-batch derfra — uden nogensinde selv at skrive et bagt par.
 * Slås til med `--live=<sti>`; UDEN dette flag er denne fils opførsel
 * PRÆCIS som før (uændret kode-sti, samme output). Se
 * `tools/prepare_pairs_lib.mjs` for de rene, testede funktioner bag
 * høste-tilstanden, og `tests/prepare-pairs-lib.test.ts` for deres tests.
 *
 * Høste-tilstandens flag:
 *   --live=<sti>   slår høste-tilstanden til (sti til den lokale eksport
 *                  fra `tools/live_pair_export.mjs`, fx
 *                  docs/design/live-pair-stats.json).
 *   --limit=<n>    højst så mange forslag (standard: samme TOTAL som legacy).
 *   --write        skriv forslaget til disk (`--out`, standard vist under).
 *                  UDEN --write: kun en JSON-preview på stdout, INGEN
 *                  filer røres — "ikke-destruktiv" er standard, ikke en
 *                  ekstra afkrydsning.
 *   --out=<sti>    hvor forslaget skrives med --write (standard:
 *                  content/narrator/drafts/briefs/harvest — en EGEN
 *                  undermappe, adskilt fra de eksisterende, evt. allerede
 *                  godkendte runde2-*.md/_jobs.json, så høstningen ALDRIG
 *                  overskriver et menneske-gennemgået batch).
 *
 * Høstningens forslag går IKKE uden om resten af bage-kæden: det er et
 * RÅT forslag til næste `_jobs.json`-agtige batch, som stadig skal
 * igennem samme menneske-gennemgang/`check_pairs.py`/`assemble_pairs.py`
 * som alt andet bagt indhold, FØR det bliver til en rigtig replik.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content";
import type { ElementDef } from "../src/core/types";
// @ts-expect-error — hjælpefilen er ren ESM uden typedeklaration.
import { bakedLookupKeys, bakedPairKeys } from "./pair_lookup.mjs";
// @ts-expect-error — hjælpefilen er ren ESM uden typedeklaration.
import {
  LIVE_TRAFFIC_WEIGHT,
  flattenVerdictCounts,
  liveExportEntries,
  mergeLiveTraffic,
  parseCliArgs,
  rankUncuredCandidates,
} from "./prepare_pairs_lib.mjs";

const content = loadContent();
const act1 = content.narrator.find((n) => n.act === 1)!;
const freq = JSON.parse(readFileSync("docs/design/pair-frequency.json", "utf8"));

const TOTAL = 250;
/** Møde-tal der udløser fire varianter i stedet for to — de hyppigste høres oftest. */
const TOP_MET = 700;
const OUT = "content/narrator/drafts/briefs";
/** Standard-mappe for høstningens IKKE-destruktive forslag (TASK-008) — se fil-kommentaren. */
const HARVEST_OUT = `${OUT}/harvest`;

/** Den samlede, bagte fil — læses ÉN gang, bruges af BEGGE tilstande (pair-only i legacy, par+dom i høstning). */
let baked: unknown = { pairs: [] };
try {
  baked = JSON.parse(readFileSync("content/narrator/pairs-act-1.json", "utf8"));
} catch (error) {
  const missing =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
  if (!missing) throw error;
  // Første runde: der findes endnu ingen samlet fil, og så skal alt skrives.
}

const el = (id: string): ElementDef => content.elements.find((x) => x.id === id)!;
const lineById = new Map(act1.lines.map((l) => [l.id, l]));

/** Tre ægte grammatikreplikker i samme dom — målestokken skribenten skal slå. */
function examples(verdict: string): string[] {
  const ids = act1.grammar?.[verdict] ?? [];
  const out: string[] = [];
  for (const id of ids.slice(0, 3)) {
    const v = lineById.get(id)?.variants?.[0];
    if (v) out.push(v);
  }
  return out;
}

function describe(e: ElementDef): string {
  const bits = [e.kind, e.stuff, e.scale].filter(Boolean).join(" · ");
  const traits = e.traits?.length ? ` [${e.traits.join(", ")}]` : "";
  const flavor = e.flavor ? `\n      "${e.flavor}"` : "";
  const mood = e.karlMood ? `\n      Karl: ${e.karlMood}` : "";
  return `${e.name} (${bits}${traits})${flavor}${mood}`;
}

const cliArgs = parseCliArgs(process.argv.slice(2));

if (!cliArgs.live) {
  // ── Legacy: udelukkende simuleret møde-tal, pr.-PAR (uændret adfærd). ──
  runLegacySimulationOnly();
} else {
  // ── TASK-008: flet simuleret + høstet ægte trafik, ranger pr.-PAR+DOM. ──
  runHarvestMerge(cliArgs);
}

function runLegacySimulationOnly(): void {
  /** Par der allerede er bagt. Nøglen i den samlede fil er "par:dom". */
  const bakedKeys = new Set<string>(bakedPairKeys(baked));

  interface Job {
    key: string;
    a: string;
    b: string;
    verdict: string;
    variants: number;
    rank: number;
    met: number;
    share: number;
  }

  const jobs: Job[] = freq.pairs
    .slice(0, TOTAL)
    // Par der allerede har fået ord, skal ikke skrives igen. Runde to henter
    // derfor kun de par den nye åbning har skubbet op i toppen.
    .filter((p: any) => !bakedKeys.has(p.key))
    .map((p: any, i: number) => ({
      key: p.key,
      a: p.a,
      b: p.b,
      verdict: p.verdict,
      variants: p.met >= TOP_MET ? 4 : 2,
      rank: i + 1,
      met: p.met,
      share: p.verdictShare,
    }));

  mkdirSync(OUT, { recursive: true });

  /** Fire lige store bunker, så fire skribenter kan arbejde samtidig. */
  const BATCH_COUNT = 4;
  const per = Math.ceil(jobs.length / BATCH_COUNT);
  const BATCHES = Array.from({ length: BATCH_COUNT }, (_, i) => ({
    name: `runde2-${"abcd"[i]}`,
    from: i * per,
    to: Math.min((i + 1) * per, jobs.length),
  })).filter((b) => b.from < b.to);

  for (const b of BATCHES) {
    const slice = jobs.slice(b.from, b.to);
    const lines: string[] = [];
    lines.push(`# Bagte par-replikker — batch ${b.name}`);
    lines.push("");
    lines.push(`${slice.length} par, ${slice.reduce((s, j) => s + j.variants, 0)} replikker i alt.`);
    lines.push("");
    for (const j of slice) {
      const A = el(j.a);
      const B = el(j.b);
      lines.push(`## ${j.key}  (nr. ${j.rank}, mødt ${j.met} gange)`);
      lines.push(`- dom: **${j.verdict}** (${j.share} % af møderne — skriv KUN til denne)`);
      lines.push(`- varianter: **${j.variants}**`);
      lines.push(`- A: ${describe(A)}`);
      lines.push(`- B: ${describe(B)}`);
      const ex = examples(j.verdict);
      if (ex.length) {
        lines.push(`- grammatikken siger i dag (det er niveauet du skal slå):`);
        for (const e of ex) lines.push(`    · ${e}`);
      }
      lines.push("");
    }
    writeFileSync(`${OUT}/${b.name}.md`, lines.join("\n"));
    console.log(`  ${b.name}.md: ${slice.length} par, ${slice.reduce((s, j) => s + j.variants, 0)} replikker`);
  }

  writeFileSync(
    `${OUT}/_jobs.json`,
    JSON.stringify({ topMet: TOP_MET, total: TOTAL, jobs }, null, 2) + "\n",
  );
  console.log(`\n✅ ${jobs.reduce((s, j) => s + j.variants, 0)} replikker fordelt på ${BATCHES.length} batches`);
}

interface HarvestArgs {
  live: string;
  limit: number | null;
  write: boolean;
  out: string | null;
}

function runHarvestMerge(args: HarvestArgs): void {
  const liveDoc = JSON.parse(readFileSync(args.live, "utf8"));
  const liveEntries = liveExportEntries(liveDoc);

  // "Cured" her betyder par+DOM, ikke bare par — se `prepare_pairs_lib.mjs`s
  // fil-kommentar for hvorfor det er den rigtige granularitet for høstning.
  const curedLookupKeys = bakedLookupKeys(baked);

  const flat = flattenVerdictCounts(freq);
  const merged = mergeLiveTraffic(flat, liveEntries);
  const consideredCount = merged.filter((m: { key: string }) => !curedLookupKeys.has(m.key)).length;
  const limit = args.limit ?? TOTAL;
  const ranked = rankUncuredCandidates(merged, curedLookupKeys, { limit });

  const candidates = ranked.map((r: any) => {
    const A = el(r.a);
    const B = el(r.b);
    return {
      key: r.key,
      a: r.a,
      b: r.b,
      aName: A?.name ?? r.a,
      bName: B?.name ?? r.b,
      verdict: r.verdict,
      simulatedMet: r.simulatedMet,
      liveCount: r.liveCount,
      combinedScore: r.combinedScore,
      rank: r.rank,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    liveSource: args.live,
    liveTrafficWeight: LIVE_TRAFFIC_WEIGHT,
    consideredCount,
    limit,
    candidates,
  };

  if (!args.write) {
    // Ikke-destruktiv standard: KUN en preview på stdout, ingen filer røres.
    console.log(JSON.stringify(payload, null, 2));
    console.log(
      `\n(preview) ${candidates.length} af ${consideredCount} ikke-bagte par+dom-kandidater — kør med --write for at gemme forslaget.`,
    );
    return;
  }

  const outDir = args.out ?? HARVEST_OUT;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/_jobs-harvest.json`, JSON.stringify(payload, null, 2) + "\n");

  const lines: string[] = [];
  lines.push(`# Foreslået næste bage-batch — høstet fra ægte trafik (TASK-008)`);
  lines.push("");
  lines.push(`Kilde: ${args.live}`);
  lines.push(`${candidates.length} af ${consideredCount} ikke-bagte par+dom-kandidater (loft ${limit}).`);
  lines.push("");
  lines.push(
    "Dette er et RÅT forslag, ikke en godkendt batch — det skal stadig igennem samme " +
      "menneske-gennemgang/check_pairs.py/assemble_pairs.py som alt andet bagt indhold.",
  );
  lines.push("");
  for (const c of candidates) {
    lines.push(`## ${c.key}  (nr. ${c.rank}, simuleret ${c.simulatedMet}, ægte trafik ${c.liveCount})`);
    lines.push(`- dom: **${c.verdict}**`);
    lines.push(`- samlet score: ${c.combinedScore}`);
    lines.push(`- A: ${describe(el(c.a))}`);
    lines.push(`- B: ${describe(el(c.b))}`);
    lines.push("");
  }
  writeFileSync(`${outDir}/harvest-preview.md`, lines.join("\n"));

  console.log(`✅ ${candidates.length} høstede kandidater skrevet til ${outDir}/_jobs-harvest.json og harvest-preview.md`);
}
