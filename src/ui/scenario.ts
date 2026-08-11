/**
 * Scenarier — deterministisk spiltilstand til den visuelle dommer.
 *
 * Baggrund: et skærmbillede kan ikke sammenlignes med en reference, medmindre
 * spillet står i PRÆCIS referencens tilstand. Skrivemaskineeffekten alene gør
 * to på hinanden følgende optagelser forskellige, og tip-karrusellen på
 * titelskærmen skifter kort hvert par sekunder. Uden dette modul måler
 * tools/judge/ tilfældig støj i stedet for afstanden til referencen.
 *
 * Aktiveres udelukkende via URL (`?scenario=…&freeze=1`). En spiller rammer
 * aldrig disse stier: uden parametrene er hver funktion her en no-op.
 *
 * Se plan/architecture-visual-judge-1.md fase 1 (TASK-002 til TASK-006).
 */

export type ScenarioName = "title-fresh" | "act1-opening";

export interface ScenarioSpec {
  /** Menneskelæsbar begrundelse — hvilken reference svarer scenariet til */
  readonly reference: string;
  /** Skal spillet starte (titelskærmen væk), eller bliver vi på titelskærmen? */
  readonly start: boolean;
  /**
   * Fortællerlinjen der skal stå i boblen. Sættes DIREKTE i stedet for at
   * spille sig frem: at klikke sig til en bestemt linje er både langsomt og
   * skrøbeligt, og en fejlet klikvej ville give en tavs, forkert måling.
   */
  readonly narratorText?: string;
  /** Hvilket tip-kort titelskærmen står på (referencen viser det første) */
  readonly tipIndex?: number;
}

/**
 * Scenarierne svarer 1:1 til filerne i docs/design/reference/. Tilføjes en ny
 * reference, skal den have et scenarie her — ellers kan den ikke måles.
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
  },
};

/**
 * Fast seed under frysning. Spillet trækker to tilfældige tal ved opstart
 * (challenge-seed og fortællerens variantvalg); begge skal være låst, ellers
 * er to optagelser af samme scenarie forskellige.
 */
export const FROZEN_SEED = 20260811;

interface Flags {
  readonly scenario?: ScenarioName;
  readonly freeze: boolean;
}

function readFlags(): Flags {
  // Kan smide i sandkassede iframes uden URL-adgang; et scenarie er aldrig
  // vigtigere end at spillet starter.
  try {
    const q = new URLSearchParams(window.location.search);
    const name = q.get("scenario");
    const known = name && name in SCENARIOS ? (name as ScenarioName) : undefined;
    if (name && !known) {
      console.warn(`[scenario] ukendt scenarie "${name}" — ignoreret`);
    }
    return { scenario: known, freeze: q.get("freeze") === "1" };
  } catch {
    return { freeze: false };
  }
}

const flags = readFlags();

/** Er bevægelse frosset? Sand kun under `?freeze=1`. */
export function isFrozen(): boolean {
  return flags.freeze;
}

// Sættes med det samme, ikke i en funktion: CSS-reglen [data-freeze] skal
// gælde allerede før den første stylesheet-anvendelse, ellers når en
// indgangs-animation at køre et par rammer og forurener optagelsen.
if (flags.freeze) {
  document.documentElement.dataset.freeze = "true";
}

/** Det aktive scenarie, eller undefined i normalt spil. */
export function activeScenario(): ScenarioSpec | undefined {
  return flags.scenario ? SCENARIOS[flags.scenario] : undefined;
}

/** Navnet på det aktive scenarie, til logning. */
export function activeScenarioName(): ScenarioName | undefined {
  return flags.scenario;
}

/**
 * Seed til enhver RNG i opstartsstien. Under frysning er den fast, ellers
 * tilfældig som før. Kaldes i stedet for `Math.random()` direkte.
 */
export function bootSeed(): number {
  return flags.freeze ? FROZEN_SEED : (Math.random() * 2 ** 31) | 0;
}

/**
 * Rydder gemte spil, så scenariet ikke arver browserens historik. En maskine
 * med et halvspillet run ville ellers måle noget helt andet end en ren.
 */
export function resetStorageForScenario(keys: readonly string[]): void {
  if (!flags.scenario) return;
  for (const k of keys) localStorage.removeItem(k);
}

/**
 * Venter til siden reelt er tegnet færdig, og sætter så `data-ready` på
 * <html>. Harnessen venter på DET flag frem for en fast timeout — en timeout
 * er et gæt, et flag er et faktum.
 *
 * CSS-baggrundsbilleder tælles med. Det er hele titelskærmens kunst, og den
 * findes ikke i `document.images`; ventede vi kun på <img>, ville vi optage
 * en tom parchment-flade og kalde det en måling.
 */
export async function markReadyWhenPainted(): Promise<void> {
  await documentFontsReady();
  await Promise.all([decodeInlineImages(), decodeBackgroundImages()]);
  // To rammer: den første lader layoutet sætte sig efter dekodningen, den
  // anden lader browseren male det.
  await nextFrame();
  await nextFrame();
  document.documentElement.dataset.ready = "true";
}

async function documentFontsReady(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* fonts-API mangler: ikke værd at fejle en optagelse på */
  }
}

async function decodeInlineImages(): Promise<void> {
  await Promise.all(
    Array.from(document.images).map((img) =>
      img.decode().catch(() => undefined),
    ),
  );
}

async function decodeBackgroundImages(): Promise<void> {
  const urls = new Set<string>();
  for (const node of document.querySelectorAll<HTMLElement>("*")) {
    const bg = getComputedStyle(node).backgroundImage;
    if (!bg || bg === "none") continue;
    for (const m of bg.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const url = m[2];
      if (url) urls.add(url);
    }
  }
  await Promise.all(
    Array.from(urls).map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
