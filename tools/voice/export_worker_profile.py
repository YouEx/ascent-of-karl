#!/usr/bin/env python3
"""Eksporterer stemmedommeren til workerens kompakte JSON-facit — TASK-007
(plan/feature-live-narrator-1.md, fase 3).

## Hvorfor et separat, genereret artefakt i stedet for en TS-genskrivning

Opgaven kræver at workerens TypeScript-scorer bruger DATA, ikke duplikerede
prosakonstanter. Havde workeren sin egen håndskrevne kopi af
`forbiddenConstructions`/`modernVocabulary`/tærsklen/fordelingerne, ville de
to sider skride fra hinanden i det øjeblik nogen redigerer lexicon.json eller
det håndskrevne korpus uden at huske den anden fil — akkurat den fejlklasse
`docs/design/pair-frequency.json` og `tests/fixtures/solves-parity.json`
allerede findes for at undgå andre steder i repoet (se tools/parity_fixture.py).

Dette script bygger derfor ÉT tal- og listeaftryk direkte fra
`build_fingerprint()` (metrics.py), `calibrated_threshold()`,
`domain_vocabulary()` og `pairs_wordcount_band()` (judge.py) og
`lexicon.json`, og skriver det til `worker/src/generated/voice-profile.json`.
Workerens TypeScript-scorer (worker/src/voice/*.ts) importerer KUN denne
fil — den indeholder ingen Python-kode og ingen hardcodede ordlister.

## Hvad tages IKKE med (bevidst)

Kun de 11 nøgler `range_score()`/`novelty_score()`/`_spread()` rent faktisk
læser (mean, median, stdev, min, max, p10, p25, p50, p75, p90, p95) tages med
pr. fordeling — se `_dist()`. `histogram`/`hardCap`/`overHardCap`/`totalWords`
er forfatningstids-beskrivende statistik (til docs/design/narration-voice.md
og calibrate.py), aldrig kørselstids-scoringsinput, og udelades for at holde
artefaktet på det workeren faktisk skal bruge.

## Determinisme (byte-for-byte reproducerbarhed)

Alt der stammer fra et Python `set` (corpus_vocab, domain_vocab,
GENERIC_PUNCHLINE_EXEMPTIONS) sorteres eksplicit før serialisering — et
`set`'s iterationsrækkefølge afhænger af PYTHONHASHSEED og er IKKE garanteret
identisk på tværs af proces-kørsler uden det. Alt der stammer fra en JSON-
liste (forbiddenConstructions, modernVocabulary, tense-markører, punchlines —
punchlines er allerede `sorted()` af `punchline_set()` selv) bevarer sin
oprindelige, allerede-deterministiske rækkefølge uændret. `hash`-feltet
udledes af en `sort_keys=True`-kanonikalisering af HELE payloaden (minus sig
selv), så det er uafhængigt af selve nøgle-indsættelsesrækkefølgen i dette
script. Ingen tidsstempler, ingen git-SHA i outputtet — artefaktet er en ren
funktion af sit kildeindhold (lexicon.json, korpus, elements.json,
pairs_baseline.json), så to kørsler på samme kildetræ giver byte-identisk
output, uanset hvornår eller hvor ofte det køres.

## `version` vs. `hash`

`version` er et menneske-bumpet SKEMA-tal (kun hvis dette scripts JSON-FORM
ændres — nye felter, omdøbte nøgler). `hash` er den auto-udledte
INDHOLDS-fingeraftryk (ændrer sig så snart korpus, lexicon eller kalibrering
ændrer sig). Cache-navnerummet (coordinator-do.ts) folder `hash` ind, ikke
`version` alene — det er `hash` der garanterer at en ændring i stemmepolitikken
automatisk ugyldiggør gamle cache-linjer, uden at noget menneske skal huske at
bumpe noget manuelt (samme filosofi som PROMPT_VERSION_INPUT, se
model.ts/cache-key.ts).

Kør:  python3 tools/voice/export_worker_profile.py
      python3 tools/voice/export_worker_profile.py --check   # fejl uden at skrive, til CI/validate
      python3 tools/voice/export_worker_profile.py --json    # udskriv hele profilen
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import build_fingerprint  # noqa: E402
from judge import (  # noqa: E402
    GENERIC_PUNCHLINE_EXEMPTIONS,
    HARD_MAX_SENTENCES,
    HARD_MAX_WORDS,
    LEXICON,
    calibrated_threshold,
    domain_vocabulary,
    pairs_wordcount_band,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "worker" / "src" / "generated" / "voice-profile.json"

# De 11 nøgler _dist_summary() (metrics.py) altid producerer, og de eneste
# range_score()/novelty_score()/_spread() (judge.py) læser.
DIST_KEYS = ("mean", "median", "stdev", "min", "max", "p10", "p25", "p50", "p75", "p90", "p95")
PUNCT_CHANNELS = ("period", "exclaim", "question", "emdash", "comma", "colonSemicolon", "ellipsis")


def _dist(d: dict[str, Any]) -> dict[str, float]:
    return {k: float(d[k]) for k in DIST_KEYS}


def build_profile() -> dict[str, Any]:
    fingerprint = build_fingerprint()
    corpus_vocab = sorted(set(fingerprint["vocabulary"]["frequency"]))
    dom_vocab = sorted(domain_vocabulary())
    threshold = calibrated_threshold(fingerprint, "p5")

    payload: dict[str, Any] = {
        "_kommentar": (
            "Genereret af tools/voice/export_worker_profile.py — se dens docstring. "
            "Regenerer med: python3 tools/voice/export_worker_profile.py. "
            "Redigér ALDRIG denne fil i hånden; den skrider fra sin kilde med det samme."
        ),
        "version": 1,
        "hash": "",
        "hardMaxSentences": HARD_MAX_SENTENCES,
        "hardMaxWords": HARD_MAX_WORDS,
        "threshold": {"percentile": "p5", "value": threshold},
        "distributions": {
            "wordLengthPerLineMean": _dist(fingerprint["wordLength"]["perLineMean"]),
            "sentencesPerLine": _dist(fingerprint["sentencesPerLine"]),
            "wordsPerLine": _dist(fingerprint["wordsPerLine"]),
            "presentTensePerLineShare": _dist(fingerprint["presentTense"]["perLineShare"]),
            "punctuationPer100Words": {
                ch: _dist(fingerprint["punctuation"]["per100Words"][ch]) for ch in PUNCT_CHANNELS
            },
            "vocabularyLeaveOneOutNovelty": _dist(fingerprint["vocabulary"]["leaveOneOutNovelty"]),
        },
        "pairsWordCountBand": _dist(pairs_wordcount_band()),
        "lexicon": {
            "forbiddenConstructions": LEXICON["forbiddenConstructions"],
            "modernVocabulary": LEXICON["modernVocabulary"],
            "genericPunchlineExemptions": sorted(GENERIC_PUNCHLINE_EXEMPTIONS),
            "presentTenseMarkers": LEXICON["presentTenseMarkers"],
            "pastTenseMarkers": LEXICON["pastTenseMarkers"],
        },
        "corpusVocabulary": corpus_vocab,
        "domainVocabulary": dom_vocab,
        "punchlines": fingerprint["punchlines"],
    }

    canonical = json.dumps(
        {k: v for k, v in payload.items() if k != "hash"},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    )
    payload["hash"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return payload


def render(profile: dict[str, Any]) -> str:
    return json.dumps(profile, ensure_ascii=False, indent=2) + "\n"


def check_profile_current() -> list[str]:
    """Importerbart kerneindgangspunkt (samme mønster som
    check_grammar_assembly.check_grammar_assembly()) — judge.py's gate()
    kalder denne direkte, så en forældet worker/src/generated/voice-profile.json
    fanges af `npm run validate`, ikke først når nogen kører TS-paritetstesten.
    Returnerer en liste af menneskelæsbare problemer — tom liste = opdateret."""
    rendered = render(build_profile())
    current = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if current != rendered:
        return [
            f"{OUT.relative_to(ROOT)} matcher IKKE en frisk eksport fra korpus/lexicon/kalibrering — "
            "kør 'python3 tools/voice/export_worker_profile.py' for at regenerere."
        ]
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fejl hvis filen ikke matcher, uden at skrive")
    ap.add_argument("--json", action="store_true", help="udskriv hele profilen")
    args = ap.parse_args()

    if args.check:
        problems = check_profile_current()
        for p in problems:
            print(f"FEJL: {p}", file=sys.stderr)
        if problems:
            return 1
        print(f"OK: {OUT.relative_to(ROOT)} er opdateret.")
        return 0

    profile = build_profile()
    rendered = render(profile)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(rendered, encoding="utf-8")

    if args.json:
        print(rendered)
    else:
        print(f"Skrev {OUT.relative_to(ROOT)} (hash {profile['hash']}, threshold {profile['threshold']['value']}).")
        print(
            f"corpusVocabulary: {len(profile['corpusVocabulary'])}  "
            f"domainVocabulary: {len(profile['domainVocabulary'])}  "
            f"punchlines: {len(profile['punchlines'])}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
