#!/usr/bin/env python3
"""Indholdsvalidering for Kolde Karl (PRD §5).

Fanger: forældreløse elementer, uopnåelige opdagelser og problemer,
duplikerede kombinationer, manglende fortæller-replikker og manglende
flavor/noter/kilder — så en skribent kan tilføje indhold uden at røre kode
og få fejlene at vide med det samme.

Kørsel: python3 tools/validate.py  (exit 0 = grøn, 1 = fejl)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"{path.relative_to(ROOT)}: ugyldig JSON — {e}")
        return None


def main() -> int:
    elements = load(CONTENT / "elements.json") or []
    combos = load(CONTENT / "combos.json") or []
    acts = [a for p in sorted((CONTENT / "acts").glob("*.json")) if (a := load(p))]
    narrator = [n for p in sorted((CONTENT / "narrator").glob("*.json")) if (n := load(p))]

    element_ids = {e["id"] for e in elements}
    if len(element_ids) != len(elements):
        seen: set[str] = set()
        for e in elements:
            if e["id"] in seen:
                err(f"Duplikeret element-id: {e['id']}")
            seen.add(e["id"])

    # --- Kombinationer refererer eksisterende elementer, ingen dubletter ---
    combo_keys: dict[tuple, str] = {}
    for c in combos:
        a, b = c["pair"]
        for ref in (a, b, c["result"]):
            if ref not in element_ids:
                err(f"Kombination {a}+{b}: ukendt element '{ref}'")
        key = (
            tuple(sorted((a, b))),
            tuple(sorted(c.get("requiresFlags", []))),
            tuple(sorted(c.get("blockedByFlags", []))),
        )
        if key in combo_keys:
            err(f"Duplikeret kombination: {a}+{b} (samme flag-betingelser)")
        combo_keys[key] = c["result"]

    # --- Opnåelighed: simulér spillet til fixpoint (optimistisk ift. blockedByFlags) ---
    act_numbers = sorted(a["act"] for a in acts)
    unlocked_acts = {act_numbers[0]} if act_numbers else set()
    discovered = {e["id"] for e in elements if e.get("base") and e["act"] in unlocked_acts}
    flags: set[str] = set()
    changed = True
    while changed:
        changed = False
        for c in combos:
            a, b = c["pair"]
            if c["result"] in discovered:
                continue
            if a in discovered and b in discovered and set(c.get("requiresFlags", [])) <= flags:
                discovered.add(c["result"])
                flags |= set(c.get("setsFlags", []))
                if c.get("ageUp"):
                    nxt = min((n for n in act_numbers if n not in unlocked_acts), default=None)
                    if nxt is not None:
                        unlocked_acts.add(nxt)
                        discovered |= {
                            e["id"] for e in elements if e.get("base") and e["act"] == nxt
                        }
                changed = True

    produced = {c["result"] for c in combos}
    for e in elements:
        if e.get("base"):
            continue
        if e["id"] not in produced:
            err(f"Forældreløst element (ingen kombination skaber det): {e['id']}")
        elif e["id"] not in discovered:
            err(f"Uopnåeligt element (kan aldrig nås fra base-elementerne): {e['id']}")

    # --- Akter: problemer kan løses, age-up findes og kan nås ---
    solves = {c.get("solves") for c in combos if c.get("solves")}
    reachable_solves = {
        c["solves"]
        for c in combos
        if c.get("solves") and c["result"] in discovered
    }
    for act in acts:
        for p in act.get("problems", []):
            if p["id"] not in solves:
                err(f"Akt {act['act']}: problemet '{p['id']}' kan ikke løses af nogen kombination")
            elif p["id"] not in reachable_solves:
                err(f"Akt {act['act']}: løsningen på '{p['id']}' er uopnåelig")

    age_up_combos = [c for c in combos if c.get("ageUp")]
    non_final_acts = act_numbers[:-1]
    if len(age_up_combos) < len(non_final_acts):
        warn(
            f"{len(non_final_acts)} akt(er) skal bruge age-up, men kun "
            f"{len(age_up_combos)} age-up-kombination(er) findes"
        )
    for c in age_up_combos:
        if c["result"] not in discovered:
            err(f"Age-up-kombinationen {c['pair'][0]}+{c['pair'][1]} er uopnåelig")

    # --- Fortæller: alle replik-referencer findes, puljer er store nok ---
    # Replik-id'er skal være globalt unikke (spillet slår op på tværs af akter)
    all_line_ids: set[str] = set()
    for n in narrator:
        for l in n["lines"]:
            if l["id"] in all_line_ids:
                err(f"Duplikeret replik-id på tværs af akter: {l['id']}")
            all_line_ids.add(l["id"])

    narrator_by_act = {n["act"]: n for n in narrator}
    for act in acts:
        n = narrator_by_act.get(act["act"])
        if not n:
            err(f"Akt {act['act']}: intet fortæller-indhold (content/narrator/)")
            continue
        line_ids = {l["id"] for l in n["lines"]}

        def check_ref(ref: str | None, ctx: str) -> None:
            if ref and ref not in line_ids:
                err(f"Akt {act['act']}: {ctx} refererer ukendt replik '{ref}'")

        check_ref(act.get("introLine"), "introLine")
        check_ref(act.get("gateLine"), "gateLine")
        check_ref(act.get("ageUpLine"), "ageUpLine")
        for p in act.get("problems", []):
            for h in p.get("hints", []):
                check_ref(h, f"problemet '{p['id']}'s hints")
            if p.get("required") and not p.get("hints"):
                warn(f"Akt {act['act']}: obligatorisk problem '{p['id']}' har ingen hint-eskalering")

        b = n["behavior"]
        if b["spamElement"] not in element_ids:
            err(f"Akt {act['act']}: spamElement '{b['spamElement']}' er ikke et element")
        for pool_name in ("spam", "repeatCombo", "failStreak"):
            for threshold, ref in b.get(pool_name, {}).items():
                if not threshold.isdigit():
                    err(f"Akt {act['act']}: {pool_name}-tærskel '{threshold}' er ikke et tal")
                check_ref(ref, f"behavior.{pool_name}[{threshold}]")
        for ref in n.get("flagMemory", []):
            check_ref(ref, "flagMemory")
        generic = n.get("genericFailure", [])
        for ref in generic:
            check_ref(ref, "genericFailure")
        if len(generic) < 2:
            err(f"Akt {act['act']}: genericFailure-puljen skal have mindst 2 replikker (no-repeat-reglen)")

    # Nøglebeats uden replik (PRD §5: manglende replikker på nøglebeats)
    for c in combos:
        if (c.get("solves") or c.get("ageUp")) and not c.get("narratorLine"):
            act = next((a for a in acts if any(e["id"] == c["result"] and e["act"] == a["act"] for e in elements)), None)
            if c.get("ageUp") and act and act.get("ageUpLine"):
                continue  # age-up-banneret har sin egen replik
            warn(f"Nøglekombination {c['pair'][0]}+{c['pair'][1]} har ingen fortæller-replik")

    # --- Flavor, historiske noter og kildekrav (PRD §3.2 + §5) ---
    for e in elements:
        if not e.get("flavor"):
            warn(f"Element '{e['id']}' mangler flavor-tekst")
        if not e.get("base"):
            if not e.get("note"):
                err(f"Opdagelsen '{e['id']}' mangler historisk note")
            elif not e.get("sourceUrl"):
                err(f"Opdagelsen '{e['id']}' har en note uden kilde-URL")

    # --- Flags der kræves men aldrig sættes ---
    set_flags = {f for c in combos for f in c.get("setsFlags", [])}
    for c in combos:
        for f in c.get("requiresFlags", []):
            if f not in set_flags:
                err(f"Kombination {c['pair'][0]}+{c['pair'][1]} kræver flag '{f}', som aldrig sættes")

    for w in warnings:
        print(f"⚠️  {w}")
    for e_ in errors:
        print(f"❌ {e_}")
    if errors:
        print(f"\nValidering FEJLEDE: {len(errors)} fejl, {len(warnings)} advarsler")
        return 1
    print(f"\n✅ Indhold valideret: {len(elements)} elementer, {len(combos)} kombinationer, "
          f"{len(acts)} akter — {len(warnings)} advarsler")
    return 0


if __name__ == "__main__":
    sys.exit(main())
