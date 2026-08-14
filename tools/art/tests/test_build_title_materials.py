"""TASK-009..011: kontrakt for titelens sourceafledte materialer."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT / "tools/art/title-materials.config.json"
SCRIPT_PATH = ROOT / "tools/art/build_title_materials.py"
SOURCE_PATH = ROOT / "docs/design/reference/title-2026-08-11.webp"
SOURCE_SHA256 = "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850"

sys.path.insert(0, str(ROOT / "tools/art"))
import build_title_materials as builder  # noqa: E402

EXPECTED_DIMENSIONS = {
    "wordmark-desktop.webp": (545, 320),
    "wordmark-mobile.webp": (436, 256),
    "ribbon-left.webp": (60, 61),
    "ribbon-center.webp": (380, 61),
    "ribbon-right.webp": (60, 61),
    "begin-left.webp": (56, 106),
    "begin-center.webp": (168, 106),
    "begin-right.webp": (56, 106),
    "fates-left.webp": (48, 100),
    "fates-center.webp": (118, 100),
    "fates-right.webp": (48, 100),
    "welcome-frame.webp": (340, 80),
    "tool-frame.webp": (74, 76),
    "tip-card-frame.webp": (570, 126),
    "ornament-spiral.webp": (70, 70),
    "ornament-trophy.webp": (38, 70),
    "ornament-tap.webp": (37, 40),
    "ornament-divider.webp": (182, 26),
    "ornament-hunt.webp": (110, 97),
    "welcome-figure.webp": (69, 61),
    "tip-fire-tile.webp": (86, 86),
}


def _config() -> dict:
    assert CONFIG_PATH.exists(), "title-materials.config.json mangler"
    return json.loads(CONFIG_PATH.read_text())


def _run_builder(output_dir: Path, manifest_path: Path) -> None:
    assert SCRIPT_PATH.exists(), "build_title_materials.py mangler"
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            "--output-dir",
            str(output_dir),
            "--manifest",
            str(manifest_path),
            "--check",
        ],
        cwd=ROOT,
        check=True,
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _built(tmp_path: Path, name: str) -> tuple[Path, dict]:
    output_dir = tmp_path / name
    manifest_path = tmp_path / f"{name}.manifest.json"
    _run_builder(output_dir, manifest_path)
    return output_dir, json.loads(manifest_path.read_text())


def test_config_pinner_kilde_crops_matte_dimensioner_og_budgetter() -> None:
    config = _config()

    assert config["version"] == 2
    assert config["source"] == {
        "path": "docs/design/reference/title-2026-08-11.webp",
        "sha256": SOURCE_SHA256,
        "width": 1586,
        "height": 992,
    }
    assert config["matting"] == {
        "deltaETransparent": 2.0,
        "deltaEOpaque": 12.0,
        "minComponentPixels": 8,
        "closeRadiusPixels": 1,
        "maxTransitionPixels": 1,
        "maxFringePixels": 1,
        "maxCompositeDeltaE": 8.0,
        "parchmentRgb": [229, 207, 185],
    }
    assert config["budgets"] == {
        "desktopCriticalBytes": 180_000,
        "mobileCriticalBytes": 120_000,
    }
    assert config["assets"]["wordmark"]["crop"] == [150, 130, 695, 450]
    assert config["assets"]["ribbon"]["crop"] == [155, 458, 655, 519]
    assert config["assets"]["begin"]["crop"] == [143, 642, 423, 748]
    assert config["assets"]["fates"]["crop"] == [441, 645, 655, 745]
    assert config["assets"]["welcomeFrame"]["crop"] == [20, 20, 360, 100]
    assert config["assets"]["toolFrame"]["crop"] == [1384, 20, 1458, 96]
    assert config["assets"]["tipCardFrame"]["crop"] == [95, 828, 665, 954]
    assert config["assets"]["ribbon"]["centerPolicy"] == "stretch"
    assert config["assets"]["begin"]["centerPolicy"] == "stretch"
    assert config["assets"]["fates"]["centerPolicy"] == "stretch"
    assert config["coverageGates"]["wordmark"]["minDominantInkPixels"] == 8_000
    assert config["occupancyGrouping"] == {
        "dilationHeight": 5,
        "dilationWidth": 15,
        "inkLumaMax": 100,
        "alphaMin": 64,
        "minDensity": 0.25,
    }
    assert config["parchmentDependencies"] == {
        "desktop": {
            "path": "src/assets/art/title-parchment-692.webp",
            "sha256": "efd1642b54cd1346ac40286c82928729d2da120a4326a58cc2b65420042ab73a",
            "width": 692,
            "height": 907,
        },
        "mobile-390": {
            "path": "src/assets/art/title-parchment-360.webp",
            "sha256": "e9ebd8305af47b2c349818c41b673903ac53b4ad3b854fd9c38ea72b75758636",
            "width": 360,
            "height": 472,
        },
        "mobile-430": {
            "path": "src/assets/art/title-parchment-520.webp",
            "sha256": "a9ea6949645b1c8f7a7b442e727454c0b36c603ab535fcda3ed50ec308396938",
            "width": 520,
            "height": 682,
        },
    }
    assert config["outputDimensions"] == {
        name: list(size) for name, size in EXPECTED_DIMENSIONS.items()
    }


def test_alle_crops_er_inden_for_den_sha_pinnede_kilde() -> None:
    config = _config()
    assert _sha256(SOURCE_PATH) == SOURCE_SHA256
    with Image.open(SOURCE_PATH) as source:
        assert source.size == (1586, 992)

    for asset_id, spec in config["assets"].items():
        x0, y0, x1, y1 = spec["crop"]
        assert 0 <= x0 < x1 <= 1586, asset_id
        assert 0 <= y0 < y1 <= 992, asset_id


def test_build_er_byteidentisk_og_manifestet_har_proveniens(tmp_path: Path) -> None:
    first_dir, first_manifest = _built(tmp_path, "first")
    second_dir, second_manifest = _built(tmp_path, "second")

    first = {path.name: path.read_bytes() for path in first_dir.glob("*.webp")}
    second = {path.name: path.read_bytes() for path in second_dir.glob("*.webp")}
    assert first == second
    assert first_manifest == second_manifest
    assert first_manifest["source"]["sha256"] == SOURCE_SHA256
    assert first_manifest["algorithm"] == "title-materials-v2"
    assert set(first_manifest["assets"]) == set(EXPECTED_DIMENSIONS)
    for name, entry in first_manifest["assets"].items():
        assert entry["sha256"] == hashlib.sha256(first[name]).hexdigest()
        assert entry["nativeWidth"] == EXPECTED_DIMENSIONS[name][0]
        assert entry["nativeHeight"] == EXPECTED_DIMENSIONS[name][1]
        assert entry["sourcePath"] == config_source_path()
        assert entry["display"]["maxPhysicalScale"] == 1


def config_source_path() -> str:
    return "docs/design/reference/title-2026-08-11.webp"


def test_outputdimensioner_og_rgba_er_pinnede(tmp_path: Path) -> None:
    output_dir, _ = _built(tmp_path, "dimensions")
    assert {path.name for path in output_dir.glob("*.webp")} == set(EXPECTED_DIMENSIONS)

    for name, expected in EXPECTED_DIMENSIONS.items():
        with Image.open(output_dir / name) as image:
            assert image.size == expected, name
            assert image.convert("RGBA").getextrema()[3] != (255, 255), (
                f"{name}: alpha skal være en reel del af materialekontrakten"
            )


def _max_transition_depth(alpha: np.ndarray) -> float:
    semi = (alpha > 0) & (alpha < 255)
    if not semi.any():
        return 0.0
    foreground = alpha > 0
    depth = ndimage.distance_transform_edt(foreground)
    return float(depth[semi].max())


def test_rgba_kanter_bestaar_kildematte_mod_sort_hvid_og_pergament(
    tmp_path: Path,
) -> None:
    output_dir, _ = _built(tmp_path, "alpha")
    config = _config()
    source = np.asarray(Image.open(SOURCE_PATH).convert("RGB"))
    expected_raw, metadata = builder.build_asset_images(source, config)
    expected = builder.codec_reference_images(expected_raw, metadata)

    for path in sorted(output_dir.glob("*.webp")):
        rgba = np.asarray(Image.open(path).convert("RGBA"))
        assert _max_transition_depth(rgba[..., 3]) <= 1.0, path.name
        result = builder.measure_matte_contamination(
            Image.fromarray(rgba),
            expected[path.name],
            config["matting"],
        )
        assert result["maxFringePixels"] <= 1.0, path.name
        assert result["opaqueContaminatedEdgePixels"] == 0, path.name
        assert result["maxCompositeDeltaE"] <= 8.0, path.name


def test_opaque_matteforurening_paa_kanten_afvises() -> None:
    config = _config()
    source = np.asarray(Image.open(SOURCE_PATH).convert("RGB"))
    expected_raw, metadata = builder.build_asset_images(source, config)
    expected = builder.codec_reference_images(expected_raw, metadata)
    clean = np.asarray(expected["wordmark-desktop.webp"].convert("RGBA")).copy()
    alpha = clean[..., 3]
    boundary = (alpha >= 250) & ~ndimage.binary_erosion(alpha > 0, np.ones((3, 3)))
    candidates = np.argwhere(boundary)
    luma = clean[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
    y, x = candidates[np.argmin(luma[boundary])]
    clean[y, x, :3] = config["matting"]["parchmentRgb"]
    with pytest.raises(ValueError, match="matteforurening"):
        builder.validate_matte_contamination(
            Image.fromarray(clean),
            expected["wordmark-desktop.webp"],
            config["matting"],
            "wordmark-desktop.webp",
        )


def test_wordmark_rammes_maalets_synlige_occupancy_ved_native_placering(
    tmp_path: Path,
) -> None:
    output_dir, manifest = _built(tmp_path, "occupancy")
    placement = manifest["nativePlacement"]["wordmark"]
    assert placement == {
        "viewportWidth": 1586,
        "viewportHeight": 992,
        "left": 150,
        "top": 130,
        "width": 545,
        "height": 320,
        "minOccupancyPercent": 26.5,
        "maxOccupancyPercent": 28.5,
    }

    metrics = builder.measure_wordmark_silhouette(
        Image.open(output_dir / "wordmark-desktop.webp").convert("RGBA"),
        placement,
        _config()["occupancyGrouping"],
    )
    occupancy = metrics["occupancyPercent"]

    assert 26.5 <= occupancy <= 28.5
    assert abs(occupancy - manifest["measurements"]["titleInkOccupancyPercent"]) < 1e-9
    assert metrics["dominantInkPixels"] >= 10_000
    assert metrics["dominantInkDensity"] >= 0.25
    assert manifest["measurements"]["wordmarkDominantSilhouette"] == metrics


def test_sparse_extrema_kan_ikke_falsk_bestaa_wordmark_occupancy() -> None:
    sparse = np.zeros((320, 545, 4), dtype=np.uint8)
    sparse[120:123, 40:43] = (40, 25, 15, 255)
    sparse[120:123, 475:478] = (40, 25, 15, 255)
    placement = _config()["nativePlacement"]["wordmark"]
    metrics = builder.measure_wordmark_silhouette(
        Image.fromarray(sparse),
        placement,
        _config()["occupancyGrouping"],
    )
    assert metrics["dominantInkPixels"] == 9
    assert metrics["occupancyPercent"] < 1


def _seam_ratio(image: Image.Image, seams: list[int]) -> float:
    rgba = np.asarray(image.convert("RGBA")).astype(np.float64)
    alpha = rgba[..., 3:4] / 255.0
    parchment = np.asarray((229, 207, 185), dtype=np.float64)
    composite = rgba[..., :3] * alpha + parchment * (1 - alpha)
    adjacent = np.mean(np.abs(np.diff(composite, axis=1)), axis=(0, 2))
    excluded = np.ones(adjacent.shape, dtype=bool)
    for seam in seams:
        excluded[max(0, seam - 3) : min(adjacent.size, seam + 2)] = False
    normal = max(float(np.percentile(adjacent[excluded], 75)), 0.25)
    return max(float(adjacent[seam - 1] / normal) for seam in seams)


def test_slices_har_brede_seamfri_stretchcentre_ved_3x(tmp_path: Path) -> None:
    output_dir, manifest = _built(tmp_path, "slices")
    config = _config()
    for asset_id in ("ribbon", "begin", "fates"):
        spec = config["assets"][asset_id]
        assert spec["centerPolicy"] == "stretch"
        assert spec["slices"][1] >= 96
        expanded = builder.render_three_slice(
            [Image.open(output_dir / name).convert("RGBA") for name in spec["outputs"]],
            center_width=spec["slices"][1] * 3,
            policy=spec["centerPolicy"],
        )
        seams = [spec["slices"][0], spec["slices"][0] + spec["slices"][1] * 3]
        ratio = _seam_ratio(expanded, seams)
        assert ratio <= spec["maxSeamRatio"], asset_id
        assert abs(ratio - manifest["slices"][asset_id]["expanded3xSeamRatio"]) < 1e-9


def test_9slice_policy_og_min_native_max_expansioner_bestaar(tmp_path: Path) -> None:
    output_dir, manifest = _built(tmp_path, "nine-slice")
    config = _config()
    for asset_id in ("welcomeFrame", "toolFrame", "tipCardFrame"):
        spec = config["assets"][asset_id]
        policy = spec["nineSlicePolicy"]
        assert policy["regions"] == {
            "corners": {},
            "topEdge": {"x": "stretch"},
            "bottomEdge": {"x": "stretch"},
            "leftEdge": {"y": "stretch"},
            "rightEdge": {"y": "stretch"},
            "center": {"x": "stretch", "y": "stretch"},
        }
        source = Image.open(output_dir / spec["output"]).convert("RGBA")
        evidence = {}
        for size_id, size in spec["expansionSizes"].items():
            expanded = builder.render_nine_slice(
                source,
                spec["insets"],
                tuple(size),
                policy,
            )
            quality = builder.measure_nine_slice_quality(
                source,
                expanded,
                spec["insets"],
            )
            assert quality["maxSeamRatio"] <= spec["maxSeamRatio"], (asset_id, size_id)
            assert quality["maxEdgeDistortion"] <= spec["maxEdgeDistortion"], (
                asset_id,
                size_id,
            )
            assert quality["cornersExact"] is True
            evidence[size_id] = quality
        assert manifest["nineSliceEvidence"][asset_id] == evidence


def test_synlig_daekning_komponenter_og_blaek_er_meningsfulde(
    tmp_path: Path,
) -> None:
    output_dir, manifest = _built(tmp_path, "coverage")
    config = _config()
    for name, entry in manifest["assets"].items():
        metrics = builder.measure_visible_coverage(
            Image.open(output_dir / name).convert("RGBA"),
            entry["assetClass"],
            config,
        )
        assert entry["coverage"] == metrics
        assert entry["maxTransitionPixels"] <= 1.0
        builder.validate_visible_coverage(
            metrics,
            entry["assetClass"],
            config,
            name,
        )

    tiny = np.zeros((100, 100, 4), dtype=np.uint8)
    tiny[49:51, 49:51] = (0, 0, 0, 255)
    with pytest.raises(ValueError, match="synlig dækning"):
        metrics = builder.measure_visible_coverage(
            Image.fromarray(tiny),
            "ornament",
            config,
        )
        builder.validate_visible_coverage(
            metrics,
            "ornament",
            config,
            "tiny.webp",
        )

    flat = np.full((100, 100, 4), (120, 80, 40, 255), dtype=np.uint8)
    with pytest.raises(ValueError, match="synlig dækning"):
        metrics = builder.measure_visible_coverage(
            Image.fromarray(flat),
            "material",
            config,
        )
        builder.validate_visible_coverage(
            metrics,
            "material",
            config,
            "flat.webp",
        )


def test_kritiske_materialer_holder_desktop_og_mobilbudget(tmp_path: Path) -> None:
    _, manifest = _built(tmp_path, "budgets")
    assert manifest["bundles"]["desktop"]["bytes"] <= 180_000
    assert manifest["bundles"]["mobile-390"]["bytes"] <= 120_000
    assert manifest["bundles"]["mobile-430"]["bytes"] <= 120_000
    assert "wordmark-desktop.webp" in manifest["bundles"]["desktop"]["files"]
    assert "wordmark-mobile.webp" not in manifest["bundles"]["desktop"]["files"]
    for viewport in ("mobile-390", "mobile-430"):
        assert "wordmark-mobile.webp" in manifest["bundles"][viewport]["files"]
        assert "wordmark-desktop.webp" not in manifest["bundles"][viewport]["files"]
        assert "welcome-frame.webp" not in manifest["bundles"][viewport]["files"]
        assert "welcome-figure.webp" not in manifest["bundles"][viewport]["files"]
        parchment = manifest["bundles"][viewport]["parchment"]
        assert parchment["bytes"] > 0
        assert manifest["bundles"][viewport]["bytes"] == (
            manifest["bundles"][viewport]["materialBytes"] + parchment["bytes"]
        )
    assert manifest["bundles"]["desktop"]["bytes"] == (
        manifest["bundles"]["desktop"]["materialBytes"]
        + manifest["bundles"]["desktop"]["parchment"]["bytes"]
    )


def test_manglende_pergament_afviser_payloadmanifest(
    tmp_path: Path,
) -> None:
    config = _config()
    config["parchmentDependencies"]["desktop"]["path"] = (
        "src/assets/art/missing-title-parchment.webp"
    )
    config_path = tmp_path / "missing-parchment.json"
    config_path.write_text(json.dumps(config))
    with pytest.raises(subprocess.CalledProcessError):
        subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--config",
                str(config_path),
                "--output-dir",
                str(tmp_path / "assets"),
                "--manifest",
                str(tmp_path / "manifest.json"),
                "--check",
            ],
            cwd=ROOT,
            check=True,
        )


def _snapshot_pair(assets: Path, manifest: Path) -> tuple[dict[str, bytes], bytes]:
    return (
        {
            path.relative_to(assets).as_posix(): path.read_bytes()
            for path in sorted(assets.rglob("*"))
            if path.is_file()
        },
        manifest.read_bytes(),
    )


@pytest.mark.parametrize("boundary", [1, 2, 3, 4])
def test_publish_transaction_ruller_tilbage_ved_hver_renamegraense(
    tmp_path: Path,
    boundary: int,
) -> None:
    target_assets = tmp_path / "assets"
    target_assets.mkdir()
    (target_assets / "old.webp").write_bytes(b"old-asset")
    target_manifest = tmp_path / "manifest.json"
    target_manifest.write_bytes(b"old-manifest")
    before = _snapshot_pair(target_assets, target_manifest)

    staged_assets = tmp_path / "staged-assets"
    staged_assets.mkdir()
    (staged_assets / "new.webp").write_bytes(b"new-asset")
    staged_manifest = tmp_path / "staged-manifest.json"
    staged_manifest.write_bytes(b"new-manifest")

    with pytest.raises(RuntimeError, match=f"rename {boundary}"):
        builder.publish_transaction(
            staged_assets,
            staged_manifest,
            target_assets,
            target_manifest,
            inject_failure_after=boundary,
        )

    assert _snapshot_pair(target_assets, target_manifest) == before
    assert not target_assets.with_name(".assets.previous").exists()
    assert not target_manifest.with_name(".manifest.json.previous").exists()


def test_manifestet_failer_lukket_for_ikke_observerbare_pixels(tmp_path: Path) -> None:
    _, manifest = _built(tmp_path, "blocked")
    blocked = {item["id"]: item["reason"] for item in manifest["blocked"]}
    assert set(blocked) == {
        "button-hover-state",
        "button-pressed-state",
        "sound-icon",
        "higher-resolution-detail",
    }
    assert all(blocked.values())
    assert set(manifest["reconstructedRegions"]) == {
        "ribbon-text-bed",
        "begin-icon-and-label-bed",
        "fates-icon-and-label-bed",
        "welcome-copy-bed",
        "tool-icon-bed",
        "tip-copy-and-pagination-bed",
    }
