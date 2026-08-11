#!/usr/bin/env python3
"""Skærer headerens mærke ud af referencen i stedet for at farvekorrigere det.

Første forsøg tog chip-figure.webp og gangede den med en gain, der flyttede
tegningens eget papir (#ceaf92) hen på headerens flade. Det virkede kun så
længe flade og gain var samme tal. De er de ikke: mærket tegner stadig et
synligt LYST rektangel på baren, fordi hjørnerne, gain'en aflæses i, er
mørkere end tegningens gennemsnitlige papir, så hele billedet blev løftet for
højt. Man kan ikke ramme en flade præcist med en gain aflæst i fire hjørner.

Referencen har den samme tegning stående på præcis den flade, den skal stå på.
Så skær den ud derfra og lav alfa af afstanden til papiret — så er der ingen
flade at ramme, og rektanglet kan ikke opstå. Samme metode som ikonerne,
gnisten og kombinér-tavlen.

Referencens mærke måler 73x61 og fylder baren fra 17 til 77. Vores stod
64x72 — smallere, højere og 48 px for langt til højre.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
DST = ROOT / "src/assets/art/mark-figure.webp"

# Vinduet har luft hele vejen rundt, så bboxen findes af tærsklen.
WINDOW = (183, 11, 267, 83)
# Tom bar at aflæse papirfarven i. Baren har en lodret skygge i toppen, så
# papiret SKAL aflæses række for række — en median over hele vinduet gør
# toppens skygge til "tegning", og bboxen bliver hele vinduet.
CLEAN = (700, 780)
FLOOR = 30
SPAN = 150
# Alfa må sætte ind allerede ved 30, ellers hakker klippernes bløde udtoning.
# Men beskæringen må IKKE bruge samme tal: papirets korn ligger lige over 30,
# så bboxen ville blive hele vinduet. Den skæres ved 70 og får 3 px luft med.
CROP_FLOOR = 70
CROP_PAD = 3


def main() -> None:
    x0, y0, x1, y1 = WINDOW
    ref = np.asarray(Image.open(REF).convert("RGB")).astype(float)
    src = ref[y0:y1, x0:x1]
    paper = np.median(ref[y0:y1, CLEAN[0] : CLEAN[1]], axis=1)[:, None, :]
    dist = np.abs(src - paper).sum(axis=2)

    ys, xs = np.where(dist > CROP_FLOOR)
    a, b = max(ys.min() - CROP_PAD, 0), min(ys.max() + 1 + CROP_PAD, src.shape[0])
    c, d = max(xs.min() - CROP_PAD, 0), min(xs.max() + 1 + CROP_PAD, src.shape[1])
    print(f"i referencen: x {x0 + c}..{x0 + d - 1} · y {y0 + a}..{y0 + b - 1}")
    src, dist = src[a:b, c:d], dist[a:b, c:d]

    alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
    rgba = np.dstack([src, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba)
    img.save(DST, lossless=True, quality=100)
    print(f"{DST.name} {img.width}x{img.height}")


if __name__ == "__main__":
    main()
