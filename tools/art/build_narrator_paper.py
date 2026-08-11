"""Skærer HELE fortællerens flade ud af referencen.

Samme måling som krøniken afgjorde: fortællerens struktur stod på 0,470,
og udsnittet viste hvorfor. Referencens boble er ikke en flad pergament-
firkant med tekst på. Den har:

  * en malet bueskytte i venstre kant (kolonne 10-50 har 24-42 mørke
    pixels pr. søjle, hvor kolonne 60-110 har 0-7),
  * små ornamenter omkring figuren,
  * et mørkere bånd langs venstre kant, og
  * en varm åring i hele fladen.

Vi havde ingen af delene. At tegne dem er en genskabelse; at skære dem ud
er en måling. Kun etiketten, brødteksten og højttalerikonet males væk med
Telea, som bærer den omkringliggende åring ind i hullet — en sløring ville
udslette præcis den fiber, øvelsen handler om.

Masken holdes til højre for x=105, så bueskytten aldrig kan rammes af
tærsklen: figurens pigment ligger i samme mørke bånd som skriften.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/narrator-paper.webp"

# Fortællerens rect i registry.json.
PANEL = (237, 105, 978, 145)
# Skriften ligger under 150 i gråtone; hulepigmentet i bueskytten ligger
# samme sted, så masken spærres til venstre for tekstsøjlen.
INK = 150
TEXT_X0 = 105
TEXT = (105, 52, 860, 84)
# Etiket og højttaler er målt direkte: de er for spinkle til en tærskel.
BOXES = [(110, 24, 152, 22), (924, 22, 32, 28)]


def main() -> None:
    px, py, pw, ph = PANEL
    src = np.asarray(Image.open(REF).convert("RGB"))[py : py + ph, px : px + pw].copy()

    gray = src.mean(axis=2)
    mask = np.zeros(gray.shape, np.uint8)
    tx, ty, tw, th = TEXT
    mask[ty : ty + th, tx : tx + tw] = (gray[ty : ty + th, tx : tx + tw] < INK).astype(
        np.uint8
    )
    for x, y, w, h in BOXES:
        mask[y : y + h, x : x + w] = 1
    mask[:, :TEXT_X0] = 0
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)

    bgr = cv2.cvtColor(src, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, mask, 6, cv2.INPAINT_TELEA)
    rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(OUT, "WEBP", quality=94, method=6)
    print(f"{OUT.name} {pw}x{ph} · maske {mask.mean() * 100:.1f} %")


if __name__ == "__main__":
    main()
