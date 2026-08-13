#!/usr/bin/env python3
"""Kalibrering — TASK-029.

Kører dommeren (judge.py) over HELE grammatikken og alle bagte par, sætter
tærsklen ud fra det håndskrevne korpus' egen scorefordeling, og skriver hele
målingen — fordelinger, hårde afvisninger, tærskelvalg, og de konkrete
værste replikker — til docs/design/narration-voice.md.

Stort set intet tal i den fil er tastet ind i hånden: alt beregnes her, hver
gang scriptet kører, ud fra det faktiske indhold. To undtagelser:
sektionen "Rettede replikker denne runde" er en statisk, dateret hændelseslog
hentet fra `calibration_history.json` (data, ikke Python) — den beskriver hvad
der blev rettet UNDER 2026-08-12-kalibreringsrunden og opdateres ikke af sig
selv, hvis indholdet ændres igen (ligesom en changelog, ikke en måling).
Tilsvarende er bagte pars ordtal-BÅND (`pairs_wordcount_band()`) hentet
FROSSET fra `pairs_baseline.json` i stedet for genberegnet her — dette script
viser båndet og en live-genberegning ved siden af hinanden til
skreds-kontrol, men rører aldrig selve frysningen (det gør kun
`freeze_pairs_baseline.py`, eksplicit). Kørsel:

    python3 tools/voice/calibrate.py

Skriver docs/design/narration-voice.md og udskriver et kort resumé.
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as J  # noqa: E402
from metrics import build_fingerprint  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "docs" / "design" / "narration-voice.md"
HISTORY = Path(__file__).resolve().parent / "calibration_history.json"

WORST_N = 12  # hvor mange konkrete eksempler der navngives verbatim pr. korpus


def _dist(scores: list[float]) -> dict[str, float]:
    s = sorted(scores)
    n = len(s)

    def pct(p: float) -> float:
        idx = min(n - 1, int(p / 100 * n))
        return s[idx]

    return {
        "n": n,
        "min": s[0],
        "p1": pct(1),
        "p5": pct(5),
        "p10": pct(10),
        "median": statistics.median(s),
        "mean": statistics.mean(s),
        "max": s[-1],
    }


def _score_all(items: list[tuple[str, str]], fp: dict[str, Any],
                corpus_vocab: set[str], dom_vocab: set[str], *,
                source: str = "grammar",
                pairs_band: dict[str, float] | None = None) -> list[tuple[str, str, dict]]:
    """`source`/`pairs_band` SKAL sættes rigtigt pr. korpus (se score()'s
    docstring) — ellers scores bagte par ved en fejl mod det håndskrevne
    ordtal-bånd i stedet for deres eget, og rapportens tal matcher ikke
    hvad gate() faktisk håndhæver."""
    out = []
    for label, text in items:
        result = J.score(text, fp, corpus_vocab, dom_vocab, source=source, pairs_band=pairs_band)
        out.append((label, text, result))
    return out


def _hard_reject_breakdown(items: list[tuple[str, str]], fp: dict[str, Any],
                            source: str) -> dict[str, int]:
    """Pr.-kandidat (ikke pr.-hit) optælling: hvor mange kandidater rammer
    MINDST ét eksempel af hver kategori. `source` styrer om sætnings-/
    ordloftet håndhæves (kun "grammar", se hard_reject()'s docstring) — for
    source="pairs" er "sentences>3"/"words>32" derfor altid 0 HÅNDHÆVET,
    men se `_length_overage()` for de beskrivende (ikke-håndhævede) tal."""
    cats = {
        "sentences>3": 0, "words>32": 0, "fejlmeddelelse": 0,
        "moderne ordforråd": 0, "genbrugt punchline": 0,
    }
    any_reject = 0
    for _, text in items:
        reasons = J.hard_reject(text, fp, source=source)
        if reasons:
            any_reject += 1
        joined = " | ".join(reasons)
        if "sætninger" in joined:
            cats["sentences>3"] += 1
        if " ord (" in joined:
            cats["words>32"] += 1
        if "fejlmeddelelse" in joined:
            cats["fejlmeddelelse"] += 1
        if "moderne ordforråd" in joined:
            cats["moderne ordforråd"] += 1
        if "genbrugt punchline" in joined:
            cats["genbrugt punchline"] += 1
    return {"any": any_reject, "n": len(items), **cats}


def _length_overage(items: list[tuple[str, str]]) -> dict[str, int]:
    """Rent beskrivende (IKKE håndhævet) optælling af hvor mange kandidater
    ville have overskredet sætnings-/ordloftet, uanset kilde-politik. Bruges
    til at vise bagte pars faktiske længde uden at foregive at det er en
    afvisningsgrund for dem (se hard_reject()'s docstring, politik 2026-08-12)."""
    over_sent = sum(1 for _, t in items if len(J.split_sentences(t)) > J.HARD_MAX_SENTENCES)
    over_words = sum(1 for _, t in items if len(J.tokenize_words(t)) > J.HARD_MAX_WORDS)
    return {"n": len(items), "sentences>3": over_sent, "words>32": over_words}


def _fmt_dist_row(label: str, d: dict[str, float]) -> str:
    return (f"| {label} | {d['n']} | {d['min']:.3f} | {d['p1']:.3f} | {d['p5']:.3f} | "
            f"{d['p10']:.3f} | {d['median']:.3f} | {d['mean']:.3f} | {d['max']:.3f} |")


def _fmt_reject_row(label: str, b: dict[str, int]) -> str:
    n = b["n"]

    def pc(k: str) -> str:
        return f"{b[k]} ({100 * b[k] / n:.1f} %)"

    return (f"| {label} | {n} | {pc('any')} | {pc('sentences>3')} | {pc('words>32')} | "
            f"{pc('fejlmeddelelse')} | {pc('moderne ordforråd')} | {pc('genbrugt punchline')} |")


def _worst(scored: list[tuple[str, str, dict]], n: int) -> list[tuple[str, str, dict]]:
    return sorted(scored, key=lambda t: t[2]["overall"])[:n]


def main() -> int:
    fp = build_fingerprint()
    corpus_vocab = set(fp["vocabulary"]["frequency"])
    dom_vocab = J.domain_vocabulary()
    history = json.loads(HISTORY.read_text(encoding="utf-8"))

    hw = J.handwritten_variants(fp)
    gram = J.expand_grammar()
    pairs = J.expand_pairs()
    pairs_band = J.pairs_wordcount_band()  # FROSSET facit — se judge.py's docstring
    pairs_band_live = J.recompute_pairs_wordcount_band(pairs)  # kun til rapportens skreds-tjek

    hw_scored = _score_all(hw, fp, corpus_vocab, dom_vocab)
    gram_scored = _score_all(gram, fp, corpus_vocab, dom_vocab, source="grammar")
    pairs_scored = _score_all(pairs, fp, corpus_vocab, dom_vocab, source="pairs", pairs_band=pairs_band)

    hw_dist = _dist([s["overall"] for _, _, s in hw_scored])
    gram_dist = _dist([s["overall"] for _, _, s in gram_scored])
    pairs_dist = _dist([s["overall"] for _, _, s in pairs_scored])

    gram_reject = _hard_reject_breakdown(gram, fp, source="grammar")
    pairs_reject = _hard_reject_breakdown(pairs, fp, source="pairs")
    pairs_length_desc = _length_overage(pairs)  # beskrivende kun — ikke håndhævet, se docstring

    threshold = J.calibrated_threshold(fp)

    # Tærskel-sammenligning ved p1/p5/p10 — til at begrunde valget.
    hw_only_scores = sorted(s["overall"] for _, _, s in hw_scored)

    def pctile(p: float) -> float:
        idx = min(len(hw_only_scores) - 1, int(p / 100 * len(hw_only_scores)))
        return hw_only_scores[idx]

    def gate_fail_at(t: float) -> tuple[int, int]:
        g = sum(1 for _, text in gram if J.hard_reject(text, fp, source="grammar") or
                 J.score(text, fp, corpus_vocab, dom_vocab, source="grammar")["overall"] < t)
        p = sum(1 for _, text in pairs if J.hard_reject(text, fp, source="pairs") or
                 J.score(text, fp, corpus_vocab, dom_vocab, source="pairs",
                         pairs_band=pairs_band)["overall"] < t)
        return g, p

    threshold_rows = []
    for p in (1, 5, 10):
        t = pctile(p)
        g_fail, p_fail = gate_fail_at(t)
        threshold_rows.append((p, t, g_fail, p_fail))

    # Ordtal for par vs. håndskrevet — den store strukturelle forskel.
    pairs_words = sorted(len(J.tokenize_words(text)) for _, text in pairs)
    hw_words = sorted(len(J.tokenize_words(text)) for _, text in hw)
    pairs_chars = sorted(len(text) for _, text in pairs)

    def wpct(arr, p):
        return arr[min(len(arr) - 1, int(p / 100 * len(arr)))]

    # Værste eksempler: laveste score blandt kandidater der IKKE allerede er
    # hård-afvist (de hårde afvisninger vises for sig; her er "bedst mislykkede
    # men snigende" tilfælde interessante) + de faktiske hårde afvisninger.
    gram_hard_hits = [(l, t, J.hard_reject(t, fp, source="grammar")) for l, t in gram
                       if J.hard_reject(t, fp, source="grammar")]
    pairs_hard_hits = [(l, t, J.hard_reject(t, fp, source="pairs")) for l, t in pairs
                        if J.hard_reject(t, fp, source="pairs")]

    gram_worst_soft = _worst(
        [(l, t, s) for l, t, s in gram_scored if not J.hard_reject(t, fp, source="grammar")], WORST_N)
    pairs_worst_soft = _worst(
        [(l, t, s) for l, t, s in pairs_scored if not J.hard_reject(t, fp, source="pairs")], WORST_N)

    punchline_hits = [(l, t, r) for l, t, r in
                       [(l, t, J.hard_reject(t, fp, source="grammar")) for l, t in gram] +
                       [(l, t, J.hard_reject(t, fp, source="pairs")) for l, t in pairs]
                       if any("punchline" in x for x in r)]

    pl_lens = sorted(len(p.split()) for p in fp["punchlines"])
    pl_short = sum(1 for p in fp["punchlines"] if len(p.split()) <= 3)
    pl_generic = sum(1 for p in fp["punchlines"] if p in J.GENERIC_PUNCHLINE_EXEMPTIONS)

    md = []
    md.append("# Stemmedommer: kalibrering af fingeraftryk og tærskel\n\n")
    md.append(
        "Samme metode som den visuelle dommer (`tools/judge/`): mål afstanden til "
        "referencen, afvis på tallet, ikke på fornemmelsen. Referencen her er ikke "
        "ét billede men fordelingen af de håndskrevne replikkers egne tal — "
        "tærsklen er derfor udledt af korpusset selv, ikke et ønsketal (se "
        "\"Tærskel\" nedenfor).\n"
    )

    md.append("\n## Korpus: hvor mange håndskrevne replikker er der?\n\n")
    c = fp["corpus"]
    md.append(
        f"Tre forskellige, alle rigtige tal, alt efter hvad man spørger om:\n\n"
        f"- **{c['narratorLineUniqueCount']}** unikke replik-TEKSTER er markeret `narratorLine` "
        f"i `content/combos.json` (efter at have fjernet dubletter — flere kombinationer "
        f"kan pege på samme skrevne replik).\n"
        f"- **{c['narratorLineRefCount']}** er antallet af `narratorLine`-REFERENCER i "
        f"`combos.json` (én pr. kombination, inklusive gentagelser af samme replik).\n"
        f"- **{c['planClaimedNarratorLineCount']}** er tallet planens tekst selv nævner "
        f"(TASK-015/027) — hverken {c['narratorLineRefCount']} eller "
        f"{c['narratorLineUniqueCount']}. Se \"Uoverensstemmelser med planen\" nedenfor.\n\n"
        f"Fingeraftrykket i dette dokument er bygget af et FJERDE, bevidst bredere tal: "
        f"**{c['totalLineDefs']}** replik-definitioner ({c['act1LineDefs']} i akt 1, "
        f"{c['act2LineDefs']} i akt 2) fra `lines`-nøglen i `act-1.json`/`act-2.json`, "
        f"med **{c['totalVariantStrings']}** varianttekster i alt. `lines` er det eneste sted "
        f"håndskrevet fortæller-tekst rent faktisk STÅR — nøgler som `genericFailure`, "
        f"`deflectedEndingLine`, `discoveryFallback`, `challengeWarningLine`, `defiance`, "
        f"`defianceComic` og `obeyedFailure` er rene ID-pointere IND i `lines`, ikke egen "
        f"tekst (efterset i `act-1.json`/`act-2.json` — ingen af dem har en `text`- eller "
        f"`variants`-nøgle af egen kraft). At måle stemmen på kun de "
        f"{c['narratorLineUniqueCount']}/{c['narratorLineRefCount']} `narratorLine`-mærkede "
        f"replikker ville udelukke hundredvis af replikker der er lige så håndskrevne — "
        f"blot brugt et andet sted i flowet (fejl-tekst, afvisninger, opdagelsesfald-tilbage). "
        f"Se docstringen øverst i `metrics.py` for den fulde begrundelse.\n"
    )

    md.append("\n## Fingeraftrykket — nøgletal\n\n")
    wl = fp["wordLength"]["pooled"]
    spl = fp["sentencesPerLine"]
    wpl = fp["wordsPerLine"]
    pt = fp["presentTense"]
    ff = fp["fixedFigures"]
    md.append(
        f"- **Ordlængde** (bogstaver/ord, alle ord poolet): median {wl['median']:.1f}, "
        f"middel {wl['mean']:.2f}, spredning {wl['stdev']:.2f}.\n"
        f"- **Sætninger pr. replik**: median {spl['median']:.0f}, middel {spl['mean']:.2f}, "
        f"p90 {spl['p90']:.0f}. **{spl['overHardCap']}/{c['totalVariantStrings']} "
        f"({100 * spl['overHardCap'] / c['totalVariantStrings']:.1f} %)** af de HÅNDSKREVNE "
        f"varianter har selv mere end {spl['hardCap']} sætninger — stakkato-stilen "
        f"(\"Sparks fly. Karl gasps. I gasp. The boar leaves.\") er ægte, ikke en fejl i "
        f"optællingen. Se \"Hård afvisning af sætningstal\" i `judge.py`'s docstring.\n"
        f"- **Ord pr. replik**: median {wpl['median']:.0f}, p90 {wpl['p90']:.0f}, "
        f"max {wpl['max']:.0f}. {wpl['overHardCap']}/{c['totalVariantStrings']} håndskrevne "
        f"varianter overstiger selv det hårde loft på {wpl['hardCap']} ord.\n"
        f"- **Nutid**: {100 * pt['shareAmongDecidedSentences']:.1f} % af de sætninger der "
        f"overhovedet kan afgøres (resten er tidsløse/uafgørbare), {100 * pt['shareAmongAllSentences']:.1f} % "
        f"af ALLE sætninger.\n"
        f"- **Faste figurer**: Karl nævnt i {100 * ff['karl']['lineShare']:.0f} % af replikkerne, "
        f"vildsvinet i {100 * ff['boar']['lineShare']:.0f} %, \"Grub Man\" i "
        f"{100 * ff['grubMan']['lineShare']:.1f} %. Ikke en scoringsdimension pr. kandidat "
        f"(se `judge.py`) — kun beskrivende, fordi over halvdelen af ægte replikker ikke "
        f"nævner nogen af dem.\n"
        f"- **Ordforråd**: {fp['vocabulary']['uniqueTokens']} unikke ord over "
        f"{fp['vocabulary']['totalTokens']} tokens.\n"
        f"- **Punchlines**: {len(fp['punchlines'])} unikke, normaliserede slutlinjer. "
        f"{pl_short}/{len(fp['punchlines'])} ({100 * pl_short / len(fp['punchlines']):.1f} %) "
        f"er {3} ord eller kortere (\"{fp['punchlines'][0] if fp['punchlines'] else ''}\" …) — "
        f"relevant for genbrugs-afvisningen nedenfor.\n"
    )

    md.append("\n## Politik: kilde-sammensatte gates (2026-08-12, udvidet 2026-08-13)\n\n")
    md.append(
        "En hård port der fældede 488 allerede godkendte replikker kunne ikke lukke "
        "TASK-030 — se punkt 2/9 i \"Uoverensstemmelser med planen\" for den fulde "
        "historik. Beslutningen, truffet eksplicit denne runde, er at PORTEN er "
        "sammensat af to kilde-specifikke regelsæt i stedet for ét fælles regelsæt — "
        "ikke en svækkelse af nogen af dem:\n\n"
        "1. **32-ords-/3-sætnings-loftet håndhæves kun for `source=\"grammar\"`** "
        "(grammatik og fremtidig live-genereret tekst). Bagte par har deres eget, "
        "allerede godkendte kontraktloft — 320 tegn, `tools/check_pairs.py`, TASK-023 — "
        "og håndhæves IKKE mod grammatikkens ordtal-loft. Stemmescore, "
        "moderne/fejlmeddelelses-register og meningsfuld punchline-genbrug gælder "
        "fortsat for bagte par UÆNDRET; kun de to hårde længde-tal er kilde-betingede. "
        "Se `hard_reject()`'s docstring i `judge.py`.\n"
        "2. **Punchline-genbrug hård-afvises for ALT undtagen en lille, håndklassificeret "
        "liste af genuint generiske lukninger** (`genericPunchlineExemptions` i "
        "`lexicon.json`, TASK-030-opfølgning 2026-08-13). Første udgave af denne regel "
        "brugte et blankt ordtals-loft (\"under 4 ord tæller ikke\") — men kodegennemgang "
        "viste at det var for groft: et vilkårligt ordtal fritog IKKE KUN generiske "
        "negationer som \"not today\", men også korpussets EGNE korte, distinkte "
        "punchlines (\"grub man\", \"we have fire\") hvis en kandidat tilfældigvis genbrugte "
        f"præcis dem. Listen er derfor nu {len(J.GENERIC_PUNCHLINE_EXEMPTIONS)} håndklassificerede "
        "lukninger, hver vurderet mod sin FULDE oprindelseslinje i korpus (ikke bare den "
        "isolerede slutning) efter en skarp regel: enten (a) rent grammatisk — kun "
        "pronominer/hjælpeverber/negation/konjunktioner, intet selvstændigt indholdsord — "
        "eller (b) et bogstaveligt, gentaget strukturmærke (\"the end\", som optræder i "
        "35+ forskellige slut-replikker som titelkort, ikke en vittighed). "
        f"{pl_generic}/{len(fp['punchlines'])} håndskrevne punchlines matcher listen. Se "
        "`lexicon.json`'s `_genericPunchlineExemptionsKommentar` for den fulde, "
        "replik-for-replik begrundelse, og `judge.py`'s selftest for et eksplicit bevis "
        "på begge retninger: alle 14 undtagelser består, og de fire eksempler kodegennemgangen "
        "selv navngav som SKAL blive ved med at fælde en kandidat (\"grub man\"/\"we have "
        "fire\"/\"onward, humanity\"/\"third time, harpoon\") gør netop det.\n\n"
        "**Et tredje, mindre indlysende problem dukkede op EFTER at have implementeret "
        "punkt 1 og 2 ovenfor: fjernelse af det hårde ordtal-loft for bagte par løste "
        "kun den HÅRDE afvisning — men den KONTINUERLIGE `wordCount`-dimension i "
        "`score()` målte stadig bagte pars ordtal mod det HÅNDSKREVNE korpus' egen "
        "ordtal-fordeling** (median 17, p90 26 — se \"Fingeraftrykket\" ovenfor). Bagte "
        f"par er systematisk cirka dobbelt så lange (selv-målt: median "
        f"{pairs_band['median']:.0f}, p90 {pairs_band['p90']:.0f}) under deres egen "
        "320-tegns-kontrakt — så selv efter punkt 1 blev **327 af 908 bagte "
        "par-varianter** ved en fejl ved at falde under tærsklen alene på grund af "
        "denne ene dimension, hvilket reelt genindførte næsten den samme straf som "
        "punkt 1 lige havde fjernet, bare via en blødere mekanisme. Diagnosticeret "
        "præcist: `wordCount`-dimensionen scorede i gennemsnit 0.226 blandt de "
        "fejlende mod 0.731 blandt de bestående, mens alle 5 øvrige dimensioner lå "
        "0.94-1.0 i BEGGE grupper — dvs. denne ene dimension var eneste årsag.\n\n"
        "**Første løsning (2026-08-12)** var `pairs_wordcount_band()`: bagte pars "
        "`wordCount`-dimension scoret mod bagte pars EGEN, LIVE-genberegnede ordtal-"
        "fordeling i stedet for det håndskrevne korpus'. Effekt dengang: bagte "
        "par-fejl faldt fra 327 til 12.\n\n"
        "**Kodegennemgang (2026-08-13) fandt et selv-modsigende problem i netop den "
        "løsning**: et bånd der altid genberegnes fra netop de kandidater det dømmer, "
        "kan definitorisk aldrig opdage at kandidaterne SOM HELHED er skredet — båndet "
        "flytter sig MED dem og finder dem for evigt \"normale\", uanset hvor lange de "
        "bliver. Løsningen er at FRYSE båndet: `tools/voice/pairs_baseline.json` er et "
        "øjebliksbillede af ordtal-fordelingen taget DA de 908 varianter var "
        "menneske-godkendte (TASK-023) og bestod stemmedommeren — ikke et tal der "
        "opdaterer sig selv. Genkalibrering kræver nu en eksplicit, synlig handling "
        "(`python3 tools/voice/freeze_pairs_baseline.py`), aldrig en stiltiende "
        "bivirkning af at dømme. `judge.py`'s selftest beviser det konkret: rigtige par "
        "scorer i snit 0.958 mod det frosne bånd; de SAMME par, kunstigt oppustet med 40 "
        "fyldord hver, scorer 0.079 mod DET SAMME frosne bånd (skredet fanges) — men ville "
        "scoret 0.958 igen mod et bånd genberegnet FRA netop den oppustede mængde (det er "
        "præcis den blindhed frysningen forhindrer). `calibrate.py` (denne rapport) viser "
        "til sammenligning begge tal — det frosne bånd og hvad en live-genberegning ville "
        "sige lige nu — i \"Frosset ordtal-bånd for bagte par\" nedenfor.\n\n"
        "**Talrækken gennem hele runden** (grammatik + bagte par, tilsammen): "
        "488 fejl under den bogstavelige, fælles 32-ords-/3-sætnings-regel (24 "
        "grammatik + 464 par) → 349 efter punkt 1+2's kode var på plads, men FØR "
        "`pairs_wordcount_band()`-fundet (22 grammatik + 327 par) → 34 efter "
        "`pairs_wordcount_band()`-rettelsen (22 grammatik + 12 par) → **0** efter at "
        "alle 34 replikker er omskrevet indholdsmæssigt (se `gate.py`'s output i "
        "rapporten). Ingen af de tre mellemliggende tal er forkerte — de er "
        "øjebliksbilleder af samme mængde arbejde, målt før hvert af de tre "
        "efterfølgende rettelsestrin.\n"
    )

    md.append("\n## Frosset ordtal-bånd for bagte par (2026-08-13)\n\n")
    baseline = json.loads((Path(__file__).resolve().parent / "pairs_baseline.json").read_text(encoding="utf-8"))
    drift_real = statistics.fmean(
        J.range_score(float(len(J.tokenize_words(t))), pairs_band) for _, t in pairs)
    inflated = [t + " " + " ".join(["utterly"] * 40) for _, t in pairs]
    drift_inflated_vs_frozen = statistics.fmean(
        J.range_score(float(len(J.tokenize_words(t))), pairs_band) for t in inflated)
    drift_inflated_vs_live = statistics.fmean(
        J.range_score(float(len(J.tokenize_words(t))), J.words_per_line_stats(inflated)) for t in inflated)
    md.append(
        f"Frosset version {baseline['version']}, {baseline['frozenAt']}, fra commit "
        f"`{baseline['frozenFromCommit'][:12]}` ({baseline['sourcePairCount']} par, "
        f"{baseline['sourceVariantCount']} varianter). Genkalibrering: "
        "`python3 tools/voice/freeze_pairs_baseline.py` — aldrig automatisk.\n\n"
        "| | median | p10 | p90 | n |\n"
        "|---|---:|---:|---:|---:|\n"
        f"| Frosset (bruges af gate()) | {pairs_band['median']:.0f} | {pairs_band['p10']:.0f} | "
        f"{pairs_band['p90']:.0f} | {baseline['sourceVariantCount']} |\n"
        f"| Live genberegnet lige nu | {pairs_band_live['median']:.0f} | {pairs_band_live['p10']:.0f} | "
        f"{pairs_band_live['p90']:.0f} | {len(pairs)} |\n\n"
        + ("Frosset og live matcher fuldstændigt — ingen indholdsskred siden frysningen.\n\n"
           if pairs_band == pairs_band_live else
           "**Frosset og live afviger** — bagte par-indholdet har ændret sig siden frysningen. "
           "Ikke nødvendigvis et problem (kan være legitimt nyt indhold), men bør vurderes "
           "af et menneske: er afvigelsen forventet vækst, eller skred? Se "
           "`docs/design/human-queue.json`.\n\n") +
        "**Drift-beviset (samme tal som selftesten i `judge.py`, her mod det faktiske "
        "aktuelle indhold i stedet for en fixture):**\n\n"
        f"- Rigtige par mod det frosne bånd: gennemsnitlig ordtal-score **{drift_real:.3f}**.\n"
        f"- De SAMME par, hver oppustet med 40 fyldord, mod det SAMME frosne bånd: "
        f"**{drift_inflated_vs_frozen:.3f}** — skredet fanges.\n"
        f"- De oppustede par mod et bånd genberegnet FRA den oppustede mængde selv: "
        f"**{drift_inflated_vs_live:.3f}** — ville set normalt ud, hvis båndet ikke var "
        "frosset. Det er præcis den blindhed frysningen forhindrer.\n"
    )

    md.append(f"\n## Rettede replikker denne runde ({len(history['grammar']) + len(history['pairs'])} stk., audit trail)\n\n")
    md.append(
        f"Data-kilde: `calibration_history.json` (dateret {history['date']}) — den ENESTE "
        "statiske undtagelse fra denne rapports ellers levende, genberegnede tal (se "
        "modulets docstring). Før/efter-teksten herunder er verificeret mod det faktiske "
        "git-diff på redigeringstidspunktet, ikke gengivet fra hukommelsen. Fremtidige "
        "kørsler af dette script GENBEREGNER ikke denne liste — den er en logbog over "
        "ÉN runde rettelser, ikke en løbende måling.\n\n"
    )
    md.append(f"### Grammatik ({len(history['grammar'])} varianter)\n\n")
    for entry in history["grammar"]:
        md.append(
            f"- **{entry['label']}** — {entry['reason']}\n"
            f"  - Før: *{entry['before']}*\n"
            f"  - Efter: *{entry['after']}*\n"
        )
    md.append(f"\n### Bagte par ({len(history['pairs'])} varianter)\n\n")
    for entry in history["pairs"]:
        md.append(
            f"- **{entry['label']}** — {entry['reason']}\n"
            f"  - Før: *{entry['before']}*\n"
            f"  - Efter: *{entry['after']}*\n"
        )

    md.append("\n## Score-fordelinger\n\n")
    md.append(
        "`overall` er et uvægtet gennemsnit af 6 dimensioner (ordlængde, sætningstal, "
        "ordtal, ordforråd, nutid, tegnsætning), hver scoret 0-1 via intervalscoring mod "
        "korpusets EGEN spredning (se `judge.py`'s docstring — ikke z-score, fordi flere "
        "kanaler er nul-tunge). Håndskrevet er scoret mod sit eget fingeraftryk — "
        "cirkulært for punchline-afvisning (se nedenfor), men informativt for selve "
        "scorefordelingen.\n\n"
        "| korpus | n | min | p1 | p5 | p10 | median | middel | max |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|\n"
        f"{_fmt_dist_row('Håndskrevet (mod eget fingeraftryk)', hw_dist)}\n"
        f"{_fmt_dist_row('Grammatik (ekspanderet)', gram_dist)}\n"
        f"{_fmt_dist_row('Bagte par (ekspanderet)', pairs_dist)}\n"
    )

    md.append("\n## Hårde afvisninger\n\n")
    md.append(
        "Pr.-kandidat optælling (én kandidat kan ramme flere kategorier, men tælles kun "
        "én gang i \"mindst én\"). Håndskrevet er UDELADT fra denne tabel med vilje: "
        "\"genbrugt punchline\" ville ramme en stor del af det håndskrevne korpus, fordi "
        "punchline-blokeringslisten er bygget FRA det — cirkulært, ikke en reel fejl. "
        "`gate()` kører derfor aldrig hårde afvisninger mod det håndskrevne korpus, kun "
        "mod grammatik og bagte par.\n\n"
        "**Kolonnerne \">3 sætninger\"/\">32 ord\" er, efter politik 2026-08-12 (se "
        "\"Politik\" ovenfor), kun HÅNDHÆVET for grammatik — for bagte par håndhæves i "
        "stedet `tools/check_pairs.py`'s 320-tegns-loft (en ekstern, allerede eksisterende "
        "port; se `_length_overage()`'s docstring i `calibrate.py`). Bagte par viser derfor "
        "altid 0 her, ikke fordi de er korte, men fordi denne specifikke regel ikke gælder "
        "for dem.\n\n"
        "| korpus | n | mindst én | >3 sætninger (håndhævet) | >32 ord (håndhævet) | fejlmeddelelse | moderne ordforråd | genbrugt punchline |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|\n"
        f"{_fmt_reject_row('Grammatik', gram_reject)}\n"
        f"{_fmt_reject_row('Bagte par', pairs_reject)}\n"
    )
    md.append(
        f"\n**Bagte par, til orientering (IKKE håndhævet — kun beskrivende længde): "
        f"{pairs_length_desc['sentences>3']}/{pairs_length_desc['n']} ville overskride "
        f"3-sætnings-loftet og {pairs_length_desc['words>32']}/{pairs_length_desc['n']} "
        f"({100 * pairs_length_desc['words>32'] / pairs_length_desc['n']:.1f} %) ville "
        f"overskride 32-ords-loftet, HVIS grammatikkens loft blev anvendt bogstaveligt "
        f"på dem.** Det er præcis den observation der begrundede politikbeslutningen "
        f"2026-08-12: bagte par er en strukturelt længere indholdstype under sin egen, "
        f"allerede godkendte 320-tegns-kontrakt (TASK-023), og at måle dem mod "
        f"grammatikkens korte skabelonloft ville straffe allerede godkendt indhold for "
        f"en regel der aldrig var skrevet til dem. Se \"Politik\" ovenfor og "
        f"\"Uoverensstemmelser med planen\" nedenfor for den fulde historik.\n"
    )

    md.append("\n## Tærskel: valg og begrundelse\n\n")
    md.append(
        "Tærsklen er en percentil af det håndskrevne korpus' EGEN scorefordeling — "
        "aldrig et ønsketal. Testet ved tre kandidat-percentiler mod det faktiske "
        "indhold (tærskel KOMBINERET med hårde afvisninger, dvs. den reelle "
        "gate-fejlrate):\n\n"
        "| percentil | tærskel | grammatik fejler | bagte par fejler |\n"
        "|---|---:|---:|---:|\n"
    )
    for p, t, g_fail, p_fail in threshold_rows:
        md.append(
            f"| p{p} | {t:.4f} | {g_fail}/{len(gram)} ({100 * g_fail / len(gram):.1f} %) | "
            f"{p_fail}/{len(pairs)} ({100 * p_fail / len(pairs):.1f} %) |\n"
        )
    md.append(
        f"\n**Valgt: p5 = {threshold:.4f}.**\n\n"
        "- p1 gør den kontinuerlige score redundant: den fanger 0 kandidater ud over "
        "hvad de hårde afvisninger allerede fanger, i BÅDE grammatik og par. En tærskel "
        "der aldrig selv fælder nogen dom, tester ikke noget — den er der kun på papiret.\n"
        "- p10 fanger markant flere (se tabellen), men ved manuel gennemlæsning lyder "
        "flere af de EKSTRA kandidater tydeligt som fortælleren selv — de straffes reelt "
        "for at ligge i den lange hale mellem korpusets typiske spredning og det hårde "
        "32-ords-loft, ikke fordi de lyder forkerte. Eksempler er navngivet i "
        "\"De værste eksempler\" nedenfor.\n"
        "- p5 rammer midtimellem: den er ikke redundant, og de ekstra kandidater den "
        "fanger (ud over p1/hårde afvisninger) er faktisk mere grænseprægede end "
        "p10-mængden. De er navngivet nedenfor som kandidater til "
        "`docs/design/human-queue.json` — dommeren behøver ikke have ret i hvert "
        "enkelt tilfælde, den skal blot flage billigt til menneskelig kontrol.\n"
    )

    md.append("\n## De værste eksempler (det vigtigste output)\n\n")

    md.append(f"### Grammatik — hårde afvisninger ({len(gram_hard_hits)} stk.)\n\n")
    if gram_hard_hits:
        for lbl, text, reasons in sorted(gram_hard_hits, key=lambda t: t[0])[:WORST_N]:
            md.append(f"- **{lbl}** — {'; '.join(reasons)}\n  > {text}\n")
    else:
        md.append("Ingen.\n")

    md.append(f"\n### Grammatik — lavest scorende der IKKE er hård-afvist ({WORST_N} stk.)\n\n")
    for lbl, text, s in gram_worst_soft:
        dims = ", ".join(f"{k}={v:.2f}" for k, v in s["dimensions"].items())
        md.append(f"- **{lbl}** — overall {s['overall']:.3f} ({dims})\n  > {text}\n")

    md.append(f"\n### Bagte par — hårde afvisninger ({len(pairs_hard_hits)} stk.)\n\n")
    hard_by_words = sorted(
        pairs_hard_hits, key=lambda t: -len(J.tokenize_words(t[1])))
    if hard_by_words:
        md.append(f"Sorteret efter ordtal, {WORST_N} værste:\n\n")
        for lbl, text, reasons in hard_by_words[:WORST_N]:
            md.append(f"- **{lbl}** — {'; '.join(reasons)}\n  > {text}\n")
    else:
        md.append(
            "Ingen — forventet efter politik 2026-08-12: sætnings-/ordtal-loftet "
            "håndhæves ikke for bagte par, så denne liste kan kun fyldes af "
            "score/register/moderne-ordforråd/punchline-hits, som alle er 0 lige nu "
            "(se \"Hårde afvisninger\"-tabellen ovenfor).\n"
        )

    md.append(f"\n### Bagte par — lavest scorende der IKKE er hård-afvist ({WORST_N} stk.)\n\n")
    for lbl, text, s in pairs_worst_soft:
        dims = ", ".join(f"{k}={v:.2f}" for k, v in s["dimensions"].items())
        md.append(f"- **{lbl}** — overall {s['overall']:.3f} ({dims})\n  > {text}\n")

    md.append(f"\n### Genbrugte punchlines — alle {len(punchline_hits)} tilfælde\n\n")
    md.append(
        f"Til kontekst: {pl_generic}/{len(fp['punchlines'])} håndskrevne punchlines står i "
        "`genericPunchlineExemptions` (\"not today\", \"it is not\", \"the end\", …) og "
        "tæller efter politik-punkt 2 ovenfor IKKE som genbrug uanset tilfældigt "
        "sammenfald — kun de resterende, DISTINKTE punchlines kan udløse denne afvisning "
        "(se \"Politik\" ovenfor for hvordan listen er afgrænset, replik for replik, fra "
        "korpussets egne korte-men-distinkte punchlines som \"grub man\"). Før 2026-08-13's "
        "data-drevne liste gav en tidligere, blank \"<4 ord\"-regel falsk alarm på netop "
        "denne slags korte, generiske negationer; de kandidatlinjer der ramte den er nu "
        "omskrevet (se \"Rettede replikker denne runde\" ovenfor). Med både den "
        "data-drevne undtagelseslisten og indholdsrettelserne på plads er der nu reelt 0 "
        "tilfælde tilbage. Selftesten i `judge.py` beviser begge retninger eksplicit: alle "
        "14 undtagelser der matcher korpus består, OG de fire eksempler kodegennemgangen "
        "selv navngav som distinkte (\"grub man\"/\"we have fire\"/\"onward, humanity\"/"
        "\"third time, harpoon\") fælder stadig en kandidat, så denne sektion er ikke "
        "afskaffet — kun tømt indtil en fremtidig kandidatlinje faktisk genbruger en "
        "reel joke.\n\n"
    )
    for lbl, text, reasons in punchline_hits:
        md.append(f"- **{lbl}** — {'; '.join(x for x in reasons if 'punchline' in x)}\n  > {text}\n")
    if not punchline_hits:
        md.append("Ingen — se forklaringen ovenfor.\n")

    md.append("\n## Uoverensstemmelser med planen\n\n")
    md.append(
        f"1. **71 vs. {c['narratorLineRefCount']} vs. {c['narratorLineUniqueCount']} håndskrevne "
        f"replikker.** Planen (TASK-015/027) siger 71. Det virkelige tal afhænger af hvad "
        f"man tæller: {c['narratorLineRefCount']} `narratorLine`-referencer i "
        f"`combos.json`, som peger på kun {c['narratorLineUniqueCount']} unikke tekster "
        f"(flere kombinationer deler samme skrevne replik). Ingen af de tre er forkerte — "
        f"de svarer bare på forskellige spørgsmål. Fingeraftrykket her bruger et fjerde, "
        f"bevidst bredere tal ({c['totalVariantStrings']} varianter over "
        f"{c['totalLineDefs']} replik-definitioner) — se \"Korpus\" ovenfor.\n\n"
        "2. **Det hårde 32-ords-loft passer ikke til bagte par — løst denne runde ved "
        "eksplicit brugerbeslutning (2026-08-12).** TASK-028's tekst specificerede "
        "\"over 32 ord\" som en generel hård afvisning for \"enhver kandidat-replik\". "
        f"Men `tools/check_pairs.py` — den EKSISTERENDE, allerede kørte port for bagte "
        f"par (TASK-023, ✅ færdig) — håndhæver i stedet et loft på **320 tegn** "
        f"(`if len(v) > 320`). Alle {len(pairs)} bagte varianter overholder det loft "
        f"præcist (målt max: {pairs_chars[-1]} tegn) — de var allerede godkendt af et "
        f"menneske under TASK-023's gennemgang. En bogstavelig anvendelse af "
        f"TASK-028's ordtal-regel på bagte par gav oprindeligt "
        f"{pairs_length_desc['words>32']}/{pairs_length_desc['n']} "
        f"({100 * pairs_length_desc['words>32'] / pairs_length_desc['n']:.1f} %) "
        "afvisninger af allerede godkendte replikker — en hård port der fælder 488 "
        "godkendte linjer kunne ikke lukke opgaven. **Besluttet og implementeret "
        "denne runde**: det hårde 32-ords-/3-sætnings-loft gælder KUN "
        "`source=\"grammar\"` (grammatik og fremtidig live-genereret tekst); bagte "
        "par bruger deres eget, allerede godkendte 320-tegns-kontraktloft via "
        "`check_pairs.py` i stedet — se \"Politik: kilde-sammensatte gates\" ovenfor "
        "for den fulde begrundelse og talrækken. Dette er en sammensætning af to "
        "gates efter kildetype, ikke en svækkelse af nogen af dem: stemmescore, "
        "moderne/fejlmeddelelses-register og meningsfuld punchline-genbrug gælder "
        "fortsat for bagte par uændret. Målt: "
        f"håndskrevne replikker har median {statistics.median(hw_words):.0f} ord (p90 "
        f"{wpct(hw_words, 90)}, max {hw_words[-1]}); bagte par har median "
        f"{statistics.median(pairs_words):.0f} ord (p90 {wpct(pairs_words, 90)}, max "
        f"{pairs_words[-1]}) — cirka dobbelt så langt i den typiske replik, og det er "
        "den etablerede norm for denne kildetype, ikke en fejl.\n\n"
        "3. **Grammatikkens tag-specialiseringer findes ikke i indholdet.** TASK-020 er "
        "markeret ✅ færdig (2026-08-12) og påstår \"tag-specialiseringer for de 12 "
        "hyppigste `stuff`-par\" er skrevet. Men `content/narrator/grammar-act-1.json`'s "
        "`grammar`-kort har KUN 7 nøgler — de bare domme (`locked`, `near-miss`, `self`, "
        "`inert`, `clash`, `plausible`, `absurd`) — ingen `\"dom:stuff+stuff\"`- eller "
        "`\"dom:stuff\"`-nøgler overhovedet. `src/narrator/grammar.ts`'s `grammarKeys()` "
        "prøver netop disse to mere specifikke nøgleformer FØR den falder tilbage til den "
        "bare dom (kildekoden bekræfter formatet: `${verdict}:${pair[0]}+${pair[1]}` og "
        "`${verdict}:${stuff}`) — så med indholdet som det er nu, rammer `grammarPool()` "
        "ALTID den generiske pulje, uanset hvilke to `stuff`-typer der indgår. "
        "Tag-specialiseringen er markeret færdig i planen, men findes ikke i det "
        "leverede indhold.\n\n"
        "4. **Planen siger \"otte domme\", koden og indholdet har syv.** TASK-020's "
        "tekst nævner \"de otte domme\" — men `src/core/types.ts`'s `Verdict`-type har "
        "netop 7 værdier (`locked`, `near-miss`, `self`, `inert`, `clash`, `plausible`, "
        "`absurd`), og `grammar-act-1.json` har konsekvent også kun disse 7. Formentlig "
        "en efterladt tekst fra en tidligere designfase snarere end et reelt indholdshul "
        "— nævnt for fuldstændighedens skyld, i samme ånd som 71-vs-74-fundet.\n\n"
        "5. **Planens bogstavelige eksempelord for \"fejlmeddelelses-register\" er selv "
        "falske positiver.** TASK-028's tekst nævner \"cannot\", \"invalid\", \"try "
        "again\" som eksempler. Testet ordret som blokerede enkeltord/-fraser mod alle "
        f"{c['totalVariantStrings']} håndskrevne varianter: \"cannot\" gav 9 reelle "
        "hit i ægte, ikke-fejlmeddelelses-brug (\"The pose cannot.\"), \"can't\" gav 6, "
        "\"unable to\" gav 1. Ordene er eksempler på REGISTERET (softwarefejl-tonefaldet), "
        "ikke en ordret liste der kan slås op som understrenge — en bogstavelig "
        "implementering ville have underkendt ægte, godkendt fortæller-tekst. "
        "`lexicon.json` bruger i stedet mere specifikke, stadig repræsentative fraser "
        "(\"please try again\", \"invalid input/selection\", …) der rammer samme "
        "register uden falske positiver (verificeret: 0 hit i "
        f"{c['totalVariantStrings']} håndskrevne + {len(gram)} grammatik- + {len(pairs)} "
        "par-varianter). Se `_forbiddenConstructionsKommentar` i `lexicon.json`.\n\n"
        "6. **\"car\" er en etableret joke i korpus, ikke et stemmebrud.** Testet som "
        "moderne ordforråd, gav \"car\" 7 hit — men alle i en gentaget, tilsigtet "
        "anakronisme-joke (`story-flintmobil`, `mem-bilist`, `story-drive-in`: Karl "
        "opfinder bilen for tidligt). Fjernet fra `modernVocabulary`; øvrige moderne "
        "tech-ord (tv, mikroovn, internet, …) beholdes, da de ikke har samme etablerede "
        "kanon-status.\n\n"
        "7. **`pairs_wordcount_band()` var en dømmekraftsbeslutning ud over den "
        "bogstavelige instruks — flagget til menneskelig kontrol i sidste runde, nu "
        "AFGJORT via en anden dømmekraftsbeslutning (2026-08-13).** Politik-punkt 1 "
        "(se ovenfor) fjernede det HÅRDE 32-ords-loft for bagte par, men løste ikke at "
        "den KONTINUERLIGE `wordCount`-scoringsdimension stadig målte bagte par mod "
        "det håndskrevne korpus' ordtal-fordeling — hvilket genindførte næsten samme "
        "straf via en blødere mekanisme (327/908 par faldt under tærsklen alene på "
        "denne ene dimension). Første løsning (2026-08-12) scorede bagte pars "
        "`wordCount` mod bagte pars EGEN, LIVE-genberegnede fordeling — men kodegennemgang "
        "påpegede at et bånd der altid genberegnes fra netop de kandidater det dømmer "
        "aldrig kan opdage at kandidaterne SOM HELHED er skredet. Løsningen "
        "(`tools/voice/pairs_baseline.json` + `freeze_pairs_baseline.py`, se "
        "\"Frosset ordtal-bånd\" ovenfor) er MIN egen dømmekraft ud over den bogstavelige "
        "instruks igen (brugeren bad om at fryse båndet, men ikke om de KONKRETE tal "
        "der udgør den første frysning — dem har jeg selv sat fra det aktuelle, "
        "menneske-godkendte indhold). Dokumenteret i `human-queue.json` som løst, med "
        "den nye mekanisme forklaret, ikke bare slettet.\n\n"
        "8. **`genericPunchlineExemptions`-listens 14 konkrete ord er min egen "
        "klassificering, ikke brugerens.** Brugeren gav tre sædfrø-eksempler (\"not "
        "today\", \"it is not\", \"not that\") og et princip (\"1-3-ords generisk "
        "lukning er ikke en punchline\"). De øvrige 11 (`it does not`, `it wasn't`, "
        "`neither did we`, `there is none`, `no`, `he did not`, `you shouldn't`, "
        "`why not`, `and yet`, `but still`, `the end`) er fundet ved selv at læse alle "
        f"{len(fp['punchlines'])} håndskrevne punchlines' FULDE oprindelseslinjer og "
        "afgøre hvilke der er rent sproglige mønstre versus fortællerens distinkte "
        "stemme-teknik (se `lexicon.json`'s kommentar for hvorfor fx `down`/`one`/"
        "`unfortunately` bevidst IKKE er på listen, selvom de er lige så korte). "
        "Flagget i `human-queue.json` til menneskelig sanity-check — rubrikken er "
        "stram og dokumenteret, men den endelige liste er en tolkning, ikke et "
        "objektivt udledt tal som fx tærsklen.\n\n"
        "9. **`gate()` komponerer nu `check_pairs.py` — en udvidelse af TASK-030's "
        "scope, ikke en bogstavelig instruks.** Den oprindelige opgavetekst bad om at "
        "\"give judge.py en ren indgang\" for STEMME-scoring; kodegennemgang bad "
        "specifikt om at `gate()` også skulle bevise par-KONTRAKTEN (navn, dom, "
        "dublet, længde) i stedet for at antage et menneske huskede at køre "
        "`check_pairs.py` separat. Implementeret ved import (ikke subprocess) af en "
        "ny, ren `check_pairs_data()`/`check_pairs_file()`-kerne udtrukket af den "
        "eksisterende fil — `main()`'s CLI-adfærd er verificeret uændret (samme "
        "udskrift, samme returkode på alle 10 udkast-batches). Ikke en judgment call "
        "i samme forstand som punkt 7/8 (brugeren bad eksplicit om præcis dette), men "
        "nævnt her fordi det udvider hvad `gate()` dømmer ud over den oprindelige "
        "opgavetekst.\n\n"
        "10. **`gate()` komponerer nu OGSÅ begge facit-filers reproducerbarhed fra "
        "drafts — sidste blokerende kodegennemgang-punkt (2026-08-13), ikke en "
        "bogstavelig instruks.** `tools/voice/check_grammar_assembly.py` (forrige "
        "runde) og `tools/voice/check_pairs_assembly.py` (denne runde) beviser hver "
        "især at `content/narrator/{grammar,pairs}-act-1.json` er byte-for-byte "
        "reproducerbare fra deres egne drafts under `content/narrator/drafts/`. "
        "Begge var tidligere kun selvstændigt kørbare filer — kodegennemgang påpegede "
        "at et menneske der glemmer at køre dem separat efterlader præcis det hul der "
        "tidligere lod grammatikkens facit gå ud af trit med sine drafts. Begge er nu "
        "refaktoreret til et importerbart kerneindgangspunkt "
        "(`check_grammar_assembly(real_out=...)`/`check_pairs_assembly(real_out=...)` "
        "→ liste af problemer, tom = bestået) som `gate()` kalder direkte, FØR den "
        "dømmer noget indhold — bevist ved to niveauer i `judge.py`'s selftest: "
        "kontrolfunktionen alene, og den FULDE `gate()`, fanger begge et bevidst "
        "injiceret, afdrevet facit via en midlertidig sti (aldrig det rigtige "
        "indhold). Samtidig blev `hardCap`/`overHardCap` fjernet fra det frosne "
        "par-ordtalsbånd (`pairs_baseline.json`, version 1→2, se \"Frosset "
        "ordtal-bånd\" ovenfor) — de beskriver et 32-ords GENERATOR-loft (grammatik) "
        "som bagte par aldrig har haft; deres reelle grænse er check_pairs.py's "
        "320-tegns kontrakt. Ingen af fordelingstallene (mean/median/stdev/percentiler) "
        "ændrede sig ved fjernelsen, kun de to meningsløse nøgler forsvandt.\n"
    )

    md.append("\n## Wiring into validate\n\n")
    md.append(
        "`tools/validate.py` ejes af en anden agent lige nu og røres ikke her. "
        "Sådan kobles stemmedommeren ind, når den anden agents arbejde er flettet — "
        "indsæt lige før den afsluttende rapportering (før `for note in notes:` "
        "nederst i `main()`, efter tjekket af \"Flags der kræves men aldrig sættes\"):\n\n"
        "```python\n"
        "    # Stemmedommer (tools/voice/) — TASK-030.\n"
        "    sys.path.insert(0, str(ROOT / \"tools\" / \"voice\"))\n"
        "    import judge as voice_judge\n"
        "    for f in voice_judge.gate():\n"
        "        err(f\"stemme: {f}\")\n"
        "```\n\n"
        "Fem linjer, ét anker-punkt. `voice_judge.gate()` returnerer allerede "
        "menneskelæsbare, danske fejlstrenge (streng pr. kandidat-linje der enten "
        "rammer en hård afvisning eller scorer under den kalibrerede tærskel, PLUS "
        "en streng pr. facit-fil der ikke er reproducerbar fra sine drafts) — "
        "`err()` lægger dem oveni de eksisterende fejl, så `python3 tools/validate.py` "
        "fejler (exit 1) hvis stemmedommeren finder noget. `gate()` håndterer selv "
        "kilde-sammensætningen internt (se \"Politik: kilde-sammensatte gates\" "
        "ovenfor) — grammatik og bagte par scores hver mod deres egen kontrakt, uden "
        "at wiring'en her behøver filtrere labels efter præfiks. Verificeret: "
        "`python3 tools/voice/gate.py` slutter med exit 0 på det nuværende indhold "
        "(0 grammatik-fejl, 0 par-fejl, begge facit-filer reproducerbare fra drafts), "
        "så denne snippet kan indsættes direkte uden at gøre `npm run validate` rød.\n"
    )

    md.append(
        "\n---\n_Genereret af `python3 tools/voice/calibrate.py`. Regenerér efter enhver "
        "ændring i `content/narrator/*.json`, `tools/voice/lexicon.json`, "
        "`tools/voice/metrics.py` eller `tools/voice/judge.py`._\n"
    )

    OUT.write_text("".join(md), encoding="utf-8")

    print(f"Skrev {OUT.relative_to(ROOT)}")
    print(f"Håndskrevet: n={hw_dist['n']} median={hw_dist['median']:.3f} p5={hw_dist['p5']:.3f}")
    print(f"Grammatik:   n={gram_dist['n']} median={gram_dist['median']:.3f} "
          f"hård-afvist={gram_reject['any']}/{gram_reject['n']}")
    print(f"Bagte par:   n={pairs_dist['n']} median={pairs_dist['median']:.3f} "
          f"hård-afvist={pairs_reject['any']}/{pairs_reject['n']}")
    print(f"Tærskel (p5): {threshold:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
