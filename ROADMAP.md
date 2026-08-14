# Roadmap mod v1: Stenalderen

*v1 = Akt I lanceret som poleret, gratis web-spil. Akt II-V venter til
loopet er bevist (beslutning 2026-08-05, se docs/design/act-1.md).*

## 🎯 Hovedmål: 200+ kombinationsmuligheder i Akt I — **NÅET**

| Bølge | Kombinationer (kumulativt) | Status |
|---|---|---|
| Fundament | 34 | ✅ |
| Bølge 1: bolig, ånd, mode, sport, mad 2.0, transport 2.0 + alternative opskrifter | 86 | ✅ |
| Bølge 2: vejr/is, jagt 2.0, familie, handel/samfund, myter, krop, have | 146 | ✅ |
| Bølge 3: fossiler, monolit, istid-dyr, brød, hav-myter, sport, skrift | 205 | ✅ |
| Bølge 4: challenges med frist + sidequests med flere veje | **225** | ✅ |

De fire indholdsbølger nåede 225; den aktuelle kilde står på **187
elementer, 409 canonical kombinationer og 15 skæbner** efter de senere
system- og indholdsforløb. Næste indholdsarbejde bør drives af playtest-data,
ikke af flere tal — se prioriteringen nedenfor.

Værktøjer: `tools/superset_status.py` (adoption-tracking mod de 14.913
research-opskrifter), `tools/story_graph.py` (Mermaid-overblik over sporene),
`tools/social/render.mjs` (delekort + app-ikoner genereret fra
designsystemet), validator håndhæver kildekrav + variant-minimum.

**Designsystem (2026-08-10):** spillet hedder nu *The Ascent of Karl* og har
et dokumenteret pastel-designsystem — se `DESIGN.md` (lov for alt visuelt) og
`src/ui/tokens.css` (implementeringen).

## Prioriteret vej til launch

1. **Deploy til web** — ✅ **LIVE** på <https://youex.github.io/ascent-of-karl/>
   (2026-08-10). Actions-nedbruddet fra 2026-08-06 er ovre; både `ci.yml` og
   `deploy.yml` er grønne. Delekortet er på plads og genereres nu fra
   designsystemet (`npm run social`), så linket kan sendes direkte til testere.
2. **Ekstern improvisationsplaytest** — **NÆSTE**: source er færdig, og tre
   agent-QA-runs fandt ingen source-defekt. Det er ikke human evidens. Rekruttér
   præcis **5–10 engelsktalende deltagere** på tværs af crafting-game- og
   low-game-experience-grupper; de spiller uden forklaring. Mål: søger de
   absurditeten frivilligt, lander narratorens dom, og føles cap 6 beskyttende
   frem for straffende? Materialet ligger i `docs/playtest/`, og agentbeviset
   i `docs/playtest/task-030-improvisation-agent-qa-2026-08-13/`.
   **Der skal ikke implementeres mere før denne runde.**
   Den unlisted, deterministiske offline-kandidat er
   <https://youex.github.io/ascent-of-karl/playtest/improvisation/>.
   Den eksterne gate er fortsat åben; linket er ikke production-enable.
3. **Bølge 2-content** efter playtest-læring (hvad leder folk efter, som
   ikke findes?). Superset-listen er idébanken.
4. **Art-stilprøver** (PRD Step 4): Karl som synlig figur er nu **afgjort —
   ja** (han står på titelskærmen, i delekortet og i app-ikonet). Retningen
   er lagt fast i `DESIGN.md`. Det der mangler er element-illustrationer:
   3 prøver i samme pastel-streg med Karls stemninger (`karlMood`-felterne
   er briefen), som afløser emoji-ikonerne i griddet.
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

## Improvisationens release-status

- **Source:** komplet — offline core, UI/Chronicle/playtest v2, narrator-dom,
  copy-only Worker-kilde, sikker harvest og balancecheck.
- **Lokal QA:** kør
  `env -u VITE_IMPROVISE_URL VITE_IMPROVISE_ENABLED=true npm run dev`.
- **Produktion:** off. Pages-buildet tvinger den eksisterende offentlige root
  til feature-off. Kun den indlejrede playtest-preview er feature-on, og begge
  builds tvinger Worker-URL'erne tomme; der er ingen provisioneret trafik.
- **Release-gate:** den eksterne playtest ovenfor. Først efter dokumenteret
  human evidens må production-enable vurderes.
- **Høst:** værktøjet er færdigt, men faktisk output afventer deployet Worker,
  admin-token og rigtig trafik. Der findes intet fabrikeret harvest-output.

## Bevidst udskudt

- Akt II-V (design-dokumenter skrives først når Akt I-loopet er bevist)
- Dansk lokalisering (engelsk er primærsprog nu)
- Steam-integration, achievements, cloud saves
- UGC/workshop
