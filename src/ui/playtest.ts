import { pairKey } from "../core/engine";

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
  /** Blindgyderne i netop dette run, i den rækkefølge de blev ramt */
  misses: string[];
}

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
}

function empty(): Stored {
  return { version: 1, runs: [], misses: {}, current: [] };
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

  /** Runnet er slut. Lukker blindgyderne inde i det og begynder forfra. */
  run(summary: Omit<RunRecord, "misses">): void {
    this.update((data) => {
      data.runs.push({ ...summary, misses: data.current });
      data.current = [];
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
        version: 1,
        runs: parsed.runs.map((run) => ({
          ending: run.ending,
          summers: run.summers,
          discoveries: run.discoveries,
          minutes: run.minutes,
          solved: Array.isArray(run.solved) ? run.solved : [],
          flags: Array.isArray(run.flags) ? run.flags : [],
          misses: Array.isArray(run.misses) ? run.misses : [],
        })),
        misses:
          typeof parsed.misses === "object" && parsed.misses !== null
            ? parsed.misses
            : {},
        current: Array.isArray(parsed.current)
          ? parsed.current.filter(
              (entry): entry is string => typeof entry === "string",
            )
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
