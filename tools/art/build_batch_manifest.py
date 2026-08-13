"""Foreslår en maskinlæsbar opdeling af de resterende elementer i planens
tematiske bunker (`plan/design-visual-target-1.md`, TASK-038: "174
resterende elementer i bunker sten/træ/mad/dyr/værktøj/ild/samfund").

Ren klassifikation af `content/elements.json`s egne felter (`kind`, `stuff`,
`id`) — ingen AI, intet gættet om hvilket element der findes; hvis et
element mangler et forventet felt, klassificeres det ikke stiltiende, det
falder igennem til "samfund" som den dokumenterede opsamlingsbunke (se
`classify`).

VIGTIGT — to bevidste fortolkninger, ingen af dem redigeret ind i planen
her (denne prøvelse må ikke ændre plan-status, kun foreslå til Martin):

1. "værktøj" vinder over "sten"/"træ": et element som `stenoekse` har
   `kind: tool, stuff: stone`, men havner i "værktøj" ikke "sten", fordi
   bunken efter sit navn samler VÆRKTØJ, ikke "ting lavet af sten".
   "sten"/"træ"-bunkerne samler derefter de øvrige motiver med det
   materiale — også strukturer — så samme kildeark kan dele overflade,
   palet og penselstruktur.

2. "ild"-bunken er UDVIDET ud over bogstavelig ild til at omfatte
   vejrfænomener (regn, sky, lyn, sne, damp, røg, gnister,
   oversvømmelse, den lange vinter) — en tolkning af, at bunken samler
   "naturkræfter", ikke kun "kilder til varme/lys". Dette er IKKE
   eksplicit i planteksten og skal godkendes eller korrigeres af planens
   ejer; se den udskrevne manifest-fils `"note"`-felt for samme advarsel
   i selve outputtet.

Alt andet resterende (abstrakte begreber, personer, resten af
"phenomenon"-elementerne, samt structure/material der ikke er sten/træ)
havner i "samfund" som den brede opsamlingsbunke planen selv beskriver.

Kør:
    python3 tools/art/build_batch_manifest.py
    # skriver docs/design/element-batches.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ELEMENTS_JSON = ROOT / "content/elements.json"
OUT_DEFAULT = ROOT / "docs/design/element-batches.json"

# De 13 grundelementer der allerede er leveret (elements-sheet.png +
# build_element_art.py's forfining) — samme liste som
# `build_elements.py`'s ORDER og `test_build_elements_regression.py`'s
# BASE_IDS. Holdt som sit eget litteral her (i stedet for at importere
# build_elements) for at undgå en tilfældig kobling mellem "hvilket ark
# blev skåret" og "hvilke id'er er færdige" — de to spørgsmål er relaterede
# i dag, men ikke det samme spørgsmål.
DELIVERED_IDS = frozenset(
    {
        "sten", "pind", "graes", "vand", "ler", "baer", "larver",
        "dyr", "stamme", "nabo", "fugl", "korn", "okse",
    }
)

BUCKETS = ["sten", "trae", "mad", "dyr", "vaerktoej", "ild", "samfund"]

# Vejrfænomener regnet med i "ild" — se docstringens fortolkning nr. 2.
_ILD_UDVIDET = frozenset(
    {"ild", "gnister", "roeg", "damp", "sky", "regn", "lyn", "sne", "oversvoemmelse", "den-lange-vinter"}
)

NOTE = (
    "Foreslaaet klassifikation, ikke en redigering af plan/design-visual-target-1.md. "
    "To fortolkninger kraever Martins godkendelse: (1) 'vaerktoej' vinder over "
    "'sten'/'trae' for elementer der er redskaber af det materiale (fx stenoekse "
    "havner i vaerktoej, ikke sten). (2) 'ild'-bunken er udvidet til vejrfaenomener "
    "(regn/sky/lyn/sne/damp/roeg/oversvoemmelse/den lange vinter), ikke kun bogstavelig "
    "ild - dette staar ikke eksplicit i planteksten."
)


def classify(element: dict) -> str:
    """Klassificerer ét element til én af de 7 navngivne bunker.
    Rækkefølgen ER prioriteringen: første match vinder."""
    missing = [field for field in ("id", "kind", "stuff") if field not in element]
    if missing:
        raise ValueError(
            f"element mangler klassifikationsfelt(er): {', '.join(missing)} — "
            "manifestet gætter ikke."
        )
    kind = element.get("kind")
    stuff = element.get("stuff")
    if kind == "creature":
        return "dyr"
    if kind == "tool":
        return "vaerktoej"
    if kind == "food":
        return "mad"
    if stuff == "stone":
        return "sten"
    if stuff == "wood":
        return "trae"
    if element.get("id") in _ILD_UDVIDET:
        return "ild"
    return "samfund"


def build_batches(elements: list[dict], delivered_ids: frozenset[str]) -> dict:
    element_ids = [e.get("id") for e in elements]
    missing_delivered = sorted(delivered_ids - set(element_ids))
    if missing_delivered:
        raise ValueError(
            f"leverede id findes ikke i content/elements.json: {missing_delivered}"
        )

    remaining = [e for e in elements if e["id"] not in delivered_ids]
    buckets: dict[str, list[dict]] = {name: [] for name in BUCKETS}
    for e in remaining:
        missing = [field for field in ("id", "name", "act", "kind", "stuff") if field not in e]
        if missing:
            raise ValueError(
                f"element {e.get('id', '<uden id>')} mangler felt(er): "
                f"{', '.join(missing)} — manifestet gætter ikke."
            )
        bucket = classify(e)
        buckets[bucket].append(
            {
                "id": e["id"],
                "name": e["name"],
                "act": e["act"],
                "kind": e["kind"],
                "stuff": e["stuff"],
            }
        )
    return {
        "note": NOTE,
        "deliveredCount": len(delivered_ids),
        "remainingCount": len(remaining),
        "bucketCounts": {name: len(items) for name, items in buckets.items()},
        "buckets": buckets,
    }


def write_manifest_json(manifest: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, sort_keys=False, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--elements", type=Path, default=ELEMENTS_JSON)
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = parser.parse_args(argv)

    elements = json.loads(args.elements.read_text(encoding="utf-8"))
    manifest = build_batches(elements, DELIVERED_IDS)
    write_manifest_json(manifest, args.out)
    print(f"{manifest['remainingCount']} resterende elementer fordelt i {len(BUCKETS)} bunker:")
    for name, count in manifest["bucketCounts"].items():
        print(f"  {name:10s} {count}")
    print(f"skrevet: {args.out}")


if __name__ == "__main__":
    main()
