#!/usr/bin/env python3
"""Samler skribent-agenternes grammatik-filer til ét indholdsdokument.

Hver agent skrev sin egen dom i sin egen fil. Denne samler fletter dem,
tjekker det som en menneskelig redaktør ville tjekke — dubletter, ukendte
pladsholdere, "a grass"-konstruktioner, sammensatte {shared}-værdier midt i
en sætning — og skriver content/narrator/grammar-act-1.json.

Køres én gang; filen den skriver er derefter almindeligt indhold.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "content" / "narrator" / "drafts"
OUT = Path(__file__).resolve().parent.parent / "content" / "narrator" / "grammar-act-1.json"

VERDICTS = ["locked", "near-miss", "self", "inert", "clash", "plausible", "absurd"]
PLACEHOLDERS = {"a", "b", "partner", "result", "shared", "trait", "trait2", "deadEnd", "right", "wrong"}

# Hvilken dom en regel hører til, når agenten ikke selv skrev det i filen.
BY_PREFIX = {
    "g-nm-": "near-miss",
    "g-clash-": "clash",
    "g-self-": "self",
    "g-plaus-": "plausible",
    "g-abs-": "absurd",
    "g-inert-": "inert",
    "g-locked-": "locked",
}

problems: list[str] = []


def verdict_of(rule: dict) -> str | None:
    if rule.get("verdict") in VERDICTS:
        return rule["verdict"]
    for prefix, v in BY_PREFIX.items():
        if rule["id"].startswith(prefix):
            return v
    return None


def main() -> int:
    files = sorted(SRC.glob("grammar-*.json"))
    if not files:
        print(f"Ingen grammar-*.json i {SRC} — kørte agenterne færdigt?")
        return 1

    rules: list[dict] = []
    seen: set[str] = set()
    for f in files:
        data = json.loads(f.read_text())
        for rule in data.get("rules", []):
            if rule["id"] in seen:
                problems.append(f"{f.name}: duplikeret id {rule['id']}")
                continue
            seen.add(rule["id"])
            rules.append(rule)
        print(f"  {f.name}: {len(data.get('rules', []))} grupper")

    pools: dict[str, list[str]] = {v: [] for v in VERDICTS}
    lines: list[dict] = []
    for rule in rules:
        v = verdict_of(rule)
        if v is None:
            problems.append(f"{rule['id']}: kan ikke placeres under en dom")
            continue
        variants = [re.sub(r"\s+", " ", t).strip() for t in rule["variants"]]
        if len(variants) < 4:
            problems.append(f"{rule['id']}: kun {len(variants)} varianter (kræver 4)")
        for t in variants:
            for ph in re.findall(r"\{([a-zA-Z]+)\}", t):
                if ph not in PLACEHOLDERS:
                    problems.append(f"{rule['id']}: ukendt pladsholder {{{ph}}}")
            # Hele ombygningen findes for at afskaffe "Nothing happens".
            # Fortælleren må ikke smugle den ind igen som en vending.
            if re.search(r"\bnothing (happen|came|occurr)", t, re.I):
                problems.append(f"{rule['id']}: siger 'nothing happened' — det er "
                                f"præcis den replik grammatikken erstatter")
            if re.search(r"\ba \{(a|b|partner|result|deadEnd|right|wrong)\}", t):
                problems.append(f"{rule['id']}: 'a {{...}}' → kan blive 'a grass'")
            # {shared} kan rendere som "tool+material" og kan derfor ikke stå
            # midt i en almindelig sætning uden en ramme omkring sig.
            if "{shared}" in t and not re.search(r"[\"'(\u2014:,]\s*\{shared\}|\{shared\}\s*[\"')\u2014.,]", t):
                problems.append(f"{rule['id']}: {{shared}} står bart i sætningen")
        # {right}/{wrong}/{deadEnd} ER elementnavne — de peger bare præcist i
        # stedet for at gentage parret. En replik der bruger dem er ikke
        # generisk, og må ikke tvinges til at sige {a} og {b} oveni.
        NAMES = ("{a}", "{b}", "{right}", "{wrong}", "{deadEnd}")
        named = sum(1 for t in variants if any(n in t for n in NAMES))
        if named < len(variants) - 1:
            problems.append(
                f"{rule['id']}: {len(variants) - named} varianter nævner hverken {{a}} eller {{b}}"
            )
        pools[v].append(rule["id"])
        lines.append({"id": rule["id"], "variants": variants})

    for v in VERDICTS:
        if len(pools[v]) < 2:
            problems.append(f"dommen '{v}' har kun {len(pools[v])} regler")

    if problems:
        print(f"\n{len(problems)} problemer:")
        for p in problems[:40]:
            print(f"  ✗ {p}")
        return 1

    OUT.write_text(
        json.dumps(
            {"act": 1, "grammar": pools, "lines": lines}, indent=2, ensure_ascii=False
        )
        + "\n"
    )
    total = sum(len(l["variants"]) for l in lines)
    print(f"\n✅ {OUT.name}: {len(lines)} grupper, {total} varianter")
    for v in VERDICTS:
        print(f"   {v:>10}: {len(pools[v])} grupper")
    return 0


if __name__ == "__main__":
    sys.exit(main())
