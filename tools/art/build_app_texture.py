#!/usr/bin/env python3
"""Bygger den grove penselstruktur, der skal ligge oven på #app's flade.

Målingen der udløste den: referencens griddet-mellemrum har 16,79 i
gradientenergi mod vores 8,34, og i chip-regionens tomme højreside lander
vores flade vask på grå 180 — tre enheder under dommerens blækgrænse
(papir85 − 28 = 183), så HELE baggrunden tælles som blæk. Referencens malede
skyer ligger på begge sider af grænsen, så kun ~40 % gør. Det er ikke en
farvefejl; farven er rigtig inden for ΔE 1. Det er en teksturfejl.

Filmkorn kan ikke løse den. `--grain` er fin støj i pixelskala, og målingen
gav grid +0,041 i struktur men chips −0,05, fordi ukorreleret finstøj oven på
en flade, hvor referencen har grov struktur, sænker SSIM på gradientkortet.
Skalaen skal passe, ikke bare energien.

Forsøgt og forkastet først: at bevare referencens egen tekstur i
app-field.webp ved kun at sløre dér, hvor masken sagde UI. Den vej er lukket,
og grunden er værd at skrive ned — masken bygges af |render − baggrund|, og
efter at #app selv fik app-field som underlag, adskiller HELE #app sig fra
det brede maleri. Masken er derfor total, 0,2 % af fladen overlevede, og
metoden måler nu sig selv.

Kilden her er vores eget brede maleri i stedet. Det er malet af samme hånd i
samme stil som referencen, det bærer ingen UI overhovedet, så der findes
ingen genfærd at lække, og dets penselstruktur ligger i den grove skala, vi
mangler. Vi tager kun højpasresten — al kulør og lys smides væk — og lægger
den i en gråtoneflade centreret om 128, så `overlay` i CSS'en hverken
mørkner eller lysner fladen, men kun lægger struktur i den.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src/assets/art/bg-wide-2560.webp"
OUT = ROOT / "src/assets/art/app-texture.webp"

# Skalaen er målt, ikke valgt: referencens overskydende gradientenergi ligger
# mellem sigma 3 og sigma 20. Under 3 er det filmkorn, som vi allerede har
# forsøgt, og over 20 er det landskabets egne former, som ville lyse igennem
# som genfærd af bakker.
LOW = 3.0
HIGH = 20.0
# Forstærkningen er sat, så restens standardafvigelse rammer referencens
# målte overskud. Den skrues i CSS'ens opacitet, ikke her.
GAIN = 3.0


def main() -> None:
    img = np.asarray(Image.open(SRC).convert("L")).astype(np.float32)
    band = cv2.GaussianBlur(img, (0, 0), LOW) - cv2.GaussianBlur(img, (0, 0), HIGH)
    print(f"kilde {img.shape[1]}x{img.shape[0]} · båndets std {band.std():.2f}")

    tex = np.clip(128.0 + band * GAIN, 0, 255).astype(np.uint8)
    out = Image.fromarray(tex)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, quality=88, method=6)
    print(f"{OUT.name} {out.width}x{out.height} · std {tex.std():.1f} "
          f"· middel {tex.mean():.1f} (skal ligge på 128)")


if __name__ == "__main__":
    main()
