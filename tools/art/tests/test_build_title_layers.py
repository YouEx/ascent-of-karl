"""Kontrakt for den deterministiske, kildeafledte titel-lagspipeline."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import cv2
import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/art/build_title_layers.py"
CONFIG = ROOT / "tools/art/title-layers.config.json"
SOURCE = ROOT / "docs/design/reference/title-2026-08-11.webp"
ELEMENTS = ROOT / "src/assets/art/elements"
ASSET_QUEUE = ROOT / "docs/design/asset-queue.json"

EXPECTED_DIMENSIONS = {
    "scene-mobile-390.webp": (780, 1688),
    "foreground-mobile-390.webp": (780, 1688),
    "scene-mobile-430.webp": (860, 1864),
    "foreground-mobile-430.webp": (860, 1864),
    "scene-desktop-1366.webp": (1366, 768),
    "foreground-desktop-1366.webp": (1366, 768),
    "scene-desktop-1536.webp": (1536, 1024),
    "foreground-desktop-1536.webp": (1536, 1024),
    "scene-target-native.webp": (1586, 992),
    "foreground-target-native.webp": (1586, 992),
    "scene-desktop-2560.webp": (2560, 1440),
    "foreground-desktop-2560.webp": (2560, 1440),
    "parchment-desktop.webp": (700, 992),
    "parchment-mobile-390.webp": (700, 1530),
    "parchment-mobile-430.webp": (760, 1680),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def config() -> dict:
    assert CONFIG.exists(), "title-layers.config.json mangler"
    return json.loads(CONFIG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def module() -> ModuleType:
    assert SCRIPT.exists(), "build_title_layers.py mangler"
    spec = importlib.util.spec_from_file_location("build_title_layers", SCRIPT)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


@pytest.fixture(scope="module")
def built(
    tmp_path_factory: pytest.TempPathFactory,
    module: ModuleType,
) -> tuple[Path, dict]:
    root = tmp_path_factory.mktemp("title-layers")
    output = root / "assets"
    manifest_path = root / "manifest.json"
    manifest = module.build_bundle(
        config_path=CONFIG,
        output_dir=output,
        manifest_path=manifest_path,
    )
    assert manifest_path.exists()
    assert json.loads(manifest_path.read_text(encoding="utf-8")) == manifest
    return output, manifest


def test_config_pinner_kilde_samples_seeds_outputs_og_budgetter(config: dict) -> None:
    source = config["source"]
    assert source["path"] == "docs/design/reference/title-2026-08-11.webp"
    assert source["sha256"] == sha256(SOURCE)
    assert source["dimensions"] == [1586, 992]
    assert source["sceneCrop"] == [690, 0, 1586, 992]
    assert source["characterCrop"] == [900, 210, 1440, 815]

    assert config["seed"] == 20260814
    assert config["patchQuilting"]["scene"] == {
        "patchSize": 160,
        "overlap": 48,
    }
    assert config["patchQuilting"]["parchment"] == {
        "patchSize": 48,
        "overlap": 12,
    }
    assert len(config["blankPaperSamples"]) == 4
    assert all(
        sample["crop"][2] - sample["crop"][0] >= 48
        and sample["crop"][3] - sample["crop"][1] >= 48
        for sample in config["blankPaperSamples"]
    )
    assert 1 <= len(config["variants"]) <= 3

    outputs = {item["file"]: tuple(item["dimensions"]) for item in config["outputs"]}
    assert outputs == EXPECTED_DIMENSIONS
    assert config["budgets"]["groups"] == {
        "desktopSceneForeground": 420_000,
        "mobileSceneForeground": 230_000,
        "desktopParchment": 180_000,
        "mobileParchment": 120_000,
    }
    assert config["provenanceGates"] == {
        "minDirectSourceCoverage": 0.5,
    }


def test_config_pinner_de_frosne_fidelityporte(config: dict) -> None:
    assert config["metrics"]["algorithmVersion"] == "title-fidelity-v1"
    assert config["metrics"]["gates"] == {
        "sceneSeamGradientMax": 4.0,
        "bottomLeftDarkShareMin": 35.0,
        "bottomLeftDarkShareMax": 47.0,
        "characterDetailVarianceMin": 300.0,
        "globalEdgeDensityMin": 6.1,
        "sceneDetailRetentionMin": 0.95,
        "parchmentBlankRetentionMin": 0.85,
        "parchmentSampleRetentionMin": 0.80,
        "alphaTransitionMaxPx": 1,
        "alphaFringeMaxPx": 1,
    }


def test_build_skriver_kun_de_registrerede_dimensioner(
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    assert {path.name for path in output.iterdir()} == set(EXPECTED_DIMENSIONS)
    assert {item["file"] for item in manifest["outputs"]} == set(EXPECTED_DIMENSIONS)

    for name, dimensions in EXPECTED_DIMENSIONS.items():
        with Image.open(output / name) as image:
            assert image.size == dimensions
            expected_mode = "RGBA" if name.startswith(("foreground-", "parchment-")) else "RGB"
            assert image.mode == expected_mode


def test_manifestet_pinner_proveniens_hashes_og_valgt_variant(
    config: dict,
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    assert manifest["algorithmVersion"] == config["algorithmVersion"]
    assert manifest["source"] == {
        "path": config["source"]["path"],
        "sha256": config["source"]["sha256"],
        "dimensions": config["source"]["dimensions"],
    }
    assert manifest["configSha256"] == sha256(CONFIG)
    assert manifest["selectedVariant"] in {item["id"] for item in config["variants"]}
    assert 1 <= len(manifest["candidates"]) <= 3
    assert all("score" in candidate and "viewports" in candidate for candidate in manifest["candidates"])

    for item in manifest["outputs"]:
        path = output / item["file"]
        assert item["sha256"] == sha256(path)
        assert item["bytes"] == path.stat().st_size
        assert item["dimensions"] == list(EXPECTED_DIMENSIONS[item["file"]])


def test_to_byg_er_byteidentiske(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    manifests = []
    hashes = []
    for run in ("a", "b"):
        output = tmp_path / run / "assets"
        manifest_path = tmp_path / run / "manifest.json"
        manifests.append(
            module.build_bundle(
                config_path=CONFIG,
                output_dir=output,
                manifest_path=manifest_path,
            )
        )
        hashes.append({path.name: sha256(path) for path in output.iterdir()})
    assert hashes[0] == hashes[1]
    assert manifests[0] == manifests[1]


def test_karls_kildepixels_er_bevaret_uden_opskalering(
    config: dict,
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    source = np.asarray(Image.open(SOURCE).convert("RGB"))
    placements = manifest["sourcePlacements"]
    assert set(placements) == {
        item["id"] for item in config["outputs"] if item["kind"] == "scene"
    }

    for asset_id, placement in placements.items():
        sx0, sy0, sx1, sy1 = placement["sourceCrop"]
        dx0, dy0, dx1, dy1 = placement["destination"]
        assert dx1 - dx0 <= sx1 - sx0
        assert dy1 - dy0 <= sy1 - sy0

        px0, py0, px1, py1 = placement["protectedSourceCrop"]
        scale_x = (dx1 - dx0) / (sx1 - sx0)
        scale_y = (dy1 - dy0) / (sy1 - sy0)
        ox0 = dx0 + round((px0 - sx0) * scale_x)
        oy0 = dy0 + round((py0 - sy0) * scale_y)
        ox1 = dx0 + round((px1 - sx0) * scale_x)
        oy1 = dy0 + round((py1 - sy0) * scale_y)

        expected = Image.fromarray(source[py0:py1, px0:px1]).resize(
            (ox1 - ox0, oy1 - oy0),
            Image.Resampling.LANCZOS,
        )
        actual = Image.open(output / f"{asset_id}.webp").convert("RGB").crop(
            (ox0, oy0, ox1, oy1)
        )
        delta = np.abs(
            np.asarray(actual, dtype=np.int16)
            - np.asarray(expected, dtype=np.int16)
        )
        assert float(delta.mean()) <= 5.0, f"{asset_id}: Karls pixels gled {delta.mean():.2f}"


def test_scene_foreground_bestaar_frosne_porte(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    gates = manifest["gates"]
    assert gates["sceneSeamGradient"]["passed"]
    assert gates["characterDetailVariance"]["passed"]
    assert gates["globalEdgeDensity"]["passed"]
    assert gates["targetBottomLeftDarkShare"]["passed"]
    assert gates["sceneDetailRetention"]["passed"]

    for viewport in manifest["candidateMetrics"]["viewports"].values():
        assert viewport["sceneSeamGradient"] <= 4.0
        assert viewport["characterDetailVariance"] >= 300.0
        assert viewport["globalEdgeDensity"] >= 6.1
    target = manifest["candidateMetrics"]["viewports"]["target-native"]
    assert 35.0 <= target["bottomLeftDarkShare"] <= 47.0
    assert min(manifest["metrics"]["sceneDetailRetention"].values()) >= 0.95


def test_manglende_wide_og_mobile_sourcepixels_failer_lukket(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    coverage = manifest["metrics"]["directSourceCoverage"]
    assert coverage["scene-target-native"] >= 0.5
    assert coverage["scene-desktop-2560"] < 0.5
    assert coverage["scene-mobile-390"] < 0.5
    assert coverage["scene-mobile-430"] < 0.5
    assert not manifest["gates"]["sourceCoverage"]["passed"]
    assert not manifest["hardGatePassed"]
    assert manifest["masterBlocker"] == {
        "assetId": "TITLE-scene-master-v2",
        "key": "title:missing-master:TITLE-scene-master-v2",
        "missing": [
            "docs/design/reference/scene-wide.png",
            "approved 2560x1440 lossless scene",
            "approved 860x1864 art-directed mobile scene",
        ],
    }

    queue = json.loads(ASSET_QUEUE.read_text(encoding="utf-8"))
    matching = [
        item
        for item in queue["items"]
        if item["key"] == "title:missing-master:TITLE-scene-master-v2"
    ]
    assert len(matching) == 1
    assert matching[0]["fix"] == {
        "kind": "asset",
        "assetId": "TITLE-scene-master-v2",
        "producer": "manual-approved-outpaint",
        "minimum": "2560×1440 lossless scene plus 860×1864 art-directed mobile scene",
        "invariant": "Karl er pixelidentisk i identitet/pose med den godkendte kilde",
        "unblock": "alle REQ-003 til REQ-008-gates består uden tærskelændring",
    }


def test_pergament_quiltes_fra_hver_godkendt_proeve(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    retention = manifest["metrics"]["parchmentRetention"]
    assert retention["overall"] >= 0.85
    assert set(retention["samples"]) == {
        "paper-top-left",
        "paper-top-mid",
        "paper-middle-left",
        "paper-middle-right",
    }
    assert min(retention["samples"].values()) >= 0.80
    assert manifest["gates"]["parchmentRetention"]["passed"]

    source = SCRIPT.read_text(encoding="utf-8")
    assert "standard_normal" not in source
    assert "random.normal" not in source
    assert "normalvariate" not in source


def test_rgba_kanter_er_dekontaminerede_mod_tre_baggrunde(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    for asset_id, metrics in manifest["metrics"]["alpha"].items():
        assert metrics["transitionPx"] <= 1, asset_id
        assert set(metrics["fringePx"]) == {"black", "white", "parchment"}
        assert max(metrics["fringePx"].values()) <= 1, asset_id
    assert manifest["gates"]["alpha"]["passed"]


def test_bytebudgetter_holds_for_valgte_assets(
    config: dict,
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    by_id = {item["id"]: item for item in config["outputs"]}
    for item in manifest["outputs"]:
        assert item["bytes"] <= by_id[item["id"]]["byteBudget"], item["id"]

    groups = manifest["metrics"]["payloadBytes"]
    assert groups["desktopSceneForeground"] <= 420_000
    assert groups["mobileSceneForeground"] <= 230_000
    assert groups["desktopParchment"] <= 180_000
    assert groups["mobileParchment"] <= 120_000
    assert manifest["gates"]["budgets"]["passed"]
    assert sum(path.stat().st_size for path in output.iterdir()) > 0


def test_fejl_foer_installation_bevarer_eksisterende_output(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    output = tmp_path / "installed"
    output.mkdir()
    sentinel = output / "sentinel"
    sentinel.write_bytes(b"bevar")
    manifest_path = tmp_path / "installed-manifest.json"
    manifest_path.write_text('{"before":true}\n', encoding="utf-8")

    bad = json.loads(CONFIG.read_text(encoding="utf-8"))
    bad["source"]["sha256"] = "0" * 64
    bad_config = tmp_path / "bad-config.json"
    bad_config.write_text(
        json.dumps(bad, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="source-SHA"):
        module.install_bundle(
            config_path=bad_config,
            output_dir=output,
            manifest_path=manifest_path,
        )
    assert {path.name: path.read_bytes() for path in output.iterdir()} == {
        "sentinel": b"bevar"
    }
    assert manifest_path.read_text(encoding="utf-8") == '{"before":true}\n'


def test_titlebyg_aendrer_ikke_elementoutput(
    tmp_path: Path,
    module: ModuleType,
) -> None:
    before = {path.name: sha256(path) for path in ELEMENTS.glob("*.webp")}
    assert len(before) == 13
    module.build_bundle(
        config_path=CONFIG,
        output_dir=tmp_path / "assets",
        manifest_path=tmp_path / "manifest.json",
    )
    after = {path.name: sha256(path) for path in ELEMENTS.glob("*.webp")}
    assert after == before


def test_kantmaaling_bruger_rigtige_alphapixels(
    built: tuple[Path, dict],
) -> None:
    output, _ = built
    for name in EXPECTED_DIMENSIONS:
        if not name.startswith(("foreground-", "parchment-")):
            continue
        alpha = np.asarray(Image.open(output / name).convert("RGBA"))[..., 3]
        semitransparent = (alpha > 0) & (alpha < 255)
        if semitransparent.any():
            count, _ = cv2.connectedComponents(semitransparent.astype(np.uint8))
            assert count >= 1
