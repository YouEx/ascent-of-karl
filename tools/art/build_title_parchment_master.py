#!/usr/bin/env python3
"""Reconstructs one continuous title parchment plate from approved local pixels.

The builder keeps every observable parchment pixel outside source UI
occlusions byte-for-byte. Missing and extended areas are reconstructed from
hundreds of distinct, source-derived paper patches with overlap matching.
It rejects exact repeated patches and uses no planted samples, network steps
or third-party generation; visual review remains authoritative.

The default output is staged under `.judge/`. Production publication is
explicit so a failed candidate can never land in `src/assets/art/title-layers`.
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

import build_title_materials

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("title-parchment-master.config.json")
STAGING_DIR = ROOT / ".judge/parchment-master"
PRODUCTION_DIR = ROOT / "src/assets/art/title-layers"
EVIDENCE_DIR = ROOT / "docs/design/evidence/title-parchment-master"
LUMA = np.array([0.2126, 0.7152, 0.0722])
APPROVED_PUBLISH_CONFIG_SHA256 = (
    "36d2f845956c050e2a72f34b4147bef7890413559c9894b4441c3c1c59e0634c"
)
APPROVED_SOURCE_SHA256 = (
    "8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850"
)
APPROVED_LOSSLESS_SOURCE_SHA256 = (
    "8d37bca638f53d90a996c551183d721877419ebe73f3e81a1c67da120dc1a770"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def remove_small_components(mask: np.ndarray, minimum: int) -> np.ndarray:
    labels, count = ndimage.label(mask, np.ones((3, 3)))
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    keep = np.zeros(count + 1, dtype=bool)
    keep[1:] = sizes >= minimum
    return keep[labels]


def observed_sheet_mask(source_left: np.ndarray, level: float) -> np.ndarray:
    luma = source_left.astype(np.float64) @ LUMA
    raw = ndimage.gaussian_filter(luma, 6.0, mode="nearest") > level
    raw = ndimage.binary_fill_holes(raw)
    raw = ndimage.binary_closing(raw, np.ones((9, 9)))
    labels, count = ndimage.label(raw)
    if count:
        sizes = ndimage.sum(raw, labels, range(1, count + 1))
        raw = labels == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_fill_holes(raw)


def spectral_contour(sample: np.ndarray, length: int, rng: np.random.Generator) -> np.ndarray:
    """Creates an aperiodic contour with the observed edge's frequency balance."""
    sample = np.asarray(sample, dtype=np.float64)
    smooth = ndimage.gaussian_filter1d(sample, 18.0, mode="nearest")
    residual = sample - smooth
    observed_std = max(float(residual.std()), 1.0)
    amplitude = np.abs(np.fft.rfft(residual))
    source_freq = np.fft.rfftfreq(residual.size)
    target_freq = np.fft.rfftfreq(length)
    shaped = np.interp(target_freq, source_freq, amplitude, left=0, right=0)
    phase = rng.uniform(0, 2 * np.pi, shaped.size)
    phase[0] = 0
    noise = np.fft.irfft(shaped * np.exp(1j * phase), length)
    noise -= noise.mean()
    noise *= observed_std / max(float(noise.std()), 1e-6)
    return ndimage.gaussian_filter1d(noise, 1.2, mode="nearest")


def silhouette(
    observed: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    out_w = int(config["output"]["width"])
    out_h = int(config["output"]["height"])
    crop_x = int(config["source"]["crop"][0])
    crop_y = int(config["source"]["crop"][1])
    spec = config["silhouette"]
    rng = np.random.default_rng(int(config["seed"]) + 1)

    observed_rows = []
    observed_left = []
    end = int(spec["observedLeftEndSourceY"]) - crop_y
    for y in range(max(0, int(spec["topEdgeSourceY"]) - crop_y), end + 1):
        xs = np.where(observed[y, :300])[0]
        if xs.size:
            observed_rows.append(y)
            observed_left.append(float(xs.min()))
    rows = np.asarray(observed_rows)
    left_values = ndimage.median_filter(np.asarray(observed_left), size=9, mode="nearest")
    left = np.interp(np.arange(out_h), rows, left_values)
    extension_start = int(rows[-1])
    extension_length = out_h - extension_start
    edge_noise = spectral_contour(left_values, extension_length, rng)
    drift = np.linspace(0, float(spec["leftExtensionDrift"]), extension_length)
    continuation = left_values[-1] + drift + edge_noise
    fade = np.clip(np.arange(extension_length) / 48.0, 0, 1)
    continuation = continuation * fade + left_values[-1] * (1 - fade)
    left[extension_start:] = continuation
    left = np.clip(left, 28, 132)

    right_noise = spectral_contour(left_values, out_h, rng) * 0.22
    right = float(spec["rightEdgeX"]) - crop_x + right_noise
    right = np.clip(right, 684 - crop_x, 704 - crop_x)

    top_noise = spectral_contour(left_values, out_w, rng) * 0.28
    top = int(spec["topEdgeSourceY"]) - crop_y + top_noise
    top = np.clip(top, 8, 26)

    bottom_noise = spectral_contour(left_values, out_w, rng) * 0.55
    bottom = float(spec["bottomEdgeY"]) + bottom_noise
    bottom = np.clip(bottom, out_h - 20, out_h - 1)

    yy, xx = np.mgrid[:out_h, :out_w]
    support = (
        (xx >= left[:, None])
        & (xx <= right[:, None])
        & (yy >= top[None, :])
        & (yy <= bottom[None, :])
    )
    support = ndimage.binary_closing(support, np.ones((3, 3)))
    depth = ndimage.distance_transform_edt(support)
    interior = depth > 1.0
    alpha = np.zeros((out_h, out_w), dtype=np.uint8)
    alpha[interior] = 255
    alpha[(depth > 0) & (depth <= 1.0)] = 192
    return support, alpha


def global_rect(
    rect: list[int],
    crop: list[int],
) -> tuple[int, int, int, int]:
    crop_x, crop_y = int(crop[0]), int(crop[1])
    x0, y0, x1, y1 = rect
    return x0 - crop_x, y0 - crop_y, x1 - crop_x, y1 - crop_y


def build_occlusion_mask(
    full_source: np.ndarray,
    source_crop: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    crop = config["source"]["crop"]
    crop_x = int(crop[0])
    crop_y = int(config["source"]["crop"][1])
    fine = np.zeros(source_crop.shape[:2], dtype=bool)

    wordmark_spec = dict(config["wordmark"])
    x0, y0, x1, y1 = wordmark_spec["crop"]
    observed = full_source[y0:y1, x0:x1]
    local_spec = {
        "regions": wordmark_spec["regions"],
        "inkLumaMax": wordmark_spec["inkLumaMax"],
        "inpaintRadius": wordmark_spec["inpaintRadius"],
    }
    matte = {
        "deltaETransparent": 2.0,
        "deltaEOpaque": 12.0,
        "minComponentPixels": 8,
    }
    wordmark = np.asarray(
        build_title_materials.build_ink_matte(observed, local_spec, matte)
    )[..., 3] > 0
    fine[y0 - crop_y:y1 - crop_y, x0 - crop_x:x1 - crop_x] |= wordmark
    fine = ndimage.binary_dilation(fine, np.ones((3, 3)), iterations=3)

    canvas = Image.new("1", (source_crop.shape[1], source_crop.shape[0]), 0)
    draw = ImageDraw.Draw(canvas)
    for item in config["surfaceOcclusions"]:
        gx0, gy0, gx1, gy1 = global_rect(item["crop"], crop)
        if item["type"] == "polygon":
            points = [(gx0 + x, gy0 + y) for x, y in item["points"]]
            draw.polygon(points, fill=1)
        else:
            draw.rounded_rectangle(
                (gx0, gy0, gx1 - 1, gy1 - 1),
                radius=int(item["radius"]),
                fill=1,
            )
    surfaces = ndimage.binary_dilation(
        np.asarray(canvas, dtype=bool),
        np.ones((3, 3)),
        iterations=8,
    )

    luma = source_crop.astype(np.float64) @ LUMA
    for item in config["inkOcclusions"]:
        x0, y0, x1, y1 = global_rect(item["rect"], crop)
        seed = np.zeros(fine.shape, dtype=bool)
        seed[y0:y1, x0:x1] = luma[y0:y1, x0:x1] < float(item["lumaMax"])
        seed = remove_small_components(seed, int(item["minimumComponentPixels"]))
        fine |= ndimage.binary_dilation(seed, np.ones((3, 3)), iterations=2)
    return fine | surfaces, fine, surfaces


def donor_mask(
    observable: np.ndarray,
    occlusion: np.ndarray,
    config: dict[str, Any],
) -> np.ndarray:
    crop = config["source"]["crop"]
    crop_x = int(crop[0])
    crop_y = int(config["source"]["crop"][1])
    donor = observable.copy()
    donor[:, :max(0, 80 - crop_x)] = False
    donor[:, max(0, 660 - crop_x):] = False
    donor[max(0, 800 - crop_y):] = False
    donor &= ~ndimage.binary_dilation(occlusion, np.ones((9, 9)))
    for rect in config["donorExclusions"]:
        x0, y0, x1, y1 = global_rect(rect, crop)
        donor[max(0, y0):max(0, y1), x0:x1] = False
    return donor


def normalized_blur(
    image: np.ndarray,
    valid: np.ndarray,
    sigma: float,
) -> np.ndarray:
    weights = ndimage.gaussian_filter(valid.astype(np.float64), sigma, mode="nearest")
    channels = []
    for channel in range(3):
        values = ndimage.gaussian_filter(
            image[..., channel].astype(np.float64) * valid,
            sigma,
            mode="nearest",
        )
        channels.append(values / np.maximum(weights, 1e-6))
    return np.dstack(channels)


def polynomial_basis(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.stack(
        [
            np.ones_like(x),
            x, y,
            x * x, x * y, y * y,
            x ** 3, x * x * y, x * y * y, y ** 3,
            x ** 4, x ** 3 * y, x * x * y * y, x * y ** 3, y ** 4,
        ],
        axis=-1,
    )


def illumination_field(
    source: np.ndarray,
    donor: np.ndarray,
    config: dict[str, Any],
) -> np.ndarray:
    sigma = float(config["texture"]["illuminationSigma"])
    local = normalized_blur(source, donor, sigma)
    ys, xs = np.where(donor)
    take = (ys % 4 == 0) & (xs % 4 == 0)
    ys = ys[take]
    xs = xs[take]
    x = xs / max(source.shape[1] - 1, 1) * 2 - 1
    y = ys / max(source.shape[0] - 1, 1) * 2 - 1
    basis = polynomial_basis(x, y)
    ridge = 1e-4 * np.eye(basis.shape[1])
    coefficients = []
    for channel in range(3):
        target = local[ys, xs, channel]
        coefficients.append(
            np.linalg.solve(basis.T @ basis + ridge, basis.T @ target)
        )
    coefficients = np.stack(coefficients, axis=1)

    out_h = int(config["output"]["height"])
    out_w = int(config["output"]["width"])
    max_known_y = int(ys.max())
    result = np.empty((out_h, out_w, 3), dtype=np.float64)
    xx = np.arange(out_w) / max(source.shape[1] - 1, 1) * 2 - 1
    for row in range(out_h):
        source_row = min(row, max_known_y)
        yy = source_row / max(source.shape[0] - 1, 1) * 2 - 1
        row_basis = polynomial_basis(xx, np.full_like(xx, yy))
        result[row] = row_basis @ coefficients

    row_values = []
    row_ids = []
    for row in range(max(0, max_known_y - 180), max_known_y + 1):
        valid = donor[row]
        if valid.sum() >= 40:
            row_ids.append(row)
            row_values.append(np.median(local[row, valid], axis=0))
    if len(row_ids) >= 2:
        slope = np.polyfit(np.asarray(row_ids), np.asarray(row_values), 1)[0]
        slope = np.clip(slope, -0.025, 0.025)
        distance = np.maximum(np.arange(out_h) - max_known_y, 0)
        drift = 220 * (1 - np.exp(-distance / 220.0))
        result += drift[:, None, None] * slope[None, None, :]

    values = source[donor]
    lo = np.percentile(values, 1, axis=0)
    hi = np.percentile(values, 99, axis=0)
    return np.clip(result, lo, hi)


def patch_positions(length: int, patch: int, step: int) -> list[int]:
    positions = list(range(0, max(length - patch + 1, 1), step))
    final = length - patch
    if not positions or positions[-1] != final:
        positions.append(final)
    return positions


def donor_positions(mask: np.ndarray, patch: int, stride: int) -> np.ndarray:
    integral = np.pad(mask.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    sums = (
        integral[patch:, patch:]
        - integral[:-patch, patch:]
        - integral[patch:, :-patch]
        + integral[:-patch, :-patch]
    )
    ys, xs = np.where(sums == patch * patch)
    keep = (ys % stride == 0) & (xs % stride == 0)
    return np.column_stack([ys[keep], xs[keep]])


def minimum_vertical_cut(cost: np.ndarray) -> np.ndarray:
    """Returns a left/right mask whose boundary follows minimum overlap error."""
    height, width = cost.shape
    accumulated = cost.copy()
    back = np.zeros((height, width), dtype=np.int16)
    for row in range(1, height):
        previous = accumulated[row - 1]
        for column in range(width):
            lo = max(0, column - 1)
            hi = min(width, column + 2)
            parent = lo + int(np.argmin(previous[lo:hi]))
            accumulated[row, column] += previous[parent]
            back[row, column] = parent
    path = np.zeros(height, dtype=np.int16)
    path[-1] = int(np.argmin(accumulated[-1]))
    for row in range(height - 1, 0, -1):
        path[row - 1] = back[row, path[row]]
    columns = np.arange(width)[None, :]
    return columns >= path[:, None]


def synthesize_residual(
    source_residual: np.ndarray,
    donor: np.ndarray,
    preserve: np.ndarray,
    support: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, int]:
    spec = config["texture"]
    patch = int(spec["patchSize"])
    overlap = int(spec["overlap"])
    step = patch - overlap
    candidates = donor_positions(donor, patch, int(spec["donorStride"]))
    if len(candidates) < int(spec["minimumDonorPatches"]):
        raise ValueError(f"kun {len(candidates)} gyldige donorpatches")

    out_h, out_w = support.shape
    source_h, source_w = source_residual.shape[:2]
    target_known = np.zeros((out_h, out_w, 3), dtype=np.float64)
    target_known[:source_h, :source_w][preserve] = source_residual[preserve]
    preserve_full = np.zeros((out_h, out_w), dtype=bool)
    preserve_full[:source_h, :source_w] = preserve

    residual = np.zeros_like(target_known)
    filled = preserve_full.copy()
    residual[preserve_full] = target_known[preserve_full]
    used = np.zeros(len(candidates), dtype=np.int16)
    rng = np.random.default_rng(int(config["seed"]) + 2)
    tile_count = 0

    for oy in patch_positions(out_h, patch, step):
        for ox in patch_positions(out_w, patch, step):
            local_support = support[oy:oy + patch, ox:ox + patch]
            if local_support.sum() < 32:
                continue
            local_preserve = preserve_full[oy:oy + patch, ox:ox + patch]
            local_filled = filled[oy:oy + patch, ox:ox + patch]
            compare = local_support & local_filled
            current = residual[oy:oy + patch, ox:ox + patch]

            available = np.where(used == used.min())[0]
            count = min(int(spec["candidateCount"]), len(available))
            pool = rng.choice(available, count, replace=False)
            patches = np.stack(
                [
                    source_residual[y:y + patch, x:x + patch]
                    for y, x in candidates[pool]
                ]
            )
            if compare.sum() >= 24:
                sampled = compare.copy()
                sampled[1::2] = False
                sampled[:, 1::2] = False
                offsets = (
                    current[sampled][None, ...] - patches[:, sampled]
                ).mean(axis=1)
                offsets = np.clip(offsets, -12, 12)
                adjusted = patches + offsets[:, None, None, :]
                diff = adjusted[:, sampled] - current[sampled][None, ...]
                score = np.minimum(diff * diff, 1600).mean(axis=(1, 2))
            else:
                offsets = np.zeros((len(patches), 3), dtype=np.float64)
                adjusted = patches
                score = np.square(patches.mean(axis=(1, 2))).mean(axis=1)
            score += rng.random(score.shape) * 1e-6
            chosen_local = int(np.argmin(score))
            chosen_id = int(pool[chosen_local])
            chosen = adjusted[chosen_local]
            used[chosen_id] += 1

            paste = local_support & ~local_preserve
            if ox > 0 and local_filled[:, :overlap].any():
                cost = np.mean(
                    np.square(current[:, :overlap] - chosen[:, :overlap]),
                    axis=2,
                )
                paste[:, :overlap] &= minimum_vertical_cut(cost)
            if oy > 0 and local_filled[:overlap].any():
                cost = np.mean(
                    np.square(current[:overlap] - chosen[:overlap]),
                    axis=2,
                )
                paste[:overlap] &= minimum_vertical_cut(cost.T).T
            current[paste] = chosen[paste]
            local_filled[paste] = True
            tile_count += 1

    missing = support & ~filled
    if missing.any():
        _, indices = ndimage.distance_transform_edt(~filled, return_indices=True)
        residual[missing] = residual[indices[0][missing], indices[1][missing]]
    return residual, tile_count


def nearest_interior_rgb(rgb: np.ndarray, support: np.ndarray, alpha: np.ndarray) -> None:
    boundary = (alpha > 0) & (alpha < 255)
    opaque = alpha == 255
    _, indices = ndimage.distance_transform_edt(~opaque, return_indices=True)
    rgb[boundary] = rgb[indices[0][boundary], indices[1][boundary]]
    rgb[~support] = 0


def highpass(rgb: np.ndarray, sigma: float = 5.0) -> np.ndarray:
    smooth = np.dstack(
        [
            ndimage.gaussian_filter(rgb[..., channel].astype(np.float64), sigma)
            for channel in range(3)
        ]
    )
    return rgb.astype(np.float64) - smooth


def source_retention(
    rgb: np.ndarray,
    source: np.ndarray,
    observable: np.ndarray,
    present: np.ndarray | None = None,
) -> float:
    return float(
        source_retention_metrics(rgb, source, observable, present)[
            "sourcePixelRetention"
        ]
    )


def observable_mask_sha256(observable: np.ndarray) -> str:
    shape = np.asarray(observable.shape, dtype=">u4").tobytes()
    packed = np.packbits(
        observable.astype(np.uint8),
        bitorder="little",
    ).tobytes()
    return hashlib.sha256(shape + packed).hexdigest()


def source_retention_metrics(
    rgb: np.ndarray,
    source: np.ndarray,
    observable: np.ndarray,
    present: np.ndarray | None = None,
) -> dict[str, float | int | str]:
    if observable.shape != source.shape[:2]:
        raise ValueError("observable mask shape does not match configured source crop")
    if rgb.shape[0] < source.shape[0] or rgb.shape[1] < source.shape[1]:
        raise ValueError("output is smaller than configured source crop")
    if present is not None and present.shape[:2] < source.shape[:2]:
        raise ValueError("presence mask is smaller than configured source crop")
    expected = int(observable.sum())
    if expected == 0:
        return {
            "sourcePixelRetention": 0.0,
            "observableSourcePixels": 0,
            "observableMaskSha256": observable_mask_sha256(observable),
            "changedOrMissingObservableSourcePixels": 0,
        }
    exact = np.all(rgb[:source.shape[0], :source.shape[1]] == source, axis=2)
    if present is not None:
        exact &= present[:source.shape[0], :source.shape[1]]
    retained = int((exact & observable).sum())
    return {
        "sourcePixelRetention": retained / expected,
        "observableSourcePixels": expected,
        "observableMaskSha256": observable_mask_sha256(observable),
        "changedOrMissingObservableSourcePixels": expected - retained,
    }


def alpha_fringe_metrics(rgba: np.ndarray) -> dict[str, float]:
    alpha = rgba[..., 3]
    semi = (alpha > 0) & (alpha < 255)
    opaque = alpha == 255
    if not semi.any() or not opaque.any():
        return {"maxFringePixels": 0.0, "maxCompositeChannelDelta": 0.0}
    _, indices = ndimage.distance_transform_edt(~opaque, return_indices=True)
    expected_rgb = rgba[..., :3].copy()
    expected_rgb[semi] = rgba[indices[0][semi], indices[1][semi], :3]
    maximum = 0.0
    contaminated = np.zeros(alpha.shape, dtype=bool)
    for background in ((0, 0, 0), (255, 255, 255), (236, 220, 199)):
        actual = np.asarray(composite(rgba, background)).astype(np.int16)
        expected = np.asarray(
            composite(np.dstack([expected_rgb, alpha]), background)
        ).astype(np.int16)
        delta = np.max(np.abs(actual - expected), axis=2)
        maximum = max(maximum, float(delta[semi].max()))
        contaminated |= semi & (delta > 1)
    depth = ndimage.distance_transform_edt(alpha > 0)
    fringe = float(depth[contaminated].max()) if contaminated.any() else 0.0
    return {
        "maxFringePixels": fringe,
        "maxCompositeChannelDelta": maximum,
    }


def repetition_metrics(
    rgb: np.ndarray,
    reconstructed: np.ndarray,
    support: np.ndarray,
    patch: int = 48,
) -> dict[str, float | int]:
    residual = highpass(rgb)
    vectors = []
    hashes: list[str] = []
    locations = []
    for y in range(0, rgb.shape[0] - patch + 1, patch):
        for x in range(0, rgb.shape[1] - patch + 1, patch):
            support_patch = support[y:y + patch, x:x + patch]
            reconstructed_patch = reconstructed[y:y + patch, x:x + patch]
            if support_patch.mean() < 0.95 or reconstructed_patch.mean() < 0.8:
                continue
            values = residual[y:y + patch, x:x + patch]
            quantized = np.clip(np.rint(values), -32, 32).astype(np.int8)
            hashes.append(hashlib.sha256(quantized.tobytes()).hexdigest())
            vector = values[::3, ::3].reshape(-1)
            vector -= vector.mean()
            std = vector.std()
            if std > 1e-6:
                vectors.append(vector / std)
                locations.append((y, x))
    duplicates = len(hashes) - len(set(hashes))
    maximum = 0.0
    if len(vectors) >= 2:
        matrix = np.stack(vectors)
        correlation = matrix @ matrix.T / matrix.shape[1]
        np.fill_diagonal(correlation, -1)
        for index, (y, x) in enumerate(locations):
            for other, (other_y, other_x) in enumerate(locations):
                if abs(y - other_y) < patch * 2 and abs(x - other_x) < patch * 2:
                    correlation[index, other] = -1
        maximum = max(0.0, float(correlation.max()))
    return {
        "sampledPatchCount": len(hashes),
        "duplicatePatchCount": duplicates,
        "maxNonAdjacentPatchCorrelation": maximum,
    }


def quality_metrics(
    rgba: np.ndarray,
    source: np.ndarray,
    observable: np.ndarray,
    donor: np.ndarray,
    support: np.ndarray,
) -> dict[str, Any]:
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]
    source_h, source_w = source.shape[:2]
    observable_full = np.zeros(support.shape, dtype=bool)
    observable_full[:source_h, :source_w] = observable
    donor_full = np.zeros(support.shape, dtype=bool)
    donor_full[:source_h, :source_w] = donor
    reconstructed = support & ~observable_full

    hp = highpass(rgb)
    donor_energy = float(np.mean(np.square(hp[donor_full])))
    reconstructed_inner = reconstructed & ndimage.binary_erosion(support, np.ones((9, 9)))
    reconstruction_energy = float(np.mean(np.square(hp[reconstructed_inner])))
    energy_ratio = reconstruction_energy / max(donor_energy, 1e-9)

    gradient = np.hypot(
        ndimage.sobel(rgb.astype(np.float64), axis=0).mean(axis=2),
        ndimage.sobel(rgb.astype(np.float64), axis=1).mean(axis=2),
    )
    seam = (
        ndimage.binary_dilation(observable_full, np.ones((3, 3)))
        & reconstructed
    )
    normal = support & ~seam & ndimage.binary_erosion(support, np.ones((9, 9)))
    boundary_ratio = float(np.mean(gradient[seam]) / max(np.mean(gradient[normal]), 1e-9))

    extension_start = min(source_h + 32, rgb.shape[0] - 2)
    extension_end = max(extension_start + 1, rgb.shape[0] - 24)
    central = rgb[extension_start:extension_end, 180:620].astype(np.float64)
    central_alpha = alpha[extension_start:extension_end, 180:620] > 0
    row_means = np.array(
        [
            np.mean(central[row][central_alpha[row]], axis=0)
            if central_alpha[row].any()
            else np.zeros(3)
            for row in range(central.shape[0])
        ]
    )
    row_step = np.linalg.norm(np.diff(row_means, axis=0), axis=1)
    positive = row_step[row_step > 1e-6]
    banding_ratio = (
        float(np.percentile(positive, 99.5) / max(np.median(positive), 1e-6))
        if positive.size
        else 0.0
    )

    semi = (alpha > 0) & (alpha < 255)
    depth = ndimage.distance_transform_edt(alpha > 0)
    transition = float(depth[semi].max()) if semi.any() else 0.0
    labels, count = ndimage.label(alpha > 0, np.ones((3, 3)))
    sizes = ndimage.sum(alpha > 0, labels, range(1, count + 1)) if count else []
    visible = int((alpha > 0).sum())
    largest = int(max(sizes)) if len(sizes) else 0

    repetition = repetition_metrics(rgb, reconstructed, support)
    fringe = alpha_fringe_metrics(rgba)
    retention = source_retention_metrics(
        rgb,
        source,
        observable,
        alpha == 255,
    )
    return {
        **retention,
        "reconstructedPixels": int(reconstructed.sum()),
        "textureEnergyRatio": energy_ratio,
        "reconstructionBoundaryGradientRatio": boundary_ratio,
        "rowBandingPeakRatio": banding_ratio,
        "alphaCoverage": float((alpha > 0).mean()),
        "opaqueCoverage": float((alpha == 255).mean()),
        "transparentCoverage": float((alpha == 0).mean()),
        "largestAlphaComponentShare": float(largest / max(visible, 1)),
        "maxAlphaTransitionPixels": transition,
        "maxAlphaFringePixels": fringe["maxFringePixels"],
        "maxAlphaCompositeChannelDelta": fringe["maxCompositeChannelDelta"],
        **repetition,
    }


def metric_failures(metrics: dict[str, Any], config: dict[str, Any]) -> list[str]:
    gates = config["gates"]
    retention = config["retention"]
    checks = [
        (
            gates["sourcePixelRetentionMin"]
            <= metrics["sourcePixelRetention"]
            <= gates["sourcePixelRetentionMax"],
            "source retention",
        ),
        (
            metrics["changedOrMissingObservableSourcePixels"]
            <= gates["changedOrMissingObservableSourcePixelsMax"],
            "observable source pixels",
        ),
        (
            metrics["observableSourcePixels"]
            == retention["observableMaskPixelCount"]
            and metrics["observableMaskSha256"]
            == retention["observableMaskSha256"],
            "observable mask",
        ),
        (
            gates["textureEnergyRatioMin"]
            <= metrics["textureEnergyRatio"]
            <= gates["textureEnergyRatioMax"],
            "texture energy",
        ),
        (
            metrics["reconstructionBoundaryGradientRatio"]
            <= gates["reconstructionBoundaryGradientRatioMax"],
            "reconstruction boundary",
        ),
        (
            metrics["rowBandingPeakRatio"] <= gates["rowBandingPeakRatioMax"],
            "row banding",
        ),
        (
            metrics["duplicatePatchCount"] <= gates["duplicatePatchCountMax"],
            "duplicate patches",
        ),
        (
            metrics["maxNonAdjacentPatchCorrelation"]
            <= gates["nonAdjacentPatchCorrelationMax"],
            "patch correlation",
        ),
        (
            metrics["maxAlphaTransitionPixels"]
            <= gates["alphaTransitionPixelsMax"],
            "alpha transition",
        ),
        (
            metrics["maxAlphaFringePixels"] <= gates["alphaFringePixelsMax"],
            "alpha fringe",
        ),
        (
            gates["alphaCoverageMin"]
            <= metrics["alphaCoverage"]
            <= gates["alphaCoverageMax"],
            "alpha coverage",
        ),
        (
            metrics["largestAlphaComponentShare"]
            >= gates["largestAlphaComponentShareMin"],
            "alpha component",
        ),
    ]
    return [name for passed, name in checks if not passed]


def validate_metrics(metrics: dict[str, Any], config: dict[str, Any]) -> None:
    failed = metric_failures(metrics, config)
    if failed:
        raise ValueError(f"parchment gates failed: {', '.join(failed)}")


def composite(rgba: np.ndarray, background: tuple[int, int, int]) -> Image.Image:
    alpha = rgba[..., 3:4].astype(np.float64) / 255.0
    rgb = rgba[..., :3].astype(np.float64)
    bg = np.asarray(background, dtype=np.float64)
    return Image.fromarray(np.rint(rgb * alpha + bg * (1 - alpha)).astype(np.uint8))


def contact_sheet(
    source: np.ndarray,
    rgba: np.ndarray,
    observable: np.ndarray,
    destination: Path,
) -> None:
    panel_w = 300
    panel_h = 680
    label_h = 28
    canvas = Image.new("RGB", (panel_w * 3, (panel_h + label_h) * 2), (35, 31, 28))
    labels = [
        "approved reference",
        "master on paper",
        "50/50 reference overlay",
        "alpha on black",
        "alpha on white",
        "alpha on parchment",
    ]

    reference = np.zeros_like(rgba)
    height = min(source.shape[0], rgba.shape[0])
    width = min(source.shape[1], rgba.shape[1])
    reference[:height, :width, :3] = source[:height, :width]
    reference[:height, :width, 3] = 255
    overlay = rgba.copy()
    core = overlay[:height, :width, :3].astype(np.float64)
    core = core * 0.5 + source[:height, :width].astype(np.float64) * 0.5
    overlay[:height, :width, :3] = np.rint(core).astype(np.uint8)

    images = [
        Image.fromarray(reference),
        composite(rgba, (236, 220, 199)),
        composite(overlay, (236, 220, 199)),
        composite(rgba, (0, 0, 0)),
        composite(rgba, (255, 255, 255)),
        composite(rgba, (236, 220, 199)),
    ]
    draw = ImageDraw.Draw(canvas)
    for index, (label, image) in enumerate(zip(labels, images)):
        fitted = image.copy()
        fitted.thumbnail((panel_w, panel_h), Image.Resampling.LANCZOS)
        x = index % 3 * panel_w + (panel_w - fitted.width) // 2
        y0 = index // 3 * (panel_h + label_h)
        y = y0 + label_h + (panel_h - fitted.height) // 2
        canvas.paste(fitted.convert("RGB"), (x, y))
        draw.text((index % 3 * panel_w + 8, y0 + 7), label, fill=(238, 225, 205))
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "PNG", optimize=True)


def build(
    config: dict[str, Any],
    *,
    require_green: bool = True,
) -> tuple[Image.Image, dict[str, Any], dict[str, np.ndarray]]:
    source_path = ROOT / config["source"]["path"]
    if sha256(source_path) != config["source"]["sha256"]:
        raise ValueError("approved source SHA mismatch")
    full_source = np.asarray(Image.open(source_path).convert("RGB"))
    if [full_source.shape[1], full_source.shape[0]] != [
        config["source"]["width"],
        config["source"]["height"],
    ]:
        raise ValueError("approved source dimensions mismatch")

    x0, y0, x1, y1 = config["source"]["crop"]
    source = full_source[y0:y1, x0:x1].copy()
    observed_full = observed_sheet_mask(
        full_source[:, x0:x1],
        float(config["silhouette"]["sheetLuma"]),
    )
    observed_full[:int(config["silhouette"]["topEdgeSourceY"])] = False
    observed = observed_full[y0:y1]
    support, alpha = silhouette(observed, config)
    occlusion, fine_occlusion, surface_occlusion = build_occlusion_mask(
        full_source,
        source,
        config,
    )

    source_support = support[:source.shape[0], :source.shape[1]]
    opaque_source = alpha[:source.shape[0], :source.shape[1]] == 255
    yy, xx = np.mgrid[:source.shape[0], :source.shape[1]]
    right = np.max(np.where(source_support, xx, -1), axis=1)
    retention_inset = int(config["silhouette"]["rightEdgeInsetForRetention"])
    observable = (
        observed
        & source_support
        & opaque_source
        & ~occlusion
        & (xx <= right[:, None] - retention_inset)
    )
    donors = donor_mask(observable, occlusion, config)
    illumination = illumination_field(source, donors, config)
    source_residual = source.astype(np.float64) - illumination[:source.shape[0], :source.shape[1]]
    residual, tile_count = synthesize_residual(
        source_residual,
        donors,
        observable,
        support,
        config,
    )
    rgb = np.clip(illumination + residual, 0, 255).astype(np.uint8)
    contextual_fill = cv2.inpaint(
        source,
        occlusion.astype(np.uint8) * 255,
        7,
        cv2.INPAINT_TELEA,
    )
    surface_distance = ndimage.distance_transform_edt(surface_occlusion)
    surface_weight = np.clip(surface_distance / 14.0, 0, 1)[..., None]
    core = rgb[:source.shape[0], :source.shape[1]].astype(np.float64)
    core[surface_occlusion] = (
        contextual_fill[surface_occlusion] * (1 - surface_weight[surface_occlusion])
        + core[surface_occlusion] * surface_weight[surface_occlusion]
    )
    rgb[:source.shape[0], :source.shape[1]] = np.rint(core).astype(np.uint8)
    fine_fill = cv2.inpaint(
        source,
        fine_occlusion.astype(np.uint8) * 255,
        5,
        cv2.INPAINT_TELEA,
    )
    rgb[:source.shape[0], :source.shape[1]][fine_occlusion] = fine_fill[fine_occlusion]
    rgb[:source.shape[0], :source.shape[1]][observable] = source[observable]
    nearest_interior_rgb(rgb, support, alpha)
    rgba = np.dstack([rgb, alpha])
    metrics = quality_metrics(rgba, source, observable, donors, support)
    failures = metric_failures(metrics, config)
    if require_green:
        if failures:
            raise ValueError(f"parchment gates failed: {', '.join(failures)}")

    manifest = {
        "version": 1,
        "algorithm": config["algorithm"],
        "status": "blocked" if failures else "green",
        "gateFailures": failures,
        "source": {
            "path": config["source"]["path"],
            "sha256": config["source"]["sha256"],
            "crop": config["source"]["crop"],
        },
        "provenance": config["provenance"],
        "output": {
            "file": config["output"]["file"],
            "width": config["output"]["width"],
            "height": config["output"]["height"],
            "format": "lossless WebP RGBA",
        },
        "construction": {
            "seed": config["seed"],
            "donorPatchCount": int(len(donor_positions(
                donors,
                int(config["texture"]["patchSize"]),
                int(config["texture"]["donorStride"]),
            ))),
            "placedPatchCount": tile_count,
            "preservation": "decoded approved pixels copied byte-for-byte outside measured UI occlusions",
            "extension": "full-source minimum-cut exemplar quilting; exact repeated patches are gated and visual review remains authoritative",
        },
        "metrics": metrics,
    }
    arrays = {
        "full_source": full_source,
        "source": source,
        "observable": observable,
        "support": support,
        "donor": donors,
    }
    return Image.fromarray(rgba), manifest, arrays


def write_build(
    image: Image.Image,
    manifest: dict[str, Any],
    arrays: dict[str, np.ndarray],
    output_dir: Path,
    manifest_path: Path,
    evidence_dir: Path | None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / manifest["output"]["file"]
    image.save(output_path, "WEBP", lossless=True, method=6, exact=True)
    decoded = np.asarray(Image.open(output_path).convert("RGBA"))
    manifest["output"]["bytes"] = output_path.stat().st_size
    manifest["output"]["sha256"] = sha256(output_path)
    manifest["metrics"].update(source_retention_metrics(
        decoded[..., :3],
        arrays["source"],
        arrays["observable"],
        decoded[..., 3] == 255,
    ))
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    if evidence_dir is not None:
        contact_sheet(
            arrays["source"],
            decoded,
            arrays["observable"],
            evidence_dir / "contact-sheet.png",
        )
        shutil.copy2(manifest_path, evidence_dir / "manifest.json")


def publish_files_atomically(
    publications: list[tuple[Path, Path]],
    *,
    inject_failure_after: int | None = None,
) -> None:
    destinations = [destination.resolve() for _, destination in publications]
    if len(destinations) != len(set(destinations)):
        raise ValueError("publication destinations must be unique")

    staged: list[tuple[Path, Path]] = []
    backups: dict[Path, Path | None] = {}
    installed: list[Path] = []
    replace_count = 0
    try:
        for source, destination in publications:
            if not source.is_file():
                raise FileNotFoundError(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{destination.name}.publish-",
                dir=destination.parent,
            )
            os.close(descriptor)
            temporary = Path(temporary_name)
            shutil.copy2(source, temporary)
            if sha256(temporary) != sha256(source):
                raise ValueError(f"publication staging mismatch: {source}")
            staged.append((temporary, destination))

        for _, destination in staged:
            if destination.exists():
                descriptor, backup_name = tempfile.mkstemp(
                    prefix=f".{destination.name}.rollback-",
                    dir=destination.parent,
                )
                os.close(descriptor)
                backup = Path(backup_name)
                shutil.copy2(destination, backup)
                backups[destination] = backup
            else:
                backups[destination] = None

        for temporary, destination in staged:
            os.replace(temporary, destination)
            installed.append(destination)
            replace_count += 1
            if inject_failure_after == replace_count:
                raise RuntimeError(
                    f"injected failure after replace {replace_count}"
                )
    except BaseException:
        for destination in reversed(installed):
            backup = backups.get(destination)
            if backup is not None and backup.exists():
                os.replace(backup, destination)
            elif destination.exists():
                destination.unlink()
        raise
    finally:
        for temporary, _ in staged:
            if temporary.exists():
                temporary.unlink()
        for backup in backups.values():
            if backup is not None and backup.exists():
                backup.unlink()


def path_is_within(path: Path, directory: Path) -> bool:
    return path.resolve().is_relative_to(directory.resolve())


def validate_output_paths(args: argparse.Namespace) -> None:
    if args.publish:
        return
    paths = [args.output_dir, args.manifest]
    if args.evidence_dir is not None:
        paths.append(args.evidence_dir)
    if any(path_is_within(path, PRODUCTION_DIR) for path in paths):
        raise SystemExit(
            "production title-layer paths require the approved publish flow"
        )


def validate_publish_request(
    config_path: Path,
    config: dict[str, Any],
    approved_source_sha256: str | None,
) -> None:
    if approved_source_sha256 is None:
        raise SystemExit(
            "--publish requires --approved-source-sha256 provenance"
        )
    if (
        config_path.resolve() != DEFAULT_CONFIG.resolve()
        or sha256(config_path) != APPROVED_PUBLISH_CONFIG_SHA256
    ):
        raise SystemExit("--publish requires the pinned publish config")
    if approved_source_sha256 != APPROVED_SOURCE_SHA256:
        raise SystemExit("approved source provenance SHA mismatch")
    source = config["source"]
    approved = config["provenance"]["approvedLosslessComposite"]
    if (
        source["path"] != "docs/design/reference/title-2026-08-11.webp"
        or source["sha256"] != APPROVED_SOURCE_SHA256
        or approved["sha256"] != APPROVED_LOSSLESS_SOURCE_SHA256
        or approved["buildInput"] is not False
    ):
        raise SystemExit("pinned approved-source provenance mismatch")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=STAGING_DIR / "assets")
    parser.add_argument("--manifest", type=Path, default=STAGING_DIR / "manifest.json")
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--diagnostic", action="store_true")
    parser.add_argument("--approved-source-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.publish and args.diagnostic:
        raise SystemExit("--diagnostic may not be combined with --publish")
    validate_output_paths(args)
    config_path = args.config.resolve()
    config = load_config(config_path)
    if args.publish:
        validate_publish_request(
            config_path,
            config,
            args.approved_source_sha256,
        )
        if (
            args.evidence_dir is not None
            and args.evidence_dir.resolve() != EVIDENCE_DIR.resolve()
        ):
            raise SystemExit("--publish requires the pinned evidence directory")
    elif args.approved_source_sha256 is not None:
        raise SystemExit(
            "--approved-source-sha256 is only valid with --publish"
        )
    image, manifest, arrays = build(config, require_green=not args.diagnostic)

    output_dir = (
        PRODUCTION_DIR if args.publish else args.output_dir.resolve()
    )
    manifest_path = (
        Path(__file__).with_name("title-parchment-master.manifest.json")
        if args.publish
        else args.manifest.resolve()
    )
    evidence_dir = (
        EVIDENCE_DIR
        if args.publish
        else args.evidence_dir.resolve()
        if args.evidence_dir is not None
        else None
    )

    scratch_parent = STAGING_DIR / ".staging"
    scratch_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="parchment-master-",
        dir=scratch_parent,
    ) as scratch:
        scratch_root = Path(scratch)
        staged_assets = scratch_root / "assets"
        staged_manifest = scratch_root / "manifest.json"
        staged_evidence = scratch_root / "evidence" if evidence_dir else None
        write_build(
            image,
            manifest,
            arrays,
            staged_assets,
            staged_manifest,
            staged_evidence,
        )
        if args.check or args.publish:
            decoded = Image.open(
                staged_assets / config["output"]["file"]
            ).convert("RGBA")
            assert decoded.size == (
                config["output"]["width"],
                config["output"]["height"],
            )
            if not args.diagnostic:
                validate_metrics(manifest["metrics"], config)
        publications = [
            (
                staged_assets / config["output"]["file"],
                output_dir / config["output"]["file"],
            ),
            (staged_manifest, manifest_path),
        ]
        if evidence_dir and staged_evidence:
            publications.extend(
                [
                    (
                        staged_evidence / "contact-sheet.png",
                        evidence_dir / "contact-sheet.png",
                    ),
                    (
                        staged_evidence / "manifest.json",
                        evidence_dir / "manifest.json",
                    ),
                ]
            )
        publish_files_atomically(publications)

    metrics = manifest["metrics"]
    output_path = output_dir / config["output"]["file"]
    try:
        display_path = output_path.relative_to(ROOT)
    except ValueError:
        display_path = output_path
    print(
        f"{display_path} "
        f"{config['output']['width']}x{config['output']['height']} "
        f"{manifest['output']['bytes']} bytes "
        f"retention={metrics['sourcePixelRetention']:.6f} "
        f"energy={metrics['textureEnergyRatio']:.3f} "
        f"repeat={metrics['duplicatePatchCount']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
