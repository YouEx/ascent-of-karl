#!/usr/bin/env python3
"""Builds the responsive title-screen image layers from committed local art."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

import build_title_scene_masters

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("title-runtime-layers.config.json")
DEFAULT_OUTPUT = ROOT / "src/assets/art/title-layers"
DEFAULT_MANIFEST = Path(__file__).with_name("title-runtime-layers.manifest.json")
LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def load_config(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("version") != 1:
        raise ValueError("ukendt title-runtime-layers configversion")
    for source in value["sources"].values():
        source_path = ROOT / source["path"]
        if not source_path.is_file():
            raise ValueError(f"kilden mangler: {source['path']}")
        if sha256(source_path) != source["sha256"]:
            raise ValueError(f"source-SHA afviger: {source['path']}")
    return value


def smoothstep(values: np.ndarray) -> np.ndarray:
    return values * values * (3.0 - 2.0 * values)


def edge_ramp(length: int, fade: int, *, reverse: bool = False) -> np.ndarray:
    if fade <= 0:
        return np.ones(length, dtype=np.float32)
    values = np.clip(np.arange(length, dtype=np.float32) / float(fade), 0, 1)
    values = smoothstep(values)
    return values[::-1] if reverse else values


def reconstruct_scene(config: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    reference = np.asarray(
        Image.open(ROOT / config["sources"]["titleReference"]["path"]).convert("RGB")
    )
    x0, y0, x1, y1 = config["sources"]["titleReference"]["sceneCrop"]
    scene = reference[y0:y1, x0:x1]
    return reference, build_title_scene_masters.reconstruct_tools(scene, config)


def desktop_scene(scene: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    height, width = scene.shape[:2]
    alpha = np.ones((height, width), dtype=np.float32)
    alpha *= edge_ramp(width, int(config["scene"]["desktopLeftFade"]))[None, :]
    return np.dstack([scene, np.rint(alpha * 255).astype(np.uint8)])


def mobile_scene(scene: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    height, width = scene.shape[:2]
    fades = config["scene"]["mobileFades"]
    alpha = np.ones((height, width), dtype=np.float32)
    alpha *= edge_ramp(width, int(fades["left"]))[None, :]
    alpha *= edge_ramp(width, int(fades["right"]), reverse=True)[None, :]
    alpha *= edge_ramp(height, int(fades["top"]))[:, None]
    alpha *= edge_ramp(height, int(fades["bottom"]), reverse=True)[:, None]
    return np.dstack([scene, np.rint(alpha * 255).astype(np.uint8)])


def large_scene(scene: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    height, width = scene.shape[:2]
    alpha = np.tile(
        edge_ramp(width, int(config["scene"]["largeLeftFade"]))[None, :],
        (height, 1),
    )
    rgba = np.dstack([scene, np.rint(alpha * 255).astype(np.uint8)])
    return rgba


def foreground(scene: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    spec = config["foreground"]
    height, width = scene.shape[:2]
    yy, xx = np.mgrid[:height, :width]
    luma = scene.astype(np.float32) @ LUMA_WEIGHTS
    mask = (
        ((yy >= int(spec["bottomStart"])) & (luma <= float(spec["bottomLumaMax"])))
        | ((xx >= int(spec["rightStart"])) & (luma <= float(spec["rightLumaMax"])))
    ).astype(np.float32)
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        np.ones((9, 9), dtype=np.uint8),
    )
    mask = cv2.GaussianBlur(mask, (0, 0), float(spec["blurSigma"]))
    mask = np.clip(mask, 0, 1)
    alpha = np.rint(mask * 255).astype(np.uint8)
    rgb = scene.copy()
    rgb[alpha == 0] = 0
    return np.dstack([rgb, alpha])


def parchment(config: dict[str, Any]) -> np.ndarray:
    source = np.asarray(
        Image.open(ROOT / config["sources"]["parchmentPrior"]["path"]).convert("RGBA")
    )
    start = int(config["parchment"]["fadeStart"])
    end = int(config["parchment"]["transparentAfter"])
    fade = np.ones(source.shape[0], dtype=np.float32)
    transition = np.linspace(1, 0, end - start, dtype=np.float32)
    fade[start:end] = smoothstep(transition)
    fade[end:] = 0
    alpha = np.rint(source[..., 3].astype(np.float32) * fade[:, None]).astype(np.uint8)
    rgb = source[..., :3].copy()
    rgb[alpha == 0] = 0
    return np.dstack([rgb, alpha])


def backdrop(
    config: dict[str, Any],
    crop_key: str,
    dimensions: list[int],
) -> np.ndarray:
    source = np.asarray(
        Image.open(ROOT / config["sources"]["landscapeDonor"]["path"]).convert("RGB")
    )
    x0, y0, x1, y1 = config["backdrop"][crop_key]
    crop = source[y0:y1, x0:x1]
    width, height = (int(value) for value in dimensions)
    return cv2.resize(crop, (width, height), interpolation=cv2.INTER_LANCZOS4)


def wordmark(config: dict[str, Any], dimensions: list[int]) -> np.ndarray:
    source = np.asarray(
        Image.open(ROOT / config["sources"]["wordmarkPrior"]["path"]).convert("RGBA")
    )
    result = resize_rgba(source, dimensions)
    result[result[..., 3] < 8, :3] = 0
    result[result[..., 3] < 8, 3] = 0
    return result


def resize_rgba(image: np.ndarray, dimensions: list[int]) -> np.ndarray:
    width, height = (int(value) for value in dimensions)
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_LANCZOS4)


def apply_alpha_envelope(image: np.ndarray, envelope: np.ndarray) -> np.ndarray:
    result = image.copy()
    alpha = np.rint(
        result[..., 3].astype(np.float32)
        * envelope[..., 3].astype(np.float32)
        / 255.0
    ).astype(np.uint8)
    alpha[alpha < 8] = 0
    result[..., 3] = alpha
    result[alpha == 0, :3] = 0
    return result


def sparsify_alpha(image: np.ndarray, minimum: int) -> np.ndarray:
    result = image.copy()
    result[result[..., 3] < minimum, 3] = 0
    result[result[..., 3] == 0, :3] = 0
    return result


def mobile_foreground(
    image: np.ndarray,
    config: dict[str, Any],
) -> np.ndarray:
    dimensions = config["outputs"]["foreground-mobile"]["dimensions"]
    result = resize_rgba(image, dimensions)
    cut_x = round(
        int(config["foreground"]["rightStart"])
        * result.shape[1]
        / 896
    )
    cut_y = round(
        int(config["foreground"]["bottomStart"])
        * result.shape[0]
        / 992
    )
    result[cut_y:, :cut_x] = 0
    return sparsify_alpha(
        result,
        int(config["foreground"]["mobileAlphaMin"]),
    )


def save_webp(path: Path, rgba: np.ndarray, spec: dict[str, Any]) -> None:
    image = Image.fromarray(rgba)
    options: dict[str, Any] = {"method": 6, "exact": True}
    if spec.get("lossless"):
        options["lossless"] = True
    else:
        options["quality"] = int(spec["quality"])
    image.save(path, "WEBP", **options)


def build_assets(config: dict[str, Any]) -> dict[str, np.ndarray]:
    _, scene = reconstruct_scene(config)
    desktop = desktop_scene(scene, config)
    mobile = mobile_scene(scene, config)
    front = foreground(scene, config)
    large_envelope = large_scene(scene, config)
    scene_large = resize_rgba(
        large_envelope,
        config["outputs"]["scene-large"]["dimensions"],
    )
    return {
        "backdrop-mobile": backdrop(
            config,
            "mobileCrop",
            config["outputs"]["backdrop-mobile"]["dimensions"],
        ),
        "backdrop-large": backdrop(
            config,
            "largeCrop",
            config["outputs"]["backdrop-large"]["dimensions"],
        ),
        "scene-desktop": desktop,
        "scene-mobile": resize_rgba(
            mobile,
            config["outputs"]["scene-mobile"]["dimensions"],
        ),
        "scene-large": scene_large,
        "foreground": front,
        "foreground-mobile": mobile_foreground(
            apply_alpha_envelope(front, mobile),
            config,
        ),
        "foreground-large": resize_rgba(
            apply_alpha_envelope(front, large_envelope),
            config["outputs"]["foreground-large"]["dimensions"],
        ),
        "parchment": parchment(config),
        "parchment-large": resize_rgba(
            parchment(config),
            config["outputs"]["parchment-large"]["dimensions"],
        ),
        "wordmark-large": wordmark(
            config,
            config["outputs"]["wordmark-large"]["dimensions"],
        ),
    }


def publish_build(
    staged: Path,
    output_dir: Path,
    staged_manifest: Path,
    manifest_path: Path,
) -> None:
    backup = output_dir.with_name(f".{output_dir.name}-backup")
    previous_manifest = (
        manifest_path.read_bytes()
        if manifest_path.exists()
        else None
    )
    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists():
        os.replace(output_dir, backup)
    try:
        os.replace(staged, output_dir)
        os.replace(staged_manifest, manifest_path)
    except Exception:
        if output_dir.exists():
            shutil.rmtree(output_dir)
        if backup.exists():
            os.replace(backup, output_dir)
        if previous_manifest is None:
            manifest_path.unlink(missing_ok=True)
        else:
            manifest_path.write_bytes(previous_manifest)
        raise
    finally:
        if backup.exists():
            shutil.rmtree(backup)


def write_build(
    output_dir: Path,
    manifest_path: Path,
    config_path: Path = DEFAULT_CONFIG,
) -> dict[str, Any]:
    config = load_config(config_path)
    assets = build_assets(config)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        dir=output_dir.parent,
        prefix=f".{output_dir.name}-",
    ) as temporary:
        temporary_root = Path(temporary)
        staged = temporary_root / "assets"
        staged.mkdir()
        outputs: dict[str, Any] = {}
        for output_id, spec in config["outputs"].items():
            rgba = assets[output_id]
            expected = tuple(int(value) for value in spec["dimensions"])
            if (rgba.shape[1], rgba.shape[0]) != expected:
                raise ValueError(f"{output_id}: forkert dimension")
            path = staged / spec["file"]
            save_webp(path, rgba, spec)
            size = path.stat().st_size
            if size > int(spec["byteBudget"]):
                raise ValueError(
                    f"{output_id}: {size} bytes overstiger {spec['byteBudget']}"
                )
            outputs[output_id] = {
                "file": spec["file"],
                "dimensions": list(expected),
                "mode": "RGBA" if rgba.shape[2] == 4 else "RGB",
                "bytes": size,
                "byteBudget": int(spec["byteBudget"]),
                "sha256": sha256(path),
            }

        manifest = {
            "version": 1,
            "algorithm": config["algorithm"],
            "configSha256": sha256(config_path),
            "sources": config["sources"],
            "outputs": outputs,
        }
        staged_manifest = temporary_root / "manifest.json"
        staged_manifest.write_text(canonical_json(manifest), encoding="utf-8")
        publish_build(staged, output_dir, staged_manifest, manifest_path)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    args = parser.parse_args()

    manifest = write_build(
        Path(args.output_dir).resolve(),
        Path(args.manifest).resolve(),
        Path(args.config).resolve(),
    )
    print(
        f"byggede {len(manifest['outputs'])} titellag → "
        f"{Path(args.output_dir).resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
