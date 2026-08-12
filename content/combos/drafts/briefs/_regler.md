# Sådan skrives en ny opskrift

Du giver blindgyder et liv. Et element, der indgår i nul opskrifter, er en
belønning der ikke fører nogen steder hen — og den koster spilleren dyrt, fordi
han vælger to ting ad gangen. Hver blindgyde gør alle senere valg dårligere.

## Den vigtigste regel

> **Resultatet skal være et element, der ALLEREDE findes.**

Laver du et nyt element, har du sandsynligvis lavet en ny blindgyde. Slå op i
`content/elements.json` og find et resultat, der allerede er der. Kun hvis
ingen eksisterende ting passer, må du opfinde én — og så SKAL den selv indgå i
mindst én anden opskrift, du også skriver.

## Skemaet

```json
{ "pair": ["blindgyde-id", "partner-id"], "result": "eksisterende-id" }
```

Felterne `solves`, `narratorLine`, `ageUp`, `ending`, `setsFlags` og
`requiresFlags` må du IKKE bruge. De hører til det håndskrevne spor.

## Hvad der gør en opskrift god

- **Den skal give mening i stenalderen.** Karl har ikke metal, ikke hjul, ikke
  skrift. Han har sten, træ, ild, skind, ler og tid.
- **Den skal være til at gætte.** Spilleren skal kunne tænke "selvfølgelig" —
  ikke slå op i en tabel. Rope + planks → raft er godt. Feather + clay →
  pottery er det ikke.
- **Foretræk partnere fra listen over de 25 mest brugte.** De ligger i
  spillerens hånd i forvejen, så opskriften kan faktisk findes.
- **Par må ikke findes i forvejen.** Tjek `content/combos.json`.
- **Rækkefølgen i `pair` er ligegyldig** — spillet sorterer selv.
