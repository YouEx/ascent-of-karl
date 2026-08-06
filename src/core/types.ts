/** Datamodel for alt indhold. ALT indhold ligger i JSON — aldrig hardcodet (PRD §4.1). */

export interface ElementDef {
  id: string;
  /** Visningsnavn på dansk */
  name: string;
  /** Midlertidigt ikon indtil illustrationer (Step 4) */
  emoji: string;
  /** Hvilken akt elementet hører til (elementpulje pr. epoke, PRD §2.3) */
  act: number;
  /** Base-elementer er tilgængelige fra aktens start */
  base?: boolean;
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
  /** Problem-id som denne opdagelse løser (PRD §2.1) */
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
}

export interface ProblemDef {
  id: string;
  name: string;
  /** Sådan præsenteres problemet i historien ("Karl fryser") */
  description: string;
  /** Obligatoriske problemer gater age-up (blødt gate, PRD §2.3) */
  required: boolean;
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
 * (sweep-elementets navn) — udfyldes med små bogstaver.
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
  audioId?: string;
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
}

export interface ContentBundle {
  elements: ElementDef[];
  combos: ComboDef[];
  acts: ActDef[];
  narrator: NarratorContentDef[];
  endings: EndingDef[];
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

/** Resultat af et kombinationsforsøg (PRD §2.1 punkt 3) */
export type CombineOutcome =
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
  | { kind: "nothing" };
