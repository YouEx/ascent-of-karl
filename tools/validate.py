#!/usr/bin/env python3
"""Indholdsvalidering for Kolde Karl (PRD §5).

Fanger: forældreløse elementer, uopnåelige/dublerede kombinationer,
manglende referencer, uløselige obligatoriske problemer og manglende
age-up pr. akt. Kører i CI; exit-kode != 0 ved fejl.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

errors: list[str] = []
warnings: list[str] = []


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{path.relative_to(ROOT)}: ugyldig JSON — {exc}")
        return {}


def main() -> int:
    elements = load(CONTENT / "elements.json").get("elements", [])
    combos = load(CONTENT / "combos.json").get("combos", [])
    acts = [load(p) for p in sorted((CONTENT / "acts").glob("*.json"))]
    narrator_files = [load(p) for p in sorted((CONTENT / "narrator").glob("*.json"))]

    element_ids = [e["id"] for e in elements]
    dupes = {i for i in element_ids if element_ids.count(i) > 1}
    if dupes:
        errors.append(f"Dublerede element-id'er: {sorted(dupes)}")
    ids = set(element_ids)

    replik_ids = {r["id"] for f in narrator_files for r in f.get("replikker", [])}
    problem_ids = {p["id"] for a in acts for p in a.get("problemer", [])}

    seen_pairs: set[tuple[str, str]] = set()
    results: set[str] = set()
    solved: set[str] = set()
    flags_set: set[str] = set()
    flags_required: set[str] = set()
    age_up_results: set[str] = set()

    for c in combos:
        pair = tuple(sorted((c["element_a"], c["element_b"])))
        label = f"{c['element_a']}+{c['element_b']}"
        if pair in seen_pairs:
            errors.append(f"Dubleret kombination: {label}")
        seen_pairs.add(pair)

        for ref in (c["element_a"], c["element_b"], c["resultat"]):
            if ref not in ids:
                errors.append(f"{label}: ukendt element '{ref}'")
        results.add(c["resultat"])

        if c["narrator_replik"] and c["narrator_replik"] not in replik_ids:
            errors.append(f"{label}: ukendt narrator_replik '{c['narrator_replik']}'")
        if c["loeser_problem"]:
            if c["loeser_problem"] not in problem_ids:
                errors.append(f"{label}: ukendt problem '{c['loeser_problem']}'")
            solved.add(c["loeser_problem"])
        flags_set.update(c["flags_sat"])
        flags_required.update(c["flags_kraevet"])
        if c["age_up"]:
            age_up_results.add(c["resultat"])

    for e in elements:
        if not e["start"] and e["id"] not in results:
            errors.append(f"Forældreløst element (kan aldrig skabes): {e['id']}")

    for flag in sorted(flags_required - flags_set):
        errors.append(f"Flag kræves men sættes aldrig: {flag}")

    for act in acts:
        for p in act.get("problemer", []):
            if p["obligatorisk"] and p["id"] not in solved:
                errors.append(f"Akt {act['akt']}: obligatorisk problem '{p['id']}' kan ikke løses")
        target = act.get("age_up", {}).get("resultat")
        if not target:
            errors.append(f"Akt {act['akt']}: mangler age_up")
        elif target not in age_up_results:
            errors.append(f"Akt {act['akt']}: ingen kombination med age_up=true giver '{target}'")

    for msg in warnings:
        print(f"ADVARSEL: {msg}")
    for msg in errors:
        print(f"FEJL: {msg}", file=sys.stderr)
    if errors:
        print(f"\nValidering fejlede: {len(errors)} fejl.", file=sys.stderr)
        return 1
    print(f"Validering OK: {len(elements)} elementer, {len(combos)} kombinationer, {len(acts)} akt(er).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
