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

Rammede miniaturer (ildflisen, hulefiguren) har deres egen ramme og er derfor
almindelige, uigennemsigtige billeder uden blanding.

Kør fra projektroden:  python3 tools/art/build_ui.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

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
        save(full.crop(box), name)


if __name__ == "__main__":
    main()
