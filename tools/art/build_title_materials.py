#!/usr/bin/env python3
"""Bygger Phase C's sourceafledte titelmaterialer deterministisk.

Kilden er den SHA-pinnede 1586×992-reference. Synligt pigment mattes mod en
lokalt estimeret blank flade og gemmes som decontamineret RGBA. Materiale bag
tekst og ikoner er ikke observerbart; de felter rekonstrueres kun fra samme
flades synlige rækkeprofiler og registreres eksplicit i manifestet.
"""
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
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("title-materials.config.json")
DEFAULT_OUTPUT = ROOT / "src/assets/art/title-materials"
DEFAULT_MANIFEST = Path(__file__).with_name("title-materials.manifest.json")
LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def crop_array(source: np.ndarray, box: list[int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return source[y0:y1, x0:x1].copy()


def lab_delta(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_lab = cv2.cvtColor(a.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    b_lab = cv2.cvtColor(b.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    return np.linalg.norm(a_lab - b_lab, axis=2)


def remove_small_components(mask: np.ndarray, minimum: int) -> np.ndarray:
    labels, count = ndimage.label(mask, np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    keep = np.zeros(count + 1, dtype=bool)
    keep[1:] = sizes >= minimum
    return keep[labels]


def close_single_pixel_holes(mask: np.ndarray) -> np.ndarray:
    holes = ndimage.binary_fill_holes(mask) & ~mask
    labels, count = ndimage.label(holes, np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = ndimage.sum(holes, labels, range(1, count + 1))
    one_pixel = np.zeros(count + 1, dtype=bool)
    one_pixel[1:] = sizes <= 1
    return mask | one_pixel[labels]


def clamp_alpha_transition(alpha: np.ndarray) -> np.ndarray:
    """Beholder kun delalpha på den yderste foreground-pixel."""
    out = alpha.copy()
    foreground = out > 0
    if not foreground.any():
        return out
    depth = ndimage.distance_transform_edt(foreground)
    semi_inside = (out > 0) & (out < 255) & (depth > 1)
    out[semi_inside] = 255
    out[~foreground] = 0
    return out


def alpha_from_difference(
    observed: np.ndarray,
    blank: np.ndarray,
    support: np.ndarray,
    matting: dict[str, Any],
) -> np.ndarray:
    delta = lab_delta(observed, blank)
    lo = float(matting["deltaETransparent"])
    hi = float(matting["deltaEOpaque"])
    alpha = np.clip((delta - lo) / (hi - lo), 0, 1)
    alpha[~support] = 0

    binary = remove_small_components(
        alpha > 0,
        int(matting["minComponentPixels"]),
    )
    binary = close_single_pixel_holes(binary)
    alpha[~binary] = 0
    alpha[(binary) & (alpha == 0)] = 1
    return clamp_alpha_transition(np.rint(alpha * 255).astype(np.uint8))


def recover_foreground(
    observed: np.ndarray,
    blank: np.ndarray,
    alpha: np.ndarray,
) -> np.ndarray:
    a = alpha.astype(np.float64) / 255.0
    observed_f = observed.astype(np.float64)
    blank_f = blank.astype(np.float64)
    safe = np.clip(a, 1 / 255, 1.0)[..., None]
    recovered = (observed_f - (1 - a[..., None]) * blank_f) / safe
    recovered = np.clip(recovered, 0, 255)
    recovered[a == 0] = 0
    return recovered.astype(np.uint8)


def rgba_image(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8))


def region_mask(shape: tuple[int, int], regions: list[list[int]]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for x0, y0, x1, y1 in regions:
        mask[y0:y1, x0:x1] = True
    return mask


def build_ink_matte(
    observed: np.ndarray,
    spec: dict[str, Any],
    matting: dict[str, Any],
) -> Image.Image:
    luma = observed.astype(np.float64) @ LUMA_WEIGHTS
    permitted = region_mask(luma.shape, spec["regions"])
    seed = permitted & (luma < float(spec["inkLumaMax"]))
    seed = remove_small_components(seed, int(matting["minComponentPixels"]))
    seed = close_single_pixel_holes(seed)
    support = ndimage.binary_dilation(seed, np.ones((3, 3)))
    inpaint_mask = ndimage.binary_dilation(
        seed,
        np.ones((3, 3)),
        iterations=2,
    ).astype(np.uint8) * 255
    blank = cv2.inpaint(
        observed,
        inpaint_mask,
        float(spec.get("inpaintRadius", 4)),
        cv2.INPAINT_TELEA,
    )
    alpha = alpha_from_difference(observed, blank, support, matting)
    rgb = recover_foreground(observed, blank, alpha)
    return rgba_image(rgb, alpha)


def shape_mask(size: tuple[int, int], spec: dict[str, Any]) -> np.ndarray:
    width, height = size
    shape = spec["shape"]
    canvas = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(canvas)
    if shape["type"] == "polygon":
        draw.polygon([tuple(point) for point in shape["points"]], fill=1)
    elif shape["type"] == "rounded-rect":
        left, top, right, bottom = shape["inset"]
        draw.rounded_rectangle(
            (left, top, width - 1 - right, height - 1 - bottom),
            radius=int(shape["radius"]),
            fill=1,
        )
    else:
        raise ValueError(f"ukendt shape-type: {shape['type']}")
    return np.asarray(canvas, dtype=bool)


def reconstruct_rows(
    observed: np.ndarray,
    rectangles: list[list[int]],
    material_mask: np.ndarray,
    seed: int,
) -> np.ndarray:
    """Fylder skjult copy deterministisk fra den omgivende materialeflade.

    Telea-inpaint bruges kun inde i de pinnede, ikke-observerbare felter.
    Derved bevares alle direkte observerbare pixels byte-for-byte før WebP-
    kodning, mens brede centerstrips undgår et synligt 12/28px gentagelsesmønster.
    """
    hidden = region_mask(material_mask.shape, rectangles)
    hidden &= material_mask
    if not hidden.any():
        return observed.copy()
    inpainted = cv2.inpaint(
        observed,
        hidden.astype(np.uint8) * 255,
        7,
        cv2.INPAINT_TELEA,
    ).astype(np.float64)
    donor = material_mask & ~hidden
    low = np.dstack(
        [
            ndimage.gaussian_filter(
                observed[..., channel].astype(np.float64),
                sigma=2.0,
                mode="nearest",
            )
            for channel in range(3)
        ]
    )
    residual = observed.astype(np.float64) - low
    quilt = quilt_texture(residual, donor, hidden, seed)
    texture_weight = np.clip(
        ndimage.distance_transform_edt(hidden) / 4.0,
        0,
        1,
    )[..., None]
    inpainted += quilt * texture_weight * 0.18
    weight = np.clip(ndimage.distance_transform_edt(hidden), 0, 1)[..., None]
    out = (
        inpainted * weight
        + observed.astype(np.float64) * (1 - weight)
    )
    return np.rint(out).astype(np.uint8)


def quilt_texture(
    residual: np.ndarray,
    donor_mask: np.ndarray,
    target_mask: np.ndarray,
    seed: int,
) -> np.ndarray:
    """Quilter overlappende high-pass-patches fra synligt materiale."""
    patch = 12
    stride = 6
    candidates: list[tuple[int, int]] = []
    height, width = donor_mask.shape
    for y in range(0, height - patch + 1, 2):
        for x in range(0, width - patch + 1, 2):
            if donor_mask[y : y + patch, x : x + patch].all():
                candidates.append((y, x))
    if not candidates:
        return np.zeros_like(residual)

    ys, xs = np.where(target_mask)
    y_min, y_max = int(ys.min()), int(ys.max()) + 1
    x_min, x_max = int(xs.min()), int(xs.max()) + 1
    window_1d = 0.25 + 0.75 * np.hanning(patch)
    window = np.outer(window_1d, window_1d)[..., None]
    total = np.zeros_like(residual)
    weights = np.zeros((*target_mask.shape, 1), dtype=np.float64)

    for dest_y in range(max(0, y_min - patch + stride), y_max, stride):
        for dest_x in range(max(0, x_min - patch + stride), x_max, stride):
            index = (
                dest_x * 73856093
                ^ dest_y * 19349663
                ^ seed
            ) % len(candidates)
            source_y, source_x = candidates[index]
            y1 = min(dest_y + patch, height)
            x1 = min(dest_x + patch, width)
            ph, pw = y1 - dest_y, x1 - dest_x
            total[dest_y:y1, dest_x:x1] += (
                residual[source_y : source_y + ph, source_x : source_x + pw]
                * window[:ph, :pw]
            )
            weights[dest_y:y1, dest_x:x1] += window[:ph, :pw]

    quilt = total / np.clip(weights, 1e-6, None)
    quilt[~target_mask] = 0
    return quilt


def build_shape_matte(
    observed: np.ndarray,
    spec: dict[str, Any],
    matting: dict[str, Any],
    seed: int,
) -> Image.Image:
    mask = shape_mask((observed.shape[1], observed.shape[0]), spec)
    cleaned = reconstruct_rows(
        observed,
        spec.get("reconstruct", []),
        mask,
        seed,
    )
    inpaint_mask = ndimage.binary_dilation(mask, np.ones((3, 3))).astype(np.uint8) * 255
    blank = cv2.inpaint(cleaned, inpaint_mask, 6, cv2.INPAINT_TELEA)
    alpha = alpha_from_difference(cleaned, blank, mask, matting)

    # Den manuelt sporede source-silhuets indre er selve materialet. Kun dens
    # yderste pixel må være deltransparent.
    depth = ndimage.distance_transform_edt(mask)
    alpha[depth > 1] = 255
    alpha[(mask) & (alpha == 0)] = 255
    alpha[~mask] = 0
    alpha = clamp_alpha_transition(alpha)
    rgb = recover_foreground(cleaned, blank, alpha)
    return rgba_image(rgb, alpha)


def resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size:
        return image
    rgba = np.asarray(image.convert("RGBA")).astype(np.float64)
    alpha = rgba[..., 3:4] / 255.0
    premultiplied = np.dstack([rgba[..., :3] * alpha, rgba[..., 3:4]])
    resized = np.asarray(
        Image.fromarray(np.rint(premultiplied).astype(np.uint8)).resize(
            size,
            Image.Resampling.LANCZOS,
        )
    ).astype(np.float64)
    out_alpha = resized[..., 3]
    safe = np.clip(out_alpha / 255.0, 1 / 255, 1.0)[..., None]
    out_rgb = np.clip(resized[..., :3] / safe, 0, 255)
    out_rgb[out_alpha == 0] = 0
    out_alpha = clamp_alpha_transition(np.rint(out_alpha).astype(np.uint8))
    return rgba_image(np.rint(out_rgb).astype(np.uint8), out_alpha)


def save_webp(image: Image.Image, path: Path, quality: int) -> None:
    image.save(
        path,
        "WEBP",
        quality=quality,
        method=6,
        exact=True,
    )


def split_surface(
    image: Image.Image,
    widths: list[int],
    names: list[str],
    output_dir: Path,
    quality: int,
) -> list[str]:
    if sum(widths) != image.width:
        raise ValueError(f"slicebredder {widths} matcher ikke {image.width}px")
    x = 0
    written: list[str] = []
    if len(widths) != len(names):
        raise ValueError("antal slicebredder og filnavne matcher ikke")
    for width, name in zip(widths, names):
        part = image.crop((x, 0, x + width, image.height))
        save_webp(part, output_dir / name, quality)
        written.append(name)
        x += width
    return written


def title_ink_occupancy(wordmark: Image.Image, placement: dict[str, Any]) -> float:
    viewport_w = int(placement["viewportWidth"])
    viewport_h = int(placement["viewportHeight"])
    canvas = np.full((viewport_h, viewport_w, 3), (229, 207, 185), dtype=np.float64)
    rgba = np.asarray(wordmark.convert("RGBA")).astype(np.float64)
    alpha = rgba[..., 3:4] / 255.0
    x, y = int(placement["left"]), int(placement["top"])
    h, w = rgba.shape[:2]
    canvas[y : y + h, x : x + w] = (
        rgba[..., :3] * alpha
        + canvas[y : y + h, x : x + w] * (1 - alpha)
    )
    luma = canvas @ LUMA_WEIGHTS
    roi = luma[
        round(0.10 * viewport_h) : round(0.46 * viewport_h),
        round(0.08 * viewport_w) : round(0.45 * viewport_w),
    ]
    labels, count = ndimage.label(roi < 100, np.ones((3, 3)))
    sizes = ndimage.sum(roi < 100, labels, range(1, count + 1))
    keep = np.zeros(count + 1, dtype=bool)
    keep[1:] = sizes >= 20
    ys, xs = np.where(keep[labels])
    if xs.size == 0:
        raise ValueError("wordmarken gav ingen målbar blækkomponent")
    return 100 * (xs.max() - xs.min() + 1) / viewport_w


def asset_manifest_entry(
    path: Path,
    provenance: str,
    source_path: str,
) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
    return {
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "nativeWidth": width,
        "nativeHeight": height,
        "sourcePath": source_path,
        "provenance": provenance,
        "display": {
            "maxPhysicalScale": 1,
            "maxCssWidthDpr1": width,
            "maxCssHeightDpr1": height,
            "maxCssWidthDpr2": width / 2,
            "maxCssHeightDpr2": height / 2,
        },
    }


def build_assets(
    source: np.ndarray,
    config: dict[str, Any],
    output_dir: Path,
) -> tuple[dict[str, str], Image.Image]:
    matting = config["matting"]
    provenance_by_file: dict[str, str] = {}
    desktop_wordmark: Image.Image | None = None

    for asset_index, (asset_id, spec) in enumerate(config["assets"].items()):
        observed = crop_array(source, spec["crop"])
        kind = spec["kind"]
        if kind == "ink-matte":
            image = build_ink_matte(observed, spec, matting)
        elif kind in {"shape-matte", "surface-3slice", "surface-9slice"}:
            image = build_shape_matte(
                observed,
                spec,
                matting,
                int(config["textureSeed"]) + asset_index,
            )
        else:
            raise ValueError(f"{asset_id}: ukendt kind {kind}")

        if kind == "surface-3slice":
            names = split_surface(
                image,
                spec["slices"],
                spec["outputs"],
                output_dir,
                int(spec["quality"]),
            )
            for name in names:
                provenance_by_file[name] = spec["provenance"]
            continue

        if "outputs" in spec:
            for output in spec["outputs"]:
                size = (int(output["width"]), int(output["height"]))
                rendered = resize_rgba(image, size)
                save_webp(
                    rendered,
                    output_dir / output["file"],
                    int(output["quality"]),
                )
                provenance_by_file[output["file"]] = spec["provenance"]
                if output["file"] == "wordmark-desktop.webp":
                    desktop_wordmark = rendered
            continue

        name = spec["output"]
        save_webp(image, output_dir / name, int(spec["quality"]))
        provenance_by_file[name] = spec["provenance"]

    if desktop_wordmark is None:
        raise ValueError("wordmark-desktop.webp blev ikke bygget")
    return provenance_by_file, desktop_wordmark


def validate_outputs(
    output_dir: Path,
    config: dict[str, Any],
    occupancy: float,
) -> None:
    expected = config["outputDimensions"]
    actual = {path.name for path in output_dir.glob("*.webp")}
    if actual != set(expected):
        raise ValueError(f"outputfiler afviger: {sorted(actual ^ set(expected))}")
    for name, dimensions in expected.items():
        with Image.open(output_dir / name) as image:
            if list(image.size) != dimensions:
                raise ValueError(f"{name}: {image.size} != {dimensions}")
            alpha = np.asarray(image.convert("RGBA"))[..., 3]
            if alpha.min() == 255:
                raise ValueError(f"{name}: mangler reel alpha")

    placement = config["nativePlacement"]["wordmark"]
    if not (
        float(placement["minOccupancyPercent"])
        <= occupancy
        <= float(placement["maxOccupancyPercent"])
    ):
        raise ValueError(f"wordmark occupancy {occupancy:.6f}% er uden for gate")


def create_manifest(
    output_dir: Path,
    config: dict[str, Any],
    config_path: Path,
    provenance_by_file: dict[str, str],
    occupancy: float,
) -> dict[str, Any]:
    source_path = config["source"]["path"]
    assets = {
        name: asset_manifest_entry(
            output_dir / name,
            provenance_by_file[name],
            source_path,
        )
        for name in sorted(config["outputDimensions"])
    }
    bundles: dict[str, Any] = {}
    for bundle_id, files in config["bundles"].items():
        bundles[bundle_id] = {
            "files": files,
            "bytes": sum(assets[name]["bytes"] for name in files),
        }

    manifest = {
        "version": 1,
        "algorithm": config["algorithm"],
        "configSha256": sha256(config_path),
        "source": config["source"],
        "assets": assets,
        "nativePlacement": config["nativePlacement"],
        "measurements": {
            "titleInkOccupancyPercent": occupancy,
        },
        "slices": {
            "ribbon": {"centerWidth": config["assets"]["ribbon"]["slices"][1]},
            "begin": {"centerWidth": config["assets"]["begin"]["slices"][1]},
            "fates": {"centerWidth": config["assets"]["fates"]["slices"][1]},
            "welcomeFrame": {"insets": config["assets"]["welcomeFrame"]["insets"]},
            "toolFrame": {"insets": config["assets"]["toolFrame"]["insets"]},
            "tipCardFrame": {"insets": config["assets"]["tipCardFrame"]["insets"]},
        },
        "bundles": bundles,
        "budgets": config["budgets"],
        "reconstructedRegions": config["reconstructedRegions"],
        "blocked": config["blocked"],
    }
    for bundle_id, budget_key in (
        ("desktop", "desktopCriticalBytes"),
        ("mobile", "mobileCriticalBytes"),
    ):
        if bundles[bundle_id]["bytes"] > config["budgets"][budget_key]:
            raise ValueError(
                f"{bundle_id}: {bundles[bundle_id]['bytes']} bytes > "
                f"{config['budgets'][budget_key]}"
            )
    return manifest


def atomic_replace_directory(staged: Path, target: Path) -> None:
    backup = target.with_name(f".{target.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if target.exists():
        os.replace(target, backup)
    try:
        os.replace(staged, target)
    except BaseException:
        if backup.exists() and not target.exists():
            os.replace(backup, target)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = args.config.resolve()
    config = load_config(config_path)
    source_path = ROOT / config["source"]["path"]
    if sha256(source_path) != config["source"]["sha256"]:
        raise SystemExit("titelkildens SHA-256 afviger fra config")

    source_image = Image.open(source_path).convert("RGB")
    if list(source_image.size) != [
        config["source"]["width"],
        config["source"]["height"],
    ]:
        raise SystemExit("titelkildens dimensioner afviger fra config")
    source = np.asarray(source_image)

    output_dir = args.output_dir.resolve()
    manifest_path = args.manifest.resolve()
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(
        tempfile.mkdtemp(
            prefix=f".{output_dir.name}.",
            dir=output_dir.parent,
        )
    )
    manifest_tmp: Path | None = None
    try:
        provenance, wordmark = build_assets(source, config, staged)
        occupancy = title_ink_occupancy(
            wordmark,
            config["nativePlacement"]["wordmark"],
        )
        validate_outputs(staged, config, occupancy)
        manifest = create_manifest(
            staged,
            config,
            config_path,
            provenance,
            occupancy,
        )
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{manifest_path.name}.",
            dir=manifest_path.parent,
        )
        os.close(descriptor)
        manifest_tmp = Path(temporary_name)
        manifest_tmp.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        )
        atomic_replace_directory(staged, output_dir)
        os.replace(manifest_tmp, manifest_path)
        manifest_tmp = None
    finally:
        if staged.exists():
            shutil.rmtree(staged)
        if manifest_tmp is not None and manifest_tmp.exists():
            manifest_tmp.unlink()

    if args.check:
        print(
            "title-materials: "
            f"{len(config['outputDimensions'])} assets, "
            f"occupancy {occupancy:.6f}%, "
            f"desktop {manifest['bundles']['desktop']['bytes']} B, "
            f"mobile {manifest['bundles']['mobile']['bytes']} B"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
