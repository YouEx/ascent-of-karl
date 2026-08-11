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
TARGET = ROOT / "docs/design/reference/target-2026-08-11.webp"
RENDER = ROOT / ".judge/latest/render/game.png"
OUT_DIR = ROOT / "src/assets/art"
WIDTHS = (1600, 2560)
ASPECT = 21 / 9

# De eneste søjler hvor BÅDE referencen og vores render viser ren baggrund:
# vinduesrammen dækker alt derimellem. Målt på referencen (1448 px bred).
MARGINS = ((15, 150), (1300, 1435))


def _margin_pixels(path: Path) -> np.ndarray:
    """Alle baggrundspixels fra de to margener, som Nx3 float."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    return np.concatenate([a[:, x0:x1].reshape(-1, 3) for x0, x1 in MARGINS])


def _grade(src: Image.Image) -> Image.Image:
    """Trækker maleriet over i referencens kulør.

    Generatoren leverede et VARMT soloprindsmaleri, selvom prompten bad om
    "kølig, diset, lav kontrast" — samme svigt som stentavlen til Kombinér.
    Rettelsen er ikke en ny prompt, men en målt korrektion: referencens
    margener og vores egne margener viser præcis den samme flade, så en
    affin graduering fra vores statistik til referencens er direkte målbar.

    Grå-verdens-metoden (bare skalere kanalmidler) blev fravalgt: den flytter
    kuløren, men lader vores for høje mætning stå. Reinhard i Lab flytter både
    midtpunkt og spredning, altså både kulør OG kontrast, som er de to ting
    dommeren målte forkert.
    """
    if not (TARGET.exists() and RENDER.exists()):
        print("  (springer graduering over: mangler reference eller render)")
        return src

    import cv2  # lokal import: kun graduering bruger OpenCV

    def to_lab(rgb01: np.ndarray) -> np.ndarray:
        """Ægte Lab (L 0-100, a/b ±127) — kræver float32-input i [0,1]."""
        return cv2.cvtColor(rgb01.astype(np.float32), cv2.COLOR_RGB2LAB)

    lab_ours = to_lab((_margin_pixels(RENDER) / 255.0).reshape(1, -1, 3))[0]
    lab_theirs = to_lab((_margin_pixels(TARGET) / 255.0).reshape(1, -1, 3))[0]

    mu_o, sd_o = lab_ours.mean(axis=0), lab_ours.std(axis=0)
    mu_t, sd_t = lab_theirs.mean(axis=0), lab_theirs.std(axis=0)
    gain = np.where(sd_o > 1e-6, sd_t / sd_o, 1.0)
    print(
        f"  graduering  L {mu_o[0]:.1f}→{mu_t[0]:.1f}  "
        f"a {mu_o[1]:+.1f}→{mu_t[1]:+.1f}  b {mu_o[2]:+.1f}→{mu_t[2]:+.1f}  "
        f"gain {gain.round(2)}"
    )

    lab = to_lab(np.asarray(src).astype(np.float64) / 255.0)
    lab = ((lab - mu_o) * gain + mu_t).astype(np.float32)
    rgb = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    out = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


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
