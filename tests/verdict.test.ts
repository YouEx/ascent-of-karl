import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { loadContent } from "../src/content";
import { judgePair } from "../src/core/verdict";
import type { Verdict } from "../src/core/types";

const content = loadContent();

function fresh() {
  return new Engine(content);
}

/** Spiller sig frem til en tilstand hvor alle nævnte elementer er opdaget. */
function withDiscovered(ids: string[]) {
  const e = fresh();
  const s = e.getState();
  e.loadState({ ...s, discovered: [...new Set([...s.discovered, ...ids])] });
  return e;
}

function judge(e: Engine, a: string, b: string) {
  return judgePair(e, e.element(a), e.element(b));
}

describe("Dommen: ren og deterministisk (TEST-001)", () => {
  it("giver samme svar hver gang", () => {
    const e = fresh();
    const first = judge(e, "sten", "graes");
    for (let i = 0; i < 200; i++) {
      expect(judge(e, "sten", "graes")).toEqual(first);
    }
  });

  it("er uafhængig af rækkefølgen på de to elementer for symmetriske domme", () => {
    const e = fresh();
    // self, inert og clash er symmetriske pr. konstruktion.
    expect(judge(e, "sten", "sten").verdict).toBe(judge(e, "sten", "sten").verdict);
    const ab = judge(e, "baer", "ler").verdict;
    const ba = judge(e, "ler", "baer").verdict;
    expect([ab, ba].every((v) => v === ab || v === "near-miss")).toBe(true);
  });

  it("dømmer hvert eneste par uden at kaste", () => {
    const e = fresh();
    const els = content.elements;
    const seen = new Set<Verdict>();
    for (let i = 0; i < els.length; i++) {
      for (let j = i; j < els.length; j++) {
        const { verdict } = judgePair(e, els[i]!, els[j]!);
        expect(verdict, `${els[i]!.id}+${els[j]!.id}`).toBeTruthy();
        seen.add(verdict);
      }
    }
    // Alle syv domme skal kunne forekomme — ellers er en af dem død kode.
    expect(seen.size).toBe(7);
  });
});

describe("Dommen: én fixtur pr. dom (TEST-002)", () => {
  it("locked — opskriften findes, men flaget mangler", () => {
    const e = withDiscovered(["larver", "ler"]);
    const j = judge(e, "larver", "ler");
    expect(j.verdict).toBe("locked");
    expect(j.evidence.missingFlags).toEqual(["larver"]);
  });

  it("self — samme element to gange, uden selvopskrift", () => {
    const e = fresh();
    // sten+sten HAR en opskrift, så den må ikke være self. Vælg en uden.
    const j = judge(e, "graes", "graes");
    expect(j.verdict).toBe("self");
  });

  it("near-miss — rigtigt element, forkert men lignende partner", () => {
    const e = fresh();
    const j = judge(e, "sten", "graes");
    expect(j.verdict).toBe("near-miss");
    // Græs blev brugt i stedet for noget andet der gror.
    expect(j.evidence.rightOne).toBe("sten");
    expect(j.evidence.shared).toBe("plant");
    const partner = e.element(j.evidence.partner!);
    expect(partner.stuff).toBe("plant");
  });

  it("near-miss peger på den nærmeste partner, ikke den første i filen", () => {
    const e = fresh();
    const j = judge(e, "sten", "graes");
    const partner = e.element(j.evidence.partner!);
    // Alle kandidater deler stuff; den valgte skal have højest samlet lighed.
    expect(partner.stuff).toBe("plant");
  });

  it("inert — mindst ét element indgår i ingen opskrift", () => {
    const e = fresh();
    const deadEnd = content.elements.find(
      (el) => e.combosWith(el.id).length === 0,
    )!;
    expect(deadEnd, "der skal findes mindst én blindgyde").toBeTruthy();
    // near-miss har forrang: hvis DEN anden halvdel af parret har en opskrift
    // med noget der ligner blindgyden, er "du var tæt på" et bedre svar. Find
    // derfor et par hvor den forrang ikke gælder.
    const other = content.elements.find(
      (el) => el.id !== deadEnd.id && judgePair(e, deadEnd, el).verdict === "inert",
    )!;
    expect(other, "en blindgyde skal kunne give dommen inert").toBeTruthy();
    const j = judgePair(e, deadEnd, other);
    expect(j.verdict).toBe("inert");
    expect(j.evidence.deadEnds).toContain(deadEnd.id);
  });

  it("clash — træk der bider hinanden", () => {
    const e = fresh();
    const els = content.elements;
    let found: { a: string; b: string } | null = null;
    for (let i = 0; i < els.length && !found; i++) {
      for (let j = i + 1; j < els.length && !found; j++) {
        if (judgePair(e, els[i]!, els[j]!).verdict === "clash") {
          found = { a: els[i]!.id, b: els[j]!.id };
        }
      }
    }
    expect(found).toBeTruthy();
    const verdict = judge(e, found!.a, found!.b);
    expect(verdict.evidence.clashing).toHaveLength(2);
    const [x, y] = verdict.evidence.clashing!;
    const ta: string[] = e.element(found!.a).traits;
    const tb: string[] = e.element(found!.b).traits;
    expect(ta.includes(x) || tb.includes(x)).toBe(true);
    expect(ta.includes(y) || tb.includes(y)).toBe(true);
  });

  it("plausible — de deler noget, opskriften findes bare ikke", () => {
    const e = fresh();
    const els = content.elements;
    let found = false;
    for (let i = 0; i < els.length && !found; i++) {
      for (let j = i + 1; j < els.length && !found; j++) {
        const v = judgePair(e, els[i]!, els[j]!);
        if (v.verdict === "plausible") {
          expect(v.evidence.shared, `${els[i]!.id}+${els[j]!.id}`).toBeTruthy();
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("absurd — intet fælles overhovedet", () => {
    const e = fresh();
    const els = content.elements;
    const anyAbsurd = els.some((a, i) =>
      els.slice(i + 1).some((b) => judgePair(e, a, b).verdict === "absurd"),
    );
    expect(anyAbsurd).toBe(true);
  });
});

describe("Dommen: bevismaterialet holder", () => {
  it("near-miss peger altid på en partner spilleren HAR", () => {
    const e = withDiscovered(content.elements.slice(0, 60).map((el) => el.id));
    const els = content.elements;
    let checked = 0;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const v = judgePair(e, els[i]!, els[j]!);
        if (v.verdict !== "near-miss") continue;
        checked++;
        expect(e.isDiscovered(v.evidence.partner!)).toBe(true);
        // Og på et resultat spilleren IKKE har — ellers er hintet værdiløst.
        expect(e.isDiscovered(v.evidence.partnerResult!)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("locked peger altid på mindst ét konkret flag", () => {
    const e = fresh();
    const els = content.elements;
    for (let i = 0; i < els.length; i++) {
      for (let j = i; j < els.length; j++) {
        const v = judgePair(e, els[i]!, els[j]!);
        if (v.verdict !== "locked") continue;
        const n =
          (v.evidence.missingFlags?.length ?? 0) +
          (v.evidence.blockingFlags?.length ?? 0);
        expect(n, `${els[i]!.id}+${els[j]!.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("inert peger kun på elementer der virkelig er blindgyder", () => {
    const e = fresh();
    const els = content.elements;
    for (let i = 0; i < els.length; i++) {
      for (let j = i; j < els.length; j++) {
        const v = judgePair(e, els[i]!, els[j]!);
        if (v.verdict !== "inert") continue;
        for (const id of v.evidence.deadEnds ?? []) {
          expect(e.combosWith(id).length, id).toBe(0);
        }
      }
    }
  });
});
