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
2. **Ekstern improvisationsplaytest** — source er færdig, og tre
   agent-QA-runs fandt ingen source-defekt. Det er ikke human evidens. Rekruttér
   præcis **5–10 engelsktalende deltagere** på tværs af crafting-game- og
   low-game-experience-grupper; de spiller uden forklaring. Mål: søger de
   absurditeten frivilligt, lander narratorens dom, og føles cap 6 beskyttende
   frem for straffende? Materialet ligger i `docs/playtest/`, og agentbeviset
   i `docs/playtest/task-030-improvisation-agent-qa-2026-08-13/`.
   **Implementeringsstoppet er ophævet af Martin 2026-08-16.** Runden er stadig
   nødvendig som produktionsbevis for humor, guidance, story continuity og
   improvisationens progression, men den blokerer ikke kildeimplementeringen.
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

## Kendte, bevidste røde tal (ikke regressioner)

- **Den visuelle dommer scorer alle 9 regioner på spilskærmen under tærsklen
  (samlet 0,60).** Referencen `docs/design/reference/target-2026-08-11.webp` er
  fra før to-siders story-spreadet, så den måler et layout spillet forlod med
  vilje. Målt 2026-08-15 (`npm run judge:capture && npm run judge:score`):

  | region | samlet | tærskel | geometri | ΔE | dy | dh |
  | --- | --- | --- | --- | --- | --- | --- |
  | app-frame | 0,721 | 0,82 | **1,000** | 6,5 | 0 | 0 |
  | header | 0,794 | 0,85 | 0,970 | **0,5** | +1 | 0 |
  | narrator | 0,525 | 0,85 | 0,081 | 1,8 | +16 | +88,1 |
  | chronicle | 0,625 | 0,85 | — | 5,6 | — | — |
  | chips | 0,392 | 0,85 | 0,009 | 4,1 | **−124,9** | 0 |
  | slots | 0,667 | 0,85 | 0,100 | 1,7 | **−125,4** | 0 |
  | combine | 0,716 | 0,80 | 0,096 | 0,5 | **−125,4** | 0 |
  | search | 0,703 | 0,85 | 0,010 | 0,6 | **−125,4** | 0 |
  | grid | 0,420 | 0,75 | 0,128 | **16,3** | **−125,4** | +143,4 |

  Fem regioner er rykket **præcis −125 px** op med uændret bredde (dw −2…0) og
  uændret højde — samme kunst, andet sted. Årsagen står i narratorens tal:
  **−513 px bredde**, fordi krøniken flyttede op ved siden af den.
  `app-frame` har et **identisk rektangel** (dx=dy=dw=dh=0) og dumper alligevel,
  fordi den indeholder alt det, der flyttede. `chronicle` er `mode: rect` og
  måles **slet ikke** på position — dens geometri 1,000 er en fripas, ikke et
  bevis; den dumper rent på udseende inde i et fast referencerektangel, der er
  fra før spreadet. `header` er reelt urørt (ΔE 0,5) og dumper kun på struktur.
  `grid` er den eneste med stor farveafvigelse (ΔE 16,3), fordi den er 143 px
  højere og derfor viser flere elementer.
  Det er ét designvalg, der forplanter sig som ni dumpekarakterer, ikke ni fejl.
  **Referencen må ikke bare udskiftes med en frisk optagelse:** 13 scripts i
  `tools/art/` sampler fra netop den fil og genererer de 77 committede filer i
  `src/assets/art/`. Den rigtige rettelse er et separat, aktuelt positionsmål
  til dommeren, adskilt fra kunstkilden — feature-arbejde, udskudt af punkt 2.
  Baggrund og side-om-side-bevis: se `$comment` i
  `docs/design/reference/registry.json`.
- **`judge:title-fidelity` melder røde mål i CI uden at gøre main rød.** Det er
  bevidst (Phase A auditerer, Phase D skifter kaldet til `--require-green`);
  porten findes og er testet begge veje i `tests/title-fidelity.test.ts`.
- **`npm run test:visual` er rød på scoretesten og ligger bevidst uden for CI.**
  Suiten optager live med rigtig Chromium og scorer mod
  `tests/visual-baseline.json` (optaget 2026-08-13, commit `429849d`). Målt
  2026-08-15: **58 fald** over `maxDrop` 0,02 — de største er
  `game/chips/geometry` 0,98, `game/search/geometry` 0,96 og
  `game/narrator/geometry` 0,89, altså præcis de regioner der flyttede med
  to-siders spreadet, plus `title/actions/tone` 0,37 og `title/chip/tone` 0,36
  fra omlægningen af titelskærmen til rigtige SVG'er. Begge dele er
  menneskeskabte strukturændringer, og `tools/judge/apply.mjs` fastslår selv
  reglen: en strukturel rettelse går uden om porten, *men det den afslører
  skal skrives ned, ikke ties ihjel*. Derfor er baseline **ikke** genoptaget —
  det ville låse 0,60 fast som "accepteret" kvalitet uden at nogen har
  accepteret den. Suiten er ikke i CI, fordi den måler underpixel-rektangler og
  screenshot-signaturer (`maxSignatureMeanDelta` 2). Det er en **vurdering, ikke
  en måling på Linux**: præcedensen er, at to Python-arttests allerede måtte
  `--deselect`es på Linux af samme grund. De to fejltyper der faktisk ramte os
  er derimod platformuafhængige og ligger nu i `npm test` — bekræftet grønne på
  Linux i CI-kørsel 31906480257.
  Kør suiten lokalt: `npm run test:visual`.
- **Layout-testen i samme suite var derimod i stykker og er rettet
  (2026-08-15).** Den slog op på `#narrator`, som blev til `#bubble` med
  spreadet, og `getComputedStyle(null)` gav en TypeError uden at nævne
  selektoren. Værre: `tests/improvise-feature-off-layout.json` havde **frosset
  en fejl** — `scrollWidth` 473 på et 390 px viewport, altså 83 px vandret
  overløb på mobil, registreret som "forventet". Den ville have dumpet den
  korrekte build og bestået den ødelagte. Baseline er nu genoptaget af
  `tools/record_layout_baseline.mjs`, som **nægter** at skrive et layout med
  overløb, og de to fejltyper er dækket af hurtige tests uden browser i
  `tests/layout-baseline-recorder.test.ts`, så de kører i CI via `npm test`.

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

- Spilheaderens `.mark` er stadig et bitmap (`src/assets/art/mark-figure.webp`,
  81×68 RGBA). Det er samme hulemotiv som titelchippens SVG, så appen har to
  gengivelser af samme tegning, og bitmappet skaleres en anelse op på retina.
  Udskudt bevidst: det viser ingen synlig firkant, det ligger på den skærm
  spilleren ser mest, og ROADMAP-punkt 2 forbyder implementering før
  playtest-runden. Konverteres til `icons.titleCave` bagefter — bemærk at
  gradientens `id="caveThroat"` så skal gøres unik eller flyttes til ét delt
  `<defs>`, fordi ikonet dermed kan optræde to steder i DOM'en samtidig.
- Akt II-V (design-dokumenter skrives først når Akt I-loopet er bevist)
- Dansk lokalisering (engelsk er primærsprog nu)
- Steam-integration, achievements, cloud saves
- UGC/workshop
