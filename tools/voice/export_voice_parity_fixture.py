#!/usr/bin/env python3
"""Genererer paritetsfacit mellem Python-stemmedommeren og dens TS-port —
TASK-007 (plan/feature-live-narrator-1.md, fase 3).

Samme filosofi som tools/parity_fixture.py (solves.ts vs. predicate_report.py):
to implementeringer af samme regel skrider fra hinanden før eller siden, og
skreddet er tavst hvis ingen test sammenligner dem tal for tal. Python
(judge.py/metrics.py) er facit. Denne fixture er aftrykket.
tests/worker-voice-parity.test.ts sammenligner TS-portens output med det.

## Dækning (opgavens krav, ordret)

- Alle 866 håndskrevne varianter — `source="grammar"` mod deres EGET
  fingeraftryk, præcis som `calibrated_threshold()` selv scorer dem (se dens
  docstring: tærsklen ER p5 af denne præcise mængde scoret sådan).
- Alle 312 grammatik-varianter — `source="grammar"`, samme som `gate()` bruger.
- Alle 908 bagte par-varianter — `source="pairs"`, samme som `gate()` bruger.
- Syntetiske hård-afvisnings-cases: én pr. `hard_reject()`-kategori
  (sætningstal, ordtal, fejlmeddelelse-register, moderne ordforråd, genbrugt
  punchline), plus en kombineret to-grunde-case, plus to `source="pairs"`
  cases der beviser at ordtal/sætningslofterne er SLÅET FRA for par (men
  fejlmeddelelse-register/moderne ordforråd/punchline stadig gælder) — se
  hard_reject()'s `if source != "pairs":`-vagt.
- Repræsentative "live"-linjer: hverken håndskrevne, grammatik- eller
  par-tekst, men den slags en fremtidig live-model kunne generere, scoret
  `source="grammar"` (TASK-007: "Live text gets source=grammar semantics").
  Inkluderer tomme/enkeltords-kant-cases.

Ingen af de syntetiske cases er hånd-udregnet eller gættet på — hver
antagelse (ordtal > 32, sætningstal > 3, valgt punchline er en ægte,
ikke-undtaget korpus-punchline) verificeres i selve scriptet med `assert`
FØR den lægges i fixturen. Er antagelsen forkert (fx fordi lexicon.json eller
korpus har ændret sig), stopper scriptet med en AssertionError i stedet for
stille at skrive en misvisende fixture-linje.

Kør:  python3 tools/voice/export_voice_parity_fixture.py
      python3 tools/voice/export_voice_parity_fixture.py --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import build_fingerprint, split_sentences, tokenize_words  # noqa: E402
from judge import (  # noqa: E402
    GENERIC_PUNCHLINE_EXEMPTIONS,
    domain_vocabulary,
    expand_grammar,
    expand_pairs,
    handwritten_variants,
    judge,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "voice-parity-fixture.json"
FIXTURE_DECIMALS = 12


def _entry(id_: str, text: str, *, source: str, fingerprint: dict[str, Any]) -> dict[str, Any]:
    result = judge(text, fingerprint, source=source)
    return {
        "id": id_,
        "source": source,
        "text": result["text"],
        "hardRejects": result["hardRejects"],
        # Python-versioner kan repræsentere den samme IEEE-754-beregning med
        # forskel i sidste bit (fx ...5313 vs. ...5314). Fixturen sammenlignes
        # byte-for-byte i validate.py, mens TS-pariteten kun kræver 1e-4.
        # Tolv decimaler bevarer derfor langt mere præcision end testen bruger
        # og gør samtidig eksporten kanonisk på tværs af Python 3.9/3.12.
        "dimensions": {
            name: round(value, FIXTURE_DECIMALS)
            for name, value in result["dimensions"].items()
        },
        "overall": result["overall"],
        "presentShareDecidable": result["presentShareDecidable"],
    }


def _synthetic_cases(fingerprint: dict[str, Any]) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    # 1) For mange sætninger (grammar).
    text = "Sparks fly. Karl gasps. I gasp. The boar leaps away fast."
    assert len(split_sentences(text)) > 3, "case skal reelt overskride sætningsloftet"
    cases.append(("synthetic:sentences-too-many", text, "grammar"))

    # 2) For mange ord (grammar) — bygget af neutrale, ikke-forbudte/moderne ord,
    # og en slutning der ikke matcher noget korpus-punchline.
    filler_words = (
        "stone stick water fire bone branch claw ash river dust smoke leaf "
        "root vine wing tusk shell scale flame ember"
    ).split()
    text = "The " + " and the ".join(filler_words) + " all shift quietly tonight."
    n_words = len(tokenize_words(text))
    assert n_words > 32, f"case skal reelt overskride ordloftet, fik {n_words}"
    assert len(split_sentences(text)) <= 3, "case må ikke også ramme sætningsloftet"
    cases.append(("synthetic:words-too-many", text, "grammar"))

    # 3) Fejlmeddelelse-register (grammar).
    text = "Invalid input received again. Karl frowns hard."
    cases.append(("synthetic:forbidden-construction", text, "grammar"))

    # 4) Moderne ordforråd (grammar).
    text = "Karl checks his phone twice. Nothing happens next."
    cases.append(("synthetic:modern-vocabulary", text, "grammar"))

    # 5) Genbrugt punchline (grammar) — en ægte, IKKE-undtaget korpus-punchline
    # sat som sidste sætning af en helt ny indledning.
    candidates = sorted(
        p for p in fingerprint["punchlines"]
        if p not in GENERIC_PUNCHLINE_EXEMPTIONS and 0 < len(p.split()) <= 4
    )
    assert candidates, "korpus skal have mindst én kort, ikke-undtaget punchline"
    reused = candidates[0]
    text = f"Karl tilts his head at the pile. {reused.capitalize()}."
    from metrics import normalize_punchline  # noqa: E402 — kun til selv-verifikation her
    assert normalize_punchline(text.split(". ")[-1]) == reused, "genbrug matchede ikke den valgte punchline"
    cases.append(("synthetic:reused-punchline", text, "grammar"))

    # 6) Kombineret: for mange ord OG moderne ordforråd i samme linje.
    text = (
        "The internet and the stone and the stick and the water and the fire "
        "and the bone and the branch and the claw and the ash all argue quietly "
        "and slowly at once tonight."
    )
    n_words = len(tokenize_words(text))
    assert n_words > 32, f"case skal reelt overskride ordloftet, fik {n_words}"
    cases.append(("synthetic:combined-words-and-modern", text, "grammar"))

    # 7) Par-kilde: samme lange tekst som (2), men source="pairs" — beviser at
    # ordtal-/sætningslofterne er slået FRA for par (hard_reject's eneste
    # kildespecifikke gren).
    long_pairs_text = "The stone and the stick and the water and the fire and the bone and the branch and the claw and the ash and the river all sit here quietly tonight without moving at all."
    assert len(tokenize_words(long_pairs_text)) > 32
    cases.append(("synthetic:pairs-long-allowed", long_pairs_text, "pairs"))

    # 8) Par-kilde: fejlmeddelelse-register gælder STADIG for par.
    cases.append(("synthetic:pairs-forbidden-still-applies", "Access denied. The stone waits.", "pairs"))

    # 9) Ren, kort, nutids-agtig linje — ingen kendt overtrædelse (facit er
    # hvad judge() rent faktisk siger, ikke en antagelse om bestået).
    cases.append(("synthetic:clean-present-tense", "Karl grins wide. Sparks fly across the yard.", "grammar"))

    # 10) Ren, kort, datids-agtig linje.
    cases.append(("synthetic:clean-past-tense", "Karl smiled once. The boar wandered off slowly.", "grammar"))

    # 11) Grænsetilfælde: præcis ved sætningsloftet (3), moderat ordtal.
    cases.append((
        "synthetic:borderline-three-sentences",
        "Karl waits. The fire catches. Nothing else moves here tonight.",
        "grammar",
    ))

    # 12) Tom streng — kant-case, må ikke crashe nogen af siderne.
    cases.append(("synthetic:empty-string", "", "grammar"))

    # 13) Ét ord, intet udsagnsord — ubestemmelig tid (som "Bronze!" i korpus selv).
    cases.append(("synthetic:single-word-exclaim", "Bronze!", "grammar"))

    # 14) Tegnsætningstung linje (kolon + tankestreg + ellipse) — grænsetilfælde
    # for tegnsætnings-dimensionen.
    cases.append((
        "synthetic:punctuation-heavy",
        "Karl pauses—waits—then: nothing. Nothing at all... just silence, and more silence.",
        "grammar",
    ))

    # 15) Spørgsmålstung linje.
    cases.append((
        "synthetic:question-heavy",
        "What was that? Did it move? Karl is not sure anymore.",
        "grammar",
    ))

    return [_entry(id_, text, source=source, fingerprint=fingerprint) for id_, text, source in cases]


def build_fixture() -> dict[str, Any]:
    fingerprint = build_fingerprint()

    handwritten = [
        _entry(f"handwritten:{label}", text, source="grammar", fingerprint=fingerprint)
        for label, text in handwritten_variants(fingerprint)
    ]
    grammar = [
        _entry(f"grammar:{label}", text, source="grammar", fingerprint=fingerprint)
        for label, text in expand_grammar()
    ]
    pairs = [
        _entry(f"pairs:{label}", text, source="pairs", fingerprint=fingerprint)
        for label, text in expand_pairs()
    ]
    synthetic = _synthetic_cases(fingerprint)

    return {
        "_kommentar": (
            "Genereret af tools/voice/export_voice_parity_fixture.py — facit for "
            "tests/worker-voice-parity.test.ts. Python (judge.py/metrics.py) er "
            "sandheden; TS-porten (worker/src/voice/*.ts) skal matche hardRejects "
            "præcist og overall inden for en dokumenteret tolerance. Regenerer med: "
            "python3 tools/voice/export_voice_parity_fixture.py"
        ),
        "counts": {
            "handwritten": len(handwritten),
            "grammar": len(grammar),
            "pairs": len(pairs),
            "synthetic": len(synthetic),
        },
        "cases": [*handwritten, *grammar, *pairs, *synthetic],
    }


def render(fixture: dict[str, Any]) -> str:
    return json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"


def check_fixture_current() -> list[str]:
    """Importerbart kerneindgangspunkt (samme mønster som
    check_grammar_assembly.check_grammar_assembly() og
    export_worker_profile.check_profile_current()) — judge.py's gate() kalder
    denne direkte, så en forældet tests/fixtures/voice-parity-fixture.json
    fanges af `npm run validate`. Returnerer en liste af menneskelæsbare
    problemer — tom liste = opdateret."""
    rendered = render(build_fixture())
    current = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if current != rendered:
        return [
            f"{OUT.relative_to(ROOT)} matcher IKKE en frisk eksport fra korpus/grammatik/par — "
            "kør 'python3 tools/voice/export_voice_parity_fixture.py' for at regenerere."
        ]
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fejl hvis filen ikke matcher, uden at skrive")
    args = ap.parse_args()

    if args.check:
        problems = check_fixture_current()
        for p in problems:
            print(f"FEJL: {p}", file=sys.stderr)
        if problems:
            return 1
        print(f"OK: {OUT.relative_to(ROOT)} er opdateret.")
        return 0

    fixture = build_fixture()
    rendered = render(fixture)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(rendered, encoding="utf-8")
    c = fixture["counts"]
    print(
        f"Skrev {OUT.relative_to(ROOT)}: {c['handwritten']} håndskrevne + "
        f"{c['grammar']} grammatik + {c['pairs']} par + {c['synthetic']} syntetiske "
        f"= {len(fixture['cases'])} cases."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
