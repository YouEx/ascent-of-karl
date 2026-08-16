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
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REGISTRY_PATH = join(ROOT, "docs/design/reference/registry.json");
const BASELINE_PATH = join(ROOT, "tests/visual-baseline.json");
const MAIN_TS_PATH = join(ROOT, "src/ui/main.ts");
const SCORE_ASPECTS = ["structure", "tone", "ink", "geometry", "materiality"] as const;
const EXPECTED_VIEWPORTS = {
  "mobile-390": [390, 844, 2],
  "mobile-430": [430, 932, 2],
  "desktop-1366": [1366, 768, 1],
  "desktop-1536": [1536, 1024, 1],
  "target-native": [1586, 992, 1],
  "desktop-2560": [2560, 1440, 1],
} as const;
const EXISTING_THRESHOLDS = {
  game: {
    "app-frame": 0.82,
    header: 0.85,
    narrator: 0.85,
    chronicle: 0.85,
    chips: 0.85,
    slots: 0.85,
    combine: 0.8,
    search: 0.85,
    grid: 0.75,
  },
  title: {
    headline: 0.732,
    ribbon: 0.7252,
    tagline: 0.7152,
    divider: 0.8,
    actions: 0.82,
    hint: 0.7163,
    "tip-card": 0.7442,
    chip: 0.7343,
    tools: 0.7169,
    scene: 0.6,
  },
} as const;

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

  it("den malede wordmark bevarer én semantisk h1 og dekorativ billedkunst", () => {
    // Phase D må erstatte den synlige font-efterligning, men ikke headingens
    // navn. Teksten bliver i accessibility tree; rasteren er tom-alt og skjult.
    const src = readFileSync(MAIN_TS_PATH, "utf8");
    expect(src).toMatch(/<h1 class="title-mark[^"]*">/);
    expect(src).toContain(
      '<span class="title-mark-semantic">The Ascent of Karl</span>',
    );
    expect(src).toMatch(
      /<img[\s\S]{0,300}data-title-layer="wordmark"[\s\S]{0,300}alt=""[\s\S]{0,300}aria-hidden="true"/,
    );
    expect(src).toMatch(/class="title-tagline/);
    expect(src).toMatch(/class="title-hint/);
    expect(src).toMatch(/class="title-chip"/);
  });
});

describe("registry.json — titelens fidelitymål (TASK-001)", () => {
  it("registrerer de seks obligatoriske viewport-id'er med præcis størrelse og DPR", () => {
    const registry = loadRegistry();
    const actual = Object.fromEntries(
      registry.viewports.map((viewport: any) => [
        viewport.id,
        [viewport.width, viewport.height, viewport.dpr],
      ]),
    );
    expect(actual).toEqual(EXPECTED_VIEWPORTS);
  });

  it("pinner v2, portable provenance, geometri og de fire obligatoriske lag", () => {
    const metrics = loadRegistry().goalMetrics;
    expect(metrics.algorithmVersion).toBe("title-fidelity-v2");
    expect(metrics.sources).toEqual({
      approvedOriginal: {
        sha256: "8d37bca638f53d90a996c551183d721877419ebe73f3e81a1c67da120dc1a770",
      },
      approvedReference: {
        path: "docs/design/reference/title-2026-08-11.webp",
        sha256: "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850",
      },
    });
    expect(JSON.stringify(metrics)).not.toMatch(/\/Users\/|session-state|currentCalibration/);
    expect(metrics.capture).toMatchObject({
      canonicalCharacterSize: { width: 512, height: 554 },
      sceneAssetSelector: ".title-stage",
      sceneCssVariable: "--scene-src",
      requiredLayers: ["scene", "foreground", "parchment", "wordmark"],
    });
    expect(metrics.referenceGeometry).toMatchObject({
      seam: { axis: "vertical", physicalX: 690 },
      character: {
        sourceRect: [879, 180, 600, 650],
        canonicalWidth: 512,
        canonicalHeight: 554,
      },
    });
    expect(metrics.gates.captureDimensions.viewports).toBe("all");
    expect(metrics.gates.sceneSeamGradient.viewports).toEqual([
      "desktop-1366",
      "desktop-1536",
      "target-native",
      "desktop-2560",
    ]);
    expect(metrics.gates.characterEvidence.viewports).toBe("all");
    expect(metrics.gates.layerManifest).toMatchObject({
      viewports: "all",
      forbidCss: true,
      forbidInline: true,
      minimumNaturalArea: 1024,
    });
    expect(metrics.gates.assetContracts.sceneRetention.required).toEqual({
      "scene-target-native": [1586, 992],
    });
    expect(metrics.gates.assetContracts.parchmentRetention.required).toEqual({
      "parchment-desktop": [700, 992],
    });
    expect(metrics.gates.assetContracts.alphaEdges.required).toEqual({
      scene: [1586, 992],
      foreground: [1586, 992],
      parchment: [700, 992],
      wordmark: [545, 320],
    });
  });

  it("sænker ingen af de eksisterende regionstærskler", () => {
    const registry = loadRegistry();
    for (const [screenId, expected] of Object.entries(EXISTING_THRESHOLDS)) {
      const screen = registry.screens.find((candidate: any) => candidate.id === screenId);
      const actual = Object.fromEntries(
        screen.regions.map((region: any) => [region.id, region.threshold]),
      );
      for (const [regionId, minimum] of Object.entries(expected)) {
        expect(actual[regionId], `${screenId}/${regionId}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });
});

/**
 * Et anker, der ikke rammer noget, er ikke en manglende komponent — det er en
 * ITU MÅLESTOK. metrics.py giver regionen `missing: true` og en flad 0, og
 * fordi accept-gaten reagerer på ÆNDRINGER over 0,02, kan det nul aldrig
 * flytte sig igen. Regionen trækker skærmen ned for evigt, lydløst.
 *
 * Det var ikke teoretisk: `narrator` pegede på `#narrator`, som slet ikke
 * findes i DOM'en (elementerne hedder `#bubble`, `#narrator-label`,
 * `#narrator-text`), og `chronicle` pegede på `#book-panel` — en skuffe med
 * `visibility: hidden`, indtil spilleren åbner den. Begge vejer 3 af spillets
 * 24 vægtenheder. Målt på en frisk optagelse understregede de to nuller
 * spilskærmen med 14,4 point (0,461 mod 0,604), altså en fjerdedel af skærmen,
 * der aldrig blev set på.
 */
describe("registry-ankre peger på noget, der findes", () => {
  const MARKUP_SOURCES = [
    "src/ui/main.ts",
    "src/ui/App.svelte",
    "src/ui/components/game/GameHeader.svelte",
    "src/ui/components/game/LivingChronicle.svelte",
    "src/ui/components/game/Workshop.svelte",
    "src/ui/components/chronicle/ChronicleDrawer.svelte",
    "src/ui/components/overlays/OverlayHosts.svelte",
    "index.html",
  ];

  function markup() {
    return MARKUP_SOURCES.filter((file) => existsSync(join(ROOT, file)))
      .map((file) => readFileSync(join(ROOT, file), "utf8"))
      .join("\n");
  }

  /**
   * Klasseankre matches på TOKEN, ikke som understreng.
   *
   * `source.includes("title-mark")` er sandt, så længe blot ét `title-mark-
   * semantic` står tilbage i filen — og det gør der: main.ts har begge klasser
   * på to nabolinjer. Slettes den rigtige `.title-mark`, ville understrengs-
   * varianten stadig melde grønt, mens `title/headline` (vægt 3) faldt til et
   * permanent 0. Vagten ville altså svigte netop i det tilfælde, den er
   * skrevet for at fange.
   */
  function classTokens(source: string) {
    const tokens = new Set<string>();
    for (const match of source.matchAll(/class(?:Name)?="([^"]*)"/g)) {
      for (const token of (match[1] ?? "").split(/\s+/)) {
        if (token) tokens.add(token);
      }
    }
    return tokens;
  }

  function resolves(anchor: string, source: string, tokens: Set<string>) {
    if (anchor.startsWith("#")) return source.includes(`id="${anchor.slice(1)}"`);
    if (anchor.startsWith(".")) return tokens.has(anchor.slice(1));
    return new RegExp(`<${anchor}(?:\\s|>)`).test(source);
  }

  it("hvert eneste anker findes i markup'en", () => {
    const source = markup();
    const tokens = classTokens(source);
    const registry = loadRegistry();
    const dangling: string[] = [];
    for (const screen of registry.screens) {
      for (const region of screen.regions) {
        if (!resolves(region.anchor, source, tokens)) {
          dangling.push(`${screen.id}/${region.id} → ${region.anchor}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("et klasseanker overlever ikke på en navnefælle", () => {
    // Beviset for at vagten ovenfor faktisk kan fejle: `title-mark-semantic`
    // indeholder `title-mark` som understreng, men er ikke det samme token.
    const tokens = classTokens('<h1 class="title-mark-semantic other-thing">');

    expect(resolves(".title-mark-semantic", "", tokens)).toBe(true);
    expect(resolves(".title-mark", "", tokens)).toBe(false);
  });

  it("en region, der ikke kan fotograferes, er i rect-tilstand", () => {
    // `chronicle` MÅLES fortsat — den klippes bare ud af helskærmsbilledet på
    // referencens eget rektangel, præcis som `scene` på titelskærmen. Det er
    // forskellen på "ikke målt" og "målt til 0".
    const registry = loadRegistry();
    const chronicle = registry.screens
      .find((screen: any) => screen.id === "game")
      .regions.find((region: any) => region.id === "chronicle");

    expect(chronicle.mode).toBe("rect");
  });

  it("capture melder højlydt, hvis en region alligevel ikke kan fotograferes", async () => {
    // Kørt mod selve løkken, ikke mod filens tekst: en grep efter strengen
    // "unrenderable" ville stadig være grøn, hvis listen aldrig blev fyldt.
    const { measureRegions } = await import(
      // @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
      "../tools/judge/capture.mjs"
    );

    const locators: Record<string, unknown> = {
      "#findes-ikke": { count: async () => 0 },
      "#er-der-ikke-heller": { count: async () => 0 },
      "#skjult": {
        count: async () => 1,
        boundingBox: async () => ({ x: 0, y: 0, width: 390, height: 700 }),
        isVisible: async () => false,
        evaluate: async () => ({ textContent: "", childCount: 0 }),
      },
    };

    const page = {
      locator: (anchor: string) => ({ first: () => locators[anchor] }),
    };

    const warnings: string[] = [];
    const { regions, unrenderable } = await measureRegions({
      page,
      screen: {
        id: "game",
        regions: [
          { id: "narrator", anchor: "#findes-ikke" },
          { id: "chronicle", anchor: "#er-der-ikke-heller", mode: "rect" },
          { id: "book", anchor: "#skjult" },
        ],
      },
      outDir: ".judge/aldrig-skrevet",
      name: "stub",
      warn: (message: string) => warnings.push(message),
    });

    // Manglende anker uden rect-tilstand: kan aldrig scores, skal meldes.
    expect(unrenderable).toContain("narrator (#findes-ikke)");
    // Skjult element med en stor boks: samme skæbne, samme melding.
    expect(unrenderable).toContain("book (#skjult)");
    // rect-regioner klippes ud af helskærmsbilledet og har intet crop at mangle.
    expect(unrenderable).not.toContain("chronicle (#er-der-ikke-heller)");

    expect(regions.narrator).toEqual({
      anchor: "#findes-ikke",
      missing: true,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/scorer 0 for altid/);
    expect(warnings[0]).toContain("game");
  });

  it("tier stille, når hver region kan fotograferes", async () => {
    // Modprøven: uden den ville testen ovenfor bestå, selv om advarslen blev
    // fyret ubetinget.
    const { measureRegions } = await import(
      // @ts-expect-error — dommerværktøjet er ren JavaScript uden typedeklaration.
      "../tools/judge/capture.mjs"
    );

    const shots: string[] = [];
    const page = {
      locator: () => ({
        first: () => ({
          count: async () => 1,
          boundingBox: async () => ({ x: 0, y: 0, width: 100, height: 40 }),
          isVisible: async () => true,
          evaluate: async () => ({ textContent: "Karl", childCount: 0 }),
          screenshot: async (options: { path: string }) =>
            shots.push(options.path),
        }),
      }),
    };

    const warnings: string[] = [];
    const { unrenderable } = await measureRegions({
      page,
      screen: { id: "title", regions: [{ id: "headline", anchor: ".title-mark" }] },
      outDir: ".judge/aldrig-skrevet",
      name: "stub",
      warn: (message: string) => warnings.push(message),
    });

    expect(unrenderable).toEqual([]);
    expect(warnings).toEqual([]);
    expect(shots).toEqual([
      join(".judge/aldrig-skrevet", "render", "stub", "headline.png"),
    ]);
  });
});
