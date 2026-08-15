import { describe, expect, it } from "vitest";
import design from "../DESIGN.md?raw";
import tokens from "../src/ui/tokens.css?raw";
import styles from "../src/ui/style.css?raw";

/**
 * DESIGN.md er lov (CLAUDE.md regel 8), og dokumentets egen indledning lover at
 * "dokumentet og token-filen skal altid stemme overens". Et løfte som det holder
 * kun så længe nogen husker det. Denne fil gør det til en test i stedet.
 *
 * Retningen der testes er den vigtige: **alt DESIGN.md nævner, skal findes i
 * tokens.css.** Den omvendte vej testes bevidst ikke — tokens.css må gerne
 * indeholde LEGACY-værdier, der er på vej ud, og afledte værdier som skygger.
 */

/**
 * Farver DESIGN.md nævner for at ADVARE mod dem. De må netop ikke være tokens.
 * Listen er bevidst eksplicit: skal en ny farve undtages, skal grunden skrives
 * her — ellers kan en fejl gemme sig som en undtagelse.
 */
const REJECTED = new Map([
  ["000000", "forbudt: ren sort (DESIGN.md §8)"],
  ["92745a", "forkastet: referencens etiketbrun, 3,21:1 — dumper AA"],
  ["bc9776", "forkastet: referencens Combine-sten, 2,18:1 med cremetekst"],
  [
    "fed831",
    "bevidst IKKE et token: Karls guld findes kun i tegningen. Et token " +
      "ville være en invitation til at bruge den på en knap (DESIGN.md §2)",
  ],
]);

/** Hex i DESIGN.md står i backticks: `#ECDCC7`. Løs tekst tælles ikke med. */
function hexesInDesign(): string[] {
  const found: string[] = design.match(/`#[0-9a-fA-F]{6}`/g) ?? [];
  const all = new Set(found.map((h) => h.slice(2, -1).toLowerCase()));
  return [...all].filter((h) => !REJECTED.has(h));
}

/** Én fælles implementering — to kopier er præcis det, der lod fejlen opstå. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Kun ægte token-erklæringer tæller. Kommentarer strippes først: en farve der
 * blot er OMTALT i en kommentar, findes ikke — og hvis den slap igennem her,
 * ville testen bestå af den forkerte grund.
 */
function hexesInTokens(): Set<string> {
  const code = stripComments(tokens);
  const declarations: string[] = code.match(/^\s*--[\w-]+:[^;]+;/gm) ?? [];
  const found: string[] =
    declarations.join("\n").match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  return new Set(found.map((h) => h.slice(1).toLowerCase()));
}

/**
 * rgba-værdier DESIGN.md nævner for at UDPEGE et brud. De skal netop ikke være
 * tokens — pointen er at de står hardkodet i style.css, hvor de ikke må stå.
 */
const REJECTED_RGBA = new Map([
  [
    "rgba(162,75,55,0.18)",
    "kendt brud: hardkodet i style.css ch-pulse i stedet for et token (§8)",
  ],
]);

/** rgba(26, 18, 14, 0.14) -> "26,18,14,0.14" så mellemrum ikke giver falsk fejl. */
function rgbasIn(text: string): Set<string> {
  // Samme fælde som i hexesInTokens(): en rgba-værdi der blot er OMTALT i en
  // kommentar er ikke et token. Slap den igennem, ville testen bestå af den
  // forkerte grund. Strippes her, så alle kaldesteder er dækket.
  const found: string[] = stripComments(text).match(/rgba\([^)]+\)/g) ?? [];
  return new Set(found.map((r) => r.replace(/\s+/g, "").toLowerCase()));
}

/** Relativ luminans (WCAG 2.1). */
function luminance(hex: string): number {
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Værdien LÆSES ud af tokens.css. Skrev vi den af som literal her, ville
 * testen måle en frossen kopi og blive ved at bestå, selv om et token senere
 * blev ændret til noget der dumper — altså præcis den slags grøn test den er
 * sat i verden for at forhindre. Modulscope så både kontrast- og
 * dækningstests kan bruge den samme opslagslogik.
 */
function token(name: string): string {
  const code = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(code);
  if (!found?.[1]) throw new Error(`token --${name} findes ikke i tokens.css`);
  return found[1].slice(1).toLowerCase();
}

describe("testen læser rent faktisk filerne", () => {
  // Vitest stubber CSS til tom streng uden `css: true` i vite.config.ts.
  // Sker det, ville alle kontroller herunder bestå ved at måle ingenting.
  it("har læst tokens.css med indhold", () => {
    expect(tokens).toContain(":root");
    expect(tokens.length).toBeGreaterThan(4000);
  });

  it("har læst DESIGN.md med indhold", () => {
    expect(design).toContain("## 2. Farvepalette");
    expect(design.length).toBeGreaterThan(10000);
  });
});

describe("DESIGN.md og tokens.css stemmer overens", () => {
  it("har hver eneste farve fra DESIGN.md som token", () => {
    const missing = hexesInDesign().filter((h) => !hexesInTokens().has(h));
    expect(missing).toEqual([]);
  });

  it("har hver rgba() fra DESIGN.md som token", () => {
    const inTokens = rgbasIn(tokens);
    const missing = [...rgbasIn(design)].filter(
      (r) => !inTokens.has(r) && !REJECTED_RGBA.has(r),
    );
    expect(missing).toEqual([]);
  });

  it("har stadig det kendte brud i style.css, som DESIGN.md udpeger", () => {
    // Testen holder DESIGN.md ærlig: forsvinder det hardkodede rgba fra
    // style.css (fase 2-5), skal "kendt brud"-afsnittet også ud af DESIGN.md.
    // Bliver de to uenige, fejler denne test frem for at lyve videre.
    for (const [value] of REJECTED_RGBA) {
      expect(rgbasIn(styles).has(value), `${value} i style.css`).toBe(true);
    }
  });

  it("nævner akt-badgens tokens i DESIGN.md, ikke kun i tokens.css", () => {
    // Testen ovenfor ("har hver eneste farve...") dækker kun én retning:
    // alt DESIGN.md nævner, skal være et token. Det modsatte hul er hvad der
    // ramte --act-badge/--act-badge-ink i første omgang (commit 36a6752,
    // 11-08-2026): de blev tokens og kom i brug (.book-tab.active), men stod
    // aldrig i DESIGN.md, og ingen test opdagede det. Denne test lukker
    // hullet specifikt for akt-badgens to tokens — ikke som en generel regel,
    // for tokens.css har bevidst en del udokumenterede
    // implementeringsdetaljer (skygger, afledte varianter), og en blanket
    // omvendt test ville fejle på dem alle.
    const documented = hexesInDesign();
    expect(documented).toContain(token("act-badge"));
    expect(documented).toContain(token("act-badge-ink"));
  });
});

describe("kontrastkrav fra DESIGN.md §2", () => {
  // DESIGN.md: en tekstfarve måles mod det MØRKESTE papir den kan lande på.
  const paperNames = [
    "chronicle",
    "parchment",
    "tile",
    "field",
    "titlebar",
    "slot",
  ];

  it.each(["ink-warm", "ink-warm-soft", "label-ink"])(
    "--%s klarer AA (4.5:1) mod ALLE seks papirflader",
    (inkName) => {
      for (const paper of paperNames) {
        expect(
          contrast(token(inkName), token(paper)),
          `--${inkName} mod --${paper}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("har cremetekst på Combine-stenen over AA", () => {
    // Referencebilledets egen sten (#BC9776) gav 2.18:1 og blev mørknet.
    expect(contrast(token("stone-text"), token("stone"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("har akt-badge-ink på akt-badge over AA", () => {
    // Testen målte tidligere parchment-på-navy, et par der aldrig var live —
    // .book-tab.active bruger --act-badge/--act-badge-ink (DESIGN.md §2, §4).
    expect(
      contrast(token("act-badge-ink"), token("act-badge")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("har tilstandsfarverne over AA på de flader de bruges på", () => {
    // Sult: rust-tekst på papir. Måles mod det mørkeste papirtrin.
    for (const paper of paperNames) {
      expect(
        contrast(token("rust-warm"), token(paper)),
        `--rust-warm mod --${paper}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // Kulde: frost-tekst på sin egen kølige chip-flade.
    expect(contrast(token("frost"), token("frost-chip"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("holder ornamentokker UNDER 3:1, så den aldrig forveksles med information", () => {
    // Et ornament der er læsbart, er tegnet forkert (DESIGN.md §2 og §8).
    expect(contrast(token("ornament"), token("parchment"))).toBeLessThan(3);
    expect(contrast(token("ornament-faint"), token("parchment"))).toBeLessThan(
      3,
    );
  });

  it("kender forskel på --rust (stadig pastel, live) og --rust-warm", () => {
    // Fase 1 må ikke ændre noget synligt, og --rust er live i style.css.
    expect(token("rust")).toBe("a24b37");
    expect(token("rust-warm")).toBe("762214");
  });
});

describe("titelskærmens kontrastpar (overflader uden for de seks generiske papirer)", () => {
  // Ribbon, sten-knapper og redskabsikoner sidder ikke på en af de seks
  // generiske papirflader ovenfor: båndet har sin egen flade, og knapperne
  // blander eksisterende titel-/flisetokens i CSS. Parrene skrives eksplicit
  // ind her, så en fremtidig
  // tokenændring, der umærkeligt sænker en af dem, fældes af testen — ikke
  // først opdaget ved næste visuelle gennemgang.

  it("--ribbon-ink mod fanebåndets egen flade (--ribbon-face) klarer AA (4.5:1)", () => {
    // .title-sub i style.css: båndet lånte før --tile-edge (kortenes tone,
    // 4,92:1), men den er koldere og blegere end referencens malede bånd.
    // --ribbon-face er regionsmedianen fra referencen selv og holder 4,74:1.
    expect(
      contrast(token("ribbon-ink"), token("ribbon-face")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--btn-ink mod primærknappens egen tavle (--slab-face) klarer AA (4.5:1)", () => {
    // .title-actions .btn-stone er ikke længere en lys blanding tæt på
    // papiret, men referencens målte materiale #b98d65. Både etiketten
    // ("Begin") og helleristningen arver --btn-ink, så det ene tal dækker
    // begge — og teksten er den strengeste af de to (4,5:1 mod ikonets 3:1).
    expect(
      contrast(token("btn-ink"), token("slab-face")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--btn-ink mod CSS-knappens mørkeste rille klarer AA (4.5:1)", () => {
    // Handlingsknappernes tekst ligger på en gradient mellem de lyse
    // flisetokens, mens --tile-groove er komponentens mørkeste token. Testen
    // bruger derfor rillen som konservativt gulv i stedet for en pixelmåling
    // fra et udgået knapbillede.
    expect(
      contrast(token("btn-ink"), token("tile-groove")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--title-stone-hi (overskriftens lyseste sten-tone) mod --parchment klarer stor tekst (3:1)", () => {
    // .title-mark er en lodret gradient fra --title-stone-hi (top) til
    // --title-stone-lo (bund) via background-clip:text — værste tilfælde
    // for kontrast er den LYSESTE ende, tættest på det lyse papir.
    // Overskriften er stor tekst og kræver derfor kun 3:1, ikke normal
    // teksts 4,5:1 (WCAG 2.1 SC 1.4.3).
    expect(
      contrast(token("title-stone-hi"), token("parchment")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("--label-ink (redskabsikonernes streg) mod værktøjsknappens mørkeste tone klarer ikke-tekst-grænsen (3:1)", () => {
    // .title-tools button rummer et rent SVG-ikon (trofæ/lyd), ikke
    // løbetekst — WCAG 2.1 SC 1.4.11 (ikke-tekst-kontrast) kræver 3:1, ikke
    // §1.4.3's 4,5:1 for tekst. Fladen er en lodret gradient fra
    // --tile-shade til --tile-groove; den mørkeste ende (--tile-groove) er
    // værste tilfælde.
    expect(
      contrast(token("label-ink"), token("tile-groove")),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("titelskærmens selektorer bruger kun tokens til farve", () => {
  // Brief (TASK-007/008/REQ-002): "scan title selectors in style.css for
  // raw hex/rgb/hsl color literals (allow only var()/transparent/
  // currentColor)". Denne test er adskilt fra "DESIGN.md og tokens.css
  // stemmer overens" ovenfor — den ser kun på style.css' egne regler for
  // titelskærmens selektorer, uafhængigt af hvad DESIGN.md nævner.

  /** Splitter style.css fladt i (selector, body)-par — filen har ingen
   * CSS-nesting (intet `&`), så selv @media-ramte regler matches korrekt:
   * @media-linjen selv indgår aldrig i noget match, kun de rigtige regler
   * indeni gør. */
  function titleRuleBodies(): { selector: string; body: string }[] {
    const css = stripComments(styles);
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const rules: { selector: string; body: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const selector = m[1]!.trim();
      if (!/[.#]title\b/i.test(selector)) continue;
      rules.push({ selector, body: m[2]! });
    }
    return rules;
  }

  it("har fundet titelskærmens regler (selvtjek af scanneren)", () => {
    // Falder dette til nul, måler resten af testen ingenting og består af
    // den forkerte grund — samme fælde som "testen læser rent faktisk
    // filerne" øverst i denne fil.
    expect(titleRuleBodies().length).toBeGreaterThan(20);
  });

  it("har ingen rå hex/rgb/hsl-farver i titelskærmens selektorer", () => {
    const offenders: string[] = [];
    for (const { selector, body } of titleRuleBodies()) {
      // mask-image/-webkit-mask-image er alpha-stencils, ikke synlig farve:
      // #000 her styrer kun hvor masken er uigennemsigtig (samme etablerede
      // mønster som spillets øvrige mask-image uden for titelskærmen) og
      // er reelt identisk med nøgleordet `black` — ikke et farvevalg.
      // Linjen ekskluderes eksplicit, så en NY farve andetsteds i samme
      // regel stadig fanges.
      const withoutMasks = body
        .split(";")
        .filter((decl) => !/^\s*(-webkit-)?mask-image\s*:/.test(decl))
        .join(";");
      const withoutVar = withoutMasks.replace(/var\([^)]*\)/g, "");
      const hex = withoutVar.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgbHsl = withoutVar.match(/\b(?:rgb|rgba|hsl|hsla)\(/g) ?? [];
      if (hex.length || rgbHsl.length) {
        offenders.push(
          `${selector.replace(/\s+/g, " ")} -> ${[...hex, ...rgbHsl].join(", ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("anti-mønstre er ikke sluppet ind i tokens", () => {
  it("bruger ikke ren sort", () => {
    expect(tokens).not.toMatch(/#000000\b/);
    expect(tokens).not.toMatch(/:\s*black\b/);
  });

  it("erklærer ingen af de forkastede referencefarver som token", () => {
    const declared = hexesInTokens();
    const slipped = [...REJECTED].filter(([hex]) => declared.has(hex));
    expect(slipped).toEqual([]);
  });
});
