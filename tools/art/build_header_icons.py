"""Skærer headerens ikoner ud af referencen i stedet for at tegne dem.

DESIGN.md §8 siger "ikoner er streg, ikke emoji", og det er grunden til, at
headeren stod med tynde sorte SVG-streger. Referencen gør noget andet: dens
pokal er et malet guldbæger med lys kant, og dens omgør-pil er tyk, mørkebrun
og har et lyst højlys under sig. Forskellen er ikke smag — den er målbar.
Headerens blækdækning stod på 0.476 mod referencens, fordi vores glyffer er
under halvt så tunge.

Samme metode som mærket, kombinér-tavlen og gnisten: alfa er afstanden fra
papirfarven, RGB beholdes råt. Kanterne får en pergamentfarvet bræmme, men da
ikonerne lægges tilbage PÅ pergament, er den bræmme netop rigtig.

Tælleren ved siden af titlen har sit eget lille bæger — en anden tegning, ikke
den store skaleret ned, så den skæres ud for sig. Fortællerens højttaler ligger
samme sted i metoden og er derfor med her, selvom den ikke sidder i headeren.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/ui"

# Målt i referencen. Vinduerne har luft til alle sider, så bboxen findes af
# tærsklen og ikke af, hvor vinduet tilfældigvis blev sat.
ICONS = {
    "icon-trophy": (1156, 36, 1186, 66),
    "icon-restart": (1221, 36, 1252, 66),
    "counter-trophy": (607, 38, 631, 64),
    # Fortællerens højttaler: et malet mørkt ikon, ikke en SVG i en hvid pille.
    "icon-speaker": (1160, 128, 1192, 154),
}
# Under dette falder alfa til nul. Papirets egen kornstruktur ligger på ~28 i
# sum-afstand, så 34 lader kornet være og tager kun glyffen med.
FLOOR = 34
SPAN = 150


def cut(name: str, box: tuple[int, int, int, int], ref: np.ndarray) -> None:
    x0, y0, x1, y1 = box
    src = ref[y0:y1, x0:x1].astype(float)
    paper = np.median(src.reshape(-1, 3), axis=0)
    dist = np.abs(src - paper).sum(axis=2)

    keep = dist > FLOOR
    ys, xs = np.where(keep)
    if not len(ys):
        raise SystemExit(f"{name}: intet fundet — vinduet rammer forbi")
    # Beskær til glyffen selv, ellers bestemmer vinduets luft ikonets størrelse.
    src = src[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    dist = dist[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]

    alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
    rgba = np.dstack([src, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.webp", lossless=True, quality=100)
    print(f"{name}.webp {img.width}x{img.height} · papir {paper.astype(int)}")


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB"))
    for name, box in ICONS.items():
        cut(name, box, ref)


if __name__ == "__main__":
    main()
