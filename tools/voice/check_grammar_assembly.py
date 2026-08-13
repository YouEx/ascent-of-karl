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

`check_grammar_assembly(real_out=...)` er det importerbare kerneindgangspunkt
(kodegennemgang 2026-08-13) — judge.py's gate() kalder den direkte som ÉN af
de kontroller den fulde stemmeport består af, i stedet for at stole på at et
menneske selv husker at køre denne fil separat. `real_out` kan pege på en
anden sti end det rigtige indhold — bruges af judge.py's selftest() til at
BEVISE at kontrollen fanger afvigelser, ved at pege den på en bevidst
afdrevet kopi, uden nogensinde at røre content/narrator/grammar-act-1.json.

Brug:
    python3 tools/voice/check_grammar_assembly.py

Afslutter 0 hvis content/narrator/grammar-act-1.json er reproducerbart fra
drafts, 1 ellers (inklusiv hvis assemble_grammar.py selv finder problemer).
"""
from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import assemble_grammar  # noqa: E402 — ligger i tools/, ikke tools/voice/

REAL_OUT = ROOT / "content" / "narrator" / "grammar-act-1.json"
SCRATCH_DIR = Path(__file__).resolve().parent / ".tmp"
SCRATCH_OUT = SCRATCH_DIR / "grammar-act-1.assembled-check.json"


def check_grammar_assembly(*, real_out: Path | None = None) -> list[str]:
    """Kører den ægte samler mod en midlertidig sti og sammenligner byte for
    byte med `real_out` (standard: det rigtige content/narrator/grammar-act-1.json).
    Returnerer en liste af menneskelæsbare problemer — tom liste = reproducerbart.

    `real_out` findes udelukkende så judge.py's selftest() kan pege kontrollen
    på en bevidst afdrevet, midlertidig kopi og bevise at den rent faktisk
    fanger afvigelser (aldrig kaldt med andet end standardværdien fra gate()
    selv eller denne fils egen main())."""
    target = real_out if real_out is not None else REAL_OUT
    problems: list[str] = []

    SCRATCH_DIR.mkdir(exist_ok=True)
    try:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = assemble_grammar.main(["--out", str(SCRATCH_OUT)])
        if rc != 0:
            problems.append(
                "assemble_grammar.py meldte selv problemer ved en tør kørsel "
                f"(facittet er IKKE rørt):\n{buf.getvalue().rstrip()}"
            )
            return problems

        assembled = SCRATCH_OUT.read_text(encoding="utf-8")
        real = target.read_text(encoding="utf-8")
    finally:
        SCRATCH_OUT.unlink(missing_ok=True)
        try:
            SCRATCH_DIR.rmdir()
        except OSError:
            pass  # ikke tom (fx en samtidig kørsel, eller selftest's afdrevne kopi) — lad den stå

    if assembled != real:
        problems.append(
            f"{target} matcher IKKE en frisk samling af sine egne drafts — "
            "ret content/narrator/drafts/grammar-*.json, ikke facittet; "
            "facittet SKAL være det drafts udtrykker, aldrig omvendt."
        )
    return problems


def main() -> int:
    problems = check_grammar_assembly()
    if not problems:
        print(f"✅ {REAL_OUT.relative_to(ROOT)} er reproducerbart fra drafts, byte for byte.")
        return 0
    for p in problems:
        print(f"✗ {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
