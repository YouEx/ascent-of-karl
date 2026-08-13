#!/usr/bin/env python3
"""Tjekker et udkast med bagte par-replikker, før det bliver til indhold.

Kaldes af skribenterne selv (`python3 tools/check_pairs.py <fil>`), og igen af
tools/assemble_pairs.py når alt flettes. Den fanger det en skribent ikke kan
se alene: at navnet mangler, at dommen ikke passer, at replikken kunne stå om
hvilket som helst andet par.

Kernen (`check_pairs_data`/`check_pairs_file`) er importerbar, så
tools/voice/judge.py's `gate()` kan sammensætte DEN SAMME par-kontrakt-kontrol
i stedet for blot at stole på at et menneske huskede at køre denne fil separat
(TASK-030, politik 2026-08-13) — se gate()'s docstring. main() er uændret en
tynd CLI-indpakning: samme argumenter, samme udskrift, samme returkode.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "content" / "narrator" / "drafts" / "briefs" / "_jobs.json"
ELEMENTS = ROOT / "content" / "elements.json"

BANNED = [
    (r"\bnothing (happen|came|occurr|result)", "siger 'nothing happened' — det er præcis den replik bagningen erstatter"),
    (r"\bno reaction\b", "lyder som en fejlmeddelelse"),
    (r"\bdoes ?n.t work\b", "lyder som en fejlmeddelelse"),
    (r"!", "udråbstegn — fortælleren hæver aldrig stemmen"),
    # {right}/{wrong}/{partner} er tilladt ved near-miss og håndteres for sig nedenfor.
    (r"\{(?!right\}|wrong\}|partner\})[a-zA-Z]+\}", "pladsholder — bagte replikker skriver navnene ud"),
]

PLURALS = {
    "grubs", "berries", "sparks", "planks", "seeds", "visions", "wings",
    "skis", "boules", "roasted grubs", "smoke signals", "sewn clothes",
}
SINGULAR_VERB = r"\b(is|was|has|does|doesn't|goes|seems|wants|needs|gets|sits|comes|makes|belongs|remains|stands)\b"


def load_jobs() -> dict[str, Any]:
    return {j["key"]: j for j in json.loads(JOBS.read_text())["jobs"]}


def load_names() -> dict[str, str]:
    return {e["id"]: e["name"].lower() for e in json.loads(ELEMENTS.read_text())}


def check_pairs_data(data: dict[str, Any], *, jobs: dict[str, Any] | None = None,
                      names: dict[str, str] | None = None) -> list[str]:
    """Ren kerne: samme kontrol som skribenten kører manuelt, men på allerede
    indlæst JSON i stedet for en filsti, og returnerer problemlisten i stedet
    for at printe/exitte — det importerbare indgangspunkt for gate.py. `jobs`/
    `names` kan sendes med af kaldere der tjekker mange batches efter hinanden
    (gate.py's 10 udkast), så _jobs.json/elements.json kun læses én gang."""
    if jobs is None:
        jobs = load_jobs()
    if names is None:
        names = load_names()

    problems: list[str] = []
    seen: set[str] = set()
    all_variants: dict[str, str] = {}

    for entry in data.get("pairs", []):
        key = entry.get("key", "?")
        job = jobs.get(key)
        if job is None:
            problems.append(f"{key}: står ikke i _jobs.json — forkert nøgle?")
            continue
        if key in seen:
            problems.append(f"{key}: nævnt to gange")
        seen.add(key)
        if entry.get("verdict") != job["verdict"]:
            problems.append(
                f"{key}: dom '{entry.get('verdict')}' matcher ikke briefens '{job['verdict']}'")
        variants = entry.get("variants", [])
        if len(variants) != job["variants"]:
            problems.append(f"{key}: {len(variants)} varianter, briefen bad om {job['variants']}")
        a_name, b_name = names[job["a"]], names[job["b"]]
        near = job["verdict"] == "near-miss"
        for v in variants:
            low = v.lower()
            for pattern, why in BANNED:
                if re.search(pattern, v, re.I):
                    problems.append(f"{key}: {why} — \"{v[:60]}…\"")
            # Ved near-miss ved motoren hvem af de to der hørte hjemme et andet
            # sted, og grammatikken kan pege på den. Kan den bagte replik ikke
            # det, er den en forringelse frem for en forbedring.
            if near and "{right}" not in v:
                problems.append(
                    f"{key}: near-miss uden {{right}} — den skal kunne pege, "
                    f"ellers er grammatikken bedre — \"{v[:60]}…\"")
            if not near and ("{right}" in v or "{wrong}" in v or "{partner}" in v):
                problems.append(
                    f"{key}: {{right}}/{{wrong}}/{{partner}} findes kun ved near-miss — "
                    f"\"{v[:60]}…\"")
            if a_name not in low:
                problems.append(f"{key}: nævner ikke '{a_name}' — \"{v[:60]}…\"")
            if b_name not in low:
                problems.append(f"{key}: nævner ikke '{b_name}' — \"{v[:60]}…\"")
            for plural in (a_name, b_name):
                if plural not in PLURALS:
                    continue
                after = re.search(re.escape(plural) + r"\s+" + SINGULAR_VERB, low)
                if after:
                    problems.append(
                        f"{key}: '{after.group(0)}' — {plural} er flertal, brug datid "
                        f"eller flertalsform")
            if len(v) > 320:
                problems.append(f"{key}: for lang ({len(v)} tegn, maks ~320)")
            if v != v.strip() or "  " in v:
                problems.append(f"{key}: løs whitespace")
            prev = all_variants.get(low)
            if prev:
                problems.append(f"{key}: identisk variant findes også i {prev}")
            all_variants[low] = key
        # Fire varianter på samme vits er én variant. Groft mål: deler de
        # samme sjældne ord, er de sandsynligvis samme idé.
        if len(variants) >= 3:
            def keywords(t: str) -> set[str]:
                stop = {"the", "and", "a", "of", "to", "it", "is", "was", "in", "he",
                        "his", "karl", "that", "for", "not", "with", "has", "had", "on"}
                return {w for w in re.findall(r"[a-z]{4,}", t.lower())
                        if w not in stop and w not in a_name and w not in b_name}
            sets = [keywords(v) for v in variants]
            for i in range(len(sets)):
                for j in range(i + 1, len(sets)):
                    common = sets[i] & sets[j]
                    if len(common) >= 3:
                        problems.append(
                            f"{key}: variant {i+1} og {j+1} deler {sorted(common)} "
                            f"— skriv en anden vinkel, ikke en omskrivning")

    return problems


def check_pairs_file(path: Path, *, jobs: dict[str, Any] | None = None,
                      names: dict[str, str] | None = None) -> list[str]:
    """Bekvemmelighedswrapper: indlæser filen og uddelegerer til
    check_pairs_data(). Det gate.py rent faktisk kalder pr. udkast-batch."""
    data = json.loads(path.read_text())
    return check_pairs_data(data, jobs=jobs, names=names)


def main() -> int:
    if len(sys.argv) < 2:
        print("brug: python3 tools/check_pairs.py <fil.json>")
        return 2
    path = Path(sys.argv[1])
    data = json.loads(path.read_text())
    problems = check_pairs_data(data)

    if problems:
        print(f"{len(problems)} problemer i {path.name}:")
        for p in problems[:60]:
            print(f"  ✗ {p}")
        return 1
    seen = {e["key"] for e in data.get("pairs", []) if e.get("key")}
    n = sum(len(e.get("variants", [])) for e in data.get("pairs", []))
    print(f"✅ {path.name}: {len(seen)} par, {n} replikker — ingen problemer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
