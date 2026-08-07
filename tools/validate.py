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


def _combo_in_act(combo, act, elements) -> bool:
    """En kombination hører til den akt dens resultat-element ligger i."""
    return any(e["id"] == combo["result"] and e["act"] == act["act"] for e in elements)


def main() -> int:
    elements = load(CONTENT / "elements.json") or []
    combos = load(CONTENT / "combos.json") or []
    acts = [a for p in sorted((CONTENT / "acts").glob("*.json")) if (a := load(p))]
    narrator = [n for p in sorted((CONTENT / "narrator").glob("*.json")) if (n := load(p))]
    endings = load(CONTENT / "endings.json") or []
    config = load(CONTENT / "config.json") or {}

    element_ids = {e["id"] for e in elements}
    if len(element_ids) != len(elements):
        seen: set[str] = set()
        for e in elements:
            if e["id"] in seen:
                err(f"Duplikeret element-id: {e['id']}")
            seen.add(e["id"])

    # Ikoner skal være unikke — to ens ikoner i griddet er ulæseligt (docs/design/ui-mobile.md)
    by_emoji: dict[str, list[str]] = {}
    for e in elements:
        by_emoji.setdefault(e["emoji"], []).append(e["name"])
    for emoji, names in by_emoji.items():
        if len(names) > 1:
            err(f"Ikonet {emoji} bruges af flere elementer: {', '.join(names)}")

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
        if c.get("spor") not in (None, "hoved", "komisk"):
            err(f"Kombination {a}+{b}: ugyldigt spor '{c['spor']}' (tilladt: hoved, komisk)")

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
            variants = l.get("variants")
            if not isinstance(variants, list) or not variants:
                err(f"Replik '{l['id']}': mangler variants-liste (mindst 1 tekst)")

    narrator_by_act = {n["act"]: n for n in narrator}
    for act in acts:
        n = narrator_by_act.get(act["act"])
        if not n:
            err(f"Akt {act['act']}: intet fortæller-indhold (content/narrator/)")
            continue
        lines_by_id = {l["id"]: l for l in n["lines"]}

        def check_ref(ref: str | None, ctx: str, min_variants: int = 1) -> None:
            if not ref:
                return
            if ref not in lines_by_id:
                err(f"Akt {act['act']}: {ctx} refererer ukendt replik '{ref}'")
                return
            count = len(lines_by_id[ref].get("variants", []))
            if count < min_variants:
                err(
                    f"Akt {act['act']}: '{ref}' ({ctx}) har {count} varianter — "
                    f"kræver mindst {min_variants} (replayability, docs/design/fortaelleren.md)"
                )

        # Nøglebeats kræver mindst 5 varianter, så hvert playthrough lyder nyt
        act_has_combos = any(True for c in combos if _combo_in_act(c, act, elements))
        key_min = 5 if act_has_combos else 1
        check_ref(act.get("introLine"), "introLine", key_min)
        check_ref(act.get("gateLine"), "gateLine", key_min)
        check_ref(act.get("ageUpLine"), "ageUpLine", key_min)
        check_ref(n.get("resumeLine"), "resumeLine")
        # En opdagelse må aldrig møde tavshed: kun få kombinationer har en
        # håndskrevet replik, så fallback-puljen bærer resten af spillet.
        fallback = n.get("discoveryFallback") or []
        if not fallback and act_has_combos:
            err(f"Akt {act['act']}: mangler discoveryFallback — opdagelser uden "
                f"håndskrevet replik ville møde tavshed")
        elif fallback and len(fallback) < 8:
            warn(f"Akt {act['act']}: kun {len(fallback)} generiske opdagelses-replikker "
                 f"— spilleren hører dem ofte, sigt efter mindst 8")
        for ref in fallback:
            check_ref(ref, "discoveryFallback", key_min)
        # Afværget skæbne er et nøglebeat: spilleren rammer den tidligt og ofte
        check_ref(n.get("deflectedEndingLine"), "deflectedEndingLine", key_min)
        for p in act.get("problems", []):
            for h in p.get("hints", []):
                check_ref(h, f"problemet '{p['id']}'s hints")
            if p.get("required") and not p.get("hints"):
                warn(f"Akt {act['act']}: obligatorisk problem '{p['id']}' har ingen hint-eskalering")

        for c in combos:
            if c.get("narratorLine") and _combo_in_act(c, act, elements):
                check_ref(c["narratorLine"], f"kombinationen {c['pair'][0]}+{c['pair'][1]}", 5)

        b = n["behavior"]
        if b["spamElement"] not in element_ids:
            err(f"Akt {act['act']}: spamElement '{b['spamElement']}' er ikke et element")
        for pool_name in ("spam", "repeatCombo", "failStreak", "fast", "elementSweep"):
            for threshold, ref in b.get(pool_name, {}).items():
                if not threshold.isdigit():
                    err(f"Akt {act['act']}: {pool_name}-tærskel '{threshold}' er ikke et tal")
                check_ref(ref, f"behavior.{pool_name}[{threshold}]", 2)
        for ref in b.get("slow", []):
            check_ref(ref, "behavior.slow", 2)
        for ref in n.get("flagMemory", []):
            check_ref(ref, "flagMemory")
        generic = n.get("genericFailure", [])
        for ref in generic:
            check_ref(ref, "genericFailure")
        if len(generic) < 2:
            err(f"Akt {act['act']}: genericFailure-puljen skal have mindst 2 replikker (no-repeat-reglen)")
        if any(True for c in combos if _combo_in_act(c, act, elements)) and len(generic) < 6:
            warn(f"Akt {act['act']}: kun {len(generic)} generiske fiasko-replikker — 6+ anbefales for varietet")

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

    # --- Slutninger: referencer, replikker og turn-limit ---
    ending_ids = {e["id"] for e in endings}
    if len(ending_ids) != len(endings):
        err("Duplikerede slutnings-id'er i endings.json")
    all_lines_by_id = {l["id"]: l for n in narrator for l in n["lines"]}
    for e in endings:
        line = all_lines_by_id.get(e["line"])
        if not line:
            err(f"Slutningen '{e['id']}' refererer ukendt replik '{e['line']}'")
        elif len(line.get("variants", [])) < 3:
            err(f"Slutningen '{e['id']}': replikken '{e['line']}' skal have mindst 3 varianter")
        if not e.get("achievement"):
            err(f"Slutningen '{e['id']}' mangler achievement-titel")
        if e.get("tone") not in ("happy", "tragic", "mad", "bittersweet", "komisk"):
            err(f"Slutningen '{e['id']}': ugyldig tone '{e.get('tone')}'")
    autos = [e for e in endings if e.get("automatic")]
    if len(autos) != 1:
        err(f"Der skal være præcis én automatisk slutning (alderdom) — fandt {len(autos)}")
    triggered = set()
    for c in combos:
        if "ending" in c:
            if c["ending"] not in ending_ids:
                err(f"Kombination {c['pair'][0]}+{c['pair'][1]}: ukendt slutning '{c['ending']}'")
            triggered.add(c["ending"])
        if "cost" in c and (not isinstance(c["cost"], int) or c["cost"] < 1):
            err(f"Kombination {c['pair'][0]}+{c['pair'][1]}: cost skal være et heltal ≥ 1")
    for e in endings:
        if not e.get("automatic") and e["id"] not in triggered:
            err(f"Slutningen '{e['id']}' udløses aldrig af nogen kombination")
    turn_limit = config.get("turnLimit")
    unlock_at = config.get("endingsUnlockAt")
    if not isinstance(unlock_at, int) or unlock_at < 0:
        err(f"config.endingsUnlockAt skal være et heltal ≥ 0 (er {unlock_at!r})")
        unlock_at = 0
    elif isinstance(turn_limit, int) and unlock_at > turn_limit * 0.6:
        warn(
            f"config.endingsUnlockAt ({unlock_at}) er over 60 % af turn-limit "
            f"({turn_limit}) — spilleren når knap at bruge sine skæbner"
        )
    if not isinstance(turn_limit, int) or turn_limit < 10:
        err(f"config.turnLimit skal være et heltal ≥ 10 (er {turn_limit!r})")
    else:
        # Billigste vej til hvert element: mængden af kombinationer der skal
        # laves (delmål deles, derfor mængder frem for summer). Fixpunkt-
        # iteration — grafen er lille nok til at det er øjeblikkeligt.
        recipe_set: dict[str, frozenset[int]] = {
            e["id"]: frozenset() for e in elements if e.get("base")
        }

        def cost_of(s: frozenset[int]) -> int:
            return sum(combos[i].get("cost", 1) for i in s)

        changed = True
        while changed:
            changed = False
            for i, c in enumerate(combos):
                a, b = c["pair"]
                if a not in recipe_set or b not in recipe_set:
                    continue
                need = recipe_set[a] | recipe_set[b] | {i}
                current = recipe_set.get(c["result"])
                if current is None or cost_of(need) < cost_of(current):
                    recipe_set[c["result"]] = need
                    changed = True

        for e in endings:
            if e.get("automatic"):
                continue
            triggers = [c for c in combos if c.get("ending") == e["id"]]
            costs = [cost_of(recipe_set[c["result"]]) for c in triggers
                     if c["result"] in recipe_set]
            if not costs:
                continue  # allerede fanget som uudløst ovenfor
            # Skæbner er desuden gated på antal opdagelser; hver opdagelse
            # koster mindst én sommer, så gaten er en reel nedre grænse.
            cheapest = max(min(costs), unlock_at)
            if cheapest > turn_limit:
                err(
                    f"Slutningen '{e['id']}' kræver mindst {cheapest} somre, "
                    f"men et run varer kun {turn_limit} — den kan aldrig nås"
                )
            elif cheapest > turn_limit * 0.8:
                warn(
                    f"Slutningen '{e['id']}' kræver {cheapest}/{turn_limit} somre "
                    f"selv med perfekt spil — meget stram"
                )

        main_track_cost = sum(
            c.get("cost", 1) for c in combos
            if c.get("solves") or c.get("ageUp")
        )
        if main_track_cost > turn_limit:
            warn(f"Hovedsporets samlede cost ({main_track_cost}) overstiger turn-limit ({turn_limit})")

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
