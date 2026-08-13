#!/usr/bin/env python3
"""Fletter skribenternes par-udkast til én indholdsfil.

Kører den samme kontrol som skribenterne selv kørte (tools/check_pairs.py) —
tillid er ikke en kontrol — og skriver derefter content/narrator/pairs-act-1.json.

Formatet er valgt så motoren kan slå op i ét hop og ellers behandle replikken
som enhver anden: `pairs` er listen af nøgler "<pairKey>:<dom>" der har en bagt
replik, og `lines` er almindelige fortæller-replikker som narrator.line() kan
finde. Replik-id'et står kun ét sted (på replikken) og udledes af nøglen — se
`pairLineId()` i src/narrator/pairs.ts. Skrev vi det ud ved siden af hver nøgle
også, kostede de 400 gentagelser mere gzip end CON-003 tillader.

Nøglen indeholder dommen, fordi målingen viste at 106 af de 250 hyppigste par
skifter dom mellem gennemspilninger — samme par mødes i forskellige
spiltilstande. En bagt replik der siger "du var tæt på" ville være løgn de
gange sandheden er "det var absurd". Bages kun den dominerende dom; resten
falder igennem til grammatikken, som altid har ret.

Køres normalt uden argumenter og skriver det rigtige indhold, som før.

## Reproducerbarhed (2026-08-13)

Samme princip som tools/assemble_grammar.py: drafts under
content/narrator/drafts/pairs-*.json er facittet content/narrator/pairs-act-1.json
er udledt af, og skal derfor altid kunne gensamles til BYTE-FOR-BYTE samme
fil. `--out <sti>` skriver i stedet til en midlertidig sti uden at røre det
rigtige indhold, så tools/voice/check_pairs_assembly.py kan bevise
reproducerbarheden — og judge.py's gate() kan gøre det samme hver gang den
kører — uden en destruktiv kørsel i eget bo.

    python3 tools/assemble_pairs.py                    # skriver rigtigt indhold
    python3 tools/assemble_pairs.py --out sti/til/fil   # tør kørsel, rører intet
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "content" / "narrator" / "drafts"
JOBS = DRAFTS / "briefs" / "_jobs.json"
OUT = ROOT / "content" / "narrator" / "pairs-act-1.json"
BATCHES = [
    "top-a", "top-b", "mid-a", "mid-b", "mid-c", "mid-d",
    "runde2-a", "runde2-b", "runde2-c", "runde2-d",
    "runde3-a",
]


def line_id(key: str, verdict: str) -> str:
    return "pair-" + key.replace("+", "-") + "-" + verdict


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT,
                    help="skriv hertil i stedet for det rigtige indhold (tør kørsel)")
    args = ap.parse_args(argv)

    jobs = {j["key"]: j for j in json.loads(JOBS.read_text())["jobs"]}
    pairs: list[str] = []
    lines: list[dict] = []
    missing: list[str] = []
    seen: set[str] = set()

    for batch in BATCHES:
        path = DRAFTS / f"pairs-{batch}.json"
        if not path.exists():
            missing.append(batch)
            continue
        check = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "check_pairs.py"), str(path)],
            capture_output=True, text=True)
        if check.returncode != 0:
            print(check.stdout)
            print(f"❌ {batch} består ikke check_pairs.py — flettes ikke.")
            return 1
        for entry in json.loads(path.read_text())["pairs"]:
            key = entry["key"]
            if key in seen:
                print(f"❌ {key} findes i to batches")
                return 1
            seen.add(key)
            lookup = f"{key}:{entry['verdict']}"
            lid = line_id(key, entry["verdict"])
            pairs.append(lookup)
            lines.append({"id": lid, "variants": entry["variants"]})

    if missing:
        print(f"⚠️  mangler batches: {', '.join(missing)}")
    unwritten = [k for k in jobs if k not in seen]
    if unwritten and not missing:
        print(f"⚠️  {len(unwritten)} par i _jobs.json har ingen replik: "
              f"{', '.join(unwritten[:5])}")

    args.out.write_text(json.dumps(
        {"act": 1, "pairs": pairs, "lines": lines}, ensure_ascii=False, indent=2) + "\n")
    n = sum(len(l["variants"]) for l in lines)
    print(f"✅ {args.out.name}: {len(pairs)} opslag, {n} replikker")
    return 0


if __name__ == "__main__":
    sys.exit(main())
