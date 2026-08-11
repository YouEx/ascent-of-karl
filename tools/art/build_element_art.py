"""Skærer gitterets elementtegninger ud af referencen.

Gitterets struktur stod på 0,351 — det laveste tal på hele skærmen. Målingen
peger direkte på tegningerne, ikke på kortene: kortets fyld måler (231,210,185)
i referencen mod vores (228,206,180), altså praktisk talt samme papir, men
gradientenergien inde i illustrationsfeltet er 15,47 i referencen mod vores
10,80. Vores tegninger er 30 % fladere. Det er ikke en tone man kan skrue på;
det er en anden streg.

Elleve af de tretten elementtegninger står i referencen. De skæres ud med
samme metode som mærket og headerens ikoner: alfa er afstanden fra kortets
papirfarve, RGB beholdes råt. To tærskler, fordi én tærskel gør papirets eget
korn til en del af bboxen — en lav til alfa, så bløde kanter ikke bander, og
en høj til beskæringen.

Referencen er 1x. Tegningerne opskaleres til 2x med Lanczos, fordi de øvrige
elementbilleder ligger i 192 px og skærmen er retina. Det gør dem en anelse
blødere end en nytegning ville være — men formen, farven og lyset er
referencens egne, og det er dét, sammenligningen handler om.

korn og okse står ikke i referencen (de hører til akt 2) og røres ikke.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/elements"

# Gitteret begynder på (237,785). Kortene er målt til 129x118 med 146,7 px
# vandret pitch og 136 px lodret pitch.
GRID = (237, 785)
COL_X = [2, 148, 292, 441, 588, 736, 882]
ROW_Y = [2, 138]
# Illustrationsfeltet inde i kortet: under den øverste fas og over etiketten.
ILLO = (8, 4, 121, 86)
# Sidste søjle er klippet af rammen i referencen: dens lyse kortflade måler 86
# px mod de øvriges 112, så vinduet skal stoppe ved rammens kant.
ILLO_LAST = (10, 12, 88, 86)

CARDS = {
    "sten": (0, 0),
    "pind": (1, 0),
    "graes": (2, 0),
    "vand": (3, 0),
    "ler": (4, 0),
    "baer": (5, 0),
    "larver": (6, 0),
    "dyr": (0, 1),
    "stamme": (1, 1),
    "nabo": (2, 1),
    "fugl": (3, 1),
}

# Papirets eget korn ligger på ~28 i sum-afstand. FLOOR lader kornet være,
# CROP_FLOOR holder det ude af bboxen.
FLOOR = 30
CROP_FLOOR = 78
SPAN = 170
SCALE = 2


def cut(name: str, col: int, row: int, ref: np.ndarray) -> None:
    cx = GRID[0] + COL_X[col]
    cy = GRID[1] + ROW_Y[row]
    ix0, iy0, ix1, iy1 = ILLO_LAST if col == len(COL_X) - 1 else ILLO
    src = ref[cy + iy0 : cy + iy1, cx + ix0 : cx + ix1].astype(float)

    # Papirfarven læses i feltets fire hjørner, hvor tegningen aldrig når ud.
    k = 7
    corners = np.concatenate(
        [
            src[:k, :k].reshape(-1, 3),
            src[:k, -k:].reshape(-1, 3),
            src[-k:, :k].reshape(-1, 3),
            src[-k:, -k:].reshape(-1, 3),
        ]
    )
    paper = np.median(corners, axis=0)
    dist = np.abs(src - paper).sum(axis=2)

    ys, xs = np.where(dist > CROP_FLOOR)
    if not len(ys):
        raise SystemExit(f"{name}: intet fundet — vinduet rammer forbi")
    y0, y1 = max(ys.min() - 2, 0), min(ys.max() + 3, src.shape[0])
    x0, x1 = max(xs.min() - 2, 0), min(xs.max() + 3, src.shape[1])
    src = src[y0:y1, x0:x1]
    dist = dist[y0:y1, x0:x1]

    alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
    rgba = np.dstack([src, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba)
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
    img.save(OUT / f"{name}.webp", lossless=True, quality=100)
    print(f"{name}.webp {img.width}x{img.height} · papir {paper.astype(int)}")


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB"))
    for name, (col, row) in CARDS.items():
        cut(name, col, row, ref)


if __name__ == "__main__":
    main()
