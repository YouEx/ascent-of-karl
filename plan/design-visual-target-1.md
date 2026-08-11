---
goal: Gøre The Ascent of Karl visuelt identisk med referencebilledet af 10-08-2026 — malet pergament-æstetik, illustrerede elementer, hulemaleri-motiver
version: 1.0
date_created: 2026-08-11
last_updated: 2026-08-11
owner: Martin (YouEx)
status: 'In progress'
tags: [design, assets, refactor, architecture]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Referencebilledet viser en **anden hud på den samme maskine**. Det er hovedfundet i
denne plan, og det ændrer hele omkostningsbilledet: hver eneste komponent i mockuppen
findes allerede i spillet — titellinje med tæller, fortællerkort, akt-badge,
krønikekort med tidslinje, problem-chips, to slots med plus imellem, Combine, søgefelt,
"New finds" og element-grid med navne under. Ingen ny sløjfe, ingen ny tilstand, ingen
ny navigation.

Forskellen ligger i tre lag, i faldende rækkefølge efter arbejdsmængde:

1. **Elementerne er malede illustrationer, ikke emoji.** 187 stk. Dette er alene
   ~80 % af arbejdet i planen.
2. **Fladerne er pergament, ikke fladt creme**, og lærredet er et malet landskab,
   ikke en gradient. Paletten skifter fra kølig-neutral til varm tan med en ny
   mørkeblå accent.
3. **Hulemaleri-motiverne er tilbage** som ornament (fortællerens jæger, krønikens
   dyrefrise, Karl-flisen i titellinjen).

Planen er skrevet så **arbejdet kan sendes i drift løbende**. Det er ikke pynt: 187
illustrationer bliver ikke færdige i én omgang, og playtest-runde 1 må ikke vente på
dem. Derfor er elementkunst additiv og valgfri pr. element med emoji som permanent
fallback (REQ-004) — huden kan gå live i denne uge, og billederne kan dryppe ind
bagefter uden en eneste kodeændring.

## 1. Requirements & Constraints

### Kilde og sandhed

- **REQ-001**: Referencen er `docs/design/reference/target-2026-08-11.webp` (Martins
  billede af 11-08-2026). Alle farver herunder er **pixelsamplet som regionsmedianer**
  fra den fil, ikke gættet — samme metode som `DESIGN.md` §2 blev bygget med.
- **REQ-002**: `DESIGN.md` er lov for alt visuelt (CLAUDE.md regel 8). Mockuppen
  **modsiger** den nuværende `DESIGN.md` tre steder (CON-001, CON-002, CON-003).
  Derfor skal `DESIGN.md` opdateres **først**, i fase 1, før én linje CSS ændres.
  Gøres det i modsat rækkefølge, er hver efterfølgende commit i strid med repoets
  egen styrende regel.
- **REQ-003**: Al ny farve, radius, skygge og typografi findes som token i
  `src/ui/tokens.css`. Rå hex-værdier i `style.css` er forbudt.

### Leveranceform

- **REQ-004**: Elementkunst er **additiv og valgfri pr. element**. Mangler filen,
  vises emojien. Ingen kodeændring pr. leveret illustration — kun en fil.
- **REQ-005**: Huden (fase 2-5) skal kunne gå live **uden** at en eneste
  elementillustration findes. Playtest-runde 1 blokeres ikke af kunst.
- **REQ-006**: Alle 8 render-steder der viser en emoji i dag skal gå gennem ét
  fælles opslag, ikke hver sin `.emoji`-interpolation. Steder i dag:
  `main.ts` (grid, slots, opdagelseskort, trofæ, slutskærm, challenge-banner),
  `book.ts` (fane, opslag, tidslinje-SVG).

### Ydelse

- **REQ-007**: Initialvisningen må kun hente kunst til de **13 base-elementer**,
  baggrunden og teksturerne. De resterende 174 hentes dovent (`loading="lazy"`)
  efterhånden som de opdages.
- **CON-001**: **Typografireglen brydes.** `DESIGN.md` §3 siger *"serif er
  fortællerens verden, sans er spillerens værktøj"*. Mockuppen sætter **også**
  elementnavne, chips, slot-tekst, søgefelt og Combine i serif. Enten opgives reglen,
  eller også afviger vi bevidst fra mockuppen. **Kræver Martins beslutning** (ALT-001).
- **CON-002**: `DESIGN.md` §1 erklærer hulemaleri-æstetikken for **ophævet**
  ("den var altid markeret som midlertidig"). Mockuppen genindfører den som ornament.
  Sætningen skal omskrives, ellers modsiger dokumentet sig selv.
- **CON-003**: `DESIGN.md` §4 beskriver element-fliser som *"emoji over navn"*.
  Erstattes af illustration over navn, med emoji som fallback.
- **CON-004**: Vægtbudget. Spillet vejer i dag ~205 kB JS + 25 kB CSS + ~250 kB
  skrifter. 187 illustrationer à ~8 kB WebP ≈ **1,5 MB** — 3× hele den nuværende
  pakke. Baggrundsmaleriet alene bliver den tungeste enkeltfil. Doven indlæsning og
  responsive varianter er derfor et krav, ikke en optimering.
- **CON-005**: `public/` er ikke hashed af Vite. Elementkunst lægges i `public/art/`
  med forudsigelige navne (`<element-id>.webp`), fordi opslaget sker på id.
  Cache-invalidering håndteres af et versionsnummer i stien, ikke af filnavnet.
- **GUD-001**: Aktiver **genereres, redigeres aldrig i hånden** (CLAUDE.md regel 9).
  Det gælder også de 187 illustrationer: konsistensen skal komme fra en
  normaliserings-pipeline, ikke fra disciplin.
- **PAT-001**: Følg mønsteret fra `tools/social/` — HTML/kilde ind, script bygger,
  resultatet committes. Samme form for elementkunsten.

### Fælder i mockuppen (må ikke kopieres blindt)

- **CON-006**: Slots i mockuppen siger *"Drag or choose from below"*. **Drag blev
  bevidst fjernet 2026-08-07** (`main.ts` linje 545: en drag-gestus der starter på et
  element stjæler den lodrette scroll i et langt grid). Teksten lover en interaktion
  spillet ikke har. Skal skrives om til *"Choose from below"*.
- **CON-007**: Mockuppens tæller viser et ikon + `1/50`. Spillet bruger i dag
  emojien `⏳` i titellinjen (`main.ts` linje 223) — det er **emoji i krom** og dermed
  et brud på `DESIGN.md` §8, som allerede står i koden. Rettes med denne plan.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Gøre `DESIGN.md` til en sand beskrivelse af målbilledet, så alt
  efterfølgende arbejde har en lovlig kilde. Ingen kodeændringer i denne fase.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Læg referencebilledet i repoet som `docs/design/reference/target-2026-08-11.webp`, så planen ikke peger på en fil i `/tmp`. | ✅ | 2026-08-11 |
| TASK-002 | Omskriv `DESIGN.md` §2 (Farvepalette) til den samplede palet: pergament `#ECDCC7`, krønikepergament `#EEE0CD`, flise `#E7D3BA`, flisekant `#D8BFA5`, felt `#E2CDB9`, slot `#DEC6B0`, stiplet kant `#CBB19E`, ramme `#CCADAB`, titellinje `#DCC9BC`, Combine-flade `#BC9776` med kant `#A88263`, akt-badge navy `#22384E`, aftenglød `#F5D9AC`. Behold `Ink`-familien. | ✅ | 2026-08-11 |
| TASK-003 | Afgør CON-001 (serif vs. sans) og skriv beslutningen ind i §3 med begrundelse. Dette er den eneste opgave i planen der **kræver Martin**. | ✅ | 2026-08-11 |
| TASK-004 | Omskriv §1 så hulemaleri-motivet er genindført som **ornament på pergament** (ikke den ophævede mørke læder-æstetik), og fjern selvmodsigelsen. | ✅ | 2026-08-11 |
| TASK-005 | Omskriv §4 "Element-fliser" til illustration over navn med emoji-fallback, og tilføj afsnit om pergamenttekstur, revne kanter og udskåret Combine-knap. | ✅ | 2026-08-11 |
| TASK-006 | Tilføj §9 "Elementkunst" med stilkontrakt: motiv centreret, lys fra øverste venstre, blød malerisk kant, ingen sort kontur, gennemsigtig baggrund, ingen indbagt skygge, kvadratisk lærred med fast luft omkring. Dette afsnit er prompt-kilden i fase 6. | ✅ | 2026-08-11 |
| TASK-007 | Opdatér §8 (anti-mønstre) så `⏳` i titellinjen udpeges som det brud det er (CON-007), og tilføj forbud mod indbagte skygger i elementkunst. | ✅ | 2026-08-11 |

### Implementation Phase 2

- GOAL-002: Lærred, ramme og pergament. Efter denne fase ligner spillet mockuppen
  på afstand, uden at et eneste element har fået ny kunst.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Producér baggrundsmaleriet (ASSET-001) i tre varianter: desktop 2560×1440, tablet 1440×1080, mobil-portræt 1080×1920 beskåret om dalen. WebP q78. Budget: ≤ 220 kB pr. variant. Vælges via `<picture>`/`image-set()`, aldrig én stor fil til alle. | | |
| TASK-009 | Erstat `--canvas`-gradienten i `tokens.css` med baggrundsbilledet, og behold gradienten som `background-color` under billedet, så siden aldrig blinker hvid før maleriet er hentet. | | |
| TASK-010 | Byg app-rammen: ny wrapper omkring hele spillet med radius, hårfin lys kant (`#CCADAB`), stor blød skygge og let gennemsigtig pergamentflade — mockuppens "vindue" der svæver over landskabet. Skal falde til fuld bredde uden ramme under 768px. | | |
| TASK-011 | Producér pergamenttekstur (ASSET-002) som ét sømløst fliseligt lag + tre uregelmæssige kant-masker. Lægges som `background-blend-mode` over papirfarven, så én tekstur kan bære alle flader uden 6 forskellige filer. | | |
| TASK-012 | Producér revet kant til fortællerkortet (ASSET-003) — SVG-maske frem for PNG, så den skalerer og kan farves med tokens. | | |
| TASK-013 | Lav teksturen mærkbar men diskret: verificér at kontrasten mellem tekst og pergament fortsat er ≥ 4,5:1 efter teksturen er lagt på. Tekstur der koster læsbarhed ryger ud. | | |

### Implementation Phase 3

- GOAL-003: Ornamenterne — de tre hulemaleri-motiver og bogen. Det er dem der giver
  mockuppen sin karakter, og de er få nok til at kunne laves færdige på én dag.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Producér jægerglyffen til fortællerkortet (ASSET-004): okkerfarvet strimmel-figur med spyd, SVG, farvet via token. | | |
| TASK-015 | Producér krønikens dyrefrise (ASSET-005): hjort, kronhjort og jægere, lav opacitet, placeret i højre side af kortet. SVG. Må aldrig ligge bag læsbar tekst (`DESIGN.md` §8: intet overlap). | | |
| TASK-016 | Producér Karl-flisen til titellinjen (ASSET-006): mørk stenflade med Karl som hulemaleri i en hvælving. Rasteriseret PNG/WebP, 96×96 @2x. | | |
| TASK-017 | Producér bogillustrationen (ASSET-007): malet opslået bog, ~256×256 WebP med gennemsigtighed. Erstatter 📖 i krønikekortet. | | |
| TASK-018 | Producér Combine-knappens flade (ASSET-008): udskåret tavle med facet og chevron-ornament. Løses som CSS-gradient + SVG-ornament frem for et bitmap, så knappen kan skifte størrelse og tilstand (disabled/hover/active) uden nye filer. | | |

### Implementation Phase 4

- GOAL-004: Ikonografi og krom. Alle ikoner er vektor i `src/ui/icons.ts` — ingen
  emoji i krom (`DESIGN.md` §8).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Tilføj ikoner til `icons.ts`: `search`, `sparkle` (New finds), `hourglass` (tælleren), `pocketWatch` (tidslinjen), `plus` (badge mellem slots). | | |
| TASK-020 | Fjern `⏳` fra `renderAge()` (`main.ts` linje 223) og brug `icons.hourglass` — lukker CON-007. | | |
| TASK-021 | Tilføj de tre problem-ikoner (frost, hånd, kød). Afgør først ALT-002: ikon i `icons.ts` pr. problem-id, eller nyt `icon`-felt i `content/acts/*.json`. | | |
| TASK-022 | Restyl trofæ- og genstart-knapperne i titellinjen til pergamentflader med kant og 44px berøringsflade, jf. mockuppen. | | |

### Implementation Phase 5

- GOAL-005: Komponenternes finish. Alle findes; de skal have mockuppens form.
  Efter denne fase er spillet 1:1 med mockuppen bortset fra elementkunsten.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | Slots: erstat `?` med spøgelses-ægget, overskrift *"Select an element"* og underlinje **"Choose from below"** — ikke mockuppens "Drag or choose", jf. CON-006. Fyldt slot viser kunst + navn. | | |
| TASK-024 | Plus-badgen mellem slots: cirkulær pergamentflade med kant, ikke et bart `+`-tegn. | | |
| TASK-025 | Akt-badge: fra hvid pille til navy `#22384E` med lys tekst. Kontrollér kontrast ≥ 4,5:1. | | |
| TASK-026 | Problem-chips: ikon + navn, tre tilstande (aktiv/neutral/presserende) adskilt af **kant og ikon**, ikke kun af farve — farveblinde spillere skal kunne se forskel. | | |
| TASK-027 | Søgefeltet: ledende forstørrelsesglas, pergamentflade, indre kant. "New finds" får sparkle-ikon. | | |
| TASK-028 | Tidslinjerækken: erstat trekant-disclosure med lommeur-ikonet og sæt tallet i tabular-nums. | | |
| TASK-029 | Element-fliser: op i størrelse (kunstfelt ~64px over navnet), pergamentflade, blødere kant, tydeligere valgt-tilstand. | | |
| TASK-030 | Layout: spillet skal fylde rammen. I dag står ~40 % af skærmen tom under griddet (verificeret på det live site 11-08-2026). | | |

### Implementation Phase 6

- GOAL-006: Elementkunst-pipelinen. Målet er **ikke** 187 billeder — det er en
  maskine der kan producere dem konsistent, plus de første 13 så spillet ser rigtigt
  ud fra første skærmbillede.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Tilføj `src/ui/art.ts`: ét opslag `artFor(element)` der returnerer `<img>` når `public/art/<id>.webp` findes i det genererede manifest, ellers emojien. Alle 8 render-steder (REQ-006) kaldes om til at bruge det. | | |
| TASK-032 | Tilføj `public/art/manifest.json` genereret af scriptet — koden må ikke gætte på filers eksistens med `onerror`-fallback, da det giver et synligt glimt af en brudt billed-ikon. | | |
| TASK-033 | Byg `tools/art/generate.mjs`: læser stilkontrakten fra `DESIGN.md` §9, bygger én prompt pr. element ud fra `name` + `flavor`, kalder billedmodellen, gemmer råfilen i `tools/art/raw/`. Rå filer committes **ikke**. | | |
| TASK-034 | Byg `tools/art/normalise.mjs` — det er her konsistensen skabes, ikke i prompten: beskær til synligt indhold, centrér på kvadratisk lærred med fast luft, skalér til 256px, farvegradér mod pergamentpaletten, fjern indbagte skygger, skriv WebP q80. Deterministisk og idempotent. | | |
| TASK-035 | Byg `tools/art/contact-sheet.mjs`: alle leverede illustrationer på ét ark i flisestørrelse. Konsistens kan kun bedømmes ved at se dem **ved siden af hinanden i den størrelse de vises**, aldrig én ad gangen i fuld opløsning. | | |
| TASK-036 | Levér de 13 base-elementer først (`sten`, `pind`, `graes`, `vand`, `ler`, `baer`, `larver`, `dyr`, `traestamme`, `nabo`, `fugl` m.fl.) — det er dem der bestemmer førstehåndsindtrykket og dem playtesterne ser. | | |
| TASK-037 | Tilføj `npm run art` og dokumentér i CLAUDE.md's arkitekturliste, som `tools/social/` er det. | | |

### Implementation Phase 7

- GOAL-007: Resten af kunsten, i bølger, uden at blokere noget.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-038 | Akt 1's resterende 172 elementer i tematiske bunker (sten/træ/mad/dyr/værktøj/ild/samfund) — samme bunke i samme kørsel giver indbyrdes konsistens. | | |
| TASK-039 | 15 skæbne-illustrationer til slutskærmen. | | |
| TASK-040 | 3 challenge-illustrationer (`ulve`, `toerke`, `sygdom`). | | |
| TASK-041 | Akt 2's 2 elementer (stub i dag — udvides når akt 2 skrives). | | |
| TASK-042 | Ydelsesmåling til sidst: samlet vægt, LCP og antal forespørgsler på førstevisning, målt mod baseline taget før fase 2. | | |

## 3. Alternatives

- **ALT-001**: *Serif overalt (som mockuppen) vs. fastholde sans i UI.* Mockuppen
  sætter alt i serif. Det er varmere og mere bogagtigt, men opgiver den regel der i
  dag adskiller fortællerens stemme fra spillerens værktøj — og lange lister af
  serif-etiketter i småstørrelse læses langsommere. **Tredje vej:** serif på alt
  narrativt *og* på elementnavne (de er indhold), sans på rene betjeningsflader
  (søgefelt, knapper, tællere). **VALGT 11-08-2026** af Martin. Skrevet ind i
  `DESIGN.md` §3 som en *mekanisk* regel frem for en smagsregel: kommer strengen
  fra `content/*.json` eller fortællerens mund, er den Fraunces; er den skrevet i
  grænsefladen, er den Plus Jakarta Sans. Fordelen ved den formulering er at
  svaret kan slås op i kodebasen i stedet for at blive diskuteret.
- **ALT-002**: *Problem-ikoner i `icons.ts` vs. `icon`-felt i content.* Content-feltet
  skalerer til akt 2 uden kodeændring; `icons.ts` holder krommet emoji-frit og
  vektorbaseret. Anbefaling: `icons.ts` med et opslag på problem-id, da antallet af
  problemer er lille og fastlagt pr. akt.
- **ALT-003**: *Sprite-atlas vs. enkeltfiler pr. element.* Et atlas sparer
  forespørgsler, men ødelægger doven indlæsning: man henter alle 187 for at vise én.
  Med HTTP/2 på GitHub Pages er enkeltfiler + `loading="lazy"` det rigtige valg.
- **ALT-004**: *Håndtegnet kunst vs. genereret + normaliseret.* 187 håndtegnede
  illustrationer er måneders arbejde og kan ikke gentages når stilen justeres.
  Afvist af samme grund som delekortet (CLAUDE.md regel 9).
- **ALT-005**: *Beholde emoji helt.* Billigst og fungerer i dag — men mockuppens
  hele karakter ligger i de malede fliser. Emoji gør spillet til en prototype.

## 4. Dependencies

- **DEP-001**: En billedmodel med gennemsigtig baggrund og reproducerbar stil.
  Kandidater: `higgsfield` MCP (allerede opsat), eller den model Martin lavede
  mockuppen med. Skal afklares før TASK-033.
- **DEP-002**: ImageMagick (`magick`) — allerede hård afhængighed for
  `tools/social/render.mjs`. Genbruges til normaliseringen.
- **DEP-003**: `sharp` eller ImageMagick til WebP-konvertering i batch.
- **DEP-004**: Ingen nye runtime-afhængigheder. Alt kunstarbejde sker i byggetid.

## 5. Files

- **FILE-001**: `DESIGN.md` — §1, §2, §3, §4, §8 omskrives; nyt §9 om elementkunst.
- **FILE-002**: `src/ui/tokens.css` — hele papir- og lærredspaletten udskiftes,
  nye tokens for tekstur, ramme og navy accent.
- **FILE-003**: `src/ui/style.css` — ramme, pergament, chips, slots, fliser, felter.
- **FILE-004**: `src/ui/main.ts` — 6 render-steder til `artFor()`, `⏳` ud, slot-tekst.
- **FILE-005**: `src/ui/book.ts` — 3 render-steder til `artFor()`.
- **FILE-006**: `src/ui/icons.ts` — 5 nye krom-ikoner + 3 problem-ikoner.
- **FILE-007**: `src/ui/art.ts` — **ny.** Opslaget med emoji-fallback.
- **FILE-008**: `tools/art/generate.mjs`, `normalise.mjs`, `contact-sheet.mjs` — **nye.**
- **FILE-009**: `public/art/*.webp` + `manifest.json` — **nye**, genereret.
- **FILE-010**: `public/bg/*.webp` — **nye**, baggrundsmaleriets tre varianter.
- **FILE-011**: `docs/design/reference/target-2026-08-11.webp` — **ny**, referencen.
- **FILE-012**: `CLAUDE.md` — arkitekturlisten får `tools/art/` og `src/ui/art.ts`.
- **FILE-013**: `tools/ux_audit.mjs` — tærskler for kontrast og berøringsflader
  gentjekkes efter paletskiftet.

## 6. Testing

- **TEST-001**: Enhedstest af `artFor()`: element med kunst i manifestet giver
  `<img>`; element uden giver emojien; ukendt id kaster ikke.
- **TEST-002**: `normalise.mjs` er idempotent — samme input to gange giver
  byte-identisk output.
- **TEST-003**: Alle filer i `public/art/` har præcis samme dimensioner og
  farverum efter normalisering. Kører i CI som et hårdt gate.
- **TEST-004**: Hvert id i `manifest.json` findes i `content/elements.json`, og
  ingen fil ligger i `public/art/` uden at stå i manifestet.
- **TEST-005**: `npm run ux` — alle 28 checks fortsat grønne efter paletskiftet,
  særligt kontrast og 44px-flader.
- **TEST-006**: Visuel QA i browser ved mockuppens egen opløsning (1448×1086) plus
  390×844 mobil. Skærmbilleder **ses igennem af mig selv**, ikke af Martin.
- **TEST-007**: Kontaktark for elementkunsten gennemses ved flisestørrelse efter
  hver bølge — det er den eneste gyldige konsistenstest.
- **TEST-008**: Ydelse: førstevisning må ikke hente mere end de 13 base-illustrationer.
  Verificeres ved at tælle netværksforespørgsler til `/art/` på en frisk indlæsning.
- **TEST-009**: Baggrundsmaleriet må ikke give vandret scroll eller layout-hop på
  mobil, og fallback-farven skal være synlig før billedet er hentet.

## 7. Risks & Assumptions

- **RISK-001**: **Stildrift over 187 billeder.** Den største risiko i planen. En
  diffusionsmodel giver ikke samme streg 187 gange. Modvirkes af normaliserings-
  pipelinen (TASK-034), tematiske bunker (TASK-038) og kontaktarket (TASK-035) —
  ikke af bedre prompts.
- **RISK-002**: **Vægten løber løbsk.** 1,5 MB kunst plus et baggrundsmaleri kan
  gøre spillet mærkbart langsommere på mobil. Modvirkes af REQ-007 og TEST-008.
  Hvis budgettet sprænges, skæres opløsningen til 192px før antallet skæres.
- **RISK-003**: **Pergament koster læsbarhed.** Tekstur bag tekst sænker kontrast.
  TASK-013 er indsat netop for at fange det, og teksturen taber ved konflikt.
- **RISK-004**: **Mockuppen er ét skærmbillede.** Den viser ikke slutskærm, bog,
  trofæskab, opdagelseskort, challenge-banner eller mobilvisning. De arver paletten,
  men deres form er stadig udesignet — forvent en runde mere på dem.
- **RISK-005**: **Illustrationer kan gøre spillet mindre sjovt.** Emoji er
  generiske og derfor lidt absurde; en smuk malet larve er mindre morsom end 🐛.
  Playtest-runde 1 spilles på den nuværende hud, så vi har et sammenligningsgrundlag.
- **ASSUMPTION-001**: Referencebilledet er et **mål**, ikke et forslag — 1:1 er
  ordren, bortset fra de steder hvor mockuppen modsiger en truffet beslutning
  (CON-006) eller en tilgængelighedsregel.
- **ASSUMPTION-002**: Akt 2 forbliver en stub i denne omgang; dens 2 elementer
  får kunst, men der planlægges ikke for en akt-2-palet endnu.
- **ASSUMPTION-003**: Der findes en tilgængelig billedmodel der kan levere
  gennemsigtig baggrund. Kan den ikke, tilføjes et baggrundsfjernelses-trin i
  `normalise.mjs`, hvilket koster kvalitet på hår og fjer.

## 8. Related Specifications / Further Reading

- `DESIGN.md` — det styrende designsystem (skal opdateres først, fase 1)
- `CLAUDE.md` regel 8 (DESIGN.md er lov) og regel 9 (aktiver genereres)
- `tools/social/render.mjs` — mønsteret denne plans kunst-pipeline kopierer
- `docs/design/ux-checklist.md` — ingen blindgyder; gælder også nye flader
- `docs/playtest/README.md` — runde 1 spilles på den nuværende hud (RISK-005)
- `ROADMAP.md` prioritet 4 — "Karl som synlig figur", som denne plan realiserer
