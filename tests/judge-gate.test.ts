// Accept-porten er det eneste, der står mellem en automatisk sløjfe og en
// langsomt forværret brugerflade. Den fortjener rigtige tests, ikke et
// engangsscript i /tmp.
//
// Den prøve, der betyder mest, er nr. 2: en ændring, der hæver den samlede
// score ved at ofre én region, SKAL afvises. Uden den regel ser regnskabet
// ud som fremskridt, mens skærmen bliver værre at se på.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration; kontrakten testes her.
import { acceptGate, consolidateTokens, rejectedKeys, resolveTokenWinners, revert, route, scopedOverall } from "../tools/judge/apply.mjs";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Scratch-mapper under den allerede-ignorerede .judge/ — ALDRIG i systemets
// /tmp. Samme konvention som tests/judge-loop.test.ts.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

type Regions = Record<string, number>;
const mk = (overall: number, regions: Regions) => ({
  overall,
  screens: {
    game: {
      regions: Object.fromEntries(
        Object.entries(regions).map(([k, v]) => [k, { overall: v }]),
      ),
    },
  },
});

// Flerskærms-fabrik til blokerer 1 (fortynding): hver skærm får sin EGEN
// overall (som metrics.py's score_screen ville have sat) og sit eget
// regionsantal — regionsantallet er det, der reelt vejer i metrics.py's
// GLOBALE topniveau-overall, ikke regionernes egne værdier.
type ScreenSpec = Record<string, { overall: number; regions: Regions }>;
const mkScreens = (topOverall: number, spec: ScreenSpec) => ({
  overall: topOverall,
  screens: Object.fromEntries(
    Object.entries(spec).map(([sid, s]) => [
      sid,
      {
        overall: s.overall,
        regions: Object.fromEntries(Object.entries(s.regions).map(([rid, v]) => [rid, { overall: v }])),
      },
    ]),
  ),
});

describe("accept-porten", () => {
  it("accepterer ægte fremgang", () => {
    const r = acceptGate(mk(0.4, { a: 0.3, b: 0.5 }), mk(0.45, { a: 0.4, b: 0.5 }));
    expect(r.accepted).toBe(true);
    expect(r.gain).toBeCloseTo(0.05, 4);
  });

  it("afviser en region, der ofres for gennemsnittet", () => {
    // +0,06 samlet, men b falder 0,08. Nettotallet lyver; porten må ikke.
    const r = acceptGate(mk(0.4, { a: 0.3, b: 0.5 }), mk(0.46, { a: 0.42, b: 0.42 }));
    expect(r.accepted).toBe(false);
    expect(r.regressions).toHaveLength(1);
    expect(r.regressions[0].region).toBe("game/b");
  });

  it("afviser støj under epsilon som fremgang", () => {
    expect(acceptGate(mk(0.4, { a: 0.3 }), mk(0.4005, { a: 0.3005 })).accepted).toBe(false);
  });

  it("afviser ren tilbagegang", () => {
    expect(acceptGate(mk(0.5, { a: 0.5 }), mk(0.4, { a: 0.4 })).accepted).toBe(false);
  });

  it("tolererer et fald på præcis grænsen, men ikke over", () => {
    expect(acceptGate(mk(0.4, { a: 0.5 }), mk(0.45, { a: 0.48 })).accepted).toBe(true);
    expect(acceptGate(mk(0.4, { a: 0.5 }), mk(0.45, { a: 0.479 })).accepted).toBe(false);
  });

  it("afviser en aspektregression, selv når regionens overall og den samlede score stiger", () => {
    const before = {
      overall: 0.4,
      screens: {
        game: {
          regions: {
            a: { overall: 0.5, structure: 0.5, tone: 0.8, ink: 0.5, geometry: 0.5, materiality: 0.5 },
          },
        },
      },
    };
    const after = {
      overall: 0.45,
      screens: {
        game: {
          regions: {
            a: { overall: 0.51, structure: 0.53, tone: 0.779, ink: 0.51, geometry: 0.51, materiality: 0.51 },
          },
        },
      },
    };

    const result = acceptGate(before, after);
    expect(result.accepted).toBe(false);
    expect(result.regressions).toContainEqual({
      region: "game/a/tone",
      aspect: "tone",
      drop: 0.021,
    });
  });

  it("tæller en helt ny region som fremgang, ikke som regression", () => {
    // En region kan dukke op, når et manglende anker endelig bliver tegnet.
    expect(acceptGate(mk(0.4, { a: 0.4 }), mk(0.45, { a: 0.45, ny: 0.1 })).accepted).toBe(true);
  });

  it("begrunder altid sin dom", () => {
    expect(acceptGate(mk(0.4, { a: 0.3 }), mk(0.45, { a: 0.4 })).why).toMatch(/\S/);
    expect(acceptGate(mk(0.4, { a: 0.5 }), mk(0.45, { a: 0.4 })).why).toMatch(/regression/);
  });
});

describe("kontrakten med metrics.py", () => {
  it("kaster, hvis scores.json mangler en samlet score", () => {
    // Regressionsvagt: metrics.py skrev længe kun {screens:{...}} uden et
    // samlet felt, og porten kastede TypeError i stedet for at dømme. En
    // port, der brækker, lader ændringen passere uset.
    const uden = { screens: { game: { regions: { a: { overall: 0.3 } } } } };
    const med = { overall: 0.4, screens: { game: { regions: { a: { overall: 0.4 } } } } };
    expect(() => acceptGate(uden, med)).toThrow(/overall mangler/);
    expect(() => acceptGate(med, uden)).toThrow(/overall mangler/);
  });
});

describe("scopedOverall (2. anmeldelse, blokerer 1) — samme vægtformel som metrics.py's globale felt, men kun for de efterspurgte skærme", () => {
  it("vægter kun de efterspurgte skærme, med regionsantal som vægt", () => {
    // title: 2 regioner à overall 0,8. game: 4 regioner à overall 0,2.
    const scores = mkScreens(0.4, {
      title: { overall: 0.8, regions: { a: 0.8, b: 0.8 } },
      game: { overall: 0.2, regions: { a: 0.2, b: 0.2, c: 0.2, d: 0.2 } },
    });
    expect(scopedOverall(scores, ["title"])).toBeCloseTo(0.8, 6);
    expect(scopedOverall(scores, ["game"])).toBeCloseTo(0.2, 6);
    // Begge skærme: (0,8·2 + 0,2·4) / 6 = 0,4 — matcher metrics.py's globale formel.
    expect(scopedOverall(scores, ["title", "game"])).toBeCloseTo(0.4, 6);
  });

  it("springer en efterspurgt skærm, der slet ikke findes i scores, stille over", () => {
    const scores = mkScreens(0.8, { title: { overall: 0.8, regions: { a: 0.8 } } });
    expect(scopedOverall(scores, ["title", "findes-ikke"])).toBeCloseTo(0.8, 6);
  });

  it("giver 0 for en tom liste af efterspurgte skærme, i stedet for at kaste", () => {
    const scores = mkScreens(0.8, { title: { overall: 0.8, regions: { a: 0.8 } } });
    expect(scopedOverall(scores, [])).toBe(0);
  });
});

describe("acceptGate({ screenIds }) (2. anmeldelse, blokerer 1) — en ikke-optaget skærms nul-stub må ikke fortynde en ægte gevinst", () => {
  // Nøjagtigt defekt 1's mekanisme: title forbedres ægte med +0,006 (langt
  // over epsilon 0,002), men game (4 regioner, ALDRIG optaget denne kørsel)
  // sidder uændret med overall 0 i både før og efter og tæller stadig med i
  // metrics.py's globale nævner. 6 regioner i alt (2 title + 4 game) —
  // fortyndingen rammer PRÆCIS epsilon-grænsen, konstrueret sådan for at
  // vise, hvor farlig den er: en ægte forbedring bliver til en afvisning.
  const before = mkScreens(1.4 / 6, {
    title: { overall: 0.7, regions: { a: 0.7, b: 0.7 } },
    game: { overall: 0, regions: { a: 0, b: 0, c: 0, d: 0 } },
  });
  const after = mkScreens(1.412 / 6, {
    title: { overall: 0.706, regions: { a: 0.706, b: 0.706 } },
    game: { overall: 0, regions: { a: 0, b: 0, c: 0, d: 0 } },
  });

  it("uden screenIds (gammel/global opførsel, uændret): fortyndes gevinsten ned til epsilon-grænsen og afvises", () => {
    const r = acceptGate(before, after);
    expect(r.gain).toBeCloseTo(0.002, 4);
    expect(r.accepted).toBe(false);
  });

  it("med screenIds: ['title'] ignoreres game's nul-stub, og den ægte gevinst består", () => {
    const r = acceptGate(before, after, { screenIds: ["title"] });
    expect(r.gain).toBeCloseTo(0.006, 4);
    expect(r.accepted).toBe(true);
  });

  it("scoper også regressionstjekket: et fald i en skærm UDEN for screenIds bliver hverken rapporteret eller fælder porten", () => {
    const before2 = mkScreens(0.7, {
      title: { overall: 0.7, regions: { a: 0.7 } },
      game: { overall: 0.7, regions: { a: 0.7 } },
    });
    const after2 = mkScreens(0.65, {
      title: { overall: 0.71, regions: { a: 0.71 } },
      game: { overall: 0.6, regions: { a: 0.6 } }, // falder 0,1 — langt over maxDrop 0,02
    });

    const scoped = acceptGate(before2, after2, { screenIds: ["title"] });
    expect(scoped.regressions).toHaveLength(0);
    expect(scoped.accepted).toBe(true);

    // Uscopet (ingen screenIds) skal stadig scanne ALLE skærme som hidtil —
    // uændret bagudkompatibel opførsel, når kalderen ikke beder om scoping.
    const unscoped = acceptGate(before2, after2);
    expect(unscoped.regressions).toHaveLength(1);
    expect(unscoped.regressions[0].region).toBe("game/a");
    expect(unscoped.accepted).toBe(false);
  });
});

describe("revert (2. anmeldelse, blokerer 2) — genskaber fra en injiceret sti, aldrig en fast global fil", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(SCRATCH_ROOT, "revert-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("genskaber den injicerede tuningPath fra den injicerede backupPath", () => {
    const tuningPath = join(dir, "tuning.css");
    const backupPath = join(dir, "tuning.prev.css");
    writeFileSync(backupPath, "ORIGINAL\n");
    writeFileSync(tuningPath, "MUTERET\n");

    expect(revert({ tuningPath, backupPath })).toBe(true);
    expect(readFileSync(tuningPath, "utf8")).toBe("ORIGINAL\n");
  });

  it("returnerer false og rører IKKE tuningPath, hvis den injicerede backupPath ikke findes", () => {
    const tuningPath = join(dir, "tuning.css");
    writeFileSync(tuningPath, "URØRT\n");

    expect(revert({ tuningPath, backupPath: join(dir, "findes-ikke.css") })).toBe(false);
    expect(readFileSync(tuningPath, "utf8")).toBe("URØRT\n");
  });
});

// Fælles fabrik til fund, der foreslår en token-værdi. `key` matcher formatet
// route() selv bruger (region:defect:token), så tests kan sammenligne mod det.
const mkFinding = (region: string, defect: string, severity: number, token: string, to: string) => ({
  region,
  defect,
  severity,
  fix: { kind: "token", token, to },
  key: `${region}:${defect}:${token}`,
});

describe("resolveTokenWinners (TASK-021 / defekt 2)", () => {
  it("lader HØJESTE severity vinde, selv i den rækkefølge der reelt fejlede", () => {
    // route() sorterer værste-først (faldende severity), så dette er nøjagtig
    // den rækkefølge writeTuning() modtog i den fejlende kode: severity 5
    // behandlet FØRST, severity 2 SIDST. Den gamle kode satte værdier i et
    // Map i denne rækkefølge og lod Map.set overskrive — så den SIDST
    // behandlede (severity 2) vandt, ikke den højeste. Havde fixet ikke
    // virket, ville denne test have fanget det: den forventer #111111
    // (severity 5), og den gamle kode ville have skrevet #222222.
    const findings = [
      mkFinding("slots", "color", 5, "--slot-fill", "#111111"),
      mkFinding("chips", "size", 2, "--slot-fill", "#222222"),
    ];
    const winners = resolveTokenWinners(findings);
    expect(winners.get("--slot-fill").fix.to).toBe("#111111");
    expect(winners.get("--slot-fill").severity).toBe(5);
  });

  it("lader højeste severity vinde uanset rækkefølge (stigende også)", () => {
    const findings = [
      mkFinding("chips", "size", 2, "--slot-fill", "#222222"),
      mkFinding("slots", "color", 5, "--slot-fill", "#111111"),
    ];
    expect(resolveTokenWinners(findings).get("--slot-fill").fix.to).toBe("#111111");
  });

  it("lader det først behandlede fund vinde ved uafgjort severity", () => {
    const findings = [
      mkFinding("slots", "color", 3, "--slot-fill", "#111111"),
      mkFinding("chips", "size", 3, "--slot-fill", "#222222"),
    ];
    expect(resolveTokenWinners(findings).get("--slot-fill").fix.to).toBe("#111111");
  });
});

describe("consolidateTokens (TASK-021)", () => {
  it("samler samme token foreslået fra to regioner til ét fund med højeste severity", () => {
    const findings = [
      mkFinding("slots", "color", 5, "--slot-fill", "#111111"),
      mkFinding("chips", "size", 2, "--slot-fill", "#222222"),
    ];
    const out = consolidateTokens(findings);
    expect(out).toHaveLength(1);
    expect(out[0].fix.to).toBe("#111111");
    expect(out[0].severity).toBe(5);
    expect(out[0].consolidatedFrom).toEqual(
      expect.arrayContaining(["slots:color:--slot-fill", "chips:size:--slot-fill"]),
    );
  });

  it("lader fund for forskellige tokens stå urørt, hver for sig", () => {
    const findings = [
      mkFinding("slots", "color", 4, "--slot-fill", "#111111"),
      mkFinding("chips", "size", 3, "--chip-cold", "#333333"),
    ];
    const out = consolidateTokens(findings);
    expect(out).toHaveLength(2);
    expect(out.every((f: any) => f.consolidatedFrom === undefined)).toBe(true);
  });
});

describe("rejectedKeys / route — afvist hukommelse på tværs af regioner (defekt 4)", () => {
  it("flader en konsolideret journalposts key OG consolidatedFrom ud", () => {
    const ledger = {
      rejected: [
        { key: "slots:color:--slot-fill", consolidatedFrom: ["slots:color:--slot-fill", "chips:size:--slot-fill"] },
      ],
    };
    const keys = rejectedKeys(ledger);
    expect(keys.has("slots:color:--slot-fill")).toBe(true);
    expect(keys.has("chips:size:--slot-fill")).toBe(true);
  });

  it("springer en tabende regions forslag over, selvom kun VINDERENS nøgle står som .key", () => {
    // Reproducerer defekt 4 nøjagtigt: accept-porten afviste sidst en
    // konsolideret rettelse, hvor `slots` vandt (severity 5) og `chips` tabte
    // — journalen husker kun vinderens nøgle i .key, mens taberens nøgle kun
    // findes i .consolidatedFrom. Den gamle route() byggede sit afvist-sæt
    // udelukkende af `.key` og ville derfor IKKE genkende `chips`' identiske
    // forslag som allerede afvist — det ville dukke op i out.tokens igen,
    // hver eneste iteration, i stedet for i out.skipped.
    const ledger = {
      rejected: [
        { key: "slots:color:--slot-fill", consolidatedFrom: ["slots:color:--slot-fill", "chips:size:--slot-fill"] },
      ],
    };
    const findings = [mkFinding("chips", "size", 2, "--slot-fill", "#222222")];
    const out = route(findings, ledger);
    expect(out.tokens).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].key).toBe("chips:size:--slot-fill");
    expect(out.skipped[0].why).toMatch(/tidligere afvist/);
  });

  it("ruter uændret et fund, hvis nøgle IKKE optræder i nogen afvist post", () => {
    const ledger = { rejected: [{ key: "slots:color:--slot-fill", consolidatedFrom: ["slots:color:--slot-fill"] }] };
    const findings = [mkFinding("chips", "size", 2, "--chip-cold", "#333333")];
    const out = route(findings, ledger);
    expect(out.tokens).toHaveLength(1);
    expect(out.skipped).toHaveLength(0);
  });
});
