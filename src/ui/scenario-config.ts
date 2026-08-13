export type ScenarioName = "title-fresh" | "act1-opening";

export interface ScenarioSpec {
  /** Menneskelæsbar begrundelse — hvilken reference svarer scenariet til */
  readonly reference: string;
  /** Skal spillet starte (titelskærmen væk), eller bliver vi på titelskærmen? */
  readonly start: boolean;
  /** Fortællerlinjen der skal stå i boblen. */
  readonly narratorText?: string;
  /** Hvilket tip-kort titelskærmen står på. */
  readonly tipIndex?: number;
  /** Scenarie-only inventar, når referencebilledet viser en ældre åbning. */
  readonly discovered?: readonly string[];
  /** Problemchips der må stå i den visuelle optagelse. */
  readonly visibleProblemIds?: readonly string[];
  /** Elementer der fjernes fra scenariets DOM efter render. */
  readonly hiddenSelectors?: readonly string[];
  /** Historisk tæller fra referencebilledet, når indholdsmængden siden er vokset. */
  readonly timelineLabel?: string;
  /** Bevar referencebilledets tomme krønike, selv om scenariet viser gamle baseelementer. */
  readonly blankChronicle?: boolean;
}

/**
 * Scenarierne svarer 1:1 til filerne i docs/design/reference/. De må gerne
 * fastholde referencebilledets historiske indholdstilstand: dommeren måler
 * form og hud, ikke hvor mange features der er tilføjet siden billedet.
 */
export const SCENARIOS: Readonly<Record<ScenarioName, ScenarioSpec>> = {
  "title-fresh": {
    reference: "docs/design/reference/title-2026-08-11.webp",
    start: false,
    tipIndex: 0,
  },
  "act1-opening": {
    reference: "docs/design/reference/target-2026-08-11.webp",
    start: true,
    narratorText:
      "Every great story begins somewhere. This one begins with a shivering man " +
      "staring at a rock as if it owed him money. Onward, humanity.",
    discovered: [
      "sten",
      "pind",
      "graes",
      "vand",
      "ler",
      "baer",
      "larver",
      "dyr",
      "stamme",
      "nabo",
      "fugl",
    ],
    visibleProblemIds: ["kulde", "vaerktoej", "sult"],
    hiddenSelectors: ["#filter-done"],
    timelineLabel: "0/174",
    blankChronicle: true,
  },
};

/** En tom scenariekrønike må aldrig vise en levende graf under sin 0-tæller. */
export function scenarioTimelineOpen(
  requested: boolean,
  scenario: ScenarioSpec | undefined,
): boolean {
  return scenario?.blankChronicle ? false : requested;
}
