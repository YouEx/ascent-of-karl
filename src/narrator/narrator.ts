import type { Engine } from "../core/engine";
import { pairKey } from "../core/engine";
import type {
  CombineOutcome,
  NarratorContentDef,
  NarratorLineDef,
} from "../core/types";

/** Serialiserbar fortæller-tilstand (gemmes sammen med GameState). */
export interface NarratorState {
  /** RNG-tilstand — seedes pr. playthrough, så variantvalg er nyt hvert spil men deterministisk pr. save */
  rngState: number;
  /** Hvor mange gange spam-elementet er brugt i en kombination */
  spamCount: number;
  /** Sidst forsøgte par + hvor mange gange i træk */
  lastPair: string | null;
  lastPairElements: [string, string] | null;
  repeatCount: number;
  /** Fiaskoer i træk ("ingenting") */
  failStreak: number;
  /** Meget hurtige forsøg i træk */
  fastStreak: number;
  /** Element brugt i flere forsøg i træk med skiftende partnere */
  sweepElement: string | null;
  sweepCount: number;
  /** Fiaskoer siden sidste opdagelse — driver hint-eskalering (PRD §2.4) */
  failsSinceDiscovery: number;
  /** Hvor langt hint-eskaleringen er nået pr. problem-id */
  hintLevel: Record<string, number>;
  /** Sidst afspillede replik-id (aldrig samme to gange i træk) */
  lastLineId: string | null;
  /** Sidst valgte variant pr. replik-id (aldrig samme variant to gange i træk) */
  lastVariant: Record<string, number>;
  /** Replik-id'er der allerede er brugt (til `once`-replikker) */
  usedOnce: string[];
  /** Rotationsindeks i den generiske fiasko-pulje */
  genericIndex: number;
  /** Forsøgstæller + hvornår slow-puljen sidst fyrede (cooldown) */
  attempts: number;
  lastSlowAttempt: number;
}

export function freshNarratorState(seed = 1): NarratorState {
  return {
    rngState: seed | 0 || 1,
    spamCount: 0,
    lastPair: null,
    lastPairElements: null,
    repeatCount: 0,
    failStreak: 0,
    fastStreak: 0,
    sweepElement: null,
    sweepCount: 0,
    failsSinceDiscovery: 0,
    hintLevel: {},
    lastLineId: null,
    lastVariant: {},
    usedOnce: [],
    genericIndex: 0,
    attempts: 0,
    lastSlowAttempt: -100,
  };
}

/** En afspillet replik: id, valgt variant-index (til lydfil-opslag) og udfyldt tekst. */
export interface SpokenLine {
  id: string;
  variant: number;
  text: string;
}

/** Efter så mange fiaskoer siden sidste opdagelse begynder fortælleren at hinte, og eskalerer for hver `HINT_STEP` yderligere. */
const HINT_START = 5;
const HINT_STEP = 4;
/** En pause længere end dette regnes som "meget langsom" (ms) */
const SLOW_MS = 45_000;
/** Et forsøg hurtigere end dette efter det forrige regnes som "meget hurtigt" (ms) */
const FAST_MS = 2_000;
/** Mindst så mange forsøg mellem to slow-kommentarer */
const SLOW_COOLDOWN = 5;

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
    // Spread ovenpå fresh state, så gamle saves uden nye felter stadig virker
    this.state = { ...freshNarratorState(), ...(state ?? {}) };
  }

  getState(): NarratorState {
    return structuredClone(this.state);
  }

  loadState(state: NarratorState): void {
    this.state = { ...freshNarratorState(), ...structuredClone(state) };
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

  /** mulberry32-skridt: deterministisk og serialiserbar RNG */
  private rand(): number {
    this.state.rngState = (this.state.rngState + 0x6d2b79f5) | 0;
    let t = this.state.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Vælg en variant — aldrig den samme som sidst for samme replik. */
  private pickVariant(def: NarratorLineDef): number {
    if (def.variants.length === 1) return 0;
    const last = this.state.lastVariant[def.id];
    let index = Math.floor(this.rand() * def.variants.length);
    if (index === last) index = (index + 1) % def.variants.length;
    this.state.lastVariant[def.id] = index;
    return index;
  }

  /** Udfyld pladsholdere: {a}, {b}, {element} → elementnavne med små bogstaver. */
  private fill(text: string, ctx?: { a?: string; b?: string }): string {
    const name = (id: string | null | undefined) =>
      id ? this.engine.element(id).name.toLowerCase() : "";
    return text
      .replaceAll("{a}", name(ctx?.a))
      .replaceAll("{b}", name(ctx?.b))
      .replaceAll("{element}", name(this.state.sweepElement));
  }

  /** Vælg en replik og bogfør den, så den aldrig gentages i træk. */
  private speak(id: string, ctx?: { a?: string; b?: string }): SpokenLine {
    const def = this.line(id);
    this.state.lastLineId = id;
    if (def.once) this.state.usedOnce.push(id);
    const variant = this.pickVariant(def);
    return { id, variant, text: this.fill(def.variants[variant]!, ctx) };
  }

  private updateCounters(
    a: string,
    b: string,
    outcome: CombineOutcome,
    elapsedMs?: number,
  ): void {
    const c = this.content();
    const key = pairKey(a, b);
    this.state.attempts++;

    if (a === c.behavior.spamElement || b === c.behavior.spamElement) {
      this.state.spamCount++;
    }

    const identicalPair = this.state.lastPair === key;
    if (identicalPair) this.state.repeatCount++;
    else this.state.repeatCount = 1;

    // Sweep: samme element brugt i træk med NYE partnere ("stone plus everything")
    if (!identicalPair && this.state.lastPairElements) {
      const prev = this.state.lastPairElements;
      const shared = [a, b].find((el) => prev.includes(el));
      if (shared && shared === this.state.sweepElement) {
        this.state.sweepCount++;
      } else if (shared) {
        this.state.sweepElement = shared;
        this.state.sweepCount = 2;
      } else {
        this.state.sweepElement = null;
        this.state.sweepCount = 0;
      }
    } else if (!identicalPair) {
      this.state.sweepElement = null;
      this.state.sweepCount = 0;
    }

    this.state.lastPair = key;
    this.state.lastPairElements = [a, b];

    if (elapsedMs !== undefined && elapsedMs <= FAST_MS) this.state.fastStreak++;
    else this.state.fastStreak = 0;

    if (outcome.kind === "nothing") {
      this.state.failStreak++;
      this.state.failsSinceDiscovery++;
    } else if (outcome.kind === "discovery") {
      this.state.failStreak = 0;
      this.state.failsSinceDiscovery = 0;
    }
  }

  /** Adfærds-triggere rammer på præcise tærskler, så de ikke fyrer ved hvert efterfølgende forsøg. */
  private behaviorLine(elapsedMs?: number): string | undefined {
    const { behavior } = this.content();

    // Aldring: advarsler når Karls somre slipper op (nøgle = resterende)
    const agingHit = behavior.aging?.[String(this.engine.remainingTurns())];
    if (agingHit) return agingHit;

    // Meget langsom: lang pause før netop dette forsøg (med cooldown)
    if (
      elapsedMs !== undefined &&
      elapsedMs >= SLOW_MS &&
      behavior.slow.length > 0 &&
      this.state.attempts - this.state.lastSlowAttempt >= SLOW_COOLDOWN
    ) {
      this.state.lastSlowAttempt = this.state.attempts;
      return behavior.slow[Math.floor(this.rand() * behavior.slow.length)];
    }

    const spamHit = behavior.spam[String(this.state.spamCount)];
    if (spamHit) return spamHit;
    const repeatHit = behavior.repeatCombo[String(this.state.repeatCount)];
    if (repeatHit) return repeatHit;
    const sweepHit = behavior.elementSweep[String(this.state.sweepCount)];
    if (sweepHit) return sweepHit;
    const failHit = behavior.failStreak[String(this.state.failStreak)];
    if (failHit) return failHit;
    const fastHit = behavior.fast[String(this.state.fastStreak)];
    if (fastHit) return fastHit;
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

  /**
   * Kaldes efter hvert Engine.combine(). `elapsedMs` er tiden siden forrige
   * forsøg (leveres af UI-laget — kernen måler aldrig selv tid).
   */
  react(
    a: string,
    b: string,
    outcome: CombineOutcome,
    elapsedMs?: number,
  ): SpokenLine | undefined {
    this.updateCounters(a, b, outcome, elapsedMs);
    const act = this.engine.currentAct();
    const ctx = { a, b };

    // 0. Slutninger overtrumfer alt — fortællerens sidste ord i dette run
    const ending = this.engine.activeEnding();
    if (ending && !this.state.usedOnce.includes(ending.line)) {
      this.state.usedOnce.push(ending.line);
      return this.speak(ending.line, ctx);
    }

    // 0b. Afværget skæbne: Karl kiggede døden i øjnene og gik hjem igen
    if (
      (outcome.kind === "discovery" || outcome.kind === "known") &&
      outcome.endingDeflected
    ) {
      const deflect = this.content().deflectedEndingLine;
      if (deflect) return this.speak(deflect, ctx);
    }

    // 1. Story-beats (håndskrevne, højeste prioritet)
    if (outcome.kind === "gated" && act.gateLine) return this.speak(act.gateLine, ctx);
    if (outcome.kind === "discovery") {
      // Ved age-up er engine allerede i næste akt — brug akten opdagelsen skete i.
      if (outcome.ageUp && outcome.act.ageUpLine) return this.speak(outcome.act.ageUpLine, ctx);
      if (outcome.combo.narratorLine) return this.speak(outcome.combo.narratorLine, ctx);
      return undefined;
    }

    // 2. Adfærd (pauser, spam, gentagelser, sweeps, streaks, tempo)
    const behavior = this.behaviorLine(elapsedMs);
    if (behavior) return this.speak(behavior, ctx);

    if (outcome.kind !== "nothing") return undefined;

    // Hint-eskalering er fortællerens indbyggede hint-system
    const hint = this.hintLine();
    if (hint) return this.speak(hint, ctx);

    // 3. Flags/hukommelse
    const memory = this.flagMemoryLine();
    if (memory) return this.speak(memory, ctx);

    // 4. Generiske fiaskoer (roterende, aldrig samme to gange i træk)
    return this.speak(this.genericFailureLine(), ctx);
  }

  /** Fortællerens intro til den aktuelle akt (bruges ved spilstart og efter age-up). */
  actIntro(): SpokenLine | undefined {
    const id = this.engine.currentAct().introLine;
    return id ? this.speak(id) : undefined;
  }

  /** Velkommen-tilbage-replik når et gemt spil genoptages. */
  resume(): SpokenLine | undefined {
    const id = this.content().resumeLine;
    return id ? this.speak(id) : undefined;
  }
}
