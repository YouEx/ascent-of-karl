import { describe, expect, it } from "vitest";
import design from "../DESIGN.md?raw";
import styles from "../src/ui/style.css?raw";

/**
 * TASK-030 og TASK-010 (plan/design-visual-target-1.md) gik begge to omgange.
 * Første forsøg på TASK-030 satte `#app` til `min-height: auto` på desktop for
 * at lade rammen krympe om sit indhold — det så rigtigt ud med almindeligt
 * indhold, men på en høj eller bred skærm (1440×1900, 1920×1080) stoppede
 * rammen langt før viewportets bund og lod resten af siden stå bag et
 * svævende kort. Ingen automatisk test render'ede layoutet dengang, så
 * regressionen var usynlig indtil et menneske kiggede på et skærmbillede.
 *
 * Denne fil kan ikke erstatte det blik — vitest kører uden layout-motor
 * (ingen jsdom/happy-dom i dette repo, og selv med dem beregner de ikke ægte
 * flexbox/grid), så en rigtig assertion på beregnet layout er ikke mulig her.
 * Den fanger i stedet de tekstlige symptomer på at nogen genindfører fejlen:
 * samme mønster som tests/design-tokens.test.ts. Genkør den visuelle
 * verifikation med Playwright — se TEST-010 i plan/design-visual-target-1.md
 * §6 for den fulde kommando og listen af breddegrader/rudestørrelser.
 */

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Indholdet af den første balancerede { }-blok efter en markørstreng. */
function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Markør ikke fundet: ${JSON.stringify(marker)}`);
  }
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`Ubalancerede { } efter markør: ${JSON.stringify(marker)}`);
}

const code = stripComments(styles);

describe("#app fylder rammen i stedet for at krympe om sig selv (TASK-030)", () => {
  it("sætter aldrig #app's min-height til auto", () => {
    // Den forkastede løsning — se filens hoved-kommentar.
    expect(code).not.toMatch(/min-height:\s*auto\b/);
  });

  it("lader #grid, ikke #app, optage rammens overskydende højde på desktop", () => {
    const desktop = extractBlock(code, "@media (min-width: 820px)");
    const grid = extractBlock(desktop, "#grid {");
    expect(grid).toMatch(/flex:\s*1\b/);
  });

  it("holder #dock i flow (static) på desktop, uanset hvor #app's højde kommer fra", () => {
    const desktop = extractBlock(code, "@media (min-width: 820px)");
    // #dock nævnes to gange i blokken (order/margin-top og selve positionen);
    // begge skal findes, og "static" skal stå på den anden.
    expect(desktop).toMatch(/#dock\s*\{\s*position:\s*static/);
  });
});

describe("mobil/desktop-skellet er ét tal, ikke to (TASK-010, review 2026-08-12)", () => {
  it("bruger 819/820 som ramme-breakpoint i style.css, ikke det forældede 767/768", () => {
    // #dock's egen fixed→static-grænse ligger på 820px (se samme fil) — det
    // ER layoutets reelle mobil/desktop-skel, og ramme-kollapset skal matche
    // det, ellers står 768-819 med desktop-ramme men mobil-dock samtidig.
    expect(code).toMatch(/@media \(max-width: 819px\)/);
    expect(code).toMatch(/@media \(min-width: 820px\)/);
    expect(code).not.toMatch(/max-width:\s*767px/);
    expect(code).not.toMatch(/min-width:\s*768px/);
  });

  it("DESIGN.md beskriver samme 820px-skel, ikke et forældet 768px", () => {
    const designCode = stripComments(design);
    expect(designCode).not.toMatch(/768px/);
    expect(designCode).toMatch(/820px/);
  });
});
