import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import baked from "../content/narrator/pairs-act-1.json";
import frequency from "../docs/design/pair-frequency.json";

const read = (path: string) => readFileSync(path, "utf8");

describe("fortæller-dokumentationen følger det målte system", () => {
  it("bruger den aktuelle vægtede dækning i alle styrende dokumenter", () => {
    const keys = new Set((baked as { pairs: string[] }).pairs);
    let total = 0;
    let covered = 0;
    for (const pair of (frequency as unknown as {
      pairs: { key: string; verdict: string; met: number; verdicts?: Record<string, number> }[];
    }).pairs) {
      for (const [verdict, count] of Object.entries(pair.verdicts ?? { [pair.verdict]: pair.met })) {
        total += count;
        if (keys.has(`${pair.key}:${verdict}`)) covered += count;
      }
    }
    const percent = ((covered / total) * 100).toFixed(1);

    for (const path of [
      "PRD.md",
      "docs/design/fortaelleren.md",
      "docs/design/narration-coverage.md",
      "plan/architecture-procedural-narration-1.md",
    ]) {
      const text = read(path);
      expect(text, path).toContain(`${percent} %`);
    }
  });

  it("forklarer offline-trelagsmodellen og det valgfrie live-indskud", () => {
    for (const path of ["PRD.md", "docs/design/fortaelleren.md"]) {
      const text = read(path);
      expect(text, path).toMatch(/offline/i);
      expect(text, path).toMatch(/bagt.*grammatik.*(generisk|nødudgang)/is);
      expect(text, path).toMatch(/live.*tilvalg/is);
    }
    expect(read("README.md")).toContain("Tilføj et element uden at skrive en replik");
  });

  it("beskriver den stemmeport der faktisk kører i validate", () => {
    const voice = read("docs/design/narration-voice.md");
    expect(voice).not.toContain("ejes af en anden agent lige nu");
    expect(voice).toMatch(/validate\.py.*voice_judge\.gate\(\).*koblet/is);
  });

  it("genererer coverage-rapporten uden trailing whitespace", () => {
    const lines = read("docs/design/narration-coverage.md").split("\n");
    expect(lines.filter((line) => /\s+$/.test(line))).toEqual([]);
  });

  it("lukker kun dokumentationsopgaven og holder playtest/deployment-gates åbne", () => {
    const plan = read("plan/architecture-procedural-narration-1.md");
    expect(plan).toMatch(/\| TASK-035 \|.*\| ✅ \| 2026-08-13 \|/);
    for (const task of ["TASK-032", "TASK-033", "TASK-034"]) {
      expect(plan).toMatch(new RegExp(`\\| ${task} \\|.*\\| \\| \\|`));
    }
  });
});
