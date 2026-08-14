#!/usr/bin/env python3
"""Fail-closed fundament for titelkunstens candidate/evidence-flow.

Scriptet producerer ikke releasekunst. En candidate vurderes i en isoleret
evidencemappe. Kun et komplet sæt med ``hardGatePassed=true`` kan publiceres
til produktionsstien, og assetmappe + manifest rulles tilbage som én
transaktion ved enhver fejl.

Eksplicit negativ kontrol:

    python3 tools/art/build_title_layers.py --check \
      --negative-fixture tools/art/tests/fixtures/title-layers/patchwork
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "tools/art/title-layers.config.json"
DEFAULT_FIXTURE = ROOT / "tools/art/tests/fixtures/title-layers/patchwork"
DEFAULT_EVIDENCE = ROOT / ".art-evidence/title-layers"
DEFAULT_PRODUCTION = ROOT / "src/assets/art/title-layers"
DEFAULT_PRODUCTION_MANIFEST = ROOT / "tools/art/title-layers.manifest.json"
KINDS = {"scene", "foreground", "parchment"}
LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _canonical_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    path = Path(path)
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("version") != 1:
        raise ValueError("ukendt title-layers configversion")

    source_path = ROOT / config["source"]["path"]
    if not source_path.exists():
        raise ValueError(f"kilden mangler: {source_path.relative_to(ROOT)}")
    if _sha256_file(source_path) != config["source"]["sha256"]:
        raise ValueError("source-SHA afviger")
    with Image.open(source_path) as source:
        if list(source.size) != config["source"]["dimensions"]:
            raise ValueError("kildedimension afviger")

    files = [item["file"] for item in config["outputs"]]
    if len(files) != len(set(files)):
        raise ValueError("outputfilnavne er ikke unikke")
    if set(config["qualityGates"]["karlIdentity"]["regions"]) != {
        "face",
        "hair",
        "hands",
        "stone",
        "torso",
    }:
        raise ValueError("Karl-identitetsregionerne er ufuldstændige")
    return config


def parse_only(value: str | Iterable[str] | None) -> set[str]:
    if value is None:
        return set(KINDS)
    if isinstance(value, str):
        selected = {part.strip() for part in value.split(",") if part.strip()}
    else:
        selected = {str(part).strip() for part in value if str(part).strip()}
    unknown = selected - KINDS
    if not selected or unknown:
        raise ValueError(f"ugyldigt --only-valg: {sorted(unknown or selected)}")
    return selected


def _kind_for_file(name: str) -> str:
    for kind in KINDS:
        if name.startswith(f"{kind}-"):
            return kind
    raise ValueError(f"ukendt title-layer fil: {name}")


def _luma(image: np.ndarray) -> np.ndarray:
    return image[..., :3].astype(np.float64) @ LUMA_WEIGHTS


def gradient_error(
    candidate: np.ndarray,
    existing: np.ndarray,
    mask: np.ndarray,
) -> float:
    """Måler overlap i dets oprindelige 2D-geometri.

    Gradienter beregnes før maskering. En flattenet pixelrække må aldrig kunne
    få en vandret overgang til at ligne en lodret.
    """
    if candidate.shape != existing.shape or candidate.shape[:2] != mask.shape:
        raise ValueError("gradient-input har forskellige dimensioner")
    if not mask.any():
        return 0.0
    candidate_luma = _luma(candidate)
    existing_luma = _luma(existing)
    candidate_y, candidate_x = np.gradient(candidate_luma)
    existing_y, existing_x = np.gradient(existing_luma)
    delta = np.abs(candidate_x - existing_x) + np.abs(candidate_y - existing_y)
    return float(delta[mask].mean())


def _block_descriptors(
    image: np.ndarray,
    block_size: int,
) -> tuple[np.ndarray, list[tuple[int, int]]]:
    gray = cv2.cvtColor(image[..., :3], cv2.COLOR_RGB2GRAY)
    descriptors: list[np.ndarray] = []
    positions: list[tuple[int, int]] = []
    for y in range(0, gray.shape[0] - block_size + 1, block_size):
        for x in range(0, gray.shape[1] - block_size + 1, block_size):
            block = cv2.resize(
                gray[y:y + block_size, x:x + block_size],
                (12, 12),
                interpolation=cv2.INTER_AREA,
            ).astype(np.float64).reshape(-1)
            block -= block.mean()
            norm = np.linalg.norm(block)
            if norm <= 1.0:
                continue
            descriptors.append(block / norm)
            positions.append((x // block_size, y // block_size))
    if not descriptors:
        return np.empty((0, 144), dtype=np.float64), positions
    return np.stack(descriptors), positions


def measure_repetition(
    image: np.ndarray,
    *,
    block_sizes: Iterable[int] = (48, 64),
    correlation_threshold: float = 0.98,
) -> dict[str, Any]:
    per_size: dict[str, dict[str, float]] = {}
    shares: list[float] = []
    for block_size in block_sizes:
        descriptors, positions = _block_descriptors(image, int(block_size))
        if len(descriptors) < 2:
            share = 0.0
            maximum = 0.0
        else:
            correlations = descriptors @ descriptors.T
            np.fill_diagonal(correlations, -1.0)
            for index, (x, y) in enumerate(positions):
                neighbours = [
                    other
                    for other, (other_x, other_y) in enumerate(positions)
                    if abs(x - other_x) <= 1 and abs(y - other_y) <= 1
                ]
                correlations[index, neighbours] = -1.0
            maxima = correlations.max(axis=1)
            share = float((maxima > correlation_threshold).mean())
            maximum = float(maxima.max())
        shares.append(share)
        per_size[str(block_size)] = {
            "repeatedBlockShare": share,
            "maxNonLocalCorrelation": maximum,
        }
    return {
        "perBlockSize": per_size,
        "maxRepeatedBlockShare": max(shares, default=0.0),
    }


def measure_coherence(image: np.ndarray) -> dict[str, float]:
    luma = _luma(image)
    column_jumps = np.mean(np.abs(np.diff(luma, axis=1)), axis=0)
    row_jumps = np.mean(np.abs(np.diff(luma, axis=0)), axis=1)
    return {
        "maxColumnJump": float(column_jumps.max(initial=0.0)),
        "maxRowJump": float(row_jumps.max(initial=0.0)),
        "maxRowColumnJump": float(
            max(column_jumps.max(initial=0.0), row_jumps.max(initial=0.0))
        ),
    }


def measure_alpha(rgba: np.ndarray) -> dict[str, Any]:
    alpha = rgba[..., 3]
    semitransparent = (alpha > 0) & (alpha < 255)
    transition = int(
        np.ceil(
            float(
                cv2.distanceTransform(
                    semitransparent.astype(np.uint8),
                    cv2.DIST_L2,
                    3,
                ).max(initial=0.0)
            )
        )
    )

    fringe_delta = 0.0
    if semitransparent.any():
        opaque = (alpha >= 254).astype(np.float32)
        count = cv2.blur(opaque, (3, 3))
        neighbour_rgb = np.dstack(
            [
                cv2.blur(rgba[..., channel].astype(np.float32) * opaque, (3, 3))
                / np.maximum(count, 1e-6)
                for channel in range(3)
            ]
        )
        usable = semitransparent & (count > 0)
        if usable.any():
            delta = np.mean(
                np.abs(rgba[..., :3].astype(np.float32) - neighbour_rgb),
                axis=2,
            )
            fringe_delta = float(np.quantile(delta[usable], 0.95))
        else:
            fringe_delta = float("inf")
    return {
        "hasAntialiasedTransition": bool(semitransparent.any()),
        "transitionPx": transition,
        "fringeDeltaP95": fringe_delta,
        "alphaValueCount": int(np.unique(alpha).size),
    }


def measure_silhouette(rgba: np.ndarray) -> dict[str, Any]:
    mask = (rgba[..., 3] >= 128).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    areas = sorted(
        (int(area) for area in stats[1:, cv2.CC_STAT_AREA]),
        reverse=True,
    )
    total = sum(areas)
    return {
        "coverage": float(mask.mean()),
        "componentCount": count - 1,
        "largestComponentShare": float(areas[0] / total) if total else 0.0,
    }


def _read_image(path: Path, mode: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert(mode))


def _load_fixture_manifest(candidate_dir: Path) -> dict[str, Any]:
    path = candidate_dir / "manifest.json"
    if not path.exists():
        raise ValueError(f"candidate-manifest mangler: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _selected_outputs(
    candidate_dir: Path,
    config: dict[str, Any],
    selected_kinds: set[str],
) -> list[dict[str, Any]]:
    expected = [
        item for item in config["outputs"] if item["kind"] in selected_kinds
    ]
    outputs: list[dict[str, Any]] = []
    for item in expected:
        path = candidate_dir / item["file"]
        if not path.exists():
            raise ValueError(f"candidate-output mangler: {path.name}")
        with Image.open(path) as image:
            dimensions = list(image.size)
            mode = image.mode
        if dimensions != item["dimensions"]:
            raise ValueError(f"{path.name}: forkert dimension {dimensions}")
        outputs.append(
            {
                "id": item["id"],
                "kind": item["kind"],
                "file": item["file"],
                "dimensions": dimensions,
                "mode": mode,
                "bytes": path.stat().st_size,
                "sha256": _sha256_file(path),
            }
        )
    return outputs


def _localized_karl_identity(
    candidate_dir: Path,
    fixture_manifest: dict[str, Any],
    config: dict[str, Any],
    outputs: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    source = _read_image(ROOT / config["source"]["path"], "RGB")
    placements = fixture_manifest.get("sourcePlacements", {})
    regions = config["qualityGates"]["karlIdentity"]["regions"]
    per_asset: dict[str, dict[str, float]] = {}
    maxima = {name: 0.0 for name in regions}

    for output in outputs:
        if output["kind"] != "scene":
            continue
        placement = placements.get(output["id"])
        if not placement:
            per_asset[output["id"]] = {name: float("inf") for name in regions}
            maxima = {name: float("inf") for name in regions}
            continue
        actual = _read_image(candidate_dir / output["file"], "RGB")
        sx0, sy0, sx1, sy1 = placement["sourceCrop"]
        dx0, dy0, dx1, dy1 = placement["destination"]
        scale_x = (dx1 - dx0) / (sx1 - sx0)
        scale_y = (dy1 - dy0) / (sy1 - sy0)
        per_asset[output["id"]] = {}
        for name, (x0, y0, x1, y1) in regions.items():
            if not (sx0 <= x0 < x1 <= sx1 and sy0 <= y0 < y1 <= sy1):
                value = float("inf")
            else:
                ox0 = dx0 + round((x0 - sx0) * scale_x)
                oy0 = dy0 + round((y0 - sy0) * scale_y)
                ox1 = dx0 + round((x1 - sx0) * scale_x)
                oy1 = dy0 + round((y1 - sy0) * scale_y)
                expected = np.asarray(
                    Image.fromarray(source[y0:y1, x0:x1]).resize(
                        (ox1 - ox0, oy1 - oy0),
                        Image.Resampling.LANCZOS,
                    )
                )
                observed = actual[oy0:oy1, ox0:ox1]
                value = float(
                    np.abs(
                        observed.astype(np.int16) - expected.astype(np.int16)
                    ).mean()
                )
            per_asset[output["id"]][name] = value
            maxima[name] = max(maxima[name], value)
    return per_asset, maxima


def _parchment_plate_retention(
    candidate_dir: Path,
    config: dict[str, Any],
    selected_kinds: set[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if "parchment" not in selected_kinds:
        return (
            {"status": "not-selected"},
            {"passed": True, "status": "not-selected"},
        )
    plate_path = ROOT / config["parchmentMaster"]["plate"]
    mask_path = ROOT / config["parchmentMaster"]["mask"]
    missing = [
        str(path.relative_to(ROOT))
        for path in (plate_path, mask_path)
        if not path.exists()
    ]
    if missing:
        return (
            {"status": "blocked", "missing": missing},
            {"passed": False, "status": "blocked", "missing": missing},
        )

    plate = _read_image(plate_path, "RGB")
    mask = _read_image(mask_path, "L") >= 128
    candidate = _read_image(candidate_dir / "parchment-desktop.webp", "RGB")
    if candidate.shape[:2] != plate.shape[:2] or mask.shape != plate.shape[:2]:
        value = 0.0
    else:
        plate_luma = _luma(plate)
        candidate_luma = _luma(candidate)
        plate_high = plate_luma - cv2.GaussianBlur(
            plate_luma.astype(np.float32), (0, 0), 1.2
        )
        candidate_high = candidate_luma - cv2.GaussianBlur(
            candidate_luma.astype(np.float32), (0, 0), 1.2
        )
        value = float(
            np.mean(np.square(candidate_high[mask]))
            / max(float(np.mean(np.square(plate_high[mask]))), 1e-9)
        )
    minimum = config["qualityGates"]["parchmentPlateRetention"]["minimum"]
    return (
        {"status": "measured", "retention": value},
        {
            "passed": value >= minimum,
            "status": "measured",
            "retention": value,
            "minimum": minimum,
        },
    )


def evaluate_candidate(
    candidate_dir: Path,
    *,
    config_path: Path = DEFAULT_CONFIG,
    only: str | Iterable[str] | None = None,
) -> dict[str, Any]:
    candidate_dir = Path(candidate_dir)
    config = load_config(config_path)
    selected_kinds = parse_only(only)
    outputs = _selected_outputs(candidate_dir, config, selected_kinds)
    fixture_manifest = _load_fixture_manifest(candidate_dir)
    gates_config = config["qualityGates"]

    repetition: dict[str, Any] = {}
    coherence: dict[str, Any] = {}
    alpha: dict[str, Any] = {}
    silhouette: dict[str, Any] = {}
    for output in outputs:
        path = candidate_dir / output["file"]
        if output["kind"] in {"scene", "parchment"}:
            rgb = _read_image(path, "RGB")
            repetition[output["id"]] = measure_repetition(
                rgb,
                block_sizes=gates_config["repetition"]["blockSizes"],
                correlation_threshold=gates_config["repetition"][
                    "correlationThreshold"
                ],
            )
            coherence[output["id"]] = measure_coherence(rgb)
        if output["kind"] in {"foreground", "parchment"}:
            rgba = _read_image(path, "RGBA")
            alpha[output["id"]] = measure_alpha(rgba)
            silhouette[output["id"]] = measure_silhouette(rgba)

    repetition_passed = all(
        item["maxRepeatedBlockShare"]
        <= gates_config["repetition"]["maxRepeatedBlockShare"]
        for item in repetition.values()
    )
    coherence_passed = all(
        item["maxRowColumnJump"]
        <= gates_config["coherence"]["maxRowColumnJump"]
        for item in coherence.values()
    )

    silhouette_passed = True
    for output in outputs:
        if output["id"] not in silhouette:
            continue
        item = silhouette[output["id"]]
        if output["kind"] == "parchment":
            minimum, maximum = gates_config["silhouette"]["parchmentCoverage"]
            silhouette_passed &= minimum <= item["coverage"] <= maximum
            silhouette_passed &= (
                item["componentCount"]
                <= gates_config["silhouette"]["parchmentMaxComponents"]
                and item["largestComponentShare"]
                >= gates_config["silhouette"]["parchmentMinLargestComponentShare"]
            )
        else:
            minimum, maximum = gates_config["silhouette"]["foregroundCoverage"]
            silhouette_passed &= minimum <= item["coverage"] <= maximum
            silhouette_passed &= (
                item["componentCount"]
                <= gates_config["silhouette"]["foregroundMaxComponents"]
                and item["largestComponentShare"]
                >= gates_config["silhouette"]["foregroundMinLargestComponentShare"]
            )

    alpha_passed = all(
        (
            (not gates_config["alpha"]["requireAntialiasedTransition"])
            or item["hasAntialiasedTransition"]
        )
        and item["transitionPx"] <= gates_config["alpha"]["maxTransitionPx"]
        and item["fringeDeltaP95"] <= gates_config["alpha"]["maxFringeDelta"]
        for item in alpha.values()
    )

    identity_by_asset, identity_maxima = _localized_karl_identity(
        candidate_dir,
        fixture_manifest,
        config,
        outputs,
    )
    identity_limit = gates_config["karlIdentity"]["maxRegionMae"]
    identity_passed = all(value <= identity_limit for value in identity_maxima.values())

    parchment_metric, parchment_gate = _parchment_plate_retention(
        candidate_dir,
        config,
        selected_kinds,
    )

    source_coverage: dict[str, float] = {}
    for output in outputs:
        if output["kind"] != "scene":
            continue
        placement = fixture_manifest.get("sourcePlacements", {}).get(output["id"])
        if not placement:
            source_coverage[output["id"]] = 0.0
            continue
        dx0, dy0, dx1, dy1 = placement["destination"]
        width, height = output["dimensions"]
        source_coverage[output["id"]] = (
            (dx1 - dx0) * (dy1 - dy0) / (width * height)
        )
    coverage_passed = all(
        value >= config["provenanceGates"]["minDirectSourceCoverage"]
        for value in source_coverage.values()
    )

    gates = {
        "fullFrameRepetition": {
            "passed": repetition_passed,
            "maximum": max(
                (
                    value["maxRepeatedBlockShare"]
                    for value in repetition.values()
                ),
                default=0.0,
            ),
        },
        "fullFrameCoherence": {
            "passed": coherence_passed,
            "maximum": max(
                (value["maxRowColumnJump"] for value in coherence.values()),
                default=0.0,
            ),
        },
        "silhouette": {"passed": silhouette_passed},
        "alpha": {"passed": alpha_passed},
        "localizedKarlIdentity": {
            "passed": identity_passed,
            "regions": sorted(identity_maxima),
            "maxMaeByRegion": identity_maxima,
            "maximumAllowed": identity_limit,
        },
        "parchmentPlateRetention": parchment_gate,
        "sourceCoverage": {
            "passed": coverage_passed,
            "values": source_coverage,
            "minimum": config["provenanceGates"]["minDirectSourceCoverage"],
        },
    }
    report = {
        "version": 2,
        "algorithmVersion": "title-layers-foundation-v2",
        "configSha256": _sha256_file(Path(config_path)),
        "source": {
            "path": config["source"]["path"],
            "sha256": config["source"]["sha256"],
        },
        "selection": sorted(selected_kinds),
        "outputs": outputs,
        "metrics": {
            "repetition": repetition,
            "coherence": coherence,
            "alpha": alpha,
            "silhouette": silhouette,
            "localizedKarlIdentity": identity_by_asset,
            "parchmentPlateRetention": parchment_metric,
            "sourceCoverage": source_coverage,
        },
        "gates": gates,
    }
    report["hardGatePassed"] = all(gate["passed"] for gate in gates.values())
    return report


def _replace_directory(staged: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    backup = destination.with_name(
        f".{destination.name}.backup-{uuid.uuid4().hex[:12]}"
    )
    moved = False
    try:
        if destination.exists():
            os.replace(destination, backup)
            moved = True
        os.replace(staged, destination)
    except Exception:
        if destination.exists():
            shutil.rmtree(destination)
        if moved and backup.exists():
            os.replace(backup, destination)
        raise
    finally:
        if backup.exists():
            shutil.rmtree(backup)


def stage_candidate(
    candidate_dir: Path,
    evidence_dir: Path,
    *,
    config_path: Path = DEFAULT_CONFIG,
    only: str | Iterable[str] | None = None,
) -> dict[str, Any]:
    candidate_dir = Path(candidate_dir)
    evidence_dir = Path(evidence_dir)
    try:
        evidence_dir.resolve().relative_to(DEFAULT_PRODUCTION.resolve())
        targets_production = True
    except ValueError:
        targets_production = False
    if targets_production:
        raise ValueError("rød evidence må aldrig målrette produktionsstien")
    report = evaluate_candidate(
        candidate_dir,
        config_path=config_path,
        only=only,
    )
    with tempfile.TemporaryDirectory(
        dir=evidence_dir.parent if evidence_dir.parent.exists() else None,
        prefix=".title-evidence-",
    ) as temporary:
        staged = Path(temporary) / "evidence"
        staged.mkdir()
        for output in report["outputs"]:
            shutil.copy2(candidate_dir / output["file"], staged / output["file"])
        (staged / "manifest.json").write_text(
            _canonical_json(report),
            encoding="utf-8",
        )
        _replace_directory(staged, evidence_dir)
    return report


def _validate_green_evidence(evidence_dir: Path) -> dict[str, Any]:
    manifest_path = evidence_dir / "manifest.json"
    if not manifest_path.exists():
        raise ValueError("evidence-manifest mangler")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("hardGatePassed") is not True:
        raise RuntimeError("hardGatePassed er false; publication afvist")
    expected = {item["file"] for item in manifest.get("outputs", [])}
    actual = {path.name for path in evidence_dir.glob("*.webp")}
    if expected != actual:
        raise ValueError("evidence assetset matcher ikke manifestet")
    for item in manifest["outputs"]:
        path = evidence_dir / item["file"]
        if path.stat().st_size != item["bytes"] or _sha256_file(path) != item["sha256"]:
            raise ValueError(f"{path.name}: hash/byte-manifest afviger")
    return manifest


def publish_evidence(
    evidence_dir: Path,
    output_dir: Path = DEFAULT_PRODUCTION,
    manifest_path: Path = DEFAULT_PRODUCTION_MANIFEST,
    *,
    fault_at: str | None = None,
) -> dict[str, Any]:
    """Publicerer kun grøn evidence og ruller begge destinationer tilbage."""
    evidence_dir = Path(evidence_dir)
    output_dir = Path(output_dir)
    manifest_path = Path(manifest_path)
    manifest = _validate_green_evidence(evidence_dir)

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:12]
    output_backup = output_dir.with_name(f".{output_dir.name}.backup-{token}")
    manifest_backup = manifest_path.with_name(f".{manifest_path.name}.backup-{token}")
    with tempfile.TemporaryDirectory(
        dir=output_dir.parent,
        prefix=".title-publish-",
    ) as temporary:
        temporary_root = Path(temporary)
        staged_output = temporary_root / "assets"
        staged_output.mkdir()
        for item in manifest["outputs"]:
            shutil.copy2(evidence_dir / item["file"], staged_output / item["file"])
        staged_manifest = temporary_root / "manifest.json"
        staged_manifest.write_text(_canonical_json(manifest), encoding="utf-8")

        output_moved = False
        manifest_moved = False
        try:
            if output_dir.exists():
                os.replace(output_dir, output_backup)
                output_moved = True
            if manifest_path.exists():
                os.replace(manifest_path, manifest_backup)
                manifest_moved = True
            if fault_at == "after-backup":
                raise RuntimeError("fault injection: after-backup")

            os.replace(staged_output, output_dir)
            if fault_at == "after-assets":
                raise RuntimeError("fault injection: after-assets")

            os.replace(staged_manifest, manifest_path)
            if fault_at == "after-manifest":
                raise RuntimeError("fault injection: after-manifest")
        except Exception:
            if output_dir.exists():
                shutil.rmtree(output_dir)
            if manifest_path.exists():
                manifest_path.unlink()
            if output_moved and output_backup.exists():
                os.replace(output_backup, output_dir)
            if manifest_moved and manifest_backup.exists():
                os.replace(manifest_backup, manifest_path)
            raise
        finally:
            if output_backup.exists():
                shutil.rmtree(output_backup)
            if manifest_backup.exists():
                manifest_backup.unlink()
    return manifest


def _print_report(report: dict[str, Any]) -> None:
    print(
        "title-layers:",
        "GREEN" if report["hardGatePassed"] else "RED",
        f"selection={','.join(report['selection'])}",
    )
    for name, gate in report["gates"].items():
        print(f"  {name}: {'GREEN' if gate['passed'] else 'RED'}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--negative-fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--evidence-dir", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--only", default=None)
    parser.add_argument("--publish", type=Path, default=None)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_PRODUCTION)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_PRODUCTION_MANIFEST)
    args = parser.parse_args()

    if args.publish is not None:
        report = publish_evidence(
            args.publish,
            args.output_root,
            args.manifest,
        )
        _print_report(report)
        return 0
    if not args.check:
        parser.error("brug --check eller --publish")

    report = stage_candidate(
        args.negative_fixture,
        args.evidence_dir,
        config_path=args.config,
        only=args.only,
    )
    _print_report(report)
    return 0 if report["hardGatePassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
