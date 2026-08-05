# Roadmap mod v1: Stenalderen

*v1 = Akt I lanceret som poleret, gratis web-spil. Akt II-V venter til
loopet er bevist (beslutning 2026-08-05, se docs/design/act-1.md).*

## 🎯 Hovedmål: 200+ kombinationsmuligheder i Akt I — **NÅET**

| Bølge | Kombinationer (kumulativt) | Status |
|---|---|---|
| Fundament | 34 | ✅ |
| Bølge 1: bolig, ånd, mode, sport, mad 2.0, transport 2.0 + alternative opskrifter | 86 | ✅ |
| Bølge 2: vejr/is, jagt 2.0, familie, handel/samfund, myter, krop, have | 146 | ✅ |
| Bølge 3: fossiler, monolit, istid-dyr, brød, hav-myter, sport, skrift | **205** | ✅ |

Akt I står nu på **167 elementer, 205 kombinationer, 12 skæbner og 343
fortæller-varianter**. Næste indholdsarbejde bør drives af playtest-data,
ikke af flere tal — se prioriteringen nedenfor.

Værktøjer: `tools/superset_status.py` (adoption-tracking mod de 14.913
research-opskrifter), `tools/story_graph.py` (Mermaid-overblik over sporene),
validator håndhæver kildekrav + variant-minimum.

## Prioriteret vej til launch

1. **Deploy til web NU** (GitHub Pages-workflow ligger klar — aktivér Pages
   i repo-settings under "Build and deployment → GitHub Actions").
   Spilbart link = playtests kan starte med det samme.
2. **Playtest-runde 1** (PRD Step 5, fremrykket): 5-10 personer, uden
   forklaring. Mål: griner de, går de i stå, kan kombinationer ræsonneres?
   Fanger om fortæller-humoren lander FØR vi investerer i art/voice.
3. **Bølge 2-content** efter playtest-læring (hvad leder folk efter, som
   ikke findes?). Superset-listen er idébanken.
4. **Art-stilprøver** (PRD Step 4): 3 prøver af enkel streg/hulemaleri-stil
   med Karls stemninger (`karlMood`-felterne er briefen). Beslutning om
   Karl som synlig figur (PRD §9.2 — anbefalet: ja).
5. **Balancedata**: slutskærmen har nu en "Copy run summary"-knap
   (slutning, somre, opdagelser, flags, minutter) som playtestere kan
   indsende. Serverbaseret telemetri afventer beslutning om hosting.
   Tilgængelighed: reduced-motion og rem-baseret typografi er på plads;
   komiske spor markeres med stiplet streg, ikke kun farve.
6. **Lyd-polish**: UI-lyde, opdagelses-sting, ambience. Beslutning om final
   voice (menneske vs. premium-TTS) på baggrund af playtest-data.
7. **Distribution**: itch.io-side (gratis, lav friktion) → Steam-side når
   Akt I føles komplet (wishlist-opbygning; PRD §8-mål justeres til
   én-akts-spillet).

## Bevidst udskudt

- Akt II-V (design-dokumenter skrives først når Akt I-loopet er bevist)
- Dansk lokalisering (engelsk er primærsprog nu)
- Steam-integration, achievements, cloud saves
- UGC/workshop
