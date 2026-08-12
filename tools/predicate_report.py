#!/usr/bin/env python3
"""Prøver taksonomien mod den facitliste, Martin selv skrev i hånden.

Allowlisterne i challenges.json og `solves` i combos.json er menneskelige
klassifikationer, nedskrevet længe før taksonomien fandtes. De kan derfor
bruges som et ærligt testsæt: kan et prædikat over taggene genskabe listen,
er taggene gode nok til at bære resten af spillet.

To slags udfald, og de skal læses vidt forskelligt:

  FALSK NEGATIV — noget på facitlisten som prædikatet AFVISER.
      Altid en fejl. Enten mangler elementet et tag, eller prædikatet er
      for stramt. Retter man i stedet facitlisten, har man målt sig selv.

  FALSK POSITIV — noget prædikatet accepterer, som ikke stod på listen.
      Skal læses ét for ét. De fleste er gevinsten: elementer der BURDE
      have løst nøden, men som ingen huskede at føje til listen. Resten er
      huller i taksonomien.

  python3 tools/predicate_report.py [--tags content/drafts/element-tags-*.json]
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
GROUND_TRUTH = ROOT / "docs" / "design" / "taxonomy-ground-truth.json"


def satisfies(el: dict, pred: dict) -> bool:
    """Sandt hvis elementet opfylder prædikatet. Ren og rekursiv — spejler
    src/core/solves.ts, og de to skal ændres sammen."""
    if "allOf" in pred and not all(satisfies(el, p) for p in pred["allOf"]):
        return False
    if "anyOf" in pred and not any(satisfies(el, p) for p in pred["anyOf"]):
        return False
    if "not" in pred and satisfies(el, pred["not"]):
        return False
    if pred.get("crafted") and el.get("base"):
        return False
    if "minDepth" in pred and el.get("depth", 0) < pred["minDepth"]:
        return False
    if "kind" in pred and el.get("kind") not in pred["kind"]:
        return False
    if "stuff" in pred and el.get("stuff") not in pred["stuff"]:
        return False
    if "traits" in pred:
        # Alle nævnte traits skal være til stede; brug anyOf for "en af dem".
        if not set(pred["traits"]).issubset(set(el.get("traits", []))):
            return False
    if "scale" in pred and el.get("scale") not in pred["scale"]:
        return False
    return True


def compute_depths(elements: list[dict], combos: list[dict]) -> dict[str, int]:
    """Korteste opskriftsafstand fra base-elementerne. Spejler computeDepths()
    i src/core/timeline.ts — de to skal ændres sammen."""
    depths = {el["id"]: 0 for el in elements if el.get("base")}
    changed = True
    while changed:
        changed = False
        for combo in combos:
            a, b = combo["pair"]
            if a not in depths or b not in depths:
                continue
            candidate = 1 + max(depths[a], depths[b])
            if combo["result"] not in depths or candidate < depths[combo["result"]]:
                depths[combo["result"]] = candidate
                changed = True
    return depths


def load_tags(patterns: list[str]) -> dict[str, dict]:
    tags: dict[str, dict] = {}
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            for entry in data.get("elements", []):
                tags[entry["id"]] = entry
    return tags


def main() -> int:
    parser = argparse.ArgumentParser()
    # Tags ligger i elements.json efter sammenfletningen. --tags peger på nye
    # udkast i drafts/ når en runde til skal prøves af, før den flyttes ind.
    parser.add_argument("--tags", nargs="*", default=[])
    parser.add_argument("--predicates", default=str(CONTENT / "predicates.json"))
    args = parser.parse_args()

    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    truth = json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    tags = load_tags(args.tags)

    combos = json.loads((CONTENT / "combos.json").read_text(encoding="utf-8"))
    depths = compute_depths(elements, combos)

    merged: dict[str, dict] = {}
    for el in elements:
        merged[el["id"]] = {**el, **tags.get(el["id"], {}), "depth": depths.get(el["id"], 0)}

    tagged = [e["id"] for e in elements if "kind" in merged[e["id"]]]
    missing = [e["id"] for e in elements if "kind" not in merged[e["id"]]]
    print(f"Tags: {len(tagged)}/{len(elements)} elementer klassificeret")
    if missing:
        print(f"  MANGLER ({len(missing)}): {', '.join(missing[:12])}{' …' if len(missing) > 12 else ''}")

    # Ordforrådskontrol — et tag uden for taksonomien er en hård fejl.
    vocab = json.loads((CONTENT / "taxonomy.json").read_text(encoding="utf-8"))
    ok_kind = set(vocab["kind"]["values"])
    ok_stuff = set(vocab["stuff"]["values"])
    ok_traits = set(vocab["traits"]["values"])
    ok_scale = set(vocab["scale"]["values"])
    vocab_errors: list[str] = []
    for eid, el in merged.items():
        if "kind" not in el:
            continue
        if el.get("kind") not in ok_kind:
            vocab_errors.append(f"{eid}: ukendt kind {el.get('kind')!r}")
        if el.get("stuff") not in ok_stuff:
            vocab_errors.append(f"{eid}: ukendt stuff {el.get('stuff')!r}")
        if el.get("scale") not in ok_scale:
            vocab_errors.append(f"{eid}: ukendt scale {el.get('scale')!r}")
        for t in el.get("traits", []):
            if t not in ok_traits:
                vocab_errors.append(f"{eid}: ukendt trait {t!r}")
        if not el.get("traits"):
            vocab_errors.append(f"{eid}: ingen traits")
    print(f"Ordforråd: {len(vocab_errors)} fejl")
    for err in vocab_errors[:20]:
        print(f"  ✗ {err}")
    if len(vocab_errors) > 20:
        print(f"  … og {len(vocab_errors) - 20} mere")

    pred_path = Path(args.predicates)
    if not pred_path.exists():
        print(f"\n(ingen prædikater endnu — skriv {pred_path.relative_to(ROOT)} for at køre facitprøven)")
        return 1 if (vocab_errors or missing) else 0

    predicates = json.loads(pred_path.read_text(encoding="utf-8"))
    reject_all = set(truth["must_reject_all"])
    total_fn = 0
    total_fp = 0

    print("\n=== Facitprøve ===")
    for case in truth["cases"]:
        need = case["need"]
        pred = predicates.get(need)
        if not pred:
            print(f"\n{need:10} INTET PRÆDIKAT")
            continue
        accepted = {eid for eid, el in merged.items() if "kind" in el and satisfies(el, pred)}
        must = set(case["must_accept"])
        false_neg = must - accepted
        false_pos = accepted - must
        leaked = accepted & reject_all
        total_fn += len(false_neg)
        total_fp += len(false_pos)

        status = "OK " if not false_neg and not leaked else "FEJL"
        print(f"\n{status} {case['type']:9} {need:10} accepterer {len(accepted):3} af {len(merged)}")
        if false_neg:
            names = ", ".join(sorted(merged[i]["name"] for i in false_neg))
            print(f"     FALSK NEGATIV ({len(false_neg)}) — taggene er forkerte: {names}")
        if leaked:
            names = ", ".join(sorted(merged[i]["name"] for i in leaked))
            print(f"     STARTHÅND SLIPPER IGENNEM ({len(leaked)}) — nøden kan løses i tur 1: {names}")
        if false_pos:
            names = ", ".join(sorted(merged[i]["name"] for i in sorted(false_pos))[:14])
            print(f"     nye ({len(false_pos)}) — læs i hånden: {names}")

    print(f"\nI alt: {total_fn} falske negativer (skal være 0), {total_fp} nye til gennemsyn")
    return 1 if total_fn else 0


if __name__ == "__main__":
    raise SystemExit(main())
