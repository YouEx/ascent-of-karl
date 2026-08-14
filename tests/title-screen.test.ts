import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
import iconsSource from "../src/ui/icons.ts?raw";
import styles from "../src/ui/style.css?raw";
import titleArtSource from "../src/ui/title-art.ts?raw";

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
      '<span class="title-action-count fates-count">${unlocked}/${content.endings.length}</span>',
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

  it("bevarer den læsbare titel som semantisk tekst og gør den malede wordmark dekorativ", () => {
    expect(showTitleScreenBody).toContain(
      '<span class="title-mark-semantic">The Ascent of Karl</span>',
    );
    expect(showTitleScreenBody).toMatch(
      /<picture class="title-wordmark" aria-hidden="true">[\s\S]*?<source[\s\S]*?TITLE_WORDMARKS\.mobile[\s\S]*?<img[\s\S]*?data-title-layer="wordmark"[\s\S]*?alt=""[\s\S]*?aria-hidden="true"/,
    );
  });

  it("deklarerer begge wordmarks med deres godkendte native mål", () => {
    expect(titleArtSource).toContain("wordmark-desktop.webp");
    expect(titleArtSource).toContain("wordmark-mobile.webp");
    expect(titleArtSource).toMatch(/desktop:[\s\S]*?width:\s*545[\s\S]*?height:\s*320/);
    expect(titleArtSource).toMatch(/mobile:[\s\S]*?width:\s*436[\s\S]*?height:\s*256/);
  });

  it("holder wordmarken på native 545px desktop / 218px ved DPR2 og bruger ikke CSS-tekstfyld", () => {
    const stripped = stripComments(styles);
    const desktop = extractBlock(stripped, ".title-mark {");
    const mobile = extractBlock(
      stripped,
      "@media (max-width: 900px), (max-aspect-ratio: 1/1) {",
    );
    expect(desktop).toMatch(/width:\s*min\(78\.27%,\s*545px\)/);
    expect(desktop).not.toMatch(/background-clip|text-stroke/);
    expect(mobile).toMatch(
      /\.title-mark\s*\{[\s\S]*?width:\s*min\(61%,\s*218px\)/,
    );
  });

  it("setBackgroundInert skåner #title-screen selv, men rammer alle andre børn af #app", () => {
    expect(setBackgroundInertBody).toMatch(
      /child\.id === "title-screen"/,
    );
    expect(setBackgroundInertBody).toMatch(
      /child\.toggleAttribute\("inert", inert\)/,
    );
  });

  // Regression: titlens Fates-knap åbner #trophy-modal — en søskende til
  // #title-screen inde i #app, ramt af samme inert-loop som resten af
  // baggrunden. Var den ikke undtaget, ville modalen ses (CSS løfter den med
  // z-index), men hverken kunne fokuseres, læses op eller lukkes med musen:
  // synlig, men en blindgyde. Se tools/ux_audit.mjs's "Titlens Fates"-tjek
  // for den rigtige browser-verifikation af selve konsekvensen.
  it("setBackgroundInert skåner OGSÅ #trophy-modal, som titlens Fates-knap kan åbne", () => {
    expect(setBackgroundInertBody).toMatch(
      /child\.id === "title-screen" \|\| child\.id === "trophy-modal"/,
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
    expect(stripComments(styles)).toContain("title-materials/ornament-tap.webp");
  });
});

describe("titlens krom er semantiske komponenter, ikke sammensyede screenshots", () => {
  const stripped = stripComments(styles);

  it("bruger ingen af de forbudte slice- eller frame-assets i runtime-CSS", () => {
    for (const asset of [
      "ribbon-left.webp",
      "ribbon-center.webp",
      "ribbon-right.webp",
      "begin-left.webp",
      "begin-center.webp",
      "begin-right.webp",
      "fates-left.webp",
      "fates-center.webp",
      "fates-right.webp",
      "welcome-frame.webp",
      "tool-frame.webp",
      "tip-card-frame.webp",
    ]) {
      expect(stripped).not.toContain(`title-materials/${asset}`);
    }
  });

  it("bevarer kun selvstændige illustrationer som billeder", () => {
    for (const asset of [
      "welcome-figure.webp",
      "tip-fire-tile.webp",
      "ornament-tap.webp",
      "ornament-divider.webp",
      "ornament-hunt.webp",
    ]) {
      expect(stripped).toContain(`title-materials/${asset}`);
    }
  });

  it("bruger ikke border-image på actions, tools, welcome eller tip card", () => {
    const componentRules = [
      extractBlock(stripped, ".title-actions button {"),
      extractBlock(stripped, ".title-tools button {"),
      extractBlock(stripped, ".title-tools button::before {"),
      extractBlock(stripped, ".title-chip {"),
      extractBlock(stripped, ".title-chip::before {"),
      extractBlock(stripped, ".title-tip {"),
      extractBlock(stripped, ".title-tip::before {"),
    ].join("\n");
    expect(componentRules).not.toMatch(/border-image/);
  });

  it("giver alle titelhandlinger den samme ikon/label/count-struktur", () => {
    expect(showTitleScreenBody).toMatch(
      /id="t-primary" class="title-action btn-stone"[\s\S]*?class="title-action-icon"[\s\S]*?icons\.spiral[\s\S]*?class="title-action-label"[\s\S]*?\$\{canContinue \? "Continue" : "Begin"\}/,
    );
    expect(showTitleScreenBody).toMatch(
      /id="t-new" class="title-action btn-quiet"[\s\S]*?class="title-action-icon"[\s\S]*?icons\.restart[\s\S]*?class="title-action-label">New life/,
    );
    expect(showTitleScreenBody).toMatch(
      /id="t-fates" class="title-action btn-quiet"[\s\S]*?class="title-action-icon"[\s\S]*?icons\.trophy[\s\S]*?class="title-action-label">Fates[\s\S]*?class="title-action-count fates-count"/,
    );
  });

  it("har rigtige hover-, pressed- og fokus-tilstande i CSS", () => {
    expect(stripped).toMatch(/\.title-actions button:hover/);
    expect(stripped).toMatch(/\.title-actions button:active/);
    expect(stripped).toMatch(/\.title-actions button:focus-visible/);
    expect(stripped).toMatch(/\.title-tools button:hover/);
    expect(stripped).toMatch(/\.title-tools button:active/);
    expect(stripped).toMatch(/\.title-tools button:focus-visible/);
  });

  it("slår titelkomponenternes bevægelse fra ved reduced motion", () => {
    const reduced = extractBlock(stripped, "@media (prefers-reduced-motion: reduce) {");
    expect(reduced).toContain(".title-actions button");
    expect(reduced).toContain(".title-tools button");
  });

  it("gemt spil frigiver fresh-state-bredderne, så tre knapper forbliver på én række", () => {
    expect(stripped).toMatch(
      /\.title-actions\.crowded \.btn-stone,\s*\.title-actions\.crowded \.btn-quiet\s*\{[^}]*width:\s*auto/,
    );
    const button = extractBlock(stripped, ".title-actions button {");
    expect(button).toMatch(/white-space:\s*nowrap/);
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

describe("titlen bindes til den synlige mobilrude, ikke spilskærmens bredere layout-viewport", () => {
  it("#title-screen bruger dynamic viewport-units i begge retninger", () => {
    const stripped = stripComments(styles);
    const rule = extractBlock(stripped, "#title-screen {");
    expect(rule).toMatch(/width:\s*100dvw/);
    expect(rule).toMatch(/height:\s*100dvh/);
    expect(rule).toMatch(
      /--bar:\s*max\(0px,\s*\(100dvw\s*-\s*178dvh\)\s*\/\s*2\)/,
    );
  });

  it("de fuldskærmsmodaler titlen kan åbne bruger samme synlige rude", () => {
    const stripped = stripComments(styles);
    const rule = extractBlock(
      stripped,
      "#card, #banner, #ending, #trophy-modal {",
    );
    expect(rule).toMatch(/width:\s*100dvw/);
    expect(rule).toMatch(/height:\s*100dvh/);
  });

  it("scenens bredde og slørede samling følger dynamic viewport-højden", () => {
    const stripped = stripComments(styles);
    const rule = extractBlock(stripped, ".title-stage {");
    expect(rule).toMatch(/--seam:\s*calc\(100%\s*-\s*90\.4dvh\)/);
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
