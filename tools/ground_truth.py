#!/usr/bin/env python3
"""Udtrækker facitlisten for taksonomien af det indhold, Martin allerede har skrevet i hånden.

Allowlisterne i challenges.json og `solves` i combos.json ER menneskelige
klassifikationer: "disse ting løser ulve", "disse ting mætter Karl". De er
dermed et gratis testsæt med ~60 mærkede eksempler, skrevet før taksonomien
fandtes og altså uden mulighed for at være farvet af den.

Reglen bagefter: et prædikat, der afviser noget på facitlisten, er en FEJL i
taggene — aldrig en anledning til at rette listen.

  python3 tools/ground_truth.py   →  docs/design/taxonomy-ground-truth.json
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "docs" / "design" / "taxonomy-ground-truth.json"


def main() -> int:
    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    combos = json.loads((CONTENT / "combos.json").read_text(encoding="utf-8"))
    challenges = json.loads((CONTENT / "challenges.json").read_text(encoding="utf-8"))
    acts = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((CONTENT / "acts").glob("*.json"))]

    by_id = {e["id"]: e for e in elements}
    cases: list[dict] = []

    # Problemer: alt med `solves` er et bekræftet positivt eksempel.
    solves: dict[str, set[str]] = {}
    for combo in combos:
        if combo.get("solves"):
            solves.setdefault(combo["solves"], set()).add(combo["result"])
    problems = {p["id"]: p for act in acts for p in act.get("problems", [])}
    for pid, results in sorted(solves.items()):
        cases.append({
            "need": pid,
            "type": "problem",
            "name": problems.get(pid, {}).get("name", pid),
            "must_accept": sorted(results),
            "must_accept_names": sorted(by_id[r]["name"] for r in results),
        })

    # Challenges: solvedBy er listen i sin reneste form.
    for ch in challenges:
        cases.append({
            "need": ch["id"],
            "type": "challenge",
            "name": ch["title"],
            "must_accept": sorted(ch["solvedBy"]),
            "must_accept_names": sorted(by_id[s]["name"] for s in ch["solvedBy"] if s in by_id),
        })

    # Starthånden skal AFVISES af ethvert nøde-prædikat: alle nuværende
    # løsninger er fremstillede, så en base-hånd der løser noget ville betyde,
    # at spillet kunne klares i tur 1.
    base = sorted(e["id"] for e in elements if e.get("base") and e["act"] == 1)

    payload = {
        "_kommentar": (
            "Facitliste udledt af håndskrevet indhold — se tools/ground_truth.py. "
            "must_accept: prædikatet SKAL acceptere alle. must_reject_all: intet "
            "nøde-prædikat må acceptere nogen af disse."
        ),
        "generated_from": {"combos": len(combos), "challenges": len(challenges), "elements": len(elements)},
        "must_reject_all": base,
        "must_reject_all_names": sorted(by_id[b]["name"] for b in base),
        "cases": cases,
        "label_count": sum(len(c["must_accept"]) for c in cases) + len(base),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"→ {OUT.relative_to(ROOT)}")
    print(f"  {len(cases)} nøder, {payload['label_count']} mærkede eksempler")
    for c in cases:
        print(f"    {c['type']:9} {c['need']:10} {len(c['must_accept']):2} løsninger")
    print(f"  starthånd der skal afvises: {len(base)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
