#!/usr/bin/env python3
"""Bygger pergamentarket til titelskærmen ud af mockuppen.

Ornamenterne — solen, danserne, hjorten, hesten, hændene, poten — er malede
mærker, der ligger nede i papiret. Fire forsøg på at trække dem ud enkeltvis
med alfa slog fejl på samme klippe: pergamentet er kraftigt krakeleret, og
sprækkerne er lige så mørke og lige så tynde som de svageste strøg. Hverken
niveauer, en støjbund målt på kantrammen, en division af papiret eller en
sammenhængsmaske kunne skille de to ad uden enten at tage papiret med som en
firkantet plade eller at flå mærket i stykker.

Arket løser problemet ved ikke at stille spørgsmålet. Ornamenterne bliver
liggende præcis dér, hvor de blev malet, på deres eget papir. Kun tekst og
knapper viskes væk, og hullerne fyldes med pergament, der er regnet ud af
arkets eget lys og eget korn — så sømmene forsvinder af sig selv.

Arket er et revet stykke papir, der ligger over dalen, ikke et rektangel:
ornamenterne i venstre side sidder helt ude ved den flossede kant. Derfor
kommer det ud med ægte alfa, så kanten kan ligge oven på baggrunden.

Tre trin:
  * Silhuetten findes på lysstyrke. Papiret er markant lysere end dalen, og
    grænsen er skarp. Huller lukkes bagefter, så overskriftens mørke bogstaver
    ikke stanser sig selv ud af arket.
  * Belysningen — papirets store lys/skygge-forløb — estimeres med normaliseret
    foldning over de pixels, der FAKTISK er blankt papir. En almindelig sløring
    ville trække dalen og bogstaverne med ind og efterlade spøgelser.
  * Kornet tages som højpasfilter af en ren papirlap og lægges oven på. Det er
    samme krakelering som resten af arket, så lappen kan ikke ses.

Kør fra projektroden:  python3 tools/art/build_parchment.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/design/reference/title-2026-08-11.webp"
OUT_DIR = ROOT / "public/art"

# Mockuppens venstre halvdel. Til højre for dette begynder maleriet.
COLUMN = 700

# Alt, der skal væk, i mockuppens koordinater.
#
# Kasserne overlapper hinanden med vilje — også på tværs, ikke kun lodret.
# Første udgave lod dem støde op til hinanden, og fordi lapperne har blød
# kant, blev sømmen mellem to kasser for svag til at dække: toppen af "Karl"
# og overkanten af båndet stod tilbage som stiplede streger, og i sømmen ved
# x=490 blev venstrekanten af hvert bogstav i "Ascent" stående.
#
# De er til gengæld skåret uden om ornamenterne. Overskriften er derfor delt i
# tre om hesten ved (507,153)-(543,173). Til højre er der kun få pixels at
# give af: "Ascent" slutter ved x=632, hånden begynder ved x=637, og poten
# ligger under den fra x=600. Derfor rykker højrekanten ind fra 634 til 596,
# når kasserne passerer y=300.
ERASE = [
    (196, 100, 506, 462),   # overskriften, venstre for hesten
    (178, 246, 300, 300),   # foden af "A", der stikker ud til venstre
    (474, 100, 634, 136),   # over hesten
    (474, 190, 634, 215),   # under hesten, forbi hånden
    (474, 215, 690, 300),   # under hånden, hvor der er fri bane til kanten
    (474, 300, 596, 462),   # ned forbi poten
    (120, 430, 682, 542),   # bånd med undertitel
    (168, 522, 642, 628),   # to linjer brødtekst
    (280, 592, 472, 650),   # ornamentskillelinje
    (120, 630, 682, 758),   # Begin- og Fates-knapper
    (164, 746, 642, 820),   # hjælpelinje
    (72, 636, 470, 802),    # forgrundsklippen, der skærer ind i arket
    (76, 800, 682, 985),    # tipkort med ildflise
]

# Rent pergament at tage kornet fra. Lappen SKAL være bar krakelering: en
# første lap tog enden af båndet med, og dets snorekant blev derefter gentaget
# ud over hele arket som en stribe af små streger.
TEXTURE_PATCH = (152, 302, 220, 370)

# Papiret er markant lysere end dalen bagved. 150 rammer den flossede kant uden
# at æde de malede mærker, der ligger ude i den.
SHEET_LEVEL = 150

# Alt over arkets overkant: himlen er lys nok til at slippe gennem tærsklen,
# og velkomstchippen svæver derude for sig selv.
CUT = (0, 0, COLUMN, 100)

# Forgrundsklippen bider et hjørne ud af arket. Papiret ligger bagved, så
# silhuetten fyldes ud igen, før klippen males over med pergament. Feltet må
# ikke nå længere til venstre end arkets egen kant: gør det det, springer
# kanten udad netop dér, hvor silhuetten føres lige ned.
PATCH_BACK = (110, 636, 470, 800)

# Under dette punkt dækker tipkortet arkets egen underkant, så den kan ikke
# aflæses. Silhuetten føres lige ned i stedet — panelet løber alligevel ud
# under skærmkanten, og den flossede venstrekant fortsætter uændret.
EXTEND_FROM = 800

# Hvor langt inde i feltet indfarvningen når fuld styrke. Teksten skal ligge
# mindst så langt inde i sin kasse, ellers står en kant af den tilbage.
EDGE_SOFTNESS = 12.0

WIDTHS = (692, 520, 360)


def gaussian(a: np.ndarray, sigma: float) -> np.ndarray:
    """Sløring på flydende tal, så vægtene i den normaliserede foldning holder."""
    return ndimage.gaussian_filter(a, sigma=sigma, mode="nearest")


def sheet_mask(lum: np.ndarray) -> np.ndarray:
    """Arkets silhuet, med bogstavhuller lukket og småpletter i dalen fjernet."""
    raw = gaussian(lum, 6.0) > SHEET_LEVEL
    raw = ndimage.binary_fill_holes(raw)
    raw = ndimage.binary_closing(raw, np.ones((9, 9)))
    labels, n = ndimage.label(raw)
    if n > 1:
        sizes = ndimage.sum(raw, labels, range(1, n + 1))
        raw = labels == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_fill_holes(raw)


def synth_grain(sample: np.ndarray, shape: tuple[int, int], rng) -> np.ndarray:
    """Fremstiller papirkorn, der aldrig gentager sig.

    Første forsøg gentog en ren papirlap spejlvendt. Spejlingen gjorde hver
    tilfældig krakelering symmetrisk, og de symmetriske figurer stod side om
    side som tapetmønster hen over hele arket.

    Kornet bygges derfor af støj i flere skalaer i stedet, skruet til samme
    styrke og samme farvefordeling som papirets eget korn. Det er ikke den
    samme krakelering — men de store, karakteristiske revner ligger i de
    urørte kanter, og lappernes opgave er kun at undgå, at de udfyldte felter
    står som blank plastik ved siden af papir.
    """
    h, w = shape
    field = np.zeros((h, w))
    for sigma in (1.0, 2.0, 4.0, 8.0, 16.0, 32.0):
        field += gaussian(rng.standard_normal((h, w)), sigma) * sigma
    field /= max(field.std(), 1e-6)
    # Lidt kraftigere end papirets målte spredning: den ægte krakelering er
    # skarpe streger, den syntetiske støj er blød, og uden et løft ser de
    # udfyldte felter glattere ud end kanterne omkring dem.
    return np.dstack([field * sample[..., c].std() * 1.25 for c in range(3)])


def blend_weight(erased: np.ndarray) -> np.ndarray:
    """Indfarvningens vægt: fuld inde i feltet, aftagende ud mod dets kant.

    Kasserne blev først blødgjort hver for sig. Det gav to fejl på én gang:
    lod man kanten være smal, stod hver enkelt kasse som en synlig firkant,
    fordi den beregnede belysning ikke rammer papiret præcist; gjorde man den
    bred, blev sømmen mellem to nabokasser for svag til at dække teksten.

    Kasserne lægges derfor sammen til ét felt først, og blødheden regnes af
    afstanden ind i det felt. Så findes der ingen indvendige sømme, og fordi
    vægten er nul PÅ kanten og aldrig uden for den, kan indfarvningen ikke
    smitte af på et ornament, der ligger tæt udenfor.
    """
    inside = ndimage.distance_transform_edt(erased)
    return np.clip(inside / EDGE_SOFTNESS, 0, 1)[..., None]


def main() -> None:
    full = Image.open(SOURCE).convert("RGB")
    src = np.asarray(full).astype(np.float64)[:, :COLUMN]
    lum = src @ np.array([0.2126, 0.7152, 0.0722])

    sheet = sheet_mask(lum)
    sheet[CUT[1]:CUT[3], CUT[0]:CUT[2]] = False
    sheet[PATCH_BACK[1]:PATCH_BACK[3], PATCH_BACK[0]:PATCH_BACK[2]] = True
    sheet[EXTEND_FROM:] = sheet[EXTEND_FROM]

    # Blankt papir: inde i arket, men uden for alt det, der skal væk.
    paper = sheet.copy()
    for x0, y0, x1, y1 in ERASE:
        paper[y0:y1, x0:x1] = False

    # Belysningen — papirets store lys/skygge-forløb — tilpasses som en flade
    # over de pixels, der FAKTISK er blankt papir.
    #
    # To tidligere forsøg målte den lokalt. Begge brød sammen samme sted: hele
    # den nederste tredjedel er knapper, hjælpelinje, klippe og tipkort, så
    # dér er der intet blankt papir at måle på, og estimatet faldt ud i sort.
    # Et ark er et fysisk stykke papir med et jævnt lysforløb, så en flade af
    # lav orden beskriver det præcist — og den er defineret overalt, også hvor
    # der ikke er en eneste papirpixel at støtte sig til.
    ys, xs = np.mgrid[0:src.shape[0], 0:src.shape[1]]
    u = xs / src.shape[1]
    v = ys / src.shape[0]
    terms = np.dstack([
        np.ones_like(u), u, v, u * u, u * v, v * v,
        u ** 3, u * u * v, u * v * v, v ** 3,
    ])
    basis = terms[paper]
    illum = np.zeros_like(src)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(basis, src[..., c][paper], rcond=None)
        illum[..., c] = terms @ coef

    px, py, qx, qy = TEXTURE_PATCH
    patch = src[py:qy, px:qx]
    sample = patch - np.dstack([gaussian(patch[..., c], 52.0) for c in range(3)])
    rng = np.random.default_rng(7)

    erased = np.zeros(src.shape[:2], bool)
    for x0, y0, x1, y1 in ERASE:
        erased[y0:y1, x0:x1] = True
    f = blend_weight(erased)
    out = (illum + synth_grain(sample, src.shape[:2], rng)) * f + src * (1 - f)

    alpha = np.clip(gaussian(sheet.astype(np.float64), 1.2) * 1.4 - 0.2, 0, 1)
    rgba = np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8)
    plate = Image.fromarray(rgba)
    ys, xs = np.where(alpha > 0.02)
    plate = plate.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for width in WIDTHS:
        im = plate.resize((width, round(plate.height * width / plate.width)), Image.LANCZOS)
        path = OUT_DIR / f"title-parchment-{width}.webp"
        im.save(path, "WEBP", quality=86, method=6)
        print(f"{path.relative_to(ROOT)}  {im.width}x{im.height}  {path.stat().st_size / 1000:.1f} kB")


if __name__ == "__main__":
    main()
