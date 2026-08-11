"""Skærer problemknappernes ikoner ud af referencen.

chips stod på 0,833 med struktur 0,559. Udsnittet ved 2x viste hvorfor:
vores tre ikoner er emoji tegnet af systemskrifttypen — blege, flade og i
ét tilfælde direkte forkerte (vi viste en kølle, referencen viser en mave).
Referencens er malede, med skygge og volumen.

Baggrunden er forskellig for hver knap (kulde er blågrå, værktøj cremet,
sult lyserød), så papirfarven tages per vindue, ikke én gang for alle.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/problems"

# Vinduer med luft; bboxen findes af tærsklen. Nøglen er problemets id i
# content/acts/act-1.json, så glyphen kan slås op direkte.
CUTS = {
    "kulde": (251, 520, 285, 551),
    "vaerktoej": (439, 520, 473, 551),
    "sult": (595, 520, 629, 551),
}
FLOOR = 30
CROP_FLOOR = 60
SPAN = 120
SCALE = 3


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB"))
    OUT.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, list[int]] = {}
    for name, (x0, y0, x1, y1) in CUTS.items():
        src = ref[y0:y1, x0:x1].astype(float)
        paper = np.median(src.reshape(-1, 3), axis=0)
        dist = np.abs(src - paper).sum(axis=2)

        ys, xs = np.where(dist > CROP_FLOOR)
        if not len(ys):
            raise SystemExit(f"{name}: intet fundet — vinduet rammer forbi")
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        src, dist = src[sl], dist[sl]

        alpha = np.clip((dist - FLOOR) / SPAN, 0, 1)
        img = Image.fromarray(np.dstack([src, alpha * 255]).astype(np.uint8))
        img = img.resize((img.width * SCALE, img.height * SCALE), Image.LANCZOS)
        img.save(OUT / f"{name}.webp", lossless=True, quality=100)
        # Referencens egen størrelse, ikke filens. De tre ikoner er IKKE lige
        # store i referencen, og en fælles højde i CSS ville presse dem til
        # samme mål. Derfor skrives målene ud og sættes som width/height.
        sizes[name] = [img.width // SCALE, img.height // SCALE]
        print(f"{name}.webp {img.width}x{img.height} · papir {paper.astype(int)}")

    (OUT / "sizes.json").write_text(
        json.dumps(sizes, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"sizes.json {sizes}")


if __name__ == "__main__":
    main()
