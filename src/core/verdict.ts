/**
 * Dommen: hvorfor to ting ikke blev til noget.
 *
 * Før svarede motoren `{ kind: "nothing" }` — en boolean uden hukommelse, der
 * ikke engang bar hvilke to elementer spilleren havde prøvet. Fortælleren
 * kunne derfor kun sige noget generisk, og otte generiske replikker delt ud
 * over ~40 fiaskoer pr. gennemspilning blev til "nothing happens".
 *
 * judgePair er ren og deterministisk: ingen tilfældighed, ingen tekst, ingen
 * afhængighed af fortælleren. Den siger kun HVORFOR, og lægger beviset frem.
 * Hvad man så gør med det — en vits, et hint, en stemme — er et andet lags
 * arbejde (src/narrator/grammar.ts).
 *
 * Rækkefølgen er prioriteret og første match vinder. Den er sorteret efter
 * hvor meget dommen fortæller spilleren: `locked` og `near-miss` er hints,
 * resten er farve.
 */

import type {
  ComboDef,
  ElementDef,
  ElementTrait,
  Verdict,
  VerdictEvidence,
} from "./types";

/** Hvad judgePair skal kunne spørge om. Holder klassifikatoren fri af Engine. */
export interface VerdictWorld {
  /** Er elementet opdaget? */
  isDiscovered(id: string): boolean;
  /** Alle opskrifter for parret — også de flag-spærrede. */
  allCombosFor(a: string, b: string): ComboDef[];
  /** Hvilke flag mangler/spærrer for opskriften? */
  flagObstacles(combo: ComboDef): { missing: string[]; blocking: string[] };
  /** Hvilke opskrifter indgår elementet i overhovedet? */
  combosWith(id: string): ComboDef[];
  /** Slå element op — dommen skal kunne sammenligne tags på den rigtige partner. */
  element(id: string): ElementDef | undefined;
}

export interface Judgment {
  verdict: Verdict;
  evidence: VerdictEvidence;
}

/**
 * Trækpar der bider hinanden. Rækkefølgen i parret er ligegyldig; listen
 * læses begge veje. Holdt kort med vilje — en `clash` skal være åbenlys nok
 * til at spilleren selv griner, ellers er den bare en afvisning med attitude.
 */
const CLASHES: [ElementTrait, ElementTrait][] = [
  ["hot", "wet"],
  ["hot", "cold"],
  ["wet", "dry"],
  ["alive", "dead"],
  ["fragile", "heavy"],
  ["sharp", "soft"],
];

/** stuff-værdier der ikke tæller som fællesskab — "ingen af delene" er ikke et bånd. */
const NO_SHARED_STUFF = new Set(["none"]);

/** kind-værdier der ikke kan røres. Afstanden til dem er stor pr. definition. */
const INTANGIBLE = new Set(["abstract", "phenomenon"]);

const SCALE_ORDER = ["hand", "body", "camp", "landscape"];

export function judgePair(
  world: VerdictWorld,
  a: ElementDef,
  b: ElementDef,
): Judgment {
  // 1. locked — opskriften findes, men er spærret. Dette er det eneste sted
  //    hvor spilleren gjorde noget der ER rigtigt, og skal aldrig forveksles
  //    med vrøvl (REQ-004).
  const combos = world.allCombosFor(a.id, b.id);
  if (combos.length > 0) {
    // Vælg den mindst spærrede — den spilleren er tættest på.
    let best: { combo: ComboDef; missing: string[]; blocking: string[] } | null = null;
    for (const combo of combos) {
      const obs = world.flagObstacles(combo);
      const cost = obs.missing.length + obs.blocking.length;
      if (!best || cost < best.missing.length + best.blocking.length) {
        best = { combo, ...obs };
      }
    }
    if (best && (best.missing.length > 0 || best.blocking.length > 0)) {
      return {
        verdict: "locked",
        evidence: {
          missingFlags: best.missing.length ? best.missing : undefined,
          blockingFlags: best.blocking.length ? best.blocking : undefined,
        },
      };
    }
    // Findes og er åben: så var det ikke et fiasko-par, og judgePair er kaldt
    // forkert. Vi dømmer alligevel, i stedet for at kaste — motoren skal ikke
    // kunne vælte af en dom.
  }

  // 2. self — a + a. Kommer før near-miss, fordi "du prøvede at gnide en sten
  //    mod sig selv" er en bedre vits end "sten hører sammen med noget andet".
  if (a.id === b.id) {
    return { verdict: "self", evidence: {} };
  }

  // 3. near-miss — ét af elementerne hører sammen med noget spilleren allerede
  //    har. Den mest værdifulde dom: både komisk og den eneste ærlige kilde
  //    til et hint, fordi partneren beviseligt findes i opskriftsbogen.
  const near = findNearMiss(world, a, b) ?? findNearMiss(world, b, a);
  if (near) return near;

  // 4. inert — elementet indgår i ingen opskrift overhovedet. Spillets
  //    blindgyder. Fortælleren må gerne være ærlig om dem.
  const deadEnds = [a, b].filter((e) => world.combosWith(e.id).length === 0);
  if (deadEnds.length > 0) {
    return { verdict: "inert", evidence: { deadEnds: deadEnds.map((e) => e.id) } };
  }

  // 5. clash — taggene bider hinanden.
  const clash = findClash(a, b);
  if (clash) return { verdict: "clash", evidence: { clashing: clash } };

  // 6/7. plausible eller absurd — default-parret. Alt der ikke faldt i en
  //      tidligere dom er ét af de to.
  const shared = findShared(a, b);
  if (shared) return { verdict: "plausible", evidence: { shared } };
  return { verdict: "absurd", evidence: {} };
}

/**
 * Hører `one` sammen med noget spilleren allerede har opdaget — og lignede
 * `other` det, spilleren skulle have brugt?
 *
 * Det andet krav er det vigtige. Uden det bliver næsten alt til en near-miss:
 * med en stor hånd har hvert element en eller anden opdaget partner, og målt
 * gennem motoren slugte dommen 87,7 % af alle fiaskoer. Så ville fortælleren
 * være en hint-automat, og opskriftsbogen ville være foræret væk.
 *
 * "Tæt på" betyder at spilleren havde den rigtige idé og det forkerte
 * eksemplar: træ, ja — men en pind, ikke græs. Derfor skal `other` dele
 * materiale, art eller et træk med den rigtige partner. Det giver også
 * fortælleren noget at pege på: ligheden er selve vitsen.
 */
function findNearMiss(
  world: VerdictWorld,
  one: ElementDef,
  other: ElementDef,
): Judgment | null {
  let best: { j: Judgment; score: number } | null = null;
  for (const combo of world.combosWith(one.id)) {
    const partnerId = combo.pair[0] === one.id ? combo.pair[1] : combo.pair[0];
    if (partnerId === other.id) continue;
    if (!world.isDiscovered(partnerId)) continue;
    // En opskrift spilleren allerede har brugt er ikke et hint værd.
    if (world.isDiscovered(combo.result)) continue;
    const obs = world.flagObstacles(combo);
    if (obs.missing.length > 0 || obs.blocking.length > 0) continue;
    const partner = world.element(partnerId);
    if (!partner) continue;
    const likeness = resembles(other, partner);
    if (!likeness) continue;
    // Flere opskrifter kan kvalificere. Vælg den nærmeste, ikke den første i
    // filen — ellers afhænger hintet af indholdets rækkefølge.
    const score = likenessScore(other, partner);
    if (!best || score > best.score) {
      best = {
        score,
        j: {
          verdict: "near-miss",
          evidence: {
            rightOne: one.id,
            partner: partnerId,
            partnerResult: combo.result,
            shared: likeness,
          },
        },
      };
    }
  }
  return best?.j ?? null;
}

/** Hvor tæt på er de? Højere er tættere. Kun til at vælge mellem kandidater. */
function likenessScore(a: ElementDef, b: ElementDef): number {
  let n = 0;
  if (a.stuff === b.stuff) n += 4;
  if (a.kind === b.kind) n += 2;
  if (a.scale === b.scale) n += 1;
  n += a.traits.filter((t) => b.traits.includes(t)).length;
  return n;
}

/** Hvad ligner de to hinanden på? Null hvis de ikke gør. */
function resembles(a: ElementDef, b: ElementDef): string | null {
  if (a.stuff === b.stuff && !NO_SHARED_STUFF.has(a.stuff)) return a.stuff;
  return null;
}

function findClash(a: ElementDef, b: ElementDef): [string, string] | null {
  for (const [x, y] of CLASHES) {
    if (a.traits.includes(x) && b.traits.includes(y)) return [x, y];
    if (a.traits.includes(y) && b.traits.includes(x)) return [y, x];
  }
  // Levende + skarpt uden at være mad er ikke en clash, men et drab — det
  // hører til i opskrifterne, ikke i afvisningerne. Derfor kun listen ovenfor.
  return null;
}

/**
 * Har de to noget til fælles der gør forsøget rimeligt? Det er her "godt
 * tænkt, bare ikke skrevet" bliver skilt fra "hvad tænkte du på".
 */
function findShared(a: ElementDef, b: ElementDef): string | null {
  if (a.stuff === b.stuff && !NO_SHARED_STUFF.has(a.stuff)) return a.stuff;
  if (isToolAndMaterial(a, b) || isToolAndMaterial(b, a)) return "tool+material";
  if (isFireAndFood(a, b) || isFireAndFood(b, a)) return "fire+food";
  if (a.kind === b.kind && !INTANGIBLE.has(a.kind)) return a.kind;
  // Samme størrelse alene er for tyndt til at hedde et fællesskab, men to
  // ting på samme skala i hånden er stadig mere rimeligt end en sten og en
  // landsby. Kræver at de deler mindst ét træk.
  if (a.scale === b.scale && a.traits.some((t) => b.traits.includes(t))) {
    return a.traits.find((t) => b.traits.includes(t))!;
  }
  return null;
}

function isToolAndMaterial(tool: ElementDef, mat: ElementDef): boolean {
  return tool.kind === "tool" && mat.kind === "material";
}

function isFireAndFood(fire: ElementDef, food: ElementDef): boolean {
  return fire.traits.includes("hot") && food.traits.includes("edible");
}

/** Hvor langt fra hinanden ligger de to på skalaen? Bruges af rapporten. */
export function scaleDistance(a: ElementDef, b: ElementDef): number {
  return Math.abs(SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale));
}
