import { Engine } from "../src/core/engine";
import { Narrator } from "../src/narrator/narrator";
import type { ContentBundle, NarratorContentDef } from "../src/core/types";

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

/** En replik fortælleren rent faktisk sagde som svar på en fejlet fusion. */
export interface FailureLine {
  id: string;
  text: string;
}

/**
 * Er dette replik-id ét af fiaskokædens egne fire led (bagt → live →
 * grammatik → generisk)? `react()` tjekker adfærd (pauser, spam, streaks,
 * tempo) og hint-eskalering FØR kæden, og de kan begge nå at svare på en
 * `nofuse`-tur uden at kæden overhovedet blev spurgt (se prioritetskommentarerne
 * i `Narrator.react()`, trin 1b/2 vs. 4-7). De replikker hører til deres egne,
 * allerede afprøvede regelsæt (fx `failStreak`, der med vilje må gentage sig
 * når streak-betingelsen opstår igen) og skal ikke tælles med i fiaskokædens
 * eget gentagelses-loft — ellers måler testen en helt anden mekanisme under
 * fiaskokædens navn.
 */
function isFailureChainLine(act: NarratorContentDef, id: string): boolean {
  if (id.startsWith("pair-") || id.startsWith("live:")) return true;
  if (act.genericFailure.includes(id)) return true;
  for (const pool of Object.values(act.grammar ?? {})) {
    if (pool.includes(id)) return true;
  }
  return false;
}

/**
 * Spiller ét helt run blindt igennem og fanger hver eneste replik fra selve
 * fiaskokæden — bagt → live → grammatik → generisk
 * (plan/architecture-procedural-narration-1.md). Adfærd, hint-eskalering og
 * flag-hukommelse kan alle nå at svare på en fejlet fusion først (de ligger
 * højere i `react()`s prioritet, jf. `isFailureChainLine`), og holdes derfor
 * bevidst uden for opsamlingen. Delt af `tests/grammar.test.ts` og
 * `tests/narrator-regression.test.ts` (TASK-031/TEST-007), så de to tests
 * måler nøjagtig samme kæde i stedet for at holde to udgaver af den samme
 * simulering i sync i hånden.
 *
 * `page` går til 200 som en sikkerhedsgrænse, ikke et løfte om 200 forsøg —
 * runnet stopper for det meste omkring `config.turnLimit` (50), fordi
 * `e.getState().ended` bliver sat der.
 */
export function playAndCollectFailures(content: ContentBundle, seed: number): FailureLine[] {
  const act = content.narrator.find((n) => n.act === 1)!;
  const e = new Engine(content);
  const n = new Narrator(e);
  const said: FailureLine[] = [];
  for (let page = 1; page <= 200; page++) {
    if (e.getState().ended) break;
    const pool = e.getState().discovered;
    const a = pool[(page * 7 + seed) % pool.length]!;
    const b = pool[(page * 13 + seed * 3) % pool.length]!;
    const out = e.combine(a, b);
    const line = n.react(a, b, out, 4000);
    if (out.kind === "nofuse" && line && isFailureChainLine(act, line.id)) {
      said.push({ id: line.id, text: line.text });
    }
  }
  return said;
}
