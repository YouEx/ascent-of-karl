"""Målkontrakt for den fail-closed klassiske titelmaster-pipeline."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / "tools/art/title-scene-masters.config.json"
SCRIPT = ROOT / "tools/art/build_title_scene_masters.py"
PORTRAIT = ROOT / "docs/design/reference/title-scene-portrait-860x1864.png"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_builder(tmp_path: Path, name: str) -> tuple[Path, Path, dict]:
    output = tmp_path / name / "output"
    evidence = tmp_path / name / "evidence"
    manifest = tmp_path / name / "manifest.json"
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--output-dir",
            str(output),
            "--evidence-dir",
            str(evidence),
            "--manifest",
            str(manifest),
        ],
        cwd=ROOT,
        check=True,
    )
    return output, evidence, json.loads(manifest.read_text())


def test_config_pinner_kilder_dimensioner_og_fail_closed_bredmaster() -> None:
    config = json.loads(CONFIG.read_text())
    assert config["algorithm"] == "title-scene-masters-classical-v1"
    assert config["sources"]["canonicalTitle"]["sha256"] == sha256(
        ROOT / config["sources"]["canonicalTitle"]["path"]
    )
    assert config["sources"]["approvedLandscape"]["sha256"] == sha256(
        ROOT / config["sources"]["approvedLandscape"]["path"]
    )
    assert config["wide"]["width"] == 2560
    assert config["wide"]["height"] == 1440
    assert config["wide"]["promotion"]["approved"] is False
    assert config["portrait"]["width"] == 860
    assert config["portrait"]["height"] == 1864
    assert config["portrait"]["promotion"]["approved"] is True


def test_build_er_byteidentisk_lossless_og_har_kompakt_evidens(
    tmp_path: Path,
) -> None:
    first, first_evidence, first_manifest = run_builder(tmp_path, "first")
    second, second_evidence, second_manifest = run_builder(tmp_path, "second")

    for name in ("wide-candidate-2560x1440.png", "portrait-860x1864.png"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
        with Image.open(first / name) as image:
            assert image.format == "PNG"
            assert image.mode == "RGB"

    assert first_manifest["metrics"] == second_manifest["metrics"]
    assert Image.open(first_evidence / "contact-sheet.webp").size == (1239, 590)
    assert Image.open(second_evidence / "wide-blocker-overlay.webp").size == (
        1280,
        720,
    )


def test_portraet_bestaar_og_bred_kandidat_forbliver_blokeret(
    tmp_path: Path,
) -> None:
    output, _evidence, manifest = run_builder(tmp_path, "gates")
    gates = json.loads(CONFIG.read_text())["gates"]
    wide = manifest["metrics"]["wide"]
    portrait = manifest["metrics"]["portrait"]

    assert Image.open(output / "wide-candidate-2560x1440.png").size == (
        2560,
        1440,
    )
    assert Image.open(output / "portrait-860x1864.png").size == (860, 1864)
    assert wide["sourceRetention"]["retainedShare"] >= gates["sourceRetentionMin"]
    assert portrait["sourceRetention"]["retainedShare"] >= gates["sourceRetentionMin"]
    assert wide["karlDelta"]["maxDelta"] == 0
    assert portrait["karlDelta"]["maxDelta"] == 0
    assert all(
        seam["ratio"] <= gates["seamGradientRatioMax"]
        for seam in portrait["seams"].values()
    )
    assert (
        wide["repeatDetection"]["sourceReuseCorrelation"]
        > gates["repeatCorrelationMax"]
    )
    assert manifest["promotion"]["wide"]["pass"] is False
    assert manifest["promotion"]["portrait"]["pass"] is True


def test_committet_portraet_er_generatorens_byteidentiske_output(
    tmp_path: Path,
) -> None:
    output, _evidence, _manifest = run_builder(tmp_path, "committed")
    assert PORTRAIT.exists()
    assert PORTRAIT.read_bytes() == (
        output / "portrait-860x1864.png"
    ).read_bytes()
    assert not (
        ROOT / "docs/design/reference/title-scene-master-2560x1440.png"
    ).exists()
