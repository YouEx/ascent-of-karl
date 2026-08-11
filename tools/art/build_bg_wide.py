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

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PAINTED = ROOT / "docs/design/reference/bg-wide.png"
OUT_DIR = ROOT / "src/assets/art"
WIDTHS = (1600, 2560)
ASPECT = 21 / 9


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

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for width in WIDTHS:
        img = src.resize((width, round(width / ASPECT)), Image.LANCZOS)
        path = OUT_DIR / f"bg-wide-{width}.webp"
        img.save(path, "WEBP", quality=82, method=6)
        print(f"  {path.name}  {img.width}x{img.height}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
