#!/usr/bin/env python3
"""Stemme-porten — TASK-030.

Selvstændigt kørbart script omkring judge.py's gate(). Findes som egen fil
fordi tools/validate.py ejes af en anden agent lige nu og ikke må røres her
(se docs/design/narration-voice.md, "Wiring into validate", for den
fem-linjers snippet der kobler judge.gate() ind i validate.py, når den
anden agents arbejde er flettet).

Dømmer al statisk kandidattekst i repoet — grammatikkens ekspanderede
linjer og de bagte par — mod det håndskrevne korpus' fingeraftryk. Udskriver
hver afvisning menneskelæsbart og afslutter med exit 1 hvis der er mindst
én. Tom output og exit 0 = alt kandidatindhold lyder som fortælleren.

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
        print("✅ stemmedommer: alt kandidatindhold (grammatik + bagte par) består.")
        return 0

    for f in failures:
        print(f"❌ {f}")
    print(f"\n{len(failures)} kandidat-replikker dømt ude af stemmedommeren.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
