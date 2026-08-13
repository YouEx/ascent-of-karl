"""Regressionstest: TASK-035-prøvelsens omlægning af `build_elements.py` til
at genbruge `sheet_ingest.py` må IKKE ændre en eneste byte af de 13 filer,
arket producerer, og må ikke ændre de øvrige 11, `build_element_art.py`
efterfølgende forfiner. Se `sheet_ingest.py`'s docstring for hvorfor
udskæringen blev delt ud i en fælles fil.

Kører den RIGTIGE pipeline (`build_elements.py` → `build_element_art.py`,
samme rækkefølge som `build_all.py`) i en midlertidig outputmappe og
sammenligner med de bytes, der lå i arbejdstræet ved testens start.
Arbejdstræet er kun læsekilde: testen må aldrig bruge `git checkout` som
oprydning eller risikere at slette en illustrators lokale ændringer.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
ELEMENTS_DIR = ROOT / "src/assets/art/elements"

sys.path.insert(0, str(ROOT / "tools/art"))
import build_element_art  # noqa: E402
import build_elements  # noqa: E402

# De 13 grundelementer der findes i dag (11 fra elements-sheet.png + refinement,
# 2 — korn/okse — kun fra elements-sheet.png, se build_element_art.py's docstring).
BASE_IDS = [
    "sten", "pind", "graes", "vand", "ler", "baer", "larver",
    "dyr", "stamme", "nabo", "fugl", "korn", "okse",
]


def _working_tree_bytes() -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in ELEMENTS_DIR.glob("*.webp")}


def _run_build_elements(
    monkeypatch: pytest.MonkeyPatch,
    out_dir: Path,
    source: Path = build_elements.SHEET,
) -> None:
    monkeypatch.setattr(build_elements, "OUT_DIR", out_dir)
    monkeypatch.setattr(sys, "argv", ["build_elements.py", str(source)])
    build_elements.main()


def _run_full_pipeline(monkeypatch: pytest.MonkeyPatch, out_dir: Path) -> None:
    _run_build_elements(monkeypatch, out_dir)
    monkeypatch.setattr(build_element_art, "OUT", out_dir)
    build_element_art.main()


def test_full_pipeline_er_byte_identisk_uden_at_roere_arbejdstraeet(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _working_tree_bytes()
    assert set(before) == {f"{name}.webp" for name in BASE_IDS}, (
        "forventede præcis de 13 kendte filer før kørslen — nye/manglende filer "
        "skal undersøges, ikke overskrives stiltiende."
    )

    out_dir = tmp_path / "generated"
    out_dir.mkdir()
    _run_full_pipeline(monkeypatch, out_dir)

    generated = {p.name: p.read_bytes() for p in out_dir.glob("*.webp")}
    assert set(generated) == set(before), "pipelinen skabte eller manglede filer"
    for name, original_bytes in before.items():
        assert generated[name] == original_bytes, (
            f"{name}: pipelinen gav et andet resultat end arbejdstræets startbytes."
        )
    assert _working_tree_bytes() == before


def test_build_elements_er_idempotent_alene(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`build_elements.py` alene, kørt to gange, skal give byte-identisk output —
    samme disciplin som TASK-034 allerede kræver af hele `npm run art`."""
    out_dir = tmp_path / "generated"
    out_dir.mkdir()
    _run_build_elements(monkeypatch, out_dir)
    first = {p.name: p.read_bytes() for p in out_dir.glob("*.webp")}
    _run_build_elements(monkeypatch, out_dir)
    second = {p.name: p.read_bytes() for p in out_dir.glob("*.webp")}
    assert first == second


def test_fejlsti_bevarer_arbejdstraeets_forhaandsbytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _working_tree_bytes()
    with pytest.raises(SystemExit, match="mangler"):
        _run_build_elements(monkeypatch, tmp_path / "generated", tmp_path / "mangler.png")
    assert _working_tree_bytes() == before
