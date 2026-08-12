import {
  freshChallengeState,
  resolves,
  rollChallenge,
} from "./challenge";
import type { ActiveChallenge, ChallengeState } from "./challenge";
import { solvesNeed } from "./solves";
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
  private state: GameState;
  private elementById = new Map<string, ElementDef>();
  private combosByPair = new Map<string, ComboDef[]>();
  private combosByElement = new Map<string, ComboDef[]>();
  private actByNumber = new Map<number, ActDef>();
  /** Prædikaterne der afgør hvad der løser hvad (content/predicates.json). */
  private predicates: Record<string, SolvePredicate>;

  constructor(content: ContentBundle, state?: GameState) {
    this.content = content;
    this.predicates = content.predicates;
    for (const el of content.elements) this.elementById.set(el.id, el);
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
    this.state = state ?? this.freshState();
  }

  private freshState(): GameState {
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
    };
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  loadState(state: GameState): void {
    const s = structuredClone(state);
    // ended/challenges tilføjet senere — ældre saves mangler felterne
    this.state = {
      ...s,
      ended: s.ended ?? null,
      challenges: s.challenges ?? freshChallengeState(),
      seed: s.seed ?? 1,
    };
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

  /**
   * Antal ting Karl selv har opfundet. Base-elementerne tæller ikke med — de
   * er verden han vågner op i, ikke noget han har udrettet. (Age-up lægger
   * desuden næste akts base-elementer i puljen, som heller ikke er fortjent.)
   */
  inventions(): number {
    return this.state.discovered.filter((id) => !this.element(id).base).length;
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
   * Muterer state ved opdagelser; "known"/"nothing"/"gated" ændrer kun attempts-tælleren.
   */
  combine(a: string, b: string): CombineOutcome {
    if (this.state.ended) {
      throw new Error("Karls historie er slut — start et nyt liv");
    }
    if (!this.isDiscovered(a) || !this.isDiscovered(b)) {
      throw new Error(`Kan ikke kombinere uopdagede elementer: ${a}, ${b}`);
    }
    this.state.attempts++;
    const outcome = this.resolve(a, b);
    const challenge = this.tickChallenge(outcome);
    // Slutninger: en skæbne-kombination, ellers alderdom når somrene slipper op
    if (!this.state.ended && this.state.attempts >= this.content.config.turnLimit) {
      const oldAge = this.content.endings.find((e) => e.automatic);
      if (oldAge) this.state.ended = oldAge.id;
    }
    return challenge ? { ...outcome, challenge } : outcome;
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
      if (outcome.kind === "discovery") {
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
      const deflected = this.applyEnding(combo);
      return { kind: "known", combo, element, endingDeflected: deflected };
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
    const endingDeflected = this.applyEnding(combo);

    // Hvilket problem løser opdagelsen? Afgøres af hvad tingen ER — altså af
    // elementets tags mod prædikatet — ikke af om nogen har husket at skrive
    // "solves" på netop denne opskrift. Mel og dej mætter Karl lige så godt
    // som brød, selvom kun brødet stod i opskriftsbogen.
    //
    // combo.solves bliver stående i indholdet som facit for porten
    // (tools/predicate_report.py), der kræver at prædikatet accepterer hver
    // eneste af dem. De to kan derfor ikke være uenige.
    let solved: ProblemDef | undefined;
    const result = this.elementById.get(combo.result);
    if (result) {
      for (const problem of this.currentAct().problems) {
        if (this.isSolved(problem.id)) continue;
        if (!solvesNeed(result, problem.id, this.predicates)) continue;
        this.state.solvedProblems.push(problem.id);
        // Kun ét problem løses pr. tur — ellers ville ét element kunne rydde
        // hele akten, og fortælleren ville have flere ting at sige på én gang.
        solved = problem;
        break;
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
      return { kind: "discovery", combo, element, solved, ageUp: true, act, endingDeflected };
    }

    return { kind: "discovery", combo, element, solved, ageUp: false, act, endingDeflected };
  }
}
