/**
 * Stemmedommer, TS-port af `tools/voice/judge.py` + `tools/voice/metrics.py`
 * — TASK-007 (plan/feature-live-narrator-1.md, fase 3).
 *
 * Python er facit. Denne fil er en linje-for-linje-tro oversættelse af de
 * samme funktioner, ALDRIG en "ligner nok"-tilnærmelse — se
 * `tools/voice/export_voice_parity_fixture.py` og
 * `tests/worker-voice-parity.test.ts`, som beviser det tal for tal over
 * 866 håndskrevne + 312 grammatik + 908 bagte par + syntetiske cases.
 *
 * Ingen ordlister/tærskler/fordelinger er duplikeret her som prosa-
 * konstanter — alt data kommer fra `../generated/voice-profile.json`
 * (genereret af `tools/voice/export_worker_profile.py`). Denne fil
 * indeholder kun ALGORITMEN, som skal matche Python's, plus typerne for
 * profilen.
 *
 * Tre kilde-specifikke afvigelser fra en naiv 1:1-oversættelse — bevidst
 * bevaret, se judge.py's docstrings for den fulde begrundelse:
 *  1. `classifyTense`: nutid/datid-optælling er TO UAFHÆNGIGE summer over
 *     samme ordliste, ikke en if/else if — et ord kan tælle med i BEGGE.
 *  2. `hardReject`: forbiddenConstructions matches som ren substring;
 *     modernVocabulary matches på ORDGRÆNSE for enkeltord (undgår fx "ok" i
 *     "broken"), substring for flerords-udtryk. De to lister bruger bevidst
 *     FORSKELLIG matching-strategi — ikke en fejl, se judge.py.
 *  3. `_punctuationRates`: period/exclaim/question/ellipsis tælles på
 *     ELLIPSE-NORMALISERET tekst; emdash/comma/colonSemicolon tælles på den
 *     RÅ, oprindelige tekst.
 */

export interface Distribution {
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface PunctuationDistributions {
  period: Distribution;
  exclaim: Distribution;
  question: Distribution;
  emdash: Distribution;
  comma: Distribution;
  colonSemicolon: Distribution;
  ellipsis: Distribution;
}

export interface VoiceProfile {
  version: number;
  hash: string;
  hardMaxSentences: number;
  hardMaxWords: number;
  threshold: { percentile: string; value: number };
  distributions: {
    wordLengthPerLineMean: Distribution;
    sentencesPerLine: Distribution;
    wordsPerLine: Distribution;
    presentTensePerLineShare: Distribution;
    punctuationPer100Words: PunctuationDistributions;
    vocabularyLeaveOneOutNovelty: Distribution;
  };
  pairsWordCountBand: Distribution;
  lexicon: {
    forbiddenConstructions: string[];
    modernVocabulary: string[];
    genericPunchlineExemptions: string[];
    presentTenseMarkers: string[];
    pastTenseMarkers: string[];
  };
  corpusVocabulary: string[];
  domainVocabulary: string[];
  punchlines: string[];
}

/** `source="pairs"` slår sætnings-/ordtalslofterne fra i hardReject() og
 * skifter wordCount-dimensionens sammenligningsbånd i score() — se
 * judge.py's `hard_reject`/`score` docstrings. Live-tekst dømmes altid som
 * "grammar" (opgavens ordret krav: "Live text gets source=grammar
 * semantics") — der findes bevidst ingen tredje `"live"`-værdi her. */
export type Source = "grammar" | "pairs";

export interface Dimensions {
  wordLength: number;
  sentenceCount: number;
  wordCount: number;
  vocabulary: number;
  presentTense: number;
  punctuation: number;
}

export interface JudgeResult {
  text: string;
  hardRejects: string[];
  dimensions: Dimensions;
  overall: number;
  presentShareDecidable: boolean;
}

const EPS = 1e-9;
const HARD_REJECT_ELLIPSIS_RE = /\.\.\.+|…/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'])/;
const WORD_RE = /[A-Za-z']+/g;
const PAST_ED_RE = /^[a-z]{2,}ed$/;
const PUNCT_CHANNELS = ["period", "exclaim", "question", "emdash", "comma", "colonSemicolon", "ellipsis"] as const;

/** De eneste pladsholdere det håndskrevne korpus selv bruger (metrics.py's
 * `CORPUS_FILLERS`) — bruges KUN inde i `normalizePunchline` (samme sted
 * Python bruger den), ikke et generelt renselag for kandidattekst (den
 * opgave varetages allerede af `clean.ts` FØR stemmedommeren kaldes). */
const CORPUS_FILLERS: Record<string, string> = { a: "stone", b: "grass", element: "stone" };

/** Python's `str.strip("'")`: fjerner ALLE ledende/afsluttende apostroffer,
 * ikke kun én. */
function stripApostrophes(word: string): string {
  return word.replace(/^'+/, "").replace(/'+$/, "");
}

/**
 * Ordliste uden omgivende tegnsætning. `Karl.` bliver til `Karl`, `'advance`
 * til `advance` — apostrof i ordets krop (don't, Karl's) bevares. Direkte
 * port af metrics.py's `tokenize_words`.
 */
export function tokenizeWords(text: string): string[] {
  const matches = text.match(WORD_RE) ?? [];
  const out: string[] = [];
  for (const m of matches) {
    const stripped = stripApostrophes(m);
    if (stripped) out.push(stripped);
  }
  return out;
}

/**
 * Sætninger i en replik-variant. Ellipsen ("..." eller "…") normaliseres til
 * ét enkelt "…"-tegn FØR opdelingen, så "He... he's breeding" ikke tælles
 * som to sætninger — den er en pause, ikke en afslutning. Direkte port af
 * metrics.py's `split_sentences`.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(HARD_REJECT_ELLIPSIS_RE, "…");
  const parts = normalized.split(SENTENCE_SPLIT_RE);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Grov, gennemsigtig heuristik — IKKE en rigtig grammatisk parser. Tæller
 * nutids- og datids-markører pr. sætning og lader flertallet afgøre.
 *
 * VIGTIGT (parity): `present` og `past` er to UAFHÆNGIGE summer over samme
 * ordliste — et ord kan tælle med i begge (fx hvis det både står i
 * presentTenseMarkers OG matcher PAST_ED_RE af en tilfældighed). Direkte
 * port af judge.py's `classify_tense` — ÆNDR ALDRIG dette til if/else if.
 */
export function classifyTense(sentence: string, presentMarkers: Set<string>, pastMarkers: Set<string>): "present" | "past" | "neutral" {
  const words = tokenizeWords(sentence).map((w) => w.toLowerCase());
  let present = 0;
  for (const w of words) {
    if (presentMarkers.has(w)) present++;
  }
  let past = 0;
  for (const w of words) {
    if (pastMarkers.has(w) || (PAST_ED_RE.test(w) && !presentMarkers.has(w))) past++;
  }
  if (present === 0 && past === 0) return "neutral";
  return present >= past ? "present" : "past";
}

/** Erstat {a}/{b}/{element} med et repræsentativt ord, som `fill()` i
 * `narrator.ts` gør. Direkte port af metrics.py's `fill_placeholders` med
 * dens `CORPUS_FILLERS`-standard (den eneste variant `normalize_punchline`
 * selv bruger). */
export function fillPlaceholders(text: string): string {
  let out = text;
  for (const [key, val] of Object.entries(CORPUS_FILLERS)) {
    out = out.split(`{${key}}`).join(val);
  }
  return out;
}

/** Nøgle til genbrugstjek: sidste sætning, fyldt, uden overflødig
 * tegnsætning. Direkte port af metrics.py's `normalize_punchline`. */
export function normalizePunchline(sentence: string): string {
  let text = fillPlaceholders(sentence).toLowerCase().trim();
  text = text.replace(/[.!?…]+$/, "");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

/**
 * Selvkalibreret spredning: prøv tiers i rækkefølge, brug den første der
 * faktisk er større end 0. Falder tilbage til 1.0 hvis dimensionen slet
 * ingen varians har. Direkte port af judge.py's `_spread`.
 */
export function spread(dist: Distribution, centerKey: keyof Distribution, tierKeys: readonly (keyof Distribution)[]): number {
  const center = dist[centerKey];
  for (const key of tierKeys) {
    const s = Math.abs(dist[key] - center);
    if (s > EPS) return s;
  }
  return 1.0;
}

/** 1.0 i korpusets midterste 80 %-bånd [p10,p90]; aftagende udenfor. Direkte
 * port af judge.py's `range_score`. */
export function rangeScore(x: number, dist: Distribution): number {
  const lo = dist.p10;
  const hi = dist.p90;
  if (lo <= x && x <= hi) return 1.0;
  if (x < lo) {
    const s = spread(dist, "p50", ["p10", "p25"]);
    return Math.exp(-(lo - x) / s);
  }
  const s = spread(dist, "p50", ["p90", "p95", "max"]);
  return Math.exp(-(x - hi) / s);
}

/** Ensidet udgave af rangeScore: kun EFTER p90 straffes. Direkte port af
 * judge.py's `novelty_score`. */
export function noveltyScore(x: number, dist: Distribution): number {
  const hi = dist.p90;
  if (x <= hi) return 1.0;
  const s = spread(dist, "p50", ["p90", "p95", "max"]);
  return Math.exp(-(x - hi) / s);
}

export interface PunctuationRates {
  period: number;
  exclaim: number;
  question: number;
  emdash: number;
  comma: number;
  colonSemicolon: number;
  ellipsis: number;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * period/exclaim/question/ellipsis tælles på ELLIPSE-NORMALISERET tekst;
 * emdash/comma/colonSemicolon tælles på den RÅ, oprindelige tekst — direkte
 * port af judge.py's `_punctuation_rates` (bevidst asymmetri, se filens
 * top-kommentar).
 */
export function punctuationRates(text: string): PunctuationRates {
  const nWords = Math.max(tokenizeWords(text).length, 1);
  const normalized = text.replace(HARD_REJECT_ELLIPSIS_RE, "…");
  return {
    period: (100 * countOccurrences(normalized, ".")) / nWords,
    exclaim: (100 * countOccurrences(normalized, "!")) / nWords,
    question: (100 * countOccurrences(normalized, "?")) / nWords,
    emdash: (100 * countOccurrences(text, "—")) / nWords,
    comma: (100 * countOccurrences(text, ",")) / nWords,
    colonSemicolon: (100 * (countOccurrences(text, ":") + countOccurrences(text, ";"))) / nWords,
    ellipsis: (100 * countOccurrences(normalized, "…")) / nWords,
  };
}

/** Direkte port af judge.py's `_novelty_fraction`. */
export function noveltyFraction(text: string, knownVocabulary: Set<string>): number {
  const tokens = tokenizeWords(text).map((w) => w.toLowerCase());
  if (tokens.length === 0) return 0.0;
  let novel = 0;
  for (const w of tokens) {
    if (!knownVocabulary.has(w)) novel++;
  }
  return novel / tokens.length;
}

/** Samme afrunding som Python's `round(x, 4)` op til flydende-tal-tolerancen
 * dokumenteret i opgaven (1e-4) — se tests/worker-voice-parity.test.ts'
 * top-kommentar for hvorfor en sjælden .5-grænse-uenighed er uden betydning
 * her (banker's rounding vs. "round half away from zero"). */
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Escapes et bogstaveligt sub-mønster til brug inde i en RegExp — ingen
 * afhængighed af `RegExp.escape` (endnu ikke bredt tilgængelig i alle
 * Workers-runtime-versioner). */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledModernVocabulary {
  phrase: string;
  pattern: RegExp;
}

/**
 * Alt der er forud-udledt af profilen ÉN gang, ikke pr. kald — hverken en
 * ren funktionel besparelse eller en semantisk ændring, blot at undgå at
 * genopbygge de samme Sets/RegExp-mønstre for hver af de op til 2101
 * paritets-cases (og for hver rigtig kandidatreplik i produktion).
 */
export interface VoiceScorer {
  readonly profile: VoiceProfile;
  judgeLine(text: string, source?: Source): JudgeResult;
  passesVoiceGate(text: string, source?: Source): boolean;
}

export function createScorer(profile: VoiceProfile): VoiceScorer {
  const presentTenseMarkers = new Set(profile.lexicon.presentTenseMarkers);
  const pastTenseMarkers = new Set(profile.lexicon.pastTenseMarkers);
  const genericPunchlineExemptions = new Set(profile.lexicon.genericPunchlineExemptions);
  const punchlineSet = new Set(profile.punchlines);
  const knownVocabulary = new Set<string>([...profile.corpusVocabulary, ...profile.domainVocabulary]);
  const forbiddenConstructions = profile.lexicon.forbiddenConstructions.map((phrase) => ({
    phrase,
    lower: phrase.toLowerCase(),
  }));
  const modernVocabulary: CompiledModernVocabulary[] = profile.lexicon.modernVocabulary.map((phrase) => {
    const lower = phrase.toLowerCase();
    const pattern = lower.includes(" ") ? escapeRegExp(lower) : `\\b${escapeRegExp(lower)}\\b`;
    return { phrase, pattern: new RegExp(pattern) };
  });

  /**
   * Hårde afvisninger — binære, gælder kandidattekst. Sætnings-/ordloftet
   * gælder KUN når `source !== "pairs"` — se filens top-kommentar og
   * judge.py's `hard_reject` docstring for den fulde kilde-specifikke
   * begrundelse. Direkte port, reasons-strengene matcher Python ordret
   * (paritetstesten sammenligner dem ordret, ikke kun antallet).
   */
  function hardReject(text: string, source: Source): string[] {
    const reasons: string[] = [];
    const lower = text.toLowerCase();

    if (source !== "pairs") {
      const nSent = splitSentences(text).length;
      if (nSent > profile.hardMaxSentences) {
        reasons.push(`${nSent} sætninger (grænse ${profile.hardMaxSentences})`);
      }
      const nWords = tokenizeWords(text).length;
      if (nWords > profile.hardMaxWords) {
        reasons.push(`${nWords} ord (grænse ${profile.hardMaxWords})`);
      }
    }

    for (const { phrase, lower: phraseLower } of forbiddenConstructions) {
      if (lower.includes(phraseLower)) {
        reasons.push(`fejlmeddelelse-register: "${phrase}"`);
      }
    }

    for (const { phrase, pattern } of modernVocabulary) {
      if (pattern.test(lower)) {
        reasons.push(`moderne ordforråd: "${phrase}"`);
      }
    }

    const sentences = splitSentences(text);
    if (sentences.length > 0) {
      const last = sentences[sentences.length - 1];
      if (last !== undefined) {
        const punchline = normalizePunchline(last);
        if (punchline && !genericPunchlineExemptions.has(punchline) && punchlineSet.has(punchline)) {
          reasons.push(`genbrugt punchline: "${punchline}"`);
        }
      }
    }

    return reasons;
  }

  /**
   * Per-dimension 0-1 score plus `overall` (uvægtet gennemsnit af 6
   * dimensioner). Direkte port af judge.py's `score`.
   */
  function score(text: string, source: Source): { dimensions: Dimensions; overall: number; presentShareDecidable: boolean } {
    const tokens = tokenizeWords(text);
    const meanWordLen = tokens.length > 0 ? tokens.reduce((sum, w) => sum + w.length, 0) / tokens.length : 0.0;
    const sentences = splitSentences(text);
    const nSent = sentences.length;
    const nWords = tokens.length;

    const tenses = sentences.map((s) => classifyTense(s, presentTenseMarkers, pastTenseMarkers));
    const present = tenses.filter((t) => t === "present").length;
    const past = tenses.filter((t) => t === "past").length;
    const decided = present + past;
    const presentShare = decided > 0 ? present / decided : null;

    const wordCountDist = source === "pairs" ? profile.pairsWordCountBand : profile.distributions.wordsPerLine;

    const rates = punctuationRates(text);
    const punctScores = PUNCT_CHANNELS.map((ch) => rangeScore(rates[ch], profile.distributions.punctuationPer100Words[ch]));
    const punctuation = punctScores.reduce((a, b) => a + b, 0) / punctScores.length;

    const dimensions: Dimensions = {
      wordLength: rangeScore(meanWordLen, profile.distributions.wordLengthPerLineMean),
      sentenceCount: rangeScore(nSent, profile.distributions.sentencesPerLine),
      wordCount: rangeScore(nWords, wordCountDist),
      vocabulary: noveltyScore(noveltyFraction(text, knownVocabulary), profile.distributions.vocabularyLeaveOneOutNovelty),
      presentTense:
        presentShare !== null ? rangeScore(presentShare, profile.distributions.presentTensePerLineShare) : 1.0,
      punctuation,
    };

    const values = [
      dimensions.wordLength,
      dimensions.sentenceCount,
      dimensions.wordCount,
      dimensions.vocabulary,
      dimensions.presentTense,
      dimensions.punctuation,
    ];
    const overall = round4(values.reduce((a, b) => a + b, 0) / values.length);

    return { dimensions, overall, presentShareDecidable: presentShare !== null };
  }

  function judgeLine(text: string, source: Source = "grammar"): JudgeResult {
    const { dimensions, overall, presentShareDecidable } = score(text, source);
    return {
      text,
      hardRejects: hardReject(text, source),
      dimensions,
      overall,
      presentShareDecidable,
    };
  }

  function passesVoiceGate(text: string, source: Source = "grammar"): boolean {
    const result = judgeLine(text, source);
    return result.hardRejects.length === 0 && result.overall >= profile.threshold.value;
  }

  return { profile, judgeLine, passesVoiceGate };
}
