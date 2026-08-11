#!/usr/bin/env python3
"""Skærer kombinér-tavlen ud af referencen selv.

Knappen er spillets primære handling og målte 0.191 på structure — det
laveste tal på hele skærmen. Et opslag side om side forklarer hvorfor: vores
tavle havde næsten skarpe hjørner, ingen inderramme og et stort massivt
bjerg, mens referencens har 22 px runde hjørner, en udskåret inderramme 11 px
inde og TYNDE indgraverede ornamenter. Formen var forkert, ikke farven.

Tidligere blev tavlen malet af en generator og bagefter rettet til med
tonestræk og kulørgain (se git-historikken). Den vej er opgivet: referencens
egen tavle er 162x112 px ren, skarp og korrekt, og Martins stående ordre er
at bruge billederne fra skærmbilledet frem for at genskabe dem.

Teksten males IKKE med. Den bliver liggende som rigtig tekst i DOM'en, så
den kan markeres, oplæses og oversættes; et billede med "Combine" brændt ind
ville koste alt det for ingenting. Referencens tavle HAR ordet hugget ind, så
det males væk med cv2.inpaint.

Masken til inpainting kan ikke bare være "lyse pixels": glyfferne har både
hvid fyld og mørk kontur, og begge skal væk. Den findes derfor som pixels der
afviger fra stenens egen median inden for tekstens bånd — og båndet holdes
inden for x 18-82 %, så inderrammens lodrette linjer ikke ryger med.

Alfa er en rund firkant med målt radius, ikke en afstandsnøgle til
baggrunden. Tavlens nederste kant HAR en malet slagskygge der glider blødt
ud i papiret; en afstandsnøgle ville enten tage skyggen med som halvgennem-
sigtig snavs eller æde kanten.

Tavlen sidder IKKE midt i knappens kasse. Målt ligger den på (1057,573) i et
162x112 felt, mens knappen står på (1058,578) og er 157x109 — altså 1 px til
venstre og 5 px over kassen, og den slutter 2 px før kassens bund. De sidste
to rækker er referencens slagskygge. Vi indsætter derfor tavlen med sit MÅLTE
forskud i stedet for at strække den til at passe: dommeren sammenligner
netop det udsnit af skærmen, så et forskud er en fejl på hver eneste pixel.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "docs/design/reference/target-2026-08-11.webp"
OUT = ROOT / "src/assets/art/ui/combine-slab.webp"

# Tavlens kant i referencen, målt med tværsnit ved y=632 og x=1138.
SLAB = (1057, 573, 1219, 685)
OFFSET = (-1, -5)    # tavlens hjørne set fra knappens kasse (1058, 578)
SHADOW = 6           # rækker under tavlen der bærer den malede slagskygge
RADIUS = 22          # målt på hjørnebuen
# Ingen opskalering. Tavlen gemmes i knappens egen størrelse, fordi
# materiality måler højpasenergi: 162x112 -> 314x218 -> browserens 157x109 er
# to interpolationer i træk, og hver af dem sløver kornet. Målt tabte 2x-vejen
# 10 % af referencens energi (17.8 mod 19.8). Ét enkelt let nedskaleringstrin
# bevarer stenens korn.
SCALE = 1
BUTTON = (157, 109)
TEXT_BAND = (0.40, 0.72)   # tekstens lodrette udstrækning i tavlen
TEXT_SIDES = (0.18, 0.82)  # holder inderrammens lodrette linjer uden for masken


def main() -> None:
    x0s, y0s, x1s, y1s = SLAB
    src = Image.open(REF).convert("RGB").crop((x0s, y0s, x1s, y1s + SHADOW))
    sw, sh = src.size
    w, h = BUTTON
    a = np.asarray(src).astype(np.uint8)

    y0, y1 = int(sh * TEXT_BAND[0]), int(sh * TEXT_BAND[1])
    x0, x1 = int(sw * TEXT_SIDES[0]), int(sw * TEXT_SIDES[1])
    band = a[y0:y1, x0:x1]
    lum = band.astype(np.float32).mean(2)
    mask = np.zeros((sh, sw), dtype=np.uint8)
    mask[y0:y1, x0:x1] = (np.abs(lum - np.median(lum)) > 45).astype(np.uint8) * 255
    k = max(3, 4 * SCALE)
    mask = cv2.dilate(mask, np.ones((k, k), np.uint8), iterations=1)
    rgb = cv2.inpaint(a, mask, k, cv2.INPAINT_TELEA)

    body = y1s - y0s
    alpha = Image.new("L", (sw, sh), 0)
    d = ImageDraw.Draw(alpha)
    # Skyggen tegnes FØRST. ImageDraw skriver oven i, den blander ikke, så en
    # ellipse med fill=150 tegnet efter kroppen ville sætte tavlens egen bund
    # ned til 150 og gøre stenen halvgennemsigtig — målt som en bleg klat i
    # nederste venstre hjørne. Krop ovenpå skygge er den rigtige rækkefølge.
    d.ellipse([10, body - RADIUS, sw - 11, body + SHADOW - 1], fill=120)
    d.rounded_rectangle([0, 0, sw - 1, body - 1], radius=RADIUS, fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer = Image.fromarray(rgb).convert("RGBA")
    layer.putalpha(alpha)
    out.paste(layer, OFFSET, layer)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, quality=95, method=6)
    print(f"tavle {sw}x{sh} i {w}x{h} @ {OFFSET} · maske {int(mask.sum() / 255)} px · {OUT.name}")


if __name__ == "__main__":
    main()
