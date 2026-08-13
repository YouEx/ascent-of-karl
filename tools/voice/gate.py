#!/usr/bin/env python3
"""Stemme-porten — TASK-030.

Selvstændigt kørbart script omkring judge.py's gate(). Samme funktion kaldes
direkte af tools/validate.py, så CLI'en og den obligatoriske content-port
dømmer nøjagtig samme kandidater.

Dømmer al statisk kandidattekst i repoet — grammatikkens ekspanderede
linjer, improvisationsdommene og de bagte par, BÅDE mod stemme-fingeraftrykket
OG mod par-kontrakten
(check_pairs.py, importeret og kørt her, ikke bare antaget kørt separat af et
menneske), OG at begge facit-filer (grammar-act-1.json, pairs-act-1.json)
rent faktisk er reproducerbare fra deres egne drafts (check_grammar_assembly.py
/ check_pairs_assembly.py — se gate()'s docstring for hvorfor). Udskriver hver
afvisning menneskelæsbart og afslutter med exit 1 hvis der er mindst én. Tom
output og exit 0 = alt kandidatindhold lyder som fortælleren, overholder
par-kontrakten, OG begge facit-filer matcher deres drafts.

    python3 tools/voice/gate.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge as J  # noqa: E402


def main() -> int:
    failures = J.gate()
    if not failures:
        print(
            "✅ stemmedommer: alt kandidatindhold "
            "(grammatik + improvisation + bagte par + par-kontrakt) består."
        )
        return 0

    for f in failures:
        print(f"❌ {f}")
    print(f"\n{len(failures)} kandidat-replikker dømt ude af stemmedommeren.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
