import { existsSync, readFileSync } from "node:fs";
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

interface NarratorLine {
  id: string;
  variants: string[];
}

function lines(file: string): NarratorLine[] {
  const data = JSON.parse(
    readFileSync(join(ROOT, "content/narrator", file), "utf8"),
  ) as { lines: NarratorLine[] };
  return data.lines;
}

const manifest = JSON.parse(
  readFileSync(join(AUDIO, "manifest.json"), "utf8"),
) as Record<string, number[]>;

/** Kilder der skal være indtalt — spejler NARRATOR_SOURCES i generate_audio.py. */
const VOICED_SOURCES = ["act-1.json", "act-2.json", "pairs-act-1.json"];

/** En variant kan kun indtales på forhånd, hvis den ikke samles i spiltiden. */
const isVoiceable = (text: string) => !text.includes("{");

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

  it("dækker det bagte lag, som spilleren hører oftest", () => {
    const baked = lines("pairs-act-1.json");
    const voiceable = baked.flatMap((line) =>
      line.variants.filter(isVoiceable).map(() => line.id),
    );
    const recorded = voiceable.filter((id) => manifest[id]?.length);

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
