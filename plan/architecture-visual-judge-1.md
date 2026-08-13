---
goal: Bygge dommer-og-sløjfe-systemet der måler afstanden mellem spillet og referencebillederne objektivt, udpeger næste rettelse, beviser fremgang og forhindrer tilbagefald
version: 1.0
date_created: 2026-08-11
last_updated: 2026-08-11
owner: Martin (YouEx)
status: 'In progress'
tags: [architecture, design, tooling, testing, infrastructure]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

Titelskærmen er bygget om tre gange efter mockuppen, hver gang med en manuel
runde af "byg → kig → ret". Martins dom efter tredje runde: *"this clearly
doesn't look as polished as the two screenshots."* Det er ikke en kritik af den
enkelte rettelse — det er en **diagnose af metoden**. Manuel øjenmåling er
langsom, subjektiv og ikke-monoton: der findes ingen garanti for, at runde 4 er
tættere på end runde 3, og ingen måde at opdage at runde 5 ødelagde noget runde 2
fik rigtigt.

Denne plan bygger maskinen. Den erstatter ikke
`plan/design-visual-target-1.md` — den plan siger **hvad** der skal bygges
(pergament, ornamenter, 187 elementillustrationer). Denne plan bygger
**tilbagekoblingen**: hvordan vi ved, hvornår det er rigtigt, hvad der er dyrest
forkert lige nu, og hvordan det bliver ved med at være rigtigt.

## Hvorfor den naive udgave ikke virker

Den oplagte løsning — "tag et screenshot, diff det mod referencen, bed en
vision-model om at foreslå CSS" — fejler her af fem konkrete årsager. Hver af de
fem er direkte årsag til et delsystem i denne plan.

1. **Tilstanden matcher ikke.** Et screenshot kan ikke sammenlignes med
   referencen, medmindre spillet står i *præcis* referencens tilstand: 0/174
   opdaget, de 11 elementer, den fortællerlinje, de tre chips, tomme slots.
   Uden deterministisk tilstandsindsprøjtning måler man tilfældig støj.
   Skrivemaskineeffekten alene gør to på hinanden følgende optagelser
   forskellige. → **Scenariesystemet (fase 1).**
2. **Helhedsscorer skjuler netop de fejl der betyder noget.** Baggrundsmaleriet
   fylder ~55 % af pixels; en forkert skriftstørrelse i titellinjen rykker en
   global SSIM med under 0,001. En score på 0,72 er ikke handlingsanvisende.
   → **Regionsregistret og per-region-metrikker (fase 2 og 3).**
3. **Aktuatoren kan ikke nå målet.** Størstedelen af afstanden i dag er
   *manglende malede aktiver*, ikke forkert CSS. En sløjfe der kun kan skrive
   CSS vil køre i ring og lave stadig mere desperate justeringer af ting, der
   aldrig var problemet. Systemet **skal** kunne skelne "kan rettes med et
   token" fra "kræver kunst", og sende det andet i en arbejdskø i stedet for at
   lade som om. → **Ruteren (fase 5).**
4. **Ingen monotoni-garanti.** En vision-model foreslår gladeligt en ændring der
   gør det værre. Uden accepter/fortryd-port laver sløjfen en tilfældig
   vandring. → **Accept-porten (fase 5).**
5. **Ingen hukommelse.** Uden en journal genforeslår iteration 8 præcis det,
   iteration 3 allerede prøvede og fortrød. → **Journalen (fase 5).**

## Systemet i seks lag

| Lag | Ansvar | Artefakt |
|-----|--------|----------|
| 1. Scenarier | Deterministisk spiltilstand, frosset bevægelse | `src/ui/scenario.ts` |
| 2. Register | Hvilke referencer, hvilke regioner, hvilke DOM-ankre | `docs/design/reference/registry.json` |
| 3. Optagelse | Pixels + DOM-mål, reproducerbart | `tools/judge/capture.mjs` |
| 4. Metrikker | Fem ortogonale tal pr. region | `tools/judge/metrics.py` |
| 5. Dommer + sløjfe | Fund → rute → anvend → efterprøv → journal | `tools/judge/apply.mjs` (rute + anvend, bygget), `judge.mjs`, `loop.mjs` (vision-kald + efterprøv-sløjfe, ikke bygget endnu) |
| 6. Fastfrysning | Accepterede scorer bliver en test | `tests/visual-baseline.json` |

## 1. Requirements & Constraints

### Kilde og sandhed

- **REQ-001**: Referencerne er `docs/design/reference/title-2026-08-11.webp`
  (titelskærm, 1586×992) og `docs/design/reference/target-2026-08-11.webp`
  (spilskærm, 1449×1086 — Martins billede af 11-08-2026). Begge ligger i
  repoet, ikke i `~/Downloads`.
- **REQ-002**: Systemet måler mod referencen, men **DESIGN.md er stadig lov**.
  Hvor referencen bryder et tilgængelighedskrav, vinder DESIGN.md, og afvigelsen
  skrives ind i registret som en **tilladt afvigelse** med begrundelse. Ellers
  vil sløjfen evigt "rette" en bevidst beslutning tilbage til noget ulæseligt.
  Kendte tilfælde i dag: `--stone` (referencens `#BC9776` giver 2,18:1),
  `--label-ink` (referencens `#92745A` giver 3,21:1), og "Drag or choose from
  below" (CON-006 i visual-target-planen).
- **REQ-003**: Alle scorer er reproducerbare. Samme commit + samme reference =
  samme tal, på tværs af maskiner. Ingen tidsafhængighed, ingen netværk, ingen
  uafgjort RNG.

### Aktuator og sikkerhed

- **REQ-004**: Sløjfen må **kun** skrive til én fil: `src/ui/tuning.css`, som
  udelukkende indeholder token-overrides i `:root`. Den må aldrig røre
  `style.css`, `main.ts` eller markup. Alt andet emitteres som arbejdsposter.
- **REQ-005**: Hvert fund har en **lukket** defektklasse fra listen i REQ-006.
  Fritekst-defekter afvises af skemaet. Lukket ordforråd er det, der gør fund
  rutebare og deduplikerbare.
- **REQ-006**: Defektklasser: `size`, `position`, `spacing`, `color`, `weight`,
  `font`, `radius`, `shadow`, `texture`, `missing-asset`, `extra-element`,
  `state-mismatch`. Rutning: de otte første → `token`; `texture` og
  `missing-asset` → `asset`; `extra-element` og `state-mismatch` → `structure`.
- **SEC-001**: Ingen referencebilleder, skærmbilleder eller journaler sendes til
  tredjepart ud over den vision-model der allerede er i brug i sessionen.
- **CON-001**: Sløjfen har et hårdt loft på 12 iterationer pr. kørsel. Rammer
  den loftet uden at nå tærsklen, er det et **rapporteret nederlag**, ikke en
  stille afslutning.
- **CON-002**: En iteration accepteres kun hvis den samlede score forbedres
  **og** ingen enkelt region falder mere end 0,02. Netto-fremgang der ofrer en
  region er ikke fremgang — det er den fejl, manuel øjenmåling laver.
- **CON-003**: `structure`-fund anvendes **aldrig** automatisk. De skrives til
  arbejdskøen og kræver et menneske eller en agent med fuld kontekst.
- **CON-004**: Optagelse kræver `vite preview` på port 5199. Harnessen skal selv
  starte og stoppe serveren, ikke antage at den kører — den dør, når dens shell
  høstes, og det har allerede kostet tid i denne session.

### Metode

- **GUD-001**: 50/50-overlejring (`PIL.Image.blend`) er den teknik, der virkede,
  da alle tærskelbaserede profilscanninger fejlede. Den skal være et
  førsteklasses artefakt i hver iteration, ikke et fejlfindingsknep.
  Pergamentets krakelering og "Karl"s lys-til-mørk-forløb slår enhver
  tærskeldetektion; overlejringen afgjorde hvert spørgsmål i ét kig.
- **GUD-002**: DOM-mål slår pixelgæt. Kan tallet læses af
  `getComputedStyle`, skal dommeren have det tal — ikke gætte det ud af pixels.
  Forskellen er "font-size er 15px, referencen måler ~19px" mod "teksten ser
  lille ud".
- **GUD-003**: Regioner sammenlignes via **DOM-anker**, ikke faste rektangler.
  En komponent der er rigtig men forskudt skal score højt på *udseende* og
  udløse en separat, eksplicit *positionsfejl*. Blandes de to, kan ingen af dem
  rettes.
- **GUD-004**: Accept-porten dømmer **sløjfens tokenskrivninger**, ikke
  menneskets strukturændringer. En strukturel rettelse, der er verificeret mod
  målt referencegeometri, kan lovligt sænke en regions score ved at *afsløre*
  en fejl, der allerede var der. Konstateret ved første rigtige iteration:
  `#app` gik fra 760 px til referencens målte 1112 px, app-frame steg
  0,451→0,537 og narrator 0,563→0,646, men `chips` faldt 0,039 og porten
  afviste. Overlejringen viste hvorfor: vores chips er for små, og ved 760 px
  udfyldte de tilfældigvis rækken bedre. Reglen: strukturændringer må gå uden
  om porten, men det afslørede skal skrives i human-queue.json med det tal,
  der afslørede det — aldrig ties ihjel.
- **PAT-001**: Fem ortogonale metrikker frem for én. Ortogonale, så en rettelse
  af den ene ikke forplumrer den anden.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Deterministisk tilstand. Efter denne fase kan spillet bootes ind i
  en navngiven, frossen tilstand via URL, og to optagelser af samme scenarie er
  pixel-identiske. Uden dette måler alt andet støj.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Læg spilskærmsreferencen i repoet som `docs/design/reference/target-2026-08-11.webp` (kilde: `~/Downloads/ChatGPT Image 11. aug. 2026, 15.11.13.png`, 1449×1086 — endte som `.webp`, ikke det oprindeligt planlagte `game-2026-08-11.png`). Titelreferencen lå der allerede. | ✅ | 2026-08-11 |
| TASK-002 | Tilføj `src/ui/scenario.ts` med `applyScenario(name)`: sætter save-tilstand, opdaget-mængde, aktiv fortællerlinje, chip-tilstande og slot-indhold direkte, uden at spille sig frem. Læses fra `?scenario=` i `main.ts` før første render. | ✅ | 2026-08-11 |
| TASK-003 | Definér de to scenarier der matcher referencerne: `title-fresh` (ingen save, Fates 0/15, tip-kort på tip 1) og `act1-opening` (0/174 opdaget, 11 baseelementer, tomme slots, chips freezing/bare hands/hungry, fortællerlinjen fra referencen). | ✅ | 2026-08-11 |
| TASK-004 | Tilføj `?freeze=1`: sætter `document.documentElement.dataset.freeze`, hvilket via CSS slår alle `transition`/`animation` fra (`* { transition: none !important; animation: none !important; }`), fuldfører skrivemaskineeffekten øjeblikkeligt og stopper tip-karrusellens timer. | ✅ | 2026-08-11 |
| TASK-005 | Tilføj `data-ready="true"` på `<html>` når første render er færdig **og** alle `<img>` i viewporten er `decode()`'d. Harnessen venter på dette flag frem for en fast `waitForTimeout` — en timeout er et gæt, et flag er et faktum. | ✅ | 2026-08-11 |
| TASK-006 | Sikr determinisme: enhver `Math.random()` i renderstien seedes eller omgås under `freeze`. Verificér ved at optage `act1-opening` to gange og kræve identisk SHA-256 på de to PNG-filer. **Revideret 2026-08-12**: verifikationen dækkede kun `Math.random()` — den levende `feTurbulence`-kornfilter i `body::after` har ingen tilfældighedskilde, men Chromium rasterizerer den ikke bit-for-bit ens mellem kørsler. To optagelser afveg reelt med ~43 pixel, maks. kanaldelta 7/255. Bagt til en statisk `src/assets/art/body-grain.png` med bagt alfaopacitet (se TEST-001) — men efterprøvning over 8 kørsler i træk, ikke kun 2, viste at PRÆCIS samme 43-pixel/delta-7-mønster stadig indtraf (i 1 af 5, 2 af 5 og 2 af 8 kørsler på tværs af tre uafhængige målerækker), uanset om kilden var levende SVG eller statisk fil, og uanset om opaciteten sad i CSS' `opacity`-egenskab eller var bagt ind i pixlernes egen alfakanal (`opacity: 0` og `opacity: 1` var begge deterministiske i alle kørsler; kun brøkværdier derimellem var det ikke). Hverken at fjerne flisegentagelsen eller at slå GPU-kompositering fra i Chromium-opstarten ændrede noget — hvilket AFKRÆFTER GPU'en som isoleret skyldig snarere end bekræfter den. Årsagen er derfor bredere: en ikke-determinisme i Chromiums rendering/kompositering af et fladedækkende, halvgennemsigtigt `mix-blend-mode`-lag, ikke en resterende kodefejl og ikke isoleret til GPU'en specifikt. Determinismekravet er derfor lempet til en målt tolerance (se TEST-001) i stedet for identisk SHA-256; den statiske flise bevares, fordi den stadig fjerner indholds-kilden som en selvstændig variabel. **Yderligere revideret 2026-08-12**: en lempet tolerance, der kun stod som tekst i planen, var en påstand, ikke en port. `tools/judge/determinism.mjs` (+ `tools/judge/determinism_compare.py`, `npm run judge:determinism`) gør TEST-001 eksekverbar: 8 uafhængige optagelser (friske Chromium-processer) af `act1-opening` mod produktions-previewet, sammenlignet parvist (28 par), afvist hvis noget par overskrider 100 afvigende pixel eller kanaldelta 12/255. Komparatoren beviser sin egen grænse med syntetiske selvtests (100 px/delta 12 består præcist på grænsen, 101 px eller delta 13 fejler) før den dømmer rigtige optagelser. Tre uafhængige rigtige kørsler af porten: værste 43 px/Δ7, 0 px/Δ0, 43 px/Δ7 — alle bestået, med rigelig margin til 100/12. | ✅ | 2026-08-11 |
### Implementation Phase 2

- GOAL-002: Registret. Efter denne fase findes der én maskinlæsbar sandhed om,
  hvilke regioner der findes, hvad de vejer, og hvilket DOM-element de svarer
  til.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Opret `docs/design/reference/registry.json` med skema: `{ id, file, screen, scenario, nativeWidth, nativeHeight, regions: [{ id, rect: [x,y,w,h], anchor, weight, metrics, allowedDeviations }] }`. | ✅ | 2026-08-11 |
| TASK-008 | Registrér spilskærmens regioner med rigtige selektorer fra `main.ts`: `header`→`#age`s forælder, `narrator`→`#narrator`, `chronicle`→`#challenge`, `chips`→`#problems`, `slots`→`#dock`, `combine`→`#combine`, `search`→`#tools`, `grid`→`#grid`. Vægte efter synligt areal × betydning. | ✅ | 2026-08-11 |
| TASK-009 | Registrér titelskærmens regioner: `headline`, `ribbon`, `tagline`, `divider`, `actions`, `hint`, `tip-card`, `chip`, `tools`, `scene`. Ankre findes i `#title-screen`. | ✅ | 2026-08-11 |
| TASK-010 | Indfør `allowedDeviations` pr. region og udfyld de tre kendte fra REQ-002 (`--stone`-kontrast, `--label-ink`-kontrast, hint-teksten). Hver post kræver `reason` og `authority` (fx `DESIGN.md §2`). Dommeren får dem som kontekst og må ikke rapportere dem som fejl. | ✅ | 2026-08-11 |
| TASK-011 | Udmål regionsrektanglerne i referencen ved at åbne referencen og aflæse kanterne — ikke ved at gætte ud fra vores egen render, hvilket ville låse fejlen fast som mål. | ✅ | 2026-08-11 |
### Implementation Phase 3

- GOAL-003: Optagelse og måling. Efter denne fase kan `npm run judge:score`
  producere en tabel med fem tal pr. region, uden at nogen kigger på noget.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Byg `tools/judge/capture.mjs`: starter `vite preview` selv (CON-004), sætter viewport til referencens native mål, loader `?scenario=X&freeze=1`, venter på `data-ready`, og skriver helskærmsbillede + per-region-udsnit til `.judge/<run>/render/`. **Revideret 2026-08-12**: startede reelt dev-serveren (`vite`, ikke `vite preview`) — CON-004 var ikke opfyldt. A/B-målt på samme commit: dev- og preview-optagelser er hver især interne byte-identiske, men divergerer indbyrdes med op til 2/255 i header og de flader der arver dens baggrund, fordi prod-CSS-minificeringen skriver `rgb(74 48 33 / 0.15)` om til `#4a302126` (alfa afrundet til 38/255). Rettet til at bygge og starte `vite preview`, så dommeren måler det spillerne rent faktisk får. | ✅ | 2026-08-11 |
| TASK-013 | Udvid `capture.mjs` med DOM-måldump: for hvert anker gemmes `getBoundingClientRect()` og udvalgte `getComputedStyle`-felter (`font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `color`, `background-color`, `border-radius`, `box-shadow`, `padding`, `gap`) til `metrics.json`. Dette er GUD-002 i praksis. | ✅ | 2026-08-11 |
| TASK-014 | Byg `tools/judge/metrics.py` med fem ortogonale mål pr. region: `structure` (SSIM på gradientmagnitude, gråtone — form uden farve), `tone` (ΔE2000 mellem regionsmedianer), `ink` (afvigelse i mørk-pixel-dækning — proxy for skriftvægt og -størrelse), `geometry` (normaliseret boks-forskydning og størrelsesafvigelse, fra DOM-mål ikke pixels) og `materiality`. | ✅ | 2026-08-11 |
| TASK-015 | Implementér `materiality` som standardafvigelsen af et højpasfiltreret udsnit: den måler, om fladen har malet tekstur eller er en flad CSS-farve. Ingen standardmetrik navngiver vores største defektklasse; denne gør. | ✅ | 2026-08-11 |
| TASK-016 | Byg `tools/judge/overlay.py`: 50/50-`Image.blend` af reference og render i referencens native mål, plus per-region-overlejringer og et diff-varmekort. GUD-001. | ✅ | 2026-08-11 |
| TASK-017 | Tilføj `npm run judge:score` der kører optagelse + metrikker og printer en tabel: region, fem tal, delta siden sidste kørsel. Menneskelæsbart output er ikke pynt — det er den eneste måde at fange en metrik, der selv er gået i stykker. | ✅ | 2026-08-11 |
### Implementation Phase 4

- GOAL-004: Dommeren. Efter denne fase omsættes billeder og tal til strukturerede,
  handlingsanvisende fund — ikke prosa.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Definér fund-skemaet i `tools/judge/finding.schema.json`: `{ region, defect, severity: 1-5, evidence, fix: { kind: "token"\|"asset"\|"structure", ... } }` med `defect` bundet til listen i REQ-006. Ugyldig JSON afvises og genforespørges én gang. | ✅ | 2026-08-11 |
| TASK-019 | Byg `tools/judge/judge.mjs`: sender pr. region referenceudsnit, renderudsnit, overlejring, de fem metrikker, DOM-computed-styles og regionens `allowedDeviations` til vision-modellen, og validerer svaret mod skemaet. **Implementeret 2026-08-13**: CLI (`node tools/judge/judge.mjs --run <dir> --screen <id> [--fixture …]`) og importerbar kerne (`buildRegionPayload`, `buildPrompt`, `getFindings`). Pakker referenceudsnit, renderudsnit, blend og varmekort som base64, DOM-box/computed styles fra capture-metrikkerne, registryets rect/weight/threshold/note, relevante `allowedDeviations` og forrige kørsels afviste nøgler/fund. Udbyderkald bruger native `fetch` (ingen ny afhængighed) og kræver eksplicit `VISUAL_JUDGE_API_KEY`/`VISUAL_JUDGE_MODEL` — fejler tydeligt uden dem, intet rigtigt kald i test eller verifikation. Ugyldigt JSON/skema genforespørges præcis én gang med valideringsfejlene vedlagt, herefter fejler processen højlydt (aldrig et tomt success-fald). Valideringen (`validate-finding.mjs`) tjekker både skemaform og runtime-fakta: kendt token, `from` matcher nuværende værdi (hex/rgb-normaliseret), `to` er en sikker CSS-værdi. 19 tests i `tests/judge-vision.test.ts`. | ✅ | 2026-08-13 |
| TASK-020 | Skriv dommerens systemprompt eksplicit anti-prosa: den skal svare med den mindste ændring der lukker afstanden, angive `from`/`to` med enheder, og hellere sige `missing-asset` end at foreslå en CSS-efterligning af malet kunst. Selvsikkerhed uden `evidence` afvises. **Implementeret 2026-08-13**: `SYSTEM_PROMPT` i `judge.mjs` — kode/kommentarer på dansk, selve modelinstruktionen på engelsk for pålidelighed. Kræver rent JSON, mindste ændring, numerisk `evidence` og `from`/`to` med enheder, `missing-asset` frem for CSS-efterligning, DESIGN.md/`allowedDeviations` som autoritet hvor de tillader afvigelse, ingen prosa, ingen ændringer uden for tokens for automatiske rettelser. Dækket af `tests/judge-vision.test.ts`. | ✅ | 2026-08-13 |
| TASK-021 | Dedupér fund på tværs af regioner: samme token foreslået fra to regioner samles til ét fund med den højeste `severity`, så sløjfen ikke skriver samme variabel to gange i én iteration og tilskriver den anden skrivning æren. **Revideret 2026-08-12**: `writeTuning()` gjorde det modsatte — fund itereres i faldende `severity`, og et senere `Map.set` overskrev et tidligere, så den LAVESTE severity vandt (og kommentar-tilskrivningen pegede stadig på den højeste). Rettet med `resolveTokenWinners()` (rækkefølge-uafhængig, højeste severity vinder) og `consolidateTokens()` (denne opgaves regionstværgående samling, med `consolidatedFrom`-herkomst). | ✅ | 2026-08-12 |

### Implementation Phase 5

- GOAL-005: Sløjfen, ruteren og journalen. Efter denne fase kører systemet selv
  og kan ikke gøre skade.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | Opret `src/ui/tuning.css` (importeret sidst i `style.css`, kun `:root`-overrides) og gør den til sløjfens **eneste** skrivemål. REQ-004. **Bekræftet 2026-08-13**: arkitekturen var allerede på plads (filen findes, importeres sidst, indeholder kun `:root`), men opgaven var aldrig afkrydset eller bevist med en dedikeret test. `tests/judge-tuning-contract.test.ts` beviser nu både den statiske kontrakt og at `writeTuning()` strukturelt (hardcodet linjeskabelon) aldrig kan producere andet end én `:root`-blok, uanset input. | ✅ | 2026-08-13 |
| TASK-023 | Byg ruteren i `tools/judge/apply.mjs`: `token`→ skriv til `tuning.css`; `asset`→ tilføj til `docs/design/asset-queue.json` med spec og stop; `structure`→ skriv til arbejdskøen, anvend aldrig (CON-003). Landede i `apply.mjs`, ikke det oprindeligt planlagte `loop.mjs` (se FILE-006) — implementeret, bare aldrig afkrydset. | ✅ | 2026-08-12 |
| TASK-024 | Implementér accept-porten: efter hver anvendelse køres optagelse + måling igen. Accepteres kun ved samlet forbedring **og** ingen region under −0,02 (CON-002). Ellers rulles `tuning.css` tilbage, og fundet markeres `rejected`. **Implementeret 2026-08-13** i `tools/judge/loop.mjs`s `acceptGate(before, after, {epsilon, maxDrop})`: accept kræver samlet fremgang > 0,002 og ingen region falder mere end 0,02. Ved afvisning genskrives `tuning.css` fra et in-memory råt strengsnapshot taget FØR anvendelse — aldrig `git reset`/`checkout` (det kunne ramme urelateret arbejde i en delt worktree). Bevist enhedstestet OG med en rigtig fixture-kørsel: en reelt målt titel-regression (chip −0,181, tools −0,105, tip-card −0,069) blev korrekt afvist, og `tuning.css` var byte-for-byte gendannet bagefter. | ✅ | 2026-08-13 |
| TASK-025 | Implementér journalen `.judge/<run>/ledger.json`: pr. iteration gemmes fund, anvendt ændring, før/efter-scorer, accepteret/fortrudt. Afviste fund fodres tilbage til dommeren som "dette er prøvet og gjorde det værre". Dette er hukommelsen fra punkt 5 i indledningen. **Implementeret 2026-08-13**: journalen ligger pr. kørsel, ikke i en global fil. Hver iteration gemmer fulde før/efter-scorer, fund, anvendte/forsøgte tokens, kø-resultater, herkomst (`consolidatedFrom`), verdikt, årsag og tidsstempler. Afviste nøgler samles i `ledger.rejected` og sendes med til dommerens næste prompt. Bevist med en rigtig accept-kørsel (gevinst +0,0035) og en rigtig afvist kørsel (samme værktøj, modsat token-værdi, fald −0,0125 globalt) — se verifikationsafsnittet. | ✅ | 2026-08-13 |
| TASK-026 | Implementér stopbetingelser: alle regioner over tærsklen, eller tre iterationer i træk uden accept, eller 12 iterationer (CON-001). Sidste to rapporteres som nederlag med den bedste opnåede tilstand og de blokerende fund. **Implementeret 2026-08-13**: `decideStop()`/`resolveMaxIterations()` i `loop.mjs` — success når alle anmodede regioner er over tærsklen, nederlag ved tre på hinanden følgende afviste iterationer (nulstillet af en accept), ved det hårde loft på 12 (eller et eksplicit `--max`), eller når der ingen anvendelige token-fund er (kun asset/struktur-fund i kø, for at undgå at sløjfen spinder uden mål). Hvert nederlag rapporteres med den bedste opnåede tilstand (`bestTuning`/`bestScores`) og de blokerende fund. 22 tests i `tests/judge-loop.test.ts`, inklusive begge fixture-kørsler. | ✅ | 2026-08-13 |
| TASK-027 | Tilføj `.judge/` til `.gitignore`, men gør `docs/design/asset-queue.json` **versioneret** — arbejdskøen er et projektartefakt, ikke et kørselsartefakt. **Bekræftet 2026-08-13**: `.judge/` var allerede i `.gitignore`, og `docs/design/asset-queue.json`/`human-queue.json` var allerede versionerede uden for `.judge/`. `tests/judge-tuning-contract.test.ts` beviser nu kontrakten (linjematch mod `.gitignore`, filernes placering, gyldig `items`-array-JSON) i stedet for at være en ukontrolleret antagelse. | ✅ | 2026-08-13 |
| TASK-028 | Tilføj `npm run judge` (fuld sløjfe) og `npm run judge:report` (åbner sidste kørsels HTML-rapport med overlejringer og scorer side om side). **Implementeret 2026-08-13**: `npm run judge` kører den fulde sløjfe (`loop.mjs`), og `npm run judge:report` genererer en selvstændig `.judge/<run>/report.html` (`tools/judge/report.mjs`) — ingen CDN/netværksafhængighed, al modeltekst escapes før indsættelse. **Afviger bevidst fra planteksten**: rapporten åbner ikke længere automatisk — kun med eksplicit `--open` — den printer stien og returnerer, af hensyn til CI/headless-sikkerhed. Rapporten viser skærme, seneste reference/render/overlay/diff-billeder, scoretabel, tærskelstatus, hver iterations fund/ruter/før-efter-delta/verdikt/årsag, afvist hukommelse, køede blokeringer og stopårsag. 17 tests i `tests/judge-report.test.ts`, plus rigtige rapporter genereret og inspiceret fra begge fixture-kørsler. | ✅ | 2026-08-13 |

### Implementation Phase 6

- GOAL-006: Fastfrysning. Efter denne fase kan et opnået niveau ikke stille
  forsvinde igen.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Skriv accepterede regionsscorer til `tests/visual-baseline.json` med det commit, de blev målt på. | | |
| TASK-030 | Tilføj `tests/visual.test.ts` der kører optagelse + måling og fejler, hvis en region falder mere end 0,02 under baseline. Markeres som langsom test, kører ikke i `npm test`s hurtige sti. | | |
| TASK-031 | Dokumentér systemet i `CLAUDE.md`s arkitekturliste og i `DESIGN.md` som den gældende metode for visuelt arbejde: fremover rettes UI ikke i blinde. | | |
| TASK-032 | Kør systemet på titelskærmen og luk de fund det producerer — det er den første rigtige prøve, og den skærm har allerede tre manuelle runder bag sig at slå. | | |

## 3. Alternatives

- **ALT-001**: Ren pixel-diff mod hele billedet. Fravalgt: baggrundsmaleriet
  dominerer pixelantallet, så scoren er ufølsom over for netop de
  typografi- og afstandsfejl, vi jagter (punkt 2 i indledningen).
- **ALT-002**: Færdige værktøjer som Percy, Chromatic eller BackstopJS. Fravalgt:
  de er bygget til *regression* mod en tidligere render af samme kode, ikke til
  *konvergens* mod et malet måludtryk. De har ingen dommer og ingen aktuator.
  Deres udgangspunkt er "var det det samme som i går", vores er "hvor langt er
  der til billedet, og hvad koster det mindst at rette".
- **ALT-003**: Lade vision-modellen skrive CSS'en direkte i `style.css`. Fravalgt:
  ingen accept-port, ingen mulighed for at fortryde rent, og filen har allerede
  1112 linjer håndskrevet, kommenteret CSS, der ikke må blive til
  modelgenereret grød. Token-overrides i en dedikeret fil kan læses, granskes og
  slettes samlet.
- **ALT-004**: Sammenligne mod faste rektangler i stedet for DOM-ankre.
  Fravalgt: en komponent der er rigtigt tegnet men 12px for lavt ville score
  som "helt forkert udseende", og den egentlige fejl — positionen — ville aldrig
  blive udpeget (GUD-003).
- **ALT-005**: Springe scenariesystemet over og bare klikke sig frem i
  Playwright. Fravalgt: skrivemaskineeffekt, tip-karrusel og transitions gør to
  optagelser forskellige, og en fejlet klikvej giver en tavs, forkert måling i
  stedet for en fejl.

## 4. Dependencies

- **DEP-001**: `playwright` (allerede i `devDependencies`).
- **DEP-002**: Python 3 med `Pillow` og `numpy` til `metrics.py` og
  `overlay.py`. `scikit-image` for SSIM, alternativt en egen implementering hvis
  afhængigheden ikke ønskes.
- **DEP-003**: En vision-model med struktureret JSON-output til dommeren
  (fase 4). Findes i sessionen i dag; systemet skal kunne køre fase 1-3
  **uden** den, så tallene virker selv når dommeren er nede.
- **DEP-004**: `plan/design-visual-target-1.md` — denne plan måler den plans
  fremskridt. Arbejdskøen fra ruteren føder direkte ind i dens fase 2-7.

## 5. Files

- **FILE-001**: `src/ui/scenario.ts` — ny. Deterministisk tilstandsindsprøjtning.
- **FILE-002**: `src/ui/main.ts` — ændres: læs `?scenario=`/`?freeze=`, sæt
  `data-ready`.
- **FILE-003**: `src/ui/tuning.css` — ny. Sløjfens eneste skrivemål.
- **FILE-004**: `docs/design/reference/registry.json` — ny. Regioner og vægte.
- **FILE-005**: `docs/design/reference/target-2026-08-11.webp` — ny. Spilskærmens
  reference.
- **FILE-006**: `tools/judge/capture.mjs`, `metrics.py`, `overlay.py`,
  `apply.mjs`, `finding.schema.json` — nye (rute + anvend landede i
  `apply.mjs`, ikke i de oprindeligt planlagte `judge.mjs`/`loop.mjs`).
  `judge.mjs` og `loop.mjs` er nu bygget, se FILE-011.
- **FILE-007**: `docs/design/asset-queue.json` — ny, versioneret. Ruterens
  udgang for `asset`-fund.
- **FILE-008**: `tests/visual-baseline.json`, `tests/visual.test.ts` — nye.
- **FILE-009**: `package.json` — nye scripts `judge`, `judge:score`,
  `judge:report`.
- **FILE-010** (2026-08-12): `tools/judge/determinism.mjs`,
  `tools/judge/determinism_compare.py` — nye. Den eksekverbare TEST-001-port
  (`npm run judge:determinism`, se TEST-001 og TASK-006). `tools/art/
  build_body_grain.mjs`, `tools/art/body-grain.config.json` — kornbagningens
  parametre flyttet fra hardkodede konstanter og en død CSS-token
  (`--grain-opacity`) til én kildefil, som både bagningen og et
  `--check`-tjek (dimensioner, ikke gen-rendering, se TASK-006) læser.
- **FILE-011** (2026-08-13): `tools/judge/judge.mjs` (vision-kald, TASK-019/020),
  `tools/judge/loop.mjs` (efterprøv-sløjfe, accept-port, journal, stopregler,
  TASK-024–026), `tools/judge/report.mjs` (selvstændig HTML-rapport, TASK-028),
  `tools/judge/validate-finding.mjs` (streng fund-validering, delt mellem
  `judge.mjs` og `apply.mjs` så de aldrig kan glide fra hinanden) — nye.
  `tools/judge/apply.mjs` — `writeTuning`/`appendQueue` eksporteret med
  injicerbare stier (så `loop.mjs` og dets tests aldrig rører de rigtige
  `src/ui/tuning.css`/kø-filer), plus et sidste forsvarslag
  (`safeCssValueErrors`) lige før skrivning. `tools/judge/capture.mjs` —
  `build()` eksporteret, så `loop.mjs` kan genbygge `dist/` mellem
  iterationer uden server-/browser-genstart. `tools/judge/overlay.py` — fire
  ekstra enkeltbilleder pr. region (`-ref`/`-render`/`-blend`/`-heat`), som
  `judge.mjs` pakker til vision-modellen. `tests/judge-vision.test.ts`,
  `tests/judge-loop.test.ts`, `tests/judge-report.test.ts`,
  `tests/judge-tuning-contract.test.ts`, `tests/judge-validate.test.ts`,
  `tests/node-builtins.d.ts` (minimale ambient node:fs/path/url-typer, samme
  filosofi som `tests/raw.d.ts` — intet `@types/node`) — nye.
  `tests/fixtures/judge/findings-title-accept.json`,
  `findings-title-reject.json` — nye, virkelige (målt, ikke opdigtede)
  fixture-fund brugt til den fixture-drevne accept-/afvis-verifikation.
  `npm run judge` peger nu på `loop.mjs` (fuld sløjfe), `judge:report` på
  `report.mjs`; nyt script `judge:once` (`loop.mjs --max 1`).

## 6. Testing

- **TEST-001**: Determinisme — to på hinanden følgende optagelser af
  `act1-opening` skal ligge inden for en målt tolerance: **højst 100
  afvigende pixel og maks. kanaldelta 12/255** på hele skærmbilledet
  (oprindeligt formuleret som identisk SHA-256). Fejler den langt ud over
  dette, er scenariesystemet ikke færdigt, og alle andre tal er ugyldige.
  **Revideret 2026-08-12**: kravet om byte-identisk SHA-256 viste sig
  ureproducerbart efter grundig efterprøvning (se TASK-006). Selv efter
  `body::after`s kornfilter blev bagt til en statisk fil MED bagt
  alfaopacitet (ingen CSS-brøkopacitet; fliselagt gentagelse afprøvet og
  udelukket som forklaring) gentog et identisk ~43-pixel/maks.-delta-7-
  mønster sig i tre uafhængige målerækker (1 af 5, 2 af 5, 2 af 8 kørsler) —
  altid præcis samme antal pixel, samme maksimale delta, samme afgrænsning
  (y 537–806, x 234–571 i `game`-skærmen). Årsagen er en ikke-determinisme i
  Chromiums rendering/kompositering af et fladedækkende, lavopacitets
  `multiply`-lag, ikke en indholdskilde eller en opacitetsmetode, der kan
  fjernes fra applikationskoden — `opacity: 0` og `opacity: 1` var begge
  deterministiske i alle kørsler, mens enhver brøkværdi derimellem ikke var
  det. At slå GPU-kompositering fra i Chromium-opstarten ÆNDREDE INTET ved
  dette mønster, hvilket AFKRÆFTER GPU'en som isoleret årsag snarere end
  bekræfter den — attributionen er derfor bevidst holdt til det bredere
  "rendering/kompositering", ikke "GPU", fordi evidensen kun bærer den
  bredere påstand. Tolerancen (100 px / 12-delta) er sat med rigelig margin
  over det målte (43 / 7) og ville stadig fange en reel regression — en
  glemt animation, et manglende billede eller en ufrossen overgang
  producerer langt bredere og kraftigere afvigelser end dette.
  **Yderligere revideret 2026-08-12**: en tolerance, der kun står som tekst i
  planen, er en påstand, ikke en port — enhver fremtidig ændring kunne
  stille sammenligningen skævt uden at noget ville fejle. TEST-001 er derfor
  gjort eksekverbar: `tools/judge/determinism_compare.py` (parvis
  pixel-/deltasammenligning på tværs af ALLE par, ikke kun mod én
  "kanonisk" kørsel — det værste par afgør, ikke et vilkårligt referencepar)
  og `tools/judge/determinism.mjs` (orkestrerer mindst 8 optagelser i friske
  Chromium-processer mod produktions-previewet, ét npm-kald:
  `npm run judge:determinism`). Komparatoren beviser først sin egen grænse
  med syntetiske selvtests — 100 px/delta 12 består præcist på grænsen,
  101 px eller delta 13 fejler — før den får lov at dømme rigtige
  optagelser. Tre uafhængige rigtige kørsler af porten gav: værste 43 px/Δ7,
  0 px/Δ0, 43 px/Δ7 — alle bestået, ~2,3× margin på pixelantal og ~1,7×
  margin på delta i forhold til det historisk værst målte.
- **TEST-002**: Metrik-fornuft — en region sammenlignet med sig selv scorer
  1,0 på alle fem mål; en region sammenlignet med et sort felt scorer lavt på
  alle fem. Uden denne kan en itu metrik se ud som fremskridt.
- **TEST-003**: `materiality` skelner reelt: en flad `#ECDCC7`-flade scorer
  markant lavere end referencens pergamentudsnit.
- **TEST-004**: Ruteren sender `missing-asset` til arbejdskøen og **aldrig** til
  `tuning.css`. Dette er den regel, der forhindrer sløjfen i at køre i ring.
- **TEST-005**: Accept-porten fortryder — et fund der forværrer scoren skal
  efterlade `tuning.css` byte-identisk med før iterationen.
- **TEST-006**: Skemavalidering — et fund med `defect: "ser lidt off ud"` afvises.
- **TEST-007**: `tests/visual.test.ts` fejler ved kunstigt forringet token
  (fx `--step-title` halveret).

## 7. Risks & Assumptions

- **RISK-001**: Sløjfen overfitter til én viewportstørrelse og ødelægger
  responsiviteten. Modtræk: `judge:score` kører også 430×932 og 2560×1200, og
  et fund må ikke accepteres, hvis det forværrer en anden viewport.
- **RISK-002**: Dommeren foreslår kosmetiske mikrojusteringer i det uendelige,
  fordi den altid *kan* finde noget. Modtræk: tærskler pr. region og
  stopbetingelsen "tre iterationer uden accept" — ikke "ingen fund tilbage".
- **RISK-003**: Referencen er et malet billede af en UI, ikke en UI. Nogle
  områder er fysisk uopnåelige i HTML (håndmalet lys på hver enkelt sten).
  Modtræk: regionstærskler sættes individuelt, og `scene`-regionen får en
  lavere tærskel end `header`.
- **RISK-004**: Kunstkøen vokser hurtigere end den tømmes, og sløjfen
  rapporterer "blokeret" hver kørsel. Det er **det rigtige svar** og skal ikke
  skjules — men det betyder også, at systemets værdi først indløses, når
  billedgenerering er ordnet (i dag blokeret: Gemini-kvote 0, Higgsfield uden
  kredit).
- **ASSUMPTION-001**: Referencens layout er nåeligt med den nuværende DOM-struktur.
  Understøttes af `design-visual-target-1.md`s hovedfund: mockuppen er *en anden
  hud på den samme maskine* — hver komponent findes allerede.
- **ASSUMPTION-002**: Fem metrikker er nok til at gøre fund entydige. Viser det
  sig, at to forskellige defekter giver samme fem tal, skal en sjette tilføjes
  frem for at lade dommeren gætte.

## 8. Related Specifications / Further Reading

- `plan/design-visual-target-1.md` — hvad der skal bygges; denne plan måler det.
- `plan/design-title-screen-1.md` — titelskærmens tre manuelle runder, som
  motiverede dette system.
- `DESIGN.md` — lov for alt visuelt; vinder over referencen ved konflikt (REQ-002).
- `docs/design/ux-checklist.md` og `tools/ux_audit.mjs` — den eksisterende
  adfærdsdommer. Dette system er dens visuelle modstykke og skal følge samme
  form: en rigtig browser, eksplicit register, kør-og-fejl.
