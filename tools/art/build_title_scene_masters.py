#!/usr/bin/env python3
"""Bygger scene-only titelmastere af lokale, SHA-pinnede kilder.

Den kanoniske titelreference leverer alle synlige scene- og Karl-pixels.
Det committede `bg-wide.png` leverer kun de nye lærredsarealer. Ingen
netværksservice, model eller patch-quilting indgår.

Begge kandidater er fail-closed. Scriptet måler, tegner evidens og skriver
manifestet, men promoverer aldrig noget til `docs/design/reference/`:

* den brede kandidat genbruger sit eget kantterræn i sidefeltet
  (`sourceReuseCorrelation` 0,756 over grænsen 0,72), og
* begge kandidater forlænger lærredet nedad ved at SPEJLE de godkendte
  rækker om række 991 — en rekonstruktion, ikke en observation.

Promovering kræver både grønne automatiske porte, en manuel godkendelse der
er bundet til kandidatens, evidensens, generatorens og configens hash, og at
kørslen faktisk peger på de publiceringsstier configen udpeger.
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
from typing import Any, Iterable, Sequence

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "tools/art/title-scene-masters.config.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    return json.loads(path.read_text())


def resolve(path: str) -> Path:
    return (ROOT / path).resolve()


def verify_source(spec: dict[str, Any]) -> np.ndarray:
    path = resolve(spec["path"])
    if sha256(path) != spec["sha256"]:
        raise ValueError(f"{spec['path']}: SHA-256 matcher ikke config")
    image = np.asarray(Image.open(path).convert("RGB"))
    if (image.shape[1], image.shape[0]) != (spec["width"], spec["height"]):
        raise ValueError(f"{spec['path']}: dimensioner matcher ikke config")
    return image


def smoothstep(values: np.ndarray) -> np.ndarray:
    return values * values * (3.0 - 2.0 * values)


def mix(first: np.ndarray, second: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    return np.clip(first * (1.0 - alpha) + second * alpha, 0, 255)


def reinhard_grade(
    image: np.ndarray,
    target: np.ndarray,
    strength: float = 0.82,
) -> np.ndarray:
    source_lab = cv2.cvtColor(
        image.astype(np.float32) / 255.0,
        cv2.COLOR_RGB2LAB,
    )
    target_lab = cv2.cvtColor(
        target.astype(np.float32) / 255.0,
        cv2.COLOR_RGB2LAB,
    )
    source_flat = source_lab.reshape(-1, 3)
    target_flat = target_lab.reshape(-1, 3)
    source_mean = source_flat.mean(0)
    source_std = source_flat.std(0)
    target_mean = target_flat.mean(0)
    target_std = target_flat.std(0)
    graded_lab = (
        (source_lab - source_mean)
        * (target_std / np.maximum(source_std, 1e-5))
        + target_mean
    )
    graded = np.clip(
        cv2.cvtColor(graded_lab.astype(np.float32), cv2.COLOR_LAB2RGB) * 255.0,
        0,
        255,
    )
    return np.clip(
        image.astype(np.float32) * (1.0 - strength) + graded * strength,
        0,
        255,
    ).astype(np.uint8)


def rounded_tool_mask(
    shape: tuple[int, int],
    config: dict[str, Any],
    shift_x: int = 0,
) -> np.ndarray:
    height, width = shape
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    radius = int(config["toolMask"]["radius"])
    for x0, y0, x1, y1 in config["toolOcclusions"]:
        x0 = max(0, int(x0) - shift_x)
        x1 = min(width, int(x1) - shift_x)
        if x1 > x0:
            draw.rounded_rectangle(
                (x0, int(y0), x1 - 1, int(y1) - 1),
                radius=radius,
                fill=255,
            )
    dilation = int(config["toolMask"]["dilationPixels"])
    return cv2.dilate(
        np.asarray(image),
        np.ones((dilation, dilation), np.uint8),
    )


def reconstruct_tools(scene: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    """Fortsætter klippen op gennem de to skjulte tool-flader."""
    result = cv2.cvtColor(scene, cv2.COLOR_RGB2BGR)
    for x0, y0, x1, y1 in config["toolOcclusions"]:
        width = int(x1 - x0)
        height = int(y1 - y0)
        donor = scene[y1 : y1 + height, x0:x1][::-1].copy()
        target_mean = scene[y1 : y1 + 4, x0:x1].mean((0, 1))
        donor_mean = donor[-4:].mean((0, 1))
        donor = np.clip(
            donor.astype(np.float32) + target_mean - donor_mean,
            0,
            255,
        ).astype(np.uint8)
        mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (5, 5, width - 6, height - 6),
            radius=18,
            fill=255,
        )
        result = cv2.seamlessClone(
            cv2.cvtColor(donor, cv2.COLOR_RGB2BGR),
            result,
            np.asarray(mask),
            ((x0 + x1) // 2, (y0 + y1) // 2),
            cv2.NORMAL_CLONE,
        )
    return cv2.cvtColor(result, cv2.COLOR_BGR2RGB)


def align_wide_landscape(
    image: np.ndarray,
    spec: dict[str, Any],
) -> np.ndarray:
    height, width = image.shape[:2]
    mapping = spec["landscapeAlignment"]
    source_y = np.interp(
        np.arange(height),
        np.asarray(mapping["outputY"], dtype=np.float32),
        np.asarray(mapping["inputY"], dtype=np.float32),
    ).astype(np.float32)
    map_x = np.tile(np.arange(width, dtype=np.float32), (height, 1))
    map_y = np.tile(source_y[:, None], (1, width))
    return cv2.remap(
        image,
        map_x,
        map_y,
        cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def apply_tools(
    output: np.ndarray,
    reconstructed: np.ndarray,
    original: np.ndarray,
    placement: tuple[int, int],
    config: dict[str, Any],
    shift_x: int,
) -> np.ndarray:
    x, y = placement
    height, width = reconstructed.shape[:2]
    hidden = rounded_tool_mask((height, width), config, shift_x)
    alpha = cv2.GaussianBlur(
        hidden.astype(np.float32) / 255.0,
        (0, 0),
        float(config["toolMask"]["featherSigma"]),
    )[..., None]
    region = output[y : y + height, x : x + width].astype(np.float32)
    region = mix(region, reconstructed.astype(np.float32), alpha)
    region[hidden == 0] = original[hidden == 0]
    output[y : y + height, x : x + width] = region.astype(np.uint8)
    return hidden


def build_wide(
    scene: np.ndarray,
    reconstructed_scene: np.ndarray,
    landscape: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, dict[str, Any]]:
    spec = config["wide"]
    height, width = int(spec["height"]), int(spec["width"])
    scaled_width = round(landscape.shape[1] * height / landscape.shape[0])
    base = cv2.resize(
        landscape,
        (scaled_width, height),
        interpolation=cv2.INTER_LANCZOS4,
    )
    left = int(spec["landscapeCropLeft"])
    base = base[:, left : left + width]
    base = align_wide_landscape(base, spec)
    base = reinhard_grade(base, scene[:, :205])

    x, y = (int(value) for value in spec["sourcePlacement"])
    source_height, source_width = scene.shape[:2]
    output = base.astype(np.float32)

    side = spec["sideField"]
    side_width = int(side["width"])
    donor_width = int(side["donorWidth"])
    donor = reconstructed_scene[:, :donor_width][:, ::-1]
    donor = cv2.resize(
        donor,
        (side_width, source_height),
        interpolation=cv2.INTER_CUBIC,
    )
    side_field = np.empty((height, side_width, 3), dtype=np.uint8)
    side_field[:source_height] = donor
    fade_height = min(
        int(side["bottomFadeHeight"]),
        height - source_height,
    )
    side_field[source_height : source_height + fade_height] = donor[
        -fade_height - 1 : -1
    ][::-1]
    side_field[source_height + fade_height :] = side_field[
        source_height + fade_height - 1
    ]
    side_x = smoothstep(np.linspace(0, 1, side_width))[None, :, None]
    side_y = np.ones(height, dtype=np.float32)
    side_y[source_height : source_height + fade_height] = smoothstep(
        np.linspace(1, 0, fade_height)
    )
    side_y[source_height + fade_height :] = 0
    output[:, x - side_width : x] = mix(
        output[:, x - side_width : x],
        side_field.astype(np.float32),
        side_x * side_y[:, None, None],
    )

    bottom_height = min(
        int(spec["bottomFieldHeight"]),
        height - source_height,
        source_height - 1,
    )
    bottom = reconstructed_scene[
        -bottom_height - 1 : -1
    ][::-1].astype(np.float32)
    bottom_alpha = smoothstep(
        np.linspace(1, 0, bottom_height)
    )[:, None, None]
    output[
        source_height : source_height + bottom_height,
        x : x + source_width,
    ] = mix(
        output[
            source_height : source_height + bottom_height,
            x : x + source_width,
        ],
        bottom,
        bottom_alpha,
    )

    result = np.clip(output, 0, 255).astype(np.uint8)
    result[y : y + source_height, x : x + source_width] = scene
    hidden = apply_tools(
        result,
        reconstructed_scene,
        scene,
        (x, y),
        config,
        0,
    )
    return result, {
        "sourceCrop": [0, 0, source_width, source_height],
        "sourcePlacement": [x, y],
        "hiddenMask": hidden,
        "sideDonor": donor,
        "sideRect": [x - side_width, 0, side_width, source_height],
    }


def build_portrait(
    scene: np.ndarray,
    reconstructed_scene: np.ndarray,
    landscape: np.ndarray,
    config: dict[str, Any],
) -> tuple[np.ndarray, dict[str, Any]]:
    spec = config["portrait"]
    width, height = int(spec["width"]), int(spec["height"])
    x0, y0, x1, y1 = (int(value) for value in spec["sourceCrop"])
    original = scene[y0:y1, x0:x1]
    reconstructed = reconstructed_scene[y0:y1, x0:x1]
    lx0, ly0, lx1, ly1 = (int(value) for value in spec["landscapeCrop"])
    base = landscape[ly0:ly1, lx0:lx1]
    base = cv2.resize(
        base,
        (width, height),
        interpolation=cv2.INTER_LANCZOS4,
    )
    base = reinhard_grade(base, scene[:, :205]).astype(np.float32)
    source_height, source_width = original.shape[:2]

    bottom_height = min(
        int(spec["bottomFieldHeight"]),
        height - source_height,
        source_height - 1,
    )
    bottom = reconstructed[-bottom_height - 1 : -1][::-1].astype(np.float32)
    bottom_alpha = smoothstep(
        np.linspace(1, 0, bottom_height)
    )[:, None, None]
    base[source_height : source_height + bottom_height] = mix(
        base[source_height : source_height + bottom_height],
        bottom,
        bottom_alpha,
    )

    result = np.clip(base, 0, 255).astype(np.uint8)
    result[:source_height, :source_width] = original
    hidden = apply_tools(
        result,
        reconstructed,
        original,
        (0, 0),
        config,
        x0,
    )
    return result, {
        "sourceCrop": [x0, y0, source_width, source_height],
        "sourcePlacement": [0, 0],
        "hiddenMask": hidden,
    }


def rec709(image: np.ndarray) -> np.ndarray:
    rgb = image.astype(np.float64)
    return np.rint(
        rgb[..., 0] * 0.2126
        + rgb[..., 1] * 0.7152
        + rgb[..., 2] * 0.0722
    ).astype(np.uint8)


def normalized_correlation(first: np.ndarray, second: np.ndarray) -> float:
    first_gray = rec709(first).astype(np.float64)
    second_gray = rec709(second).astype(np.float64)
    first_high = first_gray - cv2.GaussianBlur(first_gray, (0, 0), 2.0)
    second_high = second_gray - cv2.GaussianBlur(second_gray, (0, 0), 2.0)
    left = first_high.reshape(-1)
    right = second_high.reshape(-1)
    if np.std(left) < 1e-9 or np.std(right) < 1e-9:
        return 0.0
    return float(np.corrcoef(left, right)[0, 1])


def luma(image: np.ndarray) -> np.ndarray:
    rgb = image.astype(np.float64)
    return (
        rgb[..., 0] * 0.2126
        + rgb[..., 1] * 0.7152
        + rgb[..., 2] * 0.0722
    )


def high_pass(values: np.ndarray) -> np.ndarray:
    return values - cv2.GaussianBlur(values, (0, 0), 2.0)


def mirror_correlation_profile(
    high: np.ndarray,
    band: int,
    gap: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Pearson-korrelation mellem båndet over en akse og båndet under, spejlvendt.

    `gap=0` lægger aksen MELLEM række y-1 og y. `gap=1` lægger aksen PÅ række y
    og udelader den fra begge bånd — det er den refleksion numpys `reflect` og
    OpenCVs `BORDER_REFLECT_101` laver, og præcis den `[::-1]`-forlængelse
    denne pipeline selv bruger. Uden `gap=1` måler man billedet mod sig selv
    forskudt én række, og en eksakt spejling ser kun ud som ~0,76.
    """
    height, width = high.shape
    axes = np.arange(band, height - band - gap + 1)
    count = float(band * width)
    row_sum = high.sum(axis=1)
    row_square = (high * high).sum(axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(row_sum)])
    cumulative_square = np.concatenate([[0.0], np.cumsum(row_square)])
    sum_above = cumulative[axes] - cumulative[axes - band]
    sum_below = cumulative[axes + gap + band] - cumulative[axes + gap]
    square_above = cumulative_square[axes] - cumulative_square[axes - band]
    square_below = (
        cumulative_square[axes + gap + band] - cumulative_square[axes + gap]
    )
    product = np.zeros(axes.size, dtype=np.float64)
    for offset in range(band):
        product += (
            high[axes - 1 - offset] * high[axes + gap + offset]
        ).sum(axis=1)
    covariance = product - sum_above * sum_below / count
    variance_above = np.maximum(square_above - sum_above * sum_above / count, 0.0)
    variance_below = np.maximum(square_below - sum_below * sum_below / count, 0.0)
    denominator = np.sqrt(variance_above * variance_below)
    correlation = np.where(
        denominator > 1e-9,
        covariance / np.maximum(denominator, 1e-9),
        0.0,
    )
    return axes, correlation


def mirror_deviation_profile(
    values: np.ndarray,
    band: int,
    gap: int,
) -> tuple[np.ndarray, np.ndarray]:
    height = values.shape[0]
    axes = np.arange(band, height - band - gap + 1)
    total = np.zeros(axes.size, dtype=np.float64)
    for offset in range(band):
        total += np.abs(
            values[axes - 1 - offset] - values[axes + gap + offset]
        ).mean(axis=1)
    return axes, total / band


def mirror_symmetry_metrics(
    image: np.ndarray,
    *,
    band: int = 32,
    tile_width: int = 512,
    deviation_band: int = 48,
) -> dict[str, Any]:
    """Finder den stærkeste vandrette spejlakse hvor som helst i billedet.

    Hvorfor `repeatCorrelation` ikke kunne fange det her: den måler et
    FORSKUDT genbrug — donor mod generat i samme retning. En spejlvendt kopi
    er netop ikke en forskydning; den vender rækkefølgen om, så den
    translations-baserede korrelation falder og porten står grøn, mens øjet
    tydeligt ser en refleksion. Portrættets bundforlængelse slap igennem
    præcis sådan: `repeatCorrelation` så den aldrig.

    Målingen kører over begge akse-pariteter og over kolonnefelter på
    `tile_width`, så en spejling der kun dækker en del af bredden ikke
    fortyndes til under grænsen (den brede kandidats spejl dækker 896 af
    2560 px og måler 0,44 over fuld bredde, men 0,997 i sit eget felt).

    `deviationRatio` er den oprindeligt foreslåede formulering — bedste akses
    middelafvigelse mod medianaksen. Den er kun beskrivende her, ikke port:
    målt på godkendte referencer giver flade felter kunstigt lave afvigelser
    (`elements-sheet.png` når 43,8x uden nogen spejling overhovedet), mens den
    normaliserede korrelation holder alle godkendte referencer under 0,66.
    """
    high = high_pass(luma(image))
    values = luma(image)
    height, width = high.shape
    tiles = max(1, width // tile_width)
    edges = np.linspace(0, width, tiles + 1).astype(int)
    best: dict[str, Any] = {
        "correlation": -1.0,
        "axis": -1,
        "parity": "",
        "gap": 0,
        "columns": [0, width],
    }
    collected: list[np.ndarray] = []
    for parity, gap in (("between-rows", 0), ("on-row", 1)):
        for index in range(tiles):
            left, right = int(edges[index]), int(edges[index + 1])
            axes, correlation = mirror_correlation_profile(
                np.ascontiguousarray(high[:, left:right]),
                band,
                gap,
            )
            if axes.size == 0:
                continue
            collected.append(correlation)
            top = int(np.argmax(correlation))
            if float(correlation[top]) > best["correlation"]:
                best = {
                    "correlation": float(correlation[top]),
                    "axis": int(axes[top]),
                    "parity": parity,
                    "gap": gap,
                    "columns": [left, right],
                }
    left, right = best["columns"]
    axes, deviation = mirror_deviation_profile(
        values[:, left:right],
        deviation_band,
        int(best["gap"]),
    )
    position = int(np.argmin(np.abs(axes - best["axis"])))
    best_deviation = float(deviation[position])
    median_deviation = float(np.median(deviation))
    return {
        "band": int(band),
        "tileWidth": int(tile_width),
        "bestCorrelation": float(best["correlation"]),
        "bestAxis": int(best["axis"]),
        "bestParity": str(best["parity"]),
        "bestColumns": [int(left), int(right)],
        "medianCorrelation": float(np.median(np.concatenate(collected))),
        "deviationBand": int(deviation_band),
        "deviationAtBestAxis": best_deviation,
        "medianDeviation": median_deviation,
        "deviationRatio": float(median_deviation / max(best_deviation, 1e-9)),
    }


def mirror_gate_pass(metrics: dict[str, Any], max_correlation: float) -> bool:
    correlation = metrics.get("bestCorrelation")
    if correlation is None:
        return False
    return bool(float(correlation) <= float(max_correlation))


def extension_repeat_metrics(
    candidate: np.ndarray,
    *,
    source_height: int,
    source_reference: np.ndarray,
    tile_lags: Iterable[int] = range(4, 65),
) -> dict[str, Any]:
    """Måler om forlængelsen under kilden er en kopi — flisebelagt eller spejlet.

    `maxTileCorrelation` sammenligner forlængelsens haleblok med blokken lige
    over den for hver kandidatperiode; en gentaget flise giver korrelation 1,0
    ved sin egen periode. `sourceReuseCorrelation` sammenligner det øverste
    forlængelsesbånd med kildens nederste bånd, både direkte og spejlvendt og
    over små forskydninger, så et `[::-1]`-genbrug ikke kan gemme sig bag en
    enkelt rækkes offset.
    """
    extension = candidate[int(source_height) :]
    rows = int(extension.shape[0])
    best_correlation = -1.0
    best_lag = -1
    for lag in tile_lags:
        lag = int(lag)
        if lag < 1 or 2 * lag > rows:
            continue
        value = normalized_correlation(extension[-lag:], extension[-2 * lag : -lag])
        if value > best_correlation:
            best_correlation = value
            best_lag = lag
    band = int(min(32, rows, source_reference.shape[0] - 1))
    reuse_correlation = -1.0
    reuse_orientation = "none"
    reuse_offset = 0
    if band > 0:
        generated = extension[:band]
        for offset in range(0, 4):
            top = source_reference.shape[0] - band - offset
            if top < 0:
                continue
            donor = source_reference[top : top + band]
            for orientation, block in (
                ("direct", donor),
                ("mirrored", donor[::-1]),
            ):
                value = normalized_correlation(generated, block)
                if value > reuse_correlation:
                    reuse_correlation = value
                    reuse_orientation = orientation
                    reuse_offset = offset
    return {
        "extensionRows": rows,
        "maxTileCorrelation": float(best_correlation),
        "maxTileLag": int(best_lag),
        "sourceReuseBand": band,
        "sourceReuseCorrelation": float(reuse_correlation),
        "sourceReuseOrientation": reuse_orientation,
        "sourceReuseOffset": int(reuse_offset),
    }


def repeat_gate_pass(
    metrics: dict[str, Any],
    max_tile_correlation: float,
    max_source_reuse_correlation: float,
) -> bool:
    if float(metrics.get("maxTileCorrelation", 1.0)) > float(max_tile_correlation):
        return False
    if float(metrics.get("sourceReuseCorrelation", 1.0)) > float(
        max_source_reuse_correlation
    ):
        return False
    side_field = metrics.get("sideFieldReuseCorrelation")
    if side_field is not None and float(side_field) > float(
        max_source_reuse_correlation
    ):
        return False
    return True


def transition_metrics(
    candidate: np.ndarray,
    *,
    source_height: int,
    columns: tuple[int, int],
    scales: Sequence[int] = (4, 16, 64),
    energy_ratio_min: float = 0.8,
    energy_ratio_max: float = 1.2,
) -> dict[str, Any]:
    """Sammenligner højfrekvent energi over og under rekonstruktionsgrænsen.

    En spejling består denne prøve med glans — refleksionen har per definition
    samme tekstur-energi som kilden. Det er hele grunden til at
    spejlsymmetri-porten skal måles for sig; overgangskvalitet alene kan ikke
    skelne en fortsat scene fra en foldet scene.
    """
    left, right = (int(value) for value in columns)
    high = high_pass(luma(candidate[:, left:right]))
    bands: dict[str, Any] = {}
    for scale in scales:
        scale = int(scale)
        above = high[max(0, source_height - scale) : source_height]
        below = high[source_height : source_height + scale]
        source_energy = float(np.abs(above).mean()) if above.size else 0.0
        extension_energy = float(np.abs(below).mean()) if below.size else 0.0
        ratio = float(extension_energy / max(source_energy, 1e-9))
        bands[str(scale)] = {
            "sourceEnergy": source_energy,
            "extensionEnergy": extension_energy,
            "energyRatio": ratio,
            "pass": bool(energy_ratio_min <= ratio <= energy_ratio_max),
        }
    return {
        "scales": [int(scale) for scale in scales],
        "columns": [left, right],
        "energyRatioRange": [float(energy_ratio_min), float(energy_ratio_max)],
        "bands": bands,
        "pass": bool(all(band["pass"] for band in bands.values())),
    }


def automated_gates_pass(metrics: dict[str, Any], gates: dict[str, Any]) -> bool:
    """Fail-closed: en manglende måling er et nej, ikke et ja."""
    retention = metrics.get("sourceRetention")
    if not isinstance(retention, dict):
        return False
    if float(retention.get("retainedShare", 0.0)) < float(gates["sourceRetentionMin"]):
        return False
    if retention.get("fullCoverage") is not True:
        return False
    karl = metrics.get("karlDelta")
    if not isinstance(karl, dict):
        return False
    if int(karl.get("maxDelta", 255)) > int(gates["karlMaxDelta"]):
        return False
    seams = metrics.get("seams")
    if seams is not None:
        for seam in seams.values():
            if float(seam["ratio"]) > float(gates["seamGradientRatioMax"]):
                return False
    for name in ("transition", "repeatDetection", "mirrorSymmetry"):
        measured = metrics.get(name)
        if not isinstance(measured, dict) or measured.get("pass") is not True:
            return False
    return True


def approval_basis_sha256(config: dict[str, Any]) -> str:
    """Hash af hele configen minus selve godkendelsesfelterne."""
    basis = copy.deepcopy(config)
    for candidate in ("wide", "portrait"):
        section = basis.get(candidate)
        if isinstance(section, dict):
            section.pop("manualApproval", None)
    payload = json.dumps(
        basis,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_manual_approval(
    approval: Any,
    candidate_path: Path,
    contact_sheet_path: Path,
    generator_path: Path,
    config: dict[str, Any],
) -> dict[str, Any]:
    """En manuel godkendelse gælder kun de nøjagtige bytes den blev givet på."""
    if not isinstance(approval, dict):
        return {
            "valid": False,
            "present": False,
            "checks": {},
        }

    def digest_matches(field: str, path: Path) -> bool:
        path = Path(path)
        if not path.is_file():
            return False
        return str(approval.get(field, "")) == sha256(path)

    checks = {
        "candidateSha256": digest_matches("candidateSha256", candidate_path),
        "contactSheetSha256": digest_matches(
            "contactSheetSha256",
            contact_sheet_path,
        ),
        "generatorSha256": digest_matches("generatorSha256", generator_path),
        "configBasisSha256": str(approval.get("configBasisSha256", ""))
        == approval_basis_sha256(config),
        "reviewer": bool(str(approval.get("reviewer", "")).strip()),
        "reviewedAt": bool(str(approval.get("reviewedAt", "")).strip()),
    }
    return {
        "valid": bool(all(checks.values())),
        "present": True,
        "checks": checks,
    }


def publish_files_atomically(pairs: Sequence[tuple[Path, Path]]) -> bool:
    """Alt eller intet: fejler én destination, rulles de andre tilbage."""
    rollback: list[tuple[Path | None, Path]] = []
    incoming_paths: list[Path] = []
    try:
        for staged, destination in pairs:
            staged = Path(staged)
            destination = Path(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                backup = destination.with_name(f".{destination.name}.rollback")
                shutil.copyfile(destination, backup)
                rollback.append((backup, destination))
            else:
                rollback.append((None, destination))
            incoming = destination.with_name(f".{destination.name}.incoming")
            shutil.copyfile(staged, incoming)
            incoming_paths.append(incoming)
            os.replace(incoming, destination)
    except OSError:
        for backup, destination in rollback:
            if backup is not None and backup.exists():
                os.replace(backup, destination)
            elif backup is None and destination.exists():
                destination.unlink()
        for incoming in incoming_paths:
            if incoming.exists():
                incoming.unlink()
        return False
    for backup, _destination in rollback:
        if backup is not None and backup.exists():
            backup.unlink()
    return True


def publish_promoted_candidate(
    staged: Path,
    destination: Path,
    *,
    gates_pass: bool,
    approval_valid: bool,
) -> bool:
    """Promoverer kun når både målingerne og den bundne godkendelse holder."""
    if not gates_pass or not approval_valid:
        return False
    return publish_files_atomically([(Path(staged), Path(destination))])


def publication_paths_match_config(
    config: dict[str, Any],
    output_dir: Path,
    evidence_dir: Path,
    manifest_path: Path,
) -> bool:
    """En vilkårlig arbejdskørsel må aldrig kunne bede om produktionsudgivelse."""
    publication = config.get("publication")
    if not isinstance(publication, dict):
        return False
    expected = (
        publication.get("outputDir"),
        publication.get("evidenceDir"),
        publication.get("manifest"),
    )
    if not all(isinstance(value, str) and value for value in expected):
        return False
    actual = (output_dir, evidence_dir, manifest_path)
    for relative, candidate in zip(expected, actual):
        if Path(candidate).resolve() != resolve(str(relative)):
            return False
    return True


def retention_metrics(
    output: np.ndarray,
    source: np.ndarray,
    metadata: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Andel af HELE den godkendte scene der overlever uændret i kandidaten.

    Nævneren er den kanoniske scene minus de to skjulte værktøjsflader — ikke
    kun det udsnit kandidaten valgte at vise. En master der beskærer 36
    kolonner af den godkendte scene væk, har ikke bevaret 100%; den har
    bevaret 96%, og `fullCoverage` siger nej.
    """
    canonical_height, canonical_width = source.shape[:2]
    hidden = rounded_tool_mask((canonical_height, canonical_width), config, 0)
    visible = hidden == 0
    sx, sy, width, height = (int(value) for value in metadata["sourceCrop"])
    dx, dy = (int(value) for value in metadata["sourcePlacement"])
    expected = source[sy : sy + height, sx : sx + width]
    actual = output[dy : dy + height, dx : dx + width]
    retained = np.zeros((canonical_height, canonical_width), dtype=bool)
    retained[sy : sy + height, sx : sx + width] = np.all(actual == expected, axis=2)
    covered = np.zeros((canonical_height, canonical_width), dtype=bool)
    covered[sy : sy + height, sx : sx + width] = True
    return {
        "canonicalSize": [int(canonical_width), int(canonical_height)],
        "coveredSize": [int(width), int(height)],
        "fullCoverage": bool(
            width == canonical_width and height == canonical_height
        ),
        "retainedShare": float(np.mean(retained[visible])),
        "visiblePixels": int(np.sum(visible)),
        "coveredVisiblePixels": int(np.sum(covered & visible)),
        "changedVisiblePixels": int(np.sum(~retained & visible)),
    }


def karl_metrics(
    output: np.ndarray,
    source: np.ndarray,
    metadata: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    global_x, global_y, width, height = (
        int(value) for value in config["karl"]["sourceRect"]
    )
    scene_global_x = int(
        config["sources"]["canonicalTitle"]["sceneCrop"][0]
    )
    scene_x = global_x - scene_global_x
    crop_x, crop_y, _, _ = metadata["sourceCrop"]
    dest_x, dest_y = metadata["sourcePlacement"]
    local_x = scene_x - crop_x
    local_y = global_y - crop_y
    expected = source[
        global_y : global_y + height,
        global_x : global_x + width,
    ]
    actual = output[
        dest_y + local_y : dest_y + local_y + height,
        dest_x + local_x : dest_x + local_x + width,
    ]
    delta = np.abs(
        actual.astype(np.int16) - expected.astype(np.int16)
    )
    return {
        "maxDelta": int(delta.max()),
        "meanDelta": float(delta.mean()),
        "pixels": int(width * height),
    }


def seam_metrics(
    output: np.ndarray,
    source_scene: np.ndarray,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    dx, dy = metadata["sourcePlacement"]
    _, _, width, height = metadata["sourceCrop"]
    luma = rec709(output).astype(np.int16)
    source_luma = rec709(source_scene).astype(np.int16)
    seams: dict[str, Any] = {}
    if dx > 0:
        value = float(
            np.mean(np.abs(luma[dy : dy + height, dx] - luma[dy : dy + height, dx - 1]))
        )
        baseline = float(
            np.mean(np.abs(source_luma[:height, 1] - source_luma[:height, 0]))
        )
        seams["left"] = {
            "meanGradient": value,
            "sourceEdgeGradient": baseline,
            "ratio": value / max(baseline, 1e-6),
        }
    if dy + height < output.shape[0]:
        value = float(
            np.mean(
                np.abs(
                    luma[dy + height, dx : dx + width]
                    - luma[dy + height - 1, dx : dx + width]
                )
            )
        )
        source_crop = source_scene[
            metadata["sourceCrop"][1] : metadata["sourceCrop"][1] + height,
            metadata["sourceCrop"][0] : metadata["sourceCrop"][0] + width,
        ]
        source_crop_luma = rec709(source_crop).astype(np.int16)
        baseline = float(
            np.mean(np.abs(source_crop_luma[-1] - source_crop_luma[-2]))
        )
        seams["bottom"] = {
            "meanGradient": value,
            "sourceEdgeGradient": baseline,
            "ratio": value / max(baseline, 1e-6),
        }
    return seams


def side_field_reuse_metrics(
    wide: np.ndarray,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Sidefeltets genbrug af sin egen donor — den oprindeligt målte blokering."""
    x, y, width, height = metadata["sideRect"]
    generated = wide[y + 560 : y + min(height, 900), x : x + width]
    donor = metadata["sideDonor"][
        560 : min(height, 900)
    ]
    return {
        "sideFieldReuseCorrelation": normalized_correlation(generated, donor),
        "sampleRect": [x, y + 560, width, min(height, 900) - 560],
    }


def save_png(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image).save(
        path,
        format="PNG",
        compress_level=9,
        optimize=False,
    )


def build_contact_sheet(
    wide: np.ndarray,
    portrait: np.ndarray,
    path: Path,
) -> None:
    wide_thumb = Image.fromarray(wide).resize(
        (960, 540),
        Image.Resampling.LANCZOS,
    )
    portrait_thumb = Image.fromarray(portrait).resize(
        (249, 540),
        Image.Resampling.LANCZOS,
    )
    sheet = Image.new("RGB", (1239, 590), (31, 24, 21))
    sheet.paste(wide_thumb, (10, 40))
    sheet.paste(portrait_thumb, (980, 40))
    draw = ImageDraw.Draw(sheet)
    draw.text(
        (10, 12),
        "wide candidate - blocked: side-field reuse + mirrored bottom",
        fill=(238, 224, 205),
    )
    draw.text(
        (980, 12),
        "portrait - blocked: mirror at y=991",
        fill=(238, 224, 205),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "WEBP", quality=88, method=6)


def build_issue_overlay(
    wide: np.ndarray,
    metadata: dict[str, Any],
    mirror: dict[str, Any],
    path: Path,
) -> None:
    preview = Image.fromarray(wide).resize(
        (1280, 720),
        Image.Resampling.LANCZOS,
    )
    draw = ImageDraw.Draw(preview, "RGBA")
    x, y, width, height = metadata["sideRect"]
    scale = 0.5
    box = (
        round(x * scale),
        round((y + 560) * scale),
        round((x + width) * scale),
        round(min(y + height + 180, wide.shape[0]) * scale),
    )
    draw.rectangle(box, outline=(220, 64, 48, 255), width=4)
    draw.rectangle(
        (box[0], max(0, box[1] - 28), box[0] + 430, box[1]),
        fill=(31, 24, 21, 220),
    )
    draw.text(
        (box[0] + 8, max(2, box[1] - 23)),
        "blocked: repeated lower edge / soft join",
        fill=(255, 226, 206, 255),
    )
    axis = round(int(mirror["bestAxis"]) * scale)
    left = round(int(mirror["bestColumns"][0]) * scale)
    right = round(int(mirror["bestColumns"][1]) * scale)
    draw.line((left, axis, right, axis), fill=(255, 196, 64, 255), width=3)
    draw.rectangle((left, axis + 2, left + 430, axis + 26), fill=(31, 24, 21, 220))
    draw.text(
        (left + 8, axis + 6),
        "mirror axis y={} corr={:.3f}".format(
            int(mirror["bestAxis"]),
            float(mirror["bestCorrelation"]),
        ),
        fill=(255, 226, 206, 255),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(path, "WEBP", quality=90, method=6)


def output_entry(path: Path, image: np.ndarray) -> dict[str, Any]:
    """Kun filnavnet: manifestet skal være identisk uanset hvor kørslen lå."""
    return {
        "name": path.name,
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "format": "PNG",
        "lossless": True,
    }


def build(
    output_dir: Path,
    evidence_dir: Path,
    manifest_path: Path,
    request_promotion: bool,
) -> dict[str, Any]:
    config = load_config()
    canonical = verify_source(config["sources"]["canonicalTitle"])
    landscape = verify_source(config["sources"]["approvedLandscape"])
    x0, y0, x1, y1 = (
        int(value)
        for value in config["sources"]["canonicalTitle"]["sceneCrop"]
    )
    scene = canonical[y0:y1, x0:x1]
    reconstructed_scene = reconstruct_tools(scene, config)
    wide, wide_metadata = build_wide(
        scene,
        reconstructed_scene,
        landscape,
        config,
    )
    portrait, portrait_metadata = build_portrait(
        scene,
        reconstructed_scene,
        landscape,
        config,
    )

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        dir=output_dir.parent,
        prefix=f".{output_dir.name}-",
    ) as temporary:
        temporary_dir = Path(temporary)
        wide_path = temporary_dir / "wide-candidate-2560x1440.png"
        portrait_path = temporary_dir / "portrait-860x1864.png"
        save_png(wide_path, wide)
        save_png(portrait_path, portrait)
        if output_dir.exists():
            shutil.rmtree(output_dir)
        os.replace(temporary_dir, output_dir)

    wide_path = output_dir / "wide-candidate-2560x1440.png"
    portrait_path = output_dir / "portrait-860x1864.png"

    gates = config["gates"]
    wide_placement = (
        int(wide_metadata["sourcePlacement"][0]),
        int(wide_metadata["sourcePlacement"][0])
        + int(wide_metadata["sourceCrop"][2]),
    )
    portrait_placement = (
        int(portrait_metadata["sourcePlacement"][0]),
        int(portrait_metadata["sourcePlacement"][0])
        + int(portrait_metadata["sourceCrop"][2]),
    )
    wide_source_height = int(wide_metadata["sourcePlacement"][1]) + int(
        wide_metadata["sourceCrop"][3]
    )
    portrait_source_height = int(portrait_metadata["sourcePlacement"][1]) + int(
        portrait_metadata["sourceCrop"][3]
    )

    wide_mirror = mirror_symmetry_metrics(wide)
    portrait_mirror = mirror_symmetry_metrics(portrait)
    wide_mirror["pass"] = mirror_gate_pass(
        wide_mirror,
        gates["mirrorCorrelationMax"],
    )
    portrait_mirror["pass"] = mirror_gate_pass(
        portrait_mirror,
        gates["mirrorCorrelationMax"],
    )

    evidence_dir.mkdir(parents=True, exist_ok=True)
    contact_path = evidence_dir / "contact-sheet.webp"
    issue_path = evidence_dir / "wide-blocker-overlay.webp"
    build_contact_sheet(wide, portrait, contact_path)
    build_issue_overlay(wide, wide_metadata, wide_mirror, issue_path)

    wide_retention = retention_metrics(wide, scene, wide_metadata, config)
    portrait_retention = retention_metrics(portrait, scene, portrait_metadata, config)
    wide_karl = karl_metrics(wide, canonical, wide_metadata, config)
    portrait_karl = karl_metrics(portrait, canonical, portrait_metadata, config)
    wide_seams = seam_metrics(wide, scene, wide_metadata)
    portrait_seams = seam_metrics(portrait, scene, portrait_metadata)
    wide_transition = transition_metrics(
        wide,
        source_height=wide_source_height,
        columns=wide_placement,
        energy_ratio_min=gates["transitionEnergyRatioMin"],
        energy_ratio_max=gates["transitionEnergyRatioMax"],
    )
    portrait_transition = transition_metrics(
        portrait,
        source_height=portrait_source_height,
        columns=portrait_placement,
        energy_ratio_min=gates["transitionEnergyRatioMin"],
        energy_ratio_max=gates["transitionEnergyRatioMax"],
    )
    wide_repeat = extension_repeat_metrics(
        wide[:, wide_placement[0] : wide_placement[1]],
        source_height=wide_source_height,
        source_reference=scene,
    )
    wide_repeat.update(side_field_reuse_metrics(wide, wide_metadata))
    portrait_repeat = extension_repeat_metrics(
        portrait[:, portrait_placement[0] : portrait_placement[1]],
        source_height=portrait_source_height,
        source_reference=scene[
            :,
            int(portrait_metadata["sourceCrop"][0]) : int(
                portrait_metadata["sourceCrop"][0]
            )
            + int(portrait_metadata["sourceCrop"][2]),
        ],
    )
    wide_repeat["pass"] = repeat_gate_pass(
        wide_repeat,
        gates["repeatTileCorrelationMax"],
        gates["repeatCorrelationMax"],
    )
    portrait_repeat["pass"] = repeat_gate_pass(
        portrait_repeat,
        gates["repeatTileCorrelationMax"],
        gates["portraitSourceReuseCorrelationMax"],
    )

    control = {
        "canonicalScene": mirror_symmetry_metrics(scene),
        "approvedLandscape": mirror_symmetry_metrics(landscape),
    }
    for measurement in control.values():
        measurement["pass"] = mirror_gate_pass(
            measurement,
            gates["mirrorCorrelationMax"],
        )
    control_pass = all(measurement["pass"] for measurement in control.values())

    metrics = {
        "wide": {
            "sourceRetention": wide_retention,
            "karlDelta": wide_karl,
            "seams": wide_seams,
            "transition": wide_transition,
            "repeatDetection": wide_repeat,
            "mirrorSymmetry": wide_mirror,
        },
        "portrait": {
            "sourceRetention": portrait_retention,
            "karlDelta": portrait_karl,
            "seams": portrait_seams,
            "transition": portrait_transition,
            "repeatDetection": portrait_repeat,
            "mirrorSymmetry": portrait_mirror,
        },
        "control": {
            "mirrorSymmetry": control,
            "pass": control_pass,
            "note": (
                "Spejlporten måles på de godkendte kilder selv. Overskrider en "
                "kilde grænsen, er porten ugyldig og intet må promoveres."
            ),
        },
    }

    generator_path = Path(__file__).resolve()
    candidates = {
        "wide": (wide_path, wide_metadata),
        "portrait": (portrait_path, portrait_metadata),
    }
    promotion: dict[str, Any] = {}
    for name, (candidate_path, _metadata) in candidates.items():
        automated = automated_gates_pass(metrics[name], gates)
        approval = verify_manual_approval(
            config[name].get("manualApproval"),
            candidate_path,
            contact_path,
            generator_path,
            config,
        )
        promotion[name] = {
            "pass": bool(
                automated
                and approval["valid"]
                and control_pass
                and config[name]["promotion"]["approved"] is True
            ),
            "automatedGates": bool(automated),
            "manualApproval": approval,
            "controlPass": bool(control_pass),
            **config[name]["promotion"],
        }

    published: list[str] = []
    if request_promotion:
        production = publication_paths_match_config(
            config,
            output_dir,
            evidence_dir,
            manifest_path,
        )
        for name, (candidate_path, _metadata) in candidates.items():
            destination = config[name].get("output")
            if not production or destination is None:
                continue
            if publish_promoted_candidate(
                candidate_path,
                resolve(destination),
                gates_pass=promotion[name]["pass"],
                approval_valid=promotion[name]["manualApproval"]["valid"],
            ):
                published.append(destination)

    manifest = {
        "version": config["version"],
        "algorithm": config["algorithm"],
        "seed": config["seed"],
        "sources": config["sources"],
        "outputs": {
            "wideCandidate": output_entry(wide_path, wide),
            "portraitCandidate": output_entry(portrait_path, portrait),
            "promoted": published,
        },
        "gates": gates,
        "metrics": metrics,
        "promotion": promotion,
        "evidence": {
            "contactSheet": contact_path.name,
            "wideBlockerOverlay": issue_path.name,
        },
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    (evidence_dir / "metrics.json").write_text(
        json.dumps(manifest["metrics"], indent=2) + "\n"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    publication = load_config()["publication"]
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=resolve(publication["outputDir"]),
    )
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=resolve(publication["evidenceDir"]),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=resolve(publication["manifest"]),
    )
    parser.add_argument("--promote", action="store_true")
    args = parser.parse_args()
    manifest = build(
        args.output_dir.resolve(),
        args.evidence_dir.resolve(),
        args.manifest.resolve(),
        args.promote,
    )
    print(json.dumps(manifest, indent=2))
    blocked = [
        name
        for name, decision in manifest["promotion"].items()
        if decision["pass"] is not True
    ]
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
