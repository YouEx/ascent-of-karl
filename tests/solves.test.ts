/**
 * Paritet mellem de to implementeringer af samme regel.
 *
 * satisfies() findes to gange: i tools/predicate_report.py (facit, bruges af
 * porten og af CI) og i src/core/solves.ts (spillet). To implementeringer
 * skrider fra hinanden, og skreddet ville være tavst — porten ville sige 0
 * fejl mens spillet dømte anderledes.
 *
 * Fiksturen er aftrykket af Python-siden. Regenerer med:
 *   npm run predicates:fixture
 */

import { describe, expect, it } from "vitest";
import elements from "../content/elements.json";
import predicatesRaw from "../content/predicates.json";
import fixture from "./fixtures/solves-parity.json";
import { satisfies, solvedNeeds, solvesNeed } from "../src/core/solves";
import type { ElementDef, SolvePredicate } from "../src/core/types";

const els = elements as unknown as ElementDef[];

/** Kommentarnøgler (_kommentar, _udledt_af …) er dokumentation, ikke prædikater. */
const predicates = Object.fromEntries(
  Object.entries(predicatesRaw as Record<string, unknown>).filter(
    ([key]) => !key.startsWith("_"),
  ),
) as Record<string, SolvePredicate>;

describe("solves — paritet med Python-siden", () => {
  it("dømmer hvert element præcis som tools/predicate_report.py", () => {
    const expected = fixture.solves as Record<string, string[]>;
    const afvigelser: string[] = [];

    for (const el of els) {
      const ts = solvedNeeds(el, predicates).slice().sort();
      const py = (expected[el.id] ?? []).slice().sort();
      if (JSON.stringify(ts) !== JSON.stringify(py)) {
        afvigelser.push(`${el.id}: TS=[${ts.join(",")}] Python=[${py.join(",")}]`);
      }
    }

    expect(afvigelser).toEqual([]);
  });

  it("dækker alle elementer — fiksturen må ikke være forældet", () => {
    const expected = fixture.solves as Record<string, string[]>;
    expect(Object.keys(expected).sort()).toEqual(els.map((e) => e.id).sort());
  });

  it("kender de samme nøder som prædikatfilen", () => {
    expect(fixture.needs.slice().sort()).toEqual(Object.keys(predicates).sort());
  });
});

describe("solves — reglerne selv", () => {
  const find = (id: string) => els.find((e) => e.id === id)!;

  it("lader ingen base-elementer løse noget — nøden kan ikke løses i tur 1", () => {
    for (const el of els.filter((e) => e.base)) {
      expect(solvedNeeds(el, predicates), `${el.id} løser noget i tur 1`).toEqual([]);
    }
  });

  it("kræver at ALLE traits i ét prædikat er til stede", () => {
    const el = find("hytte");
    expect(satisfies(el, { traits: ["insulating"] })).toBe(true);
    expect(satisfies(el, { traits: ["insulating", "floats"] })).toBe(false);
  });

  it("anyOf er nok med én gren", () => {
    const el = find("hytte");
    expect(satisfies(el, { anyOf: [{ traits: ["floats"] }, { traits: ["insulating"] }] })).toBe(
      true,
    );
    expect(satisfies(el, { anyOf: [{ traits: ["floats"] }, { traits: ["edible"] }] })).toBe(false);
  });

  it("not vender dommen", () => {
    const el = find("hytte");
    expect(satisfies(el, { not: { traits: ["floats"] } })).toBe(true);
    expect(satisfies(el, { not: { traits: ["insulating"] } })).toBe(false);
  });

  it("et tomt prædikat passer på alt — grænsetilfældet skal være kendt", () => {
    expect(satisfies(find("sten"), {})).toBe(true);
  });

  it("ukendt nød giver false frem for at kaste", () => {
    expect(solvesNeed(find("hytte"), "findes-ikke", predicates)).toBe(false);
  });

  it("holder de menneskeskrevne løsninger i hævd", () => {
    // Stikprøver fra challenges.json og combos.json — skrevet i hånden længe
    // før taksonomien fandtes.
    expect(solvesNeed(find("hytte"), "kulde", predicates)).toBe(true);
    expect(solvesNeed(find("stenoekse"), "vaerktoej", predicates)).toBe(true);
    expect(solvesNeed(find("medicin"), "sygdom", predicates)).toBe(true);
    expect(solvesNeed(find("faelde"), "ulve", predicates)).toBe(true);
  });

  it("lader de komiske løsninger tælle", () => {
    // Mudderkage og klyngen er beviset på at idéen allerede fandtes i
    // indholdet, før den blev til et system.
    expect(solvesNeed(find("mudderkage"), "sult", predicates)).toBe(true);
    expect(solvesNeed(find("klyngen"), "kulde", predicates)).toBe(true);
  });
});
