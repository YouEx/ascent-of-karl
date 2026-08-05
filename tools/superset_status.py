#!/usr/bin/env python3
"""Status: hvor mange og hvilke opskrifter fra research-supersettet er bygget ind?

Krydsrefererer content/combos.json (via elementernes engelske navne) med
docs/research/superset.csv og skriver docs/research/STATUS.md. Køres efter
content-ændringer; output committes, så status altid er synlig i repoet.

  python3 tools/superset_status.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUPERSET = ROOT / "docs" / "research" / "superset.csv"
OUT = ROOT / "docs" / "research" / "STATUS.md"


def main() -> None:
    elements = json.loads((ROOT / "content" / "elements.json").read_text(encoding="utf-8"))
    combos = json.loads((ROOT / "content" / "combos.json").read_text(encoding="utf-8"))
    name = {e["id"]: e["name"].lower() for e in elements}

    superset: dict[tuple[str, str], dict[str, str]] = {}
    results_in_superset: set[str] = set()
    with SUPERSET.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = tuple(sorted((row["element_a"], row["element_b"])))
            superset[key] = row
            results_in_superset.add(row["result"])

    exact, partial, original = [], [], []
    for c in combos:
        a, b = (name[c["pair"][0]], name[c["pair"][1]])
        r = name[c["result"]]
        key = tuple(sorted((a, b)))
        hit = superset.get(key)
        line = f"`{a} + {b} = {r}`"
        if hit:
            exact.append(f"{line} — matcher `{hit['result']}` ({hit['sources']})")
        elif r in results_in_superset:
            partial.append(f"{line} — resultatet findes i supersettet (anden opskrift)")
        else:
            original.append(line)

    total = len(combos)
    doc = f"""# Superset-status

*Auto-genereret af `tools/superset_status.py` — redigér ikke i hånden.*

Supersettet (`superset.csv`) indeholder **{len(superset)} unikke opskrifter**
fra Little Alchemy 1+2, Infinite Craft og 7 alchemy-kloner
(se `README.md` for metodologi).

## Vores adoption

| Kategori | Antal | Andel af vores {total} kombinationer |
|---|---|---|
| Ingredienspar genfindes i supersettet | {len(exact)} | {len(exact)/total:.0%} |
| Resultatet findes (via anden opskrift) | {len(partial)} | {len(partial)/total:.0%} |
| Helt egne opfindelser | {len(original)} | {len(original)/total:.0%} |

## Ingredienspar genfundet i supersettet

{chr(10).join('- ' + l for l in exact) or '- (ingen)'}

## Resultater der findes i supersettet med andre opskrifter

{chr(10).join('- ' + l for l in partial) or '- (ingen)'}

## Egne opfindelser (ikke i supersettet)

{chr(10).join('- ' + l for l in original) or '- (ingen)'}
"""
    OUT.write_text(doc, encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)}: {len(exact)} par-match, {len(partial)} resultat-match, {len(original)} egne")


if __name__ == "__main__":
    main()
