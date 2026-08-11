"""Skalerer titelskærmens brede baggrund til de bredder spillet bruger.

Scenepladen fra mockuppen er 896x992 — stående. Lægger man den som fuld
baggrund i en liggende rude, forstørres Karl til det dobbelte, og dalen
forsvinder. Løsningen er ét bredt maleri (21:9), som CSS kan `cover`e fra
4:3 op til ultrabredt uden at Karl vokser.

Maleriet skal ligge i `docs/design/reference/scene-wide.png`. Det kan ikke
udledes af mockuppen: kun 130 af pladens søjler er ren dal, og at strække
130 søjler til 1500 giver et udtværet billede, uanset hvor meget dis man
lægger på. Se `plan/design-title-screen-1.md`, ALT-006.

Krav til maleriet:
  * mindst 3360x1440, forhold 21:9
  * Karl i højre tredjedel, i samme størrelsesforhold som i mockuppen
  * ingen tekst, ingen knapper, ingen pergament, ingen ramme

Kør: python3 tools/art/build_scene_wide.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PAINTED = ROOT / "docs/design/reference/scene-wide.png"
OUT_DIR = ROOT / "src/assets/art"
WIDTHS = (2560, 1600)
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
    for width in WIDTHS:
        img = src.resize((width, round(width / ASPECT)), Image.LANCZOS)
        path = OUT_DIR / f"title-scene-wide-{width}.webp"
        img.save(path, "WEBP", quality=84, method=6)
        print(f"  {path.name}  {img.width}x{img.height}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
