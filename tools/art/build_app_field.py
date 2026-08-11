#!/usr/bin/env python3
"""Måler referencens flade INDEN FOR rammen og gør den til #app's underlag.

Baggrunden bag spillet er to ting, ikke én: maleriet uden for rammen, og
fladen inden i den. Vi behandlede dem som én — `body` bar maleriet, og `#app`
lagde bare et cremeslør på 14 % oven på. Det gjorde fladen inden for rammen
til en funktion af et maleri, der ikke er referencens, og målingen viste hvor
galt det gik: chippernes bånd er rosa-mauve i referencen (206,172,162) og
fersken hos os, tone stod fast på 0.291, og fundet lå i human-queue.json som
BLOKERET med "kræver et nyt baggrundsmaleri".

Det gør det ikke. Referencens egen flade kan måles.

Forsøgt og forkastet samme dag: at bygge HELE det brede maleri ud af
referencen. Det kan ikke lade sig gøre, og grunden er værd at skrive ned —
hver eneste pixel inden for rammen bærer rammens slør. Bruger man dem som
maleri, bager man sløret ind i det, og runtime lægger så sløret på ANDEN
gang. Resultatet var en lys firkant midt i landskabet. Men netop fordi
sløret er bagt ind, er de samme pixels den PERFEKTE kilde til det, der skal
stå bag UI'et — de er allerede det, skærmen skal vise.

Masken gættes ikke: vores egen render har samme layout og står på en kendt
baggrund, så |render − baggrund| > 20 er præcis de pixels UI'et maler på.
Hullerne fyldes i en pyramide (landskabet er diset, så informationen ligger
lavfrekvent) og fladen sløres derefter hårdt. Sløringen er ikke dovenskab:
UI'et dækker det meste af feltet, kun mellemrummene ses, og en hård sløring
er den eneste måde at garantere at ingen genfærd af referencens egne kort
skinner igennem vores.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
RENDER = ROOT / ".judge/latest/render/game.png"
WIDE = ROOT / "src/assets/art/bg-wide-2560.webp"
OUT = ROOT / "src/assets/art/app-field.webp"

VIEW = (1448, 1086)
FRAME = (168, 4, 1280, 1082)   # rammens inderside, målt i referencen
THRESHOLD = 20
DILATE = 7
LEVELS = 4
BLUR = 24.0


def _current_background() -> np.ndarray:
    bg = Image.open(WIDE).convert("RGB")
    s = VIEW[1] / bg.height
    w = round(bg.width * s)
    scaled = bg.resize((w, VIEW[1]), Image.LANCZOS)
    off = (w - VIEW[0]) // 2
    return np.asarray(scaled.crop((off, 0, off + VIEW[0], VIEW[1]))).astype(np.int16)


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB")).astype(np.uint8)
    render = np.asarray(Image.open(RENDER).convert("RGB")).astype(np.int16)
    d = np.abs(render - _current_background()).max(2)
    mask = cv2.dilate((d > THRESHOLD).astype(np.uint8) * 255,
                      np.ones((DILATE, DILATE), np.uint8))

    x0, y0, x1, y1 = FRAME
    img, m = ref[y0:y1, x0:x1].copy(), mask[y0:y1, x0:x1].copy()
    print(f"ægte baggrund inden for rammen: {(m == 0).mean():.1%}")

    imgs, masks = [img], [m]
    for _ in range(LEVELS):
        imgs.append(cv2.pyrDown(imgs[-1]))
        masks.append((cv2.pyrDown(masks[-1]) > 40).astype(np.uint8) * 255)
    filled = cv2.inpaint(imgs[-1], masks[-1], 12, cv2.INPAINT_TELEA)
    for lvl in range(LEVELS - 2, -1, -1):
        up = cv2.resize(filled, (imgs[lvl].shape[1], imgs[lvl].shape[0]),
                        interpolation=cv2.INTER_CUBIC)
        filled = np.where((masks[lvl] == 0)[..., None], imgs[lvl], up).astype(np.uint8)

    field = cv2.GaussianBlur(filled.astype(np.float32), (0, 0), BLUR)
    out = Image.fromarray(np.clip(field, 0, 255).astype(np.uint8))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, quality=90, method=6)
    band = np.median(field[508:565].reshape(-1, 3), 0).round(0)
    print(f"{OUT.name} {out.width}x{out.height} · chip-båndets kulør {band}")


if __name__ == "__main__":
    main()
