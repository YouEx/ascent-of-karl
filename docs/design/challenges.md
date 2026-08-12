# Challenges

*Besluttet 2026-08-07. Kode: `src/core/challenge.ts`. Kalibrering:
`tests/challenge-rates.test.ts`.*

## To slags opgaver

| | Problemer (sidequests) | Challenges |
|---|---|---|
| Kan man gå udenom? | ja | nej |
| Frist | ingen | 4-5 somre |
| Konsekvens ved fiasko | ingen | runnet slutter |
| Antal løsninger | mindst 10 | mindst 5 reelle (prædikat eller alsoSolvedBy-undtagelse) |

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

**Hvad der løser dem** — elementets tags mod prædikatet i
`content/predicates.json`, plus `alsoSolvedBy` som en håndholdt override for
de enkeltstående undtagelser, prædikatet ikke kan udtrykke (TASK-006). Intet
hash, ingen tilfældighed: samme element giver samme svar i alle runs, ikke
kun i det samme run. Man kan ikke prøve den samme idé igen og håbe på held —
og man kan heller ikke gætte sig frem, for svaret afhænger ikke af sidetal.

## Løsninger: prædikat plus en kort undtagelsesliste

Det oprindelige forslag var et sværhedsbånd — andelen af elementer, der
løser et challenge, skulle vokse jo senere det dukkede op (100 % på side
1-10, ned til 40 % på side 41-50). Det blev aldrig bygget: intet i
`startedAtPage` eller `resolves()` skalerer med sidetal i dag. Det, der
faktisk afgør en løsning, er fladt og page-uafhængigt — elementets tags mod
prædikatet i `content/predicates.json`.

`alsoSolvedBy` er en håndholdt override ved siden af prædikatet, til
enkeltstående svar prædikatet (endnu) ikke kan udtrykke. Den dømmer ikke
alene og er ikke facit — den er en undtagelse, og den skal helst forblive
tom eller kort. Valideringen kræver mindst 5 reelle løsninger pr. challenge,
talt som prædikat ELLER alsoSolvedBy (i dag: ulve 30, tørke 33, sygdom 43 ud
af 187 elementer), og advarer, hvis en alsoSolvedBy-post allerede fanges af
prædikatet — så listen kan krympes i stedet for kun at vokse. Det historiske
facit (alt der nogensinde er bekræftet som en løsning, inklusive dem
prunet ud herfra) bor i `docs/design/taxonomy-ground-truth.json`, som
`tools/predicate_report.py` regressionstester mod — ikke i `alsoSolvedBy`.

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
  "alsoSolvedBy": [],                // undtagelser prædikatet ikke fanger — typisk tom
  "successLine": "challenge-…-loest",  // bruger {element}
  "failEnding": "..."               // skal findes i endings.json med viaChallenge: true
}
```

Skriv også prædikatet i `content/predicates.json` — det er den, der reelt
afgør løsningerne. Validatoren tjekker alle referencer, at der er mindst 5
reelle løsninger (prædikat eller alsoSolvedBy), og at slutningen findes.
Husk at køre `tools/generate_audio.py` bagefter.
