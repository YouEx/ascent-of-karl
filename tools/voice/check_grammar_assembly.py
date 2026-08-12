#!/usr/bin/env python3
"""Beviser at content/narrator/grammar-act-1.json er reproducerbart fra sine
drafts — TASK-030 opfølgning, 2026-08-13.

En kalibrering der måler grammatikken er værdiløs hvis facittet den måler
kan glide ude af trit med de drafts der angiveligt er dens kilde. Præcis det
skete: da hovedgrenen tilføjede g-plaus-9 og denne agent rettede 16 andre
regler, blev begge dele skrevet direkte i content/narrator/grammar-act-1.json
uden nogensinde at nå tilbage til content/narrator/drafts/grammar-*.json.
tools/assemble_grammar.py ville have overskrevet facittet med en FORÆLDET
udgave, hvis nogen havde kørt det.

Denne kontrol kører den ægte samler mod en midlertidig sti (`--out`, se
tools/assemble_grammar.py) — ALDRIG mod det rigtige indhold — og sammenligner
byte for byte med det indtjekkede facit. Ingen destruktiv kørsel, ingen
overraskelse: enten matcher drafts facittet, eller også fejler denne kontrol
og siger præcis hvorfor, uden at røre en eneste rigtig fil.

Brug:
    python3 tools/voice/check_grammar_assembly.py

Afslutter 0 hvis content/narrator/grammar-act-1.json er reproducerbart fra
drafts, 1 ellers (inklusiv hvis assemble_grammar.py selv finder problemer).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
REAL_OUT = ROOT / "content" / "narrator" / "grammar-act-1.json"
SCRATCH_DIR = Path(__file__).resolve().parent / ".tmp"
SCRATCH_OUT = SCRATCH_DIR / "grammar-act-1.assembled-check.json"


def main() -> int:
    sys.path.insert(0, str(ROOT / "tools"))
    import assemble_grammar  # noqa: E402 — ligger i tools/, ikke tools/voice/

    SCRATCH_DIR.mkdir(exist_ok=True)
    try:
        rc = assemble_grammar.main(["--out", str(SCRATCH_OUT)])
        if rc != 0:
            print("✗ assemble_grammar.py meldte selv problemer — se output ovenfor.")
            print("  Facittet er IKKE rørt (kørslen skrev kun til en midlertidig sti).")
            return 1

        assembled = SCRATCH_OUT.read_text(encoding="utf-8")
        real = REAL_OUT.read_text(encoding="utf-8")
    finally:
        SCRATCH_OUT.unlink(missing_ok=True)
        try:
            SCRATCH_DIR.rmdir()
        except OSError:
            pass  # ikke tom (fx en samtidig kørsel) — lad den stå, intet er utæt

    if assembled == real:
        print(f"✅ {REAL_OUT.relative_to(ROOT)} er reproducerbart fra drafts, byte for byte.")
        return 0

    print(f"✗ {REAL_OUT.relative_to(ROOT)} matcher IKKE en frisk samling af sine egne drafts.")
    print("  Ret drafts under content/narrator/drafts/grammar-*.json, ikke facittet —")
    print("  facittet SKAL være det drafts udtrykker, aldrig omvendt.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
