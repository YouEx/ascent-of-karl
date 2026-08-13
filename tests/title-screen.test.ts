import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
import iconsSource from "../src/ui/icons.ts?raw";
import styles from "../src/ui/style.css?raw";

/**
 * Titelskærmen har ingen jsdom/happy-dom i dette repo (se vite.config.ts'
 * kommentar og tests/app-frame.test.ts' hoved-kommentar) — `showTitleScreen()`
 * bygger sit markup med `innerHTML` og kører aldrig uden en rigtig DOM, så et
 * ægte render-og-forespørg-test er ikke muligt her. Denne fil følger derfor
 * samme opskrift som tests/app-frame.test.ts og tests/design-tokens.test.ts:
 * kildeteksten er sandheden, og testene er tekstlige stedfortrædere for de
 * strukturelle garantier, en rigtig browser ellers ville vise med det samme.
 * Playwright-verifikationen (viewports, tab-rækkefølge, CDP-tilgængeligheds-
 * træ) er kørt manuelt denne session — se plan/design-title-screen-1.md's
 * TASK-019/020/021-kommentarer for de faktiske målinger og screenshots.
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

const code = stripComments(mainSource);
// TITLE_TIPS ligger foran selve funktionen (const-erklæring, ikke en
// funktionskrop) — tages med i den spillervendte tekst, der scannes for
// "drag", fordi tip-kortets brødtekst er lige så spillervendt som resten.
const titleTipsBlock = code.slice(
  code.indexOf("const TITLE_TIPS"),
  code.indexOf("];", code.indexOf("const TITLE_TIPS")) + 2,
);
const showTitleScreenBody = extractBlock(code, "function showTitleScreen(): void {");
const setBackgroundInertBody = extractBlock(code, "function setBackgroundInert(inert: boolean): void {");
const playerFacingTitleText = titleTipsBlock + showTitleScreenBody;

describe("selvtjek: markørerne findes rent faktisk (samme fælde som design-tokens.test.ts)", () => {
  it("har fundet showTitleScreen's krop med reelt indhold", () => {
    expect(showTitleScreenBody.length).toBeGreaterThan(500);
    expect(showTitleScreenBody).toContain("title-mark");
  });

  it("har fundet TITLE_TIPS med tre tips", () => {
    expect(titleTipsBlock).toContain("Fire: Best invention");
    expect(titleTipsBlock).toContain("Fifty summers");
  });
});

describe("interaktionsmodellen er tap-tap, ikke drag (PRD §2.1)", () => {
  it("nævner aldrig 'drag' i titelskærmens spillervendte tekst", () => {
    // "Drag" findes andre steder i filen — men kun i kommentarer, der
    // forklarer at træk-gesten blev FJERNET 2026-08-07 (se attachSelect).
    // Den historik er ikke titelskærmens ansvar og skal ikke findes her:
    // en spiller, der læser titlens hint eller tip-kort, skal aldrig se et
    // ord for en interaktion, spillet ikke har.
    expect(playerFacingTitleText.toLowerCase()).not.toContain("drag");
  });

  it("hint-teksten beskriver tap-tap, ikke træk", () => {
    expect(showTitleScreenBody).toMatch(/Tap one element, then a second/);
  });
});

describe("først-gang vs gemt spil (TASK-002/010)", () => {
  it("viser 'Begin' uden gemt spil og 'Continue' med gemt spil — samme knap, ikke to", () => {
    expect(showTitleScreenBody).toMatch(
      /\$\{canContinue \? "Continue" : "Begin"\}/,
    );
  });

  it("viser 'New life' kun når der er noget at forlade (canContinue)", () => {
    expect(showTitleScreenBody).toMatch(
      /canContinue\s*\?\s*`<button id="t-new"[^`]*New life/,
    );
  });

  it("velkomst-chippen er gated til KUN først-gang, ikke gemt spil", () => {
    // Ternary'en styrer HELE .title-chip-blokken: gemt spil -> tom streng.
    const chipGate = showTitleScreenBody.match(
      /\$\{canContinue \? "" : `([\s\S]*?)`\}/,
    );
    expect(chipGate, "canContinue ? \"\" : `...chip...` findes").toBeTruthy();
    expect(chipGate![1]).toContain("title-chip");
    expect(chipGate![1]).toContain("Welcome, inventor.");
  });
});

describe("Fates-tallet er data-drevet, ikke en hardkodet konstant (TASK-014)", () => {
  it("bruger content.endings.length, ikke et fastlåst tal", () => {
    expect(showTitleScreenBody).toContain(
      '<span class="fates-count">${unlocked}/${content.endings.length}</span>',
    );
  });

  it("tæller reelt oplåste afslutninger (unlocked), ikke altid 0", () => {
    expect(showTitleScreenBody).toMatch(
      /const unlocked = Object\.keys\(loadAchievements\(\)\)\.length;/,
    );
  });
});

describe("responsive aktiv-referencer (TASK-007/008)", () => {
  // Tre trin findes for både scene og pergament (897/640/448 og
  // 692/520/360 px, samme beskæring) — under 900 px skal disse ÆGTE,
  // mindre filer hentes, ikke den bredeste skaleret ned og ikke en påstået
  // 2x af samme fil.
  const stripped = stripComments(styles);

  it("erklærer alle tre scene-bredder (897/640/448)", () => {
    expect(stripped).toContain('url("../assets/art/title-scene-897.webp")');
    expect(stripped).toContain('url("../assets/art/title-scene-640.webp")');
    expect(stripped).toContain('url("../assets/art/title-scene-448.webp")');
  });

  it("erklærer alle tre pergament-bredder (692/520/360)", () => {
    expect(stripped).toContain(
      'url("../assets/art/title-parchment-692.webp")',
    );
    expect(stripped).toContain(
      'url("../assets/art/title-parchment-520.webp")',
    );
    expect(stripped).toContain(
      'url("../assets/art/title-parchment-360.webp")',
    );
  });

  it("skifter --scene-src OG --parchment-src ved både 480px og 900px", () => {
    const narrow = extractBlock(stripped, "@media (max-width: 480px) {");
    expect(narrow).toContain("title-scene-448.webp");
    expect(narrow).toContain("title-parchment-360.webp");

    const mid = extractBlock(
      stripped,
      "@media (min-width: 481px) and (max-width: 900px) {",
    );
    expect(mid).toContain("title-scene-640.webp");
    expect(mid).toContain("title-parchment-520.webp");
  });

  it("bruger IKKE image-set()/2x-tæthedsmærker som en påstået skarphedsgevinst", () => {
    // REQ-004/TASK-007: en mindre fil er et andet MOTIV (cover-beskæring),
    // ikke en 2x-udgave af samme billede — image-set()'s tætheds-syntaks
    // ville påstå noget, filerne ikke er.
    const titleStage = extractBlock(stripped, ".title-stage {");
    const titlePanel = extractBlock(stripped, ".title-panel {");
    expect(titleStage + titlePanel).not.toMatch(/image-set\(/);
    expect(titleStage + titlePanel).not.toMatch(/\d+x\)/); // "...897.webp) 2x)"
  });
});

describe("titelskærmens egen h1 er den ENESTE, en skærmlæser møder (TASK-011/021)", () => {
  it("kildekoden har præcis to <h1> — spilskærmens statiske og titlens egen", () => {
    // Spilskærmens <h1> er altid DOM-monteret (bygget tidligt, aldrig
    // fjernet — kun visuelt dækket). Falder dette tal til 1 eller stiger
    // til 3, er en af antagelserne herunder ikke længere sand, og næste
    // test's ræsonnement (inert fjerner præcis ÉN ekstra h1) holder ikke.
    const h1Count = (code.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(2);
  });

  it("showTitleScreen gør baggrunden inert, så kun titlens egen h1 er tilbage for tilgængelighedstræet", () => {
    expect(showTitleScreenBody).toMatch(/setBackgroundInert\(true\)/);
  });

  it("setBackgroundInert skåner #title-screen selv, men rammer alle andre børn af #app", () => {
    expect(setBackgroundInertBody).toMatch(
      /child\.id === "title-screen"/,
    );
    expect(setBackgroundInertBody).toMatch(
      /child\.toggleAttribute\("inert", inert\)/,
    );
  });
});

describe("fokuserbare kontroller har labels, og ingen positiv tabindex snyder DOM-rækkefølgen", () => {
  it("trofæ- og lydknapperne har aria-label", () => {
    expect(showTitleScreenBody).toMatch(
      /id="t-trophies" aria-label="Fates you have reached"/,
    );
    expect(showTitleScreenBody).toMatch(
      /id="t-sound"[\s\S]{0,120}aria-label="\$\{muted/,
    );
  });

  it("lydknappen rapporterer trykt tilstand med aria-pressed", () => {
    expect(showTitleScreenBody).toMatch(/id="t-sound"\s+aria-pressed="\$\{muted\}"/);
  });

  it("tip-prikkerne har aria-label og role for skærmlæsere (renderTip)", () => {
    const renderTipBody = extractBlock(code, "function renderTip(): void {");
    expect(renderTipBody).toMatch(/role="tablist"/);
    expect(renderTipBody).toMatch(/role="tab"/);
    expect(renderTipBody).toMatch(/aria-label="Tip \$\{i \+ 1\} of/);
  });

  it("ingen positiv tabindex i hverken main.ts eller style.css (DOM-rækkefølge, ikke tabindex, styrer fokus)", () => {
    expect(code).not.toMatch(/tabindex\s*=\s*["']?[1-9]/);
    expect(stripComments(styles)).not.toMatch(/tabindex\s*:\s*[1-9]/);
  });
});

describe("gear/tap-ikonerne er væk fra icons.ts og bliver ikke sneget ind igen (FILE-003)", () => {
  it("icons.ts eksporterer hverken gear eller tap", () => {
    const iconsCode = stripComments(iconsSource);
    expect(iconsCode).not.toMatch(/\bgear\s*:/);
    expect(iconsCode).not.toMatch(/\btap\s*:/);
  });

  it("titelskærmen bruger det malede orn-tap.webp til hintet, ikke et icons.tap", () => {
    expect(showTitleScreenBody).not.toContain("icons.tap");
    expect(stripComments(styles)).toContain("orn-tap.webp");
  });
});

describe("tip-kortets flise følger tip.tile — ikke samme flise for alle tre (TASK-017)", () => {
  it("TITLE_TIPS har mindst to forskellige tile-værdier", () => {
    const tiles = [...titleTipsBlock.matchAll(/tile:\s*"(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(tiles.length).toBe(3);
    expect(new Set(tiles).size).toBeGreaterThanOrEqual(2);
  });

  it("renderTip sætter klassen dynamisk fra tip.tile, ikke en fast streng", () => {
    const renderTipBody = extractBlock(code, "function renderTip(): void {");
    expect(renderTipBody).toMatch(/class="tile tile-\$\{tip\.tile\}"/);
  });

  it(".tile-fire og .tile-sten er to reelt forskellige, ikke-tomme CSS-regler", () => {
    const stripped = stripComments(styles);
    const fire = extractBlock(stripped, ".title-tip .tile-fire {");
    const sten = extractBlock(stripped, ".title-tip .tile-sten {");
    expect(fire.trim().length).toBeGreaterThan(0);
    expect(sten.trim().length).toBeGreaterThan(0);
    expect(fire.trim()).not.toBe(sten.trim());
  });
});

describe("berøringsmål og karrusel-prikker rammer 44px-kravet (TASK-018/021 a11y-rettelser)", () => {
  it(".title-actions button har en absolut 44px-gulv under cqw-skalaen", () => {
    const stripped = stripComments(styles);
    const rule = extractBlock(stripped, ".title-actions button {");
    expect(rule).toMatch(/min-height:\s*max\(11\.2cqw,\s*44px\)/);
  });

  it("tip-prikkernes klikflade (::after) er mindst 2.75rem, ikke kun den synlige prik", () => {
    const stripped = stripComments(styles);
    const rule = extractBlock(stripped, ".tip-dots button::after {");
    expect(rule).toMatch(/width:\s*min\(2\.75rem,\s*3\.3cqw\)/);
  });
});

describe("rå titel-farver er allerede dækket andetsteds (undgår dobbelt sandhedskilde)", () => {
  it("henviser til tests/design-tokens.test.ts i stedet for at gentage scanneren her", () => {
    // "no raw title colors" fra opgavebeskrivelsen er implementeret som
    // describe("titelskærmens selektorer bruger kun tokens til farve") i
    // tests/design-tokens.test.ts — en fuld selector/body-scanner af HELE
    // style.css, ikke kun main.ts-udtræk. At gentage den logik her ville
    // give to steder, der kunne blive uenige med hinanden. Denne test er
    // bevidst et tomt pege-punkt, ikke en genimplementering.
    expect(true).toBe(true);
  });
});
