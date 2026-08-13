#!/usr/bin/env python3
"""Beviser at content/narrator/pairs-act-1.json er reproducerbart fra sine
drafts — samme princip som check_grammar_assembly.py, for bagte par
(kodegennemgang 2026-08-13, sidste blokkerende punkt før merge).

En kalibrering der måler bagte par er værdiløs hvis facittet den måler kan
glide ude af trit med de drafts (content/narrator/drafts/pairs-*.json) det
angiveligt er udledt af — præcis den fejl grammatik-kontrollen fandt og
rettede. Denne kontrol kører den ægte samler (tools/assemble_pairs.py) mod en
midlertidig sti (`--out`) — ALDRIG mod det rigtige indhold — og sammenligner
byte for byte med det indtjekkede facit.

`check_pairs_assembly(real_out=...)` er det importerbare kerneindgangspunkt —
judge.py's gate() kalder den direkte som ÉN af de kontroller den fulde
stemmeport består af. `real_out` kan pege på en anden sti end det rigtige
indhold — bruges af judge.py's selftest() til at BEVISE at kontrollen fanger
afvigelser, ved at pege den på en bevidst afdrevet kopi, uden nogensinde at
røre content/narrator/pairs-act-1.json.

Bemærk: assemble_pairs.py kører selv check_pairs.py på hver batch i
`assemble_pairs.BATCHES` undervejs (samme kontrol som gate() ELLERS komponerer direkte
via check_pairs.check_pairs_file() — se judge.py's gate()-docstring). Fejler
en batch sin egen check_pairs.py, fejler samlingen først, og DEN fejl
rapporteres her; det er ikke en dublet af par-kontrakt-kontrollen, det er
samlingens egen forudsætning for overhovedet at kunne sammenligne noget.

Brug:
    python3 tools/voice/check_pairs_assembly.py

Afslutter 0 hvis content/narrator/pairs-act-1.json er reproducerbart fra
drafts, 1 ellers (inklusiv hvis assemble_pairs.py selv finder problemer).
"""
from __future__ import annotations

import contextlib
import io
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import assemble_pairs  # noqa: E402 — ligger i tools/, ikke tools/voice/

REAL_OUT = ROOT / "content" / "narrator" / "pairs-act-1.json"
SCRATCH_DIR = Path(__file__).resolve().parent / ".tmp"
SCRATCH_OUT = SCRATCH_DIR / "pairs-act-1.assembled-check.json"


def check_pairs_assembly(*, real_out: Path | None = None) -> list[str]:
    """Kører den ægte samler mod en midlertidig sti og sammenligner byte for
    byte med `real_out` (standard: det rigtige content/narrator/pairs-act-1.json).
    Returnerer en liste af menneskelæsbare problemer — tom liste = reproducerbart.

    `real_out` findes udelukkende så judge.py's selftest() kan pege kontrollen
    på en bevidst afdrevet, midlertidig kopi og bevise at den rent faktisk
    fanger afvigelser (aldrig kaldt med andet end standardværdien fra gate()
    selv eller denne fils egen main())."""
    target = real_out if real_out is not None else REAL_OUT
    problems: list[str] = []

    with tempfile.TemporaryDirectory(prefix="karl-pairs-assembly-") as tmp:
        scratch_out = Path(tmp) / SCRATCH_OUT.name
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = assemble_pairs.main(["--out", str(scratch_out)])
        if rc != 0:
            problems.append(
                "assemble_pairs.py meldte selv problemer ved en tør kørsel "
                f"(facittet er IKKE rørt):\n{buf.getvalue().rstrip()}"
            )
            return problems

        assembled = scratch_out.read_text(encoding="utf-8")
        real = target.read_text(encoding="utf-8")

    if assembled != real:
        problems.append(
            f"{target} matcher IKKE en frisk samling af sine egne drafts — "
            "ret content/narrator/drafts/pairs-*.json, ikke facittet; "
            "facittet SKAL være det drafts udtrykker, aldrig omvendt."
        )
    return problems


def main() -> int:
    problems = check_pairs_assembly()
    if not problems:
        print(f"✅ {REAL_OUT.relative_to(ROOT)} er reproducerbart fra drafts, byte for byte.")
        return 0
    for p in problems:
        print(f"✗ {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
