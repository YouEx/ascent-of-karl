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
import io
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


def save_webp(
    image: Image.Image,
    path: Path,
    quality: int,
    *,
    lossless: bool = False,
) -> None:
    image.save(
        path,
        "WEBP",
        quality=quality,
        method=6,
        exact=True,
        lossless=lossless,
    )


def match_center_edges(
    center: Image.Image,
    left: Image.Image,
    right: Image.Image,
    blend_pixels: int,
) -> Image.Image:
    """Matcher centerens ender til de synlige caps over en bred overgang."""
    rgba = np.asarray(center.convert("RGBA")).astype(np.float64)
    left_edge = np.asarray(left.convert("RGBA"))[:, -1].astype(np.float64)
    right_edge = np.asarray(right.convert("RGBA"))[:, 0].astype(np.float64)
    blend = min(blend_pixels, max(1, center.width // 3))
    for offset in range(blend):
        weight = ((blend - offset) / blend) ** 2
        rgba[:, offset] = rgba[:, offset] * (1 - weight) + left_edge * weight
        rgba[:, -(offset + 1)] = (
            rgba[:, -(offset + 1)] * (1 - weight)
            + right_edge * weight
        )
    return Image.fromarray(np.rint(np.clip(rgba, 0, 255)).astype(np.uint8))


def split_surface_images(
    image: Image.Image,
    widths: list[int],
    names: list[str],
) -> dict[str, Image.Image]:
    if sum(widths) != image.width:
        raise ValueError(f"slicebredder {widths} matcher ikke {image.width}px")
    if len(widths) != len(names):
        raise ValueError("antal slicebredder og filnavne matcher ikke")
    x = 0
    parts: dict[str, Image.Image] = {}
    for width, name in zip(widths, names):
        parts[name] = image.crop((x, 0, x + width, image.height))
        x += width
    return parts


def render_three_slice(
    parts: list[Image.Image],
    center_width: int,
    policy: str,
) -> Image.Image:
    left, center, right = [part.convert("RGBA") for part in parts]
    if policy == "stretch":
        rendered_center = resize_rgba(center, (center_width, center.height))
    elif policy in {"repeat", "round"}:
        rendered_center = tile_region(center, (center_width, center.height), policy)
    else:
        raise ValueError(f"ukendt 3-slice-policy: {policy}")
    output = Image.new(
        "RGBA",
        (left.width + rendered_center.width + right.width, left.height),
        (0, 0, 0, 0),
    )
    output.alpha_composite(left, (0, 0))
    output.alpha_composite(rendered_center, (left.width, 0))
    output.alpha_composite(right, (left.width + rendered_center.width, 0))
    return output


def tile_region(
    image: Image.Image,
    size: tuple[int, int],
    policy: str,
) -> Image.Image:
    source = image.convert("RGBA")
    width, height = size
    if policy == "stretch":
        return resize_rgba(source, size)
    if policy == "round":
        count_x = max(1, round(width / source.width))
        count_y = max(1, round(height / source.height))
        source = resize_rgba(
            source,
            (max(1, round(width / count_x)), max(1, round(height / count_y))),
        )
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    for y in range(0, height, source.height):
        for x in range(0, width, source.width):
            output.alpha_composite(source, (x, y))
    return output


def render_nine_slice(
    image: Image.Image,
    insets: list[int],
    size: tuple[int, int],
    policy: dict[str, Any],
) -> Image.Image:
    """Renderer 9-slice med faste hjørner og deklareret aksepolitik."""
    source = image.convert("RGBA")
    top, right, bottom, left = [int(value) for value in insets]
    width, height = size
    if width < left + right or height < top + bottom:
        raise ValueError("9-slice-output er mindre end de faste hjørner")

    sx = (0, left, source.width - right, source.width)
    sy = (0, top, source.height - bottom, source.height)
    dx = (0, left, width - right, width)
    dy = (0, top, height - bottom, height)
    regions = policy["regions"]
    output = Image.new("RGBA", size, (0, 0, 0, 0))

    for row in range(3):
        for col in range(3):
            crop = source.crop((sx[col], sy[row], sx[col + 1], sy[row + 1]))
            target_size = (dx[col + 1] - dx[col], dy[row + 1] - dy[row])
            if row in {0, 2} and col in {0, 2}:
                rendered = crop
            elif row == 0:
                rendered = tile_region(crop, target_size, regions["topEdge"]["x"])
            elif row == 2:
                rendered = tile_region(crop, target_size, regions["bottomEdge"]["x"])
            elif col == 0:
                rendered = tile_region(crop, target_size, regions["leftEdge"]["y"])
            elif col == 2:
                rendered = tile_region(crop, target_size, regions["rightEdge"]["y"])
            else:
                center_x = regions["center"]["x"]
                center_y = regions["center"]["y"]
                if center_x == center_y:
                    rendered = tile_region(crop, target_size, center_x)
                else:
                    rendered = tile_region(
                        tile_region(crop, (target_size[0], crop.height), center_x),
                        target_size,
                        center_y,
                    )
            output.paste(rendered, (dx[col], dy[row]))
    return output


def composite_rgb(image: Image.Image, background: tuple[int, int, int]) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA")).astype(np.float64)
    alpha = rgba[..., 3:4] / 255.0
    bg = np.asarray(background, dtype=np.float64)
    return rgba[..., :3] * alpha + bg * (1 - alpha)


def adjacent_variation(
    rgb: np.ndarray,
    axis: int,
) -> np.ndarray:
    return np.mean(np.abs(np.diff(rgb, axis=axis)), axis=tuple(
        dimension for dimension in range(3) if dimension != axis
    ))


def measured_seam_ratio(
    image: Image.Image,
    seams: list[int],
    axis: int,
) -> float:
    rgb = composite_rgb(image, (229, 207, 185))
    adjacent = adjacent_variation(rgb, axis)
    included = np.ones(adjacent.shape, dtype=bool)
    for seam in seams:
        included[max(0, seam - 3) : min(adjacent.size, seam + 2)] = False
    normal = max(float(np.percentile(adjacent[included], 75)), 0.25)
    return max(float(adjacent[seam - 1] / normal) for seam in seams)


def _edge_distortion(
    source: Image.Image,
    expanded: Image.Image,
    source_box: tuple[int, int, int, int],
    expanded_box: tuple[int, int, int, int],
) -> float:
    original = source.crop(source_box).convert("RGBA")
    rendered = expanded.crop(expanded_box).convert("RGBA")
    rendered = resize_rgba(rendered, original.size)
    original_rgb = composite_rgb(original, (229, 207, 185))
    rendered_rgb = composite_rgb(rendered, (229, 207, 185))
    scale = max(float(original_rgb.std()), 1.0)
    return float(np.mean(np.abs(original_rgb - rendered_rgb)) / scale)


def measure_nine_slice_quality(
    source: Image.Image,
    expanded: Image.Image,
    insets: list[int],
) -> dict[str, Any]:
    top, right, bottom, left = [int(value) for value in insets]
    source = source.convert("RGBA")
    expanded = expanded.convert("RGBA")
    corners = [
        ((0, 0, left, top), (0, 0, left, top)),
        (
            (source.width - right, 0, source.width, top),
            (expanded.width - right, 0, expanded.width, top),
        ),
        (
            (0, source.height - bottom, left, source.height),
            (0, expanded.height - bottom, left, expanded.height),
        ),
        (
            (
                source.width - right,
                source.height - bottom,
                source.width,
                source.height,
            ),
            (
                expanded.width - right,
                expanded.height - bottom,
                expanded.width,
                expanded.height,
            ),
        ),
    ]
    corners_exact = all(
        np.array_equal(
            np.asarray(source.crop(source_box)),
            np.asarray(expanded.crop(expanded_box)),
        )
        for source_box, expanded_box in corners
    )

    source_rgb = composite_rgb(source, (229, 207, 185))
    expanded_rgb = composite_rgb(expanded, (229, 207, 185))
    source_x = adjacent_variation(source_rgb, 1)
    expanded_x = adjacent_variation(expanded_rgb, 1)
    source_y = adjacent_variation(source_rgb, 0)
    expanded_y = adjacent_variation(expanded_rgb, 0)
    x_pairs = [
        (left, left),
        (source.width - right, expanded.width - right),
    ]
    y_pairs = [
        (top, top),
        (source.height - bottom, expanded.height - bottom),
    ]
    seam_ratios = [
        float(expanded_x[expanded_seam - 1] / max(source_x[source_seam - 1], 0.25))
        for source_seam, expanded_seam in x_pairs
    ] + [
        float(expanded_y[expanded_seam - 1] / max(source_y[source_seam - 1], 0.25))
        for source_seam, expanded_seam in y_pairs
    ]

    edge_distortions = [
        _edge_distortion(
            source,
            expanded,
            (left, 0, source.width - right, top),
            (left, 0, expanded.width - right, top),
        ),
        _edge_distortion(
            source,
            expanded,
            (left, source.height - bottom, source.width - right, source.height),
            (
                left,
                expanded.height - bottom,
                expanded.width - right,
                expanded.height,
            ),
        ),
        _edge_distortion(
            source,
            expanded,
            (0, top, left, source.height - bottom),
            (0, top, left, expanded.height - bottom),
        ),
        _edge_distortion(
            source,
            expanded,
            (source.width - right, top, source.width, source.height - bottom),
            (
                expanded.width - right,
                top,
                expanded.width,
                expanded.height - bottom,
            ),
        ),
    ]
    return {
        "width": expanded.width,
        "height": expanded.height,
        "maxSeamRatio": max(seam_ratios),
        "maxEdgeDistortion": max(edge_distortions),
        "cornersExact": corners_exact,
    }


def measure_wordmark_silhouette(
    wordmark: Image.Image,
    placement: dict[str, Any],
    grouping: dict[str, Any],
) -> dict[str, Any]:
    """Måler den dominerende sammenhængende blækgruppe, ikke løse ekstremer."""
    rgba = np.asarray(wordmark.convert("RGBA"))
    luma = rgba[..., :3].astype(np.float64) @ LUMA_WEIGHTS
    ink = (
        (rgba[..., 3] >= int(grouping["alphaMin"]))
        & (luma < float(grouping["inkLumaMax"]))
    )
    grouped = ndimage.binary_dilation(
        ink,
        np.ones(
            (
                int(grouping["dilationHeight"]),
                int(grouping["dilationWidth"]),
            )
        ),
    )
    labels, count = ndimage.label(grouped, np.ones((3, 3)))
    if count == 0:
        raise ValueError("wordmarken gav ingen målbar blækkomponent")
    ink_counts = np.array(
        [int(ink[labels == label].sum()) for label in range(1, count + 1)]
    )
    dominant_label = int(np.argmax(ink_counts)) + 1
    dominant = ink & (labels == dominant_label)
    ys, xs = np.where(dominant)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    bbox_area = (x1 - x0) * (y1 - y0)
    density = float(dominant.sum() / bbox_area)
    return {
        "occupancyPercent": 100 * (x1 - x0) / int(placement["viewportWidth"]),
        "dominantInkPixels": int(dominant.sum()),
        "dominantInkDensity": density,
        "bbox": [x0, y0, x1, y1],
    }


def title_ink_occupancy(
    wordmark: Image.Image,
    placement: dict[str, Any],
    grouping: dict[str, Any],
) -> float:
    return float(
        measure_wordmark_silhouette(wordmark, placement, grouping)[
            "occupancyPercent"
        ]
    )


def measure_visible_coverage(
    image: Image.Image,
    asset_class: str,
    config: dict[str, Any],
) -> dict[str, Any]:
    rgba = np.asarray(image.convert("RGBA"))
    alpha = rgba[..., 3]
    visible = alpha > 0
    labels, count = ndimage.label(visible, np.ones((3, 3)))
    sizes = (
        ndimage.sum(visible, labels, range(1, count + 1))
        if count
        else np.array([])
    )
    visible_pixels = int(visible.sum())
    dominant = int(max(sizes)) if len(sizes) else 0
    gate = config["coverageGates"][asset_class]
    luma = rgba[..., :3].astype(np.float64) @ LUMA_WEIGHTS
    ink_pixels = int(
        ((luma < float(gate["inkLumaMax"])) & visible).sum()
    )
    color_std = (
        float(
            np.std(
                rgba[..., :3][visible].astype(np.float64),
                axis=0,
            ).mean()
        )
        if visible_pixels
        else 0.0
    )
    metrics = {
        "alphaCoverage": float(visible.mean()),
        "visiblePixels": visible_pixels,
        "connectedComponents": int(count),
        "dominantComponentPixels": dominant,
        "dominantComponentShare": float(dominant / max(visible_pixels, 1)),
        "inkPixels": ink_pixels,
        "colorStdDev": color_std,
    }
    if asset_class == "wordmark":
        silhouette = measure_wordmark_silhouette(
            image,
            config["nativePlacement"]["wordmark"],
            config["occupancyGrouping"],
        )
        metrics["dominantInkPixels"] = silhouette["dominantInkPixels"]
    return metrics


def validate_visible_coverage(
    metrics: dict[str, Any],
    asset_class: str,
    config: dict[str, Any],
    name: str,
) -> None:
    gate = config["coverageGates"][asset_class]
    checks = {
        "alphaCoverage": "minAlphaCoverage",
        "dominantComponentPixels": "minDominantComponentPixels",
        "dominantComponentShare": "minDominantComponentShare",
        "inkPixels": "minInkPixels",
        "colorStdDev": "minColorStdDev",
    }
    if "minDominantInkPixels" in gate:
        checks["dominantInkPixels"] = "minDominantInkPixels"
    failed = [
        f"{metric}={metrics.get(metric, 0)}<{gate[threshold]}"
        for metric, threshold in checks.items()
        if metrics.get(metric, 0) < gate[threshold]
    ]
    if failed:
        raise ValueError(f"{name}: utilstrækkelig synlig dækning: {', '.join(failed)}")


def measure_matte_contamination(
    actual: Image.Image,
    expected: Image.Image,
    matting: dict[str, Any],
) -> dict[str, Any]:
    actual_rgba = np.asarray(actual.convert("RGBA"))
    expected_rgba = np.asarray(expected.convert("RGBA"))
    if actual_rgba.shape != expected_rgba.shape:
        raise ValueError("matte-sammenligning kræver samme dimensioner")

    expected_alpha = expected_rgba[..., 3]
    foreground = expected_alpha > 0
    edge = foreground & ~ndimage.binary_erosion(foreground, np.ones((3, 3)))
    edge |= (expected_alpha > 0) & (expected_alpha < 255)
    threshold = float(matting["maxCompositeDeltaE"])
    backgrounds = [
        (0, 0, 0),
        (255, 255, 255),
        tuple(matting["parchmentRgb"]),
    ]
    max_delta = 0.0
    contaminated = np.zeros(edge.shape, dtype=bool)
    for background in backgrounds:
        actual_composite = np.clip(
            composite_rgb(actual, background),
            0,
            255,
        ).astype(np.uint8)
        expected_composite = np.clip(
            composite_rgb(expected, background),
            0,
            255,
        ).astype(np.uint8)
        delta = lab_delta(actual_composite, expected_composite)
        if edge.any():
            max_delta = max(max_delta, float(delta[edge].max()))
        contaminated |= edge & (delta > threshold)

    depth = ndimage.distance_transform_edt(foreground)
    max_fringe = (
        float(depth[contaminated].max())
        if contaminated.any()
        else 0.0
    )
    opaque_contaminated = int(
        (contaminated & (expected_alpha >= 250)).sum()
    )
    return {
        "maxCompositeDeltaE": max_delta,
        "maxFringePixels": max_fringe,
        "opaqueContaminatedEdgePixels": opaque_contaminated,
    }


def validate_matte_contamination(
    actual: Image.Image,
    expected: Image.Image,
    matting: dict[str, Any],
    name: str,
) -> dict[str, Any]:
    metrics = measure_matte_contamination(actual, expected, matting)
    if (
        metrics["maxCompositeDeltaE"] > float(matting["maxCompositeDeltaE"])
        or metrics["maxFringePixels"] > float(matting["maxFringePixels"])
        or metrics["opaqueContaminatedEdgePixels"] > 0
    ):
        raise ValueError(f"{name}: matteforurening {metrics}")
    return metrics


def asset_manifest_entry(
    path: Path,
    metadata: dict[str, Any],
    source_path: str,
    coverage: dict[str, Any],
    matte: dict[str, Any],
    max_transition: float,
) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
    return {
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "nativeWidth": width,
        "nativeHeight": height,
        "sourcePath": source_path,
        "provenance": metadata["provenance"],
        "assetClass": metadata["assetClass"],
        "coverage": coverage,
        "matte": matte,
        "maxTransitionPixels": max_transition,
        "display": {
            "maxPhysicalScale": 1,
            "maxCssWidthDpr1": width,
            "maxCssHeightDpr1": height,
            "maxCssWidthDpr2": width / 2,
            "maxCssHeightDpr2": height / 2,
        },
    }


def build_asset_images(
    source: np.ndarray,
    config: dict[str, Any],
) -> tuple[dict[str, Image.Image], dict[str, dict[str, Any]]]:
    matting = config["matting"]
    images: dict[str, Image.Image] = {}
    metadata: dict[str, dict[str, Any]] = {}

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
            parts = split_surface_images(
                image,
                spec["slices"],
                spec["outputs"],
            )
            left_name, center_name, right_name = spec["outputs"]
            parts[center_name] = match_center_edges(
                parts[center_name],
                parts[left_name],
                parts[right_name],
                int(spec["edgeBlendPixels"]),
            )
            for name, part in parts.items():
                images[name] = part
                metadata[name] = {
                    "provenance": spec["provenance"],
                    "assetClass": spec["assetClass"],
                    "quality": int(spec["quality"]),
                    "lossless": False,
                    "assetId": asset_id,
                }
            continue

        if "outputs" in spec:
            for output in spec["outputs"]:
                size = (int(output["width"]), int(output["height"]))
                rendered = resize_rgba(image, size)
                images[output["file"]] = rendered
                metadata[output["file"]] = {
                    "provenance": spec["provenance"],
                    "assetClass": spec["assetClass"],
                    "quality": int(output["quality"]),
                    "lossless": False,
                    "assetId": asset_id,
                }
            continue

        name = spec["output"]
        images[name] = image
        metadata[name] = {
            "provenance": spec["provenance"],
            "assetClass": spec["assetClass"],
            "quality": int(spec["quality"]),
            "lossless": False,
            "assetId": asset_id,
        }

    if "wordmark-desktop.webp" not in images:
        raise ValueError("wordmark-desktop.webp blev ikke bygget")
    return images, metadata


def write_asset_images(
    images: dict[str, Image.Image],
    metadata: dict[str, dict[str, Any]],
    output_dir: Path,
) -> None:
    for name, image in images.items():
        entry = metadata[name]
        save_webp(
            image,
            output_dir / name,
            int(entry["quality"]),
            lossless=bool(entry["lossless"]),
        )


def codec_reference_images(
    images: dict[str, Image.Image],
    metadata: dict[str, dict[str, Any]],
) -> dict[str, Image.Image]:
    """Normaliserer source-matten gennem den deklarerede WebP-codec."""
    references: dict[str, Image.Image] = {}
    for name, image in images.items():
        entry = metadata[name]
        buffer = io.BytesIO()
        image.save(
            buffer,
            "WEBP",
            quality=int(entry["quality"]),
            method=6,
            exact=True,
            lossless=bool(entry["lossless"]),
        )
        buffer.seek(0)
        references[name] = Image.open(buffer).convert("RGBA").copy()
    return references


def max_alpha_transition(alpha: np.ndarray) -> float:
    semi = (alpha > 0) & (alpha < 255)
    if not semi.any():
        return 0.0
    return float(ndimage.distance_transform_edt(alpha > 0)[semi].max())


def collect_asset_quality(
    output_dir: Path,
    expected_images: dict[str, Image.Image],
    metadata: dict[str, dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    quality: dict[str, dict[str, Any]] = {}
    for name in sorted(expected_images):
        actual = Image.open(output_dir / name).convert("RGBA")
        coverage = measure_visible_coverage(
            actual,
            metadata[name]["assetClass"],
            config,
        )
        validate_visible_coverage(
            coverage,
            metadata[name]["assetClass"],
            config,
            name,
        )
        matte = validate_matte_contamination(
            actual,
            expected_images[name],
            config["matting"],
            name,
        )
        transition = max_alpha_transition(np.asarray(actual)[..., 3])
        if transition > float(config["matting"]["maxTransitionPixels"]):
            raise ValueError(f"{name}: alphaovergang {transition}px")
        quality[name] = {
            "coverage": coverage,
            "matte": matte,
            "maxTransitionPixels": transition,
        }
    return quality


def validate_outputs(
    output_dir: Path,
    config: dict[str, Any],
    silhouette: dict[str, Any],
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
    occupancy = float(silhouette["occupancyPercent"])
    if not (
        float(placement["minOccupancyPercent"])
        <= occupancy
        <= float(placement["maxOccupancyPercent"])
    ):
        raise ValueError(f"wordmark occupancy {occupancy:.6f}% er uden for gate")
    if silhouette["dominantInkDensity"] < float(
        config["occupancyGrouping"]["minDensity"]
    ):
        raise ValueError(
            "wordmarkens dominerende blæksilhuet er for sparsom: "
            f"{silhouette['dominantInkDensity']}"
        )


def create_manifest(
    output_dir: Path,
    config: dict[str, Any],
    config_path: Path,
    metadata: dict[str, dict[str, Any]],
    asset_quality: dict[str, dict[str, Any]],
    silhouette: dict[str, Any],
) -> dict[str, Any]:
    source_path = config["source"]["path"]
    assets = {
        name: asset_manifest_entry(
            output_dir / name,
            metadata[name],
            source_path,
            asset_quality[name]["coverage"],
            asset_quality[name]["matte"],
            asset_quality[name]["maxTransitionPixels"],
        )
        for name in sorted(config["outputDimensions"])
    }

    parchment: dict[str, Any] = {}
    for dependency_id, dependency in config["parchmentDependencies"].items():
        path = ROOT / dependency["path"]
        if not path.exists():
            raise ValueError(f"{dependency_id}: pergament mangler: {path}")
        if sha256(path) != dependency["sha256"]:
            raise ValueError(f"{dependency_id}: pergament-SHA afviger")
        with Image.open(path) as image:
            if list(image.size) != [dependency["width"], dependency["height"]]:
                raise ValueError(f"{dependency_id}: pergamentdimension afviger")
        parchment[dependency_id] = {
            **dependency,
            "bytes": path.stat().st_size,
        }

    bundles: dict[str, Any] = {}
    for bundle_id, payload in config["payloadBundles"].items():
        files = config["bundles"][payload["materials"]]
        material_bytes = sum(assets[name]["bytes"] for name in files)
        parchment_entry = parchment[payload["parchment"]]
        bundles[bundle_id] = {
            "files": files,
            "materialBytes": material_bytes,
            "parchment": parchment_entry,
            "bytes": material_bytes + parchment_entry["bytes"],
        }

    slices: dict[str, Any] = {}
    for asset_id in ("ribbon", "begin", "fates"):
        spec = config["assets"][asset_id]
        parts = [
            Image.open(output_dir / name).convert("RGBA")
            for name in spec["outputs"]
        ]
        expanded = render_three_slice(
            parts,
            int(spec["slices"][1]) * 3,
            spec["centerPolicy"],
        )
        seams = [
            int(spec["slices"][0]),
            int(spec["slices"][0]) + int(spec["slices"][1]) * 3,
        ]
        seam_ratio = measured_seam_ratio(expanded, seams, 1)
        if seam_ratio > float(spec["maxSeamRatio"]):
            raise ValueError(f"{asset_id}: 3-slice-sømratio {seam_ratio}")
        slices[asset_id] = {
            "centerWidth": spec["slices"][1],
            "centerPolicy": spec["centerPolicy"],
            "expanded3xSeamRatio": seam_ratio,
        }

    nine_slice_evidence: dict[str, Any] = {}
    for asset_id in ("welcomeFrame", "toolFrame", "tipCardFrame"):
        spec = config["assets"][asset_id]
        source = Image.open(output_dir / spec["output"]).convert("RGBA")
        evidence: dict[str, Any] = {}
        for size_id, size in spec["expansionSizes"].items():
            expanded = render_nine_slice(
                source,
                spec["insets"],
                tuple(size),
                spec["nineSlicePolicy"],
            )
            quality = measure_nine_slice_quality(source, expanded, spec["insets"])
            if quality["maxSeamRatio"] > float(spec["maxSeamRatio"]):
                raise ValueError(
                    f"{asset_id}/{size_id}: 9-slice-sømratio "
                    f"{quality['maxSeamRatio']}"
                )
            if quality["maxEdgeDistortion"] > float(spec["maxEdgeDistortion"]):
                raise ValueError(
                    f"{asset_id}/{size_id}: kantforvrængning "
                    f"{quality['maxEdgeDistortion']}"
                )
            if not quality["cornersExact"]:
                raise ValueError(f"{asset_id}/{size_id}: hjørner blev ændret")
            evidence[size_id] = quality
        nine_slice_evidence[asset_id] = evidence

    manifest = {
        "version": config["version"],
        "algorithm": config["algorithm"],
        "configSha256": sha256(config_path),
        "source": config["source"],
        "assets": assets,
        "nativePlacement": config["nativePlacement"],
        "measurements": {
            "titleInkOccupancyPercent": silhouette["occupancyPercent"],
            "wordmarkDominantSilhouette": silhouette,
        },
        "slices": slices,
        "nineSlicePolicy": {
            asset_id: {
                "insets": config["assets"][asset_id]["insets"],
                **config["assets"][asset_id]["nineSlicePolicy"],
            }
            for asset_id in ("welcomeFrame", "toolFrame", "tipCardFrame")
        },
        "nineSliceEvidence": nine_slice_evidence,
        "bundles": bundles,
        "budgets": config["budgets"],
        "reconstructedRegions": config["reconstructedRegions"],
        "blocked": config["blocked"],
    }
    for bundle_id, payload in config["payloadBundles"].items():
        budget_key = payload["budget"]
        if bundles[bundle_id]["bytes"] > config["budgets"][budget_key]:
            raise ValueError(
                f"{bundle_id}: {bundles[bundle_id]['bytes']} bytes > "
                f"{config['budgets'][budget_key]}"
            )
    return manifest


def publish_transaction(
    staged_assets: Path,
    staged_manifest: Path,
    target_assets: Path,
    target_manifest: Path,
    *,
    inject_failure_after: int | None = None,
) -> None:
    """Publicerer assetmappe og manifest som én rollback-sikret transaktion."""
    backup_assets = target_assets.with_name(f".{target_assets.name}.previous")
    backup_manifest = target_manifest.with_name(
        f".{target_manifest.name}.previous"
    )
    if backup_assets.exists() or backup_manifest.exists():
        raise RuntimeError("forrige titelmaterialetransaktion er ikke ryddet")

    rename_count = 0
    old_assets_moved = False
    old_manifest_moved = False
    new_assets_installed = False
    new_manifest_installed = False

    def rename(source: Path, target: Path, state: str) -> None:
        nonlocal rename_count, old_assets_moved, old_manifest_moved
        nonlocal new_assets_installed, new_manifest_installed
        os.replace(source, target)
        if state == "old-assets":
            old_assets_moved = True
        elif state == "old-manifest":
            old_manifest_moved = True
        elif state == "new-assets":
            new_assets_installed = True
        elif state == "new-manifest":
            new_manifest_installed = True
        rename_count += 1
        if inject_failure_after == rename_count:
            raise RuntimeError(f"injected failure after rename {rename_count}")

    try:
        if target_assets.exists():
            rename(target_assets, backup_assets, "old-assets")
        if target_manifest.exists():
            rename(target_manifest, backup_manifest, "old-manifest")
        rename(staged_assets, target_assets, "new-assets")
        rename(staged_manifest, target_manifest, "new-manifest")
    except BaseException:
        if new_manifest_installed and target_manifest.exists():
            target_manifest.unlink()
        if new_assets_installed and target_assets.exists():
            shutil.rmtree(target_assets)
        if old_manifest_moved and backup_manifest.exists():
            os.replace(backup_manifest, target_manifest)
        if old_assets_moved and backup_assets.exists():
            os.replace(backup_assets, target_assets)
        if backup_assets.exists():
            shutil.rmtree(backup_assets)
        if backup_manifest.exists():
            backup_manifest.unlink()
        raise
    if backup_assets.exists():
        shutil.rmtree(backup_assets)
    if backup_manifest.exists():
        backup_manifest.unlink()


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
        expected_images, metadata = build_asset_images(source, config)
        write_asset_images(expected_images, metadata, staged)
        matte_references = codec_reference_images(expected_images, metadata)
        wordmark = Image.open(staged / "wordmark-desktop.webp").convert("RGBA")
        silhouette = measure_wordmark_silhouette(
            wordmark,
            config["nativePlacement"]["wordmark"],
            config["occupancyGrouping"],
        )
        validate_outputs(staged, config, silhouette)
        asset_quality = collect_asset_quality(
            staged,
            matte_references,
            metadata,
            config,
        )
        manifest = create_manifest(
            staged,
            config,
            config_path,
            metadata,
            asset_quality,
            silhouette,
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
        publish_transaction(
            staged,
            manifest_tmp,
            output_dir,
            manifest_path,
        )
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
            f"occupancy {silhouette['occupancyPercent']:.6f}%, "
            f"desktop {manifest['bundles']['desktop']['bytes']} B, "
            f"mobile-390 {manifest['bundles']['mobile-390']['bytes']} B, "
            f"mobile-430 {manifest['bundles']['mobile-430']['bytes']} B"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
