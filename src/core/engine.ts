import type {
  ActDef,
  CombineOutcome,
  ComboDef,
  ContentBundle,
  ElementDef,
  ProblemDef,
} from "./types";

/** Serialiserbar spiltilstand — hele save-formatet (PRD §4.1: save pr. opdagelse). */
export interface GameState {
  act: number;
  discovered: string[];
  flags: string[];
  solvedProblems: string[];
  /** Antal kombinationsforsøg i alt (telemetri/adfærd) */
  attempts: number;
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
  private actByNumber = new Map<number, ActDef>();

  constructor(content: ContentBundle, state?: GameState) {
    this.content = content;
    for (const el of content.elements) this.elementById.set(el.id, el);
    for (const combo of content.combos) {
      const key = pairKey(combo.pair[0], combo.pair[1]);
      const list = this.combosByPair.get(key) ?? [];
      list.push(combo);
      this.combosByPair.set(key, list);
    }
    for (const act of content.acts) this.actByNumber.set(act.act, act);
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
    };
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  loadState(state: GameState): void {
    this.state = structuredClone(state);
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

  unsolvedRequiredProblems(): ProblemDef[] {
    return this.currentAct().problems.filter(
      (p) => p.required && !this.isSolved(p.id),
    );
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
   * Kernen i loopet (PRD §2.1): kombinér to elementer.
   * Muterer state ved opdagelser; "known"/"nothing"/"gated" ændrer kun attempts-tælleren.
   */
  combine(a: string, b: string): CombineOutcome {
    if (!this.isDiscovered(a) || !this.isDiscovered(b)) {
      throw new Error(`Kan ikke kombinere uopdagede elementer: ${a}, ${b}`);
    }
    this.state.attempts++;

    const combo = this.matchCombo(a, b);
    if (!combo) return { kind: "nothing" };

    const element = this.element(combo.result);
    const act = this.currentAct();

    if (this.isDiscovered(combo.result)) {
      return { kind: "known", combo, element };
    }

    // Blødt gate (PRD §2.3): age-up nægtes indtil obligatoriske problemer er løst.
    if (combo.ageUp) {
      const unsolved = this.unsolvedRequiredProblems();
      if (unsolved.length > 0) return { kind: "gated", combo, unsolved };
    }

    this.state.discovered.push(combo.result);
    for (const flag of combo.setsFlags ?? []) this.setFlag(flag);

    let solved: ProblemDef | undefined;
    if (combo.solves && !this.isSolved(combo.solves)) {
      solved = this.currentAct().problems.find((p) => p.id === combo.solves);
      if (solved) this.state.solvedProblems.push(combo.solves);
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
