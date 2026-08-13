// Pinner registry.json's dokumenterede afvigelser mod den evidens, de blev
// sat på baggrund af, og forhindrer en stille tærskelændring uden ny evidens
// eller en accessibility-regression, der gemmer sig bag den.
//
// Baggrund: TASK-032 kørte den rigtige dommer på titelskærmen (frisk optagelse
// .judge/close-01, commit 739a0ab, se plan/architecture-visual-judge-1.md).
// Seks regioner (headline, ribbon, tagline, hint, tip-card, chip) delte samme
// rodårsag: referencens glyffer er håndmalet/ridset sten, mens skærmen sætter
// rigtig, semantisk, tilgængelig tekst i --font-display (Fraunces) — en
// vektorskrift har pr. definition skarpe, ensartede konturer, som en malet
// bogstavform aldrig havde. Det er præcis RISK-003's kategori ("nogle områder
// er fysisk uopnåelige i HTML"), samme begrundelse som gav `scene` sin
// sænkede tærskel. Løsningen er IKKE et token (der er intet CSS-trick, der
// får en SSIM-måling af skarpe kanter til at ligne penselstrøg — det ville
// være præcis den CSS-efterligning af malet kunst, som REQ-005/apply.mjs
// eksplicit forbyder), men en dokumenteret, individuel regionstærskel.
//
// `tools`-regionen er en anden sag: referencen viser et tandhjul (indstillinger)
// på den anden knap, men produktet har ingen indstillingsskærm — kun lyd
// til/fra. Ikonet er bevidst lyd, ikke indstillinger; det er en indholds-
// afvigelse (samme klasse som den eksisterende "Drag"/"Choose"-afvigelse for
// slots+hint), ikke en visuel defekt.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REGISTRY_PATH = join(ROOT, "docs/design/reference/registry.json");
const BASELINE_PATH = join(ROOT, "tests/visual-baseline.json");
const MAIN_TS_PATH = join(ROOT, "src/ui/main.ts");
const SCORE_ASPECTS = ["structure", "tone", "ink", "geometry", "materiality"] as const;

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
}

function titleRegions(registry: any): Record<string, any> {
  const screen = registry.screens.find((s: any) => s.id === "title");
  const out: Record<string, any> = {};
  for (const r of screen.regions) out[r.id] = r;
  return out;
}

// De evidensbaserede lofter fra .judge/close-01 (commit 739a0ab), normaliseret
// til baselinefilens fire decimaler. Registry-tærsklen må ligge fra loft
// minus 0,02 og OP til loftet — aldrig lavere, for så kan den skjule et fald
// større end den samme maxDrop, som accept-porten og regressionstesten bruger.
const STRUCTURE_REGION_IDS = ["headline", "ribbon", "tagline", "hint", "tip-card", "chip"];
const CONTENT_REGION_IDS = ["tools"];
const MARGIN = 0.02;

describe("registry.json — dokumenterede afvigelser for titelskærmen (TASK-032)", () => {
  it("har en structure-afvigelse for de malede-glyf-regioner med RISK-003 som autoritet", () => {
    const registry = loadRegistry();
    const dev = (registry.allowedDeviations as any[]).find(
      (d) => d.aspect === "structure" && Array.isArray(d.regions) && d.regions.includes("headline"),
    );
    expect(dev, "forventede en structure-afvigelse, der nævner headline").toBeTruthy();
    expect(new Set(dev.regions)).toEqual(new Set(STRUCTURE_REGION_IDS));
    expect(dev.reason).toMatch(/malet|carved|painted/i);
    expect(dev.authority).toMatch(/RISK-003/);
  });

  it("har en content-afvigelse for tools (tandhjul i referencen, lyd i produktet)", () => {
    const registry = loadRegistry();
    const dev = (registry.allowedDeviations as any[]).find(
      (d) => d.aspect === "content" && Array.isArray(d.regions) && d.regions.includes("tools"),
    );
    expect(dev, "forventede en content-afvigelse for tools").toBeTruthy();
    expect(dev.reason).toMatch(/lyd|sound/i);
  });

  it("sætter hver berørt regions tærskel mellem evidensloftet minus 0,02 og selve loftet", () => {
    const regions = titleRegions(loadRegistry());
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const id of [...STRUCTURE_REGION_IDS, ...CONTENT_REGION_IDS]) {
      const ceiling = baseline.screens.title.regions[id].overall;
      expect(regions[id], `region ${id} skal findes i registry.json`).toBeTruthy();
      expect(
        regions[id].threshold,
        `${id}: tærsklen må ikke ligge under ${ceiling} - ${MARGIN}`,
      ).toBeGreaterThanOrEqual(ceiling - MARGIN - 1e-9);
      expect(regions[id].threshold, `${id}: tærsklen må ikke overstige det målte loft`).toBeLessThanOrEqual(ceiling);
    }
  });

  it("pinner alle fem mål for hver region med en allowedDeviation, så andre aspekter ikke kan falde bag et aggregate", () => {
    const registry = loadRegistry();
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    expect(baseline.aspects).toEqual(["overall", ...SCORE_ASPECTS]);
    for (const deviation of registry.allowedDeviations as any[]) {
      expect(
        SCORE_ASPECTS.includes(deviation.aspect) || deviation.aspect === "content",
        `ukendt allowedDeviations.aspect: ${deviation.aspect}`,
      ).toBe(true);
      for (const regionId of deviation.regions) {
        const screen = registry.screens.find((candidate: any) =>
          candidate.regions.some((region: any) => region.id === regionId),
        );
        const regionBaseline = baseline.screens[screen.id].regions[regionId];
        expect(regionBaseline, `${screen.id}/${regionId} mangler baseline`).toBeTruthy();
        expect(typeof regionBaseline.overall, `${screen.id}/${regionId}.overall`).toBe("number");
        for (const aspect of SCORE_ASPECTS) {
          expect(typeof regionBaseline[aspect], `${screen.id}/${regionId}.${aspect}`).toBe("number");
        }
      }
    }
  });

  it("rører ikke de øvrige regioners tærskler (scene, divider, actions passerer allerede)", () => {
    const regions = titleRegions(loadRegistry());
    expect(regions.scene.threshold).toBe(0.6);
    expect(regions.divider.threshold).toBe(0.8);
    expect(regions.actions.threshold).toBe(0.82);
  });

  it("de strukturelt afveget regioner er stadig ægte, tilgængelig DOM-tekst — ikke erstattet af et billede", () => {
    // Den strukturelle afvigelse må aldrig blive en undskyldning for at rette
    // med et <img>, der ville koste den skærmlæser-verificerede semantik fra
    // design-title-screen-1.md TASK-011/021. Et fladt strengeftersyn er nok:
    // hvis nogen erstatter <h1 class="title-mark">-teksten med et billede,
    // forsvinder disse markører fra kildeteksten.
    const src = readFileSync(MAIN_TS_PATH, "utf8");
    expect(src).toMatch(/<h1 class="title-mark[^"]*">/);
    expect(src).toMatch(/class="title-tagline/);
    expect(src).toMatch(/class="title-hint/);
    expect(src).toMatch(/class="title-chip"/);
    expect(src).not.toMatch(/title-mark[\s\S]{0,200}<img/);
  });
});
