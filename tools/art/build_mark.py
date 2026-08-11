#!/usr/bin/env python3
"""Bygger headerens mærke ud fra chip-figure.webp.

Problemet: chip-figure.webp er tegnet på sit eget pergament (#ceaf92), som er
mørkere end headerens flade (--titlebar #dfcdbf). Lagt direkte ind tegner den
et synligt rektangel.

To løsninger blev afvist ved måling:

  * mix-blend-mode: multiply — figuren er en LYS silhuet mod en mørk hule.
    Multiply kan aldrig gøre destinationen lysere, så kroppen forsvandt.
  * alfa via flood fill fra kanten — tegningens klipper glider blødt ud i
    papiret, så en tolerance stor nok til at fjerne baggrunden åd også klippen.

Det der virker: en multiplikativ gain der flytter papiret til præcis
--titlebar og lader sort blive sort. Baggrunden matcher så headeren nøjagtigt
og rektanglet forsvinder, mens stregerne beholder deres vægt. Kun de allerlyseste
pixels i figurens krop klipper, og de er nær-hvide i referencen alligevel.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src/assets/art/chip-figure.webp"
DST = ROOT / "src/assets/art/mark-figure.webp"

# Målt på headerens flade i referencen (docs/design/reference/target-2026-08-11.webp).
TITLEBAR = np.array([0xDF, 0xCD, 0xBF], dtype=np.float32)


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32)

    # Papirfarven aflæses i de fire hjørner, hvor der aldrig er tegning.
    corners = np.concatenate(
        [
            a[:6, :6].reshape(-1, 3),
            a[:6, -6:].reshape(-1, 3),
            a[-6:, :6].reshape(-1, 3),
            a[-6:, -6:].reshape(-1, 3),
        ]
    )
    paper = np.median(corners, axis=0)
    gain = TITLEBAR / paper

    out = np.clip(a * gain, 0, 255).astype(np.uint8)
    Image.fromarray(out).save(DST, quality=92, method=6)
    print(f"papir {paper.round(1)} -> {TITLEBAR} · gain {gain.round(3)} · {DST.name}")


if __name__ == "__main__":
    main()
