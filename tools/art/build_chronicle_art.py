"""Skærer krønikens tre malede stykker ud af referencen.

chronicle stod på 0.772 med materialitet 0.735 — den laveste på skærmen — og
grunden er, at panelet er samlet af tre ting, der alle er forkerte i art:

  * Bogen var 📖 — en blå-hvid emoji. Referencens er en malet opslået bog i
    brunt læder med skygge.
  * Tidslinjen havde en ▸-trekant. Referencens har et malet messingur.

Begge skæres ud med alfa fra afstanden til papiret, som mærket og headerens
ikoner. Selve fladen — åring, gradient og hulemaleriet i højre tredjedel —
bygges af build_chronicle_paper.py; den skal ikke skæres ud stykke for stykke.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art"

# Målte vinduer med luft til alle sider.
ICONS = {
    "chronicle-book": (260, 325, 360, 410),
    "chronicle-watch": (257, 446, 297, 486),
}
# Vinduet SKAL holde sig inde fra panelets egen kant: rammens afrundede
# hjørne og hårstregen over tidslinjen er mørkere end papiret og ville ellers
# blive skåret med som "pigment" og tegne en synlig ramme om vandmærket.

FLOOR = 34
SPAN = 150
CROP_FLOOR = 80
CROP_PAD = 2


def cut_icon(name: str, box, ref: np.ndarray) -> None:
    x0, y0, x1, y1 = box
    src = ref[y0:y1, x0:x1].astype(float)
    paper = np.median(src.reshape(-1, 3), axis=0)
    dist = np.abs(src - paper).sum(axis=2)

    ys, xs = np.where(dist > CROP_FLOOR)
    a, b = max(ys.min() - CROP_PAD, 0), min(ys.max() + 1 + CROP_PAD, src.shape[0])
    c, d = max(xs.min() - CROP_PAD, 0), min(xs.max() + 1 + CROP_PAD, src.shape[1])
    src, dist = src[a:b, c:d], dist[a:b, c:d]

    alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
    img = Image.fromarray(np.dstack([src, alpha * 255]).astype(np.uint8))
    img.save(OUT / f"{name}.webp", lossless=True, quality=100)
    print(f"{name}.webp {img.width}x{img.height} · i referencen x {x0 + c} y {y0 + a}")


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB"))
    for name, box in ICONS.items():
        cut_icon(name, box, ref)


if __name__ == "__main__":
    main()
