#!/usr/bin/env python3
"""Stemmefingeraftryk — TASK-027.

Udleder et målt, diffbart fingeraftryk af fortællerens stemme fra det
håndskrevne korpus, så senere lag (judge.py, calibrate.py) kan dømme en
kandidatreplik på afstand fra tallet i stedet for på en fornemmelse — samme
metode som den visuelle dommer i tools/judge/metrics.py (GUD-001).

## Hvad er "korpus"? (bevidst valg, ikke en gætning)

`content/narrator/act-1.json` og `act-2.json` har hver en `lines`-liste med
ALT håndskrevet fortæller-tekst. Alle andre topnøgler i filerne
(`genericFailure`, `deflectedEndingLine`, `discoveryFallback`,
`challengeWarningLine`, `defiance`, `defianceComic`, `obeyedFailure`,
`flagMemory`, `behavior.*`, `resumeLine`) er IKKE selvstændig tekst — de er
rene id-opslag der peger ind i `lines` (fx `"deflectedEndingLine":
"ending-deflected"`, hvor selve teksten står under `lines[].id ==
"ending-deflected"`). Det er efterprøvet direkte i JSON'en, ikke antaget.

Korpusset her er derfor HELE `lines`-listen fra begge akter (168 + 5 = 173
replik-definitioner, 866 variant-strenge) — ikke kun de par-specifikke
`narratorLine`-replikker. Begrundelsen: fingeraftrykket skal beskrive
FORTÆLLERENS stemme, og den samme sarkastiske, teatralske tone bærer både
sejrsreplikker (story-*), fiaskodrilleri (gf-*), hint (hint-*) og
tempo-kommentarer (spam-*, fast-*, slow-*) — de er alle skrevet i samme hånd,
ingen af dem er genereret. At kassere 112 af 173 replikker (alt der ikke er en
story-replik) ville halvere stikprøven for ingen metodisk gevinst.

Opgaveteksten beder specifikt om at tælle "narratorLine"-replikkerne efter og
bruge det rigtige tal i stedet for planens 71. Det tal er en NÆVNT DELMÆNGDE
af korpusset ovenfor, ikke selve korpusset: det er antallet af opskrifter i
`content/combos.json` der peger på en håndskrevet replik via feltet
`narratorLine` (jf. `src/core/types.ts` og `src/narrator/narrator.ts`,
`outcome.combo.narratorLine`). Det tal er talt her, ikke antaget — se
`corpus.narratorLineRefs` i output og `docs/design/narration-voice.md`.

Kør:  python3 tools/voice/metrics.py            # bygger og skriver fingeraftrykket
      python3 tools/voice/metrics.py --selftest  # tester målebåndet selv
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / "content"
OUT = ROOT / "docs" / "design" / "narration-voice-fingerprint.json"

LEXICON: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parent / "lexicon.json").read_text(encoding="utf-8")
)

# De eneste pladsholdere det håndskrevne korpus selv bruger (sweep-4, obeyed-failure).
# Fyldt med repræsentative ord, så ordlængde/ordtælling måler den TEKST spilleren
# rent faktisk hører, ikke skabelonens rå form.
CORPUS_FILLERS = {"a": "stone", "b": "grass", "element": "stone"}

WORD_RE = re.compile(r"[A-Za-z']+")
ELLIPSIS_RE = re.compile(r"\.\.\.+|…")
# Sætningsgrænse: punktum/!/? efterfulgt af mellemrum + stort bogstav/tal/citat.
# Ellipsen er normaliseret væk FØR dette kører, så "He... he's breeding" ikke
# tælles som to sætninger — den er en pause, ikke en afslutning.
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")

# Faldback-mønster for regelret datid ("smashed", "narrated"); firebogstavs-
# grænse luger "red"/"bed"/"fed"/"led"/"wed" fra uden en særlig undtagelsesliste.
PAST_ED_RE = re.compile(r"^[a-z]{2,}ed$")


def fill_placeholders(text: str, fillers: dict[str, str] = CORPUS_FILLERS) -> str:
    """Erstat {a}/{b}/{element} med et repræsentativt ord, som fill() i narrator.ts gør."""
    for key, val in fillers.items():
        text = text.replace("{" + key + "}", val)
    return text


def tokenize_words(text: str) -> list[str]:
    """Ordliste uden omgivende tegnsætning. `Karl.` bliver til `Karl`, `'advance`
    til `advance` — apostrof i ordets krop (don't, Karl's) bevares."""
    return [w.strip("'") for w in WORD_RE.findall(text) if w.strip("'")]


def split_sentences(text: str) -> list[str]:
    """Sætninger i en replik-variant. Se modulets docstring for ellipse-reglen."""
    normalized = ELLIPSIS_RE.sub("…", text)
    parts = SENTENCE_SPLIT_RE.split(normalized)
    return [p.strip() for p in parts if p.strip()]


def classify_tense(sentence: str) -> str:
    """Grov, gennemsigtig heuristik — IKKE en rigtig grammatisk parser.

    Tæller nutids- og datids-markører (lexicon.json) pr. sætning og lader
    flertallet afgøre. Mange af fortællerens sætninger er udbrud uden noget
    egentligt udsagnsord ("Bronze!", "Sparks!") — de får "neutral" og indgår
    ikke i nutids-andelen, fordi de hverken beviser eller modbeviser noget.
    """
    words = [w.lower() for w in tokenize_words(sentence)]
    present_set = set(LEXICON["presentTenseMarkers"])
    past_set = set(LEXICON["pastTenseMarkers"])
    present = sum(1 for w in words if w in present_set)
    past = sum(1 for w in words if w in past_set or (PAST_ED_RE.match(w) and w not in present_set))
    if present == 0 and past == 0:
        return "neutral"
    return "present" if present >= past else "past"


def _percentiles(values: list[float], ps: tuple[int, ...]) -> dict[str, float]:
    if not values:
        return {f"p{p}": 0.0 for p in ps}
    s = sorted(values)

    def pct(p: float) -> float:
        if len(s) == 1:
            return s[0]
        k = (len(s) - 1) * (p / 100)
        f, c = int(k), min(int(k) + 1, len(s) - 1)
        if f == c:
            return s[f]
        return s[f] + (s[c] - s[f]) * (k - f)

    return {f"p{p}": round(pct(p), 3) for p in ps}


def _dist_summary(values: list[float]) -> dict[str, float]:
    if not values:
        return {"mean": 0.0, "median": 0.0, "stdev": 0.0, "min": 0.0, "max": 0.0}
    out = {
        "mean": round(statistics.fmean(values), 3),
        "median": round(statistics.median(values), 3),
        "stdev": round(statistics.pstdev(values), 3) if len(values) > 1 else 0.0,
        "min": round(min(values), 3),
        "max": round(max(values), 3),
    }
    out.update(_percentiles(values, (10, 25, 50, 75, 90, 95)))
    return out


def normalize_punchline(sentence: str) -> str:
    """Nøgle til genbrugstjek: sidste sætning, fyldt, uden overflødig tegnsætning."""
    text = fill_placeholders(sentence).lower().strip()
    text = re.sub(r"[.!?…]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_corpus() -> dict[str, Any]:
    """Al håndskreven tekst fra `lines` i begge akter, plus optællingen af de
    par-specifikke `narratorLine`-replikker fra combos.json (se docstring)."""
    act1 = load_json(CONTENT / "narrator" / "act-1.json")
    act2 = load_json(CONTENT / "narrator" / "act-2.json")
    combos = load_json(CONTENT / "combos.json")

    line_defs: list[dict[str, Any]] = [*act1["lines"], *act2["lines"]]
    variants: list[str] = [fill_placeholders(v) for l in line_defs for v in l["variants"]]

    narrator_line_refs = [c["narratorLine"] for c in combos if c.get("narratorLine")]
    line_ids = {l["id"] for l in line_defs}
    dangling = [ref for ref in narrator_line_refs if ref not in line_ids]

    return {
        "lineDefs": line_defs,
        "variants": variants,
        "narratorLineRefCount": len(narrator_line_refs),
        "narratorLineUniqueCount": len(set(narrator_line_refs)),
        "danglingNarratorLineRefs": dangling,
        "act1LineCount": len(act1["lines"]),
        "act2LineCount": len(act2["lines"]),
    }


def word_length_stats(variants: list[str]) -> dict[str, Any]:
    """To fordelinger, til to forskellige formål:

    `pooled`    — hvert ords længde, slået sammen over hele korpus. Beskriver
                  ordforrådet generelt ("bruger fortælleren lange ord?").
    `perLineMean` — hver replik-variants EGET gennemsnit. Det er DEN,
                  judge.py sammenligner en kandidatreplik imod, fordi en
                  kandidat er én replik, ikke en pose løse ord.
    """
    lengths = [len(w) for v in variants for w in tokenize_words(v)]
    hist = Counter(min(l, 15) for l in lengths)  # 15+ slås sammen, halen er tynd
    per_line_means = [
        statistics.fmean(len(w) for w in toks)
        for v in variants
        if (toks := tokenize_words(v))
    ]
    return {
        "pooled": {
            **_dist_summary([float(l) for l in lengths]),
            "histogram": {str(k): hist[k] for k in sorted(hist)},
            "totalWords": len(lengths),
        },
        "perLineMean": _dist_summary(per_line_means),
    }


def sentences_per_line_stats(variants: list[str]) -> dict[str, Any]:
    counts = [len(split_sentences(v)) for v in variants]
    hist = Counter(counts)
    return {
        **_dist_summary([float(c) for c in counts]),
        "histogram": {str(k): hist[k] for k in sorted(hist)},
        "hardCap": 3,
        "overHardCap": sum(1 for c in counts if c > 3),
    }


def words_per_line_stats(variants: list[str]) -> dict[str, Any]:
    counts = [len(tokenize_words(v)) for v in variants]
    return {
        **_dist_summary([float(c) for c in counts]),
        "hardCap": 32,
        "overHardCap": sum(1 for c in counts if c > 32),
    }


def present_tense_stats(variants: list[str]) -> dict[str, Any]:
    present = past = neutral = 0
    per_line_shares: list[float] = []
    for v in variants:
        sentences = split_sentences(v)
        tenses = [classify_tense(s) for s in sentences]
        p = tenses.count("present")
        pa = tenses.count("past")
        n = tenses.count("neutral")
        present += p
        past += pa
        neutral += n
        decided = p + pa
        if decided:
            per_line_shares.append(p / decided)
    decided_total = present + past
    return {
        "sentenceCounts": {"present": present, "past": past, "neutral": neutral},
        "shareAmongDecidedSentences": round(present / decided_total, 3) if decided_total else 0.0,
        "shareAmongAllSentences": round(present / (present + past + neutral), 3)
        if (present + past + neutral)
        else 0.0,
        "perLineShare": _dist_summary(per_line_shares),
        "linesWithNoDecidableTense": sum(1 for v in variants if not split_sentences(v) or all(
            classify_tense(s) == "neutral" for s in split_sentences(v)
        )),
    }


def punctuation_stats(variants: list[str]) -> dict[str, Any]:
    per_100_words: dict[str, list[float]] = {
        "period": [], "exclaim": [], "question": [], "emdash": [],
        "comma": [], "colonSemicolon": [], "ellipsis": [],
    }
    finals = Counter()
    for v in variants:
        n_words = max(len(tokenize_words(v)), 1)
        normalized = ELLIPSIS_RE.sub("…", v)
        per_100_words["period"].append(100 * normalized.count(".") / n_words)
        per_100_words["exclaim"].append(100 * normalized.count("!") / n_words)
        per_100_words["question"].append(100 * normalized.count("?") / n_words)
        per_100_words["emdash"].append(100 * v.count("—") / n_words)
        per_100_words["comma"].append(100 * v.count(",") / n_words)
        per_100_words["colonSemicolon"].append(100 * (v.count(":") + v.count(";")) / n_words)
        per_100_words["ellipsis"].append(100 * normalized.count("…") / n_words)

        stripped = v.rstrip().rstrip('"').rstrip("'")
        last = stripped[-1] if stripped else ""
        if last in ".!?":
            finals[{"." : "period", "!": "exclaim", "?": "question"}[last]] += 1
        else:
            finals["other"] += 1

    return {
        "per100Words": {k: _dist_summary(v) for k, v in per_100_words.items()},
        "finalMark": dict(finals),
    }


def vocabulary_stats(variants: list[str]) -> dict[str, Any]:
    """Ordforråd plus en leave-one-out nyheds-rate pr. replik: for hver
    variant, hvor stor en andel af DENS ord findes IKKE andre steder i
    korpus (dvs. optræder kun i denne ene replik)? Det tal bruger judge.py
    som bundlinje for "hvor meget nyt ordforråd er normalt for en ægte
    replik" — uden det ville en tærskel for "nyt ordforråd" være gættet,
    ikke målt.
    """
    freq: Counter[str] = Counter()
    per_line_tokens: list[list[str]] = []
    for v in variants:
        toks = [w.lower() for w in tokenize_words(v)]
        per_line_tokens.append(toks)
        freq.update(toks)

    novelty_rates = []
    for toks in per_line_tokens:
        if not toks:
            continue
        local = Counter(toks)
        novel = sum(1 for w in toks if freq[w] - local[w] <= 0)
        novelty_rates.append(novel / len(toks))

    return {
        "totalTokens": sum(freq.values()),
        "uniqueTokens": len(freq),
        "frequency": dict(sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))),
        "leaveOneOutNovelty": _dist_summary(novelty_rates),
    }


def fixed_figure_stats(variants: list[str]) -> dict[str, Any]:
    n = len(variants) or 1
    out = {}
    for key, aliases in LEXICON["fixedFigures"].items():
        hits = [v for v in variants if any(a in v.lower() for a in aliases)]
        out[key] = {"lineShare": round(len(hits) / n, 3), "count": len(hits)}
    return out


def punchline_set(variants: list[str]) -> list[str]:
    seen = set()
    for v in variants:
        sentences = split_sentences(v)
        if sentences:
            seen.add(normalize_punchline(sentences[-1]))
    return sorted(seen)


def build_fingerprint() -> dict[str, Any]:
    corpus = load_corpus()
    variants = corpus["variants"]
    return {
        "_kommentar": (
            "Genereret af tools/voice/metrics.py. Se modulets docstring for "
            "hvorfor korpus = HELE `lines` fra act-1.json + act-2.json, og for "
            "narratorLineRefCount vs. narratorLineUniqueCount. Regenerer med "
            "python3 tools/voice/metrics.py."
        ),
        "corpus": {
            "act1LineDefs": corpus["act1LineCount"],
            "act2LineDefs": corpus["act2LineCount"],
            "totalLineDefs": corpus["act1LineCount"] + corpus["act2LineCount"],
            "totalVariantStrings": len(variants),
            "narratorLineRefCount": corpus["narratorLineRefCount"],
            "narratorLineUniqueCount": corpus["narratorLineUniqueCount"],
            "danglingNarratorLineRefs": corpus["danglingNarratorLineRefs"],
            "planClaimedNarratorLineCount": 71,
        },
        "wordLength": word_length_stats(variants),
        "sentencesPerLine": sentences_per_line_stats(variants),
        "wordsPerLine": words_per_line_stats(variants),
        "presentTense": present_tense_stats(variants),
        "punctuation": punctuation_stats(variants),
        "vocabulary": vocabulary_stats(variants),
        "fixedFigures": fixed_figure_stats(variants),
        "punchlines": punchline_set(variants),
    }


def selftest() -> int:
    """Tester målebåndet selv med kendte fixtures — ikke det aktuelle korpus,
    som ændrer sig. Samme princip som selftest() i tools/judge/metrics.py."""
    fails: list[str] = []

    # split_sentences: ellipse er en pause, ikke en sætningsgrænse (og
    # normaliseres til ét enkelt tegn "…" som en del af opdelingen).
    got = split_sentences("It is cold. If only something could... warm.")
    if got != ["It is cold.", "If only something could… warm."]:
        fails.append(f"split_sentences (ellipse) = {got!r}")
    got = split_sentences("...And he's back! I finished carving, Karl.")
    if len(got) != 2:
        fails.append(f"split_sentences (leading ellipse) skulle give 2, gav {len(got)}: {got!r}")
    got = split_sentences("One sentence only")
    if got != ["One sentence only"]:
        fails.append(f"split_sentences (ingen slutpunktum) = {got!r}")

    # tokenize_words: tegnsætning falder væk, apostrof i ordkroppen bliver.
    got = tokenize_words("Karl's rock, 'advance' — history?")
    if got != ["Karl's", "rock", "advance", "history"]:
        fails.append(f"tokenize_words = {got!r}")

    # classify_tense
    if classify_tense("Karl smashes the rock.") != "present":
        fails.append("classify_tense: 'smashes' skulle give present")
    if classify_tense("Karl smashed the rock.") != "past":
        fails.append("classify_tense: 'smashed' skulle give past")
    if classify_tense("Bronze!") != "neutral":
        fails.append("classify_tense: 'Bronze!' skulle give neutral (intet udsagnsord)")
    # "red"/"bed"/"fed"/"led"/"wed" er IKKE datid — PAST_ED_RE må ikke ramme dem.
    for word in ("red", "bed", "fed", "led", "wed"):
        if PAST_ED_RE.match(word):
            fails.append(f"PAST_ED_RE matcher fejlagtigt kort ord '{word}'")
    if not PAST_ED_RE.match("smashed"):
        fails.append("PAST_ED_RE matcher ikke 'smashed'")

    # fill_placeholders
    if fill_placeholders("The {element} again.") != "The stone again.":
        fails.append("fill_placeholders erstattede ikke {element}")

    # normalize_punchline: to overfladisk forskellige gengivelser af samme vits.
    if normalize_punchline("Nothing happens.") != normalize_punchline("Nothing happens...  "):
        fails.append("normalize_punchline skelner mellem trivielle varianter")

    # _percentiles: monotoni og kendte endepunkter
    d = _percentiles([1.0, 2.0, 3.0, 4.0, 5.0], (0, 50, 100))
    if not (d["p0"] == 1.0 and d["p50"] == 3.0 and d["p100"] == 5.0):
        fails.append(f"_percentiles endepunkter forkerte: {d}")

    for f in fails:
        print("FEJL:", f)
    print("selftest:", "bestået" if not fails else f"{len(fails)} fejl")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--json", action="store_true", help="udskriv hele fingeraftrykket")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    fp = build_fingerprint()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(fp, ensure_ascii=False, indent=2))
    else:
        c = fp["corpus"]
        print(f"Korpus: {c['totalLineDefs']} replik-definitioner, "
              f"{c['totalVariantStrings']} variant-strenge (akt 1: {c['act1LineDefs']}, "
              f"akt 2: {c['act2LineDefs']})")
        print(f"narratorLine-opslag i combos.json: {c['narratorLineRefCount']} "
              f"({c['narratorLineUniqueCount']} unikke replikker) — "
              f"planen siger {c['planClaimedNarratorLineCount']}")
        if c["danglingNarratorLineRefs"]:
            print(f"⚠️  Hængende narratorLine-opslag: {c['danglingNarratorLineRefs']}")
        wl = fp["wordLength"]["perLineMean"]
        print(f"Ordlængde (pr. replik): median {wl['median']}, gennemsnit {wl['mean']}")
        sl = fp["sentencesPerLine"]
        print(f"Sætninger/replik: median {sl['median']}, maks {sl['max']}, "
              f"{sl['overHardCap']} over hård grænse (3)")
        wc = fp["wordsPerLine"]
        print(f"Ord/replik: median {wc['median']}, p95 {wc['p95']}, "
              f"{wc['overHardCap']} over hård grænse (32)")
        pt = fp["presentTense"]
        print(f"Nutid: {pt['shareAmongDecidedSentences']:.0%} af afgjorte sætninger")
        ff = fp["fixedFigures"]
        print(f"Faste figurer: Karl i {ff['karl']['lineShare']:.0%} af replikkerne, "
              f"vildsvinet i {ff['boar']['lineShare']:.0%}, Grub Man i {ff['grubMan']['count']} replikker")
        print(f"→ {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
