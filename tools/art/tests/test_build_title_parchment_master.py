"""Targeted contracts for the continuous source-derived parchment master."""
from __future__ import annotations

import copy
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
PRODUCTION_DIR = ROOT / "src/assets/art/title-layers"
EVIDENCE_MANIFEST = (
    ROOT / "docs/design/evidence/title-parchment-master/manifest.json"
)
APPROVED_SOURCE_SHA256 = (
    "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850"
)
OBSERVABLE_MASK_SHA256 = (
    "c27eceafc284d843df37fc871b459b97e6cf28ce58b9e5a6cdf40fab287a4547"
)

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


def run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *arguments],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


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
    assert gates["changedOrMissingObservableSourcePixelsMax"] == 0
    assert gates["duplicatePatchCountMax"] == 0
    assert gates["alphaTransitionPixelsMax"] == 1.0
    assert value["retention"] == {
        "observableMaskPixelCount": 248_615,
        "observableMaskSha256": OBSERVABLE_MASK_SHA256,
        "hashEncoding": "big-endian uint32 shape + little-bitorder packbits",
    }
    assert hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest() == (
        builder.APPROVED_PUBLISH_CONFIG_SHA256
    )
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == value["source"]["sha256"]


def test_output_er_rgba_med_meningsfuld_silhuet_og_kildebevarelse(
    built: tuple[Path, dict],
) -> None:
    path, manifest = built
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    assert rgba.shape == (1680, 760, 4)
    metrics = manifest["metrics"]
    assert 0.999 <= metrics["sourcePixelRetention"] <= 1.0
    assert metrics["observableSourcePixels"] == 248_615
    assert metrics["observableMaskSha256"] == OBSERVABLE_MASK_SHA256
    assert metrics["changedOrMissingObservableSourcePixels"] == 0
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


def test_observable_mask_baseline_er_stabil_og_formkodet() -> None:
    value = config()
    _, _, arrays = builder.build(value, require_green=False)
    observable = arrays["observable"]
    # Cropformen indgår i hashen, så samme pakkede bits ikke kan godkendes
    # under andre source-crop-dimensioner.
    assert observable.shape == (907, 700)
    x0, y0, x1, y1 = value["source"]["crop"]
    assert np.array_equal(
        arrays["source"],
        arrays["full_source"][y0:y1, x0:x1],
    )
    assert int(observable.sum()) == 248_615
    assert builder.observable_mask_sha256(observable) == OBSERVABLE_MASK_SHA256


def test_retention_afviser_aendret_eller_udeladt_godkendt_pixel() -> None:
    source = np.full((1000, 1000, 3), 120, dtype=np.uint8)
    output = source.copy()
    observable = np.ones((1000, 1000), dtype=bool)
    present = np.ones((1000, 1000), dtype=bool)
    baseline = json.loads(EVIDENCE_MANIFEST.read_text())["metrics"]

    changed = output.copy()
    changed[0, 0, 0] = 121
    changed_metrics = builder.source_retention_metrics(
        changed,
        source,
        observable,
        present,
    )
    assert changed_metrics["changedOrMissingObservableSourcePixels"] == 1
    changed_candidate = {
        **baseline,
        "sourcePixelRetention": changed_metrics["sourcePixelRetention"],
        "changedOrMissingObservableSourcePixels": 1,
        "observableMaskSha256": OBSERVABLE_MASK_SHA256,
    }
    with pytest.raises(ValueError, match="observable source pixels"):
        builder.validate_metrics(changed_candidate, config())

    omitted = present.copy()
    omitted[0, 0] = False
    omitted_metrics = builder.source_retention_metrics(
        output,
        source,
        observable,
        omitted,
    )
    assert omitted_metrics["changedOrMissingObservableSourcePixels"] == 1
    omitted_candidate = {
        **baseline,
        "sourcePixelRetention": omitted_metrics["sourcePixelRetention"],
        "changedOrMissingObservableSourcePixels": 1,
        "observableMaskSha256": OBSERVABLE_MASK_SHA256,
    }
    with pytest.raises(ValueError, match="observable source pixels"):
        builder.validate_metrics(omitted_candidate, config())


def test_configured_crop_offsets_masks_in_both_axes() -> None:
    assert builder.global_rect(
        [110, 220, 140, 260],
        [100, 200, 300, 400],
    ) == (10, 20, 40, 60)


def test_full_size_configured_crop_drives_retention_and_contact_sheet(
    tmp_path: Path,
) -> None:
    full_source = np.full((1680, 760, 3), 120, dtype=np.uint8)
    rgba = np.dstack(
        [full_source, np.full((1680, 760), 255, dtype=np.uint8)]
    )
    manifest = {
        "output": {"file": "parchment-master.webp"},
        "metrics": {},
    }
    arrays = {
        "full_source": full_source,
        "source": full_source.copy(),
        "observable": np.ones((1680, 760), dtype=bool),
    }
    output_dir = tmp_path / "assets"
    manifest_path = tmp_path / "manifest.json"
    evidence_dir = tmp_path / "evidence"

    builder.write_build(
        Image.fromarray(rgba),
        manifest,
        arrays,
        output_dir,
        manifest_path,
        evidence_dir,
    )

    written = json.loads(manifest_path.read_text())
    assert written["metrics"]["sourcePixelRetention"] == 1.0
    assert written["metrics"]["changedOrMissingObservableSourcePixels"] == 0
    assert (evidence_dir / "contact-sheet.png").is_file()


def test_diagnostic_kan_ikke_skrive_i_produktionsmappen() -> None:
    destination = PRODUCTION_DIR / "nested" / ".." / "diagnostic"
    result = run_cli(
        "--diagnostic",
        "--output-dir",
        str(destination),
    )
    assert result.returncode != 0
    assert "approved publish flow" in result.stderr
    assert not destination.resolve().exists()


def test_publish_kraever_eksplicit_godkendt_kildeproveniens() -> None:
    result = run_cli("--publish")
    assert result.returncode != 0
    assert "--approved-source-sha256" in result.stderr


def test_publish_afviser_relaxed_caller_config(tmp_path: Path) -> None:
    relaxed = copy.deepcopy(config())
    relaxed["gates"]["textureEnergyRatioMin"] = 0.0
    relaxed["gates"]["sourcePixelRetentionMin"] = 0.0
    relaxed_path = tmp_path / "relaxed.json"
    relaxed_path.write_text(json.dumps(relaxed))
    production_path = PRODUCTION_DIR / relaxed["output"]["file"]
    previous = production_path.read_bytes() if production_path.exists() else None

    result = run_cli(
        "--publish",
        "--config",
        str(relaxed_path),
        "--approved-source-sha256",
        APPROVED_SOURCE_SHA256,
    )

    assert result.returncode != 0
    assert "pinned publish config" in result.stderr
    current = production_path.read_bytes() if production_path.exists() else None
    assert current == previous


def test_publish_afviser_omdirigeret_evidence(tmp_path: Path) -> None:
    result = run_cli(
        "--publish",
        "--approved-source-sha256",
        APPROVED_SOURCE_SHA256,
        "--evidence-dir",
        str(tmp_path / "other-evidence"),
    )

    assert result.returncode != 0
    assert "pinned evidence directory" in result.stderr


def test_godkendt_publish_flow_bevarer_den_nuvaerende_kandidat_blokeret() -> None:
    targets = (
        PRODUCTION_DIR / config()["output"]["file"],
        ROOT / "tools/art/title-parchment-master.manifest.json",
        ROOT / "docs/design/evidence/title-parchment-master/contact-sheet.png",
        EVIDENCE_MANIFEST,
    )
    previous = {
        path: path.read_bytes() if path.exists() else None
        for path in targets
    }

    result = run_cli(
        "--publish",
        "--approved-source-sha256",
        APPROVED_SOURCE_SHA256,
    )

    assert result.returncode != 0
    assert "texture energy" in result.stderr
    assert {
        path: path.read_bytes() if path.exists() else None
        for path in targets
    } == previous


def test_publication_transaction_rolls_back_all_files(tmp_path: Path) -> None:
    staged = tmp_path / "staged"
    destinations = tmp_path / "destinations"
    staged.mkdir()
    destinations.mkdir()
    publications = []
    for name in ("asset.webp", "manifest.json", "contact-sheet.png", "evidence.json"):
        source = staged / name
        destination = destinations / name
        source.write_bytes(f"new-{name}".encode())
        destination.write_bytes(f"old-{name}".encode())
        publications.append((source, destination))

    with pytest.raises(RuntimeError, match="injected failure"):
        builder.publish_files_atomically(publications, inject_failure_after=2)

    for source, destination in publications:
        assert source.read_bytes() == f"new-{source.name}".encode()
        assert destination.read_bytes() == f"old-{destination.name}".encode()
    assert sorted(path.name for path in destinations.iterdir()) == sorted(
        destination.name for _, destination in publications
    )


def test_publication_transaction_replaces_all_files(tmp_path: Path) -> None:
    staged = tmp_path / "staged"
    destinations = tmp_path / "destinations"
    staged.mkdir()
    destinations.mkdir()
    publications = []
    for name in ("asset.webp", "manifest.json", "contact-sheet.png", "evidence.json"):
        source = staged / name
        destination = destinations / name
        source.write_bytes(f"new-{name}".encode())
        destination.write_bytes(f"old-{name}".encode())
        publications.append((source, destination))

    builder.publish_files_atomically(publications)

    for source, destination in publications:
        assert source.read_bytes() == f"new-{source.name}".encode()
        assert destination.read_bytes() == f"new-{destination.name}".encode()
    assert sorted(path.name for path in destinations.iterdir()) == sorted(
        destination.name for _, destination in publications
    )
