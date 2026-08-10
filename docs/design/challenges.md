# Challenges

*Besluttet 2026-08-07. Kode: `src/core/challenge.ts`. Kalibrering:
`tests/challenge-rates.test.ts`.*

## To slags opgaver

| | Problemer (sidequests) | Challenges |
|---|---|---|
| Kan man gå udenom? | ja | nej |
| Frist | ingen | 4-5 somre |
| Konsekvens ved fiasko | ingen | runnet slutter |
| Antal løsninger | mindst 10 | 9-10 oplagte + resten efter sværhedsbånd |

Problemerne er retninger man *kan* forfølge. Challenges er verden der
kommer efter Karl.

## LLM: forfatter-tid, ikke runtime

Overvejet og fravalgt: en live LLM som dungeon master. Fire ting, spillet
hviler på, ville knække:

1. **Nøglen kan ikke bo i en statisk side.** Spillet er filer på GitHub
   Pages. Runtime-LLM kræver en proxy-server — hosting, budget, og
   "åbn linket" holder op med at være sandt.
2. **Fortælleren ville gå tavs.** Alle 625 replikker er præ-indtalt.
   Genereret tekst kan ikke få stemme.
3. **Latens i kerneløkken**, hvor svaret i dag er øjeblikkeligt.
4. **Determinisme** bærer save/load og hele variant-systemet.

LLM'en bruges derfor på forfatter-tidspunktet (`tools/generate_lines.py`):
den skriver indholdet, vi kuraterer og indtaler det, og spillet forbliver
gratis, offline og med stemme. Sammenhængen kommer fra mængden af skrevet
indhold, ikke fra live-generering.

## To ting er bevidst deterministiske

**Hvornår de dukker op** — udledt af run-seed og sidetal, ikke af
`Math.random()`. Ellers kunne man genindlæse sit save indtil ingen
challenge kom.

**Hvad der løser dem** — et hash over (seed, challenge, element). Samme
element giver altid samme svar i samme run, så det føles som en egenskab
ved verden frem for et terningkast. Man kan ikke prøve den samme idé igen
og håbe på held.

## Sværhedsbånd

Andelen af elementer der løser et challenge, efter hvornår det dukkede op:

| Side | Andel der virker |
|---|---|
| 1-10 | **100 %** — fortælleren finder på noget uanset hvad |
| 11-20 | 80 % |
| 21-30 | 70 % |
| 31-40 | 60 % |
| 41-50 | 40 % |

De oplagte svar (`solvedBy`, mindst 5, håndhævet af validatoren) virker
**altid**. Ellers ville spillet straffe god ræsonnering.

## Kalibrering: mål mod motoren, ikke mod formlen

Det oprindelige forslag var 1 % stigende til 5 %. En sandsynlighedsmodel
på papir gav 2,4 challenges pr. run — men den rigtige løkke gav **0,63**.
Tre ting så modellen ikke:

- `minPage` gør de første sider helt ufarlige
- de 4-5 sider *mens* et challenge kører ruller ikke nye
- `seen` fjerner brugte challenges, så puljen tørrer ud

Med tre challenges rammer **15 % basis** (stigende til 75 % efter 40 stille
sider) det rigtige: ~1,4-2,0 pr. run, og 2-4 % af alle runs slipper helt
fri. Kommer der flere challenges, kan basis sænkes — kør
`tests/challenge-rates.test.ts`, den printer tallene ved hver kørsel.

> Lærestykket: en sandsynlighedsmodel af et system er ikke systemet.
> Simulér gennem den rigtige kode.

## Carl the Lucky

Et helt liv uden ét eneste challenge. Ved de kalibrerede rater sker det i
**2-4 % af alle runs** — cirka hvert 30. Det låses op på slutskærmen
sammen med skæbnens eget achievement.

## Tilføj et challenge

`content/challenges.json`:

```json
{
  "id": "...", "emoji": "...", "title": "...",
  "line": "challenge-…",           // situationen, 5+ varianter
  "turns": 4,                       // somre til at finde en udvej
  "minPage": 12,                    // tidligst her — giv plads til værktøjet
  "solvedBy": ["...", "..."],       // mindst 5 oplagte svar
  "successLine": "challenge-…-loest",  // bruger {element}
  "failEnding": "..."               // skal findes i endings.json med viaChallenge: true
}
```

Validatoren tjekker alle referencer, at der er mindst 5 oplagte løsninger,
og at slutningen findes. Husk at køre `tools/generate_audio.py` bagefter.
