"""Skærer elementbrikkernes malerier ud af det ark, de blev malet på.

Brikkerne var emoji. Emoji er systemskrift: de skifter udseende med styresystem
og version, de har deres eget farvesprog, og de trækker skærmen væk fra det
malede register resten af spillet ligger i. Referencen viser malede genstande i
stil med en gammel naturhistorisk plancheside.

De 13 grundelementer er malet på ÉT ark frem for hver for sig. Lys, skala og
palet skal være ens på tværs af brikkerne; 13 selvstændige billeder ville
drive fra hinanden på alle tre, og forskellen ses tydeligst når brikkerne
ligger side om side i gitteret — hvilket er præcis dét, de gør.

Selve udskæringsmotoren (fremspringsdetektion, alfa-fra-baggrundsafstand,
beskæring med fast luft) er flyttet til `sheet_ingest.py`, så FREMTIDIGE
tematiske ark (TASK-038) kan genbruge nøjagtig samme aritmetik i stedet for
at få en ny, drivende metode. Denne fil er nu kun ARKETS EGNE konstanter —
hvilken fil, hvilken rækkefølge, hvilke tærskler — plus gemning. Se
`sheet_ingest.py`'s docstring for selve metoden.

`tools/art/tests/test_build_elements_regression.py` låser at denne omlægning
ikke ændrede en eneste byte af de 13 filer arket producerer.

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

from sheet_ingest import CutParams, DetectParams, cut_tiles

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

DETECT_PARAMS = DetectParams(mask_threshold=MASK_THRESHOLD, min_area=MIN_AREA)
CUT_PARAMS = CutParams(tile=TILE, pad=PAD, alpha_floor=ALPHA_FLOOR, alpha_full=ALPHA_FULL)


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SHEET
    if not src.exists():
        raise SystemExit(f"mangler {src}\nSe scriptets docstring.")

    tiles = cut_tiles(src, ORDER, DETECT_PARAMS, CUT_PARAMS)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, crop in tiles.items():
        path = OUT_DIR / f"{name}.webp"
        crop.save(path, "WEBP", quality=82, method=6)
        print(f"  {path.name:14s} → {crop.width}x{crop.height}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
