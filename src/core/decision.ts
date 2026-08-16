import type { ContentBundle, DecisionDef, ElementDef } from "./types";

/**
 * Decisions (docs/design/decisions.md).
 *
 * Fire faste øjeblikke — side 10, 20, 30 og 40 — hvor verden stiller Karl et
 * spørgsmål, og spillerens næste kombination er svaret. Til forskel fra
 * challenges kan man ikke tabe; man kan kun vælge, og valget flytter runnet
 * i en retning.
 *
 * Kernen i designet: **etiketten sidder på elementet, ikke på kombinationen.**
 * 187 elementer × 4 beslutninger ville være 748 håndskrevne svar. I stedet
 * svarer beslutningen på elementets kategori (`tag`), så otte-ti replikker
 * pr. beslutning dækker hele spillet — og det føles stadig skrevet til
 * netop det valg. Giver man de sultne et stykke træ, rammer man
 * `materiale`-svaret: de blev ikke mætte, men de kan da varme sig.
 */

/** Retninger et run kan bevæge sig i. Summen afgør hvilke skæbner der er i spil. */
export type Track = "helgen" | "tyran" | "konge" | "kunstner" | "vismand";

export interface DecisionRecord {
  id: string;
  /** Elementet spilleren svarede med */
  answeredWith: string;
  /** Kategorien der afgjorde svaret */
  tag: string;
  /** Kongens karakter, 1-5 */
  score: number;
}

export interface DecisionState {
  /** Beslutninger der er truffet, i rækkefølge */
  taken: DecisionRecord[];
  /** Beslutningen der venter på et svar — null når ingen er i gang */
  pending: string | null;
}

export function freshDecisionState(): DecisionState {
  return { taken: [], pending: null };
}

export type Tracks = Record<Track, number>;

export function emptyTracks(): Tracks {
  return { helgen: 0, tyran: 0, konge: 0, kunstner: 0, vismand: 0 };
}

/** Hvilken beslutning hører til denne side? */
export function decisionForPage(
  content: ContentBundle,
  page: number,
  taken: DecisionRecord[],
): DecisionDef | null {
  const takenIds = new Set(taken.map((record) => record.id));
  return (
    content.decisions
      .filter((decision) => decision.page <= page && !takenIds.has(decision.id))
      .sort(
        (left, right) =>
          left.page - right.page || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

/**
 * Afgør svaret på en beslutning ud fra elementets kategori.
 * Falder tilbage på `default`, så ethvert element giver et meningsfuldt svar
 * — også de absurde, som er halvdelen af morskaben.
 */
export function resolveAnswer(
  decision: DecisionDef,
  element: ElementDef,
): { tag: string; score: number; line: string; tracks: Partial<Tracks>; setsFlags: string[] } {
  const tag = element.tag ?? "materiale";
  const r = decision.responses[tag] ?? decision.responses["default"]!;
  return {
    tag: decision.responses[tag] ? tag : "default",
    score: r.score,
    line: r.line,
    tracks: r.tracks ?? {},
    setsFlags: r.setsFlags ?? [],
  };
}

/** Summér sporene ud fra de trufne beslutninger. */
export function tallyTracks(
  content: ContentBundle,
  taken: DecisionRecord[],
): Tracks {
  const out = emptyTracks();
  for (const rec of taken) {
    const def = content.decisions.find((d) => d.id === rec.id);
    const r = def?.responses[rec.tag];
    for (const [k, v] of Object.entries(r?.tracks ?? {})) {
      out[k as Track] += v;
    }
  }
  return out;
}

/**
 * Det spor runnet hælder mest til — null hvis der er uafgjort eller intet
 * er valgt endnu. Uafgjort betyder bevidst "ingen retning": har man spillet
 * halvt helgen og halvt tyran, har man ikke fortjent nogen af delene.
 */
export function dominantTrack(tracks: Tracks): Track | null {
  const entries = Object.entries(tracks) as [Track, number][];
  const max = Math.max(...entries.map(([, v]) => v));
  if (max <= 0) return null;
  const leaders = entries.filter(([, v]) => v === max);
  return leaders.length === 1 ? leaders[0]![0] : null;
}

/** Kongens samlede dom: sum af karaktererne, og hvor mange der var mulige. */
export function verdict(taken: DecisionRecord[], total: number) {
  const score = taken.reduce((s, t) => s + t.score, 0);
  return { score, max: total * 5, decisions: taken.length };
}
