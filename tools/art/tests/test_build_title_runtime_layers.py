"""Kontrakt for titelens responsive runtime-lag."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/art/build_title_runtime_layers.py"
CONFIG = ROOT / "tools/art/title-runtime-layers.config.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_builder():
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("title_runtime_layers", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_builder(tmp_path: Path, name: str) -> tuple[Path, dict]:
    output = tmp_path / name / "assets"
    manifest = tmp_path / name / "manifest.json"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--output-dir",
            str(output),
            "--manifest",
            str(manifest),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return output, json.loads(manifest.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, dict]:
    return run_builder(tmp_path_factory.mktemp("title-runtime-layers"), "built")


def test_config_pinner_alle_runtimekilder() -> None:
    value = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert value["algorithm"] == "title-runtime-layers-v1"
    for source in value["sources"].values():
        path = ROOT / source["path"]
        assert path.is_file()
        assert source["sha256"] == sha256(path)


def test_byg_er_deterministisk_og_holder_dimensioner_og_budgetter(
    tmp_path: Path,
) -> None:
    first_dir, first = run_builder(tmp_path, "first")
    second_dir, second = run_builder(tmp_path, "second")

    assert first == second
    assert set(first["outputs"]) == {
        "backdrop-mobile",
        "backdrop-large",
        "scene-desktop",
        "scene-mobile",
        "scene-large",
        "foreground",
        "foreground-mobile",
        "foreground-large",
        "parchment",
        "parchment-large",
        "wordmark-large",
    }
    for output_id, item in first["outputs"].items():
        first_path = first_dir / item["file"]
        second_path = second_dir / item["file"]
        assert first_path.read_bytes() == second_path.read_bytes()
        assert item["sha256"] == sha256(first_path)
        assert item["bytes"] <= item["byteBudget"], output_id
        with Image.open(first_path) as image:
            assert list(image.size) == item["dimensions"]
            assert image.mode == item["mode"]


def test_karl_forbliver_kildetro_og_opaque(
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    reference = np.asarray(
        Image.open(ROOT / config["sources"]["titleReference"]["path"]).convert("RGB")
    )
    x, y, width, height = config["character"]["sceneRect"]
    expected = reference[y:y + height, 690 + x:690 + x + width]

    scene = np.asarray(
        Image.open(output / manifest["outputs"]["scene-desktop"]["file"]).convert("RGBA")
    )
    actual = scene[y:y + height, x:x + width]
    delta = np.abs(actual[..., :3].astype(np.int16) - expected.astype(np.int16))
    assert float(delta.mean()) <= 2.0
    assert float(np.quantile(delta, 0.99)) <= 10.0
    assert np.all(actual[..., 3] == 255)


def test_scene_og_forgrund_har_meningsfulde_alphaformer(
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    scene = np.asarray(
        Image.open(output / manifest["outputs"]["scene-desktop"]["file"]).convert("RGBA")
    )
    mobile = np.asarray(
        Image.open(output / manifest["outputs"]["scene-mobile"]["file"]).convert("RGBA")
    )
    foreground = np.asarray(
        Image.open(output / manifest["outputs"]["foreground"]["file"]).convert("RGBA")
    )
    large = np.asarray(
        Image.open(output / manifest["outputs"]["scene-large"]["file"]).convert("RGBA")
    )
    foreground_large = np.asarray(
        Image.open(output / manifest["outputs"]["foreground-large"]["file"]).convert("RGBA")
    )
    foreground_mobile = np.asarray(
        Image.open(output / manifest["outputs"]["foreground-mobile"]["file"]).convert("RGBA")
    )

    assert scene[:, 0, 3].max() == 0
    assert scene[:, 240, 3].min() == 255
    assert mobile[0, :, 3].max() == 0
    assert mobile[-1, :, 3].max() == 0
    coverage = np.mean(foreground[..., 3] > 0)
    assert 0.05 <= coverage <= 0.60
    assert np.unique(foreground[..., 3]).size > 16
    assert large[1800, 600, 3] < 160
    assert large[360, 378, 3] < 255
    assert large[1000, 1000, 3] > 240
    assert foreground_large[1400, 0, 3] < 8
    assert foreground_mobile[1300:, :1200, 3].max() < 8


def test_pergamentet_slutter_foer_tipkortet(
    built: tuple[Path, dict],
) -> None:
    output, manifest = built
    parchment = np.asarray(
        Image.open(output / manifest["outputs"]["parchment"]["file"]).convert("RGBA")
    )
    alpha = parchment[..., 3]

    assert np.mean(alpha[120:700] >= 250) > 0.70
    assert np.mean(alpha[780:] <= 5) > 0.92
    assert np.any((alpha > 0) & (alpha < 255))


def test_store_varianter_baerer_store_viewports(
    built: tuple[Path, dict],
) -> None:
    _, manifest = built
    assert manifest["outputs"]["scene-mobile"]["dimensions"] == [1792, 1984]
    assert manifest["outputs"]["foreground-mobile"]["dimensions"] == [1792, 1984]
    assert manifest["outputs"]["backdrop-mobile"]["dimensions"] == [896, 1984]
    assert manifest["outputs"]["backdrop-large"]["dimensions"] == [2560, 1440]
    assert manifest["outputs"]["parchment-large"]["dimensions"] == [1384, 1814]
    assert manifest["outputs"]["wordmark-large"]["dimensions"] == [1090, 640]


def test_publicering_ruller_assets_og_manifest_tilbage_sammen(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    builder = load_builder()
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "new.webp").write_bytes(b"new-asset")
    staged_manifest = tmp_path / "manifest.new"
    staged_manifest.write_bytes(b"new-manifest")

    output = tmp_path / "output"
    output.mkdir()
    (output / "old.webp").write_bytes(b"old-asset")
    manifest = tmp_path / "manifest.json"
    manifest.write_bytes(b"old-manifest")

    real_replace = builder.os.replace

    def fail_manifest(source, destination):
        if Path(destination) == manifest:
            raise OSError("simulated manifest failure")
        return real_replace(source, destination)

    monkeypatch.setattr(builder.os, "replace", fail_manifest)
    with pytest.raises(OSError, match="manifest failure"):
        builder.publish_build(staged, output, staged_manifest, manifest)

    assert (output / "old.webp").read_bytes() == b"old-asset"
    assert manifest.read_bytes() == b"old-manifest"
