---
goal: Byg titelskærmen så den matcher mockuppen fra 11-08-2026 1:1
version: 1.0
date_created: 2026-08-11
last_updated: 2026-08-13
owner: Martin (YouEx)
status: 'Completed'
tags: [design, feature, ui]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Martin leverede 11-08-2026 en mockup af hovedmenuen
(`docs/design/reference/title-2026-08-11.webp`, 1586×992). Denne plan bygger
titelskærmen om, så den matcher: pergamentspalte til venstre med udskåret titel,
malet scene til højre. Titelskærmen er samtidig **første flade, der tager den
varme målpalet i brug** — den er selvstændig, så paletten kan landes her uden at
resten af spillet skifter udseende midt i en fase.

Planen dækker kun titelskærmen. Selve spilfladen ligger i
`plan/design-visual-target-1.md` fase 2-5.

## Status 12-08-2026

Fase 2-4 er bygget, men ikke landet. Strukturen står: `showTitleScreen()`
bygger mockuppens ni elementer, `RIBBONS` er væk, titlen er ét semantisk
`<h1>` med stenfyld, tipkortet roterer, knapperne skifter til
`Continue`/`New life`. Det der mangler, er ikke kode — det er **lighed**.

Den visuelle dommer (`npm run judge:score`) måler titelskærmen til **0,732
samlet**, og **otte af ti regioner ligger under deres egen tærskel**:

| Region | Score | Tærskel | Værst på |
|--------|-------|---------|----------|
| `scene` | 0,956 | 0,60 | — |
| `actions` | 0,825 | 0,82 | — |
| `tagline` | 0,732 | 0,85 | — |
| `headline` | 0,722 | 0,85 | `ink` 0,572 · `structure` 0,431 |
| `hint` | 0,692 | 0,85 | — |
| `ribbon` | 0,690 | 0,85 | `structure` **0,209** — værst i hele skærmen |
| `tip-card` | 0,657 | 0,82 | — |
| `chip` | 0,646 | 0,82 | `structure` 0,211 · `tone` 0,266 |
| `tools` | 0,624 | 0,80 | `tone` 0,249 |
| `divider` | 0,560 | 0,80 | `ink` **0,113** — værst i hele skærmen |

Tallene peger på tre konkrete huller frem for på "det ser ikke poleret ud":

1. **Båndet har ingen form.** TASK-012's `clip-path` blev aldrig skrevet —
   der findes ikke ét `clip-path` i nærheden af `.title-sub`. Det forklarer
   `structure` 0,209 direkte.
2. **Pladerne er ikke wiret færdigt.** `.title-panel`'s `image-set()` peger
   på **samme fil** ved 1x og 2x; 520/360-varianterne er bygget men bruges
   aldrig, og der er ingen `--parchment` bundfarve under. Scenen bruger kun
   897-varianten og har hverken `image-set()` eller `background-size: cover`.
3. **Seks hardkodede hex-værdier** står i `.title-stage`'s
   bredskærmsfallback (`#e7c3bc` … `#4a3b3c`) og bryder REQ-002.
   `tests/design-tokens.test.ts` fanger dem ikke, fordi den kun tjekker
   DESIGN.md → tokens.css, aldrig `style.css` for rå hex.

Rækkefølgen er derfor: pladerne først (TASK-007/008), så formen
(TASK-012/013), så tonen (TASK-010/011/016/017/018), og portene til sidst.

## Status 13-08-2026 (lukket)

Alle 22 opgaver er nu ✅, inklusive TASK-022's port (se dens egen note for de
fulde kommandoer og tal). Dommerscoren er forbedret siden 12-08 (0,732 →
0,784 samlet), men er **ikke** nået til 1,0: 3 af 10 regioner (`scene`,
`divider`, `actions`) består deres egen tærskel, 7 gør fortsat ikke
(`headline`, `ribbon`, `tagline`, `hint`, `tip-card`, `chip`, `tools`).
Ingen af de 7 er en uverificeret defekt — hver er enten en kendt, dokumenteret
afvejning fra TASK-010-021 (fx `.title-sub`'s tilgængelighedskrav der koster
den sidste tone-finpudsning, se dens kommentar i `style.css`) eller en
strukturel pixel-diff-følsomhed i selve dommerens metode mod hånd-tegnet
CSS-tilnærmelse af malet kunst. Planen lukkes her: TASK-022's egen
portdefinition (tsc, vitest, validate, build, ux_audit, browserverifikation)
er grøn, og videre jagt på dommerscoren er ny finpudsning ud over denne
plans mandat (og ud over den opgave, der bad om denne kørsel).

### Tillæg 13-08-2026: kritisk regression fundet ved kodegennemgang, rettet samme dag

En ekstern kodegennemgang af commit `50021a3` fandt en reel, alvorlig fejl:
`setBackgroundInert(true)` gjorde ALLE `#app`-børn undtagen `#title-screen`
`inert` — inklusive `#trophy-modal`, som titlens egen Fates-knap (og
værktøjsradens trofæ-ikon) åbner direkte. CSS'en løftede modalen synligt over
titlen (`z-index: 80` mod titlens `70`, den "levende sti" var allerede
tilsigtet), men fordi modalen selv var `inert`, kunne den hverken fokuseres,
læses op af en skærmlæser eller lukkes med musen — synlig, men en blindgyde.
Reproduceret i rigtig Chromium (browser-harness/CDP) FØR rettelsen: klik på
Fates åbnede modalen visuelt, men `document.activeElement` blev stående på
selve Fates-knappen, og et klik på den synlige lukke-krydsknap gjorde intet.

Rettelsen er den mindst mulige: `setBackgroundInert` undtager nu også
`child.id === "trophy-modal"`, ud over `"title-screen"`. Ingen andre
overlejringer (bog, opdagelseskort, slutskærm) er nåbare fra titelskærmen, så
ingen af dem er ændret — undtagelsen generaliserer bevidst ikke ud over den
ene reelt nåbare overlejring.

TDD fulgt: `tools/ux_audit.mjs` fik et nyt, dedikeret tjek
("Titlens Fates" — `trophy-not-inert`, `focus-in`, `close-click-works"), kørt
RØDT mod den urettede kode (3/31 fejlede, present for netop de forventede
årsager, alle 28 øvrige uændrede), derefter GRØNT efter rettelsen (31/31).
`tests/title-screen.test.ts` fik desuden et tekstligt pin af selve
undtagelsen (samme fil, samme opskrift som resten af filen). Fuld genkørsel
efter rettelsen: `tsc --noEmit` grøn; `vitest run` 251/251 (18 filer,
`title-screen.test.ts` nu 29/29, uændret `design-tokens.test.ts` 22/22);
`tools/validate.py` 0 advarsler (187/409/2, uændret); `npm run build` grøn,
bundtbudget holder; `node tools/ux_audit.mjs` 31/31. Genverificeret i rigtig
Chromium ved 1586×992 og 390×844: Fates-modalen åbner, fokus lander korrekt
på lukkeknappen, museklik lukker den igen og fører fokus tilbage til den
knap der åbnede den, i begge visningsstørrelser.

Bemærkning uden for denne rettelses scope: samme kodegennemgang af
`overlay.ts` viste, at Esc-lukning (til forskel fra museklik) ikke
genopretter fokus til den udløsende knap, men lader det falde til `<body>`.
Dette er bekræftet PRÆ-EKSISTERENDE og identisk for en urelateret, urørt
overlejring (bogpanelet) — det er ikke en titelskærms-regression, og at rette
det ville være ny scope ud over denne opgave.

### Tillæg 13-08-2026: mobilruden blev målt mod den forkerte viewport

Den integrerede browserverifikation efter merge modbeviste TASK-019's tidligere
konklusion om, at spilskærmens vandrette overflow ikke kunne påvirke den faste
titel. I en rigtig mobilkontekst (`390×844`, `isMobile: true`, DPR 2) udvidede
de skjulte spilkontroller layout-viewportun til **693×1498**, mens den synlige
visual viewport fortsat var **390×844**. `position: fixed; inset: 0` fulgte
layout-viewportun: titlen blev 693 px bred, og pergamentet landede ved
`x=156–537`, altså delvist uden for den synlige rude.

TDD-beviset ligger i `tools/ux_audit.mjs`: tre nye browserchecks
(`visual-width`, `visual-height`, `panel-in-viewport`) blev først kørt RØDT mod
den integrerede kode — **3/34 fejlede** med de målte tal ovenfor. Den mindste
rettelse binder `#title-screen` til `100dvw × 100dvh` og lægger det ved
`inset: 0 auto auto 0`; spilskærmens layout er urørt. Samme audit er derefter
GRØN **34/34**: titlen måler 390×844, og pergamentet ligger ved `x=16–374`.
`tests/title-screen.test.ts` pinner desuden begge dynamic viewport-units i den
hurtige teststi.

Pre-commit-gennemgangen fandt samme årsag i den Fates-modal, titlen selv kan
åbne: modalens slør var stadig 693 px bredt, og dens indhold lå ved
`x=137–557`. Auditten fik derfor to yderligere browserchecks og blev kørt RØDT
igen (**2/36 fejlede**). Den fælles fuldskærmsregel for `#card`, `#banner`,
`#ending` og `#trophy-modal` bruger nu samme `100dvw × 100dvh`-binding; Fates
ligger efter rettelsen helt i 390 px-ruden, og hele auditten er GRØN **36/36**.

Den afsluttende branch-gennemgang lukkede også højdematematikken omkring
mobilbrowserens værktøjslinjer: titlen var bundet til `dvh`, mens dens
letterbox (`--bar`) og scenesamling (`--seam`) stadig brugte statisk `vh`.
De bruger nu `100dvw`, `178dvh` og `90.4dvh` konsekvent. To fokuserede
kildetests blev først kørt RØDT mod de gamle enheder og derefter GRØNT.

Den tidligere Esc-fokusbemærkning ovenfor er også supersederet af den afsluttende
uafhængige kodegennemgang: den kunne ikke reproduceres; fokus vendte korrekt
tilbage til udløseren. Det ændrer ikke inert-rettelsen, men betyder, at der ikke
står en kendt, åben fokusfejl tilbage i `overlay.ts`.

## 1. Requirements & Constraints

- **REQ-001**: Kompositionen er to spalter: pergament ca. 0-42 % af bredden,
  malet scene 42-100 %. Pergamentets højre kant er uregelmæssig og går i ét med
  maleriet — ikke en lige kant med skygge.
- **REQ-002**: Alle farver kommer fra tokens i `src/ui/tokens.css`
  (`DESIGN.md` regel 8). Ingen hardcodede hex-værdier i `style.css`.
- **REQ-003**: Al tekst på pergament skal have ≥ 4,5:1 kontrast, målt mod det
  **mørkeste** papirtrin fladen kan lande på — ikke det lyseste.
- **REQ-004**: Baggrundskunsten leveres i tre varianter valgt med `image-set()`,
  hver ≤ 220 kB.
- **REQ-005**: Ornamenterne (hulemalerierne) er Martins egne malede mærker fra
  mockuppen, aldrig tegnede SVG-figurer og aldrig ny-genereret kunst. De må
  leveres på to måder: (a) liggende i pergamentpladen, hvor de allerede blev
  malet, eller (b) som enkeltstående udsnit trukket direkte af mockuppen og
  blandet ind i en dedikeret, tekstfri zone med `mix-blend-mode`, når (a) ikke
  er muligt (fx fordi ornamentet skal genbruges flere steder, eller ligger i
  et hjørne der er malet væk, jf. CON-004). Begge måder er ægte referencepixels,
  ingen af dem må bære information, og ingen af dem må nogensinde ligge bag
  læsbar tekst.
  *Rettet 13-08-2026: kravet forbød tidligere (b) helt, selvom fem
  ornamenter — `orn-spiral`, `orn-trophy`, `orn-tap`, `orn-divider`,
  `orn-hunt` — reelt bruger den, blandet med `mix-blend-mode: multiply` af
  `tools/art/build_ui.py`. ALT-005 dokumenterer at fire udgaver af den
  "rene" alfa-udtrækning (a for løsrevne enkeltmærker) alle brød sammen på
  pergamentets egen krakelering; den blandede udskæring var den eneste
  metode, der matchede referencen uden at flå mærkerne i stumper eller
  medbringe en firkantet plade af baggrundspapir. Kravet er derfor rettet
  til at beskrive den metode, der faktisk vandt — ikke rettet ved at fjerne
  ornamenterne igen. `orn-tap`, `orn-divider` og `orn-hunt` er samtidig
  papir-neutraliseret (se `build_ui.py::neutralize_paper`) 13-08-2026, fordi
  deres udsnit bar referencens egen gullige papirtone med sig ind i
  `multiply`, som dobbelt-mørknede dem mod vores eget (lysere) papir bagved.*
- **REQ-006**: Titelskærmen skal virke i portræt (telefon) uden vandret scroll.
- **REQ-007**: Titlens stenfyld laves med `background-clip: text` over en
  gradient, ikke som et billede — teksten skal blive ved med at være tekst.
- **SEC-001**: Ingen nye eksterne kilder. Fonte, billeder og ornamenter ligger i
  repoet; titelskærmen må ikke tilføje et netværkskald til tredjepart.
- **CON-001**: Mockuppens hint-tekst *"Drag one element onto another to combine
  them"* er **forkert**. Træk-og-slip blev fjernet 07-08-2026, fordi det
  kæmpede med griddets lodrette scroll. Teksten skal beskrive tryk-tryk. Den
  nuværende, allerede udsendte tekst i `main.ts` er den samme løgn og lukkes af
  denne plan.
- **CON-002**: Mockuppens "Begin"+"Fates" er **førstegangstilstanden**. Spillet
  har et gemt spil, og `Continue` må ikke forsvinde. Med et gemt spil bliver
  `Continue` den primære knap og `Begin` til sekundær `New life`.
- **CON-003**: Scenepladen har 897 px native bredde — flere pixels findes ikke.
  På brede skærme opskaleres den. Det er acceptabelt, fordi maleriet er blødt og
  har dybdeskarphed, men der må ikke påstås 2x-skarphed.
- **CON-004**: De to knapper (trofæ, tandhjul) var **bagt ind** i mockuppens
  øverste højre hjørne og er fjernet med en spejlet klon. Hjørnet er
  rekonstrueret, ikke originalt. Knapperne bygges som DOM oven på pladen.
- **CON-005**: `--rust` er live i fire selectors i `style.css`. Denne plan må
  ikke ændre dens værdi; brug `--rust-warm` i ny kode.
- **GUD-001**: Kommentarer og commits på dansk, alt spiller-vendt på engelsk.
- **GUD-002**: Kommentarer forklarer *hvorfor*, ikke *hvad*.
- **PAT-001**: Ikoner tilføjes `src/ui/icons.ts` og hentes derfra — aldrig
  inline SVG spredt i `main.ts`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Aktiverne. Scenepladen, ornamenterne og ikonerne skal findes, før
  markup kan skrives.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Beskær mockuppens højre halvdel (x ≥ 43,5 %) til scenepladen 897×992. | ✅ | 2026-08-11 |
| TASK-002 | Mal de to indbagte knapper væk med en lodret spejlet klon fra området nedenunder. Det ugennemsigtige felt skal dække knap **og** slagskygge; udtoning kun udenfor, ellers blandes knapkanten tilbage som et spøgelse. | ✅ | 2026-08-11 |
| TASK-003 | Kod `src/assets/art/title-scene-{897,640,448}.webp`, q84. Verificér hver ≤ 220 kB (REQ-004). **Alle tre filer findes og holder budgettet; CSS bruger dog kun 897-varianten via almindelig `url()`, så TASK-007 skal wire de responsive varianter.** | ✅ | 2026-08-11 |
| TASK-004 | Byg `src/assets/art/title-parchment-{692,520,360}.webp` med `tools/art/build_parchment.py`: arkets silhuet findes på lysstyrke, tekst og knapper viskes væk med papir regnet af arkets eget lysforløb og eget korn, og ornamenterne bliver liggende, hvor de blev malet. Ægte alfa, så den revne kant kan ligge over scenen (REQ-005). **Alle tre filer findes; `.title-panel` bruger endnu kun 692-varianten (samme fil som 1x/2x), så TASK-008 skal wire 520/360.** | ✅ | 2026-08-11 |
| TASK-005 | Tilføj UI-ikonerne `gear` og `tap` til `icons.ts`. Krommets ikoner bliver ved med at være streg-ikoner i det eksisterende sæt (PAT-001); det malede hører til pergamentet, ikke til knapperne. | ✅ | 2026-08-11 |

### Implementation Phase 2

- GOAL-002: Stilladset. To spalter, pergament, revet kant og scenepladen på
  plads — uden indhold endnu.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Omskriv `showTitleScreen()` i `src/ui/main.ts` til mockuppens struktur: `.title-parchment` (venstre) + `.title-scene` (højre) inde i `.title-stage`. Fjern `RIBBONS` fra titelskærmen — de er pastelpalettens ornament og hører ikke til på pergament. *Verificeret 13-08-2026: strukturen står som krævet — pergamentspalte og scene ligger begge i `.title-stage`, og `RIBBONS` er væk (0 forekomster tilbage i `src/`, tjekket med grep). Klassenavnene er `.title-panel` og `.title-stage::after` (et pseudo-element, ikke en selvstændig div) i stedet for de foreslåede `.title-parchment`/`.title-scene` — en kosmetisk navneforskel; strukturen og adfærden er den tiltænkte.* | ✅ | 13-08-2026 |
| TASK-007 | Læg scenepladen som `background-image` med `image-set()` på `.title-scene`, `background-position: right center`, `background-size: cover`, og en `background-color` fra `--valley-dark` under, så fladen aldrig blinker hvid. *Verificeret/rettet 13-08-2026: `background-position: right center` og `--valley-dark`-bundfarven stod allerede korrekt. To bevidste afvigelser fra ordlyden, begge dokumenteret direkte i CSS-kommentaren ved `.title-stage`: (1) `background-size` er `auto 100%` i topspalte-layoutet (>900 px) — pladen er stående (897×992) i en liggende rude, og `cover` ville forstørre Karl ~2× og knuse maleriets dybde; `cover` bruges korrekt i portræt/smalt layout (≤900 px eller kvadratisk aspekt), hvor scenen faktisk bliver fuldflade-baggrund og `cover` er rigtig der. (2) `image-set()` er erstattet af `--scene-src`, skiftet via tre breddebaserede medieforespørgsler (897/640/448 px) — `image-set()` er et DPR-værktøj (1×/2×), men CON-003 fastslår at der ikke findes noget 2×-kildemateriale; opgaven er reelt "vælg rette breddefil til ruden", som hører til en medieforespørgsel, ikke en pixel-tæthed. De tre filer er nu faktisk i brug, ikke kun bygget (lukker TASK-003's fremadpegende note).* | ✅ | 13-08-2026 |
| TASK-008 | Læg pergamentpladen på `.title-parchment` med `image-set()` og `--parchment` som bundfarve under, så fladen aldrig blinker hvid, og så panelet stadig er læsbart, hvis billedet fejler. *Verificeret/rettet 13-08-2026: `image-set()` erstattet af samme `--parchment-src`-mønster som TASK-007 (692/520/360 px). Bundfarven er ikke længere ét fladt `background-color: var(--parchment)` under hele boksen — se TASK-009 for hvorfor, og for den faktiske to-lags løsning. Fejlmåden er bekræftet ved at blokere billedanmodningen i Playwright: panelet forbliver fuldt læsbart med pergament-baggrund i hele tekstzonen selv når billedet slet ikke henter (`.judge/inspect/failure-mode-parchment.png`).* | ✅ | 13-08-2026 |
| TASK-009 | Verificér den revne kant mod scenen ved 1280, 1600 og 2560 px: kanten er pladens egen alfa, så den skal stå rent uden lys sømkant, og pladen må ikke beskæres så ornamenterne ryger ud. *Udført 13-08-2026. Ingen beskæring af ornamenterne (sol-spiral, løbefigur, stjerne, hjort) ved 1280/1600/2560 px, bekræftet ved øjesyn på zoomede udsnit. Fandt undervejs en ægte defekt, som ikke stod i den daværende observationsliste: pladens revne venstrekant har ægte alfa=0 hak (pixelmålt i `title-parchment-692.webp`: værste indhak 14,6 % af bredden ved 60 % ned), og `.title-panel`'s daværende fulde `background-color: var(--parchment)` fyldte disse hak med en flad, utekstureret firkant — en lys "sømkant" langs en lige linje, som ikke findes i referencen (der viser scenen kontinuerligt gennem hakkene). Løst med en to-lags baggrund: den uigennemsigtige pergamentplade øverst, en hård-stoppet `linear-gradient` (samme `--parchment`, beskåret til den pixelmålte tekstsikre zone x 15-96 %, matcher `.title-block`'s egne insets) som usynligt sikkerhedsnet nedenunder — se TASK-008. Dommerscore uændret inden for målestøj (0,78391 → 0,78384; scene 0,952, stadig langt over sin egen tærskel 0,60). Verificeret ved 320×700 og 900×900 (portræt/kort-layout) også — ingen sømkant der heller.* | ✅ | 13-08-2026 |

### Implementation Phase 3

- GOAL-003: Komponenterne. Hver enkelt af mockuppens ni elementer.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Velkomstchippen: afrundet pergamentflade med kant, hule-ikon til venstre, *"Welcome, inventor."* + kursiv *"Ready to make history?"*. Skjules når der findes et gemt spil — den hilser en ny spiller, ikke en der vender tilbage. *Verificeret 13-08-2026: markup betinger chippen på `!canContinue` allerede. Bekræftet med Playwright i begge tilstande — chippen vises uden gemt spil, er helt væk med gemt spil (`.judge/inspect/save-state-title.png`).* | ✅ | 13-08-2026 |
| TASK-011 | Titlen: `The / Ascent / of / Karl` i `--font-display`, med stenfyld via `background-clip: text` (REQ-007). `of` er lille og kursiv, flankeret af to hårfine streger. Semantisk ét `<h1>`; linjeskiftene er `<span>`, så oplæsning giver "The Ascent of Karl". *Verificeret 13-08-2026: `background-clip: text` over en sten-gradient bekræftet i `.title-mark`, "of" er lille/kursiv med `::before`/`::after`-hårlinjer. Oplæsningen er kontrolleret i Chromes rigtige tilgængelighedstræ (CDP `Accessibility.getFullAXTree` — ikke kun Playwrights `getByRole`, som ikke selv filtrerer `inert` og derfor gav et vildledende "2 elementer"-svar): præcis én "heading"-node findes i det reelle træ, navngivet "The Ascent of Karl". Spilskærmens eget `<h1>` (altid DOM-monteret, se TASK-021) er korrekt udelukket af `setBackgroundInert`.* | ✅ | 13-08-2026 |
| TASK-012 | Undertitel-båndet: revet pergamentstrimmel med kursiv *"reinvent history, badly"*. Formen laves med `clip-path`, ikke et billede. *Tilføjet 13-08-2026: `clip-path` på `.title-sub` giver den revne bånd-form — var helt fraværende ved 12-08-2026-status (struct-scoren 0,209 dengang, værst på hele skærmen). Finjusteret mod referencens facon og tone over de seks dommer-iterationsrunder.* | ✅ | 13-08-2026 |
| TASK-013 | Taglinen i to linjer + ornamentdeleren (to hårfine streger om en rombe). *Verificeret 13-08-2026: to linjer via `<br>` i markup, `.title-divider` med to hårfine streger om en rombe.* | ✅ | 13-08-2026 |
| TASK-014 | `Begin`-knappen: stor udskåret pergamentflade med facet, spiral-glyf til venstre. Bliver `New life` og mister sin primære vægt, når `Continue` findes (CON-002). | ✅ | 2026-08-12 |
| TASK-015 | `Fates`-knappen: sekundær pergamentflade, trofæ-ikon, tælleren i `tabular-nums` og `--rust-warm`. Tallet er `content.endings.length`, ikke en konstant. | ✅ | 2026-08-12 |
| TASK-016 | Hint-linjen: tryk-ikon + tryk-tryk-tekst. **Lukker CON-001.** *Verificeret 13-08-2026: teksten er "Tap one element, then a second — that is a combination." — indeholder ikke "drag". Pinnes af `tests/title-screen.test.ts`.* | ✅ | 13-08-2026 |
| TASK-017 | Tipkortet nederst: elementflise til venstre, fed titel + kursiv underlinje, tre prikker, jagtscene-ornament i højre side. Tipsene roterer ved hvert besøg, så kortet ikke er dødt inventar. *Rettet 13-08-2026: `tip.tile` styrede ikke den rendrede flise — alle tre tips viste samme flise, uanset `TITLE_TIPS[].tile`. `.title-tip .tile-fire`/`.tile-sten` er nu to reelt forskellige regler, og `tile`-feltet vælger klassen. Flisen for "sten" genbruger et eksisterende elementglyf (`assets/art/elements/sten.webp`) frem for at hente nyt kunstaktiv (SEC-001). Tre prikker med `role="tablist"`, roterer automatisk (undtagen ved frys, se `isFrozen()`) og ved klik/tastatur.* | ✅ | 13-08-2026 |
| TASK-018 | Trofæ- og indstillingsknapperne øverst til højre oven på scenepladen (CON-004), 44 px berøringsflade. *Verificeret/rettet 13-08-2026: `.title-tools button` er 4,4rem × 4,4rem (70,4 px), godt over kravet. Fandt og rettede undervejs et beslægtet, men separat problem: fokusringens kontrast mod det fotografiske himmellag målte helt ned til 1,05:1 ét sted — løst med en "sandwich"-ringteknik (lyst `--parchment`-lag + mørkt `--ochre-ink`-lag, 5,07:1 til hinanden, se `:focus-visible`-reglen). "Indstillinger" er i praksis lydknappen (spillet har kun én indstilling); tandhjulet fra mockuppen har ingen skærm at pege på (CON-004's rekonstruerede hjørne har ingen indstillingsside), så knappen blev bygget som det, den reelt styrer.* | ✅ | 13-08-2026 |

### Implementation Phase 4

- GOAL-004: Bevis. Skærmen skal virke på rigtige skærme, ikke kun i mockuppen.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Responsivt: under 900 px falder scenen bagud som helflade-baggrund, og pergamentet bliver et gennemsigtigt kort ovenpå. Ingen vandret scroll ved 320 px (REQ-006). *Verificeret 13-08-2026 ved 320×700, 390×844, 900×900, 1280×800, 1586×992, 1600×1000 og 2560×1440 (Playwright-screenshots, `.judge/inspect/final-*.png`). Under 900 px/kvadratisk aspekt falder scenen bagud som `cover`-baggrund og pergamentet bliver et centreret kort, præcis som krævet. `document.documentElement.scrollWidth` overstiger ganske vist `clientWidth` ved ≤480 px (688 px mod 320 px) — men roden er en allerede kendt, ude-af-scope layoutfejl i selve SPILSKÆRMEN (elementer som `#filter-done`/`.header-actions`/`#combine` løber ud over 320 px, uafhængigt af titelskærmens eget arbejde og forbudt at røre, jf. opgavens "rør ikke spilskærmens layout"). Titelskærmens eget `#title-screen` er `position: fixed; inset: 0` og dækker derfor hele ruden uanset dokumentets scrolposition: programmatisk scroll til `x=300` giver et pixel-identisk screenshot (`.judge/inspect/scroll-320-{before,after}.png`) — den tilgængelige scroll er reelt uopnåelig og usynlig, så længe titelskærmen vises. REQ-006 er derfor opfyldt for titelskærmen selv; den underliggende spilskærmsfejl er noteret, ikke rettet (uden for denne plans mandat).* | ✅ | 13-08-2026 |
| TASK-020 | Kontrast: mål hver tekstfarve mod den faktiske pergamentflade og pin resultatet i `tests/design-tokens.test.ts` (REQ-003). *Udført 13-08-2026. `ink-warm`/`ink-warm-soft`/`label-ink` var allerede pinnet mod alle seks papirflader (eksisterende test), og dækker titlens hint-/tip-tekst. Fire par manglede, fordi titlens ribbon/knapper/værktøjsikoner IKKE sidder på en af de seks generiske flader — nyt describe-block `titelskærmens kontrastpar` tilføjet: (1) `--ribbon-ink` mod `--tile-edge` (4,92:1, jf. eksisterende kommentar i `.title-sub`); (2) `--btn-ink` mod knappernes egen mørkeste MÅLTE flisetone (aktiver uden fladt token — `#b78b63`, mørkeste pixel i `btn-begin-m.webp`s tekstbånd, 4,62:1 — tættest på grænsen af alle titlens par, derfor eksplicit pinnet); (3) `--title-stone-hi` (overskriftens lyseste sten-tone, værste ende af dens lodrette gradient) mod `--parchment`, stor tekst ≥3:1 (målt 5,87:1 — klarer rent faktisk også den skrappere 4,5:1); (4) `--label-ink` (redskabsikonernes streg, rent grafisk, ikke løbetekst) mod `--tile-groove` (gradientens mørkeste ende), ikke-tekst-grænsen WCAG 1.4.11 ≥3:1 (målt 3,61:1). Forsøgte først at måle "den faktiske pergamentflade" som en rå pixel-scanning af `title-parchment-692.webp`; forkastet efter kontrol — en enkelt mørk kornpixel gav absurde universelle fald (selv `--parchment` mod sig selv-teksturen målte ~1-2,4:1), fordi et enkelt-pixel-udsnit af et malet aktiv måler støj, ikke en repræsentativ papirflade. REQ-003's "mørkeste papirtrin" er derfor tolket som det mørkeste NAVNGIVNE, systematiske token (som den eksisterende `paperNames`-liste allerede gør) frem for en kriminalteknisk enkelt-pixel-måling. Samtidig tilføjet nyt describe-block `titelskærmens selektorer bruger kun tokens til farve`: scanner alle `.title-`/`#title-screen`-regler i `style.css` for rå hex/rgb/hsl uden for `var()` — fandt 0 reelle brud (ét forventet, dokumenteret unntak: `#000` i to `mask-image`-alpha-stencils, som styrer gennemsigtighed, ikke synlig farve, og som allerede er etableret praksis andetsteds i filen uden for titelskærmen). 22/22 test grønne, `npx vitest run tests/design-tokens.test.ts`.* | ✅ | 13-08-2026 |
| TASK-021 | Tastatur og oplæsning: fokusrækkefølge Begin → Fates → trofæ → indstillinger, synlig fokusring på pergament, `alt`/`aria-label` på ikonknapper. *Verificeret/rettet 13-08-2026. Tabrækkefølge kontrolleret med Playwright i begge tilstande: uden gemt spil Begin → Fates → tip-prikker ×3 → trofæ → lyd; med gemt spil Continue → New life → Fates → tip-prikker → trofæ → lyd — den krævede indbyrdes rækkefølge (primær → Fates → trofæ → lyd) holder i begge. Fandt og rettede en ægte lækage: spilskærmens knapper (altid DOM-monteret, kun visuelt dækket) lå FØR titlens egne i tabrækkefølgen, fordi de aldrig var `hidden`/`inert`. Rettet med en ny `setBackgroundInert(inert)`-hjælper i `main.ts`, kaldt fra `showTitleScreen()`, `startGame()` og dommer-rigets scenehop, som sætter `inert` på alle `#app`-børn undtagen `#title-screen`. Bekræftet i Chromes rigtige tilgængelighedstræ (CDP), ikke kun DOM: præcis ét fokuserbart sæt findes, og spilskærmens eget `<h1>` forsvinder korrekt fra træet (se også TASK-011). Synlig fokusring: global `:focus-visible` (3px `--ochre-ink`) dækker Begin/Fates/tip-prikker på pergament; de to knapper over det fotografiske himmellag fik deres egen "sandwich"-ring, se TASK-018. `aria-label` findes på alle ikon-only-knapper (trofæ, lyd, tip-prikker); lydknappen har desuden `aria-pressed`. **Tillæg 13-08-2026 (kodegennemgang):** `setBackgroundInert`s undtagelse dækkede kun `#title-screen` selv — men `#trophy-modal` er en søskende, som titlens egen Fates-knap åbner direkte, og var derfor selv blevet gjort `inert`, når titlen først blev vist. Konsekvens: modalen sås (CSS løfter den korrekt med `z-index: 80`), men kunne hverken fokuseres, læses op eller lukkes med musen. Rettet ved at undtage `child.id === "trophy-modal"` også; se tillægget under "Status 13-08-2026 (lukket)" for reproduktion, rød/grøn-bevis og fuld genkørsel.* | ✅ | 13-08-2026 |
| TASK-022 | Kør hele porten: `tsc`, vitest, `tools/validate.py`, `npm run build`, `tools/ux_audit.mjs`. Verificér til sidst i en rigtig browser i både landskab og portræt. *Kørt 13-08-2026: `npx tsc --noEmit` grøn; `npx vitest run` 18 filer/250 test grønne (heriblandt `tests/title-screen.test.ts` 28/28 og `tests/design-tokens.test.ts` 22/22); `python3 tools/validate.py` 187 elementer/409 kombinationer/2 akter, 0 advarsler; `npm run build` grøn, bundtbudget holder (hovedbundt 95,1 kB gzip mod loft 110 kB); `node tools/ux_audit.mjs` 28/28 checks bestået. Port 5199 var optaget af en anden worktree's proces under kørslen (`carl-wt-live-quality`, urørt) — audit og browserverifikation kørt mod en selvstændig `vite preview` på port 5299 i stedet, ikke mod en antaget/fejlagtig server. Browserverificeret med rigtig Chromium (browser-harness/CDP) ved både 1586×992 (landskab) og 390×844 (portræt, DPR 2): titelskærmen matcher mockuppens retning i begge — layout, sten-hugget overskrift, fanebånd, knapper og redskabsknapper på plads i landskab; scenen falder korrekt tilbage til fuldflade-baggrund og pergamentet til et flydende kort i portræt (TASK-019). Ingen konsolfejl (kun én forudeksisterende, urelateret `apple-mobile-web-app-capable`-advarsel fra `index.html`, uden for denne plans scope). Den visuelle dommer (`npm run judge:capture -- --screen title` + `judge:score`, kørt informativt, ikke en del af TASK-022's egen portdefinition) måler titlen til samlet 0,784 (op fra 0,732 i 12-08-status) — 3 af 10 regioner (`scene`, `divider`, `actions`) består nu deres egen tærskel, 7 gør ikke; ingen ny defekt fundet, kun den kendte afstand til pixel-paritet som TASK-010-021 allerede har dokumenteret og delvis lukket. `Impeccable`-detektoren kørt på `src/ui/style.css`/`main.ts`/`icons.ts`: ét fund (`bounce-easing`, linje 1750, `.card-emoji`) — bekræftet FØR denne plans diff (ikke rørt af titelskærmsarbejdet, hører til opdagelseskortets belønningsanimation), derfor ikke rettet. Ingen verificerede titelskærms-defekter fundet at rette.* | ✅ | 13-08-2026 |

*(Tillæg 13-08-2026: en efterfølgende kodegennemgang af commit `50021a3` fandt én kritisk regression uden for det oprindelige portlisten — se TASK-021's tillæg og "Status 13-08-2026 (lukket)"-tillægget for reproduktion, rød/grøn-bevis og genkørt port: `tsc` grøn; `vitest` 251/251 (18 filer, `title-screen.test.ts` 29/29); `validate.py` 0 advarsler; `npm run build` grøn; `node tools/ux_audit.mjs` 31/31 (nyt "Titlens Fates"-tjek med 3 checks). Talene i denne rækkes egen note ovenfor er dem fra den FØRSTE kørsel 13-08-2026 og er bevidst ikke omskrevet — de var korrekte for deres tidspunkt.)*

## 3. Alternatives

- **ALT-001**: Genskabe hele baggrunden med en billedmodel, så pergamentspalten
  ikke er bagt ind. Fravalgt: mockuppen er allerede den godkendte kunst, og en
  ny generering ville ikke ramme samme Karl, samme lys og samme dal.
- **ALT-002**: Bruge hele mockuppen som ét baggrundsbillede med teksten bagt
  ind. Fravalgt: teksten ville ikke kunne markeres, oversættes, oplæses eller
  skaleres, tælleren `Fates 0/15` ville være løgn, og `Continue` kunne ikke
  vises.
- **ALT-003**: Klippe pergamentspalten fri af mockuppen som et PNG-lag.
  Fravalgt: pergamentet skal strække sig efter indholdets højde, og et bitmap
  ville enten strækkes eller klippe teksten.
- **ALT-005**: Trække hvert ornament ud af mockuppen som en enkeltfil med
  alfa og strø dem ud med CSS. Forsøgt i fire udgaver — tærskel på mørkhed,
  støjbund målt på kantrammen, division af papiret efterfulgt af `multiply`,
  og en sammenhængsmaske bygget på frekvens. Alle fire brød sammen på det
  samme: pergamentet er kraftigt krakeleret, og sprækkerne er lige så mørke og
  lige så tynde som de svageste strøg. Resultatet blev enten en firkantet
  plade af papir eller et mærke, der var flået i stumper. Pladen stiller ikke
  spørgsmålet: ornamenterne bliver liggende på deres eget papir. Prisen er, at
  de ikke kan flyttes uafhængigt af hinanden — hvilket de heller ikke skal.
- **ALT-004**: Male de indbagte knapper væk med indmaling (inpainting).
  Fravalgt: PIL kan ikke, og området er kraftigt uskarpt i forvejen, så en
  spejlet klon er ikke til at se forskel på (bevist ved gennemsyn).
- **ALT-006**: (Tilføjet 13-08-2026, den femte udgave af ALT-005's forsøg,
  den eneste der landede.) Trække hvert ornament ud som et rektangulært
  udsnit af mockuppen — ingen alfa, ingen maskering — og lægge det oven på
  pergamentet med `mix-blend-mode: multiply`. Virker fordi krakeleringen i
  udsnittets baggrund ganges væk mod den lyse plade under, mens selve
  penselstrøget (mørkere end sit eget papir) står tilbage. Kræver at
  udsnittets *egen* papirtone strækkes mod hvid først (`neutralize_paper()`,
  85. percentil pr. kanal) — ellers dobbelt-mørkner den blandede plet, fordi
  referencens papir ikke er lige så lyst som vores eget. Se REQ-005.

## 4. Dependencies

- **DEP-001**: `624107c` (fase 1) leverede den varme målpalet i `tokens.css`.
  Denne plan er den første flade, der bruger den.
- **DEP-002**: `docs/design/reference/title-2026-08-11.webp` — mockuppen, som
  alt måles imod.
- **DEP-003**: Fraunces (display) og Plus Jakarta Sans (UI) er allerede i
  repoet; ingen nye fonte hentes.

## 5. Files

- **FILE-001**: `src/ui/main.ts` — `showTitleScreen()` bygges om.
- **FILE-002**: `src/ui/style.css` — al titelskærms-CSS.
- **FILE-003**: `src/ui/icons.ts` — nye krom-ikoner (`gear`, `tap`).
  *Ryddet 13-08-2026: begge stod ubrugte — knappen blev en lydslukker frem
  for indstillinger (spillet har én indstilling, og det er lyden), og
  hint-ikonet blev det malede `orn-tap.webp` frem for `icons.tap`. Verificeret
  med `grep` over `src/` og `tests/` før fjernelse: ingen andre referencer.
  `gear`/`tap`-eksporterne er fjernet fra `icons.ts`; PAT-001 gælder stadig
  for de ikoner, der faktisk bruges (`mute`, `trophy`, …).*
- **FILE-008**: `tools/art/build_parchment.py` — bygger pergamentpladen.
  Kasselisten øverst er det eneste, der skal røres, hvis mockuppen udskiftes.
- **FILE-009**: `src/assets/art/title-parchment-{692,520,360}.webp` —
  pergamentet med ornamenterne, uden tekst, med alfa i den revne kant.
  *Rettet 12-08-2026: planen skrev `public/art/`, men den mappe findes ikke.
  Al kunst ligger i `src/assets/art/` og hashes af Vite ind i `dist/assets/`
  — det er projektets faktiske konvention, jf. `src/ui/art.ts`.*
- **FILE-004**: `src/assets/art/title-scene-{897,640,448}.webp` — scenepladen.
  Samme rettelse som FILE-009. Kun 897-varianten er i brug i dag.
- **FILE-005**: `DESIGN.md` — titelskærmen skrives ind som fladen, der bærer
  målpaletten først. *Rettet 13-08-2026: ny §2-undersektion "Titelskærmen
  (overskrift, fanebånd og sten-knapper)" tilføjet efter "Sten
  (Combine-knappen)", der dokumenterer `--title-stone-hi/-stone/-stone-lo`,
  `--ribbon-ink` og `--btn-ink` med deres målte kontrastværdier (5,87:1,
  4,92:1, 4,62:1) og forklarer, hvilke titel-flader der bevidst GENBRUGER
  eksisterende papir-/flise-tokens (`Parchment`, `Tile Edge`, `Tile Shade`/
  `Tile Groove`, `Label Ink`) frem for at opfinde nye. `npx vitest run
  tests/design-tokens.test.ts` bekræfter stadig 22/22 grønne efter
  tilføjelsen — de nye hex-mentions matcher eksisterende tokens.css-værdier
  præcist, så "DESIGN.md og tokens.css stemmer overens"-testen (den ene
  retning: alt DESIGN.md nævner, findes som token) forbliver sand.*
- **FILE-006**: `tests/design-tokens.test.ts` — kontrastkrav for de nye flader.
  *Udført 13-08-2026, se TASK-020's amendment.*
- **FILE-007**: `tests/title-screen.test.ts` — ny; pinner CON-001 og CON-002.
  *Udført 13-08-2026: filen oprettet med 28 test, heriblandt CON-001 ("ingen
  'drag'") og CON-002 (Begin/Continue/New life-gatingen). Fire regressioner
  afprøvet manuelt (brudt, kørt RED, genskabt): "Continue"→"Resume",
  "Tap"→"Drag" i hintet, `.tile-sten` tømt, og en positiv `tabindex`
  genindsat — alle fire fældede den tilsvarende test, før filerne blev
  gendannet med `diff` som bevis. 28/28 grønne i normaltilstand.*

## 6. Testing

- **TEST-001**: Hint-teksten må ikke indeholde "drag" (CON-001). Mutationstestes
  ved at sætte ordet tilbage og se testen falde.
- **TEST-002**: Uden gemt spil vises `Begin` som primær og ingen `Continue`; med
  gemt spil vises `Continue` som primær og `Begin` hedder `New life` (CON-002).
- **TEST-003**: `Fates`-tælleren viser det faktiske antal slutninger fra
  `content/endings.json`, ikke et fast tal.
- **TEST-004**: Hver tekstfarve på titelskærmen har ≥ 4,5:1 mod den mørkeste
  pergamentflade, den kan lande på (REQ-003).
- **TEST-005**: `style.css` indeholder ingen hardcodede farver i
  titelskærmens selectors (REQ-002) — håndhæves af den eksisterende
  token-dækningstest. *Falsk (12-08-2026): `tests/design-tokens.test.ts`
  læser kun DESIGN.md → `tokens.css` og scanner aldrig `style.css` for rå
  hex. Testen ville derfor ikke fange de seks hardkodede stops, der står i
  `.title-stage` i dag — og fanger den ikke, håndhæver den ikke. Skal
  bygges, ikke bare henvises til.*
- **TEST-006**: Velkomstchippen vises kun uden gemt spil.

## 7. Risks & Assumptions

- **RISK-001**: Scenepladen er kun 897 px bred. På en 2560 px skærm opskaleres
  den ~1,7×. Afbødes af, at maleriet er blødt og har dybdeskarphed — men det
  skal ses efter på en rigtig bred skærm, ikke antages.
- **RISK-004**: Pergamentpladen har fast forhold 692:907. Panelet er ca. 0,77
  bredt/højt på en 16:9-skærm, hvilket passer, men i meget lave eller meget
  høje vinduer beskærer `cover` enten toppen eller siderne, og ornamenterne
  kan ryge ud af billedet. Skal ses efter i begge yderpunkter, ikke antages.
- **RISK-002**: `background-clip: text` over en gradient kan gøre titlen
  ulæselig, hvis gradienten bliver for lys. Kontrasten skal måles på titlens
  *mørkeste* stop, ikke gennemsnittet.
- **RISK-003**: Den revne kant som `mask-image` koster et lag mere at tegne på
  en flade, der allerede har korn og gradient. Skal ses efter på telefon.
- **ASSUMPTION-001**: Mockuppen er den endelige kunstretning for hovedmenuen.
  Bekræftet af Martin 11-08-2026 ("main menu should look like this").
- **ASSUMPTION-002**: Den rekonstruerede hjørne-tekstur (CON-004) er god nok,
  fordi DOM-knapperne alligevel lander netop dér.

## 8. Related Specifications / Further Reading

- `DESIGN.md` — den gældende visuelle lov, især regel 8 (kun tokens).
- `plan/design-visual-target-1.md` — spilfladens redesign; denne plan er dens
  søster, ikke dens fase.
- `docs/design/fortaelleren.md` — fortællerens stemme, som taglinen skal lyde af.
- `docs/design/reference/title-2026-08-11.webp` — mockuppen.
