/**
 * Fortællerens tredje kilde til ord: en model, der skriver replikken til
 * præcis DE to ting, i det øjeblik spilleren vælger dem.
 *
 * Hvorfor overhovedet:
 *   Akt 1 har 185 elementer. Det er 17.205 mulige par. Vi har skrevet 400 af
 *   dem i hånden, og de dækker tre fjerdedele af alt hvad spillere faktisk
 *   møder — men halen er uendelig, og det er netop i halen, spilleren leder,
 *   når han er kørt fast. Grammatikken dækker resten og er god, men den kender
 *   kun dommen og taggene. Den kan ikke vide, at det ER en tromme og en bæk.
 *
 * De tre jernregler:
 *   1. Den må ALDRIG få spillet til at vente. react() er synkron og bliver
 *      det. Kaldet her sker på forhånd — i det sekund begge felter er fyldt,
 *      altså mens spilleren stadig flytter hånden mod knappen.
 *   2. Den må ALDRIG kunne fejle synligt. Er svaret ikke kommet, taler
 *      grammatikken, præcis som før. Ingen spinner, ingen tom boble, ingen
 *      forskel at få øje på.
 *   3. Den må ALDRIG spørge om det samme to gange. Svaret lægges i
 *      localStorage under par + dom og overlever genindlæsning.
 *
 * Er der ingen endpoint sat op, gør hele modulet ingenting. Spillet er
 * fuldstændig komplet uden — det er en forbedring, ikke en afhængighed.
 */

import type { ElementDef } from "../core/types";

/** Sat ved build (VITE_NARRATOR_URL). Tom = laget er slået fra. */
const ENDPOINT = (import.meta.env?.VITE_NARRATOR_URL as string | undefined) ?? "";

const CACHE_KEY = "karl.live.v1";
/** Efter dette venter vi ikke længere — grammatikken har allerede talt. */
const TIMEOUT_MS = 8000;
/** Loft på hvad vi gemmer, så en lang spiller ikke fylder localStorage. */
const MAX_CACHED = 500;

export interface LiveRequest {
  a: ElementDef;
  b: ElementDef;
  verdict: string;
  /** Hvad Karl mangler lige nu — giver replikken noget at spille op imod. */
  need?: string;
  /** Sommer nummer, så en replik kan lyde ung eller træt. */
  summer?: number;
}

export class LiveNarrator {
  private cache = new Map<string, string>();
  /** Kald i luften, så to hurtige valg af samme par kun spørger én gang. */
  private inFlight = new Map<string, Promise<string | undefined>>();
  private failures = 0;

  constructor(private readonly endpoint: string = ENDPOINT) {
    this.load();
  }

  /** Slået til? Uden endpoint eksisterer laget ikke. */
  get enabled(): boolean {
    // Tre fejl i træk og vi holder op med at prøve resten af sessionen. Et
    // dødt endpoint skal ikke koste en netværkstur pr. tur i al evighed.
    return this.endpoint !== "" && this.failures < 3;
  }

  private key(a: string, b: string, verdict: string): string {
    return `${[a, b].sort().join("+")}:${verdict}`;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        this.cache.set(k, v);
      }
    } catch {
      // Ødelagt eller utilgængelig storage er ikke værd at vælte spillet for.
    }
  }

  private persist(): void {
    try {
      // Nyeste vinder, når loftet er nået: de par spilleren leger med nu, er
      // dem han møder igen om lidt.
      const entries = [...this.cache.entries()].slice(-MAX_CACHED);
      this.cache = new Map(entries);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Fuld storage: så lever cachen bare i hukommelsen denne session.
    }
  }

  /**
   * Replikken, hvis den ligger klar. Synkron med vilje — det er dette kald
   * fortælleren laver midt i sin egen kæde, og han venter aldrig.
   */
  get(a: string, b: string, verdict: string): string | undefined {
    return this.cache.get(this.key(a, b, verdict));
  }

  /**
   * Bed om replikken nu, så den kan nå frem inden spilleren trykker.
   *
   * Kaldes når begge felter er fyldt. Der går typisk et sekund eller mere,
   * før hånden når knappen — rigeligt til en kort tur over nettet, og er den
   * ikke nået, sker der ingenting.
   */
  async prefetch(req: LiveRequest): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    const key = this.key(req.a.id, req.b.id, req.verdict);
    const known = this.cache.get(key);
    if (known) return known;
    const busy = this.inFlight.get(key);
    if (busy) return busy;

    const p = this.fetchLine(req)
      .then((text) => {
        if (text) {
          this.cache.set(key, text);
          this.persist();
          this.failures = 0;
        }
        // Bemærk: en replik der blev kasseret af clean() tæller IKKE som fejl.
        // At afvise en dårlig sætning er normal drift — grammatikken står
        // klar, og laget skal blive ved med at prøve næste par.
        return text;
      })
      .catch(() => {
        this.failures++;
        return undefined;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, p);
    return p;
  }

  private async fetchLine(req: LiveRequest): Promise<string | undefined> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          a: describe(req.a),
          b: describe(req.b),
          verdict: req.verdict,
          need: req.need,
          summer: req.summer,
        }),
      });
      if (!res.ok) {
        // Kastes frem for at returnere tomt: et endpoint der svarer dårligt
        // er en fejl, og fejl skal tælles, så et dødt endpoint holder op med
        // at koste en netværkstur pr. forsøg resten af sessionen.
        throw new Error(`narrator ${res.status}`);
      }
      const data = (await res.json()) as { text?: string };
      return clean(data.text, req.a, req.b);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Det modellen får at vide om en ting. Samme felter som skribenterne fik. */
function describe(e: ElementDef) {
  return {
    name: e.name,
    kind: e.kind,
    stuff: e.stuff,
    scale: e.scale,
    traits: e.traits ?? [],
    flavor: e.flavor,
    karlMood: e.karlMood,
  };
}

/**
 * Sidste kontrol før en fremmed sætning får lov at være fortælleren.
 *
 * Modellen kan finde på at svare med anførselstegn, en overskrift, tre
 * afsnit eller et navn den selv har fundet på. Alt det er lettere at afvise
 * end at rette: grammatikken står klar og er god, så en tvivlsom replik har
 * ingen værdi. Reglerne er de samme, som skribenterne blev målt på.
 */
function clean(
  text: string | undefined,
  a: ElementDef,
  b: ElementDef,
): string | undefined {
  if (!text) return undefined;
  const t = text.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
  if (t.length < 20 || t.length > 320) return undefined;
  if (t.includes("\n")) return undefined;
  // Begge ting SKAL nævnes — det er hele grunden til at spørge en model i
  // stedet for at lade grammatikken tale.
  const lower = t.toLowerCase();
  if (!lower.includes(a.name.toLowerCase())) return undefined;
  if (!lower.includes(b.name.toLowerCase())) return undefined;
  // Pladsholdere hører til de bagte replikker; her er der ingen til at udfylde.
  if (/\{[a-z]+\}/i.test(t)) return undefined;
  return t;
}
