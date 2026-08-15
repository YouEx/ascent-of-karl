"""Acceptance contract for the fail-closed title scene-master pipeline."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / "tools/art/title-scene-masters.config.json"
SCRIPT = ROOT / "tools/art/build_title_scene_masters.py"
EVIDENCE = ROOT / "docs/design/evidence/title-scene-masters-2026-08-14"
PORTRAIT = ROOT / "docs/design/reference/title-scene-portrait-860x1864.png"
WIDE = ROOT / "docs/design/reference/title-scene-master-2560x1440.png"


def load_builder():
    spec = importlib.util.spec_from_file_location("title_scene_masters", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_builder(
    tmp_path: Path,
    name: str,
) -> tuple[subprocess.CompletedProcess[str], Path, Path, Path, dict]:
    output = tmp_path / name / "output"
    evidence = tmp_path / name / "evidence"
    manifest = tmp_path / name / "manifest.json"
    result = subprocess.run(
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
        check=False,
        text=True,
        capture_output=True,
    )
    assert manifest.exists(), result.stderr
    return result, output, evidence, manifest, json.loads(manifest.read_text())


def test_config_pins_sources_honestly_and_blocks_both_masters() -> None:
    config = json.loads(CONFIG.read_text())
    landscape = config["sources"]["approvedLandscape"]

    assert config["algorithm"] == "title-scene-masters-classical-v2"
    assert config["sources"]["canonicalTitle"]["sha256"] == sha256(
        ROOT / config["sources"]["canonicalTitle"]["path"]
    )
    assert landscape["sha256"] == sha256(ROOT / landscape["path"])
    assert landscape["provenance"]["humanApproved"] is False
    assert landscape["provenance"]["role"] == "continuation-donor-only"
    assert config["wide"]["promotion"]["approved"] is False
    assert config["portrait"]["promotion"]["approved"] is False
    assert config["portrait"]["manualApproval"] is None


def test_build_is_byte_deterministic_and_both_candidates_are_blocked(
    tmp_path: Path,
) -> None:
    first = run_builder(tmp_path, "first")
    second = run_builder(tmp_path, "second")
    first_result, first_output, first_evidence, first_manifest_path, first_manifest = (
        first
    )
    second_result, second_output, second_evidence, second_manifest_path, second_manifest = (
        second
    )

    assert first_result.returncode == 1
    assert second_result.returncode == 1
    for name in ("wide-candidate-2560x1440.png", "portrait-860x1864.png"):
        assert (first_output / name).read_bytes() == (second_output / name).read_bytes()
        with Image.open(first_output / name) as image:
            assert image.format == "PNG"
            assert image.mode == "RGB"

    for name in ("contact-sheet.webp", "wide-blocker-overlay.webp", "metrics.json"):
        assert (first_evidence / name).read_bytes() == (
            second_evidence / name
        ).read_bytes()
    assert first_manifest_path.read_bytes() == second_manifest_path.read_bytes()
    assert first_manifest == second_manifest
    assert first_manifest["promotion"]["wide"]["pass"] is False
    assert first_manifest["promotion"]["portrait"]["pass"] is False


def test_portrait_measures_full_canonical_scene_and_transition_quality(
    tmp_path: Path,
) -> None:
    _result, output, _evidence, _manifest_path, manifest = run_builder(
        tmp_path,
        "gates",
    )
    gates = json.loads(CONFIG.read_text())["gates"]
    portrait = manifest["metrics"]["portrait"]
    wide = manifest["metrics"]["wide"]

    assert Image.open(output / "portrait-860x1864.png").size == (860, 1864)
    assert portrait["sourceRetention"]["canonicalSize"] == [896, 992]
    assert portrait["sourceRetention"]["coveredSize"] == [860, 992]
    assert portrait["sourceRetention"]["fullCoverage"] is False
    assert portrait["sourceRetention"]["retainedShare"] < 1.0
    assert portrait["transition"]["scales"] == [4, 16, 64]
    assert set(portrait["transition"]["bands"]) == {"4", "16", "64"}
    assert (
        portrait["repeatDetection"]["sourceReuseCorrelation"]
        > gates["portraitSourceReuseCorrelationMax"]
    )
    assert wide["sourceRetention"]["fullCoverage"] is True
    assert wide["sourceRetention"]["retainedShare"] == 1.0
    assert manifest["promotion"]["portrait"]["pass"] is False


def test_repeated_sixteen_row_extension_fixture_fails_repeat_gate() -> None:
    builder = load_builder()
    detector = getattr(builder, "extension_repeat_metrics", None)
    assert detector is not None, "extension repetition detector is missing"

    rng = np.random.default_rng(20260814)
    source = rng.integers(0, 256, size=(64, 96, 3), dtype=np.uint8)
    tile = rng.integers(0, 256, size=(16, 96, 3), dtype=np.uint8)
    extension = np.concatenate([source[-4:], np.tile(tile, (12, 1, 1))])
    candidate = np.concatenate([source, extension])

    metrics = detector(
        candidate,
        source_height=source.shape[0],
        source_reference=source,
        tile_lags=range(4, 65),
    )

    assert metrics["maxTileCorrelation"] > 0.99
    assert metrics["maxTileLag"] == 16
    assert (
        builder.repeat_gate_pass(
            metrics,
            max_tile_correlation=0.92,
            max_source_reuse_correlation=0.65,
        )
        is False
    )


def test_manual_approval_is_bound_to_candidate_evidence_generator_and_config(
    tmp_path: Path,
) -> None:
    builder = load_builder()
    verifier = getattr(builder, "verify_manual_approval", None)
    basis_digest = getattr(builder, "approval_basis_sha256", None)
    assert verifier is not None, "manual approval verifier is missing"
    assert basis_digest is not None, "approval config binding is missing"

    candidate = tmp_path / "candidate.png"
    contact = tmp_path / "contact.webp"
    generator = tmp_path / "generator.py"
    candidate.write_bytes(b"candidate-v1")
    contact.write_bytes(b"contact-v1")
    generator.write_bytes(b"generator-v1")
    config = json.loads(CONFIG.read_text())
    approval = {
        "candidateSha256": sha256(candidate),
        "contactSheetSha256": sha256(contact),
        "generatorSha256": sha256(generator),
        "configBasisSha256": basis_digest(config),
        "reviewer": "Independent Reviewer",
        "reviewedAt": "2026-08-14T16:36:14.244+02:00",
    }

    assert verifier(
        approval,
        candidate,
        contact,
        generator,
        config,
    )["valid"] is True

    contact.write_bytes(b"contact-v2")
    assert verifier(
        approval,
        candidate,
        contact,
        generator,
        config,
    )["valid"] is False
    contact.write_bytes(b"contact-v1")

    changed_config = copy.deepcopy(config)
    changed_config["gates"]["sourceRetentionMin"] = 1.1
    assert verifier(
        approval,
        candidate,
        contact,
        generator,
        changed_config,
    )["valid"] is False


def test_failed_gate_never_replaces_existing_promoted_output(
    tmp_path: Path,
) -> None:
    builder = load_builder()
    publisher = getattr(builder, "publish_promoted_candidate", None)
    assert publisher is not None, "guarded promotion function is missing"

    staged = tmp_path / "staged.png"
    destination = tmp_path / "production.png"
    staged.write_bytes(b"failed-new-candidate")
    destination.write_bytes(b"previous-approved-output")

    assert (
        publisher(
            staged,
            destination,
            gates_pass=False,
            approval_valid=True,
        )
        is False
    )
    assert destination.read_bytes() == b"previous-approved-output"
    assert (
        publisher(
            staged,
            destination,
            gates_pass=True,
            approval_valid=False,
        )
        is False
    )
    assert destination.read_bytes() == b"previous-approved-output"


def test_publication_transaction_rolls_back_every_destination(
    tmp_path: Path,
    monkeypatch,
) -> None:
    builder = load_builder()
    publisher = getattr(builder, "publish_files_atomically", None)
    assert publisher is not None, "atomic publication transaction is missing"

    staged_a = tmp_path / "staged-a"
    staged_b = tmp_path / "staged-b"
    destination_a = tmp_path / "a" / "production-a"
    destination_b = tmp_path / "b" / "production-b"
    staged_a.write_bytes(b"new-a")
    staged_b.write_bytes(b"new-b")
    destination_a.parent.mkdir()
    destination_b.parent.mkdir()
    destination_a.write_bytes(b"old-a")
    destination_b.write_bytes(b"old-b")

    real_replace = builder.os.replace
    failed = False

    def fail_second_destination(source, destination):
        nonlocal failed
        if Path(destination) == destination_b and not failed:
            failed = True
            raise OSError("simulated second-destination failure")
        return real_replace(source, destination)

    monkeypatch.setattr(builder.os, "replace", fail_second_destination)
    assert (
        publisher(
            [
                (staged_a, destination_a),
                (staged_b, destination_b),
            ]
        )
        is False
    )
    assert destination_a.read_bytes() == b"old-a"
    assert destination_b.read_bytes() == b"old-b"


def test_retention_threshold_above_one_fails_automated_gates() -> None:
    builder = load_builder()
    gate = getattr(builder, "automated_gates_pass", None)
    assert gate is not None, "central automated gate is missing"
    config = json.loads(CONFIG.read_text())
    metrics = {
        "sourceRetention": {
            "retainedShare": 1.0,
            "fullCoverage": True,
        },
        "karlDelta": {"maxDelta": 0},
        "transition": {"pass": True},
        "repeatDetection": {"pass": True},
    }
    gates = copy.deepcopy(config["gates"])
    gates["sourceRetentionMin"] = 1.1

    assert gate(metrics, gates) is False


def test_arbitrary_run_paths_cannot_request_production_publication(
    tmp_path: Path,
) -> None:
    builder = load_builder()
    matcher = getattr(builder, "publication_paths_match_config", None)
    assert matcher is not None, "production path binding is missing"
    config = json.loads(CONFIG.read_text())

    assert matcher(
        config,
        tmp_path / "output",
        tmp_path / "evidence",
        tmp_path / "manifest.json",
    ) is False

    publication = config["publication"]
    assert matcher(
        config,
        ROOT / publication["outputDir"],
        ROOT / publication["evidenceDir"],
        ROOT / publication["manifest"],
    ) is True


def test_committed_blocker_evidence_is_fresh_and_no_master_is_promoted(
    tmp_path: Path,
) -> None:
    _result, _output, generated_evidence, generated_manifest_path, manifest = (
        run_builder(tmp_path, "freshness")
    )

    assert not PORTRAIT.exists()
    assert not WIDE.exists()
    for name in ("contact-sheet.webp", "wide-blocker-overlay.webp", "metrics.json"):
        assert (EVIDENCE / name).read_bytes() == (
            generated_evidence / name
        ).read_bytes()
    assert (EVIDENCE / "manifest.json").read_bytes() == (
        generated_manifest_path
    ).read_bytes()
    assert manifest["promotion"]["portrait"]["pass"] is False
    assert manifest["promotion"]["wide"]["pass"] is False


def test_failed_publication_is_reported_not_swallowed(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    """En mislykket skrivning skal kunne ses.

    Transaktionen rullede korrekt tilbage, men returnerede et tavst False. Med
    exitkoden udledt af portenes BESLUTNING betød det, at `--promote` kunne
    afslutte med 0, uden at en eneste fil var skrevet — den værst tænkelige
    kombination for et værktøj, hvis hele formål er at udgive.
    """
    builder = load_builder()
    staged = tmp_path / "staged"
    destination = tmp_path / "out" / "production"
    staged.write_bytes(b"new")
    destination.parent.mkdir()
    destination.write_bytes(b"old")

    real_replace = builder.os.replace

    def fail_forward_write(source, dest):
        # Kun selve udgivelsen fejler. Rollback bruger samme os.replace, og en
        # bredere attrap ville måle tilbagerulningen i stedet for skrivningen.
        if str(source).endswith(".incoming"):
            raise OSError("simulated write failure")
        return real_replace(source, dest)

    monkeypatch.setattr(builder.os, "replace", fail_forward_write)
    assert builder.publish_files_atomically([(staged, destination)]) is False
    assert destination.read_bytes() == b"old"
    assert "simulated write failure" in capsys.readouterr().err


def test_build_fails_closed_when_an_approved_publication_is_not_written() -> None:
    """Beslutning og udfald skal hænge sammen.

    Begge mestre er bevidst blokerede i dette repo (se
    test_config_pins_sources_honestly_and_blocks_both_masters), så der findes
    ingen bestået promovering at køre igennem end-to-end. Påstanden er derfor
    strukturel: build() skal rejse, når noget godkendt ikke blev skrevet, og
    kastet skal ligge EFTER at manifest og metrics er lagt på disken, så en
    mislykket skrivning ikke også koster beviset for hvorfor.
    """
    source = SCRIPT.read_text(encoding="utf-8")
    assert "unpublished: list[str] = []" in source
    assert "elif decided:" in source

    raise_at = source.index("if unpublished:")
    metrics_at = source.index('(evidence_dir / "metrics.json").write_text')
    manifest_at = source.index("manifest_path.write_text")
    assert manifest_at < raise_at, "manifestet skal skrives før kastet"
    assert metrics_at < raise_at, "metrics skal skrives før kastet"
