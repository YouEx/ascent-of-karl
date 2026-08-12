/**
 * Finder de elementer, spillet belønner dig med, og som ikke fører nogen
 * steder hen.
 *
 * Et element, der ikke indgår i én eneste opskrift, er ikke en belønning —
 * det er støj i inventaret. Og støj er dyrt her: spilleren vælger to ting ad
 * gangen, så hver blindgyde gør ALLE senere valg dårligere. Tætheden af
 * brugbare par falder fra 42,9 % i åbningen til 1,3 % til sidst, og en tredjedel
 * af den nedtur er selvforskyldt.
 *
 * Skriver en brief pr. bunke, så flere skribenter kan arbejde samtidig.
 * Kørsel: npx vite-node tools/prepare_recipes.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { loadContent } from "../src/content";
import type { ElementDef } from "../src/core/types";

const content = loadContent();
const OUT = "content/combos/drafts/briefs";
const BATCH_COUNT = 4;

const act1 = content.elements.filter((e) => e.act === 1);
const brugtSomInput = new Map<string, number>();
for (const e of act1) brugtSomInput.set(e.id, 0);
for (const k of content.combos) {
  for (const p of k.pair) {
    if (brugtSomInput.has(p)) brugtSomInput.set(p, brugtSomInput.get(p)! + 1);
  }
}

const blindgyder = act1.filter((e) => brugtSomInput.get(e.id) === 0);

function beskriv(e: ElementDef): string {
  const bits = [e.kind, e.stuff, e.scale].filter(Boolean).join(" · ");
  const traits = e.traits?.length ? ` [${e.traits.join(", ")}]` : "";
  const flavor = e.flavor ? `\n      "${e.flavor}"` : "";
  const mood = e.karlMood ? `\n      Karl: ${e.karlMood}` : "";
  return `${e.name} — ${e.id} (${bits}${traits})${flavor}${mood}`;
}

/** Hvad blev dette element lavet AF? Det er den bedste tråd at spinde videre på. */
const lavetAf = new Map<string, string[]>();
for (const k of content.combos) {
  const nu = lavetAf.get(k.result) ?? [];
  nu.push(k.pair.map((p) => content.elements.find((e) => e.id === p)?.name ?? p).join(" + "));
  lavetAf.set(k.result, nu);
}

/** Elementer der ER i brug — de er de bedste partnere at foreslå. */
const levende = act1
  .filter((e) => (brugtSomInput.get(e.id) ?? 0) >= 2)
  .sort((a, b) => (brugtSomInput.get(b.id) ?? 0) - (brugtSomInput.get(a.id) ?? 0));

mkdirSync(OUT, { recursive: true });
const per = Math.ceil(blindgyder.length / BATCH_COUNT);

for (let i = 0; i < BATCH_COUNT; i++) {
  const slice = blindgyder.slice(i * per, (i + 1) * per);
  if (!slice.length) continue;
  const navn = `deadend-${"abcd"[i]}`;
  const L: string[] = [];
  L.push(`# Opskrifter til blindgyder — bunke ${navn}`);
  L.push("");
  L.push(`${slice.length} elementer. Hvert af dem indgår i dag i NUL opskrifter:`);
  L.push(`spilleren får dem som belønning, og de fører ingen steder hen.`);
  L.push("");
  L.push(`Skriv **mindst 2** nye opskrifter pr. element (gerne 3).`);
  L.push("");
  L.push(`## De 25 mest brugte partnere (foretræk disse — de er allerede i spillet)`);
  L.push("");
  for (const e of levende.slice(0, 25)) {
    L.push(`- \`${e.id}\` ${e.name} (${e.kind}${e.traits?.length ? ", " + e.traits.join("/") : ""})`);
  }
  L.push("");
  L.push(`## Dine blindgyder`);
  L.push("");
  for (const e of slice) {
    L.push(`### \`${e.id}\` — ${e.name}`);
    L.push(`- ${beskriv(e)}`);
    const af = lavetAf.get(e.id);
    if (af?.length) L.push(`- Karl lavede den af: ${af.join(", ")}`);
    L.push(`- dybde: ${(e as unknown as { depth?: number }).depth ?? "?"}`);
    L.push("");
  }
  writeFileSync(`${OUT}/${navn}.md`, L.join("\n"));
  console.log(`  ${navn}.md: ${slice.length} blindgyder`);
}

console.log(`\n✅ ${blindgyder.length} blindgyder fordelt på ${BATCH_COUNT} bunker`);
console.log(`   (${act1.length} elementer i akt 1, ${content.combos.length} opskrifter i dag)`);
