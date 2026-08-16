/** Datamodel for alt indhold. ALT indhold ligger i JSON — aldrig hardcodet (PRD §4.1). */

/**
 * Det kontrollerede ordforråd fra content/taxonomy.json. Unions frem for
 * string, så en stavefejl ikke kompilerer — et element med trait "healng"
 * ville ellers bare holde op med at kunne kurere feberen, tavst.
 */
export type ElementKind =
  | "material"
  | "tool"
  | "food"
  | "creature"
  | "person"
  | "structure"
  | "phenomenon"
  | "abstract";

export type ElementStuff =
  | "stone"
  | "wood"
  | "plant"
  | "flesh"
  | "clay"
  | "metal"
  | "water"
  | "fire"
  | "fibre"
  | "bone"
  | "none";

export type ElementTrait =
  | "hard"
  | "soft"
  | "sharp"
  | "blunt"
  | "hot"
  | "cold"
  | "wet"
  | "dry"
  | "alive"
  | "dead"
  | "edible"
  | "heavy"
  | "light"
  | "fragile"
  | "sticky"
  | "insulating"
  | "tame"
  | "weapon"
  | "vessel"
  | "digs"
  | "healing"
  | "sacred"
  | "floats"
  | "loud"
  | "portable";

export type ElementScale = "hand" | "body" | "camp" | "landscape";
export type ElementOrigin = "canon" | "improvised";

/**
 * Et prædikat over tags. Hovedreglen for hvad der løser hvad — erstatter de
 * håndholdte navnelister, allowlisterne engang var. To af dem lever dog
 * videre ved siden af, som eksplicitte overrides for enkeltstående
 * undtagelser prædikatet ikke kan udtrykke: `challenge.alsoSolvedBy` for
 * challenges (TASK-006, se src/core/challenge.ts) og `combo.solves` for
 * problemer (TASK-008, se ComboDef.solves og Engine.resolve).
 *
 * Inden for ét prædikat er alle felter OG'et; traits kræver at ALLE de nævnte
 * er til stede. Brug anyOf for "en af dem". Se content/predicates.json.
 */
export interface SolvePredicate {
  kind?: ElementKind[];
  stuff?: ElementStuff[];
  /** Alle nævnte traits skal være til stede. */
  traits?: ElementTrait[];
  scale?: ElementScale[];
  /** Kræver at elementet ikke er et base-element (Karl skal have lavet det). */
  crafted?: boolean;
  /**
   * Mindste antal opskrift-trin fra starthånden. `crafted` var et groft mål
   * for det samme — "ikke noget han fik forærende" — men det holder kun nøden
   * væk fra tur 0, ikke fra tur 1. Bærsaft og oesters bærer nøjagtig samme
   * tags; det eneste der skiller dem, er hvor meget arbejde de kostede.
   */
  minDepth?: number;
  anyOf?: SolvePredicate[];
  allOf?: SolvePredicate[];
  not?: SolvePredicate;
}

export type PredicateFailure =
  | {
      requirement: "allOf" | "anyOf";
      branches: PredicateExplanation[];
    }
  | {
      requirement: "not";
      predicate: SolvePredicate;
      matched: PredicateExplanation;
    }
  | {
      requirement: "crafted";
      expected: true;
      actual: false;
    }
  | {
      requirement: "minDepth";
      expected: number;
      actual: number;
    }
  | {
      requirement: "kind";
      expected: ElementKind[];
      actual: ElementKind;
    }
  | {
      requirement: "stuff";
      expected: ElementStuff[];
      actual: ElementStuff;
    }
  | {
      requirement: "traits";
      expected: ElementTrait[];
      missing: ElementTrait[];
    }
  | {
      requirement: "scale";
      expected: ElementScale[];
      actual: ElementScale;
    };

/** Rent, serialiserbart bevis for hvorfor et prædikat bestod eller fejlede. */
export interface PredicateExplanation {
  satisfied: boolean;
  failures: PredicateFailure[];
}

/** Prædikatbeviser nøglet på problem- eller challenge-id. */
export type NeedExplanations = Record<string, PredicateExplanation>;

export interface ElementDef {
  id: string;
  /**
   * Kuraterede elementer kan fortsat udelade feltet i content og gamle saves;
   * fravær betyder `canon`. Runtime-improvisationer skriver altid
   * `improvised` eksplicit.
   */
  origin?: ElementOrigin;
  generatedOperation?:
    | "cut"
    | "heat"
    | "soak"
    | "bind"
    | "work"
    | "join"
    | "hybrid";
  /** Det ordnede, stabile forældrepar. Findes kun på improviserede elementer. */
  parents?: [string, string];
  /** Visningsnavn på dansk */
  name: string;
  /** Midlertidigt ikon indtil illustrationer (Step 4) */
  emoji: string;
  /** Hvilken akt elementet hører til (elementpulje pr. epoke, PRD §2.3) */
  act: number;
  /** Base-elementer er tilgængelige fra aktens start */
  base?: boolean;
  /**
   * Korteste opskriftsafstand fra starthånden for canon. Udledes i
   * loadContent() og står ikke i elements.json. For improviserede elementer
   * gemmes `max(parent.depth)+1` i runets registry.
   */
  depth?: number;
  /**
   * Tingen indgår ikke i nogen opskrift — den er enden på en vej, ikke et trin
   * på den. Udledes i loadContent() sammen med `depth`, af samme grund: et
   * håndskrevet flag ville stå og lyve, første gang nogen tilføjede en opskrift.
   */
  terminal?: boolean;
  /**
   * Klassifikation (content/taxonomy.json). Prædikaterne i
   * content/predicates.json dømmer på disse fire felter i stedet for på
   * navnelister, så alt der ligner en løsning også tæller som en.
   */
  kind: ElementKind;
  stuff: ElementStuff;
  traits: ElementTrait[];
  scale: ElementScale;
  /** Komisk flavor-tekst, 1-2 sætninger (PRD §3.2) */
  flavor?: string;
  /** Faktuel historisk note, 1 sætning (PRD §3.2) */
  note?: string;
  /** Kilde-URL til den historiske note (PRD §5: kildekrav pr. note) */
  sourceUrl?: string;
  /**
   * Karls stemning på bogens illustration (docs/design/bogen.md):
   * fx "stolt", "ked", "flov", "fornaermet", "forvirret".
   * Prototypen viser den som badge; senere er den brief til illustratoren.
   */
  karlMood?: string;
  /**
   * Kategori (docs/design/decisions.md). Beslutninger svarer på KATEGORIEN,
   * ikke på elementet — ellers ville fire beslutninger kræve 748 replikker.
   */
  tag?: string;
}

export interface ComboDef {
  /** De to input-elementer. Rækkefølge er ligegyldig; et element kan kombineres med sig selv. */
  pair: [string, string];
  /** Id på elementet der skabes */
  result: string;
  /** Flags der sættes ved opdagelsen (PRD §2.2) */
  setsFlags?: string[];
  /** Kombinationen er kun gyldig hvis disse flags er sat */
  requiresFlags?: string[];
  /** Kombinationen er kun gyldig hvis ingen af disse flags er sat */
  blockedByFlags?: string[];
  /**
   * Problem-id som denne opdagelse løser (PRD §2.1). Eksplicit override:
   * vinder i Engine.resolve, selvom prædikatet ikke ville have godkendt
   * elementet (TASK-008) — for opskrifter hvor tags aldrig ville fange
   * nuancen. Ikke hovedreglen; de fleste problemer løses stadig via tags
   * mod content/predicates.json (src/core/solves.ts).
   */
  solves?: string;
  /** Udløser epokeskift når aktens obligatoriske problemer er løst (PRD §2.3) */
  ageUp?: boolean;
  /** Id på håndskrevet fortæller-replik (story-beat, højeste prioritet) */
  narratorLine?: string;
  /** Tidslinje-gren: hovedspor (default) eller komisk sidegren (docs/design/bogen.md) */
  spor?: "hoved" | "komisk";
  /** Opdagelsen afslutter Karls liv/historie med denne slutning (endings.json) */
  ending?: string;
  /** Somre opdagelsen koster (default 1) — dybe grene æder levetiden hurtigere */
  cost?: number;
}

/**
 * En slutning på Karls liv (docs/design/act-1.md). Udløses af en kombination
 * (`ComboDef.ending`) eller automatisk (alderdom ved turn-limit). Hver
 * slutning låser et achievement op, som overlever på tværs af runs.
 */
export interface EndingDef {
  id: string;
  title: string;
  emoji: string;
  tone: "happy" | "tragic" | "mad" | "bittersweet" | "komisk";
  /** Achievement-titlen der låses op ("You unlocked King Carl") */
  achievement: string;
  /** Replik-id — fortællerens afsluttende ord (3+ varianter) */
  line: string;
  /** Udløses automatisk (alderdom) i stedet for via kombination */
  automatic?: boolean;
  /** Udløses af et tabt challenge frem for en kombination */
  viaChallenge?: boolean;
}

export interface ProblemDef {
  id: string;
  name: string;
  /**
   * Emblem for problemets *emne* (❄️ for kulde, ✋ for værktøj). Referencen
   * viser emnet, ikke status: en chip fortæller først hvad der er galt, og
   * dernæst — via tint og gennemstregning — hvor langt Karl er med det.
   */
  icon?: string;
  /**
   * Semantisk farvefamilie, ikke en hex-værdi: indholdet siger "cold", og
   * CSS ejer hvilken kulde det er. Kendte værdier: cold, craft, hunger.
   */
  tint?: string;
  /** Sådan præsenteres problemet i historien ("Karl fryser") */
  description: string;
  /** Obligatoriske problemer gater age-up (blødt gate, PRD §2.3) */
  required: boolean;
  /**
   * Replik-id for fortællerens *træk*: han siger højt hvad historien vil
   * herfra ("Nu skulle Karl varmes. Hvis blot der lå noget brugbart …").
   * Trækket er ikke et hint til en spiller der sidder fast — det er en
   * erklæret hensigt, som spilleren kan vælge at trodse. Uden den erklæring
   * findes der ingen ulydighed at grine af.
   */
  pull?: string;
  /** Fortæller-eskalering: replik-id'er fra blide til tydelige vink (PRD §2.4) */
  hints?: string[];
}

export interface ActDef {
  act: number;
  name: string;
  /** Fortællerens intro når akten starter */
  introLine?: string;
  problems: ProblemDef[];
  /** Replik-id når spilleren forsøger age-up med uløste obligatoriske problemer */
  gateLine?: string;
  /** Replik-id til age-up-banneret */
  ageUpLine?: string;
}

/**
 * En fortæller-replik med variant-pulje (docs/design/fortaelleren.md).
 * Hver afspilning vælger én variant via playthrough-seedet RNG, så to
 * gennemspilninger ikke lyder ens. Tekst-first; audioId kobles på i Step 4.
 * Varianter kan bruge pladsholdere: {a}, {b} (parrets navne), {element}
 * (sweep/opfindelsens navn), {previous} (forrige opdagelse) samt
 * improvisationsbevisets spiller-vendte
 * {need}/{Need}/{actual}/{expected}/{missing}; {Need} er samme frase med
 * stort begyndelsesbogstav, når den åbner en sætning.
 */
export interface NarratorLineDef {
  id: string;
  variants: string[];
  /** Vises kun hvis alle disse flags er sat */
  requiresFlags?: string[];
  /** Vises ikke hvis et af disse flags er sat */
  blockedByFlags?: string[];
  /** Replikken bruges højst én gang pr. gennemspilning (fx flag-hukommelse) */
  once?: boolean;
  /**
   * De opskrifter replikken peger på, som par af element-id'er. Feltet findes,
   * fordi fortælleren engang sendte spilleren efter sten+græs, som ikke er en
   * opskrift — vejen er sten+sten og derefter gnister+græs. Han hånede
   * bagefter spilleren for at adlyde ham. Med `suggests` kan validatoren slå
   * hvert par op i combos.json, så en replik ikke KAN lyve, og fortælleren
   * kan huske hvad han sagde (se NarratorState.recentSuggestions).
   *
   * Reglen er hele replikken, ikke den enkelte variant: peger én variant på en
   * opskrift, skal de alle gøre det. Ellers ville hukommelsen registrere et
   * forslag, spilleren aldrig hørte. Det er derfor `pull-kulde` ikke må nævne
   * to elementer i én variant, når de fem andre er holdt vage.
   */
  suggests?: [string, string][];
  audioId?: string;
}

export type ImprovisationEvidenceRequirement =
  | Exclude<PredicateFailure["requirement"], "crafted">
  | "fallback";

export interface NarratorImprovisationDef {
  /** Ny opfindelse løser et almindeligt problem. */
  problemSolved: string[];
  /** Ny opfindelse afværger det aktive challenge. */
  challengeSolved: string[];
  /** Absurd par, der mod al forventning løser en nød — produktets største payoff. */
  absurdSolved: string[];
  /** Ny opfindelse, som ikke løser noget; puljen vælges fra prædikatbeviset. */
  noSolution: Record<ImprovisationEvidenceRequirement, string[]>;
  /** Ingen uløst nød gav et bevis, så dommen må være bred og uden gæt. */
  noCurrentNeed: string[];
  /** Samme stabile opfindelse blev lavet igen. */
  reused: string[];
  /** Improvisationen blev stoppet før et element blev oprettet. */
  rejected: {
    canonicalRecipe: string[];
    runLimit: string[];
    verdict: {
      locked: string[];
      other: string[];
    };
    depthLimit: string[];
  };
  /**
   * Spiller-vendte ord for taksonomien. Koden må aldrig lække rå id'er eller
   * gætte en forklaring; den oversætter kun bevisets kendte værdier herfra.
   */
  labels: {
    /** Grammatiske navneordfraser pr. problem/challenge-id. */
    needs: Record<string, string>;
    kind: Record<ElementKind, string>;
    stuff: Record<ElementStuff, string>;
    traits: Record<ElementTrait, string>;
    scale: Record<ElementScale, string>;
    depth: Record<string, string>;
    list: {
      separator: string;
      finalAnd: string;
      finalOr: string;
    };
  };
}

/**
 * Fortæller-indhold pr. akt (PRD §2.4). Alle referencer er replik-id'er
 * ind i `lines`, så validatoren kan fange manglende replikker.
 */
export interface NarratorContentDef {
  act: number;
  lines: NarratorLineDef[];
  /** Replik når spilleren vender tilbage til et gemt spil */
  resumeLine?: string;
  /** Replik når en skæbne blev afværget, fordi Karl har for få opdagelser endnu */
  deflectedEndingLine?: string;
  /** Replik når fristen på et challenge er ved at løbe ud */
  challengeWarningLine?: string;
  behavior: {
    /** Elementet fortælleren driller spilleren for at spamme (Akt I: sten) */
    spamElement: string;
    /** Eskalerende spam-replikker; nøgle = antal gentagelser (PRD: 3/5/8) */
    spam: Record<string, string>;
    /** Samme kombination gentaget X gange i træk */
    repeatCombo: Record<string, string>;
    /** Streak af fiaskoer i træk */
    failStreak: Record<string, string>;
    /** Meget hurtige forsøg i træk (nøgle = streak-længde) */
    fast: Record<string, string>;
    /** Samme element kombineret med alt muligt i træk (nøgle = streak-længde) */
    elementSweep: Record<string, string>;
    /** Pulje der afspilles efter en meget lang pause */
    slow: string[];
    /** Aldrings-advarsler; nøgle = resterende somre (fx "10", "5", "1") */
    aging: Record<string, string>;
  };
  /** Flag-hukommelse: afspilles ved først mulige lejlighed når flags matcher ("Grub Man is back") */
  flagMemory: string[];
  /** Roterende pulje af generiske fiasko-replikker (aldrig samme to gange i træk) */
  genericFailure: string[];
  /**
   * Grammatikken: replikker pr. dom, så hver fiasko kan nævne præcis de to ting
   * spilleren lagde sammen. Nøglen er dommen ("clash") eller dommen plus en
   * tag-signatur ("clash:stone+plant"), og den mest specifikke vinder.
   *
   * Det er gulvet, ikke loftet: håndskrevne replikker til bestemte par slår
   * altid grammatikken, og grammatikken slår altid genericFailure — som
   * dermed bliver en nødudgang der aldrig nås i praksis.
   */
  grammar?: Record<string, string[]>;
  /**
   * Fortællerens svar når spilleren gjorde præcis det, HAN foreslog, og der
   * skete ingenting. Uden den falder øjeblikket igennem til `genericFailure`,
   * og så håner han spilleren for at adlyde sig selv. Det vender præmissen på
   * hovedet: han peger på den naturlige retning, så det bliver sjovt at trodse
   * ham — og der er intet at trodse, hvis han bare er upålidelig.
   *
   * Bruger {a} og {b} til det par, han selv sendte spilleren efter.
   */
  obeyedFailure?: string[];
  /**
   * Kontekstbro til canonical opdagelser uden eget story-beat. Binder forrige
   * og nuværende opdagelse til den næste aktive historiske retning i ét beat.
   */
  discoveryBridge?: {
    first: string[];
    continued: string[];
    needs: Record<string, string>;
  };
  /**
   * Roterende pulje til opdagelser uden håndskrevet replik. En opdagelse må
   * aldrig møde tavshed — det er spillets vigtigste øjeblik.
   * Bruger {element} til det netop opfundne.
   */
  discoveryFallback?: string[];
  /**
   * Fortællerens reaktion når spilleren opfinder noget *andet* end det, han
   * netop bad om. Nøgle = hvor mange gange spilleren har trodset ham i dette
   * run, så tonen kan eskalere fra tør bemærkning til opgivende.
   *
   * Trodsen tælles KUN på opdagelser. At fejle undervejs er ikke ulydighed
   * — det er at prøve. At opfinde noget helt andet er ulydighed.
   */
  defiance?: Record<string, string>;
  /**
   * Særlig reaktion når det trodsige fund ligger på det komiske spor
   * (`spor: "komisk"`). Mudderkagen fortjener mere end en tør bemærkning.
   */
  defianceComic?: string[];
  /** Dommen over runtime-improvisationer (plan/feature-improvised-solutions-1.md). */
  improvisation?: NarratorImprovisationDef;
}

/**
 * Et challenge: en trussel med en frist. Til forskel fra aktens valgfrie
 * problemer kan man ikke gå udenom — løber somrene ud, slutter historien.
 */
export interface ChallengeDef {
  id: string;
  emoji: string;
  title: string;
  /** Situationen, som fortælleren præsenterer den */
  line: string;
  /** Antal somre til at finde en udvej */
  turns: number;
  /**
   * Elementer der ALTID løser den, selvom prædikatet i
   * content/predicates.json ville afvise dem — en eksplicit override for
   * undtagelser prædikatet (endnu) ikke kan udtrykke (TASK-006, se
   * `resolves()` i src/core/challenge.ts). Hovedreglen er stadig prædikatet;
   * denne liste bør derfor være kort eller tom. tools/validate.py advarer,
   * hvis en post her allerede fanges af prædikatet — så listen kan krympe
   * i stedet for kun at vokse. Det historiske facit for
   * tools/predicate_report.py (alt der nogensinde er bekræftet som en
   * løsning) bor IKKE her, men i docs/design/taxonomy-ground-truth.json.
   */
  alsoSolvedBy: string[];
  /** Replik når challenget løses (bruger {element}) */
  successLine: string;
  /** Slutningen hvis fristen løber ud */
  failEnding: string;
  /** Dukker tidligst op på denne side — giver plads til at nå værktøjet */
  minPage?: number;
  /**
   * Må truslen komme igen? Uden dette tørrer puljen ud efter tre challenges,
   * og resten af livet er uden indsats. Ulve holder ikke op med at findes,
   * fordi man har set dem én gang.
   */
  repeatable?: boolean;
  /** Somre der skal gå, før den samme trussel kan vende tilbage. */
  cooldown?: number;
}

/**
 * Et svar på en beslutning, defineret pr. element-kategori.
 * `default` fanger alt andet, så ethvert element giver et meningsfuldt svar.
 */
export interface DecisionResponse {
  /** Kongens karakter, 1-5 */
  score: number;
  /** Replik-id (5+ varianter) */
  line: string;
  /** Hvor meget svaret flytter runnet i hver retning */
  tracks?: Record<string, number>;
  /** Flags svaret sætter — dét der lader ét valg lukke en anden dør */
  setsFlags?: string[];
}

/**
 * En beslutning: verden stiller Karl et spørgsmål på en fast side, og
 * spillerens næste kombination er svaret.
 */
export interface DecisionDef {
  id: string;
  emoji: string;
  title: string;
  /** Situationen — replik-id med 5+ varianter */
  line: string;
  /** Siden den altid dukker op på (10, 20, 30, 40) */
  page: number;
  /** Svar pr. element-kategori. SKAL indeholde "default". */
  responses: Record<string, DecisionResponse>;
}

export interface LifeOpeningDef {
  id: string;
  elementIds: string[];
  viabilityWitness: [string, string][];
}

export interface LifeVariationDef {
  revision: 1;
  openings: LifeOpeningDef[];
  sidequestIds: string[];
  sidequestsPerLife: number;
  challengeIds: string[];
  challengesPerLife: number;
}

export type BranchPredicate =
  | { kind: "flag"; id: string }
  | { kind: "discovery"; id: string }
  | { kind: "solvedNeed"; id: string }
  | { kind: "challengeSolved"; id: string }
  | { kind: "challengeFailed"; id: string }
  | { kind: "ending"; id: string }
  | { kind: "allOf"; predicates: BranchPredicate[] }
  | { kind: "anyOf"; predicates: BranchPredicate[] };

export interface AuthoredBranchDef {
  id: string;
  title: string;
  act: number;
  importance: "major" | "minor";
  trigger: BranchPredicate;
  replayHint: {
    label: string;
    area: string;
  };
}

export interface InventionConsequenceDef {
  id: string;
  predicateId: string;
  unlocksBranchId?: string;
  unlocksEndingId?: string;
}

export interface InventionConsequencesDef {
  schemaVersion: 1;
  rules: InventionConsequenceDef[];
}

export interface ContentMigrationsDef {
  schemaVersion: 1;
  targetRevision: string;
  supportedSourceRevisions: string[];
  elementAliases: Record<string, string>;
  branchAliases: Record<string, string>;
  endingAliases: Record<string, string>;
}

export interface CompletionManifestDef {
  schemaVersion: 1;
  contentRevision: string;
  discoveries: string[];
  branches: string[];
  endings: string[];
}

export interface ContentBundle {
  elements: ElementDef[];
  combos: ComboDef[];
  acts: ActDef[];
  narrator: NarratorContentDef[];
  endings: EndingDef[];
  challenges: ChallengeDef[];
  decisions: DecisionDef[];
  lifeVariation?: LifeVariationDef;
  branches?: AuthoredBranchDef[];
  inventionConsequences?: InventionConsequencesDef;
  completionManifest?: CompletionManifestDef;
  migrations?: ContentMigrationsDef;
  /**
   * Prædikater pr. nød-id (content/predicates.json). Nøglen er problemets
   * eller challengets id. Kommentarnøgler med _-præfiks filtreres fra ved
   * indlæsning i src/content.ts.
   */
  predicates: Record<string, SolvePredicate>;
  config: {
    /** Max antal kombinationsforsøg (somre) pr. run — derefter alderdoms-slutning */
    turnLimit: number;
    /**
     * Antal opdagelser før skæbne-kombinationer kan afslutte runnet. Under
     * grænsen sker opdagelsen, men Karl overlever — fortælleren afværger.
     * Sikrer at et første run ikke kan slutte efter fem træk.
     */
    endingsUnlockAt: number;
  };
}

/** Hvad der skete med challenget i denne tur (docs/design/challenges.md) */
export type ChallengeEvent =
  | { kind: "spawned"; def: ChallengeDef }
  | { kind: "ticking"; def: ChallengeDef; turnsLeft: number }
  | { kind: "solved"; def: ChallengeDef; by: ElementDef }
  | { kind: "failed"; def: ChallengeDef };

/** Resultat af et kombinationsforsøg (PRD §2.1 punkt 3) */
export type CombineOutcome = {
  /** Sat når turen også rørte et challenge */
  challenge?: ChallengeEvent;
} & (
  | {
      kind: "discovery";
      combo: ComboDef;
      element: ElementDef;
      solved?: ProblemDef;
      ageUp: boolean;
      /** Akten opdagelsen skete i — ved age-up er engine allerede rykket til næste akt */
      act: ActDef;
      /** Kombinationen bar en skæbne, men Karl havde for få opdagelser endnu */
      endingDeflected?: boolean;
    }
  | {
      kind: "known";
      combo: ComboDef;
      element: ElementDef;
      endingDeflected?: boolean;
    }
  | { kind: "gated"; combo: ComboDef; unsolved: ProblemDef[] }
  | {
      /**
       * De to ting smeltede ikke sammen — men motoren ved hvorfor, og siger det.
       * Erstatter det gamle { kind: "nothing" }, der ikke engang bar hvilke to
       * elementer spilleren havde prøvet. En fortæller kan ikke fortælle om
       * noget, han ikke får at vide (plan/architecture-procedural-narration-1.md).
       */
      kind: "nofuse";
      a: ElementDef;
      b: ElementDef;
      verdict: Verdict;
      evidence: VerdictEvidence;
    }
  | {
      kind: "improvised";
      element: ElementDef;
      reused: boolean;
      solved?: ProblemDef;
      ageUp: false;
      act: ActDef;
      needExplanations: NeedExplanations;
    }
  | {
      kind: "improvise-rejected";
      a: ElementDef;
      b: ElementDef;
      reason: "canonical-recipe" | "verdict" | "depth-limit" | "run-limit";
      verdict?: Verdict;
      evidence?: VerdictEvidence;
      attemptedDepth?: number;
      /** Det serialiserede run-loft, der blev nået. Kun ved run-limit. */
      limit?: number;
    });

/**
 * Hvorfor et par ikke gav noget. Prioriteret rækkefølge — første match vinder,
 * se src/core/verdict.ts.
 */
export type Verdict =
  /** Opskriften findes, men er spærret af flag eller akt. Spilleren var på sporet. */
  | "locked"
  /** Ét af elementerne indgår i en rigtig opskrift med noget spilleren allerede har. */
  | "near-miss"
  /** a + a, uden at der findes en selvopskrift. */
  | "self"
  /** Mindst ét element indgår i ingen opskrift overhovedet — en blindgyde. */
  | "inert"
  /** Taggene udelukker hinanden: varmt + vådt, levende + spiseligt uden værktøj. */
  | "clash"
  /** Et rigtig godt indfald der bare ikke er skrevet: fælles stuff, værktøj + materiale. */
  | "plausible"
  /** Langt fra hinanden i kind og scale. Karl prøvede at kombinere en sten med en tanke. */
  | "absurd";

/** Bevismaterialet bag dommen. Alt hvad fortælleren skal bruge for at lave vitsen. */
export interface VerdictEvidence {
  /** locked: de flag opskriften mangler. */
  missingFlags?: string[];
  /** locked: flag der spærrer opskriften fordi spilleren HAR dem. */
  blockingFlags?: string[];
  /** near-miss: hvilket af de to der var rigtigt, og hvem det skulle have været. */
  rightOne?: string;
  partner?: string;
  partnerResult?: string;
  /** clash: de to træk der bider hinanden, fx ["hot", "wet"]. */
  clashing?: [string, string];
  /** plausible: hvad de har til fælles, fx "stone" eller "tool+material". */
  shared?: string;
  /** inert: hvilke(t) element der ikke indgår i nogen opskrift. */
  deadEnds?: string[];
}
