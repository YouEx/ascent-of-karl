#!/usr/bin/env python3
"""Indholdsvalidering for The Ascent of Karl (PRD §5).

Fanger: forældreløse elementer, uopnåelige opdagelser og problemer,
duplikerede kombinationer, manglende fortæller-replikker og manglende
flavor/noter/kilder — så en skribent kan tilføje indhold uden at røre kode
og få fejlene at vide med det samme.

Kørsel: python3 tools/validate.py  (exit 0 = grøn, 1 = fejl)
"""

from __future__ import annotations

import json
import re
import sys
import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# satisfies()/compute_depths() er facit-implementeringen fra
# tools/predicate_report.py — genbrugt her frem for dupliceret en tredje gang
# (samme greb som tools/parity_fixture.py), så alsoSolvedBy-advarslen og
# løsningstælleren dømmer med nøjagtig samme regel som porten.
sys.path.insert(0, str(ROOT / "tools"))
from predicate_report import compute_depths, satisfies  # noqa: E402
sys.path.insert(0, str(ROOT / "tools" / "voice"))
import judge as voice_judge  # noqa: E402

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


notes: list[str] = []


def info(msg: str) -> None:
    """Rapport uden dom — vises altid, fejler aldrig."""
    notes.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"{path.relative_to(ROOT)}: ugyldig JSON — {e}")
        return None


def _combo_in_act(combo, act, elements) -> bool:
    """En kombination hører til den akt dens resultat-element ligger i."""
    return any(e["id"] == combo["result"] and e["act"] == act["act"] for e in elements)


def _combo_available(combo: dict, flags: set[str]) -> bool:
    """Samme flagregel som Engine.flagsAllow()."""
    return (
        all(flag in flags for flag in combo.get("requiresFlags", []))
        and all(flag not in flags for flag in combo.get("blockedByFlags", []))
    )


def _locked_is_reachable(combos: list[dict]) -> bool:
    """Kan der findes en flagtilstand hvor ALLE opskrifter for parret er spærret?"""
    if not combos:
        return False
    flag_names = sorted({
        flag
        for combo in combos
        for field in ("requiresFlags", "blockedByFlags")
        for flag in combo.get(field, [])
    })
    for mask in range(1 << len(flag_names)):
        flags = {
            flag
            for index, flag in enumerate(flag_names)
            if mask & (1 << index)
        }
        if not any(_combo_available(combo, flags) for combo in combos):
            return True
    return False


def _baked_lookup_reachable(verdict: str, combos: list[dict]) -> bool:
    """Engine giver kun nofuse uden opskrift; med opskrift kan fiaskoen kun være locked."""
    if verdict == "locked":
        return _locked_is_reachable(combos)
    return not combos


def main() -> int:
    elements = load(CONTENT / "elements.json") or []
    combos = load(CONTENT / "combos.json") or []
    acts = [a for p in sorted((CONTENT / "acts").glob("*.json")) if (a := load(p))]
    # RISK-005: en bagt fiaskoreplik forældes, hvis parret senere får en åben
    # opskrift — så par-nøglen i frozenset-form, kun til den kontrol.
    combos_by_pair_raw: dict[frozenset, list] = {}
    for c in combos:
        pair = c.get("pair")
        if pair and len(pair) == 2:
            combos_by_pair_raw.setdefault(frozenset(pair), []).append(c)
    narrator = [
        n
        for p in sorted((CONTENT / "narrator").glob("*.json"))
        if not p.name.startswith(("grammar-", "pairs-")) and (n := load(p))
    ]
    # Grammatikken og de bagte par-replikker flettes ind i deres akt præcis som
    # src/content.ts og Narrator.attachPairs gør det — ellers ville validatoren
    # se to konkurrerende udgaver af samme akt.
    for p in sorted((CONTENT / "narrator").glob("grammar-*.json")):
        g = load(p)
        if not g:
            continue
        host = next((n for n in narrator if n["act"] == g["act"]), None)
        if host is None:
            err(f"{p.name}: ingen fortæller-fil for akt {g['act']}")
            continue
        host["lines"] = [*host["lines"], *g.get("lines", [])]
        host["grammar"] = g.get("grammar", {})
    for p in sorted((CONTENT / "narrator").glob("pairs-*.json")):
        b = load(p)
        if not b:
            continue
        host = next((n for n in narrator if n["act"] == b["act"]), None)
        if host is None:
            err(f"{p.name}: ingen fortæller-fil for akt {b['act']}")
            continue
        host["lines"] = [*host["lines"], *b.get("lines", [])]
        ids = {line["id"] for line in b.get("lines", [])}
        # Opslaget er kun nøglen "<par>:<dom>"; replikkens id udledes af den.
        # Samme udledning som line_id() i assemble_pairs.py og pairLineId() i
        # src/narrator/pairs.ts — de tre skal følges ad.
        for lookup in b.get("pairs", []):
            key, _, verdict = lookup.rpartition(":")
            derived = "pair-" + key.replace("+", "-") + "-" + verdict
            if derived not in ids:
                err(f"{p.name}: opslaget {lookup} peger på ukendt replik {derived}")
            # RISK-005: præcis samme reachability som Engine.matchCombo +
            # judgePair. Findes en opskrift, kan en fiasko kun være `locked`;
            # er mindst én opskrift tilgængelig i alle flagtilstande, kan selv
            # `locked` aldrig høres.
            a_id, _, b_id = key.partition("+")
            pair_combos = combos_by_pair_raw.get(frozenset((a_id, b_id)), [])
            if not _baked_lookup_reachable(verdict, pair_combos):
                if verdict == "locked" and not pair_combos:
                    why = "parret har ingen opskrift, så dommen locked kan aldrig opstå"
                elif verdict == "locked":
                    why = "mindst én opskrift er tilgængelig i enhver flagtilstand"
                else:
                    why = "parret har en opskrift; fiasko er derfor locked eller slet ingen fiasko"
                err(f"{p.name}: opslaget {lookup} er forældet — {why} (RISK-005)")
        # CON-003: den dovent hentede bagte tekst må fylde 60 KB gzip pr. akt.
        # Grænsen bevogtes her frem for i build-loggen, fordi den kun brydes
        # når nogen bager en ny batch — og det er præcis dér, ingen kigger på
        # chunk-størrelser. Kilden er ~1 KB tungere end den byggede chunk
        # (indrykket JSON vs. Vites modulform), så gaten er en anelse striks.
        # Rammer den: bag færre par, eller find redundans at fjerne som ved
        # opslagslisten — hæv den ikke uden at opdatere CON-003 i planen.
        gz = len(gzip.compress(p.read_bytes(), 9))
        if gz > 60 * 1024:
            err(f"{p.name}: {gz / 1024:.1f} KB gzip — over bundtbudgettet på 60 KB (CON-003)")
    endings = load(CONTENT / "endings.json") or []
    config = load(CONTENT / "config.json") or {}

    element_ids = {e["id"] for e in elements}
    # Opslag for fortællerens `suggests`: rækkefølgen i et par er ligegyldig.
    combo_pairs = {frozenset(c["pair"]) for c in combos if len(c.get("pair", [])) == 2}
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
        # Fiasko-puljen er den mest hørte tekst i spillet: målt til ~15 af de
        # ~29 replikker pr. run. Rotationen cykler gennem ID'er, så antallet
        # af replikker betyder lige så meget som varianterne i hver.
        gf = n.get("genericFailure") or []
        gf_variants = sum(len(lines_by_id[i]["variants"]) for i in gf if i in lines_by_id)
        if act_has_combos:
            if len(gf) < 12:
                warn(f"Akt {act['act']}: kun {len(gf)} generiske fiasko-replikker "
                     f"— spilleren hører ~15 pr. run, sigt efter mindst 12 forskellige")
            if gf_variants < 80:
                warn(f"Akt {act['act']}: fiasko-puljen har {gf_variants} varianter "
                     f"— under 80 begynder gentagelserne at kunne høres")
            info(f"Fiasko-pulje (mest hørte tekst): {len(gf)} replikker, {gf_variants} varianter")
        # Afværget skæbne er et nøglebeat: spilleren rammer den tidligt og ofte
        check_ref(n.get("deflectedEndingLine"), "deflectedEndingLine", key_min)
        for p in act.get("problems", []):
            for h in p.get("hints", []):
                check_ref(h, f"problemet '{p['id']}'s hints")
            if p.get("required") and not p.get("hints"):
                warn(f"Akt {act['act']}: obligatorisk problem '{p['id']}' har ingen hint-eskalering")
            # Trækket høres hver gang historien rykker — det er et nøglebeat.
            check_ref(p.get("pull"), f"problemet '{p['id']}'s pull", key_min)
            if p.get("required") and not p.get("pull") and act_has_combos:
                warn(f"Akt {act['act']}: obligatorisk problem '{p['id']}' har intet pull "
                     f"— fortælleren kan ikke pege på det, og så er der intet at trodse")

        # Trods-replikkerne er ulydighedens betaling. Uden dem er trækket
        # bare en huskeseddel.
        pulled = [p for p in act.get("problems", []) if p.get("required") and p.get("pull")]
        if act_has_combos and pulled and not (n.get("defiance") or {}):
            warn(f"Akt {act['act']}: {len(pulled)} obligatoriske problemer har pull, men akten "
                 f"har ingen defiance-replikker — fortælleren peger uden nogensinde at opdage, "
                 f"at han bliver ignoreret")
        for key, ref in (n.get("defiance") or {}).items():
            if not key.isdigit() or int(key) < 1:
                err(f"Akt {act['act']}: defiance-nøgle '{key}' skal være et positivt heltal")
            check_ref(ref, f"defiance[{key}]", 5)
        for ref in n.get("defianceComic") or []:
            check_ref(ref, "defianceComic", 5)
        if act_has_combos and (n.get("defiance") or {}) and not n.get("defianceComic"):
            warn(f"Akt {act['act']}: ingen defianceComic — de komiske fund er "
                 f"præcis dem, spilleren trodser med, og de fortjener et svar")

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
        # Fortællerens forslag skal PEGE PÅ EN OPSKRIFT DER FINDES. Reglen
        # eksisterer, fordi han engang sendte spilleren efter sten+græs, som
        # ikke er en kombination — vejen er sten+sten og derefter gnister+græs
        # — og bagefter hånede spilleren for at adlyde ham. Et forslag, der
        # ikke kan indfries, er værre end intet forslag.
        suggesting = []
        for ln in n["lines"]:
            for pair in ln.get("suggests") or []:
                if not (isinstance(pair, list) and len(pair) == 2):
                    err(f"Akt {act['act']}: replikken '{ln['id']}' har et suggests-par "
                        f"der ikke er præcis to element-id'er: {pair!r}")
                    continue
                for eid in pair:
                    if eid not in element_ids:
                        err(f"Akt {act['act']}: replikken '{ln['id']}' foreslår '{eid}', "
                            f"som ikke er et element")
                if frozenset(pair) not in combo_pairs:
                    err(f"Akt {act['act']}: replikken '{ln['id']}' foreslår "
                        f"{pair[0]}+{pair[1]}, men den kombination findes ikke. "
                        f"Fortælleren må ikke sende spilleren efter noget, der ikke "
                        f"kan lade sig gøre")
            if ln.get("suggests"):
                suggesting.append(ln["id"])

        obeyed = n.get("obeyedFailure") or []
        for ref in obeyed:
            check_ref(ref, "obeyedFailure")
        if suggesting and not obeyed:
            err(f"Akt {act['act']}: {len(suggesting)} replikker foreslår konkrete "
                f"opskrifter, men akten har ingen obeyedFailure-pulje. Så håner "
                f"fortælleren spilleren for at adlyde ham")

        # --- Grammatikken: fortællerens svar på hvorfor to ting ikke smeltede ---
        grammar = n.get("grammar") or {}
        if grammar:
            VERDICTS = ["locked", "near-miss", "self", "inert", "clash",
                        "plausible", "absurd"]
            PLACEHOLDERS = {"a", "b", "partner", "result", "shared", "trait",
                            "trait2", "deadEnd", "right", "wrong",
                            "element", "act"}
            for v in VERDICTS:
                pool = grammar.get(v) or []
                if not pool:
                    err(f"Akt {act['act']}: dommen '{v}' har ingen replikker. "
                        f"Så falder det par igennem til genericFailure, og hele "
                        f"pointen med grammatikken forsvinder")
                for ref in pool:
                    check_ref(ref, f"grammar[{v}]")
            for key, pool in grammar.items():
                base = key.split(":")[0]
                if base not in VERDICTS:
                    err(f"Akt {act['act']}: grammatik-nøglen '{key}' begynder ikke "
                        f"med en kendt dom")
                if len(pool) < 2:
                    err(f"Akt {act['act']}: grammatik-nøglen '{key}' har kun "
                        f"{len(pool)} regel — no-repeat-reglen kræver mindst 2")
            grammar_ids = {ref for pool in grammar.values() for ref in pool}
            for ln in n["lines"]:
                if ln["id"] not in grammar_ids:
                    continue
                if len(ln.get("variants", [])) < 4:
                    err(f"{ln['id']}: grammatik-replikker skal have mindst 4 "
                        f"varianter — de vises langt oftere end de skrevne")
                for text in ln.get("variants", []):
                    for ph in re.findall(r"\{([a-zA-Z]+)\}", text):
                        if ph not in PLACEHOLDERS:
                            err(f"{ln['id']}: ukendt pladsholder {{{ph}}} — den "
                                f"bliver aldrig udfyldt og lander råt hos spilleren")
                    if re.search(r"\ba \{(a|b|partner|result|deadEnd)\}", text):
                        warn(f"{ln['id']}: 'a {{...}}' bliver til 'a grass' hvis "
                             f"elementet er utælleligt — brug 'the' eller intet")
                    if "{shared}" in text and "+" not in text:
                        pass
                    if text != text.strip() or "  " in text:
                        err(f"{ln['id']}: variant har løs whitespace")

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

    # --- Klassifikation (content/taxonomy.json) ---
    # Prædikaterne dømmer på tags. Et element uden tags kan ikke løse noget,
    # og et element med en stavefejl i en trait holder tavst op med at kunne
    # det. Begge dele skal være hårde fejl, ikke advarsler.
    taxonomy_path = CONTENT / "taxonomy.json"
    if not taxonomy_path.exists():
        err("content/taxonomy.json mangler — tags kan ikke valideres")
    else:
        vocab = load(taxonomy_path)
        for e in elements:
            for key in ("kind", "stuff", "scale"):
                value = e.get(key)
                if value is None:
                    err(f"Element '{e['id']}' mangler {key}")
                elif value not in vocab[key]["values"]:
                    err(f"Element '{e['id']}': {key}='{value}' er uden for ordforrådet")
            traits = e.get("traits")
            if not traits:
                err(f"Element '{e['id']}' har ingen traits")
                continue
            if len(set(traits)) != len(traits):
                err(f"Element '{e['id']}' har gentagne traits")
            for trait in traits:
                if trait not in vocab["traits"]["values"]:
                    err(f"Element '{e['id']}': trait '{trait}' er uden for ordforrådet")
            # Et begreb kan ikke veje noget. Fejlen lukkede engang et regnskab
            # ind som noget der kunne kurere feber.
            if e.get("kind") in ("abstract", "phenomenon"):
                if e.get("stuff") != "none":
                    err(f"Element '{e['id']}' er {e['kind']} men har stuff='{e.get('stuff')}'")
                physical = {"hard", "soft", "sharp", "blunt", "heavy", "fragile", "sticky"}
                bad = sorted(physical & set(traits))
                if bad:
                    warn(f"Element '{e['id']}' er {e['kind']} men har fysiske traits: "
                         f"{', '.join(bad)} — beskriver de tingen eller billedet på den?")

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
    challenges = load(CONTENT / "challenges.json") or []
    challenge_endings = {c["failEnding"] for c in challenges}
    for e in endings:
        if e.get("automatic") or e.get("viaChallenge"):
            continue
        if e["id"] not in triggered:
            err(f"Slutningen '{e['id']}' udløses aldrig af nogen kombination")
    for e in endings:
        if e.get("viaChallenge") and e["id"] not in challenge_endings:
            err(f"Slutningen '{e['id']}' er markeret viaChallenge, men intet challenge bruger den")

    # --- Challenges (docs/design/challenges.md) ---
    # alsoSolvedBy er IKKE facit længere — det er en håndholdt override for de
    # undtagelser, prædikatet (endnu) ikke kan udtrykke (TASK-006). Løsningen
    # afgøres af prædikat ELLER alsoSolvedBy, se resolves() i
    # src/core/challenge.ts. Det historiske facit (alt der nogensinde er
    # bekræftet som en løsning) bor i docs/design/taxonomy-ground-truth.json,
    # som tools/predicate_report.py læser — ikke her.
    predicates_raw = load(CONTENT / "predicates.json") or {}
    predicates = {k: v for k, v in predicates_raw.items() if not k.startswith("_")}
    depths = compute_depths(elements, combos)
    elements_with_depth = {e["id"]: {**e, "depth": depths.get(e["id"], 0)} for e in elements}

    ch_ids: set[str] = set()
    eligible_counts: dict[str, int] = {}
    for c in challenges:
        if c["id"] in ch_ids:
            err(f"Duplikeret challenge-id: {c['id']}")
        ch_ids.add(c["id"])
        for ref in c["alsoSolvedBy"]:
            if ref not in element_ids:
                err(f"Challenge '{c['id']}': ukendt element i alsoSolvedBy: '{ref}'")

        pred = predicates.get(c["id"])
        matched_by_pred = (
            {eid for eid, el in elements_with_depth.items() if satisfies(el, pred)}
            if pred else set()
        )
        eligible = matched_by_pred | set(c["alsoSolvedBy"])
        eligible_counts[c["id"]] = len(eligible)
        # Et challenge man kun kan løse på én måde er en gætteleg, ikke en
        # prøve. Tælleren er de REELLE løsninger — prædikat ELLER override —
        # ikke længden af alsoSolvedBy, som nu typisk er tom.
        if len(eligible) < 5:
            err(f"Challenge '{c['id']}' har kun {len(eligible)} reelle løsninger "
                f"(prædikat ELLER alsoSolvedBy) — kræver mindst 5, ellers er det en gætteleg")
        # Signalet om at en undtagelse er blevet overflødig (TASK-006): en
        # alsoSolvedBy-post, som prædikatet OGSÅ accepterer, trækker ikke
        # længere sin vægt og bør fjernes som undtagelse — ellers vokser
        # listen bare igen, i stedet for at forblive kort.
        redundant = sorted(ref for ref in c["alsoSolvedBy"] if ref in matched_by_pred)
        if redundant:
            warn(
                f"Challenge '{c['id']}': {len(redundant)}/{len(c['alsoSolvedBy'])} "
                f"alsoSolvedBy-elementer matches allerede af prædikatet — bør fjernes som "
                f"undtagelse: {', '.join(redundant)}"
            )
        if c["failEnding"] not in {e["id"] for e in endings}:
            err(f"Challenge '{c['id']}': ukendt failEnding '{c['failEnding']}'")
        if not isinstance(c.get("turns"), int) or c["turns"] < 2:
            err(f"Challenge '{c['id']}': turns skal være et heltal ≥ 2")
        # Replikkerne skal findes og have variation — et challenge er et
        # nøglebeat, man kan møde i mange forskellige runs.
        for ref, what in ((c["line"], "line"), (c["successLine"], "successLine")):
            if ref not in all_line_ids:
                err(f"Challenge '{c['id']}': ukendt replik '{ref}' ({what})")
            else:
                cnt = next(
                    len(l["variants"]) for n2 in narrator for l in n2["lines"] if l["id"] == ref
                )
                if cnt < 5:
                    err(f"Challenge '{c['id']}': '{ref}' har {cnt} varianter — kræver mindst 5")
    if challenges:
        avg = sum(eligible_counts.values()) // max(len(challenges), 1)
        info(f"Challenges: {len(challenges)} stk., {avg} reelle løsninger i snit "
             f"(prædikat ELLER alsoSolvedBy)")

    # Sjældenhed (src/core/rarity.ts) udledes af grafen — samme formel her, så
    # fordelingen kan ses og ikke skrider ubemærket når indholdet vokser.
    rarity_depth = {e["id"]: 0 for e in elements if e.get("base")}
    _ch = True
    while _ch:
        _ch = False
        for c in combos:
            a, b = c["pair"]
            if a in rarity_depth and b in rarity_depth:
                d = max(rarity_depth[a], rarity_depth[b]) + 1
                if c["result"] not in rarity_depth or d < rarity_depth[c["result"]]:
                    rarity_depth[c["result"]] = d
                    _ch = True
    n_recipes: dict[str, int] = {}
    used_as: set[str] = set()
    ending_els: set[str] = set()
    max_cost: dict[str, int] = {}
    for c in combos:
        n_recipes[c["result"]] = n_recipes.get(c["result"], 0) + 1
        used_as.update(c["pair"])
        if c.get("ending"):
            ending_els.add(c["result"])
        max_cost[c["result"]] = max(max_cost.get(c["result"], 1), c.get("cost", 1))

    base_ids = {e["id"] for e in elements if e.get("base")}

    def _tier(eid: str) -> str:
        if eid in base_ids:
            score = 0
        else:
            score = rarity_depth.get(eid, 0)
            if n_recipes.get(eid, 0) == 1:
                score += 2
            if eid not in used_as:
                score += 2
            score += 2 * (max_cost.get(eid, 1) - 1)
        if eid in ending_els or score >= 14:
            return "unique"
        return "rare" if score >= 8 else "common"

    dist = {"common": 0, "rare": 0, "unique": 0}
    for e in elements:
        dist[_tier(e["id"])] += 1
    total_els = len(elements)
    info(
        f"Sjældenhed: {dist['common']} common ({dist['common']*100//total_els} %), "
        f"{dist['rare']} rare ({dist['rare']*100//total_els} %), "
        f"{dist['unique']} unique ({dist['unique']*100//total_els} %)"
    )
    if dist["unique"] > total_els * 0.10:
        warn(f"{dist['unique']} unique-elementer er over 10 % — 'unique' mister sin betydning")
    if dist["common"] < total_els * 0.45:
        warn(f"Kun {dist['common']} common — de fleste fund bør være almindelige")
    for eid in ending_els:
        if _tier(eid) != "unique":
            err(f"Slutnings-elementet '{eid}' er ikke unique — det er runnets klimaks")

    # Obligatoriske problemer er spillets sidequests: de skal kunne løses på
    # mange måder, ellers føles de som én rigtig løsning man skal gætte.
    MIN_SOLUTIONS = 10
    for act in acts:
        for p in act.get("problems", []):
            if not p.get("required"):
                continue
            solvers = [c for c in combos if c.get("solves") == p["id"]]
            if len(solvers) < MIN_SOLUTIONS:
                err(
                    f"Problemet '{p['id']}' ({p.get('name')}) har kun "
                    f"{len(solvers)} løsninger — kræver mindst {MIN_SOLUTIONS}, "
                    f"så spilleren kan finde sin egen vej"
                )
            # Hver løsning skal have sin egen replik; ellers føles alternativerne
            # som den samme løsning i forklædning.
            without = [c for c in solvers if not c.get("narratorLine")]
            if without:
                err(
                    f"Problemet '{p['id']}': {len(without)} løsning(er) uden "
                    f"narratorLine — hver vej skal have sin egen kommentar"
                )
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

    # --- Fortællerens stemme + reproducerbare grammatik/par-facitter ---
    voice_failures = voice_judge.gate()
    for failure in voice_failures:
        err(f"stemme: {failure}")
    if not voice_failures:
        info(
            f"Stemmedommer: {len(voice_judge.expand_grammar())} grammatikvarianter "
            f"og {len(voice_judge.expand_pairs())} bagte par består"
        )

    for note in notes:
        print(f"ℹ️  {note}")
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
