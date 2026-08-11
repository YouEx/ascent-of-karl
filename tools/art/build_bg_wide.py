"""Skalerer spilskærmens brede baggrundsmaleri til de bredder spillet bruger.

Dommeren målte hele lærredet som forkert materiale: `body` var en CSS-gradient,
mens referencen er et malet landskab. Ingen mængde tokens kan lave en gradient
om til et maleri — derfor gik fundet i asset-køen og ikke i `tuning.css`.

Maleriet kan ikke skæres ud af mockuppen. UI-panelet dækker 77 % af fladen, så
kun to strimler på 168 px i hver side er ren baggrund; at strække dem til et
fuldt lærred giver udtværing, ikke et landskab. Billedet er derfor malet forfra
i samme register som referencen: kølig, diset, lav kontrast.

Bredden er valgt efter Martins krav: ét bredt maleri, som CSS `cover`er fra 4:3
op til ultrabredt, i stedet for ét billede per rude. Kildeforholdet er 21:9.

Bemærk om opløsning: kilden er 1913 px bred. På en 4:3-rude skalerer `cover`
efter HØJDEN, så et 1086 px højt vindue trækker billedet op til ~2527 px bredt.
Det er en opskalering på ~32 %. Maleriet er diset og uden fine detaljer, så det
bærer det — men derfor er 2560-varianten opskaleret fra kilden, ikke nedskaleret,
og det er den øvre grænse for, hvad der giver mening at levere.

Kør: python3 tools/art/build_bg_wide.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PAINTED = ROOT / "docs/design/reference/bg-wide.png"
OUT_DIR = ROOT / "src/assets/art"
WIDTHS = (1600, 2560)
ASPECT = 21 / 9


def _grade(src: Image.Image) -> Image.Image:
    """Trækker maleriet over i referencens kulør.

    Generatoren leverede et VARMT soloprindsmaleri, selvom prompten bad om
    "kølig, diset, lav kontrast" — samme svigt som stentavlen til Kombinér.
    Rettelsen er ikke en ny prompt, men en målt korrektion: referencens
    margener og vores egne margener viser præcis den samme flade, så en
    affin graduering fra vores statistik til referencens er direkte målbar.

    Tallene er MÅLT ÉN GANG og derefter frosset. De blev oprindeligt regnet
    ud mod `.judge/latest/render/game.png`, men så snart den render viser en
    allerede gradueret baggrund, måler scriptet sin egen rettelse og bliver
    til identitet — næste kørsel ville give det ustøttede maleri tilbage.
    Frosne konstanter gør bygget deterministisk fra kilden.

    Grå-verdens-metoden (bare skalere kanalmidler) blev fravalgt: den flytter
    kuløren, men lader vores for høje mætning stå. Reinhard i Lab flytter både
    midtpunkt og spredning, altså både kulør OG kontrast, som er de to ting
    dommeren målte forkert.

    AFVIST 2026-08-12 — en RÆKKEVIS efterjustering oveni. Tanken var, at et
    landskab er sin lodrette progression, og at vores maleri var for lyst
    præcis dér hvor problemchipsene sidder. Målingen sagde nej: lærredets
    tone faldt fra 0,897 til 0,775 og chippenes fra 0,291 til 0,171.
    Margenerne er de eneste rene baggrundssøjler, men netop derfor er de
    IKKE repræsentative for fladen i midten — en margen-udledt rækkedelta
    overkorrigerer alt det, rammen dækker.
    """
    import cv2  # lokal import: kun graduering bruger OpenCV

    # Målt mellem referencens og vores egne margener (søjle 15-150 og
    # 1300-1435 — de eneste steder hvor begge billeder viser ren baggrund).
    mu_o = np.array([52.1, 15.1, 20.7])
    mu_t = np.array([55.4, 9.8, 4.3])
    gain = np.array([0.93, 0.75, 0.67])

    lab = cv2.cvtColor(
        (np.asarray(src).astype(np.float32) / 255.0), cv2.COLOR_RGB2LAB
    )
    lab = ((lab - mu_o) * gain + mu_t).astype(np.float32)
    rgb = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    print(f"  graduering  b {mu_o[2]:+.1f}→{mu_t[2]:+.1f}  gain {gain}")
    return Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8))


def main() -> None:
    if not PAINTED.exists():
        raise SystemExit(
            f"mangler {PAINTED.relative_to(ROOT)}\n"
            "Se scriptets docstring for kravene til maleriet."
        )
    src = Image.open(PAINTED).convert("RGB")
    got = src.width / src.height
    if abs(got - ASPECT) > 0.06:
        raise SystemExit(f"forholdet er {got:.2f}, forventede {ASPECT:.2f} (21:9)")

    src = _grade(src)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for width in WIDTHS:
        img = src.resize((width, round(width / ASPECT)), Image.LANCZOS)
        path = OUT_DIR / f"bg-wide-{width}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        print(f"  {path.name}  {img.width}x{img.height}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
