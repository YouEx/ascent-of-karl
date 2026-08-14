#!/usr/bin/env python3
"""Målkontrakt for titelskærmens fidelity.

Den eksisterende regionsdommer beskytter mod regression. Denne fil måler i
stedet de frosne mål fra plan/design-fidelity-close-1.md REQ-003..REQ-010.
Alle afgørelser bruger uafrundede tal; afrunding er kun præsentation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
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
SCREEN_GATE_ORDER = (
    "sceneSeamGradient",
    "titleInkOccupancy",
    "bottomLeftDarkShare",
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


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    return json.loads(path.read_text())


def viewport_by_id(registry: dict[str, Any], viewport_id: str) -> dict[str, Any]:
    for viewport in registry["viewports"]:
        if viewport["id"] == viewport_id:
            return viewport
    known = ", ".join(viewport["id"] for viewport in registry["viewports"])
    raise ValueError(f'ukendt viewport "{viewport_id}". Kendte: {known}')


def _bounds(width: int, height: int, rect: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = rect
    return (
        round(x1 * width),
        round(y1 * height),
        round(x2 * width),
        round(y2 * height),
    )


def _luma_8(image: Image.Image) -> np.ndarray:
    """Den pinnede v1-kvantisering til 8-bit luma.

    Kvantiseringen sker før Laplacian/Canny og seam-delta. Den rækkefølge er
    en del af kalibreringen og må ikke ændres til flydende punkt uden en ny
    algoritmeversion.
    """
    return np.asarray(image.convert("L"), dtype=np.uint8)


def _rec709_luma(rgb: np.ndarray) -> np.ndarray:
    source = np.asarray(rgb, dtype=np.float64)
    return (
        source[..., 0] * 0.2126
        + source[..., 1] * 0.7152
        + source[..., 2] * 0.0722
    )


def screen_metrics(path: Path) -> tuple[dict[str, float], dict[str, Any]]:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    luma8 = _luma_8(image)
    rec709 = _rec709_luma(rgb)
    height, width = luma8.shape

    x1, y1, x2, y2 = _bounds(width, height, (0.288, 0.04, 0.404, 0.16))
    seam_roi = luma8[y1:y2, x1:x2].astype(np.float64)
    seam_rows = np.mean(np.abs(np.diff(seam_roi, axis=0)), axis=1)
    seam = float(np.max(seam_rows)) if seam_rows.size else 0.0

    x1, y1, x2, y2 = _bounds(width, height, (0.08, 0.10, 0.45, 0.46))
    title_mask = (luma8[y1:y2, x1:x2] < 100).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        title_mask,
        connectivity=8,
    )
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
    dark_share = float(100 * np.mean(rec709[y1:y2, x1:x2] < 108))

    x1, y1, x2, y2 = _bounds(width, height, (0.57, 0.13, 0.90, 0.78))
    character = luma8[y1:y2, x1:x2]
    laplacian = cv2.filter2D(
        character,
        cv2.CV_64F,
        LAPLACIAN_KERNEL,
        borderType=cv2.BORDER_DEFAULT,
    )
    detail = float(np.var(laplacian))

    edges = cv2.Canny(luma8, 51, 145, L2gradient=True)
    edge_density = float(100 * np.mean(edges > 0))

    return (
        {
            "sceneSeamGradient": seam,
            "titleInkOccupancy": occupancy,
            "bottomLeftDarkShare": dark_share,
            "characterDetailVariance": detail,
            "globalEdgeDensity": edge_density,
        },
        {
            "width": width,
            "height": height,
            "titleComponentMinimumArea": minimum_area,
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
) -> dict[str, Any]:
    viewport = viewport_by_id(registry, viewport_id)
    metrics, metric_raw = screen_metrics(image_path)
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
        "source": {
            "path": str(image_path),
            "sha256": source_hash,
        },
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


def _detail_variance(image: Image.Image) -> float:
    gray = _luma_8(image)
    laplacian = cv2.filter2D(
        gray,
        cv2.CV_64F,
        LAPLACIAN_KERNEL,
        borderType=cv2.BORDER_DEFAULT,
    )
    return float(np.var(laplacian))


def scene_retention(contract: dict[str, Any], base: Path, minimum: float) -> dict[str, Any]:
    master_path = resolve_contract_path(contract["master"], base)
    export_path = resolve_contract_path(contract["export"], base)
    export = Image.open(export_path).convert("RGB")
    master = Image.open(master_path).convert("RGB").resize(export.size, Image.Resampling.LANCZOS)
    master_variance = _detail_variance(master)
    export_variance = _detail_variance(export)
    value = export_variance / master_variance if master_variance > 0 else 1.0
    return {
        "id": contract["id"],
        "value": value,
        "pass": value >= minimum,
        "minimum": minimum,
        "masterSha256": sha256(master_path),
        "exportSha256": sha256(export_path),
        "masterVariance": master_variance,
        "exportVariance": export_variance,
    }


def _high_frequency_energy(image: Image.Image) -> float:
    gray = _luma_8(image).astype(np.float64)
    low = cv2.GaussianBlur(gray, (0, 0), sigmaX=2.0, sigmaY=2.0)
    return float(np.std(gray - low))


def _crop(image: Image.Image, rect: list[int]) -> Image.Image:
    x, y, width, height = rect
    return image.crop((x, y, x + width, y + height))


def parchment_retention(
    contract: dict[str, Any],
    base: Path,
    minimum: float,
    sample_minimum: float,
) -> dict[str, Any]:
    reference_path = resolve_contract_path(contract["reference"], base)
    reconstructed_path = resolve_contract_path(contract["reconstructed"], base)
    reference = Image.open(reference_path).convert("RGB")
    reconstructed = Image.open(reconstructed_path).convert("RGB")
    samples = []
    for sample in contract["samples"]:
        ref = _crop(reference, sample["referenceRect"])
        got = _crop(reconstructed, sample["reconstructedRect"]).resize(
            ref.size,
            Image.Resampling.LANCZOS,
        )
        reference_energy = _high_frequency_energy(ref)
        reconstructed_energy = _high_frequency_energy(got)
        value = (
            reconstructed_energy / reference_energy
            if reference_energy > 0
            else 1.0
        )
        samples.append(
            {
                "id": sample["id"],
                "value": value,
                "pass": value >= sample_minimum,
                "referenceEnergy": reference_energy,
                "reconstructedEnergy": reconstructed_energy,
            }
        )
    values = [sample["value"] for sample in samples]
    value = float(np.mean(values)) if values else 0.0
    minimum_sample = min(values) if values else 0.0
    return {
        "id": contract["id"],
        "value": value,
        "minimumSample": minimum_sample,
        "pass": value >= minimum and minimum_sample >= sample_minimum,
        "minimum": minimum,
        "sampleMinimum": sample_minimum,
        "referenceSha256": sha256(reference_path),
        "reconstructedSha256": sha256(reconstructed_path),
        "samples": samples,
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


def alpha_edge(contract: dict[str, Any], base: Path, definition: dict[str, Any]) -> dict[str, Any]:
    image_path = resolve_contract_path(contract["image"], base)
    rgba = np.asarray(Image.open(image_path).convert("RGBA"), dtype=np.uint8)
    rgb = rgba[..., :3].astype(np.float64)
    alpha = rgba[..., 3].astype(np.float64) / 255.0
    transition = (alpha > 0.0) & (alpha < 1.0)
    transition_px = _maximum_run_both_axes(transition)

    opaque = alpha >= (254 / 255)
    if np.any(opaque):
        _, nearest = ndimage.distance_transform_edt(~opaque, return_indices=True)
        nearest_rgb = rgb[nearest[0], nearest[1]]
    else:
        nearest_rgb = np.zeros_like(rgb)

    backgrounds = []
    fringe_masks = []
    parchment = contract.get("parchment", "#ecdcc7")
    for value in definition["backgrounds"]:
        color = parchment if value == "parchment" else value
        background = np.asarray(ImageColor.getrgb(color), dtype=np.float64)
        actual = alpha[..., None] * rgb + (1 - alpha[..., None]) * background
        ideal = alpha[..., None] * nearest_rgb + (1 - alpha[..., None]) * background
        difference = np.max(np.abs(actual - ideal), axis=2)
        fringe = transition & (difference > 3.0)
        fringe_masks.append(fringe)
        backgrounds.append(
            {
                "background": value,
                "fringePx": _maximum_run_both_axes(fringe),
            }
        )
    fringe_px = max(
        (_maximum_run_both_axes(mask) for mask in fringe_masks),
        default=0,
    )
    return {
        "id": contract["id"],
        "alphaTransitionPx": transition_px,
        "fringePx": fringe_px,
        "pass": (
            transition_px <= definition["transitionPxMax"]
            and fringe_px <= definition["fringePxMax"]
        ),
        "transitionPxMax": definition["transitionPxMax"],
        "fringePxMax": definition["fringePxMax"],
        "backgrounds": backgrounds,
        "sourceSha256": sha256(image_path),
    }


def payload_result(resources: dict[str, Any], registry: dict[str, Any], viewport_id: str) -> dict[str, Any]:
    viewport = viewport_by_id(registry, viewport_id)
    gate = registry["goalMetrics"]["gates"]["payloadBytes"]
    limit = gate["mobileMax"] if viewport["payloadClass"] == "mobile" else gate["desktopMax"]
    critical = [entry for entry in resources.get("entries", []) if entry.get("criticalPayload")]
    value = int(sum(max(0, int(entry.get("transferSize", 0))) for entry in critical))
    return {
        "value": value,
        "limit": limit,
        "pass": value <= limit,
        "resourceCount": len(critical),
        "resourcesSha256": sha256_json(resources),
    }


def no_upscale_result(metrics: dict[str, Any], registry: dict[str, Any], viewport_id: str) -> dict[str, Any]:
    gate = registry["goalMetrics"]["gates"]["noUpscale"]
    enforced = viewport_id in gate["viewports"]
    images = [image for image in metrics.get("images", []) if image.get("titleCritical")]
    failures = []
    for image in images:
        width_scale = (
            float(image["physicalWidth"]) / float(image["naturalWidth"])
            if image.get("naturalWidth")
            else float("inf")
        )
        height_scale = (
            float(image["physicalHeight"]) / float(image["naturalHeight"])
            if image.get("naturalHeight")
            else float("inf")
        )
        if max(width_scale, height_scale) > float(gate["maxPhysicalScale"]) + 1e-9:
            failures.append(
                {
                    "selector": image.get("selector"),
                    "currentSrc": image.get("currentSrc"),
                    "widthScale": width_scale,
                    "heightScale": height_scale,
                }
            )
    if enforced and not images:
        failures.append({"reason": "ingen målbar title-critical <img>"})
    return {
        "enforced": enforced,
        "pass": not failures if enforced else True,
        "maxPhysicalScale": gate["maxPhysicalScale"],
        "imageCount": len(images),
        "failures": failures,
        "metricsSha256": sha256_json(metrics),
    }


def resolve_contract_path(value: str, base: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    relative = (base / path).resolve()
    return relative if relative.exists() else (ROOT / path).resolve()


def evaluate_contracts(
    contracts_path: Path,
    registry: dict[str, Any],
    registry_hash: str,
) -> dict[str, Any]:
    contracts = json.loads(contracts_path.read_text())
    base = contracts_path.parent
    definitions = registry["goalMetrics"]["gates"]
    scenes = [
        scene_retention(item, base, definitions["sceneDetailRetention"]["min"])
        for item in contracts.get("sceneRetention", [])
    ]
    papers = [
        parchment_retention(
            item,
            base,
            definitions["parchmentBlankRetention"]["min"],
            definitions["parchmentBlankRetention"]["sampleMin"],
        )
        for item in contracts.get("parchmentRetention", [])
    ]
    alpha = [
        alpha_edge(item, base, definitions["alphaEdge"])
        for item in contracts.get("alphaEdges", [])
    ]
    captures = []
    failing = []
    for item in contracts.get("captureContracts", []):
        viewport_id = item["viewport"]
        resources = json.loads(resolve_contract_path(item["resources"], base).read_text())
        metrics = json.loads(resolve_contract_path(item["metrics"], base).read_text())
        payload = payload_result(resources, registry, viewport_id)
        upscale = no_upscale_result(metrics, registry, viewport_id)
        captures.append(
            {
                "viewport": viewport_id,
                "payloadBytes": payload,
                "noUpscale": upscale,
            }
        )
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
        "source": {
            "path": str(contracts_path),
            "sha256": sha256(contracts_path),
        },
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
        if not image_path.exists():
            raise FileNotFoundError(f"mangler capture: {image_path}")
        if not metrics_path.exists():
            raise FileNotFoundError(f"mangler metrics: {metrics_path}")
        if not resources_path.exists():
            raise FileNotFoundError(f"mangler resources: {resources_path}")
        result = score_image(image_path, viewport_id, registry, registry_hash)
        metrics = json.loads(metrics_path.read_text())
        resources = json.loads(resources_path.read_text())
        payload = payload_result(resources, registry, viewport_id)
        upscale = no_upscale_result(metrics, registry, viewport_id)
        result["captureContracts"] = {
            "payloadBytes": payload,
            "noUpscale": upscale,
        }
        viewport_failing = list(result["failing"])
        if not payload["pass"]:
            viewport_failing.append("payloadBytes")
        if upscale["enforced"] and not upscale["pass"]:
            viewport_failing.append("noUpscale")
        result["failing"] = viewport_failing
        results[viewport_id] = result
        failing.extend(f"{viewport_id}/{name}" for name in viewport_failing)
    output = {
        "algorithmVersion": registry["goalMetrics"]["algorithmVersion"],
        "run": str(run),
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
    run.mkdir(parents=True, exist_ok=True)
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
    if result["failing"]:
        print("fejler:", ", ".join(result["failing"]))
    else:
        print("alle håndhævede gates består")


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image")
    source.add_argument("--run")
    source.add_argument("--contracts")
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
        result = score_image(
            Path(args.image).resolve(),
            args.viewport,
            registry,
            registry_hash,
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
    except (FileNotFoundError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
