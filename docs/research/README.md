# Kombinations-superset (idébank til expansion packs)

Et samlet, dedupliceret datasæt af kombinationsopskrifter fra genren —
**udgangspunktet** for at udbygge kombinationsmulighederne i The Ascent of Karl over tid.
Intet herfra shippes råt: hver adopteret opskrift kurateres med dansk
domæne-id, engelsk flavor i Karls univers og en faktuel note med kilde
(se designregler i `../design/act-1.md`).

## Filer

- `superset.csv` — det deduplikerede superset: `element_a,element_b,result,sources`
  (ingredienspar er usorterede; `sources` viser hvilke kildefamilier opskriften
  optræder i)
- `STATUS.md` — auto-genereret adoption-status: hvilke af spillets kombinationer
  stammer fra supersettet (kør `python3 tools/superset_status.py`)
- `raw/` — agenternes rå research pr. kildefamilie

## Metodologi

Indsamlet 2026-08-05 af tre parallelle research-agenter:

| Kildefamilie | Rå linjer | Bedste kilder |
|---|---|---|
| Little Alchemy 1+2 | 5.335 | Reverse-engineerede JSON-dumps (`redfast00/element-alchemy-cheater`) — komplette |
| Infinite Craft | 648 | gamertweak, PCGamesN m.fl. — *AI-genereret spil, opskrifter er "commonly reported", ikke garanterede* |
| Kloner (Doodle God/Devil/Farm, Zed's Alchemy, Alchemy Classic, Alchemy 1000, Little Alchemist) | 11.091 | gambledude-dumps, ayumilove-guides, fandom-API |

Normalisering: lowercase, whitespace-kollaps, usorterede ingredienspar,
dedupliceret på (par, resultat). **14.913 unikke opskrifter, 4.227 unikke
elementer; 235 opskrifter bekræftet af 2+ kildefamilier.**

Genkompilér med `scratchpad/compile_superset.py` (kræver de rå filer).
