"""Regressionstest: TASK-035-prøvelsens omlægning af `build_elements.py` til
at genbruge `sheet_ingest.py` må IKKE ændre en eneste byte af de 13 filer,
arket producerer, og må ikke ændre de øvrige 11, `build_element_art.py`
efterfølgende forfiner. Se `sheet_ingest.py`'s docstring for hvorfor
udskæringen blev delt ud i en fælles fil.

Kører den RIGTIGE pipeline (`build_elements.py` → `build_element_art.py`,
samme rækkefølge som `build_all.py`) og sammenligner med `git`, i stedet for
at gætte på forventede hashes — hvis nogen bevidst ændrer referencen eller
algoritmen, skal testen opdage det ved at vise en git-diff, ikke ved en
hardcodet liste af tal der skal vedligeholdes ved siden af.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ART_DIR = ROOT / "tools/art"
ELEMENTS_DIR = ROOT / "src/assets/art/elements"

# De 13 grundelementer der findes i dag (11 fra elements-sheet.png + refinement,
# 2 — korn/okse — kun fra elements-sheet.png, se build_element_art.py's docstring).
BASE_IDS = [
    "sten", "pind", "graes", "vand", "ler", "baer", "larver",
    "dyr", "stamme", "nabo", "fugl", "korn", "okse",
]


def _run(script: str) -> None:
    result = subprocess.run(
        [sys.executable, str(ART_DIR / script)], cwd=ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, f"{script} fejlede:\n{result.stdout}\n{result.stderr}"


def test_full_pipeline_er_byte_identisk_med_det_committede() -> None:
    before = {p.name: p.read_bytes() for p in ELEMENTS_DIR.glob("*.webp")}
    assert set(before) == {f"{name}.webp" for name in BASE_IDS}, (
        "forventede præcis de 13 kendte filer før kørslen — nye/manglende filer "
        "skal undersøges, ikke overskrives stiltiende af testen."
    )

    try:
        _run("build_elements.py")
        _run("build_element_art.py")

        after = {p.name: p.read_bytes() for p in ELEMENTS_DIR.glob("*.webp")}
        assert set(after) == set(before), "pipelinen skabte eller fjernede filer"
        for name, original_bytes in before.items():
            assert after[name] == original_bytes, (
                f"{name}: pipelinen gav et andet resultat end det committede — "
                "det er PRÆCIS den regression denne test findes for at fange."
            )
    finally:
        # Uanset udfald: lad ikke arbejdstræet stå beskidt efter en testkørsel.
        subprocess.run(["git", "checkout", "--", str(ELEMENTS_DIR)], cwd=ROOT, check=True)


def test_build_elements_er_idempotent_alene() -> None:
    """`build_elements.py` alene, kørt to gange, skal give byte-identisk output —
    samme disciplin som TASK-034 allerede kræver af hele `npm run art`."""
    try:
        _run("build_elements.py")
        first = {p.name: p.read_bytes() for p in ELEMENTS_DIR.glob("*.webp")}
        _run("build_elements.py")
        second = {p.name: p.read_bytes() for p in ELEMENTS_DIR.glob("*.webp")}
        assert first == second
    finally:
        subprocess.run(["git", "checkout", "--", str(ELEMENTS_DIR)], cwd=ROOT, check=True)
