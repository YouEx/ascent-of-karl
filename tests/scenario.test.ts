import { describe, expect, it } from "vitest";
import { SCENARIOS, scenarioTimelineOpen } from "../src/ui/scenario-config";

describe("act1-opening matcher referencebilledets faktiske tilstand", () => {
  const opening = SCENARIOS["act1-opening"];

  it("viser de elleve elementer referencebilledet er malet med", () => {
    expect(opening.discovered).toEqual([
      "sten",
      "pind",
      "graes",
      "vand",
      "ler",
      "baer",
      "larver",
      "dyr",
      "stamme",
      "nabo",
      "fugl",
    ]);
  });

  it("viser kun de tre behov og den ene søgehandling referencebilledet har", () => {
    expect(opening.visibleProblemIds).toEqual(["kulde", "vaerktoej", "sult"]);
    expect(opening.hiddenSelectors).toEqual(["#filter-done"]);
  });

  it("pinner referencebilledets historiske tidslinjetekst", () => {
    expect(opening.timelineLabel).toBe("0/174");
    expect(opening.blankChronicle).toBe(true);
  });

  it("kan ikke åbne en levende graf under den tomme scenariekrønike", () => {
    expect(scenarioTimelineOpen(true, opening)).toBe(false);
  });
});
