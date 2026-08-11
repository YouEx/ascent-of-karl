"""Skærer elementbrikkernes malerier ud af det ark, de blev malet på.

Brikkerne var emoji. Emoji er systemskrift: de skifter udseende med styresystem
og version, de har deres eget farvesprog, og de trækker skærmen væk fra det
malede register resten af spillet ligger i. Referencen viser malede genstande i
stil med en gammel naturhistorisk plancheside.

De 13 grundelementer er malet på ÉT ark frem for hver for sig. Lys, skala og
palet skal være ens på tværs af brikkerne; 13 selvstændige billeder ville
drive fra hinanden på alle tre, og forskellen ses tydeligst når brikkerne
ligger side om side i gitteret — hvilket er præcis dét, de gør.

Udskæringen bruger fremspring frem for sammenhængskomponenter: arket er et
gitter med luft imellem, og `scipy` findes ikke i dette miljø. En sum af
maskede pixels per række giver bånd med indhold; inde i hvert bånd giver
samme sum per søjle den enkelte genstand. Det er robust over for, at
generatorens gitter ikke er helt regelmæssigt.

Alfa regnes ud af afstanden til den flade baggrund og lægges tilbage som
u-præmultipliceret farve. Derfor overlever de bløde kanter og den svage
kontaktskygge, og brikken kan ligge på et hvilket som helst kort uden at
tegne en firkant. Genstande, der er lysere end baggrunden — vanddråben —
får med vilje lav alfa; det er sådan, vand skal se ud.

Rækkefølgen er læserækkefølge og skal matche ORDER herunder. Ændrer man
arket, skal ORDER følge med.

Beskæringen er tæt og bevarer formatet: genstanden fylder filen ud, og
CSS bokser den bagefter. Kvadratiske filer virker som den pæne løsning,
men de er forkerte her — en bred genstand centreret i et kvadrat efter sin
længste side taber højde, og stenen ville stå 40 px høj hvor referencens
står 62. Referencen skalerer hver genstand til at fylde en fælles kasse på
cirka 91x67, ikke til et fælles kvadrat.

Kør: python3 tools/art/build_elements.py [sti/til/ark.png]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHEET = ROOT / "docs/design/reference/elements-sheet.png"
OUT_DIR = ROOT / "src/assets/art/elements"

# Læserækkefølge på arket. Skal svare til id'erne i content/elements.json.
ORDER = [
    "sten", "pind", "graes", "vand",
    "ler", "baer", "larver", "dyr",
    "stamme", "nabo", "fugl", "korn",
    "okse",
]

TILE = 192           # længste side; ~2x den viste kasse på 91x67
PAD = 0.04           # luft omkring genstanden, som andel af dens længste side
MASK_THRESHOLD = 18  # afstand fra baggrund før en pixel tæller som indhold
ALPHA_FLOOR = 9      # under dette er pixlen baggrund og bliver helt gennemsigtig
ALPHA_FULL = 42      # afstand hvor alfa når 1,0
MIN_AREA = 400       # kasserer støvkorn og komprimeringsstøj


def _bands(profile: np.ndarray, gap: int) -> list[tuple[int, int]]:
    """Sammenhængende områder med indhold, adskilt af mindst `gap` tomme linjer."""
    on = profile > 0
    bands, start, run = [], None, 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i - run if run and bands and i - run <= bands[-1][1] + gap else i
            run = 0
        else:
            if start is not None:
                run += 1
                if run >= gap:
                    bands.append((start, i - run + 1))
                    start = None
    if start is not None:
        bands.append((start, len(on)))
    return [(a, b) for a, b in bands if b - a > 4]


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SHEET
    if not src.exists():
        raise SystemExit(f"mangler {src}\nSe scriptets docstring.")

    img = Image.open(src).convert("RGB")
    a = np.asarray(img).astype(np.float64)
    h, w, _ = a.shape

    # Baggrunden er flad. Medianen af en kantramme rammer den uden at blive
    # trukket af en genstand, der ligger tæt på kanten.
    border = np.concatenate([
        a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
        a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)

    dist = np.abs(a - bg).max(axis=2)
    mask = dist > MASK_THRESHOLD

    gap = max(8, h // 60)
    boxes: list[tuple[int, int, int, int]] = []
    for y0, y1 in _bands(mask[:, :].sum(axis=1), gap):
        strip = mask[y0:y1]
        for x0, x1 in _bands(strip.sum(axis=0), gap):
            sub = strip[:, x0:x1]
            if sub.sum() < MIN_AREA:
                continue
            ys = np.where(sub.any(axis=1))[0]
            boxes.append((x0, y0 + ys[0], x1, y0 + ys[-1] + 1))

    if len(boxes) != len(ORDER):
        raise SystemExit(
            f"fandt {len(boxes)} genstande, forventede {len(ORDER)}.\n"
            "Arket matcher ikke ORDER — ret ORDER eller arket, gæt ikke."
        )

    # Alfa ud af afstanden til baggrunden, farven u-præmultipliceret tilbage.
    # Gulvet er ikke pynt: uden det får den flade baggrund en lille positiv
    # alfa, og brikken tegner en svag varm firkant på alt lysere end arket.
    alpha = np.clip((dist - ALPHA_FLOOR) / (ALPHA_FULL - ALPHA_FLOOR), 0.0, 1.0)
    safe = np.maximum(alpha, 1e-6)[..., None]
    fg = np.clip((a - (1.0 - alpha)[..., None] * bg) / safe, 0, 255)
    rgba = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    full = Image.fromarray(rgba)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, (x0, y0, x1, y1) in zip(ORDER, boxes):
        bw, bh = x1 - x0, y1 - y0
        pad = int(round(max(bw, bh) * PAD))
        crop = full.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
        scale = TILE / max(crop.width, crop.height)
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.LANCZOS,
        )
        path = OUT_DIR / f"{name}.webp"
        crop.save(path, "WEBP", quality=82, method=6)
        print(f"  {path.name:14s} {bw}x{bh} → {crop.width}x{crop.height}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
