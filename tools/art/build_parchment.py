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
OUT_DIR = ROOT / "src/assets/art"

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
    (120, 430, 682, 459),   # over båndet
    (120, 516, 682, 542),   # under båndet
    (168, 522, 642, 632),   # to linjer brødtekst
    (280, 592, 472, 650),   # ornamentskillelinje
    (120, 630, 682, 758),   # Begin- og Fates-knapper
    (164, 746, 642, 820),   # hjælpelinje
    (72, 636, 470, 802),    # forgrundsklippen, der skærer ind i arket
    (60, 796, 700, 992),    # tipkort med ildflise, helt ud til billedkanten
]

# Undertitlens bånd bliver liggende. Det er et malet stykke papir med sin egen
# skygge og sine egne flossede ender — bygget om ville det blive en tegning af
# et bånd. Kun teksten på det viskes væk.
#
# Hullet kan ikke fyldes med arkets papir: båndet har sin egen tone og sit eget
# lodrette forløb, mørk kantstreg foroven og forneden og lys flade imellem.
# Til gengæld er et bånd ensartet på langs, så profilen hentes fra de rene
# søjler på BEGGE sider af teksten og trappes lineært hen over hullet. Kun én
# side duer ikke: fladen har et sving i lyset, og et hul fyldt med venstre
# sides tone stod ~10 niveauer mørkere end papiret omkring det.
#
# Fordi prøven indeholder båndets egne kantstreger ved y=466-472 og y=509-515,
# gengiver stemplet dem af sig selv. Derfor må hullet gerne dække hele
# båndets højde — det er nemmere at ramme end en stribe inde i fladen med fire
# pixels luft til teksten.
RIBBON_TEXT = (248, 464, 580, 517)
RIBBON_LEFT = (198, 464, 246, 517)
RIBBON_RIGHT = (582, 464, 622, 517)

# Båndet er hverken tekst eller blankt ark. Det skal hverken viskes væk eller
# tælle med, når arkets lysforløb måles.
NOT_PAPER = (112, 452, 656, 522)

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

# Fra dette punkt dækker først forgrundsklippen og siden tipkortet arkets egen
# venstrekant, så den kan ikke aflæses. Silhuetten føres lige ned fra en række
# OVER klippen i stedet. Blev den ført ned fra en række under den, arvede den
# klippens kant, og der kom et firkantet hak på arkets venstre side.
EXTEND_FROM = 640
EXTEND_ROW = 628

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
    sample = sample.reshape(-1, 3)
    field = np.zeros((h, w))
    for sigma in (1.0, 2.0, 4.0, 8.0, 16.0, 32.0):
        field += gaussian(rng.standard_normal((h, w)), sigma) * sigma
    field /= max(field.std(), 1e-6)
    # Lidt kraftigere end papirets målte spredning: den ægte krakelering er
    # skarpe streger, den syntetiske støj er blød, og uden et løft ser de
    # udfyldte felter glattere ud end kanterne omkring dem.
    return np.dstack([field * sample[..., c].std() * 1.1 for c in range(3)])


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


def stamp_band(src: np.ndarray, hole, left, right, rng) -> None:
    """Fylder et hul i en vandret ensartet flade med fladens egen linjeprofil.

    Profilen tages på hver side af hullet og trappes lineært imellem dem, så
    både fladens lodrette bygning og dens lys på langs følger med. Ændrer
    `src` på stedet.
    """
    hx0, hy0, hx1, hy1 = hole
    w = hx1 - hx0
    lo = np.median(src[left[1]:left[3], left[0]:left[2]], axis=1)
    hi = np.median(src[right[1]:right[3], right[0]:right[2]], axis=1)
    t = np.linspace(0, 1, w)[None, :, None]
    fill = lo[:, None, :] * (1 - t) + hi[:, None, :] * t

    face = src[left[1] + 8:left[3] - 8, left[0]:left[2]]
    grain = synth_grain(
        (face - np.dstack([gaussian(face[..., c], 16.0) for c in range(3)])
         ).reshape(-1, 3), (hy1 - hy0, w), rng,
    )

    box = np.zeros((hy1 - hy0, w), bool)
    box[1:-1, 1:-1] = True
    weight = np.clip(ndimage.distance_transform_edt(box) / 6.0, 0, 1)[..., None]
    patch = src[hy0:hy1, hx0:hx1]
    src[hy0:hy1, hx0:hx1] = (fill + grain) * weight + patch * (1 - weight)


def main() -> None:
    full = Image.open(SOURCE).convert("RGB")
    src = np.asarray(full).astype(np.float64)[:, :COLUMN]
    lum = src @ np.array([0.2126, 0.7152, 0.0722])

    stamp_band(src, RIBBON_TEXT, RIBBON_LEFT, RIBBON_RIGHT, np.random.default_rng(11))

    sheet = sheet_mask(lum)
    sheet[CUT[1]:CUT[3], CUT[0]:CUT[2]] = False
    sheet[PATCH_BACK[1]:PATCH_BACK[3], PATCH_BACK[0]:PATCH_BACK[2]] = True
    sheet[EXTEND_FROM:] = sheet[EXTEND_ROW]

    # Blankt papir: inde i arket, men uden for alt det, der skal væk.
    paper = sheet.copy()
    for x0, y0, x1, y1 in [*ERASE, NOT_PAPER]:
        paper[y0:y1, x0:x1] = False
    # Arkets højre kant er en blød overgang ind i maleriet. Den er grønlig og
    # kun ~14 px bred, men den er den ENESTE "papir", der er tilbage mellem
    # knapperne og hjælpelinjen — så fladen greb fat i den og trak hele
    # underkanten grøn. Den tæller ikke med.
    paper[:, 678:] = False

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
    #
    # Fladen skal holdes i skak uden for det område, den er målt på. Nederst
    # er der ingen papirpixels overhovedet, og en tredjegradsflade svinger:
    # de nederste 200 rækker blæste ud i rent hvidt. Den klippes derfor til
    # det interval, papiret faktisk befinder sig i.
    illum = np.zeros_like(src)
    for c in range(3):
        seen = src[..., c][paper]
        coef, *_ = np.linalg.lstsq(basis, seen, rcond=None)
        lo, hi = np.percentile(seen, (1, 99))
        illum[..., c] = np.clip(terms @ coef, lo, hi)

    # Under den sidste række med rigtigt papirbelæg holdes lyset fast. Et ark
    # bliver ikke lysere af, at man holder op med at måle på det, og en
    # tredjegradsflade, der forlænges frit, gør netop dét.
    rows = np.where(paper.sum(1) >= 40)[0]
    illum[rows.max() + 1:] = illum[rows.max()]

    # Kornets styrke måles som dét, lysfladen IKKE kan forklare, over alt det
    # blanke papir. En lille lap kan ikke bruges: den fanger krakeleringen,
    # men ikke de store skyer i papiret, og de udfyldte felter blev derfor
    # fladere end arket omkring dem — tydeligst i den nederste halvdel, hvor
    # næsten alt er fyldt ud.
    sample = (src - illum)[paper]
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
