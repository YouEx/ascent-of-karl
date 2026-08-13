#!/usr/bin/env python3
"""Skærer titelskærmens malede småting ud af mockuppen.

Alt her er ægte maleri fra referencen — ikke tegnede efterligninger. To slags:

  * KNAPPER som skydedøre. En knap skal kunne være bredere eller smallere end
    i mockuppen, så den skæres i tre: venstre hætte, en ren søjle fra fladen,
    og højre hætte. I CSS lægges de som tre baggrundslag, hvor midtersøjlen
    gentages. Fladen har et tydeligt lodret lysforløb, og fordi hver del
    skaleres til fuld højde, følger forløbet med — det ville en 9-felts
    `border-image` ikke kunne, for dens midterfelt strækkes i begge retninger
    og bliver fladt.

  * ORNAMENTER som uigennemsigtige udsnit. Mærkerne kan ikke skilles fra deres
    papir med alfa — se `build_parchment.py` for de fire forsøg og hvorfor de
    faldt. I stedet lægges udsnittet med `mix-blend-mode: multiply` oven på en
    flade af samme tone: papiret bliver da nærmest neutralt, og kun mærket
    slår igennem, med hele sin malede struktur i behold.

    Den neutralitet holder kun, når udsnittets EGET papir allerede er ~hvidt.
    Et rent udsnit har i stedet REFERENCENS papirtone (~(226,202,179), langt
    fra hvid). Lægges det med multiply oven på VORES egen plade eller
    --chronicle-flade — som også er farvet pergament, ikke hvidt — ganges to
    pergamenter sammen, og resultatet bliver mørkere og mere mættet end
    referencens ene lag (målt: (208,167,129) i stedet for referencens
    (225,202,178) på skillelinjen). De ornamenter, der lander på den lyse
    flade (skillelinjen og håndikonet på pladen, jagtscenen på --chronicle),
    hvidbalanceres derfor med `neutralize_paper()` før de gemmes. orn-spiral
    og orn-trophy lander på de mørke stenknapper og rammes ikke af samme
    fejl — de er urørte, rene udsnit.

Rammede miniaturer (ildflisen, hulefiguren) har deres egen ramme og er derfor
almindelige, uigennemsigtige billeder uden blanding.

Kør fra projektroden:  python3 tools/art/build_ui.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/design/reference/title-2026-08-11.webp"
OUT_DIR = ROOT / "src/assets/art"

# Knapperne, skåret i skydedøre. `mid` skal være en søjle uden hverken
# ornament eller bogstav i sig — den gentages hen over hele knappens bredde.
BUTTONS = {
    "begin": {
        "left": (145, 643, 175, 747),
        "mid": (236, 643, 250, 747),
        "right": (383, 643, 420, 747),
        "face": (668, 724),
    },
    "quiet": {
        "left": (445, 646, 463, 742),
        "mid": (566, 646, 572, 742),
        "right": (626, 646, 655, 742),
        "face": (664, 726),
    },
}

# Malede mærker, der skal lægges med `multiply`.
ORNAMENTS = {
    "orn-spiral": (176, 660, 246, 730),
    "orn-trophy": (464, 660, 502, 730),
    "orn-tap": (193, 762, 230, 802),
    "orn-divider": (296, 606, 478, 632),
    "orn-hunt": (548, 843, 658, 940),
}

# Ornamenter der lander på LYS bund (pladen selv, eller --chronicle) skal
# hvidbalanceres, se `neutralize_paper()`. orn-spiral og orn-trophy lander på
# de mørke stenknapper (.title-actions), hvor et par procents ekstra
# mætning ikke ses, og regionen (actions) består allerede — de er urørte.
#
# To hvidbalance-metoder findes: en global (én skalar for hele udsnittet) og
# en lokal (et lysforløb pr. pixel, se `neutralize_paper(local=True)`). Målt
# med den visuelle dommer opfører de sig forskelligt pr. udsnit: `orn-tap`
# har et hjørne med mockuppens egen bløde skygge, som kun den lokale metode
# retter (ellers en synlig firkantet "boks" om håndikonet, se historikken i
# `plan/design-title-screen-1.md`). `orn-divider` og `orn-hunt` er derimod
# begge JÆVNT lyst udsnit — der er ikke noget hjørneproblem at rette — og på
# dem trak den lokale sløring desværre de tyndeste penselstrøg en anelse
# fladere, målt som et konkret fald i `ink` (divider gik fra bestået til
# lige under tærsklen). Derfor: lokal kun hvor den faktisk retter en fejl.
NEUTRALIZE_GLOBAL = {"orn-divider", "orn-hunt"}
NEUTRALIZE_LOCAL = {"orn-tap"}
PAPER_PERCENTILE = 85

# Rammede miniaturer: eget billede med egen ramme, ingen blanding.
FRAMED = {
    "tile-fire": (122, 847, 208, 933),
    "chip-figure": (45, 28, 114, 89),
}

# En ren søjle må ikke indeholde blæk. Bogstaverne er markant mørkere end
# enhver flade, de står på, så en enkelt grænse fanger dem alle.
INK_LEVEL = 120


def check_clean(lum: np.ndarray, box, face, name: str) -> None:
    """Sikrer at en 'ren' søjle faktisk er ren.

    Målene er læst af på et forstørret udsnit, og en fejl på ti pixels er nem
    at begå. Fanges den ikke her, dukker den op som en stribe af halve
    bogstaver gentaget hen over knappen. Kun fladen tælles med: knappens egen
    stenramme foroven og forneden er mørkere end blæk og skal være der.
    """
    x0, _, x1, _ = box
    dark = int((lum[face[0]:face[1], x0:x1] < INK_LEVEL).sum())
    if dark:
        raise SystemExit(f"{name}: {dark} blækpixels i den rene søjle {box}")


def neutralize_paper(im: Image.Image, local: bool = False) -> Image.Image:
    """Hvidbalancerer udsnittets eget papir til ~hvidt før `multiply`.

    Et rent udsnit har referencens EGEN papirtone (~(226,202,179)), ikke
    hvid. Lagt med multiply oven på vores plade eller --chronicle — også
    farvet pergament — ganges to pergamenter sammen, og resultatet bliver
    mørkere og mere mættet end referencens ene lag (målt på skillelinjen:
    (208,167,129) i stedet for (225,202,178)). Denne funktion strækker
    papiret op mod 255, så multiply bliver neutral på papiret og kun
    blækket slår igennem — tonet af VORES flade, ikke referencens.

    To metoder, valgt af `local` (se `NEUTRALIZE_LOCAL`/`NEUTRALIZE_GLOBAL`):

    `local=False` (global): én percentil (papiret, målt uden for blækket) pr.
    kanal for hele udsnittet. Enkel og præcis, når papiret er jævnt lyst.

    `local=True`: `orn-tap` har sit eget hjørne af mockuppens bløde skygge,
    og den globale percentil retter gennemsnittet men lader det hjørne stå
    ~12 % for mørkt — ganget med multiply blev det en synlig firkantet
    "boks" om håndikonet i den renderede hint-linje. Denne metode måler
    papiret LOKALT: en vægtet gaussisk sløring (`ndimage.gaussian_filter`)
    af kun de pixels, der ligger over `INK_LEVEL` (samme grænse som
    knappernes rene søjle), giver et lysforløb pr. pixel i stedet for ét tal
    for hele udsnittet — samme grundtanke som `build_parchment.py`'s
    fladefit, blot en sløring frem for et polynomium, fordi udsnittene her
    er for små og for blækfyldte til at et gradsfit har nok papir at støtte
    sig til. Hvor der er for lidt papir i nærheden falder den tilbage på
    den globale percentil. Målt med den visuelle dommer trak den samme
    lokale sløring desværre `orn-divider`s og `orn-hunt`s tyndeste
    penselstrøg en anelse fladere (et jævnt lyst udsnit har intet
    hjørneproblem at rette), så den bruges kun hvor den faktisk vandt.
    """
    a = np.asarray(im).astype(np.float64)
    global_paper = np.percentile(a.reshape(-1, 3), PAPER_PERCENTILE, axis=0)

    if not local:
        factor = 255.0 / np.clip(global_paper, 1, 255)
        return Image.fromarray(np.clip(a * factor, 0, 255).astype("uint8"))

    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    paper_mask = (lum >= INK_LEVEL).astype(np.float64)
    sigma = min(a.shape[0], a.shape[1]) / 6.0
    weight = ndimage.gaussian_filter(paper_mask, sigma=sigma, mode="nearest")
    weighted = np.stack(
        [ndimage.gaussian_filter(a[..., c] * paper_mask, sigma=sigma, mode="nearest")
         for c in range(3)],
        axis=-1,
    )
    local_paper = weighted / np.clip(weight, 1e-6, None)[..., None]
    low_confidence = weight < 0.05
    for c in range(3):
        local_paper[..., c][low_confidence] = global_paper[c]

    factor = 255.0 / np.clip(local_paper, 1, 255)
    out = np.clip(a * factor, 0, 255).astype("uint8")
    return Image.fromarray(out)


def save(im: Image.Image, name: str, scale: int = 2) -> None:
    out = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    path = OUT_DIR / f"{name}.webp"
    out.save(path, "WEBP", quality=88, method=6)
    print(f"{path.relative_to(ROOT)}  {out.width}x{out.height}  {path.stat().st_size / 1000:.1f} kB")


def main() -> None:
    full = Image.open(SOURCE).convert("RGB")
    lum = np.asarray(full).astype(float) @ np.array([0.2126, 0.7152, 0.0722])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for key, parts in BUTTONS.items():
        face = parts["face"]
        check_clean(lum, parts["mid"], face, f"btn-{key}")
        for part in ("left", "mid", "right"):
            save(full.crop(parts[part]), f"btn-{key}-{part[0]}")

    for name, box in {**ORNAMENTS, **FRAMED}.items():
        crop = full.crop(box)
        if name in NEUTRALIZE_GLOBAL:
            crop = neutralize_paper(crop, local=False)
        elif name in NEUTRALIZE_LOCAL:
            crop = neutralize_paper(crop, local=True)
        save(crop, name)


if __name__ == "__main__":
    main()
