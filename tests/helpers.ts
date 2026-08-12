import type { Engine } from "../src/core/engine";

/**
 * De fem levende ting skal fortjenes, ikke uddeles.
 *
 * Karl starter med seks ting han kan samle op fra jorden. Alt der bevæger sig
 * — træstammen, larverne, fuglen, vildsvinet og naboen — skal fremkaldes.
 * Testene skal derfor gå den samme vej som spilleren, og det er med vilje:
 * går kæden i stykker, skal en test mærke det før en spiller gør.
 */
const CHAINS: Record<string, [string, string][]> = {
  saft: [["baer", "vand"]],
  froe: [["baer", "baer"]],
  mudder: [["ler", "vand"]],
  stenoekse: [["sten", "pind"]],
  gnister: [["sten", "sten"]],
  ild: [["sten", "sten"], ["gnister", "graes"]],
  roeg: [["sten", "sten"], ["gnister", "graes"], ["ild", "graes"]],
  larver: [["baer", "vand"], ["graes", "saft"]],
  fugl: [["baer", "baer"], ["froe", "graes"]],
  stamme: [["sten", "pind"], ["baer", "baer"], ["froe", "stenoekse"]],
  dyr: [["ler", "vand"], ["baer", "vand"], ["graes", "saft"], ["larver", "mudder"]],
  tromme: [["sten", "pind"], ["baer", "baer"], ["froe", "stenoekse"], ["stamme", "pind"]],
  nabo: [
    ["sten", "sten"], ["gnister", "graes"], ["ild", "graes"],
    ["sten", "pind"], ["baer", "baer"], ["froe", "stenoekse"],
    ["stamme", "pind"], ["roeg", "tromme"],
  ],
};

/**
 * Spil den korteste vej frem til et element, og spring de trin over der
 * allerede er taget. Kan kaldes for flere mål i træk uden at dublere arbejde.
 */
export function earn(e: Engine, ...targets: string[]): void {
  const has = (id: string) => e.availableElements().some((el) => el.id === id);
  for (const target of targets) {
    if (has(target)) continue;
    for (const [a, b] of CHAINS[target] ?? []) {
      if (has(a) && has(b)) e.combine(a, b);
    }
  }
}
