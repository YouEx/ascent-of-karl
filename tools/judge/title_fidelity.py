#!/usr/bin/env python3
"""Fidelity-v3: geometriankret, skalastabil målkontrakt for titelskærmen."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from urllib.parse import unquote_to_bytes
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageColor
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "docs/design/reference/registry.json"
LAPLACIAN_KERNEL = np.array(
    [[0.0, 1.0, 0.0], [1.0, -4.0, 1.0], [0.0, 1.0, 0.0]],
    dtype=np.float64,
)
EDGE_SCALES = (1.0, 0.75, 0.5, 0.35, 0.3)
SCREEN_GATE_ORDER = (
    "captureDimensions",
    "sceneSeamGradient",
    "titleInkOccupancy",
    "bottomLeftDarkShare",
    "characterEvidence",
    "characterDetailVariance",
    "globalEdgeDensity",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def portable_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return resolved.name


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    return json.loads(path.read_text())


def viewport_by_id(registry: dict[str, Any], viewport_id: str) -> dict[str, Any]:
    for viewport in registry["viewports"]:
        if viewport["id"] == viewport_id:
            return viewport
    known = ", ".join(viewport["id"] for viewport in registry["viewports"])
    raise ValueError(f'ukendt viewport "{viewport_id}". Kendte: {known}')


def _rec709_u8(image: Image.Image | np.ndarray) -> np.ndarray:
    rgb = np.asarray(image, dtype=np.float64)
    if rgb.shape[-1] > 3:
        rgb = rgb[..., :3]
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    return np.rint(luma).clip(0, 255).astype(np.uint8)


def _bounds(width: int, height: int, rect: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = rect
    return (
        round(x1 * width),
        round(y1 * height),
        round(x2 * width),
        round(y2 * height),
    )


def _detail_variance(image: Image.Image) -> float:
    gray = _rec709_u8(image.convert("RGB"))
    laplacian = cv2.filter2D(
        gray,
        cv2.CV_64F,
        LAPLACIAN_KERNEL,
        borderType=cv2.BORDER_DEFAULT,
    )
    return float(np.var(laplacian))


def _high_frequency_energy(image: Image.Image) -> float:
    gray = _rec709_u8(image.convert("RGB")).astype(np.float64)
    low = cv2.GaussianBlur(gray, (0, 0), sigmaX=2.0, sigmaY=2.0)
    return float(np.std(gray - low))


def _multiscale_edge_density(rgb: np.ndarray) -> tuple[float, dict[str, float]]:
    densities: dict[str, float] = {}
    for scale in EDGE_SCALES:
        sample = (
            rgb
            if scale == 1.0
            else cv2.resize(
                rgb,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_AREA,
            )
        )
        edges = cv2.Canny(_rec709_u8(sample), 51, 145, L2gradient=True)
        densities[f"{scale:g}"] = float(100 * np.mean(edges > 0))
    return max(densities.values()), densities


def _spatial_similarity(first: Image.Image, second: Image.Image) -> float:
    a = np.asarray(first.convert("RGBA"), dtype=np.float64)
    b = np.asarray(second.convert("RGBA").resize(first.size, Image.Resampling.LANCZOS), dtype=np.float64)
    mae_score = max(0.0, 1.0 - float(np.mean(np.abs(a - b))) / 255.0)
    correlations = []
    for channel in range(a.shape[2]):
        left = a[..., channel].reshape(-1)
        right = b[..., channel].reshape(-1)
        if np.std(left) < 1e-9 and np.std(right) < 1e-9:
            correlations.append(1.0 if np.allclose(left, right) else 0.0)
        elif np.std(left) < 1e-9 or np.std(right) < 1e-9:
            correlations.append(0.0)
        else:
            correlations.append(float(np.corrcoef(left, right)[0, 1]))
    correlation_score = max(0.0, min(1.0, (float(np.mean(correlations)) + 1.0) / 2.0))
    return min(mae_score, correlation_score)


def _crop(image: Image.Image, rect: list[int]) -> Image.Image:
    x, y, width, height = (int(value) for value in rect)
    if width <= 0 or height <= 0:
        raise ValueError("crop har ugyldige dimensioner")
    if x < 0 or y < 0 or x + width > image.width or y + height > image.height:
        raise ValueError("crop ligger uden for billedet")
    return image.crop((x, y, x + width, y + height))


def _reference_geometry(
    image_path: Path,
    registry: dict[str, Any],
) -> dict[str, Any] | None:
    source = registry["goalMetrics"].get("sources", {}).get("approvedReference", {})
    if source.get("sha256") != sha256(image_path):
        return None
    return json.loads(json.dumps(registry["goalMetrics"]["referenceGeometry"]))


def _character_crop(
    full_image: Image.Image,
    geometry: dict[str, Any],
    base: Path,
) -> tuple[Image.Image, dict[str, Any], bool]:
    character = geometry.get("character", {})
    canonical_width = int(character.get("canonicalWidth", 0))
    canonical_height = int(character.get("canonicalHeight", 0))
    evidence_ok = (
        character.get("measurementSource") in {"asset", "reference"}
        and canonical_width > 0
        and canonical_height > 0
        and int(character.get("uiOverlapPixels", 0)) == 0
    )
    if character.get("cropPath"):
        crop_path = resolve_contract_path(character["cropPath"], base)
        crop = Image.open(crop_path).convert("RGB")
    elif character.get("sourceRect"):
        crop = _crop(full_image, character["sourceRect"]).convert("RGB")
        crop = crop.resize(
            (canonical_width, canonical_height),
            Image.Resampling.LANCZOS,
        )
    else:
        crop = Image.new("RGB", (max(1, canonical_width), max(1, canonical_height)))
        evidence_ok = False
    if crop.size != (canonical_width, canonical_height):
        if (
            not character.get("cropPath")
            or crop.width < canonical_width
            or crop.height < canonical_height
        ):
            evidence_ok = False
        crop = crop.resize(
            (max(1, canonical_width), max(1, canonical_height)),
            Image.Resampling.LANCZOS,
        )
    raw = {
        "measurementSource": character.get("measurementSource"),
        "canonicalSize": [canonical_width, canonical_height],
        "uiOverlapPixels": int(character.get("uiOverlapPixels", 0)),
        "cropSha256": sha256(resolve_contract_path(character["cropPath"], base))
        if character.get("cropPath")
        else None,
        "sourceRect": character.get("sourceRect"),
    }
    return crop, raw, evidence_ok


def _seam_gradient(luma: np.ndarray, geometry: dict[str, Any]) -> tuple[float, dict[str, Any], bool]:
    seam = geometry.get("seam", {})
    if seam.get("axis") != "vertical":
        return 0.0, seam, False
    x = int(round(seam.get("physicalX", -1)))
    y = int(round(seam.get("physicalY", 0)))
    height = int(round(seam.get("physicalHeight", 0)))
    width = max(1, int(round(seam.get("physicalWidth", 1))))
    end_x = min(luma.shape[1] - 1, x + width)
    if x <= 0 or end_x < x or y < 0 or height <= 0 or y + height > luma.shape[0]:
        return 0.0, seam, False
    band = luma[y : y + height, x - 1 : end_x + 1].astype(np.int16)
    deltas = np.mean(np.abs(np.diff(band, axis=1)), axis=0)
    return float(np.max(deltas)), seam, True


def screen_metrics(
    path: Path,
    viewport: dict[str, Any],
    geometry: dict[str, Any],
) -> tuple[dict[str, float], dict[str, Any]]:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    luma = _rec709_u8(rgb)
    height, width = luma.shape
    expected_width = int(viewport["width"] * viewport["dpr"])
    expected_height = int(viewport["height"] * viewport["dpr"])
    capture = geometry.get("capture", {})
    dimensions_ok = (
        width == expected_width
        and height == expected_height
        and int(capture.get("pixelWidth", -1)) == width
        and int(capture.get("pixelHeight", -1)) == height
    )

    seam, seam_raw, seam_ok = _seam_gradient(luma, geometry)

    x1, y1, x2, y2 = _bounds(width, height, (0.08, 0.10, 0.45, 0.46))
    title_mask = (luma[y1:y2, x1:x2] < 100).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(title_mask, connectivity=8)
    minimum_area = max(4, round(20 * width * height / (1586 * 992)))
    kept = np.zeros_like(title_mask, dtype=bool)
    for component in range(1, count):
        if int(stats[component, cv2.CC_STAT_AREA]) >= minimum_area:
            kept |= labels == component
    title_x = np.where(kept)[1]
    occupancy = (
        float(100 * (int(title_x.max()) - int(title_x.min()) + 1) / width)
        if title_x.size
        else 0.0
    )

    x1, y1, x2, y2 = _bounds(width, height, (0.0, 0.81, 0.45, 1.0))
    dark_share = float(100 * np.mean(luma[y1:y2, x1:x2] < 108))

    character, character_raw, character_ok = _character_crop(image, geometry, path.parent)
    detail = _detail_variance(character)
    edge_density, edge_density_by_scale = _multiscale_edge_density(rgb)

    return (
        {
            "captureDimensions": 1.0 if dimensions_ok else 0.0,
            "sceneSeamGradient": seam,
            "titleInkOccupancy": occupancy,
            "bottomLeftDarkShare": dark_share,
            "characterEvidence": 1.0 if character_ok else 0.0,
            "characterDetailVariance": detail,
            "globalEdgeDensity": edge_density,
        },
        {
            "width": width,
            "height": height,
            "expectedWidth": expected_width,
            "expectedHeight": expected_height,
            "titleComponentMinimumArea": minimum_area,
            "luma": "Rec.709 rounded uint8",
            "edgeDensityByScale": edge_density_by_scale,
            "seam": {**seam_raw, "valid": seam_ok},
            "character": character_raw,
        },
    )


def _gate_applies(gate: dict[str, Any], viewport_id: str) -> bool:
    configured = gate.get("viewports")
    return configured == "all" or (
        isinstance(configured, list) and viewport_id in configured
    )


def evaluate_screen_gates(
    metrics: dict[str, float],
    registry: dict[str, Any],
    viewport_id: str,
) -> tuple[dict[str, Any], list[str]]:
    definitions = registry["goalMetrics"]["gates"]
    gates: dict[str, Any] = {}
    failing: list[str] = []
    for name in SCREEN_GATE_ORDER:
        definition = definitions[name]
        value = metrics[name]
        enforced = _gate_applies(definition, viewport_id)
        passed = True
        if name in {"captureDimensions", "characterEvidence"}:
            passed = value == 1.0
        else:
            if "min" in definition:
                passed = passed and value >= float(definition["min"])
            if "max" in definition:
                passed = passed and value <= float(definition["max"])
        gates[name] = {
            "value": value,
            "pass": passed if enforced else None,
            "enforced": enforced,
            "definition": definition,
        }
        if enforced and not passed:
            failing.append(name)
    return gates, failing


def score_image(
    image_path: Path,
    viewport_id: str,
    registry: dict[str, Any],
    registry_hash: str,
    geometry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    viewport = viewport_by_id(registry, viewport_id)
    resolved_geometry = geometry or _reference_geometry(image_path, registry)
    if resolved_geometry is None:
        raise ValueError("--geometry kræves for et billede, der ikke er den pinnede reference")
    metrics, metric_raw = screen_metrics(image_path, viewport, resolved_geometry)
    gates, failing = evaluate_screen_gates(metrics, registry, viewport_id)
    source_hash = sha256(image_path)
    viewport_raw = {
        "id": viewport["id"],
        "width": viewport["width"],
        "height": viewport["height"],
        "dpr": viewport["dpr"],
    }
    return {
        "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
        "viewport": viewport_raw,
        "source": {"path": portable_path(image_path), "sha256": source_hash},
        "metrics": metrics,
        "gates": gates,
        "failing": failing,
        "raw": {
            "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
            "viewport": viewport_raw,
            "sourceSha256": source_hash,
            "registrySha256": registry_hash,
            **metric_raw,
        },
    }


def resolve_contract_path(value: str, base: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    relative = (base / path).resolve()
    return relative if relative.exists() else (ROOT / path).resolve()


def _required_results(
    entries: list[dict[str, Any]],
    required: dict[str, list[int]],
) -> tuple[dict[str, dict[str, Any] | None], list[str]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        grouped.setdefault(str(entry.get("id")), []).append(entry)
    selected: dict[str, dict[str, Any] | None] = {}
    errors = []
    for contract_id in required:
        matches = grouped.get(contract_id, [])
        if len(matches) != 1:
            selected[contract_id] = None
            errors.append(contract_id)
        else:
            selected[contract_id] = matches[0]
    for contract_id in grouped:
        if contract_id not in required:
            errors.append(contract_id)
    return selected, errors


def scene_retention(
    contract_id: str,
    contract: dict[str, Any] | None,
    expected: list[int],
    base: Path,
    definition: dict[str, Any],
) -> dict[str, Any]:
    if contract is None:
        return {"id": contract_id, "pass": False, "missing": True}
    master_path = resolve_contract_path(contract["master"], base)
    export_path = resolve_contract_path(contract["export"], base)
    master = Image.open(master_path).convert("RGB")
    export = Image.open(export_path).convert("RGB")
    dimensions_ok = master.size == tuple(expected) and export.size == tuple(expected)
    similarity = _spatial_similarity(master, export)
    master_variance = _detail_variance(master)
    export_variance = _detail_variance(export)
    ratio = export_variance / master_variance if master_variance > 0 else float("inf")
    passed = (
        dimensions_ok
        and similarity >= definition["similarityMin"]
        and definition["detailRatioMin"] <= ratio <= definition["detailRatioMax"]
        and definition["varianceMin"] <= export_variance <= definition["varianceMax"]
    )
    return {
        "id": contract_id,
        "pass": passed,
        "dimensions": list(export.size),
        "expectedDimensions": expected,
        "similarity": similarity,
        "detailRatio": ratio,
        "masterVariance": master_variance,
        "exportVariance": export_variance,
        "masterSha256": sha256(master_path),
        "exportSha256": sha256(export_path),
    }


def parchment_retention(
    contract_id: str,
    contract: dict[str, Any] | None,
    expected: list[int],
    base: Path,
    definition: dict[str, Any],
) -> dict[str, Any]:
    if contract is None:
        return {"id": contract_id, "pass": False, "missing": True}
    reference_path = resolve_contract_path(contract["reference"], base)
    reconstructed_path = resolve_contract_path(contract["reconstructed"], base)
    reference = Image.open(reference_path).convert("RGB")
    reconstructed = Image.open(reconstructed_path).convert("RGB")
    dimensions_ok = reference.size == tuple(expected) and reconstructed.size == tuple(expected)
    similarity = _spatial_similarity(reference, reconstructed)
    samples = []
    for sample in contract.get("samples", []):
        ref = _crop(reference, sample["referenceRect"])
        got = _crop(reconstructed, sample["reconstructedRect"]).resize(
            ref.size,
            Image.Resampling.LANCZOS,
        )
        reference_energy = _high_frequency_energy(ref)
        reconstructed_energy = _high_frequency_energy(got)
        ratio = reconstructed_energy / reference_energy if reference_energy > 0 else float("inf")
        samples.append(
            {
                "id": sample["id"],
                "ratio": ratio,
                "pass": definition["sampleMin"] <= ratio <= definition["sampleMax"],
            }
        )
    reference_energy = _high_frequency_energy(reference)
    reconstructed_energy = _high_frequency_energy(reconstructed)
    ratio = reconstructed_energy / reference_energy if reference_energy > 0 else float("inf")
    passed = (
        dimensions_ok
        and bool(samples)
        and similarity >= definition["similarityMin"]
        and definition["energyRatioMin"] <= ratio <= definition["energyRatioMax"]
        and reconstructed_energy <= definition["energyMax"]
        and all(sample["pass"] for sample in samples)
    )
    return {
        "id": contract_id,
        "pass": passed,
        "dimensions": list(reconstructed.size),
        "expectedDimensions": expected,
        "similarity": similarity,
        "energyRatio": ratio,
        "referenceEnergy": reference_energy,
        "reconstructedEnergy": reconstructed_energy,
        "samples": samples,
        "referenceSha256": sha256(reference_path),
        "reconstructedSha256": sha256(reconstructed_path),
    }


def _maximum_run(mask: np.ndarray) -> int:
    maximum = 0
    for row in mask:
        padded = np.pad(row.astype(np.int8), (1, 1))
        changes = np.diff(padded)
        starts = np.where(changes == 1)[0]
        ends = np.where(changes == -1)[0]
        if starts.size:
            maximum = max(maximum, int(np.max(ends - starts)))
    return maximum


def _maximum_run_both_axes(mask: np.ndarray) -> int:
    return max(_maximum_run(mask), _maximum_run(mask.T))


def alpha_edge(
    contract_id: str,
    contract: dict[str, Any] | None,
    expected: list[int],
    base: Path,
    definition: dict[str, Any],
) -> dict[str, Any]:
    if contract is None:
        return {"id": contract_id, "pass": False, "missing": True}
    source_path = resolve_contract_path(contract["source"], base)
    image_path = resolve_contract_path(contract["image"], base)
    source = Image.open(source_path).convert("RGBA")
    image = Image.open(image_path).convert("RGBA")
    rgba = np.asarray(image, dtype=np.uint8)
    alpha = rgba[..., 3].astype(np.float64) / 255.0
    dimensions_ok = source.size == tuple(expected) and image.size == tuple(expected)
    coverage = float(np.mean(alpha > 0))
    opaque_share = float(np.mean(alpha >= (254 / 255)))
    transparent_share = float(np.mean(alpha == 0))
    opaque = alpha >= (254 / 255)
    count, _, stats, _ = cv2.connectedComponentsWithStats(opaque.astype(np.uint8), connectivity=4)
    largest = (
        max((int(stats[index, cv2.CC_STAT_AREA]) for index in range(1, count)), default=0)
        / alpha.size
    )
    transition = (alpha > 0.0) & (alpha < 1.0)
    transition_px = _maximum_run_both_axes(transition)
    similarity = _spatial_similarity(source, image)

    rgb = rgba[..., :3].astype(np.float64)
    if np.any(opaque):
        _, nearest = ndimage.distance_transform_edt(~opaque, return_indices=True)
        nearest_rgb = rgb[nearest[0], nearest[1]]
    else:
        nearest_rgb = np.zeros_like(rgb)
    parchment = contract.get("parchment", "#ecdcc7")
    fringe_px = 0
    backgrounds = []
    for value in definition["backgrounds"]:
        color = parchment if value == "parchment" else value
        background = np.asarray(ImageColor.getrgb(color), dtype=np.float64)
        actual = alpha[..., None] * rgb + (1 - alpha[..., None]) * background
        ideal = alpha[..., None] * nearest_rgb + (1 - alpha[..., None]) * background
        fringe = transition & (np.max(np.abs(actual - ideal), axis=2) > 3.0)
        measured = _maximum_run_both_axes(fringe)
        fringe_px = max(fringe_px, measured)
        backgrounds.append({"background": value, "fringePx": measured})
    passed = (
        dimensions_ok
        and definition["coverageMin"] <= coverage <= definition["coverageMax"]
        and opaque_share >= definition["opaqueMin"]
        and transparent_share >= definition["transparentMin"]
        and largest >= definition["largestComponentMin"]
        and similarity >= definition["similarityMin"]
        and transition_px <= definition["transitionPxMax"]
        and fringe_px <= definition["fringePxMax"]
    )
    return {
        "id": contract_id,
        "pass": passed,
        "dimensions": list(image.size),
        "expectedDimensions": expected,
        "coverage": coverage,
        "opaqueShare": opaque_share,
        "transparentShare": transparent_share,
        "largestComponentShare": largest,
        "similarity": similarity,
        "alphaTransitionPx": transition_px,
        "fringePx": fringe_px,
        "backgrounds": backgrounds,
        "sourceSha256": sha256(source_path),
        "outputSha256": sha256(image_path),
    }


def layer_manifest_result(
    metrics: dict[str, Any],
    resources: dict[str, Any],
    registry: dict[str, Any],
) -> dict[str, Any]:
    required = registry["goalMetrics"]["capture"]["requiredLayers"]
    definition = registry["goalMetrics"]["gates"]["layerManifest"]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for layer in metrics.get("layers", []):
        grouped.setdefault(str(layer.get("layerId")), []).append(layer)
    resource_by_url: dict[str, list[dict[str, Any]]] = {}
    for resource in resources.get("entries", []):
        resource_by_url.setdefault(resource.get("url", ""), []).append(resource)
    failures = []
    layers = {}
    for layer_id in required:
        matches = grouped.get(layer_id, [])
        if len(matches) != 1:
            failures.append({"layerId": layer_id, "reason": "missing-or-duplicate"})
            continue
        layer = matches[0]
        url = str(layer.get("currentSrc", ""))
        if definition.get("forbidCss") and layer.get("sourceKind") != "img":
            failures.append({"layerId": layer_id, "reason": "css-forbidden"})
        if definition.get("forbidInline") and (
            url.startswith("data:") or url.startswith("blob:")
        ):
            failures.append({"layerId": layer_id, "reason": "inline-forbidden"})
        numeric = (
            "naturalWidth", "naturalHeight", "renderedWidth", "renderedHeight",
            "physicalWidth", "physicalHeight",
        )
        if not layer.get("complete") or any(float(layer.get(field, 0)) <= 0 for field in numeric):
            failures.append({"layerId": layer_id, "reason": "invalid-dimensions"})
        if (
            float(layer.get("naturalWidth", 0))
            * float(layer.get("naturalHeight", 0))
            < float(definition.get("minimumNaturalArea", 1))
        ):
            failures.append({"layerId": layer_id, "reason": "trivial-natural-size"})
        matched_resources = resource_by_url.get(url, [])
        if not matched_resources:
            failures.append({"layerId": layer_id, "reason": "missing-resource"})
        else:
            transfer = sum(int(resource.get("transferSize", 0)) for resource in matched_resources)
            encoded = sum(int(resource.get("encodedBodySize", 0)) for resource in matched_resources)
            if transfer <= 0 or encoded <= 0:
                failures.append({"layerId": layer_id, "reason": "zero-resource"})
        layers[layer_id] = layer
    for layer_id in grouped:
        if layer_id not in required:
            failures.append({"layerId": layer_id, "reason": "unknown-layer"})
    source_to_layers: dict[str, list[str]] = {}
    for layer_id, layer in layers.items():
        source_to_layers.setdefault(str(layer.get("currentSrc", "")), []).append(layer_id)
    for source, layer_ids in source_to_layers.items():
        if source and len(layer_ids) > 1:
            failures.append(
                {
                    "layerId": ",".join(layer_ids),
                    "reason": "duplicate-source",
                    "currentSrc": source,
                }
            )
    return {
        "pass": not failures and set(layers) == set(required),
        "requiredLayers": required,
        "layers": layers,
        "titleCriticalImages": [
            image
            for image in metrics.get("images", [])
            if image.get("titleCritical") is True
        ],
        "failures": failures,
    }


def _inline_source_size(source: str) -> int | None:
    if not source.startswith("data:") or "," not in source:
        return None
    header, payload = source.split(",", 1)
    try:
        if ";base64" in header:
            return len(base64.b64decode(payload, validate=True))
        return len(unquote_to_bytes(payload))
    except (ValueError, TypeError):
        return None


def payload_result(
    resources: dict[str, Any],
    metrics: dict[str, Any],
    manifest: dict[str, Any],
    registry: dict[str, Any],
    viewport_id: str,
) -> dict[str, Any]:
    viewport = viewport_by_id(registry, viewport_id)
    gate = registry["goalMetrics"]["gates"]["payloadBytes"]
    limit = gate["mobileMax"] if viewport["payloadClass"] == "mobile" else gate["desktopMax"]
    resource_by_url: dict[str, list[dict[str, Any]]] = {}
    for entry in resources.get("entries", []):
        resource_by_url.setdefault(str(entry.get("url", "")), []).append(entry)
    layer_urls = {
        str(layer.get("currentSrc", ""))
        for layer in manifest.get("layers", {}).values()
    }
    critical_sources = set(metrics.get("criticalSources", []))
    if not critical_sources:
        critical_sources = {
            str(entry.get("url", ""))
            for entry in resources.get("entries", [])
            if entry.get("criticalPayload") is True
        } | layer_urls
    selected = []
    inline_sources = []
    missing_sources = []
    inline_bytes = 0
    for source in sorted(critical_sources):
        if source.startswith("data:"):
            size = _inline_source_size(source)
            if size is None:
                missing_sources.append(source)
            else:
                inline_sources.append({"source": source, "bytes": size})
                inline_bytes += size
            continue
        if source.startswith("blob:"):
            missing_sources.append(source)
            continue
        matched = resource_by_url.get(source, [])
        if not matched or any(int(entry.get("transferSize", 0)) <= 0 for entry in matched):
            missing_sources.append(source)
            continue
        selected.extend(matched)
    selected_urls = {str(entry.get("url", "")) for entry in selected}
    valid_resources = (
        layer_urls.issubset(critical_sources)
        and layer_urls.issubset(selected_urls)
        and not missing_sources
    )
    value = int(
        sum(int(entry.get("transferSize", 0)) for entry in selected)
        + inline_bytes
    )
    return {
        "value": value,
        "limit": limit,
        "pass": (
            manifest["pass"]
            and valid_resources
            and value <= limit
        ),
        "resourceCount": len(critical_sources),
        "networkResourceCount": len(selected),
        "inlineSources": inline_sources,
        "missingSources": missing_sources,
        "resourcesSha256": sha256_json(resources),
    }


def no_upscale_result(
    manifest: dict[str, Any],
    registry: dict[str, Any],
    viewport_id: str,
) -> dict[str, Any]:
    gate = registry["goalMetrics"]["gates"]["noUpscale"]
    enforced = _gate_applies(gate, viewport_id)
    failures = []
    images = manifest.get("titleCriticalImages") or list(
        manifest.get("layers", {}).values()
    )
    seen = set()
    for image in images:
        key = (
            str(image.get("selector", "")),
            str(image.get("currentSrc", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        width_scale = float(image["physicalWidth"]) / float(image["naturalWidth"])
        height_scale = float(image["physicalHeight"]) / float(image["naturalHeight"])
        if max(width_scale, height_scale) > float(gate["maxPhysicalScale"]) + 1e-9:
            failures.append(
                {
                    "selector": image.get("selector"),
                    "currentSrc": image.get("currentSrc"),
                    "widthScale": width_scale,
                    "heightScale": height_scale,
                }
            )
    return {
        "enforced": enforced,
        "pass": (manifest["pass"] and not failures) if enforced else True,
        "maxPhysicalScale": gate["maxPhysicalScale"],
        "failures": failures,
    }


def evaluate_contracts(
    contracts_path: Path,
    registry: dict[str, Any],
    registry_hash: str,
) -> dict[str, Any]:
    contracts = json.loads(contracts_path.read_text())
    base = contracts_path.parent
    definitions = registry["goalMetrics"]["gates"]["assetContracts"]

    scene_selected, scene_errors = _required_results(
        contracts.get("sceneRetention", []),
        definitions["sceneRetention"]["required"],
    )
    scenes = [
        scene_retention(contract_id, scene_selected[contract_id], expected, base, definitions["sceneRetention"])
        for contract_id, expected in definitions["sceneRetention"]["required"].items()
    ]
    paper_selected, paper_errors = _required_results(
        contracts.get("parchmentRetention", []),
        definitions["parchmentRetention"]["required"],
    )
    papers = [
        parchment_retention(contract_id, paper_selected[contract_id], expected, base, definitions["parchmentRetention"])
        for contract_id, expected in definitions["parchmentRetention"]["required"].items()
    ]
    alpha_selected, alpha_errors = _required_results(
        contracts.get("alphaEdges", []),
        definitions["alphaEdges"]["required"],
    )
    alpha = [
        alpha_edge(contract_id, alpha_selected[contract_id], expected, base, definitions["alphaEdges"])
        for contract_id, expected in definitions["alphaEdges"]["required"].items()
    ]

    captures = []
    failing = []
    schema_errors = {
        "sceneRetention": scene_errors,
        "parchmentRetention": paper_errors,
        "alphaEdges": alpha_errors,
    }
    if any(schema_errors.values()):
        failing.append("assetContracts/schema")
    for item in contracts.get("captureContracts", []):
        viewport_id = item["viewport"]
        resources = json.loads(resolve_contract_path(item["resources"], base).read_text())
        metrics = json.loads(resolve_contract_path(item["metrics"], base).read_text())
        manifest = layer_manifest_result(metrics, resources, registry)
        payload = payload_result(resources, metrics, manifest, registry, viewport_id)
        upscale = no_upscale_result(manifest, registry, viewport_id)
        captures.append(
            {
                "viewport": viewport_id,
                "layerManifest": manifest,
                "payloadBytes": payload,
                "noUpscale": upscale,
            }
        )
        if not manifest["pass"]:
            failing.append(f"{viewport_id}/layerManifest")
        if not payload["pass"]:
            failing.append(f"{viewport_id}/payloadBytes")
        if upscale["enforced"] and not upscale["pass"]:
            failing.append(f"{viewport_id}/noUpscale")
    for result in scenes:
        if not result["pass"]:
            failing.append(f"{result['id']}/sceneDetailRetention")
    for result in papers:
        if not result["pass"]:
            failing.append(f"{result['id']}/parchmentBlankRetention")
    for result in alpha:
        if not result["pass"]:
            failing.append(f"{result['id']}/alphaEdge")
    return {
        "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
        "source": {"path": portable_path(contracts_path), "sha256": sha256(contracts_path)},
        "assetContracts": {
            "sceneRetention": scenes,
            "parchmentRetention": papers,
            "alphaEdges": alpha,
        },
        "captureContracts": captures,
        "failing": failing,
        "raw": {
            "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
            "registrySha256": registry_hash,
            "contractsSha256": sha256(contracts_path),
            "schemaErrors": schema_errors,
        },
    }


def _selected_viewports(registry: dict[str, Any], value: str) -> list[dict[str, Any]]:
    if value == "registered":
        return registry["viewports"]
    ids = [part.strip() for part in value.split(",") if part.strip()]
    return [viewport_by_id(registry, viewport_id) for viewport_id in ids]


def score_run(
    run: Path,
    registry: dict[str, Any],
    registry_hash: str,
    viewports: str,
) -> dict[str, Any]:
    results: dict[str, Any] = {}
    failing: list[str] = []
    for viewport in _selected_viewports(registry, viewports):
        viewport_id = viewport["id"]
        image_path = run / "render" / f"title-{viewport_id}.png"
        metrics_path = run / "metrics" / f"title-{viewport_id}.json"
        resources_path = run / "resources" / f"title-{viewport_id}.json"
        for required in (image_path, metrics_path, resources_path):
            if not required.exists():
                raise FileNotFoundError(f"mangler capturebevis: {required}")
        metrics = json.loads(metrics_path.read_text())
        resources = json.loads(resources_path.read_text())
        geometry = json.loads(json.dumps(metrics.get("geometry", {})))
        geometry["capture"] = metrics.get("capture", {})
        crop_path = geometry.get("character", {}).get("cropPath")
        if crop_path:
            geometry["character"]["cropPath"] = str((run / crop_path).resolve())
        result = score_image(image_path, viewport_id, registry, registry_hash, geometry)
        manifest = layer_manifest_result(metrics, resources, registry)
        payload = payload_result(resources, metrics, manifest, registry, viewport_id)
        upscale = no_upscale_result(manifest, registry, viewport_id)
        result["captureContracts"] = {
            "layerManifest": manifest,
            "payloadBytes": payload,
            "noUpscale": upscale,
        }
        viewport_failing = list(result["failing"])
        if not manifest["pass"]:
            viewport_failing.append("layerManifest")
        if not payload["pass"]:
            viewport_failing.append("payloadBytes")
        if upscale["enforced"] and not upscale["pass"]:
            viewport_failing.append("noUpscale")
        result["failing"] = viewport_failing
        results[viewport_id] = result
        failing.extend(f"{viewport_id}/{name}" for name in viewport_failing)
    output = {
        "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
        "run": portable_path(run),
        "viewports": results,
        "failing": failing,
        "raw": {
            "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
            "registrySha256": registry_hash,
            "viewportIds": list(results),
            "sourceHashes": {
                viewport_id: result["source"]["sha256"]
                for viewport_id, result in results.items()
            },
        },
    }
    (run / "title-fidelity.json").write_text(json.dumps(output, indent=2))
    return output


def print_human(result: dict[str, Any]) -> None:
    if "metrics" in result:
        print(
            f"{result['viewport']['id']}  "
            + "  ".join(
                f"{name}={result['metrics'][name]:.6f}"
                for name in SCREEN_GATE_ORDER
            )
        )
    elif "viewports" in result:
        for viewport_id, viewport in result["viewports"].items():
            print(
                f"{viewport_id}  "
                + "  ".join(
                    f"{name}={viewport['metrics'][name]:.6f}"
                    for name in SCREEN_GATE_ORDER
                )
            )
    print(
        f"fejler: {', '.join(result['failing'])}"
        if result["failing"]
        else "alle håndhævede gates består"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image")
    source.add_argument("--run")
    source.add_argument("--contracts")
    parser.add_argument("--geometry")
    parser.add_argument("--viewport", default="target-native")
    parser.add_argument("--viewports", default="registered")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--fail-on-gate", action="store_true")
    args = parser.parse_args()

    registry_path = Path(args.registry).resolve()
    registry = load_registry(registry_path)
    registry_hash = sha256(registry_path)
    if args.image:
        geometry = json.loads(Path(args.geometry).read_text()) if args.geometry else None
        result = score_image(
            Path(args.image).resolve(),
            args.viewport,
            registry,
            registry_hash,
            geometry,
        )
    elif args.contracts:
        result = evaluate_contracts(
            Path(args.contracts).resolve(),
            registry,
            registry_hash,
        )
    else:
        result = score_run(
            Path(args.run).resolve(),
            registry,
            registry_hash,
            args.viewports,
        )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_human(result)
    return 1 if args.fail_on_gate and result["failing"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (FileNotFoundError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
