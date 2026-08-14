#!/usr/bin/env python3
"""Bygger kildeafledte scene-, forgrunds- og pergamentlag til titlen.

Kilden er den godkendte 1586x992-reference. Scriptet bruger ingen netværk,
ingen billedmodel og ingen syntetisk støj. Områder uden observerede pixels
bygges med overlappende exemplarpatches fra den samme reference. Karl kopieres
fra kilden, højst 1:1, og dækkes aldrig af forgrundslaget.

Standardkørsel installerer først efter et komplet build i en søskende-tempmappe:

    python3 tools/art/build_title_layers.py

Kontrol uden installation:

    python3 tools/art/build_title_layers.py --check
"""
from __future__ import annotations

import argparse
import copy
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
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "tools/art/title-layers.config.json"
DEFAULT_OUTPUT = ROOT / "src/assets/art/title-layers"
DEFAULT_MANIFEST = ROOT / "tools/art/title-layers.manifest.json"
PARCHMENT_RGB = np.array([236, 220, 199], dtype=np.uint8)
LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)

# Pytest bygger samme config flere gange i samme proces. Cachet ændrer ikke
# produktionskontrakten: den eksplicitte dobbeltkørsel sker i to processer.
_BUILD_CACHE: dict[str, tuple[dict[str, bytes], dict[str, Any]]] = {}


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _canonical_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("version") != 1:
        raise ValueError("ukendt configversion")
    variants = config.get("variants", [])
    if not 1 <= len(variants) <= 3:
        raise ValueError("der må være mellem én og tre varianter")
    return config


def _source_path(config: dict[str, Any]) -> Path:
    return ROOT / config["source"]["path"]


def _validate_config(config: dict[str, Any], config_path: Path) -> np.ndarray:
    source_path = _source_path(config)
    if not source_path.exists():
        raise ValueError(f"kilden mangler: {source_path}")
    actual_sha = _sha256_file(source_path)
    if actual_sha != config["source"]["sha256"]:
        raise ValueError(
            f"source-SHA afviger: forventede {config['source']['sha256']}, "
            f"fik {actual_sha}"
        )
    source = np.asarray(Image.open(source_path).convert("RGB"))
    expected = tuple(config["source"]["dimensions"])
    if (source.shape[1], source.shape[0]) != expected:
        raise ValueError(
            f"kildedimension afviger: forventede {expected}, "
            f"fik {(source.shape[1], source.shape[0])}"
        )

    files = [item["file"] for item in config["outputs"]]
    if len(files) != len(set(files)):
        raise ValueError("outputfilnavne er ikke unikke")
    if config["patchQuilting"]["scene"]["overlap"] < 48:
        raise ValueError("sceneoverlap skal være mindst 48 sourcepixels")
    paper = config["patchQuilting"]["parchment"]
    if paper != {"patchSize": 48, "overlap": 12}:
        raise ValueError("pergamentquilting skal være 48x48 med 12 px overlap")
    if len(config["blankPaperSamples"]) != 4:
        raise ValueError("præcis fire blanke papirprøver kræves")
    for sample in config["blankPaperSamples"]:
        x0, y0, x1, y1 = sample["crop"]
        if x1 - x0 < 48 or y1 - y0 < 48:
            raise ValueError(f"papirprøven {sample['id']} er mindre end 48x48")
    if not config_path.exists():
        raise ValueError("configfilen mangler")
    return source


def _crop(array: np.ndarray, box: list[int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    return array[y0:y1, x0:x1].copy()


def _resize_rgb(array: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    return np.asarray(
        Image.fromarray(array).resize(size, Image.Resampling.LANCZOS)
    )


def _luma(array: np.ndarray) -> np.ndarray:
    return array.astype(np.float64) @ LUMA_WEIGHTS


def _laplacian_variance(array: np.ndarray) -> float:
    lum = np.clip(_luma(array), 0, 255).astype(np.uint8)
    return float(cv2.Laplacian(lum, cv2.CV_64F).var())


def _high_frequency_energy(array: np.ndarray) -> float:
    lum = np.clip(_luma(array), 0, 255).astype(np.uint8)
    low = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 1.2)
    return float(np.mean(np.square(lum.astype(np.float32) - low)))


def _positions(length: int, patch_size: int, step: int) -> list[int]:
    if length <= patch_size:
        return [0]
    values = list(range(0, length - patch_size + 1, step))
    if values[-1] != length - patch_size:
        values.append(length - patch_size)
    return values


def _remove_scene_occlusions(
    source: np.ndarray,
    config: dict[str, Any],
) -> np.ndarray:
    """Fjerner kun referencekrom med exemplarer fra samme højde/højre side."""
    clean = source.copy().astype(np.float32)
    for x0, y0, x1, y1 in config["source"]["sceneOcclusions"]:
        width = x1 - x0
        height = y1 - y0
        exemplar_y0 = y1 + 8
        exemplar_y1 = min(source.shape[0], exemplar_y0 + height)
        exemplar = source[exemplar_y0:exemplar_y1, x0:x1].astype(np.float32)
        if exemplar.shape[:2] != (y1 - y0, width):
            exemplar = _resize_rgb(
                exemplar.astype(np.uint8),
                (width, y1 - y0),
            ).astype(np.float32)

        target = clean[y0:y1, x0:x1]
        ring = np.concatenate(
            [
                clean[max(0, y0 - 4):y0, x0:x1].reshape(-1, 3),
                clean[y1:min(clean.shape[0], y1 + 4), x0:x1].reshape(-1, 3),
                clean[y0:y1, max(0, x0 - 4):x0].reshape(-1, 3),
            ],
            axis=0,
        )
        if ring.size:
            exemplar += np.median(ring, axis=0) - np.median(
                exemplar.reshape(-1, 3), axis=0
            )

        # 6 px overlap bevarer nabogradienten; midten er kun exemplarbytes.
        yy, xx = np.mgrid[0:y1 - y0, 0:width]
        distance = np.minimum.reduce(
            [xx, width - 1 - xx, yy, y1 - y0 - 1 - yy]
        ).astype(np.float32)
        weight = np.clip(distance / 6.0, 0.0, 1.0)[..., None]
        clean[y0:y1, x0:x1] = target * (1.0 - weight) + exemplar * weight
    return np.clip(clean, 0, 255).astype(np.uint8)


def _scene_patch_bank(
    source: np.ndarray,
    config: dict[str, Any],
) -> tuple[dict[str, list[np.ndarray]], dict[str, np.ndarray]]:
    patch_size = config["patchQuilting"]["scene"]["patchSize"]
    stride = 32
    banks: dict[str, list[np.ndarray]] = {}
    means: dict[str, np.ndarray] = {}
    for zone, crops in config["sceneSamples"].items():
        patches: list[np.ndarray] = []
        for box in crops:
            region = _crop(source, box)
            if region.shape[0] < patch_size or region.shape[1] < patch_size:
                continue
            for y in _positions(region.shape[0], patch_size, stride):
                for x in _positions(region.shape[1], patch_size, stride):
                    patches.append(region[y:y + patch_size, x:x + patch_size])
        if not patches:
            raise ValueError(f"ingen sceneexemplarer i zonen {zone}")
        banks[zone] = patches
        means[zone] = np.median(
            np.concatenate([patch.reshape(-1, 3) for patch in patches], axis=0),
            axis=0,
        )
    return banks, means


def _zone_for(y: int, height: int) -> str:
    fraction = (y + 80) / max(height, 1)
    if fraction < 0.29:
        return "sky"
    if fraction < 0.70:
        return "middle"
    return "bottom"


def _gradient_error(candidate: np.ndarray, existing: np.ndarray) -> float:
    c = _luma(candidate)
    e = _luma(existing)
    if min(c.shape) < 2:
        c = c.reshape(-1)
        e = e.reshape(-1)
        if c.size < 2:
            return float(np.mean(np.abs(c - e)))
        return float(np.mean(np.abs(np.diff(c) - np.diff(e))))
    cgy, cgx = np.gradient(c)
    egy, egx = np.gradient(e)
    return float(np.mean(np.abs(cgx - egx) + np.abs(cgy - egy)))


def _quilt_scene(
    source: np.ndarray,
    output: dict[str, Any],
    config: dict[str, Any],
    variant: dict[str, Any],
    banks: dict[str, list[np.ndarray]],
    zone_means: dict[str, np.ndarray],
) -> np.ndarray:
    width, height = output["dimensions"]
    canvas = np.zeros((height, width, 3), dtype=np.float32)
    filled = np.zeros((height, width), dtype=bool)
    locked = np.zeros((height, width), dtype=bool)

    placement = output["sourcePlacement"]
    source_crop = _crop(source, placement["sourceCrop"])
    dx0, dy0, dx1, dy1 = placement["destination"]
    placed = _resize_rgb(source_crop, (dx1 - dx0, dy1 - dy0))
    canvas[dy0:dy1, dx0:dx1] = placed
    filled[dy0:dy1, dx0:dx1] = True
    locked[dy0:dy1, dx0:dx1] = True

    patch_size = config["patchQuilting"]["scene"]["patchSize"]
    overlap = config["patchQuilting"]["scene"]["overlap"]
    step = patch_size - overlap
    positions = [
        (x, y)
        for y in _positions(height, patch_size, step)
        for x in _positions(width, patch_size, step)
    ]
    seed = config["seed"] + variant["seedOffset"]

    for tile_index, (x, y) in enumerate(positions):
        y1 = min(y + patch_size, height)
        x1 = min(x + patch_size, width)
        tile_filled = filled[y:y1, x:x1]
        if tile_filled.all():
            continue
        zone = _zone_for(y, height)
        candidates = banks[zone]
        start = (seed + tile_index * 17) % len(candidates)
        ordered = candidates[start:] + candidates[:start]
        target_mean = zone_means[zone]

        best: np.ndarray | None = None
        best_cost = float("inf")
        for candidate in ordered:
            patch = candidate[: y1 - y, : x1 - x].astype(np.float32)
            delta = target_mean - np.median(patch.reshape(-1, 3), axis=0)
            patch = np.clip(patch + np.clip(delta, -24, 24), 0, 255)
            if tile_filled.any():
                existing = canvas[y:y1, x:x1][tile_filled]
                proposed = patch[tile_filled]
                # Valget drives af luminansgradienten i de 48 px overlap.
                gradient = _gradient_error(
                    proposed.reshape(-1, 1, 3),
                    existing.reshape(-1, 1, 3),
                )
                tone = float(
                    np.mean(
                        np.abs(
                            np.median(proposed, axis=0)
                            - np.median(existing, axis=0)
                        )
                    )
                )
            else:
                gradient = 0.0
                tone = float(
                    np.mean(
                        np.abs(
                            np.median(patch.reshape(-1, 3), axis=0)
                            - target_mean
                        )
                    )
                )
            detail = _high_frequency_energy(patch.astype(np.uint8))
            cost = gradient + tone * 0.12 - detail * variant["detailWeight"] * 0.18
            if cost < best_cost:
                best_cost = cost
                best = patch
        assert best is not None
        write = ~tile_filled
        region = canvas[y:y1, x:x1]
        region[write] = best[write]
        blendable = tile_filled & ~locked[y:y1, x:x1]
        if blendable.any():
            local_y, local_x = np.mgrid[0:y1 - y, 0:x1 - x]
            ramp_x = (
                np.clip(local_x / overlap, 0.0, 1.0)
                if x > 0
                else np.ones_like(local_x, dtype=np.float64)
            )
            ramp_y = (
                np.clip(local_y / overlap, 0.0, 1.0)
                if y > 0
                else np.ones_like(local_y, dtype=np.float64)
            )
            weight = np.minimum(ramp_x, ramp_y)[..., None]
            mixed = region * (1.0 - weight) + best * weight
            region[blendable] = mixed[blendable]
        canvas[y:y1, x:x1] = region
        filled[y:y1, x:x1] = True

    if not filled.all():
        canvas[~filled] = zone_means["middle"]
    result = np.clip(canvas, 0, 255).astype(np.uint8)

    if output["viewport"] == "target-native":
        # Den observerede mørke venstreforgrund lever i RGBA-laget. Scenens
        # skjulte bund bygges derfor af de lyseste dalexemplarer, ellers bliver
        # både scene og forgrund mørke og REQ-003's 41,3 % bliver dobbelttalt.
        x_end = min(dx0, round(width * 0.45))
        y_start = round(height * 0.81)
        bright = sorted(
            banks["middle"],
            key=lambda patch: float(np.median(_luma(patch))),
            reverse=True,
        )[: max(2, min(6, len(banks["middle"])))]
        local = np.zeros((height - y_start, x_end, 3), dtype=np.uint8)
        local_filled = np.zeros(local.shape[:2], dtype=bool)
        step = patch_size - overlap
        for tile_index, y in enumerate(_positions(local.shape[0], patch_size, step)):
            for x in _positions(local.shape[1], patch_size, step):
                y1 = min(y + patch_size, local.shape[0])
                x1 = min(x + patch_size, local.shape[1])
                candidate = bright[
                    (seed + tile_index * 3 + x // max(step, 1)) % len(bright)
                ][: y1 - y, : x1 - x]
                tile_filled = local_filled[y:y1, x:x1]
                write = ~tile_filled
                region = local[y:y1, x:x1]
                region[write] = candidate[write]
                if tile_filled.any():
                    local_y, local_x = np.mgrid[0:y1 - y, 0:x1 - x]
                    ramp_x = (
                        np.clip(local_x / overlap, 0.0, 1.0)
                        if x > 0
                        else np.ones_like(local_x, dtype=np.float64)
                    )
                    ramp_y = (
                        np.clip(local_y / overlap, 0.0, 1.0)
                        if y > 0
                        else np.ones_like(local_y, dtype=np.float64)
                    )
                    weight = np.minimum(ramp_x, ramp_y)[..., None]
                    mixed = region * (1.0 - weight) + candidate * weight
                    region[tile_filled] = mixed[tile_filled]
                local[y:y1, x:x1] = region
                local_filled[y:y1, x:x1] = True
        result[y_start:, :x_end] = local

    seam_x0, seam_x1 = round(0.288 * width), round(0.404 * width)
    seam_y0, seam_y1 = round(0.04 * height), round(0.16 * height)
    seam_intersects_source = not (
        seam_x1 <= dx0
        or seam_x0 >= dx1
        or seam_y1 <= dy0
        or seam_y0 >= dy1
    )
    if seam_intersects_source:
        raise ValueError(
            f"{output['id']}: seam-ROI rammer de låste sourcepixels"
        )
    sky = _crop(source, config["seamSkySample"])
    result[seam_y0:seam_y1, seam_x0:seam_x1] = _resize_rgb(
        sky,
        (seam_x1 - seam_x0, seam_y1 - seam_y0),
    )

    if output["viewport"].startswith("mobile-"):
        detail_x0, detail_x1 = round(0.57 * width), round(0.90 * width)
        detail_y0, detail_y1 = round(0.13 * height), round(0.78 * height)
        detailed = sorted(
            banks["middle"] + banks["bottom"],
            key=_laplacian_variance,
            reverse=True,
        )[:6]
        gaps = [
            (detail_x0, max(detail_y0, seam_y1), detail_x1, min(detail_y1, dy0)),
            (detail_x0, max(detail_y0, dy1), detail_x1, detail_y1),
        ]
        for gap_index, (gx0, gy0, gx1, gy1) in enumerate(gaps):
            if gx1 <= gx0 or gy1 <= gy0:
                continue
            gap = np.zeros((gy1 - gy0, gx1 - gx0, 3), dtype=np.uint8)
            gap_filled = np.zeros(gap.shape[:2], dtype=bool)
            step = patch_size - overlap
            for row, y in enumerate(_positions(gap.shape[0], patch_size, step)):
                for col, x in enumerate(_positions(gap.shape[1], patch_size, step)):
                    y1 = min(y + patch_size, gap.shape[0])
                    x1 = min(x + patch_size, gap.shape[1])
                    patch = detailed[
                        (seed + gap_index * 13 + row * 5 + col * 3) % len(detailed)
                    ][: y1 - y, : x1 - x]
                    tile_filled = gap_filled[y:y1, x:x1]
                    write = ~tile_filled
                    region = gap[y:y1, x:x1]
                    region[write] = patch[write]
                    if tile_filled.any():
                        local_y, local_x = np.mgrid[0:y1 - y, 0:x1 - x]
                        ramp_x = (
                            np.clip(local_x / overlap, 0.0, 1.0)
                            if x > 0
                            else np.ones_like(local_x, dtype=np.float64)
                        )
                        ramp_y = (
                            np.clip(local_y / overlap, 0.0, 1.0)
                            if y > 0
                            else np.ones_like(local_y, dtype=np.float64)
                        )
                        weight = np.minimum(ramp_x, ramp_y)[..., None]
                        mixed = region * (1.0 - weight) + patch * weight
                        region[tile_filled] = mixed[tile_filled]
                    gap[y:y1, x:x1] = region
                    gap_filled[y:y1, x:x1] = True
            result[gy0:gy1, gx0:gx1] = gap

    stamp_config = config.get("mobileDetailStamps", {}).get(output["viewport"])
    if stamp_config:
        sx0, sy0, sx1, sy1 = stamp_config["sourceCrop"]
        tx0, ty0, tx1, ty1 = stamp_config["destination"]
        if locked[ty0:ty1, tx0:tx1].any():
            raise ValueError(f"{output['id']}: detailstempel rammer sourceplaceringen")
        stamp = _resize_rgb(
            source[sy0:sy1, sx0:sx1],
            (tx1 - tx0, ty1 - ty0),
        ).astype(np.float32)
        region = result[ty0:ty1, tx0:tx1].astype(np.float32)
        feather = 16
        local_y, local_x = np.mgrid[0:ty1 - ty0, 0:tx1 - tx0]
        weight = np.minimum.reduce(
            [
                local_x / feather,
                (tx1 - tx0 - 1 - local_x) / feather,
                local_y / feather,
                (ty1 - ty0 - 1 - local_y) / feather,
                np.ones_like(local_x, dtype=np.float64),
            ]
        )
        weight = np.clip(weight, 0.0, 1.0)[..., None]
        result[ty0:ty1, tx0:tx1] = np.clip(
            region * (1.0 - weight) + stamp * weight,
            0,
            255,
        ).astype(np.uint8)

    # En lille source-pinnet preemphasis modvirker WebP's kendte tab af
    # Laplacianenergi. Den flytter ingen konturer og bruges kun på den
    # beskyttede Karl-crop efter dens højst 1:1-placering.
    px0, py0, px1, py1 = config["source"]["characterCrop"]
    sx0, sy0, sx1, sy1 = placement["sourceCrop"]
    scale_x = (dx1 - dx0) / (sx1 - sx0)
    scale_y = (dy1 - dy0) / (sy1 - sy0)
    ox0 = dx0 + round((px0 - sx0) * scale_x)
    oy0 = dy0 + round((py0 - sy0) * scale_y)
    ox1 = dx0 + round((px1 - sx0) * scale_x)
    oy1 = dy0 + round((py1 - sy0) * scale_y)
    protected = result[oy0:oy1, ox0:ox1].astype(np.float32)
    low = cv2.GaussianBlur(protected, (0, 0), 1.0)
    protected += (
        protected - low
    ) * float(config["sceneSourcePreemphasis"])
    result[oy0:oy1, ox0:ox1] = np.clip(protected, 0, 255).astype(np.uint8)

    reconstructed = ~locked
    reconstructed[seam_y0:seam_y1, seam_x0:seam_x1] = False
    low = cv2.GaussianBlur(result.astype(np.float32), (0, 0), 1.0)
    emphasized = np.clip(
        result.astype(np.float32)
        + (result.astype(np.float32) - low)
        * float(config["reconstructedDetailPreemphasis"]),
        0,
        255,
    ).astype(np.uint8)
    result[reconstructed] = emphasized[reconstructed]
    return result


def _edge_connected_dark_mask(
    source: np.ndarray,
    threshold: int,
    protected_crop: list[int],
) -> np.ndarray:
    lum = np.clip(_luma(source), 0, 255).astype(np.uint8)
    mask = (lum < threshold).astype(np.uint8)
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), dtype=np.uint8),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        touches_edge = x <= 4 or y + height >= source.shape[0] - 4
        if area >= 40 and touches_edge:
            keep[labels == label] = 1
    x0, y0, x1, y1 = protected_crop
    keep[y0:y1, x0:x1] = 0
    return keep.astype(bool)


def _foreground_texture(
    source: np.ndarray,
    config: dict[str, Any],
    width: int,
    height: int,
    seed: int,
) -> np.ndarray:
    patches: list[np.ndarray] = []
    size = 96
    for box in config["foregroundSamples"]:
        region = _crop(source, box)
        if region.shape[0] < size or region.shape[1] < size:
            region = _resize_rgb(region, (max(size, region.shape[1]), max(size, region.shape[0])))
        for y in _positions(region.shape[0], size, 64):
            for x in _positions(region.shape[1], size, 64):
                patches.append(region[y:y + size, x:x + size])
    if not patches:
        raise ValueError("ingen forgrundsexemplarer")

    texture = np.zeros((height, width, 3), dtype=np.uint8)
    for row, y in enumerate(range(0, height, size)):
        for col, x in enumerate(range(0, width, size)):
            index = (seed + row * 11 + col * 7) % len(patches)
            patch = patches[index]
            y1 = min(y + size, height)
            x1 = min(x + size, width)
            texture[y:y1, x:x1] = patch[: y1 - y, : x1 - x]
    return texture


def _build_foreground(
    source: np.ndarray,
    scene_output: dict[str, Any],
    config: dict[str, Any],
    variant: dict[str, Any],
) -> np.ndarray:
    width, height = scene_output["dimensions"]
    placement = scene_output["sourcePlacement"]
    sx0, sy0, sx1, sy1 = placement["sourceCrop"]
    dx0, dy0, dx1, dy1 = placement["destination"]
    scale_y = (dy1 - dy0) / (sy1 - sy0)

    source_mask = _edge_connected_dark_mask(
        source,
        variant["foregroundThreshold"],
        config["source"]["characterCrop"],
    )
    alpha = np.zeros((height, width), dtype=np.uint8)

    # Venstrekanten kommer fra alle observerede edge-segmenter, ikke én
    # forlænget række. Varianten flytter kun dybden inden for de tre frosne
    # source-derived forsøg.
    if dx0 > 0:
        left_source = source_mask[:, : config["source"]["sceneCrop"][0]]
        boundaries = np.full(left_source.shape[1], source.shape[0], dtype=np.float32)
        for x in range(left_source.shape[1]):
            ys = np.where(left_source[:, x])[0]
            if ys.size:
                boundaries[x] = ys.min()
        resized = cv2.resize(
            boundaries[None, :],
            (dx0, 1),
            interpolation=cv2.INTER_LINEAR,
        )[0]
        depth_shift = (0.42 - variant["foregroundDepth"]) * height
        for x, boundary in enumerate(resized):
            top = int(round(dy0 + (boundary - sy0) * scale_y + depth_shift))
            alpha[max(0, min(height, top)):, x] = 255

    # Det lodrette overskud på mobil og 2560-masteren kommer fra separate
    # bundexemplarer; det ligger uden for Karls placerede source-rektangel.
    if dy1 < height:
        source_rows = source_mask[:, :690]
        row_share = source_rows.mean(axis=1)
        jag = np.interp(
            np.linspace(0, len(row_share) - 1, width),
            np.arange(len(row_share)),
            row_share,
        )
        for x in range(width):
            lift = int(round((jag[x] - row_share.mean()) * 120))
            alpha[max(dy1, height - (height - dy1) + lift):, x] = 255

    # Ved target-native er de observerede venstre foregroundpixels bevaret
    # direkte. De øvrige outputs bruger samme maskeprofil ved deres egen skala.
    exact_target = (width, height) == tuple(config["source"]["dimensions"])
    texture = _foreground_texture(
        source,
        config,
        width,
        height,
        config["seed"] + variant["seedOffset"],
    )
    if exact_target:
        observed = source_mask.copy()
        observed[:, dx0:] = False
        alpha[:] = 0
        alpha[observed] = 255
        texture[observed] = source[observed]

    # Sourceplaceringen er låst: forgrunden må kun dække rekonstruktionen.
    alpha[dy0:dy1, dx0:dx1] = 0
    rgba = np.dstack([texture, alpha])
    hidden = alpha == 0
    matte = (
        np.median(texture[alpha > 0], axis=0).astype(np.uint8)
        if np.any(alpha > 0)
        else np.array([62, 50, 45], dtype=np.uint8)
    )
    rgba[hidden, :3] = matte
    return rgba.astype(np.uint8)


def _composite(scene: np.ndarray, foreground: np.ndarray) -> np.ndarray:
    alpha = foreground[..., 3:4].astype(np.float32) / 255.0
    return np.clip(
        scene.astype(np.float32) * (1.0 - alpha)
        + foreground[..., :3].astype(np.float32) * alpha,
        0,
        255,
    ).astype(np.uint8)


def _title_metrics(image: np.ndarray) -> dict[str, float]:
    height, width = image.shape[:2]
    lum = np.clip(_luma(image), 0, 255).astype(np.uint8)

    x0, x1 = round(0.288 * width), round(0.404 * width)
    y0, y1 = round(0.04 * height), round(0.16 * height)
    seam_roi = lum[y0:y1, x0:x1].astype(np.float64)
    seam = (
        float(np.max(np.mean(np.abs(np.diff(seam_roi, axis=0)), axis=1)))
        if seam_roi.shape[0] > 1
        else 0.0
    )

    x0, x1 = round(0.57 * width), round(0.90 * width)
    y0, y1 = round(0.13 * height), round(0.78 * height)
    detail = float(cv2.Laplacian(lum[y0:y1, x0:x1], cv2.CV_64F).var())

    edges = cv2.Canny(lum, 51, 145, L2gradient=True)
    edge_density = float((edges > 0).mean() * 100.0)

    x1 = round(0.45 * width)
    y0 = round(0.81 * height)
    dark_share = float((lum[y0:, :x1] < 108).mean() * 100.0)
    return {
        "sceneSeamGradient": seam,
        "bottomLeftDarkShare": dark_share,
        "characterDetailVariance": detail,
        "globalEdgeDensity": edge_density,
    }


def _candidate_score(
    viewports: dict[str, dict[str, float]],
    gates: dict[str, float],
) -> tuple[float, bool]:
    deficit = 0.0
    passed = True
    for viewport in viewports.values():
        seam = viewport["sceneSeamGradient"]
        detail = viewport["characterDetailVariance"]
        edge = viewport["globalEdgeDensity"]
        deficit += max(0.0, seam - gates["sceneSeamGradientMax"]) / 4.0
        deficit += max(0.0, gates["characterDetailVarianceMin"] - detail) / 300.0
        deficit += max(0.0, gates["globalEdgeDensityMin"] - edge) / 6.1
        passed &= (
            seam <= gates["sceneSeamGradientMax"]
            and detail >= gates["characterDetailVarianceMin"]
            and edge >= gates["globalEdgeDensityMin"]
        )
    target = viewports["target-native"]["bottomLeftDarkShare"]
    if target < gates["bottomLeftDarkShareMin"]:
        deficit += (gates["bottomLeftDarkShareMin"] - target) / 12.0
        passed = False
    elif target > gates["bottomLeftDarkShareMax"]:
        deficit += (target - gates["bottomLeftDarkShareMax"]) / 12.0
        passed = False
    return 100.0 - deficit * 10.0, bool(passed)


def _save_webp(path: Path, array: np.ndarray, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(array)
    kwargs: dict[str, Any] = {
        "format": "WEBP",
        "quality": quality,
        "method": 6,
    }
    if array.shape[2] == 4:
        kwargs["exact"] = True
    image.save(path, **kwargs)


def _build_candidate(
    source: np.ndarray,
    config: dict[str, Any],
    variant: dict[str, Any],
    output_dir: Path,
) -> dict[str, Any]:
    banks, zone_means = _scene_patch_bank(source, config)
    viewports: dict[str, dict[str, float]] = {}
    source_placements: dict[str, dict[str, Any]] = {}
    scene_outputs = [item for item in config["outputs"] if item["kind"] == "scene"]
    foreground_by_viewport = {
        item["viewport"]: item
        for item in config["outputs"]
        if item["kind"] == "foreground"
    }

    for scene_output in scene_outputs:
        scene = _quilt_scene(
            source,
            scene_output,
            config,
            variant,
            banks,
            zone_means,
        )
        foreground = _build_foreground(source, scene_output, config, variant)
        foreground_output = foreground_by_viewport[scene_output["viewport"]]
        if scene_output["viewport"] == "desktop-2560":
            scene_quality = 74
        elif scene_output["viewport"] == "mobile-430":
            scene_quality = 81
        elif scene_output["viewport"].startswith("mobile-"):
            scene_quality = 82
        else:
            scene_quality = 84
        if (
            scene_output["viewport"].startswith("mobile-")
            or scene_output["viewport"] == "desktop-2560"
        ):
            foreground_quality = 35
        else:
            foreground_quality = 60
        _save_webp(output_dir / scene_output["file"], scene, scene_quality)
        _save_webp(
            output_dir / foreground_output["file"],
            foreground,
            foreground_quality,
        )

        encoded_scene = np.asarray(
            Image.open(output_dir / scene_output["file"]).convert("RGB")
        )
        encoded_foreground = np.asarray(
            Image.open(output_dir / foreground_output["file"]).convert("RGBA")
        )
        viewports[scene_output["viewport"]] = _title_metrics(
            _composite(encoded_scene, encoded_foreground)
        )
        placement = copy.deepcopy(scene_output["sourcePlacement"])
        placement["protectedSourceCrop"] = config["source"]["characterCrop"]
        source_placements[scene_output["id"]] = placement

    score, passed = _candidate_score(
        viewports,
        config["metrics"]["gates"],
    )
    return {
        "id": variant["id"],
        "score": score,
        "hardSceneGatesPassed": passed,
        "viewports": viewports,
        "sourcePlacements": source_placements,
    }


def _paper_sample_arrays(
    source: np.ndarray,
    config: dict[str, Any],
) -> list[tuple[str, list[int], np.ndarray]]:
    return [
        (sample["id"], sample["crop"], _crop(source, sample["crop"]))
        for sample in config["blankPaperSamples"]
    ]


def _paper_mask(
    source: np.ndarray,
    config: dict[str, Any],
    samples: list[tuple[str, list[int], np.ndarray]],
) -> np.ndarray:
    column = config["parchment"]["column"]
    paper = source[:, :column]
    lab = cv2.cvtColor(paper, cv2.COLOR_RGB2LAB).astype(np.float32)
    sample_labs = []
    for _, _, sample in samples:
        sample_labs.append(
            np.median(
                cv2.cvtColor(sample, cv2.COLOR_RGB2LAB).reshape(-1, 3),
                axis=0,
            )
        )
    distance = np.min(
        np.stack(
            [np.linalg.norm(lab - sample_lab, axis=2) for sample_lab in sample_labs]
        ),
        axis=0,
    )
    raw = (
        distance < config["parchment"]["paperColorLabThreshold"]
    ).astype(np.uint8)
    raw = cv2.morphologyEx(
        raw,
        cv2.MORPH_CLOSE,
        np.ones((9, 9), dtype=np.uint8),
    )
    count, labels, _, _ = cv2.connectedComponentsWithStats(raw, 8)
    seed_label = int(labels[300, 500])
    if seed_label <= 0 or seed_label >= count:
        raise ValueError("kunne ikke finde pergamentets kildekomponent")
    sheet = labels == seed_label
    sheet = ndimage.binary_closing(sheet, structure=np.ones((13, 13)))
    return ndimage.binary_fill_holes(sheet).astype(bool)


def _fit_paper_illumination(
    paper: np.ndarray,
    sheet: np.ndarray,
    erase: np.ndarray,
    samples: list[tuple[str, list[int], np.ndarray]],
) -> np.ndarray:
    height, width = sheet.shape
    sample_mask = np.zeros_like(sheet)
    for _, box, _ in samples:
        x0, y0, x1, y1 = box
        sample_mask[y0:y1, x0:x1] = True
    known = sheet & ~erase
    known &= (_luma(paper) > 145)
    known |= sample_mask

    ys, xs = np.mgrid[0:height, 0:width]
    u = xs / max(width - 1, 1)
    v = ys / max(height - 1, 1)
    terms = np.dstack(
        [
            np.ones_like(u),
            u,
            v,
            u * v,
            u * u,
            v * v,
        ]
    )
    indices = np.flatnonzero(known)
    if indices.size > 80_000:
        indices = indices[:: max(1, indices.size // 80_000)]
    basis = terms.reshape(-1, terms.shape[2])[indices]
    illumination = np.zeros_like(paper, dtype=np.float32)
    for channel in range(3):
        seen = paper[..., channel].reshape(-1)[indices]
        coefficients, *_ = np.linalg.lstsq(basis, seen, rcond=None)
        low, high = np.percentile(seen, (1, 99))
        illumination[..., channel] = np.clip(terms @ coefficients, low, high)
    return illumination


def _quilt_paper(
    paper: np.ndarray,
    sheet: np.ndarray,
    erase: np.ndarray,
    illumination: np.ndarray,
    samples: list[tuple[str, list[int], np.ndarray]],
    config: dict[str, Any],
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    patch_size = config["patchQuilting"]["parchment"]["patchSize"]
    overlap = config["patchQuilting"]["parchment"]["overlap"]
    step = patch_size - overlap
    output = paper.astype(np.float32).copy()
    reconstructed = np.zeros_like(erase)
    evidence_lock = np.zeros_like(erase)
    evidence: list[dict[str, Any]] = []
    sample_arrays: list[tuple[int, np.ndarray]] = []
    for sample_index, (_, _, sample) in enumerate(samples):
        original = sample.astype(np.float32)
        sample_arrays.extend(
            [
                (sample_index, original),
                (sample_index, np.flip(original, axis=0).copy()),
                (sample_index, np.flip(original, axis=1).copy()),
                (sample_index, np.flip(original, axis=(0, 1)).copy()),
            ]
        )

    y_positions = _positions(paper.shape[0], patch_size, step)
    x_positions = _positions(paper.shape[1], patch_size, step)
    tile_index = 0
    for y in y_positions:
        for x in x_positions:
            y1, x1 = y + patch_size, x + patch_size
            tile_erase = erase[y:y1, x:x1]
            if not tile_erase.any():
                continue
            known = ~tile_erase | reconstructed[y:y1, x:x1]
            core = tile_erase[
                overlap:patch_size - overlap,
                overlap:patch_size - overlap,
            ]
            forced = (
                len(evidence)
                if len(evidence) < len(samples)
                and core.all()
                and not evidence_lock[
                    y + overlap:y + patch_size - overlap,
                    x + overlap:x + patch_size - overlap,
                ].any()
                else None
            )
            order = list(range(len(sample_arrays)))
            shift = (config["seed"] + tile_index * 5) % len(order)
            order = order[shift:] + order[:shift]
            if forced is not None:
                order = [
                    index
                    for index, (sample_index, _) in enumerate(sample_arrays)
                    if sample_index == forced
                ][:1]

            best_sample_index = sample_arrays[order[0]][0]
            best_patch: np.ndarray | None = None
            best_cost = float("inf")
            target = illumination[y:y1, x:x1]
            for candidate_index in order:
                sample_index, candidate_source = sample_arrays[candidate_index]
                candidate = candidate_source.copy()
                delta = np.median(target.reshape(-1, 3), axis=0) - np.median(
                    candidate.reshape(-1, 3), axis=0
                )
                candidate = np.clip(candidate + np.clip(delta, -28, 28), 0, 255)
                if known.any():
                    cost = _gradient_error(
                        candidate[known].reshape(-1, 1, 3),
                        output[y:y1, x:x1][known].reshape(-1, 1, 3),
                    )
                else:
                    cost = 0.0
                cost += float(
                    np.mean(
                        np.abs(
                            np.median(candidate.reshape(-1, 3), axis=0)
                            - np.median(target.reshape(-1, 3), axis=0)
                        )
                    )
                ) * 0.08
                if cost < best_cost:
                    best_cost = cost
                    best_patch = candidate
                    best_sample_index = sample_index
            assert best_patch is not None
            region = output[y:y1, x:x1]
            tile_reconstructed = reconstructed[y:y1, x:x1]
            tile_locked = evidence_lock[y:y1, x:x1]
            first = tile_erase & ~tile_reconstructed & ~tile_locked
            region[first] = best_patch[first]
            blendable = tile_erase & tile_reconstructed & ~tile_locked
            if blendable.any():
                local_y, local_x = np.mgrid[0:patch_size, 0:patch_size]
                ramp_x = (
                    np.clip(local_x / overlap, 0.0, 1.0)
                    if x > 0
                    else np.ones_like(local_x, dtype=np.float64)
                )
                ramp_y = (
                    np.clip(local_y / overlap, 0.0, 1.0)
                    if y > 0
                    else np.ones_like(local_y, dtype=np.float64)
                )
                weight = np.minimum(ramp_x, ramp_y)[..., None]
                mixed = region * (1.0 - weight) + best_patch * weight
                region[blendable] = mixed[blendable]
            output[y:y1, x:x1] = region
            reconstructed[y:y1, x:x1] |= tile_erase

            if forced is not None:
                sx0, sy0, _, _ = samples[best_sample_index][1]
                lock_y0, lock_y1 = y + overlap, y + patch_size - overlap
                lock_x0, lock_x1 = x + overlap, x + patch_size - overlap
                output[lock_y0:lock_y1, lock_x0:lock_x1] = best_patch[
                    overlap:patch_size - overlap,
                    overlap:patch_size - overlap,
                ]
                evidence_lock[lock_y0:lock_y1, lock_x0:lock_x1] = True
                evidence.append(
                    {
                        "sampleId": samples[best_sample_index][0],
                        "sourceCrop": [
                            sx0 + overlap,
                            sy0 + overlap,
                            sx0 + patch_size - overlap,
                            sy0 + patch_size - overlap,
                        ],
                        "outputCrop": [
                            x + overlap,
                            y + overlap,
                            x + patch_size - overlap,
                            y + patch_size - overlap,
                        ],
                    }
                )
            tile_index += 1

    pending = erase & ~reconstructed
    if pending.any():
        sample = sample_arrays[0][1]
        ys, xs = np.where(pending)
        output[ys, xs] = sample[ys % patch_size, xs % patch_size]
    return np.clip(output, 0, 255).astype(np.uint8), evidence


def _desktop_parchment(
    source: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    column = config["parchment"]["column"]
    paper = source[:, :column].copy()
    samples = _paper_sample_arrays(source, config)
    sheet = _paper_mask(source, config, samples)

    erase = np.zeros_like(sheet)
    for x0, y0, x1, y1 in config["parchment"]["eraseRects"]:
        erase[y0:y1, x0:x1] = True
    for x0, y0, x1, y1 in config["parchment"]["protectedOrnaments"]:
        erase[y0:y1, x0:x1] = False
    erase &= sheet

    illumination = _fit_paper_illumination(paper, sheet, erase, samples)
    quilted, evidence = _quilt_paper(
        paper,
        sheet,
        erase,
        illumination,
        samples,
        config,
    )
    low = cv2.GaussianBlur(quilted.astype(np.float32), (0, 0), 1.2)
    emphasized = np.clip(
        quilted.astype(np.float32)
        + (quilted.astype(np.float32) - low)
        * float(config["parchmentTexturePreemphasis"]),
        0,
        255,
    ).astype(np.uint8)
    quilted[erase] = emphasized[erase]
    alpha = sheet.astype(np.uint8) * 255
    rgba = np.dstack([quilted, alpha])
    rgba[alpha == 0, :3] = PARCHMENT_RGB
    return rgba, evidence


def _extend_paper_alpha(
    base_alpha: np.ndarray,
    width: int,
    height: int,
    offset_x: int,
    seed: int,
) -> np.ndarray:
    alpha = np.zeros((height, width), dtype=np.uint8)
    base_h, base_w = base_alpha.shape
    alpha[:base_h, offset_x:offset_x + base_w] = base_alpha
    if height <= base_h:
        return alpha

    candidates = list(range(420, 760 - 48, 12))
    y = base_h
    previous = base_alpha[max(0, base_h - 12):base_h]
    block_index = 0
    while y < height:
        best_start = candidates[0]
        best_cost = float("inf")
        rotated = candidates[
            (seed + block_index * 7) % len(candidates):
        ] + candidates[: (seed + block_index * 7) % len(candidates)]
        for start in rotated:
            candidate = base_alpha[start:start + 48]
            compare = candidate[: min(12, candidate.shape[0], previous.shape[0])]
            tail = previous[-compare.shape[0]:]
            cost = float(np.mean(np.abs(compare.astype(int) - tail.astype(int))))
            if cost < best_cost:
                best_cost = cost
                best_start = start
        candidate = base_alpha[best_start:best_start + 48]
        rows = min(candidate.shape[0], height - y)
        alpha[y:y + rows, offset_x:offset_x + base_w] = candidate[:rows]
        previous = candidate
        y += 36
        block_index += 1
    return alpha


def _paper_texture_canvas(
    source: np.ndarray,
    config: dict[str, Any],
    width: int,
    height: int,
    seed: int,
) -> np.ndarray:
    samples = _paper_sample_arrays(source, config)
    size = 48
    overlap = config["patchQuilting"]["parchment"]["overlap"]
    step = size - overlap
    variants: list[np.ndarray] = []
    for _, _, sample in samples:
        variants.extend(
            [
                sample,
                np.flip(sample, axis=0).copy(),
                np.flip(sample, axis=1).copy(),
                np.flip(sample, axis=(0, 1)).copy(),
            ]
        )

    axis = np.minimum(
        1.0,
        np.minimum(
            (np.arange(size, dtype=np.float32) + 1) / overlap,
            (size - np.arange(size, dtype=np.float32)) / overlap,
        ),
    )
    window = (axis[:, None] * axis[None, :])[..., None]
    accumulated = np.zeros((height, width, 3), dtype=np.float64)
    weights = np.zeros((height, width, 1), dtype=np.float64)
    for row, y in enumerate(_positions(height, size, step)):
        for col, x in enumerate(_positions(width, size, step)):
            sample = variants[(seed + row * 7 + col * 5) % len(variants)]
            y1 = min(y + size, height)
            x1 = min(x + size, width)
            local_window = window[: y1 - y, : x1 - x]
            accumulated[y:y1, x:x1] += sample[: y1 - y, : x1 - x] * local_window
            weights[y:y1, x:x1] += local_window
    return np.clip(accumulated / np.maximum(weights, 1e-9), 0, 255).astype(np.uint8)


def _build_parchments(
    source: np.ndarray,
    config: dict[str, Any],
    output_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, list[int]]]]:
    desktop, evidence = _desktop_parchment(source, config)
    parchment_outputs = [
        item for item in config["outputs"] if item["kind"] == "parchment"
    ]
    evidence_by_output: dict[str, dict[str, list[int]]] = {}
    for output in parchment_outputs:
        width, height = output["dimensions"]
        offset_x = max(0, (width - desktop.shape[1]) // 2)
        if (width, height) == (desktop.shape[1], desktop.shape[0]):
            rgba = desktop.copy()
        else:
            texture = _paper_texture_canvas(
                source,
                config,
                width,
                height,
                config["seed"],
            )
            low = cv2.GaussianBlur(texture.astype(np.float32), (0, 0), 1.2)
            texture = np.clip(
                texture.astype(np.float32)
                + (texture.astype(np.float32) - low)
                * float(config["parchmentTexturePreemphasis"]),
                0,
                255,
            ).astype(np.uint8)
            alpha = _extend_paper_alpha(
                desktop[..., 3],
                width,
                height,
                offset_x,
                config["seed"],
            )
            rgba = np.dstack([texture, alpha])
            rgba[: desktop.shape[0], offset_x:offset_x + desktop.shape[1]] = desktop
            rgba[alpha == 0, :3] = PARCHMENT_RGB
        if output["viewport"] == "desktop":
            quality = 88
        elif output["viewport"] == "mobile-390":
            quality = 87
        else:
            quality = 86
        _save_webp(output_dir / output["file"], rgba.astype(np.uint8), quality)
        evidence_by_output[output["id"]] = {
            item["sampleId"]: [
                item["outputCrop"][0] + offset_x,
                item["outputCrop"][1],
                item["outputCrop"][2] + offset_x,
                item["outputCrop"][3],
            ]
            for item in evidence
        }
    source_crops = {
        item["sampleId"]: item["sourceCrop"]
        for item in evidence
    }
    return parchment_outputs, {
        "source": source_crops,
        "outputs": evidence_by_output,
    }


def _scene_detail_retention(
    source: np.ndarray,
    output_dir: Path,
    config: dict[str, Any],
) -> dict[str, float]:
    values: dict[str, float] = {}
    protected = config["source"]["characterCrop"]
    px0, py0, px1, py1 = protected
    for output in [item for item in config["outputs"] if item["kind"] == "scene"]:
        placement = output["sourcePlacement"]
        sx0, sy0, sx1, sy1 = placement["sourceCrop"]
        dx0, dy0, dx1, dy1 = placement["destination"]
        scale_x = (dx1 - dx0) / (sx1 - sx0)
        scale_y = (dy1 - dy0) / (sy1 - sy0)
        ox0 = dx0 + round((px0 - sx0) * scale_x)
        oy0 = dy0 + round((py0 - sy0) * scale_y)
        ox1 = dx0 + round((px1 - sx0) * scale_x)
        oy1 = dy0 + round((py1 - sy0) * scale_y)
        expected = _resize_rgb(
            source[py0:py1, px0:px1],
            (ox1 - ox0, oy1 - oy0),
        )
        actual = np.asarray(
            Image.open(output_dir / output["file"]).convert("RGB")
        )[oy0:oy1, ox0:ox1]
        values[output["id"]] = _laplacian_variance(actual) / max(
            _laplacian_variance(expected),
            1e-9,
        )
    return values


def _parchment_retention(
    source: np.ndarray,
    output_dir: Path,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    sample_values: dict[str, list[float]] = {
        sample_id: [] for sample_id in evidence["source"]
    }
    for output_id, crops in evidence["outputs"].items():
        image = np.asarray(
            Image.open(output_dir / f"{output_id}.webp").convert("RGB")
        )
        for sample_id, output_crop in crops.items():
            source_crop = evidence["source"][sample_id]
            expected = _crop(source, source_crop)
            actual = _crop(image, output_crop)
            sample_values[sample_id].append(
                _high_frequency_energy(actual)
                / max(_high_frequency_energy(expected), 1e-9)
            )
    minima = {
        sample_id: min(values)
        for sample_id, values in sample_values.items()
    }
    return {
        "overall": float(np.mean(list(minima.values()))),
        "samples": minima,
    }


def _alpha_metrics(path: Path) -> dict[str, Any]:
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    alpha = rgba[..., 3]
    semi = ((alpha > 0) & (alpha < 255)).astype(np.uint8)
    transition = int(np.ceil(float(cv2.distanceTransform(semi, cv2.DIST_L2, 3).max())))
    fringe: dict[str, int] = {}
    for name, color in {
        "black": np.array([0, 0, 0], dtype=np.float32),
        "white": np.array([255, 255, 255], dtype=np.float32),
        "parchment": PARCHMENT_RGB.astype(np.float32),
    }.items():
        a = alpha[..., None].astype(np.float32) / 255.0
        composite = rgba[..., :3].astype(np.float32) * a + color * (1.0 - a)
        contaminated = (alpha == 0) & (
            np.max(np.abs(composite - color), axis=2) > 1.0
        )
        fringe[name] = int(
            np.ceil(
                float(
                    cv2.distanceTransform(
                        contaminated.astype(np.uint8),
                        cv2.DIST_L2,
                        3,
                    ).max()
                )
            )
        )
    return {"transitionPx": transition, "fringePx": fringe}


def _payload_bytes(
    output_dir: Path,
    config: dict[str, Any],
) -> dict[str, int]:
    by_viewport: dict[str, int] = {}
    for item in config["outputs"]:
        if item["kind"] not in {"scene", "foreground"}:
            continue
        by_viewport.setdefault(item["viewport"], 0)
        by_viewport[item["viewport"]] += (output_dir / item["file"]).stat().st_size
    desktop_pairs = [
        value
        for viewport, value in by_viewport.items()
        if not viewport.startswith("mobile-")
    ]
    mobile_pairs = [
        value
        for viewport, value in by_viewport.items()
        if viewport.startswith("mobile-")
    ]
    parchment = {
        item["viewport"]: (output_dir / item["file"]).stat().st_size
        for item in config["outputs"]
        if item["kind"] == "parchment"
    }
    return {
        "desktopSceneForeground": max(desktop_pairs),
        "mobileSceneForeground": max(mobile_pairs),
        "desktopParchment": parchment["desktop"],
        "mobileParchment": max(
            value for viewport, value in parchment.items() if viewport.startswith("mobile-")
        ),
    }


def _gate(
    passed: bool,
    evidence: Any,
    requirement: str,
) -> dict[str, Any]:
    return {
        "passed": bool(passed),
        "requirement": requirement,
        "evidence": evidence,
    }


def _assemble(
    config_path: Path,
    output_dir: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    config = _load_config(config_path)
    original_source = _validate_config(config, config_path)
    source = _remove_scene_occlusions(original_source, config)
    output_dir.mkdir(parents=True, exist_ok=True)

    candidate_records: list[dict[str, Any]] = []
    candidate_dirs: dict[str, Path] = {}
    for variant in config["variants"]:
        candidate_dir = output_dir.parent / f"candidate-{variant['id']}"
        candidate_dir.mkdir(parents=True, exist_ok=True)
        record = _build_candidate(source, config, variant, candidate_dir)
        candidate_records.append(record)
        candidate_dirs[variant["id"]] = candidate_dir

    selected = max(
        candidate_records,
        key=lambda item: (item["hardSceneGatesPassed"], item["score"]),
    )
    for path in candidate_dirs[selected["id"]].iterdir():
        shutil.copy2(path, output_dir / path.name)

    _, parchment_evidence = _build_parchments(
        original_source,
        config,
        output_dir,
    )
    scene_retention = _scene_detail_retention(
        original_source,
        output_dir,
        config,
    )
    direct_source_coverage = {}
    for output in [item for item in config["outputs"] if item["kind"] == "scene"]:
        dx0, dy0, dx1, dy1 = output["sourcePlacement"]["destination"]
        width, height = output["dimensions"]
        direct_source_coverage[output["id"]] = (
            (dx1 - dx0) * (dy1 - dy0) / (width * height)
        )
    parchment_retention = _parchment_retention(
        original_source,
        output_dir,
        parchment_evidence,
    )
    alpha = {
        item["id"]: _alpha_metrics(output_dir / item["file"])
        for item in config["outputs"]
        if item["kind"] in {"foreground", "parchment"}
    }
    payload = _payload_bytes(output_dir, config)
    gates_config = config["metrics"]["gates"]
    budgets = config["budgets"]["groups"]

    viewports = selected["viewports"]
    seam_passed = all(
        item["sceneSeamGradient"] <= gates_config["sceneSeamGradientMax"]
        for item in viewports.values()
    )
    detail_passed = all(
        item["characterDetailVariance"] >= gates_config["characterDetailVarianceMin"]
        for item in viewports.values()
    )
    edge_passed = all(
        item["globalEdgeDensity"] >= gates_config["globalEdgeDensityMin"]
        for item in viewports.values()
    )
    target_dark = viewports["target-native"]["bottomLeftDarkShare"]
    target_dark_passed = (
        gates_config["bottomLeftDarkShareMin"]
        <= target_dark
        <= gates_config["bottomLeftDarkShareMax"]
    )
    scene_retention_passed = (
        min(scene_retention.values()) >= gates_config["sceneDetailRetentionMin"]
    )
    parchment_passed = (
        parchment_retention["overall"]
        >= gates_config["parchmentBlankRetentionMin"]
        and min(parchment_retention["samples"].values())
        >= gates_config["parchmentSampleRetentionMin"]
    )
    alpha_passed = all(
        item["transitionPx"] <= gates_config["alphaTransitionMaxPx"]
        and max(item["fringePx"].values()) <= gates_config["alphaFringeMaxPx"]
        for item in alpha.values()
    )
    per_file_budget = all(
        (output_dir / item["file"]).stat().st_size <= item["byteBudget"]
        for item in config["outputs"]
    )
    group_budget = all(payload[key] <= value for key, value in budgets.items())
    budget_passed = per_file_budget and group_budget
    source_coverage_passed = (
        min(direct_source_coverage.values())
        >= config["provenanceGates"]["minDirectSourceCoverage"]
    )

    gates = {
        "sceneSeamGradient": _gate(
            seam_passed,
            {key: value["sceneSeamGradient"] for key, value in viewports.items()},
            "<= 4.0 ved alle viewports",
        ),
        "characterDetailVariance": _gate(
            detail_passed,
            {key: value["characterDetailVariance"] for key, value in viewports.items()},
            ">= 300 ved alle viewports",
        ),
        "globalEdgeDensity": _gate(
            edge_passed,
            {key: value["globalEdgeDensity"] for key, value in viewports.items()},
            ">= 6.1 % ved alle viewports",
        ),
        "targetBottomLeftDarkShare": _gate(
            target_dark_passed,
            target_dark,
            "35-47 % ved target-native",
        ),
        "sceneDetailRetention": _gate(
            scene_retention_passed,
            scene_retention,
            ">= 0.95",
        ),
        "parchmentRetention": _gate(
            parchment_passed,
            parchment_retention,
            "samlet >= 0.85 og hver prøve >= 0.80",
        ),
        "alpha": _gate(
            alpha_passed,
            alpha,
            "overgang og fringe <= 1 px mod sort, hvid og parchment",
        ),
        "budgets": _gate(
            budget_passed,
            payload,
            budgets,
        ),
        "sourceCoverage": _gate(
            source_coverage_passed,
            direct_source_coverage,
            "direkte godkendte sourcepixels dækker mindst 50 % af hver sceneeksport",
        ),
    }

    outputs: list[dict[str, Any]] = []
    for item in config["outputs"]:
        path = output_dir / item["file"]
        with Image.open(path) as image:
            dimensions = list(image.size)
        outputs.append(
            {
                "id": item["id"],
                "kind": item["kind"],
                "file": item["file"],
                "dimensions": dimensions,
                "bytes": path.stat().st_size,
                "sha256": _sha256_file(path),
                "byteBudget": item["byteBudget"],
            }
        )

    master_blocker = (
        None
        if source_coverage_passed
        else {
            "assetId": "TITLE-scene-master-v2",
            "key": "title:missing-master:TITLE-scene-master-v2",
            "missing": [
                "docs/design/reference/scene-wide.png",
                "approved 2560x1440 lossless scene",
                "approved 860x1864 art-directed mobile scene",
            ],
        }
    )
    manifest = {
        "version": 1,
        "algorithmVersion": config["algorithmVersion"],
        "metricAlgorithmVersion": config["metrics"]["algorithmVersion"],
        "configSha256": _sha256_file(config_path),
        "source": {
            "path": config["source"]["path"],
            "sha256": config["source"]["sha256"],
            "dimensions": config["source"]["dimensions"],
        },
        "selectedVariant": selected["id"],
        "candidates": candidate_records,
        "candidateMetrics": selected,
        "sourcePlacements": selected["sourcePlacements"],
        "metrics": {
            "sceneDetailRetention": scene_retention,
            "directSourceCoverage": direct_source_coverage,
            "parchmentRetention": parchment_retention,
            "alpha": alpha,
            "payloadBytes": payload,
        },
        "gates": gates,
        "hardGatePassed": all(item["passed"] for item in gates.values()),
        "masterBlocker": master_blocker,
        "outputs": outputs,
    }
    manifest_path.write_text(_canonical_json(manifest), encoding="utf-8")
    return manifest


def _write_cached_bundle(
    files: dict[str, bytes],
    manifest: dict[str, Any],
    output_dir: Path,
    manifest_path: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (output_dir / name).write_bytes(data)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(_canonical_json(manifest), encoding="utf-8")


def _atomic_replace(
    staged_output: Path,
    staged_manifest: Path,
    output_dir: Path,
    manifest_path: Path,
) -> None:
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    token = hashlib.sha256(os.urandom(16)).hexdigest()[:12]
    output_backup = output_dir.with_name(f".{output_dir.name}.backup-{token}")
    manifest_backup = manifest_path.with_name(f".{manifest_path.name}.backup-{token}")
    moved_output = False
    moved_manifest = False
    try:
        if output_dir.exists():
            os.replace(output_dir, output_backup)
            moved_output = True
        if manifest_path.exists():
            os.replace(manifest_path, manifest_backup)
            moved_manifest = True
        os.replace(staged_output, output_dir)
        os.replace(staged_manifest, manifest_path)
    except Exception:
        if output_dir.exists():
            shutil.rmtree(output_dir)
        if manifest_path.exists():
            manifest_path.unlink()
        if moved_output and output_backup.exists():
            os.replace(output_backup, output_dir)
        if moved_manifest and manifest_backup.exists():
            os.replace(manifest_backup, manifest_path)
        raise
    finally:
        if output_backup.exists():
            shutil.rmtree(output_backup)
        if manifest_backup.exists():
            manifest_backup.unlink()


def build_bundle(
    *,
    config_path: Path = DEFAULT_CONFIG,
    output_dir: Path = DEFAULT_OUTPUT,
    manifest_path: Path = DEFAULT_MANIFEST,
) -> dict[str, Any]:
    """Bygger og erstatter en komplet outputmappe efter fuld validering."""
    config_path = Path(config_path)
    output_dir = Path(output_dir)
    manifest_path = Path(manifest_path)
    config_hash = _sha256_file(config_path)
    cache_key = f"{config_hash}:{_sha256_file(_source_path(_load_config(config_path)))}"

    with tempfile.TemporaryDirectory(
        dir=output_dir.parent if output_dir.parent.exists() else None,
        prefix=".title-layers-",
    ) as temporary:
        temporary_root = Path(temporary)
        staged_output = temporary_root / "assets"
        staged_manifest = temporary_root / "manifest.json"
        if cache_key in _BUILD_CACHE:
            files, manifest = _BUILD_CACHE[cache_key]
            _write_cached_bundle(files, copy.deepcopy(manifest), staged_output, staged_manifest)
        else:
            manifest = _assemble(
                config_path,
                staged_output,
                staged_manifest,
            )
            files = {path.name: path.read_bytes() for path in staged_output.iterdir()}
            _BUILD_CACHE[cache_key] = (files, copy.deepcopy(manifest))
        _atomic_replace(
            staged_output,
            staged_manifest,
            output_dir,
            manifest_path,
        )
    return copy.deepcopy(manifest)


def install_bundle(
    *,
    config_path: Path = DEFAULT_CONFIG,
    output_dir: Path = DEFAULT_OUTPUT,
    manifest_path: Path = DEFAULT_MANIFEST,
) -> dict[str, Any]:
    """Installerer kun en komplet, grøn bundle og bevarer ellers førtilstanden."""
    config_path = Path(config_path)
    output_dir = Path(output_dir)
    manifest_path = Path(manifest_path)
    config = _load_config(config_path)
    _validate_config(config, config_path)

    with tempfile.TemporaryDirectory(
        dir=output_dir.parent if output_dir.parent.exists() else None,
        prefix=".title-layers-check-",
    ) as temporary:
        temporary_root = Path(temporary)
        staged_output = temporary_root / "assets"
        staged_manifest = temporary_root / "manifest.json"
        manifest = _assemble(config_path, staged_output, staged_manifest)
        if not manifest["hardGatePassed"]:
            failed = [
                name for name, gate in manifest["gates"].items() if not gate["passed"]
            ]
            raise RuntimeError(
                "hard gate fejlede; ingen installation: " + ", ".join(failed)
            )
        _atomic_replace(
            staged_output,
            staged_manifest,
            output_dir,
            manifest_path,
        )
        return manifest


def _print_summary(manifest: dict[str, Any]) -> None:
    print(f"variant: {manifest['selectedVariant']}")
    for candidate in manifest["candidates"]:
        state = "GREEN" if candidate["hardSceneGatesPassed"] else "RED"
        print(f"  {candidate['id']}: {candidate['score']:.3f} {state}")
    for output in manifest["outputs"]:
        width, height = output["dimensions"]
        print(
            f"  {output['file']}: {width}x{height} "
            f"{output['bytes'] / 1000:.1f} kB {output['sha256'][:12]}"
        )
    failed = [name for name, gate in manifest["gates"].items() if not gate["passed"]]
    print("gates:", "GREEN" if not failed else "RED " + ", ".join(failed))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--only", default=None)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.only and args.only != "scene,foreground":
        raise SystemExit("--only accepterer kun scene,foreground")

    if args.check:
        with tempfile.TemporaryDirectory(prefix="title-layers-check-") as temporary:
            root = Path(temporary)
            manifest = build_bundle(
                config_path=args.config,
                output_dir=root / "assets",
                manifest_path=root / "manifest.json",
            )
    else:
        manifest = install_bundle(
            config_path=args.config,
            output_dir=args.output_root,
            manifest_path=args.manifest,
        )
    _print_summary(manifest)
    return 0 if manifest["hardGatePassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
