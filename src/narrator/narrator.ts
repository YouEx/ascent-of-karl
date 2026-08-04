import type { Engine } from "../core/engine";
import { pairKey } from "../core/engine";
import type {
  CombineOutcome,
  NarratorContentDef,
  NarratorLineDef,
} from "../core/types";

/** Serialiserbar fortæller-tilstand (gemmes sammen med GameState). */
export interface NarratorState {
  /** Hvor mange gange spam-elementet er brugt i en kombination */
  spamCount: number;
  /** Sidst forsøgte par + hvor mange gange i træk */
  lastPair: string | null;
  repeatCount: number;
  /** Fiaskoer i træk ("ingenting") */
  failStreak: number;
  /** Fiaskoer siden sidste opdagelse — driver hint-eskalering (PRD §2.4) */
  failsSinceDiscovery: number;
  /** Hvor langt hint-eskaleringen er nået pr. problem-id */
  hintLevel: Record<string, number>;
  /** Sidst afspillede replik-id (aldrig samme to gange i træk) */
  lastLineId: string | null;
  /** Replik-id'er der allerede er brugt (til `once`-replikker) */
  usedOnce: string[];
  /** Rotationsindeks i den generiske fiasko-pulje */
  genericIndex: number;
}

export function freshNarratorState(): NarratorState {
  return {
    spamCount: 0,
    lastPair: null,
    repeatCount: 0,
    failStreak: 0,
    failsSinceDiscovery: 0,
    hintLevel: {},
    lastLineId: null,
    usedOnce: [],
    genericIndex: 0,
  };
}

/** Efter så mange fiaskoer siden sidste opdagelse begynder fortælleren at hinte, og eskalerer for hver `HINT_STEP` yderligere. */
const HINT_START = 5;
const HINT_STEP = 4;

/**
 * Fortælleren reagerer på hvert kombinationsforsøg med præcis én (eller ingen) replik.
 * Triggertyper i prioriteret rækkefølge (PRD §2.4):
 *   1. Story-beats  2. Adfærd  3. Flags/hukommelse  4. Generiske fiaskoer
 */
export class Narrator {
  private state: NarratorState;

  constructor(
    private engine: Engine,
    state?: NarratorState,
  ) {
    this.state = state ?? freshNarratorState();
  }

  getState(): NarratorState {
    return structuredClone(this.state);
  }

  loadState(state: NarratorState): void {
    this.state = structuredClone(state);
  }

  private content(): NarratorContentDef {
    const act = this.engine.currentAct().act;
    const c = this.engine.content.narrator.find((n) => n.act === act);
    if (!c) throw new Error(`Intet fortæller-indhold for akt ${act}`);
    return c;
  }

  /** Replik-opslag på tværs af akter — replik-id'er er globalt unikke (håndhæves af validatoren). */
  line(id: string): NarratorLineDef {
    for (const actContent of this.engine.content.narrator) {
      const def = actContent.lines.find((l) => l.id === id);
      if (def) return def;
    }
    throw new Error(`Ukendt replik: ${id}`);
  }

  private flagsAllow(line: NarratorLineDef): boolean {
    if (line.requiresFlags?.some((f) => !this.engine.hasFlag(f))) return false;
    if (line.blockedByFlags?.some((f) => this.engine.hasFlag(f))) return false;
    return true;
  }

  /** Vælg en replik og bogfør den, så den aldrig gentages i træk. */
  private speak(id: string): NarratorLineDef {
    const def = this.line(id);
    this.state.lastLineId = id;
    if (def.once) this.state.usedOnce.push(id);
    return def;
  }

  private updateCounters(a: string, b: string, outcome: CombineOutcome): void {
    const c = this.content();
    const key = pairKey(a, b);

    if (a === c.behavior.spamElement || b === c.behavior.spamElement) {
      this.state.spamCount++;
    }

    if (this.state.lastPair === key) this.state.repeatCount++;
    else this.state.repeatCount = 1;
    this.state.lastPair = key;

    if (outcome.kind === "nothing") {
      this.state.failStreak++;
      this.state.failsSinceDiscovery++;
    } else if (outcome.kind === "discovery") {
      this.state.failStreak = 0;
      this.state.failsSinceDiscovery = 0;
    }
  }

  /** Adfærds-triggere rammer på præcise tærskler, så de ikke fyrer ved hvert efterfølgende forsøg. */
  private behaviorLine(): string | undefined {
    const { behavior } = this.content();
    const spamHit = behavior.spam[String(this.state.spamCount)];
    if (spamHit) return spamHit;
    const repeatHit = behavior.repeatCombo[String(this.state.repeatCount)];
    if (repeatHit) return repeatHit;
    const failHit = behavior.failStreak[String(this.state.failStreak)];
    if (failHit) return failHit;
    return undefined;
  }

  /** Hint-eskalering: fortælleren rykker selv til stadig tydeligere vink (PRD §2.4). */
  private hintLine(): string | undefined {
    if (this.state.failsSinceDiscovery < HINT_START) return undefined;
    const problem = this.engine.unsolvedRequiredProblems()[0];
    if (!problem?.hints?.length) return undefined;

    const level = this.state.hintLevel[problem.id] ?? 0;
    const due = HINT_START + level * HINT_STEP;
    if (this.state.failsSinceDiscovery < due) return undefined;
    const hint = problem.hints[Math.min(level, problem.hints.length - 1)];
    this.state.hintLevel[problem.id] = level + 1;
    return hint;
  }

  private flagMemoryLine(): string | undefined {
    for (const id of this.content().flagMemory) {
      if (this.state.usedOnce.includes(id)) continue;
      const def = this.line(id);
      if (this.flagsAllow(def)) return id;
    }
    return undefined;
  }

  private genericFailureLine(): string {
    const pool = this.content().genericFailure.filter((id) => {
      const def = this.line(id);
      return this.flagsAllow(def) && id !== this.state.lastLineId;
    });
    const id = pool[this.state.genericIndex % pool.length];
    this.state.genericIndex++;
    return id!;
  }

  /** Kaldes efter hvert Engine.combine(). Returnerer replikken der skal afspilles, hvis nogen. */
  react(a: string, b: string, outcome: CombineOutcome): NarratorLineDef | undefined {
    this.updateCounters(a, b, outcome);
    const act = this.engine.currentAct();

    // 1. Story-beats (håndskrevne, højeste prioritet)
    if (outcome.kind === "gated" && act.gateLine) return this.speak(act.gateLine);
    if (outcome.kind === "discovery") {
      // Ved age-up er engine allerede i næste akt — brug akten opdagelsen skete i.
      if (outcome.ageUp && outcome.act.ageUpLine) return this.speak(outcome.act.ageUpLine);
      if (outcome.combo.narratorLine) return this.speak(outcome.combo.narratorLine);
      return undefined;
    }

    // 2. Adfærd (spam, gentagelser, fiasko-streaks)
    const behavior = this.behaviorLine();
    if (behavior) return this.speak(behavior);

    if (outcome.kind !== "nothing") return undefined;

    // Hint-eskalering er fortællerens indbyggede hint-system
    const hint = this.hintLine();
    if (hint) return this.speak(hint);

    // 3. Flags/hukommelse
    const memory = this.flagMemoryLine();
    if (memory) return this.speak(memory);

    // 4. Generiske fiaskoer (roterende, aldrig samme to gange i træk)
    return this.speak(this.genericFailureLine());
  }

  /** Fortællerens intro til den aktuelle akt (bruges ved spilstart og efter age-up). */
  actIntro(): NarratorLineDef | undefined {
    const id = this.engine.currentAct().introLine;
    return id ? this.speak(id) : undefined;
  }
}
