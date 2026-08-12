#!/usr/bin/env python3
"""Genkalibrerer det frosne ordtal-bånd for bagte par — den ENESTE måde
tools/voice/pairs_baseline.json må ændres på (TASK-030 opfølgning, 2026-08-13).

`pairs_wordcount_band()` i judge.py læser pairs_baseline.json som et frosset
facit i stedet for at genberegne bagte pars ordtal-fordeling fra det aktuelle
indhold hver gang — se den fils egen kommentar for hvorfor. Det betyder at
denne fil aldrig opdaterer sig selv, heller ikke når bagte par-indholdet
ændrer sig legitimt (fx en ny bølge bagte par under en fremtidig TASK). Det er
bevidst: en frossen reference kan opdage skred; en der opdaterer sig selv kan
ikke.

Når et menneske har besluttet at normen reelt skal flytte sig, køres dette
script — aldrig judge.py eller gate.py selv:

    python3 tools/voice/freeze_pairs_baseline.py

Scriptet genberegner ordtal-fordelingen fra det NUVÆRENDE indhold i
content/narrator/pairs-act-1.json, printer før/efter-tallene tydeligt, og
overskriver pairs_baseline.json. Ændringen står derefter i git-diff'en som
enhver anden indholdsændring — aldrig stiltiende.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from judge import expand_pairs  # noqa: E402
from metrics import words_per_line_stats  # noqa: E402

BASELINE_PATH = Path(__file__).resolve().parent / "pairs_baseline.json"


def current_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        return "ukendt (git rev-parse fejlede)"


def main() -> int:
    old = json.loads(BASELINE_PATH.read_text(encoding="utf-8")) if BASELINE_PATH.exists() else None

    pairs = expand_pairs()
    stats = words_per_line_stats([text for _, text in pairs])
    # Mærkat er "pairs:<parNøgle>:<dom>#<variantindeks>" — parNøglen+dom er alt
    # mellem første og sidste ":", variantindekset er efter "#".
    pair_keys = {label.split("#")[0] for label, _ in pairs}

    new = {
        "_kommentar": (old or {}).get("_kommentar", []),
        "version": ((old or {}).get("version", 0)) + 1,
        "frozenAt": date.today().isoformat(),
        "frozenFromCommit": current_commit(),
        "sourcePairCount": len(pair_keys),
        "sourceVariantCount": len(pairs),
        "wordCount": stats,
    }

    if old is not None:
        print(f"Gammelt bånd (v{old.get('version')}, frosset {old.get('frozenAt')}):")
        print(f"  median={old['wordCount']['median']} p90={old['wordCount']['p90']} "
              f"n={old.get('sourceVariantCount')}")
    print(f"Nyt bånd (v{new['version']}, fryses {new['frozenAt']}):")
    print(f"  median={stats['median']} p90={stats['p90']} n={new['sourceVariantCount']}")

    BASELINE_PATH.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n✅ {BASELINE_PATH.relative_to(ROOT)} genskrevet. Se git diff for den fulde ændring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
