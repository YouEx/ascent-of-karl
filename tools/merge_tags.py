#!/usr/bin/env python3
"""Flytter de godkendte tags fra content/drafts/ ind i content/elements.json.

PRD §5: et menneske flytter indhold ud af drafts/. Scriptet gør flytningen
mekanisk og kontrollerbar, men det er stadig en person der beslutter at
køre det.

Nægter at køre hvis noget mangler eller er uden for ordforrådet — en halv
sammenfletning er værre end ingen, fordi prædikaterne så tier stille om de
elementer der mangler.

  python3 tools/merge_tags.py [--dry-run]
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# Tags lægges efter identiteten og før prosaen, så filen stadig kan læses
# ovenfra og ned: hvad er det, hvad er det lavet af, hvad siger vi om det.
TAG_KEYS = ("kind", "stuff", "traits", "scale")
AFTER = ("id", "name", "emoji", "act", "base")


def load_drafts() -> dict[str, dict]:
    tags: dict[str, dict] = {}
    paths = sorted(glob.glob(str(CONTENT / "drafts" / "element-tags-*.json")))
    if not paths:
        sys.exit("FEJL: ingen udkast i content/drafts/")
    for path in paths:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        for entry in data.get("elements", []):
            if entry["id"] in tags:
                sys.exit(f"FEJL: {entry['id']} er tagget i to batches")
            tags[entry["id"]] = entry
    return tags


def reorder(el: dict) -> dict:
    """Sætter tag-nøglerne ind på fast plads, så diffen forbliver læselig."""
    out: dict = {}
    for key in AFTER:
        if key in el:
            out[key] = el[key]
    for key in TAG_KEYS:
        if key in el:
            out[key] = el[key]
    for key, value in el.items():
        if key not in out:
            out[key] = value
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    vocab = json.loads((CONTENT / "taxonomy.json").read_text(encoding="utf-8"))
    tags = load_drafts()

    missing = [el["id"] for el in elements if el["id"] not in tags]
    if missing:
        sys.exit(f"FEJL: {len(missing)} elementer mangler tags: {', '.join(missing[:12])}")

    known = {el["id"] for el in elements}
    orphans = sorted(set(tags) - known)
    if orphans:
        sys.exit(f"FEJL: tags for ukendte id'er: {', '.join(orphans)}")

    errors: list[str] = []
    for el in elements:
        tag = tags[el["id"]]
        for key in ("kind", "stuff", "scale"):
            allowed = vocab[key]["values"]
            if tag.get(key) not in allowed:
                errors.append(f"{el['id']}: {key}={tag.get(key)!r} er uden for ordforrådet")
        for trait in tag.get("traits", []):
            if trait not in vocab["traits"]["values"]:
                errors.append(f"{el['id']}: trait={trait!r} er uden for ordforrådet")
        if not tag.get("traits"):
            errors.append(f"{el['id']}: ingen traits")
    if errors:
        for line in errors[:20]:
            print("  " + line)
        sys.exit(f"FEJL: {len(errors)} fejl i tags — intet flyttet")

    changed = 0
    merged = []
    for el in elements:
        tag = tags[el["id"]]
        before = {k: el.get(k) for k in TAG_KEYS}
        el["kind"] = tag["kind"]
        el["stuff"] = tag["stuff"]
        el["traits"] = tag["traits"]
        el["scale"] = tag["scale"]
        if before != {k: el[k] for k in TAG_KEYS}:
            changed += 1
        merged.append(reorder(el))

    print(f"{len(merged)} elementer, {changed} ændret")
    if args.dry_run:
        print("(--dry-run: intet skrevet)")
        return 0

    path = CONTENT / "elements.json"
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"skrevet til {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
