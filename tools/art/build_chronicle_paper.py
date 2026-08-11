"""Skærer krønikens hele pergamentflade ud af referencen.

Målingen der afgjorde det: referencens panel har 87-97 mørke pixels i HVER
række under hårstregen, hvor vores har 3. Der står ingen tegning dernede. Det
er papiret selv — en grov, marmoreret åring og en gradient der bliver varmere
mod nederste højre hjørne. Panelets blækdækning er 17,1 % mod vores 9,4 %, og
forskellen er stort set udelukkende fiber.

Man kan ikke ramme det med en token. Så fladen skæres ud som ét billede:
referencens panel med KUN skriften og de tre malede ikoner malet væk. Alt
andet — åringen, gradienten, hulemaleriet i højre tredjedel og hårstregen
over tidslinjen — er en del af fladen og følger med.

Masken kan ikke laves som app-fladens (render minus baggrund), for der findes
ingen ren udgave af panelet at trække fra. Men skriften er langt mørkere end
både papir og pigment: teksten ligger på 50-90, hulemaleriet på 180-200. En
tærskel ved 150 rammer derfor skriften og lader tegningen stå. Aktplaketten
og de to malede ikoner er farvede og fanges ikke af tærsklen — de er angivet
som målte kasser.

cv2.inpaint frem for pyramide-udfyldning: masken er tynde glyffer, og Telea
fører den omgivende ÅRING ind i hullet i stedet for at glatte det ud. En
sløring ville fjerne præcis det, hele øvelsen handler om.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
DST = ROOT / "src/assets/art/chronicle-paper.webp"

# Krønikens rect i docs/design/reference/registry.json.
PANEL = (237, 268, 978, 226)
# Under dette er en pixel skrift, ikke pigment. Målt: tekst 50-90,
# hulemaleri 180-200, papir 205-235.
INK = 150
# Kasser i panelets egne koordinater: den malede bog og uret.
BOXES = [(18, 60, 106, 84), (18, 176, 40, 44)]
# Aktplaketten kan ikke inpaintes: den ligger i panelets afrundede hjørne, så
# Telea har app-fladen UDEN for panelet som nærmeste nabo og trækker den lyse
# flade ind — hjørnet blev et hvidt udbrændt felt. I stedet indsættes rent
# papir hentet vandret og gradient-korrigeret, før masken laves.
BADGE = (6, 6, 232, 50)


def main() -> None:
    px, py, pw, ph = PANEL
    src = np.asarray(Image.open(REF).convert("RGB"))[py : py + ph, px : px + pw]
    bgr = cv2.cvtColor(src, cv2.COLOR_RGB2BGR)

    mask = (src.mean(axis=2) < INK).astype(np.uint8)
    for x, y, w, h in BOXES:
        mask[y : y + h, x : x + w] = 1
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)

    out = cv2.inpaint(bgr, mask, 6, cv2.INPAINT_TELEA)
    img = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
    img.save(DST, quality=94, method=6)
    print(f"{DST.name} {img.width}x{img.height} · maske {mask.mean() * 100:.1f} %")


if __name__ == "__main__":
    main()
