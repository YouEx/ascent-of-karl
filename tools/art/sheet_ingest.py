"""Delt, deterministisk udskæringsmotor for malede element-ark.

Uddraget af `build_elements.py`, som den oprindeligt implementerede denne
logik alene for de 13 grundelementer. Fremtidige tematiske ark (TASK-038:
174 resterende elementer i bunker sten/træ/mad/dyr/værktøj/ild/samfund)
skal skæres ud med SAMME metode, ikke en ny — ellers driver de nye brikker
fra de gamle på præcis den måde, hele normaliserings-pipelinen (TASK-034)
findes for at forhindre.

Metoden er fremspring, ikke sammenhængskomponenter eller en AI-baseret
segmentering: en sum af maskede pixels per række finder vandrette bånd med
indhold; inde i hvert bånd giver samme sum per søjle den enkelte genstand.
Robust over for at et gitter ikke er helt regelmæssigt, og — vigtigst for
denne prøvelse — 100 % deterministisk og uden nogen model i selve
beskæringen. "Ingen AI-dekomponering/beskæring" (prøvelsens ord) betyder
netop dette: et billede må gerne komme FRA en billedmodel (Higgsfield), men
at finde og skære brikkerne ud af det arket sker med ren aritmetik.

`build_elements.py` er nu en tynd indpakning om denne fil — samme ORDER,
samme konstanter, samme regnerækkefølge. Regressionstesten
`tools/art/tests/test_build_elements_regression.py` låser at omlægningen
ikke har ændret en eneste byte i de 13 committede filer.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

Box = tuple[int, int, int, int]  # (x0, y0, x1, y1), halvåbent i x1/y1


@dataclass(frozen=True)
class DetectParams:
    """Parametre for at finde genstandenes bokse på et ark."""

    mask_threshold: float = 18.0
    min_area: int = 400
    gap_min: int = 8
    gap_divisor: int = 60


@dataclass(frozen=True)
class CutParams:
    """Parametre for at klippe en enkelt genstand ud og normalisere den."""

    tile: int = 192
    pad: float = 0.04
    alpha_floor: float = 9.0
    alpha_full: float = 42.0


def load_rgb(path: Path) -> np.ndarray:
    """Læser et billede som float64 RGB — samme dtype build_elements.py brugte."""
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float64)


def sample_border_background(a: np.ndarray, border: int = 8) -> np.ndarray:
    """Medianen af en kantramme — rammer den flade baggrund uden at blive
    trukket af en genstand, der ligger tæt på kanten."""
    frame = np.concatenate(
        [
            a[:border].reshape(-1, 3),
            a[-border:].reshape(-1, 3),
            a[:, :border].reshape(-1, 3),
            a[:, -border:].reshape(-1, 3),
        ]
    )
    return np.median(frame, axis=0)


def content_mask(a: np.ndarray, bg: np.ndarray, threshold: float) -> tuple[np.ndarray, np.ndarray]:
    """Afstand fra baggrunden per pixel, og masken den udløser."""
    dist = np.abs(a - bg).max(axis=2)
    return dist, dist > threshold


def bands(profile: np.ndarray, gap: int) -> list[tuple[int, int]]:
    """Sammenhængende områder med indhold, adskilt af mindst `gap` tomme linjer.

    Uændret fra build_elements.py's `_bands` — kun navngivet uden
    underscore, fordi den nu er offentligt genbrugt API.
    """
    on = profile > 0
    result: list[tuple[int, int]] = []
    start, run = None, 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i - run if run and result and i - run <= result[-1][1] + gap else i
            run = 0
        else:
            if start is not None:
                run += 1
                if run >= gap:
                    result.append((start, i - run + 1))
                    start = None
    if start is not None:
        result.append((start, len(on)))
    return [(a0, b0) for a0, b0 in result if b0 - a0 > 4]


def detect_boxes(mask: np.ndarray, params: DetectParams = DetectParams()) -> list[Box]:
    """Finder genstandsbokse i læserækkefølge (bånd for bånd, top til bund;
    inde i hvert bånd, venstre til højre)."""
    h = mask.shape[0]
    gap = max(params.gap_min, h // params.gap_divisor)
    boxes: list[Box] = []
    for y0, y1 in bands(mask.sum(axis=1), gap):
        strip = mask[y0:y1]
        for x0, x1 in bands(strip.sum(axis=0), gap):
            sub = strip[:, x0:x1]
            if sub.sum() < params.min_area:
                continue
            ys = np.where(sub.any(axis=1))[0]
            boxes.append((x0, y0 + ys[0], x1, y0 + ys[-1] + 1))
    return boxes


def alpha_from_distance(dist: np.ndarray, floor: float, full: float) -> np.ndarray:
    return np.clip((dist - floor) / (full - floor), 0.0, 1.0)


def unpremultiply(a: np.ndarray, bg: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Farven u-præmultipliceret tilbage, så bløde kanter overlever og
    genstanden kan ligge på et hvilket som helst kort uden en firkant."""
    safe = np.maximum(alpha, 1e-6)[..., None]
    return np.clip((a - (1.0 - alpha)[..., None] * bg) / safe, 0, 255)


def cut_full_rgba(a: np.ndarray, bg: np.ndarray, dist: np.ndarray, params: CutParams) -> Image.Image:
    """Bygger det fulde RGBA-billede (samme størrelse som arket) med alfa
    udregnet af afstanden til baggrunden. Beskæring pr. genstand sker
    bagefter med `pad_and_scale`, så bokse kan opdateres uden at regne
    farverne om igen."""
    alpha = alpha_from_distance(dist, params.alpha_floor, params.alpha_full)
    fg = unpremultiply(a, bg, alpha)
    rgba = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba)


def pad_and_scale(full: Image.Image, box: Box, params: CutParams) -> Image.Image:
    """Beskærer én genstand ud af det fulde RGBA-billede med fast luft
    omkring, og skalerer til `params.tile` på den længste side."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    pad = int(round(max(bw, bh) * params.pad))
    crop = full.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    scale = params.tile / max(crop.width, crop.height)
    return crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.LANCZOS,
    )


def detect_and_cut(
    sheet_path: Path,
    expected_count: int | None,
    detect_params: DetectParams = DetectParams(),
    cut_params: CutParams = CutParams(),
) -> tuple[list[Box], Image.Image]:
    """Finder alle genstandsbokse på et ark og bygger det fulde normaliserede
    RGBA-billede. Kaster hvis `expected_count` ikke matcher — samme
    "gæt ikke"-disciplin som `build_elements.py` altid har håndhævet."""
    a = load_rgb(sheet_path)
    bg = sample_border_background(a)
    dist, mask = content_mask(a, bg, detect_params.mask_threshold)
    boxes = detect_boxes(mask, detect_params)
    if expected_count is not None and len(boxes) != expected_count:
        raise SystemExit(
            f"fandt {len(boxes)} genstande, forventede {expected_count}.\n"
            "Arket matcher ikke den forventede rækkefølge — ret rækkefølgen "
            "eller arket, gæt ikke."
        )
    full = cut_full_rgba(a, bg, dist, cut_params)
    return boxes, full


def cut_tiles(sheet_path: Path, order: list[str], detect_params: DetectParams = DetectParams(), cut_params: CutParams = CutParams()) -> dict[str, Image.Image]:
    """Bekvemmelighedsfunktion: `detect_and_cut` + `pad_and_scale` for hvert
    navn i `order`, i den rækkefølge boksene blev fundet i (læserækkefølge)."""
    boxes, full = detect_and_cut(sheet_path, len(order), detect_params, cut_params)
    return {name: pad_and_scale(full, box, cut_params) for name, box in zip(order, boxes)}
