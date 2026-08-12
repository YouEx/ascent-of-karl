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
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content";
import type { ElementDef } from "../src/core/types";

const content = loadContent();
const act1 = content.narrator.find((n) => n.act === 1)!;
const freq = JSON.parse(readFileSync("docs/design/pair-frequency.json", "utf8"));


const TOTAL = 250;
/** Møde-tal der udløser fire varianter i stedet for to — de hyppigste høres oftest. */
const TOP_MET = 700;
const OUT = "content/narrator/drafts/briefs";

/** Par der allerede er bagt. Nøglen i den samlede fil er "par:dom". */
const bakedKeys = new Set<string>();
try {
  const baked = JSON.parse(
    readFileSync("content/narrator/pairs-act-1.json", "utf8"),
  );
  for (const k of Object.keys(baked.pairs ?? {})) bakedKeys.add(k.split(":")[0]!);
} catch {
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
