// Optageren bag tests/improvise-feature-off-layout.json. Den forrige baseline
// var håndlavet, og den nåede at fryse en fejl: 83 px vandret overløb på mobil
// blev registreret som "forventet", så testen ville have dumpet den korrekte
// build og bestået den ødelagte. De to egenskaber der forhindrer gentagelse
// testes her — hurtigt, uden browser, så de kører i npm test's hurtige spor.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoHorizontalOverflow,
  serialiseBaseline,
} from "../tools/record_layout_baseline.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "tests/improvise-feature-off-layout.json");

describe("optageren af layout-baseline", () => {
  it("nægter at fryse et vandret overløb", () => {
    expect(() => assertNoHorizontalOverflow("mobile", 390, 473)).toThrow(
      /vandret overløb/,
    );
  });

  it("accepterer et layout uden overløb", () => {
    expect(() => assertNoHorizontalOverflow("mobile", 390, 390)).not.toThrow();
  });

  it("skriver filens format uændret tilbage, så en genoptagelse giver en læsbar diff", () => {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    expect(serialiseBaseline(JSON.parse(raw))).toBe(raw);
  });

  it("har ingen baseline der modsiger invarianten", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const [name, viewport] of Object.entries(baseline.viewports) as [
      string,
      { clientWidth: number; scrollWidth: number },
    ][]) {
      expect(
        viewport.scrollWidth,
        `${name}: baseline registrerer vandret overløb`,
      ).toBeLessThanOrEqual(viewport.clientWidth);
    }
  });

  it("peger kun på selektorer der findes i spillets markup", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const markup = readFileSync(join(ROOT, "src/ui/main.ts"), "utf8");
    for (const selector of baseline.selectors as string[]) {
      if (!selector.startsWith("#")) continue;
      expect(
        markup.includes(`id="${selector.slice(1)}"`),
        `${selector} findes ikke i src/ui/main.ts`,
      ).toBe(true);
    }
  });
});
