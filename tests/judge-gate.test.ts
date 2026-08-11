// Accept-porten er det eneste, der står mellem en automatisk sløjfe og en
// langsomt forværret brugerflade. Den fortjener rigtige tests, ikke et
// engangsscript i /tmp.
//
// Den prøve, der betyder mest, er nr. 2: en ændring, der hæver den samlede
// score ved at ofre én region, SKAL afvises. Uden den regel ser regnskabet
// ud som fremskridt, mens skærmen bliver værre at se på.
import { describe, expect, it } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration; kontrakten testes her.
import { acceptGate } from "../tools/judge/apply.mjs";

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
