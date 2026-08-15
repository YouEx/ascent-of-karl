import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Vagt for stemmeenheden (docs/design/fortaelleren.md).
 *
 * Fortælleren har ÉN indspillet stemme (Edge TTS `en-GB-RyanNeural`) og en
 * lokal browser-TTS som nødspor. De to lyder hørbart forskelligt, så hver
 * replik der KAN indtales, men ikke ER det, er et sted hvor spilleren skifter
 * fortæller midt i spillet.
 *
 * Fejlen der gjorde denne test nødvendig: `tools/generate_audio.py` samlede
 * sine kilder med `glob("act-*.json")`. Det udelod hele det bagte lag
 * (`pairs-act-1.json`) — 71,2 % af alle møder — så spillets HYPPIGSTE replik
 * var den eneste der aldrig blev indtalt. Ingen test kiggede på afstanden
 * mellem "kan siges højt" og "findes som fil", så manglen var usynlig.
 */

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const AUDIO = join(ROOT, "public/audio");
const NARRATOR = join(ROOT, "content/narrator");

interface NarratorLine {
  id: string;
  variants: string[];
}

function lines(file: string): NarratorLine[] {
  const data = JSON.parse(
    readFileSync(join(NARRATOR, file), "utf8"),
  ) as { lines?: NarratorLine[] };
  if (!Array.isArray(data.lines)) {
    // Kilderne læses fra disken, så en ny fil i content/narrator/ uden
    // `lines` ville ellers kaste `undefined.some` på modulniveau og tage HELE
    // testfilen med sig — en manglende indspilning ville se ud som en
    // importfejl. Sig i stedet, hvilken fil det er, og hvad der mangler.
    throw new Error(
      `content/narrator/${file} har ingen "lines"-liste. Hører filen ikke til fortællerens replikker, så flyt den ud af content/narrator/.`,
    );
  }
  return data.lines;
}

const manifest = JSON.parse(
  readFileSync(join(AUDIO, "manifest.json"), "utf8"),
) as Record<string, number[]>;

/** En variant kan kun indtales på forhånd, hvis den ikke samles i spiltiden. */
const isVoiceable = (text: string) => !text.includes("{");

/**
 * Kilderne udledes af disken, ikke af en håndholdt liste. En kopi af
 * NARRATOR_SOURCES ville genindføre præcis den fejl, testen findes for: en ny
 * `act-3.json` ville være usynlig for BEGGE sider, og manglen igen umulig at
 * se. Her er sandheden "filen indeholder mindst én replik, der kan indtales".
 */
const ALL_SOURCES = readdirSync(NARRATOR)
  .filter((name) => name.endsWith(".json"))
  .sort();

const VOICED_SOURCES = ALL_SOURCES.filter((file) =>
  lines(file).some((line) => line.variants.some(isVoiceable)),
);

describe("fortællerens stemme er den samme hele vejen", () => {
  it("har en indspilning af hver replik der kan indtales", () => {
    const missing: string[] = [];
    for (const file of VOICED_SOURCES) {
      for (const line of lines(file)) {
        line.variants.forEach((text, index) => {
          if (!isVoiceable(text)) return;
          if (!manifest[line.id]?.includes(index)) {
            missing.push(`${file}: ${line.id}.v${index}`);
          }
        });
      }
    }

    expect(
      missing.slice(0, 10),
      `${missing.length} replikker kan indtales, men mangler i manifestet — ` +
        `de siges derfor med browserens stemme. Kør tools/generate_audio.py.`,
    ).toEqual([]);
  });

  it("generate_audio.py kender præcis de kilder, der kan indtales", () => {
    // Uden denne påstand kan de to sider glide fra hinanden i tavshed: en ny
    // aktfil ville blive indtalt af testen ovenfor (som læser disken), men
    // aldrig af generatoren (som læser sin egen tuple) — eller omvendt.
    const source = readFileSync(join(ROOT, "tools/generate_audio.py"), "utf8");
    const tuple = source.match(/NARRATOR_SOURCES\s*=\s*\(([^)]*)\)/)?.[1] ?? "";
    const declared = [...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

    expect(declared).toEqual([...VOICED_SOURCES].sort());
  });

  it("dækker det bagte lag, som spilleren hører oftest", () => {
    // Sammenligningen er PR VARIANT, ikke pr. replik: en replik med fem
    // varianter, hvor kun den første er indspillet, skal falde igennem her.
    // Den tidligere udgave talte kun `manifest[id]?.length` og kunne derfor
    // kun se en replik uden EN eneste indspilning.
    const baked = lines("pairs-act-1.json");
    const voiceable = baked.flatMap((line) =>
      line.variants
        .map((text, index) => ({ text, index, id: line.id }))
        .filter((v) => isVoiceable(v.text)),
    );
    const recorded = voiceable.filter((v) => manifest[v.id]?.includes(v.index));

    expect(voiceable.length).toBeGreaterThan(0);
    expect(recorded.length).toBe(voiceable.length);
  });

  it("lover ikke en fil i manifestet, som ikke ligger på disken", () => {
    const broken = Object.entries(manifest).flatMap(([id, indices]) =>
      indices
        .filter((index) => !existsSync(join(AUDIO, `${id}.v${index}.mp3`)))
        .map((index) => `${id}.v${index}.mp3`),
    );

    expect(broken.slice(0, 10)).toEqual([]);
  });

  it("indtaler aldrig en replik der samles i spiltiden", () => {
    const interpolated: string[] = [];
    for (const file of VOICED_SOURCES) {
      for (const line of lines(file)) {
        line.variants.forEach((text, index) => {
          if (!isVoiceable(text) && manifest[line.id]?.includes(index)) {
            interpolated.push(`${line.id}.v${index}`);
          }
        });
      }
    }

    expect(interpolated).toEqual([]);
  });
});
