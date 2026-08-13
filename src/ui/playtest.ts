import { pairKey } from "../core/engine";
import type { InventionSummary } from "./run-summary";

/**
 * Playtest-log (ROADMAP prioritet 2).
 *
 * Alt andet ved en playtest kan rekonstrueres bagefter: hvilken slutning man
 * fik, hvor mange somre man brugte, hvad man opdagede. Det eneste der
 * forsvinder i samme sekund det sker, er hvad spilleren PRØVEDE forgæves.
 * En kombination der ikke findes er en ønskeseddel formuleret i spillerens
 * eget sprog — og ingen kan huske sine egne blindgyder tyve minutter senere,
 * allermindst mens de har det sjovt.
 *
 * Loggen har sin egen localStorage-nøgle, så "Live again" (der rydder savet)
 * ikke rydder testdataene med. Intet forlader browseren af sig selv: spilleren
 * kopierer den selv fra slutskærmen. Derfor heller ingen id'er, ingen tid på
 * døgnet, intet der peger på hvem der spillede.
 */

const KEY = "karl-playtest-v1";

/** Den lille del af localStorage vi bruger — injiceres, så testene slipper for en browser. */
export interface LogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RunRecord {
  ending: string;
  summers: number;
  discoveries: number;
  minutes: number;
  solved: string[];
  flags: string[];
  /** Dele-/runresumeet er bevidst begrænset til få navne. */
  inventions: InventionSummary;
  /** Blindgyderne i netop dette run, i den rækkefølge de blev ramt */
  misses: string[];
  /** Improvisationsforsøg i fast, persondatafrit skema. */
  improvisations: ImprovisationRecord[];
}

export interface ImprovisationRecord {
  pair: string;
  act: number;
  summer: number;
  outcome: "accepted" | "rejected" | "reused";
  solvedNeed: string | null;
  solvedChallenge: string | null;
  source: "fallback" | "worker-copy";
  latencyMs: number | null;
  timeout: boolean;
}

export type ImprovisationInput = Omit<ImprovisationRecord, "pair"> & {
  a: string;
  b: string;
};

export interface MissRecord {
  pair: string;
  count: number;
  /** Sommeren hvor forsøget blev gjort første gang */
  firstSummer: number;
}

export interface LogData {
  version: 1;
  /** Afsluttede runs, ældste først */
  runs: RunRecord[];
  /** Alle forgæves forsøg på tværs af runs, hyppigste først */
  misses: MissRecord[];
}

interface Stored {
  version: 1;
  runs: RunRecord[];
  misses: Record<string, { count: number; firstSummer: number }>;
  /** Blindgyder i det igangværende run — flyttes til runs[] når det slutter */
  current: string[];
  /** Samme for improvisationsforsøg; gemmes også midt i et run. */
  currentImprovisations: ImprovisationRecord[];
}

function empty(): Stored {
  return {
    version: 1,
    runs: [],
    misses: {},
    current: [],
    currentImprovisations: [],
  };
}

export class PlaytestLog {
  constructor(private readonly storage: LogStorage = localStorage) {}

  /** Et forsøg der ikke gav noget. `summer` er forsøgsnummeret det skete på. */
  miss(a: string, b: string, summer: number): void {
    this.update((data) => {
      const key = pairKey(a, b);
      const seen = data.misses[key];
      if (seen) seen.count++;
      else data.misses[key] = { count: 1, firstSummer: summer };
      data.current.push(key);
    });
  }

  improvisation(record: ImprovisationInput): void {
    this.update((data) => {
      data.currentImprovisations.push({
        pair: pairKey(record.a, record.b),
        act: record.act,
        summer: record.summer,
        outcome: record.outcome,
        solvedNeed: record.solvedNeed,
        solvedChallenge: record.solvedChallenge,
        source: record.source,
        latencyMs: record.latencyMs,
        timeout: record.timeout,
      });
    });
  }

  /** Sen latency/timeout må føjes til forsøget uden at ændre dets udfald. */
  improvisationNetwork(
    a: string,
    b: string,
    act: number,
    summer: number,
    network: { latencyMs: number; timeout: boolean },
  ): void {
    this.update((data) => {
      const pair = pairKey(a, b);
      const current = [...data.currentImprovisations]
        .reverse()
        .find(
          (entry) =>
            entry.pair === pair &&
            entry.act === act &&
            entry.summer === summer,
        );
      const completed = [...data.runs]
        .reverse()
        .flatMap((run) => [...run.improvisations].reverse())
        .find(
          (entry) =>
            entry.pair === pair &&
            entry.act === act &&
            entry.summer === summer,
        );
      const target = current ?? completed;
      if (!target) return;
      target.latencyMs = network.latencyMs;
      target.timeout = network.timeout;
    });
  }

  /** Runnet er slut. Lukker blindgyderne inde i det og begynder forfra. */
  run(summary: Omit<RunRecord, "misses" | "improvisations">): void {
    this.update((data) => {
      data.runs.push({
        ...summary,
        misses: data.current,
        improvisations: data.currentImprovisations,
      });
      data.current = [];
      data.currentImprovisations = [];
    });
  }

  /** Loggen som den skal deles: sorteret, uden intern bogføring. */
  read(): LogData {
    const data = this.load();
    return {
      version: 1,
      runs: data.runs,
      misses: Object.entries(data.misses)
        .map(([pair, m]) => ({ pair, count: m.count, firstSummer: m.firstSummer }))
        .sort((x, y) => y.count - x.count || x.firstSummer - y.firstSummer),
    };
  }

  private load(): Stored {
    const raw = this.storage.getItem(KEY);
    if (!raw) return empty();
    try {
      const parsed = JSON.parse(raw) as Stored;
      // Et halvskrevet eller ældre format må aldrig kunne stoppe et run.
      // Instrumentet er mindre vigtigt end spillet det måler.
      if (parsed?.version !== 1 || !Array.isArray(parsed.runs)) return empty();
      return {
        ...empty(),
        ...parsed,
        runs: parsed.runs.map((run) => ({
          ...run,
          inventions: run.inventions ?? { total: 0, names: [] },
          misses: Array.isArray(run.misses) ? run.misses : [],
          improvisations: Array.isArray(run.improvisations)
            ? run.improvisations
            : [],
        })),
        current: Array.isArray(parsed.current) ? parsed.current : [],
        currentImprovisations: Array.isArray(parsed.currentImprovisations)
          ? parsed.currentImprovisations
          : [],
      };
    } catch {
      return empty();
    }
  }

  private update(mutate: (data: Stored) => void): void {
    const data = this.load();
    mutate(data);
    try {
      this.storage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Privat browsing kan nægte at skrive. Så mister vi dataene — men
      // spilleren mærker det ikke, og det er den rigtige prioritering.
    }
  }
}
