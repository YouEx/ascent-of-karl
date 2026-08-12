// Accept-porten er det eneste, der står mellem en automatisk sløjfe og en
// langsomt forværret brugerflade. Den fortjener rigtige tests, ikke et
// engangsscript i /tmp.
//
// Den prøve, der betyder mest, er nr. 2: en ændring, der hæver den samlede
// score ved at ofre én region, SKAL afvises. Uden den regel ser regnskabet
// ud som fremskridt, mens skærmen bliver værre at se på.
import { describe, expect, it } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration; kontrakten testes her.
import { acceptGate, consolidateTokens, rejectedKeys, resolveTokenWinners, route } from "../tools/judge/apply.mjs";

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
