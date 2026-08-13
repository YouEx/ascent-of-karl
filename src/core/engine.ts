import {
  freshChallengeState,
  resolves,
  rollChallenge,
} from "./challenge";
import type { ActiveChallenge, ChallengeState } from "./challenge";
import {
  buildFallbackElement,
  IMPROVISE_RUN_CAP,
  IMPROVISE_SUMMER_COST,
  improvisedElementId,
  MAX_IMPROVISED_DEPTH,
  sanitizeImprovisedElement,
  validateImproviseCopy,
  withImprovisedCopy,
} from "./improvise";
import type { ImproviseCopy } from "./improvise";
import { explainSatisfaction, solvesNeed } from "./solves";
import { judgePair } from "./verdict";
import type {
  ActDef,
  ChallengeDef,
  ChallengeEvent,
  CombineOutcome,
  ComboDef,
  ContentBundle,
  ElementDef,
  EndingDef,
  NeedExplanations,
  ProblemDef,
  SolvePredicate,
} from "./types";

/** Serialiserbar spiltilstand — hele save-formatet (PRD §4.1: save pr. opdagelse). */
export interface GameState {
  act: number;
  discovered: string[];
  flags: string[];
  solvedProblems: string[];
  /** Forbrugte somre (kombinationsforsøg + ekstra cost på dybe opdagelser) */
  attempts: number;
  /** Slutningens id når Karls liv/historie er forbi — null mens der spilles */
  ended: string | null;
  /** Challenges: aktivt challenge, mellemrum og hvad der er set (docs/design/challenges.md) */
  challenges: ChallengeState;
  /** Run-seed — styrer hvornår challenges spawner og hvad der løser dem */
  seed: number;
  /** Runets improviserede elementregistry. Canon lever fortsat i content. */
  improvisedElements?: ElementDef[];
  /** Improviserede elementer der faktisk løste et problem eller challenge. */
  creditedImprovised?: string[];
}

export type RuntimeGameState = Omit<
  GameState,
  "improvisedElements" | "creditedImprovised"
> & {
  improvisedElements: ElementDef[];
  creditedImprovised: string[];
};

export interface EngineOptions {
  /** Rapportværktøjet kan prøve alternative lofter uden at ændre produkt-default. */
  improvisationRunCap?: number | null;
  /** Pris for et ikke-canonical forsøg; canonical kombinationer beholder combo.cost. */
  improvisationSummerCost?: number;
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("+");
}

/**
 * Kombinationsmotoren. Ren og deterministisk: samme state + samme input → samme resultat.
 * Al tilfældighed og præsentation (fortæller, UI) ligger udenfor.
 */
export class Engine {
  readonly content: ContentBundle;
  private state: RuntimeGameState;
  private elementById = new Map<string, ElementDef>();
  private canonicalElements = new Map<string, ElementDef>();
  private combosByPair = new Map<string, ComboDef[]>();
  private combosByElement = new Map<string, ComboDef[]>();
  private actByNumber = new Map<number, ActDef>();
  private canonicalElementIds = new Set<string>();
  /** Prædikaterne der afgør hvad der løser hvad (content/predicates.json). */
  private predicates: Record<string, SolvePredicate>;
  private readonly improvisationRunCap: number | null;
  private readonly improvisationSummerCost: number;

  constructor(
    content: ContentBundle,
    state?: GameState,
    options: EngineOptions = {},
  ) {
    this.content = content;
    this.predicates = content.predicates;
    this.improvisationRunCap =
      options.improvisationRunCap === undefined
        ? IMPROVISE_RUN_CAP
        : options.improvisationRunCap;
    this.improvisationSummerCost =
      options.improvisationSummerCost ?? IMPROVISE_SUMMER_COST;
    if (
      (this.improvisationRunCap !== null &&
        (!Number.isInteger(this.improvisationRunCap) ||
          this.improvisationRunCap < 0)) ||
      !Number.isInteger(this.improvisationSummerCost) ||
      this.improvisationSummerCost < 0
    ) {
      throw new Error("Ugyldig improvisationsbalance");
    }
    for (const el of content.elements) {
      const canonical = {
        ...el,
        origin: "canon",
        parents: undefined,
      } satisfies ElementDef;
      this.elementById.set(canonical.id, canonical);
      this.canonicalElements.set(canonical.id, canonical);
      this.canonicalElementIds.add(canonical.id);
    }
    for (const combo of content.combos) {
      const key = pairKey(combo.pair[0], combo.pair[1]);
      const list = this.combosByPair.get(key) ?? [];
      list.push(combo);
      this.combosByPair.set(key, list);
    }
    for (const act of content.acts) this.actByNumber.set(act.act, act);
    // Hvilke opskrifter indgår hvert element i? Bruges af dommen til at skelne
    // en blindgyde fra et element der bare manglede den rigtige partner.
    for (const combo of content.combos) {
      for (const id of new Set(combo.pair)) {
        const list = this.combosByElement.get(id) ?? [];
        list.push(combo);
        this.combosByElement.set(id, list);
      }
    }
    this.state = this.freshState();
    if (state) this.loadState(state);
  }

  private freshState(): RuntimeGameState {
    const firstAct = Math.min(...this.content.acts.map((a) => a.act));
    return {
      act: firstAct,
      discovered: this.content.elements
        .filter((e) => e.base && e.act === firstAct)
        .map((e) => e.id),
      flags: [],
      solvedProblems: [],
      attempts: 0,
      ended: null,
      challenges: freshChallengeState(),
      seed: 1,
      improvisedElements: [],
      creditedImprovised: [],
    };
  }

  getState(): RuntimeGameState {
    return structuredClone(this.state);
  }

  loadState(state: GameState): void {
    const s = structuredClone(state);
    const improvisedElements = this.sanitizeImprovisedRegistry(
      s.improvisedElements,
      s.discovered,
    );
    const improvisedIds = new Set(
      improvisedElements.map((element) => element.id),
    );
    const discovered = s.discovered.filter(
      (id) => this.canonicalElementIds.has(id) || improvisedIds.has(id),
    );
    // ended/challenges tilføjet senere — ældre saves mangler felterne
    this.state = {
      ...s,
      discovered,
      ended: s.ended ?? null,
      challenges: s.challenges ?? freshChallengeState(),
      seed: s.seed ?? 1,
      improvisedElements,
      creditedImprovised: [
        ...new Set(
          (Array.isArray(s.creditedImprovised)
            ? s.creditedImprovised
            : []
          ).filter(
            (id): id is string =>
              typeof id === "string" &&
              improvisedIds.has(id) &&
              discovered.includes(id),
          ),
        ),
      ],
    };
    this.syncImprovisedRegistry();
  }

  private sanitizeImprovisedRegistry(
    raw: unknown,
    discovered: string[],
  ): ElementDef[] {
    if (!Array.isArray(raw)) return [];
    const discoveredIds = new Set(discovered);
    const structural: ElementDef[] = [];
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const value of raw) {
      const element = sanitizeImprovisedElement(value);
      if (
        !element ||
        this.canonicalElementIds.has(element.id) ||
        !discoveredIds.has(element.id)
      ) {
        continue;
      }
      if (seen.has(element.id)) {
        duplicates.add(element.id);
      } else {
        seen.add(element.id);
        structural.push(element);
      }
    }

    const pending = new Map(
      structural
        .filter((element) => !duplicates.has(element.id))
        .map((element) => [element.id, element]),
    );
    const accepted = new Map<string, ElementDef>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, element] of pending) {
        const parentA =
          this.canonicalElements.get(element.parents![0]) ??
          accepted.get(element.parents![0]);
        const parentB =
          this.canonicalElements.get(element.parents![1]) ??
          accepted.get(element.parents![1]);
        if (!parentA || !parentB) continue;
        pending.delete(id);
        progressed = true;
        let expected: ElementDef;
        try {
          expected = buildFallbackElement(parentA, parentB);
        } catch {
          continue;
        }
        const taxonomyMatches =
          element.act === expected.act &&
          element.depth === expected.depth &&
          element.kind === expected.kind &&
          element.stuff === expected.stuff &&
          element.scale === expected.scale &&
          element.traits.length === expected.traits.length &&
          element.traits.every(
            (trait, index) => trait === expected.traits[index],
          );
        const copyMatches =
          element.emoji === expected.emoji &&
          ((element.name === expected.name &&
            element.flavor === expected.flavor) ||
            validateImproviseCopy({
              name: element.name,
              flavor: element.flavor,
            }) !== undefined);
        if (taxonomyMatches && copyMatches) {
          accepted.set(id, element);
        }
      }
    }

    return structural.filter((element) => accepted.has(element.id));
  }

  private syncImprovisedRegistry(): void {
    this.elementById = new Map(this.canonicalElements);
    for (const element of this.state.improvisedElements) {
      this.elementById.set(element.id, element);
    }
  }

  element(id: string): ElementDef {
    const el = this.elementById.get(id);
    if (!el) throw new Error(`Ukendt element: ${id}`);
    return el;
  }

  currentAct(): ActDef {
    const act = this.actByNumber.get(this.state.act);
    if (!act) throw new Error(`Ukendt akt: ${this.state.act}`);
    return act;
  }

  /** Elementer spilleren kan se og bruge lige nu */
  availableElements(): ElementDef[] {
    return this.state.discovered.map((id) => this.element(id));
  }

  hasFlag(flag: string): boolean {
    return this.state.flags.includes(flag);
  }

  setFlag(flag: string): void {
    if (!this.state.flags.includes(flag)) this.state.flags.push(flag);
  }

  isDiscovered(id: string): boolean {
    return this.state.discovered.includes(id);
  }

  isSolved(problemId: string): boolean {
    return this.state.solvedProblems.includes(problemId);
  }

  /** Aktens problemer, både de påkrævede og de valgfri. */
  currentActProblems(): ProblemDef[] {
    return this.currentAct().problems;
  }

  unsolvedRequiredProblems(): ProblemDef[] {
    return this.currentAct().problems.filter(
      (p) => p.required && !this.isSolved(p.id),
    );
  }

  /** Slutningen der har afsluttet dette run — null mens der spilles */
  activeEnding(): EndingDef | null {
    if (!this.state.ended) return null;
    return this.content.endings.find((e) => e.id === this.state.ended) ?? null;
  }

  /** Resterende somre af Karls liv */
  remainingTurns(): number {
    return Math.max(0, this.content.config.turnLimit - this.state.attempts);
  }

  /** Nye opfindelser tilbage i dette run. Udledes af det serialiserede registry. */
  improvisationsRemaining(): number {
    if (this.improvisationRunCap === null) return Number.POSITIVE_INFINITY;
    return Math.max(
      0,
      this.improvisationRunCap - this.state.improvisedElements.length,
    );
  }

  /**
   * Må dette par oprette et NYT runtime-element?
   * Genbrug er ikke oprettelse og behøver ingen ny copy-prefetch.
   */
  canCreateImprovisation(a: string, b: string): boolean {
    if (this.matchCombo(a, b)) return false;
    const known = this.elementById.get(improvisedElementId(a, b));
    if (known) return false;
    return this.improvisationsRemaining() > 0;
  }

  /**
   * Antal ting Karl selv har opfundet. Base-elementerne tæller ikke med — de
   * er verden han vågner op i, ikke noget han har udrettet. (Age-up lægger
   * desuden næste akts base-elementer i puljen, som heller ikke er fortjent.)
   */
  inventions(): number {
    const credited = new Set(this.state.creditedImprovised);
    return this.state.discovered.filter((id) => {
      const element = this.element(id);
      if (element.origin === "improvised") return credited.has(id);
      return !element.base;
    }).length;
  }

  /** Er Karl nået langt nok til at hans historie må få en ende? */
  endingsUnlocked(): boolean {
    return this.inventions() >= this.content.config.endingsUnlockAt;
  }

  /**
   * Lader en skæbne-kombination afslutte runnet — men kun når Karl har set nok
   * af verden. Under grænsen returneres `true` som "afværget", så fortælleren
   * kan kommentere. Skæbnen er ikke tabt: kombinationen kan gentages senere.
   */
  private applyEnding(combo: ComboDef): boolean {
    if (!combo.ending) return false;
    if (!this.endingsUnlocked()) return true;
    this.state.ended = combo.ending;
    return false;
  }

  private flagsAllow(combo: ComboDef): boolean {
    const has = (f: string) => this.state.flags.includes(f);
    if (combo.requiresFlags?.some((f) => !has(f))) return false;
    if (combo.blockedByFlags?.some((f) => has(f))) return false;
    return true;
  }

  /** Find den gyldige kombination for et par — mest specifikke (flest flag-krav) vinder. */
  matchCombo(a: string, b: string): ComboDef | undefined {
    const candidates = (this.combosByPair.get(pairKey(a, b)) ?? []).filter(
      (c) => this.flagsAllow(c),
    );
    candidates.sort(
      (x, y) => (y.requiresFlags?.length ?? 0) - (x.requiresFlags?.length ?? 0),
    );
    return candidates[0];
  }

  /**
   * Alle opskrifter for et par — også dem flaggene spærrer.
   *
   * matchCombo smider de spærrede væk, og så svarede spillet det samme til et
   * rigtigt greb der bare ikke var åbnet endnu som til rent vrøvl. Dommen
   * `locked` findes for at skelne (REQ-004), og den skal kunne se dem.
   */
  allCombosFor(a: string, b: string): ComboDef[] {
    return this.combosByPair.get(pairKey(a, b)) ?? [];
  }

  /** Hvilke opskrifter indgår elementet i overhovedet? Tom = blindgyde. */
  combosWith(id: string): ComboDef[] {
    return this.combosByElement.get(id) ?? [];
  }

  /** Hvilke flag mangler, og hvilke spærrer? Tomme lister = opskriften er åben. */
  flagObstacles(combo: ComboDef): { missing: string[]; blocking: string[] } {
    const has = (f: string) => this.state.flags.includes(f);
    return {
      missing: (combo.requiresFlags ?? []).filter((f) => !has(f)),
      blocking: (combo.blockedByFlags ?? []).filter((f) => has(f)),
    };
  }

  /**
   * Kernen i loopet (PRD §2.1): kombinér to elementer.
   * Muterer state ved opdagelser; øvrige udfald ændrer kun turtilstanden.
   */
  combine(a: string, b: string): CombineOutcome {
    this.assertTurnAllowed(a, b);
    this.state.attempts++;
    const outcome = this.resolve(a, b);
    return this.completeTurn(outcome);
  }

  /**
   * Spillerens atomiske forsøg: en åben canonical opskrift vinder altid.
   * Kun tomrummet går videre til den deterministiske improvisation.
   */
  attempt(a: string, b: string, copy?: ImproviseCopy): CombineOutcome {
    this.assertTurnAllowed(a, b);
    if (this.matchCombo(a, b)) {
      this.state.attempts++;
      return this.completeTurn(this.resolve(a, b));
    }
    this.state.attempts += this.improvisationSummerCost;
    return this.completeTurn(this.resolveImprovisation(a, b, copy));
  }

  /**
   * Atomisk improvisation: portvagt, registry, problemløsning og challenge
   * sker i én transition og koster præcis én sommer.
   */
  improvise(a: string, b: string): CombineOutcome {
    this.assertTurnAllowed(a, b);
    this.state.attempts += this.improvisationSummerCost;

    const first = this.element(a);
    const second = this.element(b);
    const canonical = this.matchCombo(a, b);
    if (canonical) {
      return this.completeTurn({
        kind: "improvise-rejected",
        a: first,
        b: second,
        reason: "canonical-recipe",
      });
    }

    return this.completeTurn(this.resolveImprovisation(a, b));
  }

  private resolveImprovisation(
    a: string,
    b: string,
    copy?: ImproviseCopy,
  ): CombineOutcome {
    const first = this.element(a);
    const second = this.element(b);
    const id = improvisedElementId(a, b);
    const known = this.elementById.get(id);
    if (known && known.origin !== "improvised") {
      return {
        kind: "improvise-rejected",
        a: first,
        b: second,
        reason: "canonical-recipe",
      };
    }
    const judgment = judgePair(this, first, second);
    if (judgment.verdict !== "plausible" && judgment.verdict !== "absurd") {
      return {
        kind: "improvise-rejected",
        a: first,
        b: second,
        reason: "verdict",
        ...judgment,
      };
    }

    const attemptedDepth = Math.max(first.depth ?? 0, second.depth ?? 0) + 1;
    if (attemptedDepth > MAX_IMPROVISED_DEPTH) {
      return {
        kind: "improvise-rejected",
        a: first,
        b: second,
        reason: "depth-limit",
        verdict: judgment.verdict,
        evidence: judgment.evidence,
        attemptedDepth,
      };
    }
    if (!known && this.improvisationsRemaining() <= 0) {
      return {
        kind: "improvise-rejected",
        a: first,
        b: second,
        reason: "run-limit",
        limit: this.improvisationRunCap ?? 0,
      };
    }

    const reused = known?.origin === "improvised";
    let element = reused ? known : buildFallbackElement(first, second);
    if (copy) element = withImprovisedCopy(element, copy);
    if (!reused) {
      this.state.improvisedElements.push(element);
      this.state.discovered.push(element.id);
      this.elementById.set(element.id, element);
    } else if (copy) {
      this.replaceImprovisedElement(element);
    }

    const act = this.currentAct();
    const needExplanations = this.explainCurrentNeeds(element);
    let solved: ProblemDef | undefined;
    for (const problem of act.problems) {
      if (this.isSolved(problem.id)) continue;
      if (!needExplanations[problem.id]?.satisfied) continue;
      this.state.solvedProblems.push(problem.id);
      solved = problem;
      break;
    }

    return {
      kind: "improvised",
      element,
      reused,
      solved,
      ageUp: false,
      act,
      needExplanations,
    };
  }

  /**
   * Forbedrer kun navnet og flavoren på et allerede stabilt runtime-element.
   * Returnerer intet for canonical eller ukendte ids.
   */
  enhanceImprovisedCopy(
    id: string,
    copy: ImproviseCopy,
  ): ElementDef | undefined {
    const known = this.elementById.get(id);
    if (known?.origin !== "improvised") return undefined;
    const enhanced = withImprovisedCopy(known, copy);
    this.replaceImprovisedElement(enhanced);
    return enhanced;
  }

  private replaceImprovisedElement(element: ElementDef): void {
    const index = this.state.improvisedElements.findIndex(
      (entry) => entry.id === element.id,
    );
    if (index < 0) return;
    this.state.improvisedElements[index] = element;
    this.elementById.set(element.id, element);
  }

  private assertTurnAllowed(a: string, b: string): void {
    if (this.state.ended) {
      throw new Error("Karls historie er slut — start et nyt liv");
    }
    if (!this.isDiscovered(a) || !this.isDiscovered(b)) {
      throw new Error(`Kan ikke kombinere uopdagede elementer: ${a}, ${b}`);
    }
  }

  private completeTurn(outcome: CombineOutcome): CombineOutcome {
    const challenge = this.tickChallenge(outcome);
    if (outcome.kind === "improvised") {
      if (outcome.solved) this.creditImprovised(outcome.element.id);
    }
    if (
      challenge?.kind === "solved" &&
      challenge.by.origin === "improvised"
    ) {
      this.creditImprovised(challenge.by.id);
    }
    let completed = outcome;
    if (outcome.kind === "discovery" || outcome.kind === "known") {
      const endingDeflected = this.state.ended
        ? false
        : this.applyEnding(outcome.combo);
      completed = { ...outcome, endingDeflected };
    }
    if (!this.state.ended && this.state.attempts >= this.content.config.turnLimit) {
      const oldAge = this.content.endings.find((e) => e.automatic);
      if (oldAge) this.state.ended = oldAge.id;
    }
    return challenge ? { ...completed, challenge } : completed;
  }

  private creditImprovised(id: string): void {
    if (!this.state.creditedImprovised.includes(id)) {
      this.state.creditedImprovised.push(id);
    }
  }

  private explainCurrentNeeds(element: ElementDef): NeedExplanations {
    const explanations: NeedExplanations = {};
    for (const problem of this.currentAct().problems) {
      if (this.isSolved(problem.id)) continue;
      const predicate = this.predicates[problem.id];
      if (predicate) {
        explanations[problem.id] = explainSatisfaction(element, predicate);
      }
    }
    const active = this.activeChallenge();
    if (active) {
      const predicate = this.predicates[active.def.id];
      if (predicate) {
        explanations[active.def.id] = explainSatisfaction(element, predicate);
      }
    }
    return explanations;
  }

  /** Challenget der presser Karl lige nu — null hvis der ingen er. */
  activeChallenge(): { def: ChallengeDef; active: ActiveChallenge } | null {
    const active = this.state.challenges.active;
    if (!active) return null;
    const def = this.content.challenges.find((c) => c.id === active.id);
    return def ? { def, active } : null;
  }

  /** Har dette run undgået ethvert challenge? Driver "Carl the Lucky". */
  neverChallenged(): boolean {
    return !this.state.challenges.everSpawned;
  }

  /**
   * Kører challenge-uret ét skridt. Rækkefølgen er vigtig: et igangværende
   * challenge afgøres FØR et nyt kan spawne, så to aldrig kører samtidig.
   */
  private tickChallenge(outcome: CombineOutcome): ChallengeEvent | undefined {
    const cs = this.state.challenges;
    const page = this.state.attempts;

    if (cs.active) {
      const def = this.content.challenges.find((c) => c.id === cs.active!.id)!;
      // Kun rigtige opdagelser kan løse et challenge — man slipper ikke
      // udenom ved at kombinere de samme to ting igen og igen.
      if (outcome.kind === "discovery" || outcome.kind === "improvised") {
        if (resolves(def, outcome.element, this.predicates)) {
          cs.active = null;
          cs.gap = 0;
          return { kind: "solved", def, by: outcome.element };
        }
      }
      // Har Karl allerede svaret i hånden, viger truslen for det. Det lyder
      // som en lempelse; det er en rettelse. Reglen var før, at KUN et nyt
      // fund kunne redde ham — og den straffede godt spil: den metodiske
      // spiller havde brugt de lette svar, før ulvene kom, og stod uden.
      // Målt over 600 gennemspilninger døde 99,5 % af de metodiske runs, mod
      // 79 % af dem, der mikser i blinde. Et spil, hvor omhu er farligere end
      // tilfældighed, er gået i stykker et sted.
      //
      // Truslen forsvinder ikke af det. Den kommer, den bliver fortalt, og
      // den går igen — men den dræber kun den, der intet har.
      const parat = this.availableElements().find((el) =>
        resolves(def, el, this.predicates),
      );
      if (parat) {
        cs.active = null;
        cs.gap = 0;
        return { kind: "solved", def, by: parat };
      }
      cs.active.turnsLeft--;
      if (cs.active.turnsLeft <= 0) {
        cs.active = null;
        this.state.ended = def.failEnding;
        return { kind: "failed", def };
      }
      return { kind: "ticking", def, turnsLeft: cs.active.turnsLeft };
    }

    cs.gap++;
    const spawned = rollChallenge(this.content, cs, page, this.state.seed);
    if (!spawned) return undefined;
    cs.active = {
      id: spawned.id,
      startedAtPage: page,
      turnsLeft: spawned.turns,
      repeat: cs.seen.includes(spawned.id),
    };
    cs.seen.push(spawned.id);
    cs.lastSeenAt = { ...(cs.lastSeenAt ?? {}), [spawned.id]: page };
    cs.everSpawned = true;
    cs.gap = 0;
    return { kind: "spawned", def: spawned };
  }

  private resolve(a: string, b: string): CombineOutcome {

    const combo = this.matchCombo(a, b);
    if (!combo) {
      // Ikke "der skete ingenting" — men hvorfor. Dommen bærer begge
      // elementer og bevismaterialet med sig ud til fortælleren.
      const ea = this.element(a);
      const eb = this.element(b);
      const { verdict, evidence } = judgePair(this, ea, eb);
      return { kind: "nofuse", a: ea, b: eb, verdict, evidence };
    }

    const element = this.element(combo.result);
    const act = this.currentAct();

    if (this.isDiscovered(combo.result)) {
      // En skæbne der blev afværget tidligere kan opsøges igen — Karl går
      // tilbage til klippen. Ellers ville et for tidligt forsøg låse den ude.
      return { kind: "known", combo, element };
    }

    // Blødt gate (PRD §2.3): age-up nægtes indtil obligatoriske problemer er løst.
    if (combo.ageUp) {
      const unsolved = this.unsolvedRequiredProblems();
      if (unsolved.length > 0) return { kind: "gated", combo, unsolved };
    }

    this.state.discovered.push(combo.result);
    for (const flag of combo.setsFlags ?? []) this.setFlag(flag);
    // Dybe opdagelser koster ekstra somre af Karls liv
    if (combo.cost && combo.cost > 1) this.state.attempts += combo.cost - 1;

    // Hvilket problem løser opdagelsen? Som hovedregel afgøres det af hvad
    // tingen ER — altså af elementets tags mod prædikatet — ikke af om nogen
    // har husket at skrive "solves" på netop denne opskrift. Mel og dej
    // mætter Karl lige så godt som brød, selvom kun brødet stod i
    // opskriftsbogen.
    //
    // combo.solves er en eksplicit override af den hovedregel (TASK-008):
    // står feltet der og peger på et uløst problem, vinder det, uanset hvad
    // prædikatet ville have sagt om elementets tags. Det er undvigelsen for
    // opskrifter hvor tags aldrig ville kunne fange nuancen. Facittjekket i
    // tools/predicate_report.py kræver stadig at prædikatet accepterer hver
    // eneste af de nuværende forekomster, så overriden ændrer ingen kendt
    // adfærd i dag — den ligger klar til det indhold der har brug for den.
    let solved: ProblemDef | undefined;
    const result = this.elementById.get(combo.result);
    if (result) {
      const overridden = combo.solves
        ? act.problems.find((p) => p.id === combo.solves && !this.isSolved(p.id))
        : undefined;
      if (overridden) {
        this.state.solvedProblems.push(overridden.id);
        solved = overridden;
      } else {
        for (const problem of this.currentAct().problems) {
          if (this.isSolved(problem.id)) continue;
          if (!solvesNeed(result, problem.id, this.predicates)) continue;
          this.state.solvedProblems.push(problem.id);
          // Kun ét problem løses pr. tur — ellers ville ét element kunne
          // rydde hele akten, og fortælleren ville have flere ting at sige
          // på én gang.
          solved = problem;
          break;
        }
      }
    }

    if (combo.ageUp) {
      this.state.act++;
      // Næste akts base-elementer bliver tilgængelige.
      for (const el of this.content.elements) {
        if (el.base && el.act === this.state.act && !this.isDiscovered(el.id)) {
          this.state.discovered.push(el.id);
        }
      }
      return { kind: "discovery", combo, element, solved, ageUp: true, act };
    }

    return { kind: "discovery", combo, element, solved, ageUp: false, act };
  }
}
