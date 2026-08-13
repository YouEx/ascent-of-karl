"""To-trins indtagelse af et tematisk kildeark: detect -> menneskeligt review
-> apply. Det generelle grundlag TASK-038 har brug for ("174 resterende
elementer i bunker sten/træ/mad/dyr/værktøj/ild/samfund"), bygget oven på
`sheet_ingest.py`'s samme udskæringsmotor som `build_elements.py` bruger for
de 13 grundelementer — ingen ny, drivende metode, og ingen AI i selve
beskæringen. Et billede må komme FRA en billedmodel; at finde og skære
brikkerne ud sker med ren aritmetik, akkurat som hidtil.

Hvorfor to trin med et menneske imellem, og ikke automatisk id-tildeling:

`detect` kører fremspringsdetektionen og skriver en manifest-JSON med
boksene i læserækkefølge og `"id": null` for hver — INGEN gætter på hvilken
boks der er hvilket element. Et menneske ser kontaktarket eller selve
kildearket og udfylder id'erne (og kan om nødvendigt sætte en boks til
`null` for bevidst at udelade den, fx støj eller en boks der skal genmales).

`apply` læser den udfyldte manifest, låser at kildearket ikke er ændret
siden manifestet blev skrevet (sha256), afviser dubletter, og skærer/
skalerer/gemmer nøjagtigt de navngivne fliser — samme pad/skalerings-
aritmetik og samme WebP-parametre (quality=82, method=6) som
`build_elements.py` altid har brugt, så output fra et tematisk ark ikke
driver fra de 13 grundelementer i kvalitet eller filstørrelse.

Kør:
    python3 tools/art/ingest_sheet.py detect --sheet <ark.png> --out <manifest.json>
    # ... udfyld "id" for hver flise i manifest.json, se kontaktarket ...
    python3 tools/art/ingest_sheet.py apply --manifest <manifest.json> --out-dir <mappe>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image

from sheet_ingest import (
    CutParams,
    DetectParams,
    content_mask,
    load_rgb,
    detect_boxes,
    cut_full_rgba,
    pad_and_scale,
    sample_border_background,
)

ROOT = Path(__file__).resolve().parents[2]

WEBP_QUALITY = 82
WEBP_METHOD = 6
ELEMENT_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def build_manifest(
    sheet_path: Path,
    detect_params: DetectParams = DetectParams(),
    cut_params: CutParams = CutParams(),
) -> dict:
    """Kører fremspringsdetektionen på `sheet_path` og bygger en manifest med
    boksene i læserækkefølge (bånd for bånd, top til bund; venstre til
    højre inden i hvert bånd) og `id: null` for hver — klar til menneskeligt
    review, intet gættet."""
    a = load_rgb(sheet_path)
    bg = sample_border_background(a)
    dist, mask = content_mask(a, bg, detect_params.mask_threshold)
    boxes = detect_boxes(mask, detect_params)
    return {
        "version": 1,
        "sheet": _display_path(sheet_path),
        "sheetSha256": sha256_of(sheet_path),
        "sheetWidth": int(a.shape[1]),
        "sheetHeight": int(a.shape[0]),
        "detectParams": {
            "maskThreshold": detect_params.mask_threshold,
            "minArea": detect_params.min_area,
            "gapMin": detect_params.gap_min,
            "gapDivisor": detect_params.gap_divisor,
        },
        "cutParams": {
            "tile": cut_params.tile,
            "pad": cut_params.pad,
            "alphaFloor": cut_params.alpha_floor,
            "alphaFull": cut_params.alpha_full,
        },
        "tiles": [
            {"index": i, "id": None, "box": [int(v) for v in box]}
            for i, box in enumerate(boxes)
        ],
    }


def write_manifest_json(manifest: dict, out: Path) -> None:
    """Skriver manifestet deterministisk: sorterede nøgler, fast indrykning,
    afsluttende linjeskift. Ingen tidsstempel — samme ark giver samme bytes."""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest(manifest: dict, sheet_path: Path) -> None:
    """Hård fejl (SystemExit), aldrig en tavs antagelse, hvis:
    - kildearket er ændret siden manifestet blev bygget (sha256 driver)
    - to fliser har fået samme id (dublet ville overskrive stille)

    `id: null` er tilladt og betyder bevidst udeladt (støj, skal genmales)."""
    actual_sha = sha256_of(sheet_path)
    if actual_sha != manifest.get("sheetSha256"):
        raise SystemExit(
            f"kildearket er ændret siden manifestet blev skrevet "
            f"(sha256 {actual_sha[:12]}… matcher ikke manifestets {str(manifest.get('sheetSha256'))[:12]}…).\n"
            "Kør 'detect' igen på det aktuelle ark, gæt ikke."
        )
    with Image.open(sheet_path) as image:
        sheet_width, sheet_height = image.size

    ids: list[str] = []
    for tile in manifest["tiles"]:
        tile_id = tile.get("id")
        if tile_id is not None:
            if not isinstance(tile_id, str) or not ELEMENT_ID_RE.fullmatch(tile_id):
                raise SystemExit(
                    f"ugyldigt id i manifestet: {tile_id!r} — brug content-id'er "
                    "med små ASCII-bogstaver, tal og enkeltbindestreger."
                )
            ids.append(tile_id)

        box = tile.get("box")
        if (
            not isinstance(box, list)
            or len(box) != 4
            or not all(isinstance(v, int) for v in box)
        ):
            raise SystemExit(f"ugyldig boks i manifestet: {box!r}")
        x0, y0, x1, y1 = box
        if not (0 <= x0 < x1 <= sheet_width and 0 <= y0 < y1 <= sheet_height):
            raise SystemExit(
                f"boks {box!r} ligger uden for kildearket "
                f"{sheet_width}x{sheet_height}."
            )

    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"dublet-id'er i manifestet: {sorted(dupes)} — hver flise skal have sit eget id.")


def apply_manifest(
    manifest: dict,
    sheet_path: Path,
    out_dir: Path,
) -> dict[str, Path]:
    """Skærer alle fliser med et udfyldt id ud af `sheet_path` og gemmer dem
    som WebP i `out_dir`. Fliser med `id: null` springes bevidst over."""
    validate_manifest(manifest, sheet_path)

    a = load_rgb(sheet_path)
    bg = sample_border_background(a)
    cut_params_dict = manifest.get("cutParams", {})
    cut_params = CutParams(
        tile=cut_params_dict.get("tile", CutParams().tile),
        pad=cut_params_dict.get("pad", CutParams().pad),
        alpha_floor=cut_params_dict.get("alphaFloor", CutParams().alpha_floor),
        alpha_full=cut_params_dict.get("alphaFull", CutParams().alpha_full),
    )
    detect_params_dict = manifest.get("detectParams", {})
    mask_threshold = detect_params_dict.get("maskThreshold", DetectParams().mask_threshold)
    dist, _mask = content_mask(a, bg, mask_threshold)
    full = cut_full_rgba(a, bg, dist, cut_params)

    out_dir.mkdir(parents=True, exist_ok=True)
    saved: dict[str, Path] = {}
    for tile in manifest["tiles"]:
        tile_id = tile.get("id")
        if tile_id is None:
            continue
        box = tuple(tile["box"])
        crop = pad_and_scale(full, box, cut_params)
        path = out_dir / f"{tile_id}.webp"
        crop.save(path, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
        saved[tile_id] = path
    return saved


def _cmd_detect(args: argparse.Namespace) -> None:
    detect_params = DetectParams(mask_threshold=args.mask_threshold, min_area=args.min_area)
    cut_params = CutParams(tile=args.tile, pad=args.pad, alpha_floor=args.alpha_floor, alpha_full=args.alpha_full)
    manifest = build_manifest(args.sheet, detect_params, cut_params)
    write_manifest_json(manifest, args.out)
    print(f"fandt {len(manifest['tiles'])} genstande på {_display_path(args.sheet)}")
    print(f"manifest skrevet: {_display_path(args.out)}")
    print("udfyld \"id\" for hver flise (se kontaktarket), kør så 'apply'.")


def _cmd_apply(args: argparse.Namespace) -> None:
    manifest = load_manifest(args.manifest)
    sheet_path = args.sheet if args.sheet else (ROOT / manifest["sheet"])
    saved = apply_manifest(manifest, sheet_path, args.out_dir)
    if not saved:
        print("ingen fliser havde et udfyldt id — intet at gemme.")
        return
    for tile_id, path in saved.items():
        print(f"  {path.name:20s} <- {tile_id}  ({path.stat().st_size / 1024:.1f} kB)")
    skipped = len(manifest["tiles"]) - len(saved)
    if skipped:
        print(f"({skipped} flise(r) uden id sprunget bevidst over)")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_detect = sub.add_parser("detect", help="find bokse på et ark, skriv manifest med id: null")
    p_detect.add_argument("--sheet", type=Path, required=True)
    p_detect.add_argument("--out", type=Path, required=True)
    p_detect.add_argument("--mask-threshold", type=float, default=DetectParams().mask_threshold)
    p_detect.add_argument("--min-area", type=int, default=DetectParams().min_area)
    p_detect.add_argument("--tile", type=int, default=CutParams().tile)
    p_detect.add_argument("--pad", type=float, default=CutParams().pad)
    p_detect.add_argument("--alpha-floor", type=float, default=CutParams().alpha_floor)
    p_detect.add_argument("--alpha-full", type=float, default=CutParams().alpha_full)
    p_detect.set_defaults(func=_cmd_detect)

    p_apply = sub.add_parser("apply", help="skær reviewede fliser ud og gem som WebP")
    p_apply.add_argument("--manifest", type=Path, required=True)
    p_apply.add_argument("--out-dir", type=Path, required=True)
    p_apply.add_argument("--sheet", type=Path, default=None, help="override manifestets 'sheet'-sti (normalt unødvendigt)")
    p_apply.set_defaults(func=_cmd_apply)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
