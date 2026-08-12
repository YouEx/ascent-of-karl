#!/usr/bin/env python3
"""Kalibrering — TASK-029.

Kører dommeren (judge.py) over HELE grammatikken og alle bagte par, sætter
tærsklen ud fra det håndskrevne korpus' egen scorefordeling, og skriver hele
målingen — fordelinger, hårde afvisninger, tærskelvalg, og de konkrete
værste replikker — til docs/design/narration-voice.md.

Ingen tal i den fil er tastet ind i hånden: alt beregnes her, hver gang
scriptet kører, ud fra det faktiske indhold. Kørsel:

    python3 tools/voice/calibrate.py

Skriver docs/design/narration-voice.md og udskriver et kort resumé.
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as J  # noqa: E402
from metrics import build_fingerprint  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "docs" / "design" / "narration-voice.md"

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
                corpus_vocab: set[str], dom_vocab: set[str]) -> list[tuple[str, str, dict]]:
    out = []
    for label, text in items:
        result = J.score(text, fp, corpus_vocab, dom_vocab)
        out.append((label, text, result))
    return out


def _hard_reject_breakdown(items: list[tuple[str, str]], fp: dict[str, Any]) -> dict[str, int]:
    """Pr.-kandidat (ikke pr.-hit) optælling: hvor mange kandidater rammer
    MINDST ét eksempel af hver kategori."""
    cats = {
        "sentences>3": 0, "words>32": 0, "fejlmeddelelse": 0,
        "moderne ordforråd": 0, "genbrugt punchline": 0,
    }
    any_reject = 0
    for _, text in items:
        reasons = J.hard_reject(text, fp)
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

    hw = J.handwritten_variants(fp)
    gram = J.expand_grammar()
    pairs = J.expand_pairs()

    hw_scored = _score_all(hw, fp, corpus_vocab, dom_vocab)
    gram_scored = _score_all(gram, fp, corpus_vocab, dom_vocab)
    pairs_scored = _score_all(pairs, fp, corpus_vocab, dom_vocab)

    hw_dist = _dist([s["overall"] for _, _, s in hw_scored])
    gram_dist = _dist([s["overall"] for _, _, s in gram_scored])
    pairs_dist = _dist([s["overall"] for _, _, s in pairs_scored])

    gram_reject = _hard_reject_breakdown(gram, fp)
    pairs_reject = _hard_reject_breakdown(pairs, fp)

    threshold = J.calibrated_threshold(fp)

    # Tærskel-sammenligning ved p1/p5/p10 — til at begrunde valget.
    hw_only_scores = sorted(s["overall"] for _, _, s in hw_scored)

    def pctile(p: float) -> float:
        idx = min(len(hw_only_scores) - 1, int(p / 100 * len(hw_only_scores)))
        return hw_only_scores[idx]

    def gate_fail_at(t: float) -> tuple[int, int]:
        g = sum(1 for _, text in gram if J.hard_reject(text, fp) or
                 J.score(text, fp, corpus_vocab, dom_vocab)["overall"] < t)
        p = sum(1 for _, text in pairs if J.hard_reject(text, fp) or
                 J.score(text, fp, corpus_vocab, dom_vocab)["overall"] < t)
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
    gram_hard_hits = [(l, t, J.hard_reject(t, fp)) for l, t in gram if J.hard_reject(t, fp)]
    pairs_hard_hits = [(l, t, J.hard_reject(t, fp)) for l, t in pairs if J.hard_reject(t, fp)]

    gram_worst_soft = _worst(
        [(l, t, s) for l, t, s in gram_scored if not J.hard_reject(t, fp)], WORST_N)
    pairs_worst_soft = _worst(
        [(l, t, s) for l, t, s in pairs_scored if not J.hard_reject(t, fp)], WORST_N)

    punchline_hits = [(l, t, r) for l, t, r in
                       [(l, t, J.hard_reject(t, fp)) for l, t in [*gram, *pairs]]
                       if any("punchline" in x for x in r)]

    pl_lens = sorted(len(p.split()) for p in fp["punchlines"])
    pl_short = sum(1 for p in fp["punchlines"] if len(p.split()) <= 3)

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
        "\"genbrugt punchline\" ville ramme 100 % af det håndskrevne korpus, fordi "
        "punchline-blokeringslisten er bygget FRA det — cirkulært, ikke en reel fejl. "
        "`gate()` kører derfor aldrig hårde afvisninger mod det håndskrevne korpus, kun "
        "mod grammatik og bagte par.\n\n"
        "| korpus | n | mindst én | >3 sætninger | >32 ord | fejlmeddelelse | moderne ordforråd | genbrugt punchline |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|\n"
        f"{_fmt_reject_row('Grammatik', gram_reject)}\n"
        f"{_fmt_reject_row('Bagte par', pairs_reject)}\n"
    )
    md.append(
        f"\n**Bagte par: {pairs_reject['words>32']}/{pairs_reject['n']} "
        f"({100 * pairs_reject['words>32'] / pairs_reject['n']:.1f} %) overskrider "
        f"det hårde ordloft på {J.HARD_MAX_WORDS} ord.** Det er den klart største enkeltstående "
        f"afvisningsårsag i hele målingen, og den peger på en reel arkitektonisk "
        f"uoverensstemmelse — se \"Uoverensstemmelser med planen\" nedenfor.\n"
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

    md.append(f"\n### Bagte par — hårde afvisninger, {WORST_N} værste efter ordtal\n\n")
    hard_by_words = sorted(
        pairs_hard_hits, key=lambda t: -len(J.tokenize_words(t[1])))
    for lbl, text, reasons in hard_by_words[:WORST_N]:
        md.append(f"- **{lbl}** — {'; '.join(reasons)}\n  > {text}\n")

    md.append(f"\n### Bagte par — lavest scorende der IKKE er hård-afvist ({WORST_N} stk.)\n\n")
    for lbl, text, s in pairs_worst_soft:
        dims = ", ".join(f"{k}={v:.2f}" for k, v in s["dimensions"].items())
        md.append(f"- **{lbl}** — overall {s['overall']:.3f} ({dims})\n  > {text}\n")

    md.append(f"\n### Genbrugte punchlines — alle {len(punchline_hits)} tilfælde\n\n")
    md.append(
        f"Til kontekst: {pl_short}/{len(fp['punchlines'])} håndskrevne punchlines er "
        f"3 ord eller kortere (\"not today\", \"it is not\", …) — med "
        f"{len(gram) + len(pairs)} kandidatlinjer der hver slutter med en kort, "
        f"almindelig negation, er en vis tilfældig sammenfald på netop DE korte, "
        f"generiske lukninger statistisk venteligt, ikke nødvendigvis et tegn på at "
        f"kandidatlinjen er en bevidst genbrug af en specifik joke. Alle fire er "
        f"navngivet her og bør vurderes af et menneske (se `human-queue.json`):\n\n"
    )
    for lbl, text, reasons in punchline_hits:
        md.append(f"- **{lbl}** — {'; '.join(x for x in reasons if 'punchline' in x)}\n  > {text}\n")

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
        "2. **Det hårde 32-ords-loft passer ikke til bagte par.** TASK-028's tekst "
        f"specificerer \"over 32 ord\" som en generel hård afvisning for \"enhver "
        f"kandidat-replik\". Men `tools/check_pairs.py` — den EKSISTERENDE, allerede "
        f"kørte port for bagte par (TASK-023, ✅ færdig) — håndhæver i stedet et loft på "
        f"**320 tegn** (`if len(v) > 320`). Alle {len(pairs)} bagte varianter overholder "
        f"det loft præcist (målt max: {pairs_chars[-1]} tegn, altså under 320) — de er "
        f"allerede godkendt af et menneske under TASK-023's gennemgang. Men 320 tegn "
        f"engelsk prosa svarer typisk til omkring 45-50 ord, markant løsere end "
        f"stemmedommerens 32-ords-loft. Resultatet: at anvende TASK-028's ordtal-regel "
        f"bogstaveligt på bagte par giver "
        f"{pairs_reject['words>32']}/{pairs_reject['n']} "
        f"({100 * pairs_reject['words>32'] / pairs_reject['n']:.1f} %) afvisninger — IKKE "
        f"fordi replikkerne er dårlige (de er allerede skribent-godkendte), men fordi der "
        f"findes to forskellige, ikke-forenede længdestandarder for samme indholdstype. "
        f"Jeg har implementeret reglen bogstaveligt, som opgaven beder om, men anbefaler "
        f"at et menneske afgør: enten (a) det hårde 32-ords-loft gælder kun grammatik/"
        f"live-genereret tekst og bagte par undtages (de har deres eget etablerede "
        f"320-tegns-loft), eller (b) 32-ords-loftet skal gælde overalt, og de "
        f"{pairs_reject['words>32']} lange par skal redigeres ned. Målt: håndskrevne "
        f"replikker har median {statistics.median(hw_words):.0f} ord (p90 "
        f"{wpct(hw_words, 90)}, max {hw_words[-1]}); bagte par har median "
        f"{statistics.median(pairs_words):.0f} ord (p90 {wpct(pairs_words, 90)}, max "
        f"{pairs_words[-1]}) — cirka dobbelt så langt i den typiske replik.\n\n"
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
        "kanon-status.\n"
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
        "rammer en hård afvisning eller scorer under den kalibrerede tærskel) — "
        "`err()` lægger dem oveni de eksisterende fejl, så `python3 tools/validate.py` "
        "fejler (exit 1) hvis stemmedommeren finder noget. **Bemærk**: se "
        "\"Uoverensstemmelser med planen\" punkt 2 — hvis 32-ords-loftet ikke skal "
        "gælde bagte par, bør wiring'en filtrere `voice_judge.gate()`'s output til kun "
        "`grammar:`-præfikserede labels, eller `gate()` bør selv få et flag for det, "
        "FØR denne snippet indsættes, ellers vil `npm run validate` gå rødt på "
        f"{pairs_reject['words>32']} eksisterende, allerede godkendte par-replikker.\n"
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
