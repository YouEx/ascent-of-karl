#!/usr/bin/env python3
"""Skærer gnist-ikonet ud af referencens "New finds"-knap.

Ikonet tegnes ikke som SVG. Martins stående ordre er at bruge billederne fra
skærmbilledet frem for at genskabe dem, og to gange i træk har en udskæring
ramt bedre end en tegning. Gnisten er 19x20 px, målt med et søjleløb gennem
knappen: mørke søjler ligger i x 1073-1091, og etiketten begynder først ved
1104.

Ikonet står på knappens eget pergament. Vi lægger det derfor ikke oven på med
multiply — det ville virke her, fordi gnisten er MØRK på lyst, men gain-vejen
fra build_mark.py er allerede målt og efterlader baggrunden præcis lig
destinationens token, mens det sorte forbliver sort. Vi genbruger den.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/ui/sparkle.webp"

BOX = (1071, 726, 1094, 749)   # gnisten med 2 px luft hele vejen rundt
DEST = (227, 206, 185)         # knappens målte fyld, midt mellem rille og top
SCALE = 3


def main() -> None:
    src = Image.open(REF).convert("RGB").crop(BOX)
    a = np.asarray(src).astype(np.float32)

    # Papirfarven aflæses i hjørnerne, hvor der ikke er blæk.
    corners = np.concatenate([a[:3, :3].reshape(-1, 3), a[:3, -3:].reshape(-1, 3),
                              a[-3:, :3].reshape(-1, 3), a[-3:, -3:].reshape(-1, 3)])
    paper = np.median(corners, 0)
    gain = np.array(DEST, dtype=np.float32) / np.maximum(paper, 1.0)
    out = np.clip(a * gain, 0, 255).astype(np.uint8)

    img = Image.fromarray(out).resize(
        ((BOX[2] - BOX[0]) * SCALE, (BOX[3] - BOX[1]) * SCALE), Image.LANCZOS
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, quality=95, method=6)
    print(f"gnist {img.width}x{img.height} · papir {paper.round(0)} · gain {gain.round(3)} · {OUT.name}")


if __name__ == "__main__":
    main()
