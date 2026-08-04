import { describe, expect, it } from "vitest";
import { findCombo, indexCombos } from "./combine";
import type { Combo } from "./types";

const combo = (overrides: Partial<Combo>): Combo => ({
  element_a: "sten",
  element_b: "sten",
  resultat: "gnist",
  flavor: "",
  historisk_note: "",
  kilde_url: "",
  narrator_replik: null,
  flags_sat: [],
  flags_kraevet: [],
  loeser_problem: null,
  akt: 1,
  age_up: false,
  ...overrides,
});

describe("findCombo", () => {
  it("finder en kombination uanset rækkefølge", () => {
    const index = indexCombos([combo({ element_a: "ild", element_b: "pind", resultat: "baal" })]);
    expect(findCombo(index, "pind", "ild", {})?.resultat).toBe("baal");
    expect(findCombo(index, "ild", "pind", {})?.resultat).toBe("baal");
  });

  it("tillader element + sig selv", () => {
    const index = indexCombos([combo({})]);
    expect(findCombo(index, "sten", "sten", {})?.resultat).toBe("gnist");
  });

  it("returnerer null for ukendt kombination", () => {
    const index = indexCombos([combo({})]);
    expect(findCombo(index, "sten", "pind", {})).toBeNull();
  });

  it("respekterer flags_kraevet", () => {
    const index = indexCombos([
      combo({ element_a: "ild", element_b: "pind", resultat: "baal", flags_kraevet: ["har_ild"] }),
    ]);
    expect(findCombo(index, "ild", "pind", {})).toBeNull();
    expect(findCombo(index, "ild", "pind", { har_ild: true })?.resultat).toBe("baal");
  });
});
