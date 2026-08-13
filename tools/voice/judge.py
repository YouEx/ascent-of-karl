#!/usr/bin/env python3
"""Stemmedommer — TASK-028, og det importerbare indgangspunkt til TASK-030.

Dømmer én kandidat-replik mod fingeraftrykket fra metrics.py: et 0-1 tal pr.
dimension (aldrig hårdt mættet til 0 — samme filosofi som den visuelle
dommers `math.exp(-afstand/skala)` i tools/judge/metrics.py, valgt fordi et
mættet mål stopper med at vise fremgang), plus et lille sæt HÅRDE afvisninger
planen selv navngiver (TASK-028): for mange sætninger, for mange ord,
fejlmeddelelse-registret, moderne ordforråd, og en genbrugt punchline.

## Interval-scoring, ikke z-score

Hver dimension scores sådan: ligger kandidatens tal i korpusets EGEN midterste
80 %-bånd ([p10,p90]), er scoren 1.0 — helt almindeligt, ingen straf. Udenfor
båndet aftager scoren eksponentielt, skaleret af korpusets egen halve
spredning (aldrig en opfundet konstant). Det er bevidst IKKE et symmetrisk
z-score: nogle af korpusets egne fordelinger (fx tegnsætning pr. 100 ord) er
"nul-tunge" — de fleste replikker bruger slet ikke et kolon eller en tanke-
streg — så et strengt bånd omkring medianen ville dømme selve det almindelige
brug af "!" som en afvigelse. Se `_spread()`.

## Hvorfor faste figurer (Karl/vildsvin/Grub Man) IKKE er en scoringsdimension

Fingeraftrykket (metrics.py) MÅLER hvor ofte de faste figurer nævnes — det
dækker planens krav om at fingeraftrykket skal indeholde dem. Men de nævnes
kun i 48 % (Karl), 4 % (vildsvinet) og under 1 % (Grub Man) af de HÅNDSKREVNE
replikker — over halvdelen af ægte replikker nævner ingen af dem overhovedet
("Sparks!", "New. Unquestionably new. Useful? Unquestionably not."). At kræve
en figur-nævnelse pr. kandidat ville altså underkende ægte fortæller-stemme,
så det er en beskrivende statistik i fingeraftrykket, ikke en strafbar
dimension her.

## Hård afvisning af sætningstal — en dokumenteret selvmodsigelse

Planens tekst siger "afvis over 3 sætninger". Kalibreringen (calibrate.py)
viser at 144 af 866 (16,6 %) HÅNDSKREVNE varianter selv har mere end 3
sætninger — stemmen er kendetegnet ved korte, staccato-agtige sætninger
("Sparks fly. Karl gasps. I gasp. The boar leaves."), ikke ved lange, men få.
Reglen holdes alligevel, fordi TASK-028 beder om den ordret som en hård
grænse for KANDIDATTEKST (grammatik-ekspansion, bagte par, evt. fremtidig
live-generering) — den er en sikkerhedsgrænse mod at en generator løber løbsk,
IKKE en påstand om at ingen ægte replik nogensinde har 4+ sætninger. gate()
kalder derfor aldrig denne funktion på det håndskrevne korpus selv. Se
docs/design/narration-voice.md for de fulde tal.

Kør:  python3 -c "from judge import gate; print(gate())"
      python3 tools/voice/judge.py --selftest
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import (  # noqa: E402
    CONTENT,
    LEXICON,
    ROOT,
    build_fingerprint,
    classify_tense,
    fill_placeholders,
    normalize_punchline,
    split_sentences,
    tokenize_words,
    words_per_line_stats,
)

sys.path.insert(0, str(ROOT / "tools"))
import check_pairs  # noqa: E402 — TASK-030's par-kontrakt-komposition, se gate()
import assemble_pairs  # noqa: E402 — kun for DRAFTS/BATCHES, samme liste som fletningen selv bruger

# check_grammar_assembly/check_pairs_assembly ligger i tools/voice/ selv (samme
# mappe som denne fil) — intet ekstra sys.path-indslag nødvendigt, Python
# finder dem automatisk (se deres egne docstrings for hvorfor gate() komponerer
# dem direkte i stedet for at stole på at et menneske kører dem separat).
import check_grammar_assembly  # noqa: E402
import check_pairs_assembly  # noqa: E402

# --- Faste politik-tal fra planen (TASK-028) — IKKE kalibreret, se docstring ---
HARD_MAX_SENTENCES = 3
HARD_MAX_WORDS = 32

# Genbrugt punchline afvises IKKE hvis den normaliserede afslutning står i
# `lexicon.json`'s `genericPunchlineExemptions` — en håndklassificeret liste
# over rent sproglige lukningsmønstre (bar negation/bekræftelse, faste
# biord-forbindelser, eller det gentagne "THE END"-titelkort) som enhver
# skribent griber til, og som derfor ikke er en specifik, genkendelig
# vittighed (politikbeslutning 2026-08-13, erstatter den tidligere blanke
# "<4 ord"-regel — se lexicon.json's _genericPunchlineExemptionsKommentar for
# den fulde, replik-for-replik begrundelse). Korte men DISTINKTE punchlines
# som "grub man"/"we have fire" er bevidst IKKE på listen og afvises stadig.
GENERIC_PUNCHLINE_EXEMPTIONS = set(LEXICON["genericPunchlineExemptions"])

EPS = 1e-9

# Repræsentative, men ægte, udfyldninger af grammatikkens pladsholdere — samme
# navne som findes i content/elements.json / src/core/types.ts, valgt så
# ekspansionen ligner det spillet faktisk ville vise (se fill() i
# src/narrator/narrator.ts). {right}/{wrong}/{shared}/{result} bruges IKKE i
# det nuværende grammatik-indhold, men holdes klar hvis det ændrer sig.
GRAMMAR_FILLERS = {
    "a": "stone",
    "b": "stick",
    "partner": "water",
    "result": "fire",
    "deadEnd": "bone",
    "right": "stone",
    "wrong": "stick",
    "trait": "fragile",
    "trait2": "sharp",
    "shared": "hot",
}


def fill_grammar_placeholders(text: str) -> str:
    for key, val in GRAMMAR_FILLERS.items():
        text = text.replace("{" + key + "}", val)
    return text


# ---------------------------------------------------------------------------
# Domænevokabular: ord der er gyldige i spillets univers selvom de aldrig
# optræder i det håndskrevne korpus (fx et elementnavn Karl aldrig fik i de
# 173 skrevne replikker). Hentes fra content/elements.json — data, ikke en
# hardcodet liste — så den aldrig kommer i utakt med den faktiske indholdsfil.
# ---------------------------------------------------------------------------
def domain_vocabulary() -> set[str]:
    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    words: set[str] = set()
    for el in elements:
        for field in ("name", "kind", "stuff", "scale", "tag", "flavor", "note"):
            val = el.get(field)
            if isinstance(val, str):
                words.update(w.lower() for w in tokenize_words(val))
        for t in el.get("traits") or []:
            words.update(w.lower() for w in tokenize_words(t))
    return words


# ---------------------------------------------------------------------------
# Hårde afvisninger — binære, gælder kandidattekst (se docstring for hvorfor
# sætningsgrænsen aldrig anvendes på det håndskrevne korpus selv i gate()).
#
# ## Kilde-specifik politik for sætnings-/ordloftet (besluttet 2026-08-12)
#
# `HARD_MAX_SENTENCES`/`HARD_MAX_WORDS` er generator-sikkerhedsgrænser: de
# findes for at stoppe grammatikkens (og en fremtidig live-generators)
# skabelon-udfyldning i at løbe løbsk, IKKE for at dømme allerede
# menneske-skrevne, menneske-godkendte replikker. Bagte par har deres eget,
# etablerede kontraktloft — `tools/check_pairs.py`'s 320 tegn (se
# docs/design/narration-voice.md, "Uoverensstemmelser med planen" #2, for det
# fulde regnestykke: 320 tegn engelsk prosa ≈ 45-50 ord, og alle 908 bagte
# varianter overholder DET loft allerede, skribent-godkendt under TASK-023).
#
# Derfor gælder sætnings-/ordloftet KUN når `source="grammar"` (default —
# dækker også en fremtidig live-generator, som ligesom grammatikken aldrig er
# blevet læst af et menneske før den vises). `source="pairs"` slår dem fra.
# Det er ikke en svækkelse af par-porten: par-replikker dømmes stadig af BÅDE
# `check_pairs.py` (længde, dubletter) OG denne funktion (fejlmeddelelse-
# register, moderne ordforråd, genbrugt punchline) — to porte, hver med sit
# ansvar, sammensat efter kildetype, ikke én port med en undtagelse indbygget.
# ---------------------------------------------------------------------------
def hard_reject(text: str, fingerprint: dict[str, Any], *, source: str = "grammar") -> list[str]:
    reasons: list[str] = []
    lower = text.lower()

    if source != "pairs":
        n_sent = len(split_sentences(text))
        if n_sent > HARD_MAX_SENTENCES:
            reasons.append(f"{n_sent} sætninger (grænse {HARD_MAX_SENTENCES})")

        n_words = len(tokenize_words(text))
        if n_words > HARD_MAX_WORDS:
            reasons.append(f"{n_words} ord (grænse {HARD_MAX_WORDS})")

    for phrase in LEXICON["forbiddenConstructions"]:
        if phrase.lower() in lower:
            reasons.append(f'fejlmeddelelse-register: "{phrase}"')

    for phrase in LEXICON["modernVocabulary"]:
        p = phrase.lower()
        # Enkeltord matches på ordgrænse (undgår fx "ok" i "broken"); flerords-
        # udtryk matches som substring, da \b ikke giver mening om mellemrum.
        pattern = rf"\b{re.escape(p)}\b" if " " not in p else re.escape(p)
        if re.search(pattern, lower):
            reasons.append(f'moderne ordforråd: "{phrase}"')

    # Genbrugt punchline: kun en reel, DISTINKT afslutning tæller (politik
    # 2026-08-13) — se lexicon.json's genericPunchlineExemptions. En lukning
    # der matcher et korpus-punchline men selv står i undtagelseslisten
    # (bar negation/bekræftelse, faste biord-forbindelser, "THE END"-
    # titelkortet) er et sprogmønster alle skribenter griber til, ikke en
    # genbrugt vittighed.
    sentences = split_sentences(text)
    if sentences:
        punchline = normalize_punchline(sentences[-1])
        if (
            punchline
            and punchline not in GENERIC_PUNCHLINE_EXEMPTIONS
            and punchline in fingerprint["punchlines"]
        ):
            reasons.append(f'genbrugt punchline: "{punchline}"')

    return reasons


# ---------------------------------------------------------------------------
# Kontinuerlig 0-1 scoring pr. dimension.
# ---------------------------------------------------------------------------
def _spread(dist: dict[str, float], center_key: str, tier_keys: tuple[str, ...]) -> float:
    """Selvkalibreret spredning: prøv tiers i rækkefølge, brug den første der
    faktisk er større end 0 (nul-tunge fordelinger som tankestreger-pr-100-ord
    har ofte p90==p50==0). Falder tilbage til 1.0 kun hvis dimensionen
    slet ingen varians har nogen steder i korpus — en ren nødbremse."""
    center = dist[center_key]
    for key in tier_keys:
        spread = abs(dist[key] - center)
        if spread > EPS:
            return spread
    return 1.0


def range_score(x: float, dist: dict[str, float]) -> float:
    """1.0 i korpusets midterste 80 %-bånd [p10,p90]; aftagende udenfor."""
    lo, hi = dist["p10"], dist["p90"]
    if lo <= x <= hi:
        return 1.0
    if x < lo:
        spread = _spread(dist, "p50", ("p10", "p25"))
        return math.exp(-(lo - x) / spread)
    spread = _spread(dist, "p50", ("p90", "p95", "max"))
    return math.exp(-(x - hi) / spread)


def novelty_score(x: float, dist: dict[str, float]) -> float:
    """Ensidet udgave af range_score: kun EFTER p90 straffes. At bruge FÆRRE
    ord end normalt uden for korpus er aldrig en stemme-fejl i sig selv."""
    hi = dist["p90"]
    if x <= hi:
        return 1.0
    spread = _spread(dist, "p50", ("p90", "p95", "max"))
    return math.exp(-(x - hi) / spread)


PUNCT_CHANNELS = ("period", "exclaim", "question", "emdash", "comma", "colonSemicolon", "ellipsis")


def _punctuation_rates(text: str) -> dict[str, float]:
    n_words = max(len(tokenize_words(text)), 1)
    normalized = re.sub(r"\.\.\.+|…", "…", text)
    return {
        "period": 100 * normalized.count(".") / n_words,
        "exclaim": 100 * normalized.count("!") / n_words,
        "question": 100 * normalized.count("?") / n_words,
        "emdash": 100 * text.count("—") / n_words,
        "comma": 100 * text.count(",") / n_words,
        "colonSemicolon": 100 * (text.count(":") + text.count(";")) / n_words,
        "ellipsis": 100 * normalized.count("…") / n_words,
    }


def _novelty_fraction(text: str, corpus_vocab: set[str], domain_vocab: set[str]) -> float:
    tokens = [w.lower() for w in tokenize_words(text)]
    if not tokens:
        return 0.0
    known = corpus_vocab | domain_vocab
    novel = sum(1 for w in tokens if w not in known)
    return novel / len(tokens)


# ---------------------------------------------------------------------------
# Kilde-specifikt ordtal-bånd for bagte par (politik 2026-08-12, FROSSET
# 2026-08-13 — se docs/design/narration-voice.md, "Politik: frosset
# ordtal-bånd").
#
# Bagte par er, ligesom det håndskrevne korpus selv, MÅLT — men de er en
# strukturelt anderledes indholdstype: hvert par er skrevet specifikt til to
# navngivne ting og godkendt under sit eget, længere kontraktloft (320 tegn,
# tools/check_pairs.py, TASK-023) i stedet for grammatikkens korte,
# kombinatoriske skabelonlinjer. Målt: bagte par har median 32 ord (p90 43),
# mod det håndskrevne korpus' median 17 (p90 26) — se
# docs/design/narration-voice.md. At score deres ordtal-DIMENSION mod DEN
# HÅNDSKREVNE fordeling ville lade det bløde 26-ords-p90-loft genindføre
# næsten samme straf som det hårde 32-ords-loft, lige efter at det hårde loft
# blev fjernet for netop denne kildetype (samme politikbeslutning, se
# hard_reject()'s docstring) — tærsklen ville se ud til at være løst på
# papiret, men reelt stadig ramme stort set de samme lange, allerede
# godkendte par. Derfor: bagte par scores på ordtal mod bagte pars EGEN
# fordeling.
#
# ## Hvorfor båndet er FROSSET, ikke levende genberegnet
#
# Første udgave genberegnede båndet fra `expand_pairs()` hver gang — men et
# bånd der altid genberegnes fra netop de kandidater det dømmer, kan
# definitorisk aldrig opdage at kandidaterne SOM HELHED er skredet: båndet
# flytter sig med dem og finder dem for evigt "normale", uanset hvor lange de
# bliver. Det gør fingeraftrykket for det håndskrevne korpus ikke — DET er
# frosset ved konstruktion (metrics.py læser act-1/act-2.json, ikke
# kandidatteksten). Bagte pars bånd skal have samme egenskab for at være en
# reel kontrol og ikke bare et spejl. Løsningen: `pairs_baseline.json` er et
# øjebliksbillede taget DA de 908 varianter var mennesker-godkendte (TASK-023)
# og bestod stemmedommeren — en frysning af en allerede godkendt tilstand.
# Genkalibrering kræver nu en eksplicit, synlig handling
# (tools/voice/freeze_pairs_baseline.py), aldrig en stiltiende bivirkning af
# at dømme. Se judge.py's selftest() for et konkret bevis: global oppustning
# af alle 908 par-varianters ordtal scorer katastrofalt dårligt mod DETTE
# bånd, men ville scoret næsten perfekt mod et bånd genberegnet fra den
# samme oppustede mængde — det er præcis den fejl frysningen forhindrer.
# ---------------------------------------------------------------------------
PAIRS_BASELINE_PATH = Path(__file__).resolve().parent / "pairs_baseline.json"


def pairs_wordcount_band() -> dict[str, float]:
    """Læser DET FROSNE bånd — se tools/voice/pairs_baseline.json og dens egen
    kommentar. Genberegner ALDRIG fra aktuelt indhold; det er præcis pointen.
    Til bevidst genkalibrering: python3 tools/voice/freeze_pairs_baseline.py
    (se recompute_pairs_wordcount_band() for selve genberegningen)."""
    data = json.loads(PAIRS_BASELINE_PATH.read_text(encoding="utf-8"))
    return data["wordCount"]


def recompute_pairs_wordcount_band(pairs: list[tuple[str, str]] | None = None) -> dict[str, float]:
    """Genberegner LIVE fra aktuelt (eller angivet) par-indhold. Bruges KUN af
    tools/voice/freeze_pairs_baseline.py (den eksplicitte genkalibrering) og af
    calibrate.py (til at RAPPORTERE om det frosne bånd stadig matcher det
    nuværende indhold — se "Politik: frosset ordtal-bånd" i den genererede
    rapport). Aldrig kaldt fra score()/gate() — de bruger altid det frosne
    pairs_wordcount_band() ovenfor.

    hardCap/overHardCap strippes fra resultatet (kodegennemgang 2026-08-13):
    de er et 32-ORDS generator-loft-begreb (se HARD_MAX_WORDS) der gælder
    grammatik/fremtidig live-tekst — bagte par har intet ordtal-loft, kun
    check_pairs.py's 320-TEGNS kontrakt. At lade dem stå i par-båndet ville
    påstå en grænse par aldrig har haft. Strippes IKKE i words_per_line_stats()
    selv, for den bruges også til det håndskrevne fingeraftryk, hvor
    hardCap/overHardCap ER den rigtige, meningsfulde ting at vise (se
    metrics.py's docstring)."""
    if pairs is None:
        pairs = expand_pairs()
    stats = words_per_line_stats([text for _, text in pairs])
    return {k: v for k, v in stats.items() if k not in ("hardCap", "overHardCap")}


def score(text: str, fingerprint: dict[str, Any], corpus_vocab: set[str] | None = None,
          dom_vocab: set[str] | None = None, *, source: str = "grammar",
          pairs_band: dict[str, float] | None = None) -> dict[str, Any]:
    """Per-dimension 0-1 score plus `overall` (uvægtet gennemsnit — samme
    aggregering som `overall` i tools/judge/metrics.py: score_region())."""
    if corpus_vocab is None:
        corpus_vocab = set(fingerprint["vocabulary"]["frequency"])
    if dom_vocab is None:
        dom_vocab = domain_vocabulary()

    tokens = tokenize_words(text)
    mean_word_len = sum(len(w) for w in tokens) / len(tokens) if tokens else 0.0
    n_sent = len(split_sentences(text))
    n_words = len(tokens)

    sentences = split_sentences(text)
    tenses = [classify_tense(s) for s in sentences]
    present, past = tenses.count("present"), tenses.count("past")
    decided = present + past
    present_share = (present / decided) if decided else None

    dims: dict[str, float] = {
        "wordLength": range_score(mean_word_len, fingerprint["wordLength"]["perLineMean"]),
        "sentenceCount": range_score(float(n_sent), fingerprint["sentencesPerLine"]),
        "wordCount": range_score(
            float(n_words),
            (pairs_band or pairs_wordcount_band()) if source == "pairs" else fingerprint["wordsPerLine"],
        ),
        "vocabulary": novelty_score(
            _novelty_fraction(text, corpus_vocab, dom_vocab),
            fingerprint["vocabulary"]["leaveOneOutNovelty"],
        ),
    }
    if present_share is not None:
        dims["presentTense"] = range_score(present_share, fingerprint["presentTense"]["perLineShare"])
    else:
        # Ingen afgørbar tid (fx "Bronze!") — hverken bevis for eller imod,
        # se linjer uden afgørbar tid udgør 157/866 af korpus selv (metrics.py).
        dims["presentTense"] = 1.0

    rates = _punctuation_rates(text)
    punct_scores = [
        range_score(rates[ch], fingerprint["punctuation"]["per100Words"][ch]) for ch in PUNCT_CHANNELS
    ]
    dims["punctuation"] = sum(punct_scores) / len(punct_scores)

    overall = sum(dims.values()) / len(dims)
    return {"dimensions": dims, "overall": round(overall, 4), "presentShareDecidable": present_share is not None}


def judge(text: str, fingerprint: dict[str, Any] | None = None, *, source: str = "grammar") -> dict[str, Any]:
    """Fuld dom over én kandidat: hårde afvisninger + kontinuerlig score.
    `source` videregives til både hard_reject() (kun "grammar" håndhæver
    sætnings-/ordloftet — "pairs" lader check_pairs.py om det) og score()
    (ordtal-DIMENSIONEN måles for "pairs" mod bagte pars eget bånd, se
    pairs_wordcount_band())."""
    if fingerprint is None:
        fingerprint = build_fingerprint()
    return {
        "text": text,
        "hardRejects": hard_reject(text, fingerprint, source=source),
        **score(text, fingerprint, source=source),
    }


# ---------------------------------------------------------------------------
# Ekspansion af grammatik og bagte par "sådan som spillet gør det" — se
# mergeGrammar() i src/content.ts og grammarPool()/pickGrammarLine() i
# src/narrator/grammar.ts. Delt mellem calibrate.py (TASK-029) og gate()
# (TASK-030), så de aldrig kan komme i utakt med hinanden.
# ---------------------------------------------------------------------------
def expand_grammar() -> list[tuple[str, str]]:
    """(mærkat, udfyldt tekst) for hver variant af hver replik i hver doms
    pulje. `content/narrator/grammar-act-1.json`'s "grammar"-kort har i dag
    kun de 7 bare doms-nøgler (ingen "dom:stof+stof"-specialiseringer, selvom
    planens TASK-020 hævder de 12 hyppigste stof-par har fået det — se
    rapporten). grammarPool() ville falde igennem til den bare doms-nøgle for
    ethvert par lige nu, så ekspansionen her — alle 7 doms-puljer i sin helhed
    — er reelt identisk med alt grammatikken kan sige, uanset hvilke to
    elementer spilleren kombinerer."""
    g = json.loads((CONTENT / "narrator" / "grammar-act-1.json").read_text(encoding="utf-8"))
    lines_by_id = {l["id"]: l for l in g["lines"]}
    out: list[tuple[str, str]] = []
    for verdict, pool in g["grammar"].items():
        for line_id in pool:
            line_def = lines_by_id.get(line_id)
            if not line_def:
                continue
            for i, variant in enumerate(line_def["variants"]):
                out.append((f"grammar:{verdict}:{line_id}#{i}", fill_grammar_placeholders(variant)))
    return out


def expand_pairs() -> list[tuple[str, str]]:
    """(mærkat, udfyldt tekst) for hver variant af hver bagt par-replik.
    {right}/{wrong} udfyldes med DE FAKTISKE to elementers navne fra parrets
    egen nøgle ("graes+vand" → "dry grass"/"water"), udledt nøjagtig som
    pairLineId() (src/narrator/pairs.ts) gør det — ikke en generisk fylder.
    Hvilken af de to der får {right} vs {wrong} er vilkårligt (rækkefølgen i
    nøglen); det påvirker ikke stemme-scoren, kun hvem fiktionen udpeger."""
    p = json.loads((CONTENT / "narrator" / "pairs-act-1.json").read_text(encoding="utf-8"))
    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    by_id = {e["id"]: e["name"].lower() for e in elements}
    lines_by_id = {l["id"]: l for l in p["lines"]}
    out: list[tuple[str, str]] = []
    for lookup in p["pairs"]:
        at = lookup.rfind(":")
        pair_key, verdict = lookup[:at], lookup[at + 1:]
        id_a, _, id_b = pair_key.partition("+")
        right = by_id.get(id_a, id_a)
        wrong = by_id.get(id_b, id_b)
        line_id = "pair-" + pair_key.replace("+", "-") + "-" + verdict
        line_def = lines_by_id.get(line_id)
        if not line_def:
            continue
        for i, variant in enumerate(line_def["variants"]):
            text = variant.replace("{right}", right).replace("{wrong}", wrong)
            out.append((f"pairs:{lookup}#{i}", text))
    return out


def handwritten_variants(fingerprint: dict[str, Any] | None = None) -> list[tuple[str, str]]:
    """(mærkat, tekst) for hver variant i det håndskrevne korpus — til
    kalibrering, dvs. score mod SIG SELV, ikke til gate()'s kandidatdømning."""
    act1 = json.loads((CONTENT / "narrator" / "act-1.json").read_text(encoding="utf-8"))
    act2 = json.loads((CONTENT / "narrator" / "act-2.json").read_text(encoding="utf-8"))
    out: list[tuple[str, str]] = []
    for act_name, act in (("act1", act1), ("act2", act2)):
        for l in act["lines"]:
            for i, v in enumerate(l["variants"]):
                out.append((f"{act_name}:{l['id']}#{i}", fill_placeholders(v)))
    return out


def calibrated_threshold(fingerprint: dict[str, Any], percentile: str = "p5") -> float:
    """Tærsklen udledes FRISK af det håndskrevne korpus' egen scorefordeling
    hver gang — aldrig et cachet/gættet tal (se docs/design/narration-voice.md
    for den fulde fordeling og kalibreringstallene).

    p5 er valgt frem for p1 og p10 efter empirisk afprøvning af alle tre mod
    grammatik og bagte par (calibrate.py):
    - p1 gør scoren redundant — den fanger 0 kandidater ud over hvad de hårde
      afvisninger allerede fanger, i BÅDE grammatik og par. En tærskel der
      aldrig selv fælder en dom, tester ikke noget.
    - p10 fanger 28 par + 7 grammatiklinjer UD OVER de hårde afvisninger —
      men ved manuel læsning lyder flere af dem tydeligt som fortælleren
      ("One day, perhaps, the bone will find a calling..."), kun straffet
      fordi deres ordtal/ordforråd ligger i den lange hale mellem korpus'
      typiske spredning og det hårde loft på 32 ord. At underkende dem ville
      være at dømme på "for langt", ikke på "lyder forkert".
    - p5 rammer midtimellem: den er ikke redundant (fanger 4 par ud over hårde
      afvisninger), og de 4 den fanger er faktisk mere grænsetilfælde end
      p10-mængden (lavere vocabulary/wordCount-score). De 4 er navngivet i
      docs/design/narration-voice.md som kandidater til human-queue —
      dommeren behøver ikke have ret i hvert tilfælde, den skal blot flage
      billigt til menneskelig kontrol."""
    corpus_vocab = set(fingerprint["vocabulary"]["frequency"])
    dom_vocab = domain_vocabulary()
    scores = sorted(
        score(text, fingerprint, corpus_vocab, dom_vocab)["overall"]
        for _, text in handwritten_variants(fingerprint)
    )
    if not scores:
        return 0.0
    idx = {"p1": 0.01, "p5": 0.05, "p10": 0.10}.get(percentile, 0.05)
    k = max(0, min(len(scores) - 1, round(idx * (len(scores) - 1))))
    return scores[k]


def gate() -> list[str]:
    """TASK-030's importable indgang. Dømmer ALT kandidatindhold der findes
    som statisk indhold i repoet: grammatikkens ekspanderede linjer, de bagte
    par (stemme + register), de bagte pars strukturelle kontrakt (navn, dom,
    dublet, længde — check_pairs.py, TASK-023), OG at BEGGE assemblerede
    facit-filer rent faktisk er reproducerbare fra deres egne drafts
    (check_grammar_assembly.py / check_pairs_assembly.py, kodegennemgang
    2026-08-13 — se deres docstrings: en kalibrering der måler et facit som
    er gledet ud af trit med sine drafts måler den forkerte ting, og præcis
    det skete engang med grammatikken). Alle fire er komponeret direkte her —
    at antage et menneske selv husker at køre check_pairs.py, eller de to
    samlings-kontroller, separat var utilstrækkeligt. Én kommando beviser nu
    HELE stemme- og par-kontrakten, ikke kun de dele en scoringsfunktion kan se.

    De strukturelle kontroller er en ANDEN slags fejl end stemme-scoren kan
    se: en replik kan lyde perfekt som fortælleren og stadig nævne det
    forkerte element, være en dublet, eller stamme fra et facit der ikke
    matcher sine egne drafts. check_pairs-kontrakten køres mod de 10
    UDKAST-batches (samme shape check_pairs.py forstår; DEN ASSEMBLEREDE fil
    har en anden shape — "pairs" er der en liste af strenge, ikke objekter —
    se assemble_pairs.py's egen præcedens for at køre check_pairs.py pr.
    batch, aldrig mod outputtet).

    (Live-generering ved runtime har intet statisk indhold at dømme her — se
    docs/design/narration-voice.md, "Wiring into validate", for hvordan et
    fremtidigt kald ind i denne funktion kunne bruges derfra.)

    Returnerer en liste af menneskelæsbare fejlbeskeder. Tom liste = bestået.
    """
    failures: list[str] = []

    # Reproducerbarhed FØRST: er facit-filerne overhovedet det deres drafts
    # udtrykker? Uden dette kunne resten af gate() dømme et facit der reelt
    # var forældet eller håndredigeret uden om drafts (se check_*_assembly.py).
    failures.extend(f"grammatik-samling: {p}" for p in check_grammar_assembly.check_grammar_assembly())
    failures.extend(f"par-samling: {p}" for p in check_pairs_assembly.check_pairs_assembly())

    fingerprint = build_fingerprint()
    threshold = calibrated_threshold(fingerprint)
    corpus_vocab = set(fingerprint["vocabulary"]["frequency"])
    dom_vocab = domain_vocabulary()

    # Kildemærket, så hard_reject() ved om sætnings-/ordloftet gælder (kun
    # grammatik — se hard_reject()'s docstring for den fulde begrundelse).
    sourced: list[tuple[str, list[tuple[str, str]]]] = [
        ("grammar", expand_grammar()),
        ("pairs", expand_pairs()),
    ]
    pairs_band = pairs_wordcount_band()  # frosset facit, se pairs_wordcount_band()'s docstring

    for source, candidates in sourced:
        for label, text in candidates:
            rejects = hard_reject(text, fingerprint, source=source)
            if rejects:
                failures.append(f"{label}: hård afvisning — {'; '.join(rejects)} — {text!r}")
                continue
            result = score(text, fingerprint, corpus_vocab, dom_vocab, source=source, pairs_band=pairs_band)
            if result["overall"] < threshold:
                failures.append(
                    f"{label}: score {result['overall']:.3f} under tærskel {threshold:.3f} — {text!r}"
                )

    # Par-kontrakten: navn, dom, dublet, længde — se docstringen ovenfor.
    jobs = check_pairs.load_jobs()
    names = check_pairs.load_names()
    for batch in assemble_pairs.BATCHES:
        path = assemble_pairs.DRAFTS / f"pairs-{batch}.json"
        if not path.exists():
            failures.append(f"par-kontrakt: udkast-batch mangler — {path.relative_to(ROOT)}")
            continue
        for problem in check_pairs.check_pairs_file(path, jobs=jobs, names=names):
            failures.append(f"par-kontrakt ({batch}): {problem}")

    return failures


def selftest() -> int:
    """Tester dommeren med kendte fixtures — ikke det aktuelle korpus. Samme
    princip som selftest() i tools/judge/metrics.py og metrics.py her."""
    fails: list[str] = []
    fp = build_fingerprint()

    over_sentence = "One. Two. Three. Four."
    r = hard_reject(over_sentence, fp)
    if not any("sætninger" in x for x in r):
        fails.append(f"hard_reject skulle fange >3 sætninger: {r}")

    over_words = " ".join(["word"] * 40) + "."
    r = hard_reject(over_words, fp)
    if not any("ord" in x for x in r):
        fails.append(f"hard_reject skulle fange >32 ord: {r}")

    # Politik 2026-08-12: sætnings-/ordloftet er en generator-sikkerhedsgrænse
    # og gælder derfor IKKE bagte par (source="pairs") — de har deres eget
    # 320-tegns-loft i tools/check_pairs.py. Samme to fixtures som ovenfor,
    # men nu skal INGEN af dem ramme sætnings-/ordtal-afvisning.
    r = hard_reject(over_sentence, fp, source="pairs")
    if any("sætninger" in x for x in r):
        fails.append(f"hard_reject må IKKE håndhæve sætningsloft for source='pairs': {r}")
    r = hard_reject(over_words, fp, source="pairs")
    if any(" ord (" in x for x in r):
        fails.append(f"hard_reject må IKKE håndhæve ordloft for source='pairs': {r}")

    r = hard_reject("This cannot be undone. Please try again.", fp)
    if not any("fejlmeddelelse" in x for x in r):
        fails.append(f"hard_reject skulle fange fejlmeddelelse-register: {r}")

    r = hard_reject("Karl checks his email on the computer.", fp)
    if not any("moderne" in x for x in r):
        fails.append(f"hard_reject skulle fange moderne ordforråd: {r}")
    r = hard_reject("Karl looks broken and stubborn about it.", fp)
    if any("moderne" in x for x in r):
        fails.append(f"hard_reject fangede fejlagtigt 'ok' som delstreng i 'broken': {r}")

    # Punchline-genbrug (politik 2026-08-13): kun genericPunchlineExemptions
    # er undtaget — ALT andet korpus-punchline, uanset ordtal, skal afvises.
    # De fire eksempler brugeren selv navngav som SKAL blive ved med at fælde
    # en kandidat, testes eksplicit her, ikke bare "det første fundne lange".
    for generic in GENERIC_PUNCHLINE_EXEMPTIONS:
        if generic not in fp["punchlines"]:
            continue  # kun test dem der rent faktisk matcher en korpus-linje
        r = hard_reject(f"Karl waits. {generic.capitalize()}.", fp)
        if any("punchline" in x for x in r):
            fails.append(
                f"hard_reject afviste fejlagtigt den generiske, undtagne lukning "
                f"'{generic}' som genbrugt punchline: {r}"
            )

    for distinctive in ("grub man", "we have fire", "onward, humanity", "third time, harpoon"):
        if distinctive not in fp["punchlines"]:
            fails.append(f"selftest-fixture mangler: forventet korpus-punchline '{distinctive}'")
            continue
        if distinctive in GENERIC_PUNCHLINE_EXEMPTIONS:
            fails.append(f"'{distinctive}' må ALDRIG stå i genericPunchlineExemptions")
            continue
        r = hard_reject(f"Karl waits. {distinctive.capitalize()}.", fp)
        if not any("punchline" in x for x in r):
            fails.append(
                f"hard_reject skulle fange den distinkte, korte genbrugte punchline "
                f"'{distinctive}' (bevidst IKKE undtaget): {r}"
            )

    # range_score: inden for bånd = 1.0, langt udenfor < 1.0, aldrig 0.
    dist = {"p10": 2.0, "p25": 3.0, "p50": 5.0, "p75": 7.0, "p90": 9.0, "p95": 11.0, "max": 20.0}
    if range_score(5.0, dist) != 1.0:
        fails.append("range_score: median skal give 1.0")
    if range_score(9.0, dist) != 1.0:
        fails.append("range_score: p90 selv skal stadig give 1.0 (inklusiv grænse)")
    far = range_score(1000.0, dist)
    if not (0.0 < far < 0.05):
        fails.append(f"range_score: ekstrem outlier skal være lav men > 0, fik {far}")

    # domain_vocabulary: elementnavne findes, uden at kræve korpus-forekomst.
    dv = domain_vocabulary()
    if "boar" not in dv and "wild" not in dv:
        fails.append("domain_vocabulary fandt ikke elementnavne som forventet")

    # calibrated_threshold: skal ligge i (0,1) og faktisk lade langt de fleste
    # håndskrevne linjer bestå (det er jo DERFRA den er udledt).
    t = calibrated_threshold(fp)
    if not (0.0 < t < 1.0):
        fails.append(f"calibrated_threshold uden for (0,1): {t}")

    # Frossent ordtal-bånd for par: beviser AT frysningen fanger skred, som et
    # bånd der altid genberegnes fra netop de kandidater det dømmer ikke kan
    # (politik 2026-08-13, se pairs_wordcount_band()'s docstring). Tre trin:
    # (1) rigtige par scorer godt mod det frosne bånd, (2) de SAMME par, kunstigt
    # oppustet med fyldord, scorer markant dårligere mod DET SAMME frosne bånd,
    # (3) men ville scoret næsten perfekt mod et bånd genberegnet FRA netop den
    # oppustede mængde — den selvkalibrerende fælde frysningen findes for at undgå.
    real_pairs = expand_pairs()
    frozen_band = pairs_wordcount_band()
    real_scores = [range_score(float(len(tokenize_words(t))), frozen_band) for _, t in real_pairs]
    real_mean = statistics.fmean(real_scores) if real_scores else 0.0
    if real_mean < 0.8:
        fails.append(f"frosset par-ordtalsbånd: rigtige par burde scorer højt mod egen frysning, fik {real_mean:.3f}")

    inflated_texts = [t + " " + " ".join(["utterly"] * 40) for _, t in real_pairs]
    inflated_scores_vs_frozen = [range_score(float(len(tokenize_words(t))), frozen_band) for t in inflated_texts]
    inflated_mean_vs_frozen = statistics.fmean(inflated_scores_vs_frozen) if inflated_scores_vs_frozen else 0.0
    if inflated_mean_vs_frozen > real_mean - 0.3:
        fails.append(
            f"frosset par-ordtalsbånd: oppustede par burde scorer markant dårligere mod det "
            f"FROSNE bånd end rigtige par ({real_mean:.3f}); fik {inflated_mean_vs_frozen:.3f} — "
            "frysningen fanger tilsyneladende ikke skred"
        )

    live_band_on_inflated = words_per_line_stats(inflated_texts)
    inflated_scores_vs_live = [
        range_score(float(len(tokenize_words(t))), live_band_on_inflated) for t in inflated_texts
    ]
    inflated_mean_vs_live = statistics.fmean(inflated_scores_vs_live) if inflated_scores_vs_live else 0.0
    if inflated_mean_vs_live < 0.9:
        fails.append(
            "frosset par-ordtalsbånd: kontrol-beviset holder ikke — et bånd genberegnet FRA "
            f"den oppustede mængde selv burde scorer den oppustede mængde højt (viser HVORFOR "
            f"selvkalibrering ikke opdager skred), fik {inflated_mean_vs_live:.3f}"
        )

    # Samlings-reproducerbarhed (kodegennemgang 2026-08-13, sidste blokerende
    # punkt): beviser at check_grammar_assembly()/check_pairs_assembly() — og
    # gate() SELV, som er hvad validate.py rent faktisk vil kalde — fanger et
    # facit der er gledet ud af trit med sine drafts. At de består mod det
    # NUVÆRENDE, rigtige indhold viser kun at intet er i stykker LIGE NU, ikke
    # at kontrollen kan opdage noget — derfor et injiceret, kunstigt afdrevet
    # "facit" via en midlertidig sti (`real_out=` / REAL_OUT), aldrig en
    # ændring af det rigtige indhold. To niveauer: (1) kontrolfunktionen
    # kaldt direkte med `real_out=` beviser selve mekanismen; (2) den FULDE
    # gate(), med REAL_OUT midlertidigt ombundet, beviser at gate() (det
    # eneste sted validate.py nogensinde skal kalde) reelt reagerer — ikke
    # kun kontrolfunktionen i isolation.
    def _drifted_copy(real_path: Path, scratch_name: str) -> Path:
        data = json.loads(real_path.read_text(encoding="utf-8"))
        data["lines"][0]["variants"][0] += " — selftest-injiceret drift, skal ALDRIG bestå"
        scratch = check_grammar_assembly.SCRATCH_DIR / scratch_name
        scratch.parent.mkdir(exist_ok=True)
        scratch.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return scratch

    # (1) kontrolfunktionerne i isolation, med et eksplicit injiceret facit.
    grammar_drift = _drifted_copy(check_grammar_assembly.REAL_OUT, "selftest-grammar-drift.json")
    try:
        if not check_grammar_assembly.check_grammar_assembly(real_out=grammar_drift):
            fails.append("check_grammar_assembly(real_out=...) fangede IKKE et injiceret, afdrevet facit")
    finally:
        grammar_drift.unlink(missing_ok=True)

    pairs_drift = _drifted_copy(check_pairs_assembly.REAL_OUT, "selftest-pairs-drift.json")
    try:
        if not check_pairs_assembly.check_pairs_assembly(real_out=pairs_drift):
            fails.append("check_pairs_assembly(real_out=...) fangede IKKE et injiceret, afdrevet facit")
    finally:
        pairs_drift.unlink(missing_ok=True)

    # (2) den fulde gate(): REAL_OUT midlertidigt ombundet til den afdrevne
    # kopi, ALDRIG det rigtige indhold — og ubetinget gendannet i finally,
    # uanset om gate() selv rejser en undtagelse.
    grammar_drift = _drifted_copy(check_grammar_assembly.REAL_OUT, "selftest-grammar-drift-gate.json")
    orig_grammar_real_out = check_grammar_assembly.REAL_OUT
    try:
        check_grammar_assembly.REAL_OUT = grammar_drift
        gate_result = gate()
        if not any("grammatik-samling" in f for f in gate_result):
            fails.append("gate() fangede IKKE et injiceret, afdrevet grammatik-facit (REAL_OUT ombundet)")
    finally:
        check_grammar_assembly.REAL_OUT = orig_grammar_real_out
        grammar_drift.unlink(missing_ok=True)

    pairs_drift = _drifted_copy(check_pairs_assembly.REAL_OUT, "selftest-pairs-drift-gate.json")
    orig_pairs_real_out = check_pairs_assembly.REAL_OUT
    try:
        check_pairs_assembly.REAL_OUT = pairs_drift
        gate_result = gate()
        if not any("par-samling" in f for f in gate_result):
            fails.append("gate() fangede IKKE et injiceret, afdrevet par-facit (REAL_OUT ombundet)")
    finally:
        check_pairs_assembly.REAL_OUT = orig_pairs_real_out
        pairs_drift.unlink(missing_ok=True)

    for f in fails:
        print("FEJL:", f)
    print("selftest:", "bestået" if not fails else f"{len(fails)} fejl")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--text", help="døm en enkelt tekststreng og udskriv resultatet")
    ap.add_argument("--source", choices=["grammar", "pairs"], default="grammar",
                     help="kilde for --text: styrer om sætnings-/ordloftet håndhæves (kun grammar)")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    fp = build_fingerprint()
    if args.text:
        result = judge(args.text, fp, source=args.source)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    failures = gate()
    if failures:
        for f in failures:
            print("❌", f)
        print(f"\n{len(failures)} kandidat-replikker dømt ude.")
        return 1
    print("✅ Alt kandidatindhold (grammatik + bagte par) består stemmedommeren.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
