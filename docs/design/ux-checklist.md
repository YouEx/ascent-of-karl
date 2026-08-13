# UX-retningslinjer og -dommer

*Skrevet 2026-08-07 efter at en spiller sad fast i en modal: ingen baggrunds-
klik, ingen back-knap. Det var ikke én bug — det var en klasse af bugs, som
ingen af vores checks kunne fange. Dette dokument er reglerne, og
`tools/ux_audit.mjs` er dommeren der håndhæver de af dem der kan måles.*

## Det bærende princip: ingen blindgyder

> Enhver tilstand brugeren kan komme **ind** i, skal de kunne komme **ud** af —
> og ad mere end én vej.

En enkelt vej ud er en fejl der venter på at ske: knappen falder uden for
skærmen på en lille telefon, den bliver dækket af tastaturet, klikket rammer
ved siden af, eller brugeren leder simpelthen efter noget andet. To
uafhængige veje ud betyder, at én der fejler ikke fanger brugeren.

Det er derfor denne fejl slap igennem: vi testede at knappen *virkede*, ikke
at der fandtes et alternativ når den ikke gjorde.

## 1. Flugtveje

- **Mindst to uafhængige veje ud af enhver overlejring.** I praksis:
  en synlig lukkeknap **plus** en omgivende gestus (klik på baggrunden).
- **Respektér platformens egen tilbage-gestus.** På mobil er browserens
  back — og iOS' swipe fra kanten — den universelle "fortryd". Åbner vi en
  overlejring uden at lægge en history-entry, sender back brugeren *ud af
  spillet* i stedet for ud af modalen. Det er den værste variant af fejlen:
  brugeren mister sit run i forsøget på at lukke en dialog.
- **Esc lukker** på desktop.
- **Fang aldrig brugeren på siden.** Det er fristende at lade back altid
  blive fanget, så ingen "mister" sit run. Det er den samme blindgyde vendt
  om, og browsere behandler det som fjendtligt. Vi lægger kun en
  history-entry når en overlejring er åben; ellers navigerer back normalt.
  Runnet ligger gemt i localStorage, så der er intet at miste.
- **Undtagelse kræver en grund.** En overlejring må kun mangle en lukkevej
  hvis den er *terminal* og tilbyder en fremadrettet handling der opløser
  tilstanden (vores slutskærm: runnet er slut, "Live again" fører videre).
  Undtagelser skrives ned i dommerens `TERMINAL`-liste — så er det en
  beslutning, ikke en forglemmelse.

## 2. Fokus og tastatur

- Fokus flytter **ind** i overlejringen når den åbner, og **tilbage** til det
  element der åbnede den når den lukker. Ellers står tastatur- og
  skærmlæser-brugere et vilkårligt sted i dokumentet.
- Fokus må ikke kunne tabbe **bagom** en åben overlejring.
- `role="dialog"`, `aria-modal="true"` og et tilgængeligt navn.

## 3. Rækkevidde og ramme

- Interaktive elementer er mindst **48×48 px** (PRD: mobil-først).
- Primære handlinger ligger i tommelfinger-zonen, ikke øverst på skærmen.
- Respektér `env(safe-area-inset-*)` — hjemme-indikatoren æder bunden.

## 4. Tilstand og afbrydelser

- Spillet skal kunne genoptages efter et **reload på et hvilket som helst
  tidspunkt**, også midt i en overlejring.
- En overlejring må aldrig ødelægge igangværende arbejde.
- Baggrunden må ikke scrolle med, mens en overlejring er åben.

## 5. Feedback

- Enhver handling giver synligt svar med det samme — også "der skete
  ingenting" (fortælleren er vores kvittering for en mislykket kombination).
- Uigenkaldelige handlinger varsles. (Skæbne-gaten er et eksempel: vi
  afværger i stedet for at lade spilleren snuble ind i en slutning.)

## 6. Konsistens

- Alle overlejringer opfører sig **ens**. Lærer man én, kan man dem alle.
  Derfor går alle vores gennem samme `openOverlay()`-helper — konsistens
  der er håndhævet af koden slår konsistens der er aftalt i et dokument.

## 7. Første møde

- En ny spiller skal kunne forstå hvad de skal gøre uden forklaring.
- Intet må kræve viden man kun har fra tidligere runs.

---

## Dommeren: `tools/ux_audit.mjs`

Kør med `npm run ux` (kræver at dev-serveren kører) eller `npm run ux:ci`.

Den starter spillet i en rigtig browser, åbner hver overlejring og
kontrollerer for hver især:

| Check | Regel |
|---|---|
| `close-control` | Har en synlig lukkeknap på mindst 48×48 px |
| `backdrop` | Klik på baggrunden lukker |
| `escape` | Esc lukker |
| `history` | Browserens back lukker overlejringen i stedet for at forlade spillet |
| `focus-in` | Fokus flytter ind i overlejringen |
| `focus-restore` | Fokus vender tilbage til udløseren |
| `aria` | `role="dialog"` + `aria-modal` + tilgængeligt navn |
| `scroll-lock` | Baggrunden scroller ikke |
| `feature-root-absent` | Feature-off har intet `data-improvise-enabled`-attribut |
| `feature-markup-absent` | Feature-off emitterer ingen improvisationsstatus-markup |
| `no-horizontal-scroll` | Feature-on mobil udvider aldrig layoutet ud over visual viewport |
| `dock-in-viewport` | Feature-on-værkstedet holder sig inden for mobilruden |
| `copy-status-in-viewport` | Feature-on-status er læsbar i mobilruden |
| `copy-status-above-dock` | Feature-on-status ligger over værkstedet og spærrer ikke slots/Combine |

Terminale overlejringer (slutskærmen) undtages fra lukke-checks, men skal
stadig bestå fokus- og aria-checks.

**Når du tilføjer en ny overlejring:** brug `openOverlay()`, og tilføj den
til `OVERLAYS` i dommeren. Gør du ikke det sidste, er den ikke dækket — og
så er vi tilbage hvor vi startede.
