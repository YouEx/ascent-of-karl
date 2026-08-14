"""Targeted contracts for the continuous source-derived parchment master."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/art/build_title_parchment_master.py"
CONFIG_PATH = ROOT / "tools/art/title-parchment-master.config.json"
SOURCE = ROOT / "docs/design/reference/title-2026-08-11.webp"

sys.path.insert(0, str(ROOT / "tools/art"))
import build_title_parchment_master as builder  # noqa: E402


def config() -> dict:
    return json.loads(CONFIG_PATH.read_text())


def run_build(root: Path, name: str) -> tuple[Path, dict]:
    output = root / name
    manifest = root / f"{name}.json"
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--output-dir",
            str(output),
            "--manifest",
            str(manifest),
            "--diagnostic",
        ],
        cwd=ROOT,
        check=True,
    )
    return output / "parchment-master.webp", json.loads(manifest.read_text())


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict]:
    return run_build(tmp_path_factory.mktemp("parchment-master"), "built")


def test_config_pinner_kilde_dimensioner_og_full_plate_gates() -> None:
    value = config()
    assert value["source"] == {
        "path": "docs/design/reference/title-2026-08-11.webp",
        "sha256": "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850",
        "width": 1586,
        "height": 992,
        "crop": [0, 85, 700, 992],
    }
    assert value["output"] == {
        "file": "parchment-master.webp",
        "width": 760,
        "height": 1680,
    }
    provenance = value["provenance"]
    assert provenance["approvedLosslessComposite"]["sha256"] == (
        "8d37bca638f53d90a996c551183d721877419ebe73f3e81a1c67da120dc1a770"
    )
    assert provenance["approvedLosslessComposite"]["buildInput"] is False
    derivative = provenance["knownBlankDerivative"]
    assert derivative == {
        "path": "src/assets/art/title-parchment-692.webp",
        "sha256": "efd1642b54cd1346ac40286c82928729d2da120a4326a58cc2b65420042ab73a",
        "width": 692,
        "height": 907,
        "bytes": 51254,
        "relationship": "RGBA derivative produced by masking and inpainting the flattened canonical UI; not original clean art",
        "buildInput": False,
    }
    derivative_path = ROOT / derivative["path"]
    assert hashlib.sha256(derivative_path.read_bytes()).hexdigest() == derivative["sha256"]
    assert provenance["layeredSourceFound"] is False
    assert provenance["cleanMobileSourceFound"] is False
    gates = value["gates"]
    assert gates["sourcePixelRetentionMax"] == 1.0
    assert gates["duplicatePatchCountMax"] == 0
    assert gates["alphaTransitionPixelsMax"] == 1.0
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == value["source"]["sha256"]


def test_output_er_rgba_med_meningsfuld_silhuet_og_kildebevarelse(
    built: tuple[Path, dict],
) -> None:
    path, manifest = built
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    assert rgba.shape == (1680, 760, 4)
    metrics = manifest["metrics"]
    assert 0.999 <= metrics["sourcePixelRetention"] <= 1.0
    assert metrics["observableSourcePixels"] > 150_000
    assert metrics["reconstructedPixels"] > metrics["observableSourcePixels"]
    assert 0.65 <= metrics["alphaCoverage"] <= 0.95
    assert metrics["opaqueCoverage"] > 0.6
    assert metrics["transparentCoverage"] > 0.05
    assert metrics["largestAlphaComponentShare"] >= 0.99


def test_full_plate_maaling_blokerer_den_utrovaerdige_kandidat(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    metrics = manifest["metrics"]
    assert manifest["status"] == "blocked"
    assert "texture energy" in manifest["gateFailures"]
    assert metrics["textureEnergyRatio"] < 0.8
    assert metrics["reconstructionBoundaryGradientRatio"] <= 4.0
    assert metrics["rowBandingPeakRatio"] <= 8.0
    assert metrics["sampledPatchCount"] >= 100
    assert metrics["duplicatePatchCount"] == 0
    assert metrics["maxNonAdjacentPatchCorrelation"] <= 0.995
    with pytest.raises(ValueError, match="texture energy"):
        builder.validate_metrics(metrics, config())


def test_alpha_transition_og_fringe_bestaar_paa_tre_baggrunde(
    built: tuple[Path, dict],
) -> None:
    path, manifest = built
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    alpha = rgba[..., 3]
    assert manifest["metrics"]["maxAlphaTransitionPixels"] <= 1.0
    assert manifest["metrics"]["maxAlphaFringePixels"] <= 1.0
    measured = builder.alpha_fringe_metrics(rgba)
    assert measured["maxFringePixels"] <= 1.0
    assert measured["maxCompositeChannelDelta"] <= 1.0
    for background in ((0, 0, 0), (255, 255, 255), (236, 220, 199)):
        composite = np.asarray(builder.composite(rgba, background))
        assert composite.shape == rgba.shape[:2] + (3,)
        assert np.isfinite(composite).all()


def test_to_byg_er_byteidentiske(tmp_path: Path) -> None:
    first, first_manifest = run_build(tmp_path, "first")
    second, second_manifest = run_build(tmp_path, "second")
    assert first.read_bytes() == second.read_bytes()
    assert first_manifest == second_manifest


def test_gentaget_quilt_bliver_afvist() -> None:
    rng = np.random.default_rng(20260814)
    tile = rng.integers(80, 220, size=(48, 48, 3), dtype=np.uint8)
    repeated = np.tile(tile, (35, 16, 1))[:1680, :760]
    support = np.ones((1680, 760), dtype=bool)
    metrics = builder.repetition_metrics(repeated, support, support)
    assert (
        metrics["duplicatePatchCount"] > 0
        or metrics["maxNonAdjacentPatchCorrelation"] > 0.995
    )


def test_retention_kan_aldrig_taelle_ekstra_pixels_over_hundrede_procent() -> None:
    source = np.full((8, 8, 3), 120, dtype=np.uint8)
    output = np.full((16, 16, 3), 120, dtype=np.uint8)
    observable = np.ones((8, 8), dtype=bool)
    assert builder.source_retention(output, source, observable) == 1.0
