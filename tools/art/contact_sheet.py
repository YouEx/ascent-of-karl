"""Bygger et kontaktark: alle leverede element-illustrationer side om side,
i PRÆCIS den kortstørrelse griddet viser dem i, med navn under hver flise
og en metadata-header. TASK-035 (plan/design-visual-target-1.md).

DESIGN.md §9, "Kontrol før commit": nye billeder skal ses som kontaktark i
FLISESTØRRELSE, ikke ét ad gangen i fuld opløsning — drift i lysretning,
margin og mætning er usynligt ved 100 % og øjenfaldende i et grid, og
griddet er det, spilleren rent faktisk ser.

Korthøjden/-bredden og gradientfarverne læses direkte fra `src/ui/tokens.css`
(samme kilde CSS'en selv bruger, se `.element` i style.css) i stedet for at
blive gættet på ny her — driver tokens.css, driver kontaktarket automatisk
med, uden en separat hex-værdi at holde i sync.

Deterministisk: samme filer i samme rækkefølge giver samme output-BYTES hver
gang. Ingen tidsstempel optræder i selve billedet — "output-metadata" er en
sidecar-JSON (`<ark>.json`) med kildesti, sha256 og mål pr. flise, plus
arkets egen sha256 efter det er skrevet. Alt deraf er en funktion af INPUT,
aldrig af uret, så to kørsler på samme filer kan diffes bit for bit.

Ingen håndredigering: er en flise forkert, rettes udskærings- eller
normaliseringsscriptet (eller referencebilledet) — aldrig selve PNG'en,
og slet ikke elementets egen webp direkte i et billedprogram.

Kør:
  python3 tools/art/contact_sheet.py
  python3 tools/art/contact_sheet.py --dir src/assets/art/elements --cols 8
  python3 tools/art/contact_sheet.py --ids sten,pind,graes --out /tmp/pilot.png
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
TOKENS_CSS = ROOT / "src/ui/tokens.css"
DEFAULT_DIR = ROOT / "src/assets/art/elements"
# Regenereres hver kørsel — se .gitignore. Et kontaktark er et
# gennemsynsredskab, ikke et forsendt aktiv; det committes ikke som en
# voksende, konstant skiftende PNG hver gang et element leveres.
DEFAULT_OUT = ROOT / "tools/art/.review/contact-sheet.png"

def _hex_token(css: str, name: str) -> str:
    m = re.search(rf"--{re.escape(name)}:\s*(#[0-9a-fA-F]{{3,8}})", css)
    if not m:
        raise SystemExit(f"token --{name} ikke fundet i {TOKENS_CSS} — se scriptets docstring.")
    return m.group(1)


def _px_token(css: str, name: str) -> int:
    m = re.search(rf"--{re.escape(name)}:\s*(\d+)px", css)
    if not m:
        raise SystemExit(f"token --{name} ikke fundet i {TOKENS_CSS} — se scriptets docstring.")
    return int(m.group(1))


_CSS = TOKENS_CSS.read_text(encoding="utf-8")
CARD_W = _px_token(_CSS, "element-card-width")
CARD_H = _px_token(_CSS, "element-card-height")
ART_MAX_W = _px_token(_CSS, "element-art-max-width")
ART_MAX_H = _px_token(_CSS, "element-art-max-height")
GUTTER = _px_token(_CSS, "contact-sheet-gutter")
LABEL_H = _px_token(_CSS, "contact-sheet-label-height")
HEADER_H = _px_token(_CSS, "contact-sheet-header-height")
MARGIN = _px_token(_CSS, "contact-sheet-margin")
HEADER_FONT_SIZE = _px_token(_CSS, "contact-sheet-header-font-size")
LABEL_FONT_SIZE = _px_token(_CSS, "contact-sheet-label-font-size")


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def load_palette() -> dict[str, tuple[int, int, int]]:
    return {
        "tile_lit": _hex_to_rgb(_hex_token(_CSS, "tile-lit")),
        "tile_shade": _hex_to_rgb(_hex_token(_CSS, "tile-shade")),
        "tile_contour": _hex_to_rgb(_hex_token(_CSS, "tile-contour")),
        "ink_warm": _hex_to_rgb(_hex_token(_CSS, "ink-warm")),
        "sheet_bg": _hex_to_rgb(_hex_token(_CSS, "parchment")),
        "sheet_ink": _hex_to_rgb(_hex_token(_CSS, "ink-warm")),
    }


def _vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        px = tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3))
        img.putpixel((0, y), px)
    return img.resize((w, h))


def _label_font(px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=px)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _display_path(path: Path) -> str:
    """Sti relativt til repo-roden når muligt (pænere log/manifest), ellers
    den absolutte sti uændret — nyttigt når værktøjet kører mod en
    midlertidig mappe uden for repoet (fx i tests)."""
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def discover_tiles(source_dir: Path, ids: list[str] | None) -> list[tuple[str, Path]]:
    """Bestemmer hvilke filer der indgår, og i hvilken rækkefølge.

    Uden `--ids`: alle `.webp` i mappen, alfabetisk — deterministisk uden at
    kræve nogen ekstern rækkefølge-kilde. Med `--ids`: nøjagtigt de angivne
    id'er i den angivne rækkefølge; en manglende fil er en hård fejl, aldrig
    et stiltiende spring-over (samme disciplin som `build_elements.py`s
    "gæt ikke").
    """
    if ids is None:
        files = sorted(source_dir.glob("*.webp"), key=lambda p: p.stem)
        if not files:
            raise SystemExit(f"ingen .webp-filer fundet i {source_dir}")
        return [(p.stem, p) for p in files]

    result: list[tuple[str, Path]] = []
    missing = []
    for element_id in ids:
        path = source_dir / f"{element_id}.webp"
        if not path.exists():
            missing.append(element_id)
        else:
            result.append((element_id, path))
    if missing:
        raise SystemExit(
            f"mangler filer for: {', '.join(missing)} i {source_dir}\n"
            "Kontaktarket bygges ikke med huller — lever filerne, eller fjern id'et."
        )
    return result


def _fit_contain(img: Image.Image, max_w: int, max_h: int) -> Image.Image:
    scale = min(max_w / img.width, max_h / img.height)
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    return img.resize((w, h), Image.LANCZOS)


def render_card(tile: Image.Image, palette: dict[str, tuple[int, int, int]]) -> Image.Image:
    card = _vertical_gradient((CARD_W, CARD_H), palette["tile_lit"], palette["tile_shade"]).convert("RGBA")
    draw = ImageDraw.Draw(card)
    draw.rectangle((0, 0, CARD_W - 1, CARD_H - 1), outline=palette["tile_contour"], width=1)

    fitted = _fit_contain(tile, ART_MAX_W, ART_MAX_H)
    x = (CARD_W - fitted.width) // 2
    y = (CARD_H - fitted.height) // 2 - 6  # løftet en anelse, som griddets navnelinje gør plads til
    card.alpha_composite(fitted, (x, y))
    return card


def build_sheet(
    tiles: list[tuple[str, Path]],
    palette: dict[str, tuple[int, int, int]],
    cols: int,
    source_dir: Path,
) -> tuple[Image.Image, dict]:
    rows = (len(tiles) + cols - 1) // cols
    cell_w = CARD_W + GUTTER
    cell_h = CARD_H + LABEL_H + GUTTER
    sheet_w = MARGIN * 2 + cols * cell_w - GUTTER
    sheet_h = MARGIN * 2 + HEADER_H + rows * cell_h - GUTTER

    sheet = Image.new("RGB", (sheet_w, sheet_h), palette["sheet_bg"])
    draw = ImageDraw.Draw(sheet)

    header_font = _label_font(HEADER_FONT_SIZE)
    label_font = _label_font(LABEL_FONT_SIZE)
    rel_dir = _display_path(source_dir)
    draw.text(
        (MARGIN, MARGIN),
        f"Kontaktark - {len(tiles)} elementer - kilde {rel_dir} - kort {CARD_W}x{CARD_H}px (griddets faktiske flisestoerrelse)",
        fill=palette["sheet_ink"],
        font=header_font,
    )

    meta_tiles = []
    for i, (name, path) in enumerate(tiles):
        col, row = i % cols, i // cols
        x = MARGIN + col * cell_w
        y = MARGIN + HEADER_H + row * cell_h

        img = Image.open(path).convert("RGBA")
        card = render_card(img, palette)
        sheet.paste(card, (x, y), card)

        draw.text(
            (x + CARD_W / 2, y + CARD_H + 4),
            name,
            fill=palette["ink_warm"],
            font=label_font,
            anchor="ma",
        )

        meta_tiles.append(
            {
                "id": name,
                "source": _display_path(path),
                "sha256": sha256_of(path),
                "sourceWidth": img.width,
                "sourceHeight": img.height,
            }
        )

    manifest = {
        "version": 1,
        "generatedBy": "tools/art/contact_sheet.py",
        "sourceDir": str(rel_dir),
        "cardSize": [CARD_W, CARD_H],
        "artBox": [ART_MAX_W, ART_MAX_H],
        "count": len(tiles),
        "tiles": meta_tiles,
    }
    return sheet, manifest


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="mappe med .webp-filer")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output-PNG")
    parser.add_argument("--ids", type=str, default=None, help="kommasepareret liste af element-id'er, i rækkefølge")
    parser.add_argument("--cols", type=int, default=10, help="antal søjler")
    args = parser.parse_args(argv)

    ids = [s.strip() for s in args.ids.split(",")] if args.ids else None
    tiles = discover_tiles(args.dir, ids)
    palette = load_palette()
    sheet, manifest = build_sheet(tiles, palette, args.cols, args.dir)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, "PNG")
    manifest["sheetSha256"] = sha256_of(args.out)

    manifest_path = args.out.with_suffix(args.out.suffix + ".json")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"✅ {_display_path(args.out)} ({sheet.width}x{sheet.height}, {len(tiles)} fliser)")
    print(f"   metadata: {_display_path(manifest_path)}")


if __name__ == "__main__":
    main(sys.argv[1:])
