#!/usr/bin/env python3
"""Genererer facit til paritetstesten mellem Python og TypeScript.

src/core/solves.ts er en håndskrevet tvilling til satisfies() i
tools/predicate_report.py. To implementeringer af samme regel skrider fra
hinanden før eller siden, og skreddet ville være tavst: spillet ville dømme
anderledes end porten, og porten ville stadig sige 0 fejl.

Derfor er Python-siden facit, og tests/fixtures/solves-parity.json er
aftrykket. TypeScript-testen sammenligner sig med aftrykket.

  python3 tools/parity_fixture.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from predicate_report import satisfies  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "solves-parity.json"


def main() -> int:
    elements = json.loads((ROOT / "content" / "elements.json").read_text(encoding="utf-8"))
    raw = json.loads((ROOT / "content" / "predicates.json").read_text(encoding="utf-8"))
    predicates = {k: v for k, v in raw.items() if not k.startswith("_")}

    solves = {
        el["id"]: [nid for nid, pred in predicates.items() if satisfies(el, pred)]
        for el in elements
    }

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(
        json.dumps(
            {
                "_kommentar": (
                    "Genereret af tools/parity_fixture.py ud fra "
                    "tools/predicate_report.py's satisfies(). Facit for tvillingen i "
                    "src/core/solves.ts. Regenerer med: npm run predicates:fixture"
                ),
                "needs": sorted(predicates),
                "solves": solves,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    total = sum(len(v) for v in solves.values())
    print(f"{FIXTURE.relative_to(ROOT)}: {len(solves)} elementer, "
          f"{len(predicates)} nøder, {total} løsninger")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
