"""TASK-009..011: kontrakt for titelens sourceafledte materialer."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT / "tools/art/title-materials.config.json"
SCRIPT_PATH = ROOT / "tools/art/build_title_materials.py"
SOURCE_PATH = ROOT / "docs/design/reference/title-2026-08-11.webp"
SOURCE_SHA256 = "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850"

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

    assert config["version"] == 1
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
    assert first_manifest["algorithm"] == "title-materials-v1"
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


def _max_composite_fringe(
    rgba: np.ndarray,
    background: tuple[int, int, int],
) -> float:
    rgb = rgba[..., :3].astype(np.float64)
    alpha = rgba[..., 3].astype(np.float64) / 255.0
    foreground = alpha > 0
    opaque = alpha >= (250 / 255)
    if not opaque.any():
        raise AssertionError("aktiv uden dækkende kerne")

    _, indices = ndimage.distance_transform_edt(~opaque, return_indices=True)
    nearest = rgb[indices[0], indices[1]]
    bg = np.asarray(background, dtype=np.float64)
    composite = rgb * alpha[..., None] + bg * (1 - alpha[..., None])
    expected = nearest * alpha[..., None] + bg * (1 - alpha[..., None])
    fringe = (np.linalg.norm(composite - expected, axis=2) > 28) & foreground
    if not fringe.any():
        return 0.0
    depth = ndimage.distance_transform_edt(foreground)
    return float(depth[fringe].max())


def test_rgba_kanter_bestaar_sort_hvid_og_pergament(tmp_path: Path) -> None:
    output_dir, _ = _built(tmp_path, "alpha")
    backgrounds = [(0, 0, 0), (255, 255, 255), (229, 207, 185)]

    for path in sorted(output_dir.glob("*.webp")):
        rgba = np.asarray(Image.open(path).convert("RGBA"))
        assert _max_transition_depth(rgba[..., 3]) <= 1.0, path.name
        for background in backgrounds:
            assert _max_composite_fringe(rgba, background) <= 1.0, (
                path.name,
                background,
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

    canvas = np.full((992, 1586, 3), (229, 207, 185), dtype=np.float64)
    rgba = np.asarray(Image.open(output_dir / "wordmark-desktop.webp").convert("RGBA"))
    alpha = rgba[..., 3:4].astype(np.float64) / 255.0
    x, y = placement["left"], placement["top"]
    canvas[y : y + 320, x : x + 545] = (
        rgba[..., :3] * alpha
        + canvas[y : y + 320, x : x + 545] * (1 - alpha)
    )
    luma = canvas @ np.array([0.2126, 0.7152, 0.0722])
    roi = luma[round(0.10 * 992) : round(0.46 * 992), round(0.08 * 1586) : round(0.45 * 1586)]
    labels, count = ndimage.label(roi < 100, np.ones((3, 3)))
    sizes = ndimage.sum(roi < 100, labels, range(1, count + 1))
    keep = np.zeros(count + 1, dtype=bool)
    keep[1:] = sizes >= 20
    ys, xs = np.where(keep[labels])
    occupancy = 100 * (xs.max() - xs.min() + 1) / 1586

    assert 26.5 <= occupancy <= 28.5
    assert abs(occupancy - manifest["measurements"]["titleInkOccupancyPercent"]) < 1e-9


def test_slices_har_brede_ikke_periodiske_centerstrips(tmp_path: Path) -> None:
    output_dir, manifest = _built(tmp_path, "slices")
    assert manifest["slices"]["ribbon"]["centerWidth"] == 380
    assert manifest["slices"]["begin"]["centerWidth"] == 168
    assert manifest["slices"]["fates"]["centerWidth"] == 118
    assert manifest["slices"]["welcomeFrame"]["insets"] == [18, 24, 18, 24]
    assert manifest["slices"]["toolFrame"]["insets"] == [16, 16, 16, 16]
    assert manifest["slices"]["tipCardFrame"]["insets"] == [24, 28, 24, 28]

    for name in ("ribbon-center.webp", "begin-center.webp", "fates-center.webp"):
        rgb = np.asarray(Image.open(output_dir / name).convert("RGB"))
        assert rgb.shape[1] >= 96, name
        for forbidden_period in (12, 28):
            if rgb.shape[1] > forbidden_period:
                same = np.mean(rgb[:, forbidden_period:] == rgb[:, :-forbidden_period])
                assert same < 0.98, f"{name}: gentager {forbidden_period}px-strip"


def test_kritiske_materialer_holder_desktop_og_mobilbudget(tmp_path: Path) -> None:
    _, manifest = _built(tmp_path, "budgets")
    assert manifest["bundles"]["desktop"]["bytes"] <= 180_000
    assert manifest["bundles"]["mobile"]["bytes"] <= 120_000
    assert "wordmark-desktop.webp" in manifest["bundles"]["desktop"]["files"]
    assert "wordmark-mobile.webp" not in manifest["bundles"]["desktop"]["files"]
    assert "wordmark-mobile.webp" in manifest["bundles"]["mobile"]["files"]
    assert "wordmark-desktop.webp" not in manifest["bundles"]["mobile"]["files"]
    assert "welcome-frame.webp" not in manifest["bundles"]["mobile"]["files"]
    assert "welcome-figure.webp" not in manifest["bundles"]["mobile"]["files"]


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
