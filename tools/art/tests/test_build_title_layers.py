"""Fail-closed kontrakt for titelkunstens pipelinefundament."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/art/build_title_layers.py"
CONFIG = ROOT / "tools/art/title-layers.config.json"
SOURCE = ROOT / "docs/design/reference/title-2026-08-11.webp"
FIXTURE = ROOT / "tools/art/tests/fixtures/title-layers/patchwork"
PRODUCTION = ROOT / "src/assets/art/title-layers"
PRODUCTION_MANIFEST = ROOT / "tools/art/title-layers.manifest.json"
ASSET_QUEUE = ROOT / "docs/design/asset-queue.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_hashes(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): sha256(path)
        for path in sorted(path for path in root.rglob("*") if path.is_file())
    }


@pytest.fixture(scope="module")
def module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_title_layers", SCRIPT)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


@pytest.fixture(scope="module")
def config() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def negative_report(module: ModuleType) -> dict:
    return module.evaluate_candidate(FIXTURE, config_path=CONFIG)


def test_config_og_kode_indeholder_ingen_metric_gaming(config: dict) -> None:
    banned_config = {
        "seamSkySample",
        "mobileDetailStamps",
        "sceneSourcePreemphasis",
        "reconstructedDetailPreemphasis",
        "parchmentTexturePreemphasis",
    }
    assert not banned_config.intersection(config)
    assert all("detailWeight" not in variant for variant in config.get("variants", []))

    source = SCRIPT.read_text(encoding="utf-8")
    for banned in (
        "seamSkySample",
        "mobileDetailStamps",
        "detailWeight",
        "sceneSourcePreemphasis",
        "reconstructedDetailPreemphasis",
        "parchmentTexturePreemphasis",
        "outputCrop",
        "sampleEvidence",
    ):
        assert banned not in source


def test_roede_kandidater_er_fixtures_ikke_produktionsassets() -> None:
    assert not PRODUCTION.exists()
    assert not PRODUCTION_MANIFEST.exists()
    assert (FIXTURE / "manifest.json").exists()
    assert len(list(FIXTURE.glob("*.webp"))) == 15


def test_overlapfejl_bevarer_2d_geometri(module: ModuleType) -> None:
    vertical = np.repeat(np.arange(12, dtype=np.uint8)[:, None], 12, axis=1)
    horizontal = vertical.T
    vertical_rgb = np.dstack([vertical] * 3)
    horizontal_rgb = np.dstack([horizontal] * 3)
    mask = np.ones((12, 12), dtype=bool)

    assert module.gradient_error(vertical_rgb, vertical_rgb, mask) == pytest.approx(0)
    assert module.gradient_error(horizontal_rgb, vertical_rgb, mask) > 0


def test_reference_scene_har_lav_repetition_og_sammenhaeng(module: ModuleType) -> None:
    source = np.asarray(Image.open(SOURCE).convert("RGB"))
    scene = source[:, 690:1586]
    repetition = module.measure_repetition(scene)
    coherence = module.measure_coherence(scene)
    gates = module.load_config(CONFIG)["qualityGates"]

    assert repetition["maxRepeatedBlockShare"] <= gates["repetition"]["maxRepeatedBlockShare"]
    assert coherence["maxRowColumnJump"] <= gates["coherence"]["maxRowColumnJump"]


def test_patchwork_fixture_afvises_af_fuldframe_og_identitetsporte(
    negative_report: dict,
) -> None:
    assert not negative_report["hardGatePassed"]
    assert not negative_report["gates"]["fullFrameRepetition"]["passed"]
    assert not negative_report["gates"]["fullFrameCoherence"]["passed"]
    assert not negative_report["gates"]["localizedKarlIdentity"]["passed"]
    assert set(negative_report["gates"]["localizedKarlIdentity"]["regions"]) == {
        "face",
        "hair",
        "hands",
        "stone",
        "torso",
    }


def test_patchwork_fixture_afvises_af_silhuet_og_alpha(
    negative_report: dict,
) -> None:
    assert not negative_report["gates"]["silhouette"]["passed"]
    assert not negative_report["gates"]["alpha"]["passed"]
    assert any(
        not item["hasAntialiasedTransition"]
        for item in negative_report["metrics"]["alpha"].values()
    )
    assert (
        negative_report["metrics"]["silhouette"]["parchment-mobile-430"][
            "largestComponentShare"
        ]
        < 0.98
    )


def test_alpha_gate_er_ikke_vakuuos(module: ModuleType) -> None:
    binary = np.zeros((32, 32, 4), dtype=np.uint8)
    binary[8:24, 8:24, :3] = 180
    binary[8:24, 8:24, 3] = 255
    antialiased = binary.copy()
    antialiased[8, 8:24, 3] = 128
    antialiased[23, 8:24, 3] = 128
    antialiased[8:24, 8, 3] = 128
    antialiased[8:24, 23, 3] = 128

    assert not module.measure_alpha(binary)["hasAntialiasedTransition"]
    assert module.measure_alpha(antialiased)["hasAntialiasedTransition"]


def test_silhuetdaekning_er_kind_specifik(config: dict) -> None:
    gate = config["qualityGates"]["silhouette"]
    assert gate["foregroundCoverage"] == [0.01, 0.55]
    assert gate["parchmentCoverage"] == [0.60, 0.95]


def test_pergamentretention_kraever_hele_pladen_og_masken(
    config: dict,
    negative_report: dict,
) -> None:
    plate = ROOT / config["parchmentMaster"]["plate"]
    mask = ROOT / config["parchmentMaster"]["mask"]
    assert not plate.exists()
    assert not mask.exists()
    gate = negative_report["gates"]["parchmentPlateRetention"]
    assert not gate["passed"]
    assert gate["status"] == "blocked"
    assert gate["missing"] == [str(plate.relative_to(ROOT)), str(mask.relative_to(ROOT))]


def test_stage_skriver_kun_evidence_og_honorerer_only(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    evidence = tmp_path / "evidence"
    report = module.stage_candidate(
        FIXTURE,
        evidence,
        config_path=CONFIG,
        only={"scene", "foreground"},
    )
    assert not report["hardGatePassed"]
    assert {path.name for path in evidence.glob("*.webp")} == {
        path.name
        for path in FIXTURE.glob("*.webp")
        if path.name.startswith(("scene-", "foreground-"))
    }
    assert not list(evidence.glob("parchment-*.webp"))
    assert json.loads((evidence / "manifest.json").read_text(encoding="utf-8")) == report
    assert not PRODUCTION.exists()


def test_evidence_kan_ikke_skrives_under_produktionsstien(
    module: ModuleType,
) -> None:
    with pytest.raises(ValueError, match="produktionsstien"):
        module.stage_candidate(
            FIXTURE,
            PRODUCTION / "nested-evidence",
            config_path=CONFIG,
            only={"scene"},
        )
    assert not PRODUCTION.exists()


def test_cli_only_honoreres_i_fresh_process(tmp_path: Path) -> None:
    evidence = tmp_path / "parchment-only"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--check",
            "--negative-fixture",
            str(FIXTURE),
            "--only",
            "parchment",
            "--evidence-dir",
            str(evidence),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert {path.name for path in evidence.glob("*.webp")} == {
        "parchment-desktop.webp",
        "parchment-mobile-390.webp",
        "parchment-mobile-430.webp",
    }


def test_fresh_process_determinisme(tmp_path: Path) -> None:
    outputs = []
    for run in ("a", "b"):
        evidence = tmp_path / run
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--check",
                "--negative-fixture",
                str(FIXTURE),
                "--only",
                "scene,foreground",
                "--evidence-dir",
                str(evidence),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1, result.stdout + result.stderr
        outputs.append(tree_hashes(evidence))
    assert outputs[0] == outputs[1]


def test_roed_evidence_kan_ikke_publiceres_atomisk(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    evidence = tmp_path / "evidence"
    module.stage_candidate(FIXTURE, evidence, config_path=CONFIG)
    production = tmp_path / "production"
    production.mkdir()
    (production / "before").write_bytes(b"asset-before")
    manifest = tmp_path / "production-manifest.json"
    manifest.write_bytes(b"manifest-before")

    with pytest.raises(RuntimeError, match="hardGatePassed"):
        module.publish_evidence(evidence, production, manifest)
    assert tree_hashes(production) == {"before": hashlib.sha256(b"asset-before").hexdigest()}
    assert manifest.read_bytes() == b"manifest-before"


def _green_evidence(root: Path) -> Path:
    evidence = root / "green-evidence"
    evidence.mkdir()
    image_path = evidence / "scene-test.webp"
    Image.new("RGB", (8, 8), (120, 90, 60)).save(image_path, "WEBP", lossless=True)
    manifest = {
        "version": 1,
        "hardGatePassed": True,
        "outputs": [
            {
                "file": image_path.name,
                "bytes": image_path.stat().st_size,
                "sha256": sha256(image_path),
            }
        ],
    }
    (evidence / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return evidence


@pytest.mark.parametrize("fault_at", ["after-backup", "after-assets", "after-manifest"])
def test_atomisk_publicering_ruller_baade_assets_og_manifest_tilbage(
    tmp_path: Path,
    module: ModuleType,
    fault_at: str,
) -> None:
    evidence = _green_evidence(tmp_path)
    production = tmp_path / "production"
    production.mkdir()
    (production / "before").write_bytes(b"asset-before")
    manifest = tmp_path / "production-manifest.json"
    manifest.write_bytes(b"manifest-before")

    with pytest.raises(RuntimeError, match="fault injection"):
        module.publish_evidence(
            evidence,
            production,
            manifest,
            fault_at=fault_at,
        )
    assert tree_hashes(production) == {"before": hashlib.sha256(b"asset-before").hexdigest()}
    assert manifest.read_bytes() == b"manifest-before"


def test_groen_publicering_installerer_manifest_og_assetset_sammen(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    evidence = _green_evidence(tmp_path)
    production = tmp_path / "production"
    manifest = tmp_path / "production-manifest.json"
    module.publish_evidence(evidence, production, manifest)

    assert {path.name for path in production.iterdir()} == {"scene-test.webp"}
    installed = json.loads(manifest.read_text(encoding="utf-8"))
    assert installed["hardGatePassed"]
    assert installed["outputs"][0]["sha256"] == sha256(production / "scene-test.webp")


def test_assetkoeen_navnsaetter_begge_reelle_masterblokeringer() -> None:
    queue = json.loads(ASSET_QUEUE.read_text(encoding="utf-8"))
    by_key = {item["key"]: item for item in queue["items"]}
    # Scenen stod tidligere som én samlet post, TITLE-scene-master-v2. Da begge
    # kandidater blev målt og blokeret hver for sig (spejlet forlængelse i
    # portrættet, gentaget kant i den brede), blev den afløst af to præcise
    # poster. Testen holder derfor på KRAVET — at hver manglende master står
    # navngivet i køen — ikke på den gamle nøgle, som ellers ville tvinge den
    # samme mangel til at optræde to gange.
    for key, asset_id in (
        ("title:missing-master:TITLE-scene-master-wide", "TITLE-scene-master-wide"),
        (
            "title:missing-master:TITLE-scene-master-portrait",
            "TITLE-scene-master-portrait",
        ),
    ):
        assert by_key[key]["fix"]["assetId"] == asset_id
        assert by_key[key]["status"] == "open"
    assert "title:missing-master:TITLE-scene-master-v2" not in by_key

    parchment = by_key["title:missing-master:TITLE-parchment-clean-v1"]
    assert parchment["fix"] == {
        "kind": "asset",
        "assetId": "TITLE-parchment-clean-v1",
        "producer": "manual-approved-clean-plate",
        "minimum": "700×992 lossless clean parchment plate plus binary source-aligned mask",
        "invariant": "samme flossede silhuet, belysning og ornamentplacering som den godkendte reference",
        "unblock": "full-plate retention, silhouette, alpha og fringe består uden plantede prøvekerner",
    }
