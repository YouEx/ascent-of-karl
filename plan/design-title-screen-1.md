---
goal: Byg titelskærmen så den matcher mockuppen fra 11-08-2026 1:1
version: 1.0
date_created: 2026-08-11
last_updated: 2026-08-11
owner: Martin (YouEx)
status: 'In progress'
tags: [design, feature, ui]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Martin leverede 11-08-2026 en mockup af hovedmenuen
(`docs/design/reference/title-2026-08-11.webp`, 1586×992). Denne plan bygger
titelskærmen om, så den matcher: pergamentspalte til venstre med udskåret titel,
malet scene til højre. Titelskærmen er samtidig **første flade, der tager den
varme målpalet i brug** — den er selvstændig, så paletten kan landes her uden at
resten af spillet skifter udseende midt i en fase.

Planen dækker kun titelskærmen. Selve spilfladen ligger i
`plan/design-visual-target-1.md` fase 2-5.

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
  mockuppen, ikke tegnede SVG-figurer og ikke billedfiler placeret enkeltvis.
  De leveres i pergamentpladen, hvor de allerede ligger. De bærer ingen
  information og må aldrig ligge bag læsbar tekst.
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
| TASK-003 | Kod `public/art/title-scene-{897,640,448}.webp`, q84. Verificér hver ≤ 220 kB (REQ-004). | ✅ | 2026-08-11 |
| TASK-004 | Byg `public/art/title-parchment-{692,520,360}.webp` med `tools/art/build_parchment.py`: arkets silhuet findes på lysstyrke, tekst og knapper viskes væk med papir regnet af arkets eget lysforløb og eget korn, og ornamenterne bliver liggende, hvor de blev malet. Ægte alfa, så den revne kant kan ligge over scenen (REQ-005). | ✅ | 2026-08-11 |
| TASK-005 | Tilføj UI-ikonerne `gear` og `tap` til `icons.ts`. Krommets ikoner bliver ved med at være streg-ikoner i det eksisterende sæt (PAT-001); det malede hører til pergamentet, ikke til knapperne. | ✅ | 2026-08-11 |

### Implementation Phase 2

- GOAL-002: Stilladset. To spalter, pergament, revet kant og scenepladen på
  plads — uden indhold endnu.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Omskriv `showTitleScreen()` i `src/ui/main.ts` til mockuppens struktur: `.title-parchment` (venstre) + `.title-scene` (højre) inde i `.title-stage`. Fjern `RIBBONS` fra titelskærmen — de er pastelpalettens ornament og hører ikke til på pergament. | | |
| TASK-007 | Læg scenepladen som `background-image` med `image-set()` på `.title-scene`, `background-position: right center`, `background-size: cover`, og en `background-color` fra `--valley-dark` under, så fladen aldrig blinker hvid. | | |
| TASK-008 | Læg pergamentpladen på `.title-parchment` med `image-set()` og `--parchment` som bundfarve under, så fladen aldrig blinker hvid, og så panelet stadig er læsbart, hvis billedet fejler. | | |
| TASK-009 | Verificér den revne kant mod scenen ved 1280, 1600 og 2560 px: kanten er pladens egen alfa, så den skal stå rent uden lys sømkant, og pladen må ikke beskæres så ornamenterne ryger ud. | | |

### Implementation Phase 3

- GOAL-003: Komponenterne. Hver enkelt af mockuppens ni elementer.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Velkomstchippen: afrundet pergamentflade med kant, hule-ikon til venstre, *"Welcome, inventor."* + kursiv *"Ready to make history?"*. Skjules når der findes et gemt spil — den hilser en ny spiller, ikke en der vender tilbage. | | |
| TASK-011 | Titlen: `The / Ascent / of / Karl` i `--font-display`, med stenfyld via `background-clip: text` (REQ-007). `of` er lille og kursiv, flankeret af to hårfine streger. Semantisk ét `<h1>`; linjeskiftene er `<span>`, så oplæsning giver "The Ascent of Karl". | | |
| TASK-012 | Undertitel-båndet: revet pergamentstrimmel med kursiv *"reinvent history, badly"*. Formen laves med `clip-path`, ikke et billede. | | |
| TASK-013 | Taglinen i to linjer + ornamentdeleren (to hårfine streger om en rombe). | | |
| TASK-014 | `Begin`-knappen: stor udskåret pergamentflade med facet, spiral-glyf til venstre. Bliver `New life` og mister sin primære vægt, når `Continue` findes (CON-002). | | |
| TASK-015 | `Fates`-knappen: sekundær pergamentflade, trofæ-ikon, tælleren i `tabular-nums` og `--rust-warm`. | | |
| TASK-016 | Hint-linjen: tryk-ikon + tryk-tryk-tekst. **Lukker CON-001.** | | |
| TASK-017 | Tipkortet nederst: elementflise til venstre, fed titel + kursiv underlinje, tre prikker, jagtscene-ornament i højre side. Tipsene roterer ved hvert besøg, så kortet ikke er dødt inventar. | | |
| TASK-018 | Trofæ- og indstillingsknapperne øverst til højre oven på scenepladen (CON-004), 44 px berøringsflade. | | |

### Implementation Phase 4

- GOAL-004: Bevis. Skærmen skal virke på rigtige skærme, ikke kun i mockuppen.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Responsivt: under 900 px falder scenen bagud som helflade-baggrund, og pergamentet bliver et gennemsigtigt kort ovenpå. Ingen vandret scroll ved 320 px (REQ-006). | | |
| TASK-020 | Kontrast: mål hver tekstfarve mod den faktiske pergamentflade og pin resultatet i `tests/design-tokens.test.ts` (REQ-003). | | |
| TASK-021 | Tastatur og oplæsning: fokusrækkefølge Begin → Fates → trofæ → indstillinger, synlig fokusring på pergament, `alt`/`aria-label` på ikonknapper. | | |
| TASK-022 | Kør hele porten: `tsc`, vitest, `tools/validate.py`, `npm run build`, `tools/ux_audit.mjs`. Verificér til sidst i en rigtig browser i både landskab og portræt. | | |

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
- **FILE-008**: `tools/art/build_parchment.py` — bygger pergamentpladen.
  Kasselisten øverst er det eneste, der skal røres, hvis mockuppen udskiftes.
- **FILE-009**: `public/art/title-parchment-{692,520,360}.webp` — pergamentet
  med ornamenterne, uden tekst, med alfa i den revne kant.
- **FILE-004**: `public/art/title-scene-{897,640,448}.webp` — scenepladen.
- **FILE-005**: `DESIGN.md` — titelskærmen skrives ind som fladen, der bærer
  målpaletten først.
- **FILE-006**: `tests/design-tokens.test.ts` — kontrastkrav for de nye flader.
- **FILE-007**: `tests/title-screen.test.ts` — ny; pinner CON-001 og CON-002.

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
  token-dækningstest.
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
