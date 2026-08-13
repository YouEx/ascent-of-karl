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
const MAIN_TS_PATH = join(ROOT, "src/ui/main.ts");

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
}

function titleRegions(registry: any): Record<string, any> {
  const screen = registry.screens.find((s: any) => s.id === "title");
  const out: Record<string, any> = {};
  for (const r of screen.regions) out[r.id] = r;
  return out;
}

// De evidensbaserede lofter fra .judge/close-01 (commit 739a0ab), afrundet
// ned med samme 0,02-margin som accept-portens maxDrop, så tærsklen stadig
// fanger en EGENTLIG regression uden at markere den kendte, uopnåelige
// afstand som en fejl hver eneste kørsel.
const STRUCTURE_CEILINGS: Record<string, number> = {
  headline: 0.752,
  ribbon: 0.745,
  tagline: 0.735,
  hint: 0.736,
  "tip-card": 0.764,
  chip: 0.754,
};
const CONTENT_CEILING: Record<string, number> = { tools: 0.737 };
const MARGIN = 0.02;

describe("registry.json — dokumenterede afvigelser for titelskærmen (TASK-032)", () => {
  it("har en structure-afvigelse for de malede-glyf-regioner med RISK-003 som autoritet", () => {
    const registry = loadRegistry();
    const dev = (registry.allowedDeviations as any[]).find(
      (d) => d.aspect === "structure" && Array.isArray(d.regions) && d.regions.includes("headline"),
    );
    expect(dev, "forventede en structure-afvigelse, der nævner headline").toBeTruthy();
    expect(new Set(dev.regions)).toEqual(new Set(Object.keys(STRUCTURE_CEILINGS)));
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

  it("sætter hver berørt regions tærskel på eller under dens evidensmålte loft minus 0,02-margin", () => {
    const regions = titleRegions(loadRegistry());
    const ceilings = { ...STRUCTURE_CEILINGS, ...CONTENT_CEILING };
    for (const [id, ceiling] of Object.entries(ceilings)) {
      expect(regions[id], `region ${id} skal findes i registry.json`).toBeTruthy();
      expect(
        regions[id].threshold,
        `${id}: tærsklen skal være <= ${ceiling} - ${MARGIN} (evidensloft minus samme margin som accept-portens maxDrop)`,
      ).toBeLessThanOrEqual(ceiling - MARGIN + 1e-9);
      // Ingen skal sænkes urimeligt langt under loftet — det ville skjule en
      // ægte fremtidig regression, ikke kun den kendte, uopnåelige afstand.
      expect(regions[id].threshold).toBeGreaterThan(ceiling - 0.15);
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
