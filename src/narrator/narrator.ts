import type { Engine } from "../core/engine";
import { pairKey } from "../core/engine";
import { grammarPool, pickGrammarLine, verdictContext } from "./grammar";
import type { PairContent } from "./pairs";
import type {
  CombineOutcome,
  NarratorContentDef,
  NarratorLineDef,
  ProblemDef,
} from "../core/types";

/**
 * Et forslag fortælleren rent faktisk har sagt højt. Gemmes, fordi han ellers
 * ikke kan kende forskel på "spilleren prøvede noget vildt" og "spilleren
 * gjorde præcis det, jeg bad om" — og uden den forskel håner han spilleren
 * for at adlyde sig selv.
 */
export interface SuggestionMemory {
  /** pairKey(a, b) — normaliseret, så rækkefølgen er ligegyldig */
  key: string;
  a: string;
  b: string;
  /** Replikken forslaget kom fra, så en senere replik kan henvise til den */
  lineId: string;
  /** Forsøgsnummer da det lød — gør det muligt at lade råd blive gamle */
  attempt: number;
}

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
  /** Rotation i puljen af generiske opdagelses-replikker */
  discoveryIndex: number;
  /**
   * Problemet fortælleren senest pegede på. Ulydighed måles mod dette:
   * har han ikke sagt noget højt, er der intet at trodse.
   */
  pulledProblem: string | null;
  /** Forsøgsnummer da trækket sidst lød — giver afkøling, så han ikke tromler */
  lastPullAttempt: number;
  /** Hvor mange gange spilleren har opfundet noget andet end det, der blev bedt om */
  defianceCount: number;
  /**
   * Trin på trods-stigen der allerede er hørt. Uden den ville en trods, der
   * blev tiet ihjel af afkølingen, brænde sit trin: tælleren går kun opad, så
   * trinnet ville aldrig komme igen — heller ikke fortællerens sidste,
   * opgivende replik.
   */
  spokenDefianceTiers: number[];
  /** Forsøgsnummer da trods-replikken sidst lød */
  lastDefianceAttempt: number;
  /**
   * Fortællerens seneste konkrete forslag, nyeste først. Kun to: et råd, der
   * er tre forslag gammelt, er ikke længere noget spilleren "lige blev bedt
   * om", og at undskylde for det ville lyde som en maskine, der leder i en log.
   */
  recentSuggestions: SuggestionMemory[];
  /** Forsøgstæller + hvornår slow-puljen sidst fyrede (cooldown) */
  attempts: number;
  lastSlowAttempt: number;
  /**
   * Har "du var længe om det"-replikken lydt i dette run?
   * Den fyrede 2,8 gange pr. run og blev spillets mest hørte adfærds-replik
   * — sjov én gang, docerende tre. Nu højst én gang pr. liv.
   */
  slowUsed: boolean;
  /**
   * De sidst sagte grammatik-replikker. Med ~40 fiaskoer pr. gennemspilning er
   * gentagelse den største trussel mod illusionen om at nogen kigger med.
   */
  recentGrammar: string[];
}

/** Hvor mange grammatik-replikker der huskes og udelukkes. */
const RECENT_GRAMMAR = 6;

export function freshNarratorState(seed = 1): NarratorState {
  return {
    rngState: seed | 0 || 1,
    recentGrammar: [],
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
    discoveryIndex: 0,
    pulledProblem: null,
    lastPullAttempt: -100,
    defianceCount: 0,
    spokenDefianceTiers: [],
    lastDefianceAttempt: -100,
    recentSuggestions: [],
    attempts: 0,
    lastSlowAttempt: -100,
    slowUsed: false,
  };
}

/**
 * Kontekst til pladsholdere. `a`/`b` er element-id'er på det kombinerede par;
 * `element` er et allerede opslået navn (bruges ved opdagelser, hvor
 * {element} skal være det netop opfundne).
 */
interface LineContext {
  a?: string;
  b?: string;
  element?: string;
  /** Dommens bevismateriale — grammatikkens pladsholdere. */
  partner?: string;
  result?: string;
  shared?: string;
  trait?: string;
  trait2?: string;
  deadEnd?: string;
  right?: string;
  wrong?: string;
  /** near-miss: hvilket af de to der faktisk var rigtigt. */
  rightOne?: string;
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
/**
 * Mindste antal forsøg mellem to træk om samme problem. Skifter problemet,
 * fyrer trækket straks — dét er historien der rykker, ikke gentagelse.
 * Fortællerens egen lektie fra `slowUsed` gælder her: sjov én gang,
 * docerende tre.
 */
const PULL_COOLDOWN = 6;
/**
 * Hvor mange af fortællerens forslag der huskes. To, fordi hans mest konkrete
 * råd er i to trin (slå stenene sammen, hold så græsset til gnisterne) — med
 * kun ét ville han glemme første halvdel af sin egen sætning.
 */
const SUGGESTION_MEMORY = 2;
/**
 * Hvor mange forsøg et råd bliver ved med at være hans ansvar. Ni er højt nok
 * til at rumme et par afstikkere undervejs og lavt nok til at han ikke
 * undskylder for noget, spilleren for længst har glemt at han sagde.
 */
const SUGGESTION_TTL = 9;
/** Mindste antal forsøg mellem to trods-replikker */
const DEFIANCE_COOLDOWN = 3;
/**
 * Det komiske spor har ingen afkøling. At vælge mudderkagen frem for
 * løsningen ER pointen med at være ulydig, og den vits må ikke tabes til en
 * timer, der blev sat for de tørre bemærkningers skyld.
 *
 * Det kan ikke spamme: komiske fund er få, og en gentagelse er ikke en
 * opdagelse — så hver af dem kan kun betale sig selv ud én gang.
 */
const DEFIANCE_COMIC_EXEMPT = true;

/**
 * Fortælleren reagerer på hvert kombinationsforsøg med præcis én (eller ingen) replik.
 * Triggertyper i prioriteret rækkefølge (PRD §2.4):
 *   1. Story-beats  2. Adfærd  3. Flags/hukommelse  4. Generiske fiaskoer
 */
export class Narrator {
  private state: NarratorState;
  /**
   * De bagte par-replikker, sat på når den lazy-loadede fil lander. Indtil da
   * er kortet tomt, og hver fiasko besvares af grammatikken. Det er derfor
   * ingen kode nedenfor spørger om filen er hentet: fraværet ligner bare et
   * par uden bagt replik, og den vej er allerede den almindelige.
   */
  private pairLines: Record<string, string> = {};
  /** Selve de bagte replikker, holdt uden for det delte indhold (se attachPairs). */
  private pairDefs: Record<string, NarratorLineDef> = {};

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

  /**
   * Tag imod de bagte replikker for en akt, når den lazy-loadede fil er hentet.
   *
   * Replikkerne holdes for sig selv frem for at blive skubbet ind i aktens
   * `lines`: den pulje kommer fra et importeret JSON-modul og deles af alle
   * Narrator-instanser, så en indsprøjtning dér ville sive mellem to spil i
   * samme proces — og mellem to tests. `line()` kigger her først, hvilket
   * giver replikkerne varianthukommelse og alt det øvrige alligevel.
   *
   * Kaldet er derfor også idempotent i sig selv.
   */
  attachPairs(data: PairContent): void {
    if (this.engine.content.narrator.every((n) => n.act !== data.act)) return;
    for (const line of data.lines) this.pairDefs[line.id] = line;
    this.pairLines = { ...this.pairLines, ...data.pairs };
  }

  private content(): NarratorContentDef {
    const act = this.engine.currentAct().act;
    const c = this.engine.content.narrator.find((n) => n.act === act);
    if (!c) throw new Error(`Intet fortæller-indhold for akt ${act}`);
    return c;
  }

  /** Replik-opslag på tværs af akter — replik-id'er er globalt unikke (håndhæves af validatoren). */
  line(id: string): NarratorLineDef {
    const baked = this.pairDefs[id];
    if (baked) return baked;
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
  private fill(text: string, ctx?: LineContext): string {
    const name = (id: string | null | undefined) =>
      id ? this.engine.element(id).name.toLowerCase() : "";
    // {element} peger normalt på det element spilleren fejer med; ved en
    // opdagelse er det i stedet det netop opfundne, som ctx leverer direkte.
    const element = ctx?.element?.toLowerCase() ?? name(this.state.sweepElement);
    // {shared} og {trait} er ikke elementer men ord fra taksonomien ("plant",
    // "hot"). De skrives som de er — grammatikken skal kunne sige "both of
    // them grow" uden at slå noget op.
    return text
      .replaceAll("{a}", name(ctx?.a))
      .replaceAll("{b}", name(ctx?.b))
      .replaceAll("{partner}", name(ctx?.partner))
      .replaceAll("{result}", name(ctx?.result))
      .replaceAll("{deadEnd}", name(ctx?.deadEnd))
      .replaceAll("{right}", name(ctx?.right))
      .replaceAll("{wrong}", name(ctx?.wrong))
      .replaceAll("{shared}", ctx?.shared ?? "")
      .replaceAll("{trait}", ctx?.trait ?? "")
      .replaceAll("{trait2}", ctx?.trait2 ?? "")
      .replaceAll("{element}", element);
  }

  /** Vælg en replik og bogfør den, så den aldrig gentages i træk. */
  private speak(id: string, ctx?: LineContext): SpokenLine {
    const def = this.line(id);
    this.state.lastLineId = id;
    if (def.once) this.state.usedOnce.push(id);
    this.rememberSuggestions(def);
    const variant = this.pickVariant(def);
    return { id, variant, text: this.fill(def.variants[variant]!, ctx) };
  }

  /**
   * Bogfør de opskrifter replikken pegede på. Det sker her og kun her, fordi
   * `speak` er det eneste sted en replik faktisk bliver sagt højt — et forslag,
   * spilleren aldrig hørte, må ikke kunne blive fortællerens ansvar bagefter.
   */
  private rememberSuggestions(def: NarratorLineDef): void {
    if (!def.suggests?.length) return;
    for (const [a, b] of def.suggests) this.rememberPair(a, b, def.id);
  }

  /** Bogfør ét forslag. Delt af de håndskrevne replikker og af grammatikken. */
  private rememberPair(a: string, b: string, lineId: string): void {
    const key = pairKey(a, b);
    const kept = this.state.recentSuggestions.filter((s) => s.key !== key);
    kept.unshift({ key, a, b, lineId, attempt: this.state.attempts });
    this.state.recentSuggestions = kept.slice(0, SUGGESTION_MEMORY);
  }

  /**
   * Sagde fortælleren selv, at spilleren skulle prøve netop dette par?
   *
   * Forslaget fjernes, når det bruges. Uden det ville han undskylde igen og
   * igen for det samme råd, og spillets egen lektie fra `slowUsed` gælder også
   * her: sjov én gang, docerende tre. Råd, der er blevet for gamle, tæller
   * ikke — se SUGGESTION_TTL.
   */
  private ownAdviceFailed(a: string, b: string): SuggestionMemory | undefined {
    const key = pairKey(a, b);
    const hit = this.state.recentSuggestions.find(
      (s) => s.key === key && this.state.attempts - s.attempt <= SUGGESTION_TTL,
    );
    if (!hit) return undefined;
    this.state.recentSuggestions = this.state.recentSuggestions.filter(
      (s) => s.key !== key,
    );
    return hit;
  }

  /** Fortællerens seneste forslag, nyeste først. Læses af UI og tests. */
  suggestions(): readonly SuggestionMemory[] {
    return this.state.recentSuggestions;
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

    // Sammenhængende brug af spam-elementet. Tælleren SKAL nulstilles: uden
    // det stod den fast på fx 3, og behavior.spam["3"] matchede så på hvert
    // eneste efterfølgende forsøg — spilleren fik "tredje gang med stenen"
    // mens de kombinerede bær med bær.
    if (a === c.behavior.spamElement || b === c.behavior.spamElement) {
      this.state.spamCount++;
    } else {
      this.state.spamCount = 0;
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

    if (outcome.kind === "nofuse") {
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

    // Meget langsom: lang pause før netop dette forsøg. Højst ÉN gang pr.
    // run — reglen hænger på triggeren, ikke på replik-id'et, så den holder
    // også når puljen får flere replikker.
    if (
      !this.state.slowUsed &&
      elapsedMs !== undefined &&
      elapsedMs >= SLOW_MS &&
      behavior.slow.length > 0
    ) {
      this.state.slowUsed = true;
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

  /**
   * Hint-eskalering: fortælleren rykker selv til stadig tydeligere vink (PRD §2.4).
   *
   * Vinket følger det samme træk som `currentPull()`, og af samme grund: så
   * længe der kun blev peget på de påkrævede nøder, holdt hjælpen op i samme
   * sekund den tredje var løst. Martin spillede halvtreds somre, løste alle
   * tre, og fik derefter ikke ét vink resten af spillet. Et hint-system, der
   * lukker ned præcis når inventaret er stort nok til at man farer vild, er
   * vendt på hovedet — tætheden af brugbare par falder fra 43 % i åbningen
   * til under 2 %, så behovet for retning VOKSER gennem spillet.
   */
  private hintLine(): string | undefined {
    if (this.state.failsSinceDiscovery < HINT_START) return undefined;
    const problem =
      this.engine.unsolvedRequiredProblems().find((p) => p.hints?.length) ??
      this.engine
        .currentActProblems()
        .find(
          (p) => !p.required && p.hints?.length && !this.engine.isSolved(p.id),
        );
    if (!problem?.hints?.length) return undefined;

    const level = this.state.hintLevel[problem.id] ?? 0;
    const due = HINT_START + level * HINT_STEP;
    if (this.state.failsSinceDiscovery < due) return undefined;
    // Sidste trin er det mest konkrete, der findes — det navngiver parret. At
    // sige det igen og igen gør fortælleren til en papegøje frem for en hjælp,
    // så vinket stopper, når han har sagt alt, hvad han ved om den nød.
    if (level >= problem.hints.length) return undefined;
    const hint = problem.hints[level];
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

  /**
   * Roterende pulje til opdagelser uden håndskrevet replik. Samme
   * no-repeat-princip som de generiske fiaskoer, så en spiller der opdager
   * meget ikke hører det samme to gange i træk.
   */
  private discoveryLine(): string | undefined {
    const pool = (this.content().discoveryFallback ?? []).filter((id) => {
      const def = this.line(id);
      return this.flagsAllow(def) && id !== this.state.lastLineId;
    });
    if (pool.length === 0) return undefined;
    const id = pool[this.state.discoveryIndex % pool.length];
    this.state.discoveryIndex++;
    return id;
  }

  /**
   * Replikken til "du gjorde, hvad jeg sagde, og der skete ingenting".
   * Puljen er valgfri i indholdet: findes den ikke, falder øjeblikket tilbage
   * til den almindelige rækkefølge frem for at stå tavst.
   */
  private obeyedFailureLine(): string | undefined {
    const pool = (this.content().obeyedFailure ?? []).filter((id) => {
      const def = this.line(id);
      return this.flagsAllow(def) && id !== this.state.lastLineId;
    });
    if (!pool.length) return undefined;
    return pool[Math.floor(this.rand() * pool.length)]!;
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

    // 0a. Challenges presser alt andet i baggrunden — de har en frist
    if (outcome.challenge) {
      const ch = outcome.challenge;
      if (ch.kind === "spawned") return this.speak(ch.def.line, ctx);
      if (ch.kind === "solved") {
        return this.speak(ch.def.successLine, { ...ctx, element: ch.by.name });
      }
      // "failed" håndteres af slutnings-grenen ovenfor (state.ended er sat)
      if (ch.kind === "ticking" && ch.turnsLeft <= 2) {
        const warn = this.content().challengeWarningLine;
        if (warn) return this.speak(warn, ctx);
      }
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
      // En opdagelse må ALDRIG møde tavshed. Kun 38 af 205 kombinationer har
      // en håndskrevet replik; resten faldt før igennem uden en lyd.
      const generic = this.discoveryLine();
      if (generic) {
        return this.speak(generic, { ...ctx, element: outcome.element.name });
      }
      return undefined;
    }

    // 1b. Hans eget råd slog fejl. Den står FØR adfærd, fordi der ikke findes
    // et øjeblik med højere signal end at spilleren gjorde præcis, hvad der
    // blev bedt om, og intet skete. At svare med spam-drilleri dér er at
    // skifte emne væk fra sin egen fejl. Den kan ikke tromle: `ownAdviceFailed`
    // bruger forslaget op, så hver replik hører til ét råd.
    if (outcome.kind === "nofuse") {
      const mine = this.ownAdviceFailed(a, b);
      const owned = mine && this.obeyedFailureLine();
      if (owned) return this.speak(owned, { ...ctx, a: mine!.a, b: mine!.b });
    }

    // 2. Adfærd (pauser, spam, gentagelser, sweeps, streaks, tempo)
    const behavior = this.behaviorLine(elapsedMs);
    if (behavior) return this.speak(behavior, ctx);

    if (outcome.kind !== "nofuse") return undefined;

    // Hint-eskalering er fortællerens indbyggede hint-system
    const hint = this.hintLine();
    if (hint) return this.speak(hint, ctx);

    // 3. Flags/hukommelse
    const memory = this.flagMemoryLine();
    if (memory) return this.speak(memory, ctx);

    // 4. Bagt replik til netop dette par. Første trin i fiaskokæden, fordi den
    //    er skrevet om præcis disse to ting og aldrig kunne handle om andre.
    const baked = this.bakedPairLine(outcome);
    if (baked) return baked;

    // 5. Grammatikken: en replik der nævner præcis de to ting, valgt ud fra
    //    motorens dom. Står før den generiske pulje, som dermed bliver en
    //    nødudgang der aldrig nås i praksis.
    const grammar = this.grammarLine(outcome);
    if (grammar) return grammar;

    // 6. Generiske fiaskoer (roterende, aldrig samme to gange i træk)
    return this.speak(this.genericFailureLine(), ctx);
  }

  /**
   * Den bagte replik til dette par, hvis der findes en.
   *
   * Opslaget er par + dom, ikke par alene: det samme par kan mødes i
   * forskellige spiltilstande og få forskellige domme, og en bagt replik der
   * siger "du var tæt på" må ikke lyde, når sandheden er at det var absurd.
   * Findes den bagte replik ikke for netop denne dom, taler grammatikken —
   * som altid regner dommen ud på ny.
   *
   * Replikkerne skriver elementnavnene ud i klartekst frem for {a}/{b}, fordi
   * `pairKey` er sorteret: rækkefølgen af pladsholderne ville være
   * spillerens, ikke sætningens.
   */
  private bakedPairLine(outcome: CombineOutcome): SpokenLine | undefined {
    if (outcome.kind !== "nofuse") return undefined;
    const id = this.pairLines[
      `${pairKey(outcome.a.id, outcome.b.id)}:${outcome.verdict}`
    ];
    if (!id) return undefined;
    return this.speak(id, verdictContext(outcome.a, outcome.b, outcome.evidence));
  }

  /**
   * Fortæl om dommen. Returnerer undefined hvis grammatikken ikke har en regel
   * — så falder vi igennem til den generiske pulje, hvilket er en fejl vi
   * hellere vil se i en test end høre i spillet (TEST-004).
   */
  private grammarLine(outcome: CombineOutcome): SpokenLine | undefined {
    if (outcome.kind !== "nofuse") return undefined;
    const pool = grammarPool(
      this.content().grammar,
      outcome.verdict,
      outcome.a,
      outcome.b,
    );
    const id = pickGrammarLine(pool, this.state.recentGrammar, () => this.rand());
    if (!id) return undefined;
    this.state.recentGrammar = [id, ...this.state.recentGrammar].slice(
      0,
      RECENT_GRAMMAR,
    );
    const ctx = verdictContext(outcome.a, outcome.b, outcome.evidence);
    const spoken = this.speak(id, ctx);
    // Nævnte replikken den rigtige partner, er det et råd — og et råd skal
    // kunne komme tilbage og bide ham (REQ-005). Parret registreres derfor i
    // den samme hukommelse som de håndskrevne forslag.
    if (ctx.partner && ctx.rightOne && spoken.text.includes(
      this.engine.element(ctx.partner).name.toLowerCase(),
    )) {
      this.rememberPair(ctx.rightOne, ctx.partner, id);
    }
    return spoken;
  }

  /**
   * Problemet fortælleren peger på lige nu — historiens naturlige næste
   * skridt. Rækkefølgen er akt-filens, så fortællingen har en rygrad:
   * kulden først, så de bare hænder, så sulten.
   *
   * Bruges også af UI'et, så det aktuelle træk altid er synligt uden at
   * fortælleren skal gentage sig. "Altid" opnås ved at stå fast, ikke ved
   * at blive sagt igen og igen.
   */
  currentPull(): ProblemDef | undefined {
    const paakraevet = this.engine.unsolvedRequiredProblems().find((p) => p.pull);
    if (paakraevet) return paakraevet;
    // Når de tre nødvendige er løst, holder trækket ikke op — det skifter
    // karakter. Martin spillede halvtreds somre og fik ingen retning efter
    // den tredje nød, fordi der ikke stod flere problemer at pege på. De
    // valgfri er ikke krav (age-up ser dem ikke), men fortælleren gør.
    return this.engine
      .currentActProblems()
      .find((p) => p.pull && !p.required && !this.engine.isSolved(p.id));
  }

  /**
   * Fortællerens første træk, når spillet åbnes eller genoptages. Historien
   * skal have en retning fra første takt — ellers er de tidlige forsøg bare
   * famlen, og der er ingen erklæret hensigt at trodse.
   *
   * Ved genoptagelse siger han kun noget, hvis trækket har flyttet sig, mens
   * han var tavs. Ellers ville hver genindlæsning gentage en replik, spilleren
   * allerede har hørt, og nulstille afkølingen til den næste ægte påmindelse.
   * Chippen i UI'et står stadig markeret — det er dér, "altid" bor.
   */
  openingPull(): SpokenLine | undefined {
    if (this.engine.activeEnding()) return undefined;
    const next = this.currentPull();
    if (!next?.pull) return undefined;
    if (this.state.pulledProblem === next.id) return undefined;
    this.state.pulledProblem = next.id;
    this.state.lastPullAttempt = this.state.attempts;
    return this.speak(next.pull);
  }

  /**
   * Anden takt efter en opdagelse: enten en bemærkning om at spilleren lige
   * har trodset ham, eller et nyt træk mod det næste naturlige skridt.
   *
   * Kaldes af UI-laget EFTER `react()`, og køes bag historiereplikken:
   * "Sådan gik det. — Og nu ville historien gerne dette."
   */
  followUp(outcome: CombineOutcome): SpokenLine | undefined {
    if (outcome.kind !== "discovery") return undefined;
    // Slutninger og age-up er historiens egne store takter. Et træk oveni
    // ville tale hen over dem.
    if (this.engine.activeEnding() || outcome.ageUp) return undefined;

    const defiance = this.defianceLine(outcome);
    if (defiance) return this.speak(defiance, { element: outcome.element.name });

    const next = this.currentPull();
    if (!next?.pull) {
      this.state.pulledProblem = null;
      return undefined;
    }

    const changed = this.state.pulledProblem !== next.id;
    const cooled = this.state.attempts - this.state.lastPullAttempt >= PULL_COOLDOWN;
    if (!changed && !cooled) return undefined;

    this.state.pulledProblem = next.id;
    this.state.lastPullAttempt = this.state.attempts;
    return this.speak(next.pull, { element: outcome.element.name });
  }

  /**
   * Trods: spilleren opfandt noget andet end det, fortælleren bad om.
   *
   * Tælles KUN på opdagelser. At fejle mens man prøver er ikke ulydighed —
   * det er at prøve. At lykkes med noget helt andet er ulydighed, og det er
   * dét, der er sjovt.
   */
  private defianceLine(outcome: CombineOutcome & { kind: "discovery" }): string | undefined {
    const asked = this.state.pulledProblem;
    if (!asked) return undefined; // han har ikke bedt om noget endnu
    if (this.engine.isSolved(asked)) return undefined; // trækket lykkedes jo
    if (outcome.combo.solves === asked) return undefined; // spilleren adlød

    const { defiance, defianceComic } = this.content();
    // Trodsen tælles altid — også når han tier. Han ser alt; han kommenterer
    // bare ikke hver gang.
    this.state.defianceCount++;
    const since = this.state.attempts - this.state.lastDefianceAttempt;
    const comic = outcome.combo.spor === "komisk" && !!defianceComic?.length;

    if (!(comic && DEFIANCE_COMIC_EXEMPT) && since < DEFIANCE_COOLDOWN) {
      return undefined;
    }

    let id: string | undefined;
    if (comic) {
      const pick = defianceComic![Math.floor(this.rand() * defianceComic!.length)]!;
      if (pick !== this.state.lastLineId) id = pick;
    }
    id ??= this.defianceTierLine(defiance);
    // Afkølingen bruges kun når han rent faktisk siger noget. Ellers ville en
    // tavs trods skubbe den næste bemærkning væk uden grund.
    if (id) this.state.lastDefianceAttempt = this.state.attempts;
    return id;
  }

  /**
   * Næste trin på trods-stigen: det laveste endnu uhørte trin, spilleren har
   * optjent. Stigen er en tone-bue — mild irritation, mistanke, opgivelse — og
   * den skal gås nedefra, ellers lyver den om, hvad han allerede har sagt.
   *
   * Til forskel fra `behavior.*`-tærsklerne kan et trin ikke tabes: tælleren
   * går kun opad, så et trin, der blev tiet ihjel af afkølingen, ville ellers
   * være væk for resten af spillet — inklusive hans sidste, opgivende replik.
   * Derfor er trinnet ikke bundet til et præcist tal, og replikkerne tæller
   * ikke højt.
   *
   * Er alle trin hørt, tier han. Det er ikke en mangel: han sagde selv, at han
   * holdt op med at anbefale.
   */
  private defianceTierLine(defiance?: Record<string, string>): string | undefined {
    if (!defiance) return undefined;
    const earned = Object.keys(defiance)
      .map(Number)
      .filter((t) => t <= this.state.defianceCount && !this.state.spokenDefianceTiers.includes(t))
      .sort((x, y) => x - y);
    const tier = earned[0];
    if (tier === undefined) return undefined;
    this.state.spokenDefianceTiers.push(tier);
    return defiance[String(tier)];
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
