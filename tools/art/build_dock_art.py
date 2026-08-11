"""Skærer dokkens to malede detaljer ud af referencen.

Slots stod på 0,806 med tone 0,779 og ink 0,873. Udsnittet viste hvorfor:
feltets flade var en flad tone med en CSS-stiplet kant, hvor referencen har
malet papir, en lys cremeramme, en håndtegnet stiplet linje og et
spøgelsesomrids i venstre side. Og pluset mellem felterne er ikke et tegn i
brødskrift, men en cremefarvet medaljon med lysende ring og et tykt kors.

Derfor to snit: hele feltets flade (cut_panel) og medaljonen (CUTS).

Samme metode som mærket, headerens ikoner og elementtegningerne: alfa er
afstanden fra papirfarven, RGB beholdes råt. Afstanden tages numerisk, så
medaljonens LYSE skær tælles med på lige fod med korsets mørke streg.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/ui"

# Målte vinduer i referencen. Luft til alle sider: bboxen findes af tærsklen.
CUTS = {
    "dock-plus": (620, 594, 682, 668),
}
# Papirets korn ligger på ~26 i sum-afstand. Omridset er meget svagt (kun
# 5-8 enheder mørkere end papiret), så gulvet er lavere end ikonernes 34.
FLOOR = 14
CROP_FLOOR = 26
SPAN = 90
SCALE = 2


def cut(name: str, box: tuple[int, int, int, int], ref: np.ndarray) -> None:
    x0, y0, x1, y1 = box
    src = ref[y0:y1, x0:x1].astype(float)
    paper = np.median(src.reshape(-1, 3), axis=0)
    dist = np.abs(src - paper).sum(axis=2)

    ys, xs = np.where(dist > CROP_FLOOR)
    if not len(ys):
        raise SystemExit(f"{name}: intet fundet — vinduet rammer forbi")
    src = src[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    dist = dist[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]

    alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
    rgba = np.dstack([src, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba)
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.webp", lossless=True, quality=100)
    print(f"{name}.webp {img.width}x{img.height} · papir {paper.astype(int)}")


# Hele feltets flade. Målt på cremerammen og den stiplede linje i række 54
# og søjle 200: felt 1 løber x 0..374, y 0..108 inde i slots-rammen. Kornet,
# gradienten, den stiplede kant, den lyse ramme og spøgelsesomridset er alle
# malet ind — de skal ikke bygges igen i CSS.
PANEL = (237, 578, 611, 686)
# Kun teksten males væk. Grænsen ved x=100 er den samme mur som fortællerens
# bueskytte havde: omridset ligger i samme tonebånd som skriften.
TEXT = (100, 22, 366, 88)
TEXT_X0 = 100
INK = 168


def cut_panel(ref: np.ndarray) -> None:
    x0, y0, x1, y1 = PANEL
    src = ref[y0:y1, x0:x1].astype(np.uint8).copy()
    grey = src.astype(float).sum(axis=2) / 3
    mask = np.zeros(grey.shape, np.uint8)
    tx0, ty0, tx1, ty1 = TEXT
    band = grey[ty0:ty1, tx0:tx1]
    mask[ty0:ty1, tx0:tx1] = (band < INK).astype(np.uint8) * 255
    mask[:, :TEXT_X0] = 0
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=2)
    out = cv2.inpaint(src, mask, 6, cv2.INPAINT_TELEA)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(OUT / "slot-paper.webp", lossless=True, quality=100)
    print(f"slot-paper.webp {out.shape[1]}x{out.shape[0]}")


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB"))
    for name, box in CUTS.items():
        cut(name, box, ref)
    cut_panel(ref)


if __name__ == "__main__":
    main()
