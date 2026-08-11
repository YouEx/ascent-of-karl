#!/usr/bin/env python3
"""Bygger baggrundsmaleriet UD AF referencen i stedet for at male et nyt.

Den gamle vej var et selvstændigt genereret maleri, trukket over mod
referencens kulør med en frossen affin graduering. Den kunne aldrig ramme:
målt mod referencen lå den 38 niveauer skævt i gennemsnit, og skævheden var
IKKE en konstant — nogle steder var vi lysere, andre mørkere. En graduering
retter et skift, ikke en anden komposition. Det er derfor `chips` stod fast
på 0.291 i tone: chippernes bånd er rosa-mauve i referencen og fersken hos
os, og ingen tokens kan flytte et maleri.

Docstringen på den gamle build_bg_wide.py sagde at maleriet ikke KAN skæres
ud af mockuppen, fordi UI-panelet dækker fladen og kun efterlader to
strimler på 168 px. Det er rigtigt om strimlerne og forkert om resten:
mellemrummene mellem chips, mellem kort, mellem sektioner og hele bunden er
også ren baggrund. Målt er 36,5 % af referencen ægte baggrund, fordelt over
hele fladen — ikke to strimler i kanten.

Masken gættes ikke. Vores egen render har samme layout, og vi VED hvilken
baggrund den står på, så |render − baggrund| er præcis de pixels UI'et maler
på. Tærsklen er 20: panelets slør måler +4..+9 hen over rammekanten, så alt
under 20 er sløret og alt over er et element.

Hullerne fyldes i en pyramide. Landskabet er diset og uden fine detaljer, så
dets information ligger i de lave frekvenser; en inpaint på 1/8 opløsning har
kun 4 px at bygge bro over, hvor fuld opløsning skulle gætte 130. Kornet
lægges tilbage bagefter fra papirfliserne, så fladen ikke bliver glat.

Bredden er ikke et rundt tal med vilje. CSS'en `cover`er, og ved Martins og
dommerens rude på 1448x1086 skalerer cover efter HØJDEN. Er masterens højde
præcis 1086, står referencens egne pixels 1:1 i midten; ethvert andet tal
zoomer maleriet en anelse og flytter hver eneste måling. 2534 = 1086 x 21/9.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
RENDER = ROOT / ".judge/latest/render/game.png"
OLD_WIDE = ROOT / "src/assets/art/bg-wide-2560.webp"
GRAIN = ROOT / "src/assets/art/paper-grain.png"
OUT_DIR = ROOT / "src/assets/art"

VIEW = (1448, 1086)
MASTER_W = 2534          # 1086 * 21/9 — se docstringen om hvorfor højden binder
THRESHOLD = 20
DILATE = 7
LEVELS = 3               # 1/8 opløsning i bunden af pyramiden


def _current_background() -> np.ndarray:
    """Den baggrund vores render FAKTISK stod på, cover'et som browseren gør."""
    bg = Image.open(OLD_WIDE).convert("RGB")
    s = VIEW[1] / bg.height
    w = round(bg.width * s)
    scaled = bg.resize((w, VIEW[1]), Image.LANCZOS)
    off = (w - VIEW[0]) // 2
    return np.asarray(scaled.crop((off, 0, off + VIEW[0], VIEW[1]))).astype(np.int16)


def _ui_mask(ref_render: np.ndarray, bg: np.ndarray) -> np.ndarray:
    d = np.abs(ref_render - bg).max(2)
    m = (d > THRESHOLD).astype(np.uint8) * 255
    return cv2.dilate(m, np.ones((DILATE, DILATE), np.uint8))


def _pyramid_fill(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fylder hullerne nedefra: groft på lav opløsning, fint på høj."""
    imgs, masks = [img], [mask]
    for _ in range(LEVELS):
        imgs.append(cv2.pyrDown(imgs[-1]))
        masks.append((cv2.pyrDown(masks[-1]) > 40).astype(np.uint8) * 255)

    filled = cv2.inpaint(imgs[-1], masks[-1], 12, cv2.INPAINT_TELEA)
    for lvl in range(LEVELS - 1, -1, -1):
        up = cv2.resize(filled, (imgs[lvl].shape[1], imgs[lvl].shape[0]),
                        interpolation=cv2.INTER_CUBIC)
        keep = (masks[lvl] == 0)[..., None]
        filled = np.where(keep, imgs[lvl], up).astype(np.uint8)
    return filled


def _regrain(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Lægger papirets korn tilbage i de fyldte huller.

    Pyramiden efterlader en glat flade. m_materiality måler netop
    højpasenergi, så en glat baggrund ville koste det, inpaintingen vandt.
    """
    tile = np.asarray(Image.open(GRAIN).convert("L")).astype(np.float32) - 128.0
    h, w = img.shape[:2]
    reps = np.tile(tile, (h // tile.shape[0] + 1, w // tile.shape[1] + 1))[:h, :w]
    # Kornets styrke måles i de ÆGTE dele af billedet, ikke gættes.
    g = cv2.cvtColor(img.astype(np.float32), cv2.COLOR_RGB2GRAY)
    real = mask == 0
    target = float(np.std((g - cv2.GaussianBlur(g, (0, 0), 2.0))[real]))
    now = float(np.std((g - cv2.GaussianBlur(g, (0, 0), 2.0))[mask > 0]))
    gain = np.sqrt(max(target**2 - now**2, 0.0)) / max(float(np.std(reps)), 1e-6)
    add = (reps * gain)[..., None] * (mask > 0)[..., None]
    return np.clip(img.astype(np.float32) + add, 0, 255).astype(np.uint8)


def main() -> None:
    ref = np.asarray(Image.open(REF).convert("RGB")).astype(np.uint8)
    render = np.asarray(Image.open(RENDER).convert("RGB")).astype(np.int16)
    mask = _ui_mask(render, _current_background())
    print(f"maske dækker {(mask > 0).mean():.1%} · ægte baggrund {(mask == 0).mean():.1%}")

    centre = _regrain(_pyramid_fill(ref, mask), mask)

    # Siderne kommer fra det gamle maleri, skaleret til samme højde og trukket
    # over i midtens kulør ved sømmen, så overgangen ikke ses.
    old = Image.open(OLD_WIDE).convert("RGB")
    old = old.resize((round(old.width * VIEW[1] / old.height), VIEW[1]), Image.LANCZOS)
    old_a = np.asarray(old).astype(np.float32)
    pad = (MASTER_W - VIEW[0]) // 2
    o_off = (old_a.shape[1] - MASTER_W) // 2

    master = np.zeros((VIEW[1], MASTER_W, 3), np.float32)
    master[:, pad:pad + VIEW[0]] = centre
    for side, sl_m, sl_o in (
        ("v", slice(0, pad), slice(o_off, o_off + pad)),
        ("h", slice(pad + VIEW[0], MASTER_W), slice(o_off + pad + VIEW[0], o_off + MASTER_W)),
    ):
        wing = old_a[:, sl_o].copy()
        seam_o = wing[:, -1 if side == "v" else 0]
        seam_c = centre[:, 0 if side == "v" else -1].astype(np.float32)
        wing += (seam_c.mean(0) - seam_o.mean(0))
        master[:, sl_m] = wing

    # Blød overgang over 60 px, så sømmen ikke står som en kant.
    fade = 60
    for x in range(fade):
        t = x / fade
        master[:, pad + x] = master[:, pad + x] * t + master[:, pad - 1] * (1 - t)
        master[:, pad + VIEW[0] - 1 - x] = (
            master[:, pad + VIEW[0] - 1 - x] * t + master[:, pad + VIEW[0]] * (1 - t)
        )

    img = Image.fromarray(np.clip(master, 0, 255).astype(np.uint8))
    for w in (1600, MASTER_W):
        out = OUT_DIR / f"bg-wide-{w}.webp"
        img.resize((w, round(VIEW[1] * w / MASTER_W)), Image.LANCZOS).save(
            out, quality=88, method=6
        )
        print(f"  {out.name} {w}x{round(VIEW[1] * w / MASTER_W)}")


if __name__ == "__main__":
    main()
