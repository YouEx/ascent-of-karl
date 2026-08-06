#!/usr/bin/env python3
"""Genererer story-grafer (Mermaid) fra content — overblik over sporene
og deres sammenfletninger. Køres efter content-ændringer; output committes,
så grafen altid kan ses direkte på GitHub.

  python3 tools/story_graph.py   →  docs/design/act-<N>-graf.md pr. akt
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "docs" / "design"


def mermaid_for_act(act_num: int, elements, combos) -> str:
    ids_in_act = {e["id"] for e in elements if e["act"] == act_num}
    by_id = {e["id"]: e for e in elements}

    lines = ["flowchart LR"]
    used: set[str] = set()
    for c in combos:
        if c["result"] not in ids_in_act:
            continue
        used.add(c["result"])
        used.update(c["pair"])

    for eid in sorted(used):
        e = by_id[eid]
        label = f'{e["emoji"]} {e["name"]}'
        if e.get("base"):
            lines.append(f'  {eid}(["{label}"]):::base')
        else:
            lines.append(f'  {eid}["{label}"]')

    for c in combos:
        if c["result"] not in ids_in_act:
            continue
        a, b = c["pair"]
        marks = []
        if c.get("solves"):
            marks.append(f'løser {c["solves"]}')
        if c.get("ageUp"):
            marks.append("AGE-UP")
        if c.get("ending"):
            marks.append(f'SLUTNING: {c["ending"]}')
        if c.get("cost", 1) > 1:
            marks.append(f'{c["cost"]} somre')
        if c.get("setsFlags"):
            marks.append("flag " + ",".join(c["setsFlags"]))
        label = f'|"{" · ".join(marks)}"|' if marks else ""
        arrow = "-..->" if c.get("spor") == "komisk" else "-->"
        # Selv-kombination: én kant fra elementet til resultatet
        if a == b:
            lines.append(f"  {a} {arrow}{label} {c['result']}")
        else:
            lines.append(f"  {a} {arrow}{label} {c['result']}")
            lines.append(f"  {b} {arrow} {c['result']}")

    for c in combos:
        if c["result"] in ids_in_act and c.get("spor") == "komisk":
            lines.append(f"  class {c['result']} komisk")
    for c in combos:
        if c["result"] in ids_in_act and c.get("ending"):
            lines.append(f"  class {c['result']} ending")
    lines.append("  classDef base fill:#e8dcc0,stroke:#7a5b3a")
    lines.append("  classDef komisk fill:#ffe0b3,stroke:#c2762b,stroke-dasharray: 5 3")
    lines.append("  classDef ending fill:#2b2b2b,stroke:#e0a458,stroke-width:3px,color:#fff")
    return "\n".join(lines)


def main() -> None:
    elements = json.loads((CONTENT / "elements.json").read_text(encoding="utf-8"))
    combos = json.loads((CONTENT / "combos.json").read_text(encoding="utf-8"))
    acts = sorted({e["act"] for e in elements})

    for act_num in acts:
        in_act = [e for e in elements if e["act"] == act_num]
        act_combos = [c for c in combos if any(
            e["id"] == c["result"] and e["act"] == act_num for e in elements)]
        if not act_combos:
            continue
        n_komisk = sum(1 for c in act_combos if c.get("spor") == "komisk")
        doc = f"""# Akt {act_num} — story-graf

*Auto-genereret af `tools/story_graph.py` — redigér ikke i hånden.
Regenerér efter content-ændringer.*

- **{len(in_act)} elementer** ({sum(1 for e in in_act if e.get('base'))} base)
- **{len(act_combos)} kombinationer** ({n_komisk} på komisk spor, vist stiplet)
- Kanter mærket med problem-løsninger, age-up og flags

```mermaid
{mermaid_for_act(act_num, elements, combos)}
```
"""
        out = OUT / f"act-{act_num}-graf.md"
        out.write_text(doc, encoding="utf-8")
        print(f"✓ {out.relative_to(ROOT)} ({len(act_combos)} kombinationer)")


if __name__ == "__main__":
    main()
