---
goal: Luk den målbare titelskærmsafstand til den godkendte reference uden at svække regression-, UX- eller tilgængelighedskontrakter
version: 1.0
date_created: 2026-08-14
last_updated: 2026-08-14
owner: Martin (YouEx)
status: 'Planned'
tags: [design, fidelity, title-screen, assets, testing, architecture]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Denne plan lukker den resterende fidelity-afstand mellem The Ascent of Karls
titelskærm og den godkendte reference
`docs/design/reference/title-2026-08-11.webp`. Den nuværende skærm har korrekt
makrokomposition og korrekt palette, men taber på fem målbare forhold:
sammenføjningen i scenen, titelens synlige blækbredde, den mørke forgrund
nederst til venstre, lokal detalje i Karl og global kanttæthed.

Planen erstatter ikke den eksisterende visuelle dommer. Dommeren i
`tools/judge/` er fortsat regressionsværn; de nye fidelity-mål er en særskilt
målkontrakt. De skal først bevise, at den nuværende render fejler, og må derefter
aldrig sænkes for at få en implementering til at bestå.

## Goal

Ved afslutning skal den produktionsbyggede titelskærm bestå alle mål i REQ-003
til REQ-007 ved de registrerede viewports, mens Karl-identitet, pose,
makrokomposition, semantisk DOM, UX, accessibility, feature-off/preview og den
eksisterende `maxDrop = 0.02`-kontrakt forbliver grønne.

## Architecture

```text
approved target pixels
        |
        +--> Stream A: goal metrics + current RED evidence
        |
        +--> Stream B: scene + foreground + parchment build pipeline
        |
        +--> Stream C: carved wordmark + ribbon/chrome materials
                         |
                         v
               Stream D: semantic DOM integration
                         |
                         v
        registered captures + regression + UX/a11y gates

Stream E: later element-art audit
          reads title closure results, but cannot block title closure unless
          a shared pipeline edit changes committed element outputs.
```

Streams A, B and C har disjunkt fil-ejerskab og kan køres parallelt efter
TASK-001. Stream D er eneste integrationspunkt. Stream E starter efter lukning
og er ikke en forudsætning for titelens accept.

## Stack

| Lag | Teknologi | Rolle |
|-----|-----------|-------|
| Runtime | TypeScript, Vite, semantisk HTML, CSS | Titelskærmens markup, art direction og responsive layout |
| Capture | Playwright/Chromium mod `vite preview` | Produktionsrender ved registreret viewport og DPR |
| Måling | Python 3.12, Pillow 11.3.0, NumPy 2.0.2, SciPy 1.13.1, OpenCV headless 4.13 | Pixelmål, alpha/composite-tests, detalje- og kantmåling |
| Test | Vitest + Python `pytest` | Kontrakt-, pipeline-, integration- og regressionsporte |
| Assets | Deterministiske Python-builds til WebP/RGBA | Ingen håndredigering af afledte produktionsfiler |

## Source provenance

| Kilde | Rolle | Dimension | SHA-256 | Bevis |
|-------|------|-----------|---------|-------|
| `/Users/martin/Downloads/ChatGPT Image 11. aug. 2026, 15.11.10.png` | Martins godkendte original | 1586×992 | `8d37bca638f53d90a996c551183d721877419ebe73f3e81a1c67da120dc1a770` | Pixel-identisk med repoets WebP efter RGB-dekodning |
| `docs/design/reference/title-2026-08-11.webp` | Kanonisk, versioneret reference | 1586×992 | `8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850` | Eneste runtime-uafhængige målfil |
| `/Users/martin/.copilot/session-state/9c29f629-2e15-4c0e-994f-c19bcd860d45/files/carl-current-title-1536.png` | Kalibreringsbevis for nuværende render | 1536×1024 | `082d979dd4c6c3f9b84bb763cd354b39502ce1ad4758cda94f087f77f95a575b` | Må kun bruges til at bevise RED; live capture er den vedvarende sandhed |
| Git commit `a160eae` | Kodegrundlag før denne plan | n/a | n/a | Branch `wt/fidelity-plan` var ren ved planstart |

## 1. Requirements & Constraints

- **REQ-001**: `docs/design/reference/title-2026-08-11.webp` er godkendt
  kildekunst. Pixels må beskæres, maskeres, inpaintes deterministisk og
  art-directes, men visuelle egenskaber må ikke opfindes eller beskrives som
  bevaret uden en måling.
- **REQ-002**: Karl beholder identitet, ansigt, hår, moustache, tøj, sten,
  siddende pose og placering i den nuværende makrokomposition. En ændring
  kræver et reproducerbart dommerfund, der viser, at bevarelsen selv er årsag
  til en fejlet gate.
- **REQ-003**: Den kanoniske 1586×992-produktionscapture skal bestå:
  `sceneSeamGradient <= 4.0` (reference 2.61, nuværende 13.18),
  `titleInkOccupancy` mellem 26.5 % og 28.5 % af viewportbredden
  (reference 27.4 %, nuværende 20.5 %),
  `bottomLeftDarkShare` mellem 35 % og 47 %
  (reference 41.3 %, nuværende 14.5 %),
  `characterDetailVariance >= 300`
  (reference 336, nuværende 174) og
  `globalEdgeDensity >= 6.1 %`
  (reference 6.78 %, nuværende 4.84 %).
- **REQ-004**: Sceneeksportens detaljebevarelse skal være mindst 95 % målt
  som forholdet mellem Laplacian-varians i eksporten og dens tabsfri master
  efter begge er resamplet til samme outputdimension. Værdien klippes ikke
  ved 100 %, så oversharpening kan opdages separat.
- **REQ-005**: Rekonstruerede blanke pergamentfelter skal bevare mindst 85 %
  af højfrekvensenergien i de godkendte, urørte papirprøver i
  `title-layers.config.json`. Ingen enkelt prøve må ligge under 80 %.
- **REQ-006**: Enhver RGBA-kant skal have højst 1 px alpha-overgang og højst
  1 px farvefringe, målt på kompositter mod sort, hvid og `--parchment`.
  Testen måler alle tre baggrunde; en kant består kun, hvis alle består.
- **REQ-007**: Den faktisk hentede titelpayload må være højst 600 kB på
  desktop og højst 350 kB på de art-directed mobile viewports. Kun
  netværksresourcer, som Chromium faktisk henter før `data-ready`, tælles.
- **REQ-008**: Ingen produktionseksport må vises større end 1:1 i fysiske
  pixels ved 390×844 DPR2 eller 430×932 DPR2. `naturalWidth`,
  `naturalHeight`, `currentSrc` og den renderede boks skal dumpes af capture;
  CSS-baggrunde uden en målelig naturlig størrelse må ikke bruges til
  scene-, forgrunds-, pergament- eller wordmarklagene.
- **REQ-009**: Følgende viewports er obligatoriske og har stabile id'er:
  `mobile-390` = 390×844 DPR2, `mobile-430` = 430×932 DPR2,
  `desktop-1366` = 1366×768 DPR1, `desktop-1536` = 1536×1024 DPR1,
  `target-native` = 1586×992 DPR1 og
  `desktop-2560` = 2560×1440 DPR1.
- **REQ-010**: De fem mål i REQ-003 er hårde på `target-native`. Alle seks
  viewports skal desuden have `sceneSeamGradient <= 4.0`,
  `characterDetailVariance >= 300` og `globalEdgeDensity >= 6.1 %`.
  Titel- og forgrundsandel logges på mobile viewports, men deres reference-
  intervaller må ikke bruges til at tvinge desktopkompositionen ind i et
  portrætformat.
- **REQ-011**: Den eksisterende regionsbaseline i
  `tests/visual-baseline.json`, regionstærsklerne i
  `docs/design/reference/registry.json` og `maxDrop = 0.02` må ikke sænkes.
  En afsluttende baselineopdatering må kun beholde eller hæve et tal.
- **REQ-012**: `npm test`, `npm run test:visual`, `npm run ux`,
  `python3 tools/validate.py`, `npm run build`, Pages-verifikation,
  accessibility-træet, fokusorden, modalflugtveje og feature-off/preview-
  kontrakter skal forblive grønne.
- **REQ-013**: Global palettetuning er ude af scope. Farven er allerede målt
  som matchende. `src/ui/tokens.css` må ikke ændres.
- **REQ-014**: Den synlige wordmark må være malet rasterkunst, men
  `showTitleScreen()` skal fortsat levere præcis ét semantisk `<h1>` med det
  tilgængelige navn `The Ascent of Karl`. Synlig kunst skal være
  `aria-hidden`; den semantiske tekst må ikke være `display:none` eller
  `visibility:hidden`.
- **REQ-015**: Referenceudtrækning er første vej. En ny eller outpainted
  master er kun lovlig, når den deterministiske vej har kørt og en navngiven
  gate stadig fejler. Manglende master registreres som blokering; tærskler
  sænkes ikke.
- **REQ-016**: Stream E's element-art-audit må ikke blokere titelens lukning.
  Den må kun blive blokerende, hvis en delt pipelineændring ændrer SHA-256,
  dimensioner, alpha eller farverum for en eksisterende fil i
  `src/assets/art/elements/`.
- **SEC-001**: Ingen automatisk build må kalde Gemini, Higgsfield eller andre
  netværkstjenester. `tools/art/outpaint_scene.py` forbliver et eksplicit,
  manuelt trin og må ikke kaldes af `npm run art`, test eller CI.
- **CON-001**: Kun filer i afsnit 5 må ændres under implementeringen. `DESIGN.md`,
  `plan/design-title-screen-1.md`, `plan/design-visual-target-1.md` og
  `plan/architecture-visual-judge-1.md` er read-only evidens.
- **CON-002**: Den nuværende dommer er regressionsautoritet, ikke
  målautoritet. Nye fidelity-mål skal fejle den nuværende render, før Stream B
  eller C må ændre et produktionsaktiv.
- **CON-003**: Afledte billeder redigeres aldrig manuelt. En pixelændring skal
  kunne reproduceres fra script, config, godkendt kilde og fast seed.
- **CON-004**: Det manglende
  `docs/design/reference/scene-wide.png` og det manglende
  `src/assets/art/title-scene-wide-2560.webp` er ikke tilladelse til at
  strække `title-scene-897.webp` og kalde det en master.
- **GUD-001**: Hver task følger RED → minimal implementering → GREEN →
  refaktorering → fuld relevant gate.
- **GUD-002**: Kommentarer og commit-subjekter er på dansk; spillertekst er på
  engelsk.
- **GUD-003**: Metrikker logger rå værdi, gate, viewport, input-SHA og
  algoritmeversion. Afrunding bruges kun i rapporten, aldrig i afgørelsen.
- **PAT-001**: Produktionsassets bygges til en midlertidig mappe, valideres og
  flyttes atomisk på plads. En fejlet build må ikke efterlade en halv
  assetsamling i `src/assets/art/`.
- **PAT-002**: Scene, forgrund, pergament og wordmark integreres som
  `<picture>/<img>` med eksplicit `width`, `height`, `srcset` og `sizes`;
  dekorative billeder har tom `alt` og `aria-hidden="true"`.

## 2. Implementation Steps

### Implementation Phase A — Judge extensions and failing current baseline

- **GOAL-001**: Gør målafstanden eksekverbar, reproducerbar og rød på den
  nuværende render, uden at ændre produktionskunst eller layout.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Tilføj maskinlæsbare viewport- og fidelity-kontrakter til `docs/design/reference/registry.json`; pin algoritmeversion `title-fidelity-v1`, alle gates fra REQ-003 til REQ-010 og de tre kilde-SHA'er fra provenance-tabellen. | | |
| TASK-002 | Opret `tools/judge/title_fidelity.py` og `tests/title-fidelity.test.ts`. Implementér de fem skærmmetrikker, scene-/pergamentretention, alpha-fringe, payloadresultat og 1:1-skaleringskontrol. | | |
| TASK-003 | Udvid `tools/judge/capture.mjs` og `tests/judge-capture.test.ts` med `--viewports registered`, DPR, `currentSrc`/natural-size-dump, resource-byte-log og én PNG pr. viewport. | | |
| TASK-004 | Opret `tools/judge/title-fidelity.mjs` og `tools/judge/requirements.txt`, tilføj `judge:title-fidelity` i `package.json`, wire Python/Chromium-gaten i `.github/workflows/ci.yml`, og optag `.judge/fidelity-red`. Kommandoen skal fejle med de fem kendte nuværende værdier, mens referencefilen består. Commit checkpoint A. | | |

#### TASK-001 execution

**Ownership**

- `docs/design/reference/registry.json`
- `tests/judge-registry.test.ts`

**TDD**

1. Tilføj først Vitest-assertions for de seks viewport-id'er, alle hårde
   grænser og forbuddet mod lavere eksisterende regionstærskler.
2. Kør:
   `npx vitest run tests/judge-registry.test.ts`.
3. Forventet RED: viewports og `goalMetrics` mangler.
4. Tilføj registry-data uden at ændre eksisterende regiontal.
5. Forventet GREEN: testen består, og en JSON-diff viser kun additive felter.

#### TASK-002 execution

**Metric definitions**

- `sceneSeamGradient`: Rec.709-luma i 8-bit; i vinduet
  `x=[0.288W,0.404W)`, `y=[0.04H,0.16H)` beregnes middel absolut
  række-til-række-delta for hver række; maksimum er resultatet.
- `titleInkOccupancy`: i ROI `x=[0.08W,0.45W)`,
  `y=[0.10H,0.46H)` vælges luma `< 100`; 8-forbundne komponenter under
  `max(4, round(20*W*H/(1586*992)))` pixels kasseres. Resultatet er
  `100*(maxX-minX+1)/W`.
- `bottomLeftDarkShare`: i ROI `x=[0,0.45W)`, `y=[0.81H,H)` er resultatet
  andelen af pixels med Rec.709-luma `< 108`.
- `characterDetailVariance`: ROI `x=[0.57W,0.90W)`,
  `y=[0.13H,0.78H)` konverteres til 8-bit luma; variansen af en 3×3 diskret
  Laplacian med kernel-center `-4` og fire naboer `+1` er resultatet.
- `globalEdgeDensity`: OpenCV Canny på 8-bit luma med
  `threshold1=51`, `threshold2=145`, `L2gradient=true`; resultatet er
  kantpixels divideret med alle pixels i procent.

**TDD**

1. Skriv tests mod de to SHA-pinnede billeder.
2. Referenceforventning har tolerance:
   seam `2.61 ± 0.20`, title `27.4 ± 0.20`, dark `41.3 ± 0.25`,
   detail `336 ± 5`, edges `6.78 ± 0.10`.
3. Current-forventning har tolerance:
   seam `13.18 ± 0.25`, title `20.5 ± 0.20`, dark `14.5 ± 0.25`,
   detail `174 ± 5`, edges `4.84 ± 0.10`.
4. Kør:
   `npx vitest run tests/title-fidelity.test.ts`.
5. Forventet RED før implementering: Python-CLI'en findes ikke.
6. Forventet GREEN efter implementering: begge kalibreringssæt matcher, men
   `--fail-on-gate` returnerer exit 1 for current og exit 0 for reference.

#### TASK-003 execution

1. Testen opretter en syntetisk registry med to viewports og en lokal fixture.
2. Forventet RED: capture accepterer kun native screen og logger hverken DPR,
   bytes eller natural size.
3. Implementér én browsercontext pr. viewport og skriv:
   `metrics/title-<viewport>.json`,
   `render/title-<viewport>.png` og `resources/title-<viewport>.json`.
4. Resource-loggen skal indeholde URL, transferSize, decodedBodySize,
   initiatorType og om filen indgår i titelens critical payload.
5. GREEN:
   `npx vitest run tests/judge-capture.test.ts`.

#### TASK-004 execution

Kør i denne rækkefølge:

```bash
python3 -m pip install -r tools/judge/requirements.txt
npm run build
node tools/judge/capture.mjs --screen title --viewports registered --out .judge/fidelity-red
python3 tools/judge/title_fidelity.py --run .judge/fidelity-red --fail-on-gate
python3 tools/judge/title_fidelity.py --image docs/design/reference/title-2026-08-11.webp --viewport target-native --fail-on-gate
```

Forventet RED er første fidelity-kommando med præcis fem billedgates i fejl på
`target-native`; referencekommandoen skal være GREEN. Ingen fil under
`src/assets/art/`, `src/ui/` eller `tests/visual-baseline.json` må være ændret.

`tools/judge/requirements.txt` skal pinne:
`Pillow==11.3.0`, `numpy==2.0.2`, `scipy==1.13.1`,
`opencv-python-headless==4.13.0.92` og `pytest==8.4.2`.
CI-jobbet skal installere filen og projektets Chromium før
`npm run judge:title-fidelity`; det må ikke genbruge en udviklermaskines
globale Python-miljø.

**Commit checkpoint A**

`test: fastfrys titelens fidelitymål`

### Implementation Phase B — Continuous scene, foreground and parchment pipeline

- **GOAL-002**: Erstat den synlige blur/søm og den udglattede papirrekonstruktion
  med deterministiske, kildeafledte lag, uden netværk eller håndredigering.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Opret `tools/art/title-layers.config.json`, `tools/art/build_title_layers.py` og `tools/art/tests/test_build_title_layers.py`. Configen pinner source-SHA, seeds, sourcecrops, blanke papirprøver, outputdimensioner og bytebudgetter. | | |
| TASK-006 | Byg et sammenhængende scenelag og et separat mørkt forgrundslag til alle seks viewports. Bevar alle synlige sourcepixels fra x=690..1586; rekonstruér kun områder, som referencens pergament/chrome skjuler. | | |
| TASK-007 | Byg pergamentlaget med den faktisk synlige silhuet. Fjern `PATCH_BACK`/lodret forlængelse som sandhedskilde; rekonstruér tekst- og kontrolhuller med deterministisk patch-quilting fra de pinnede rene papirprøver. | | |
| TASK-008 | Skriv `tools/art/title-layers.manifest.json`, kør retention-, alpha-, dimensions-, determinisme- og budgettests, og registrér en fail-closed masterblokering hvis nogen gate ikke kan nås kildeafledt. Commit checkpoint B. | | |

#### TASK-005 execution

**Ownership**

- `tools/art/title-layers.config.json`
- `tools/art/build_title_layers.py`
- `tools/art/tests/test_build_title_layers.py`
- `tools/art/title-layers.manifest.json`
- `src/assets/art/title-layers/**`

**Output dimensions**

| Asset id | Fysiske pixels |
|----------|----------------|
| `scene-mobile-390` / `foreground-mobile-390` | 780×1688 |
| `scene-mobile-430` / `foreground-mobile-430` | 860×1864 |
| `scene-desktop-1366` / `foreground-desktop-1366` | 1366×768 |
| `scene-desktop-1536` / `foreground-desktop-1536` | 1536×1024 |
| `scene-target-native` / `foreground-target-native` | 1586×992 |
| `scene-desktop-2560` / `foreground-desktop-2560` | 2560×1440 |
| `parchment-desktop` | 700×992 |
| `parchment-mobile-390` | 700×1530 |
| `parchment-mobile-430` | 760×1680 |

Mobile lag er art-directed kompositioner, ikke et landscape-billede strakt til
portræt. Karl-kilden placeres højst 1:1; resterende vertikalt areal bygges af
separate scene- og forgrundsprøver.

**TDD**

1. Test configschema, source-SHA og præcise outputdimensioner først.
2. Kør:
   `python3 -m pytest tools/art/tests/test_build_title_layers.py -q`.
3. Forventet RED: config, script og outputs mangler.
4. Implementér til tempdir og atomisk replace.
5. GREEN kræver byte-identisk genbygning ved samme seed.

#### TASK-006 execution

1. Bevar den komplette, synlige scene fra referencekoordinater
   `[690,0,1586,992]` uden generativ ændring.
2. Inpaint kun chip/tools-occlusion i den øverste scene med exemplarer fra
   samme højde og samme side af billedet.
3. Rekonstruér det skjulte venstre sceneområde med fast-seed patch-quilting;
   overlap skal være mindst 48 sourcepixels og vælges ved minimum
   luminansgradient-fejl, ikke ved tilfældig placering.
4. Byg forgrund som separat RGBA-lag fra referencens mørke klippe/foliage-
   prøver. Laget må dække den rekonstruerede scene, men aldrig Karls ansigt,
   hænder, sten eller torso.
5. Kør:
   `python3 tools/art/build_title_layers.py --only scene,foreground --check`.
6. GREEN: seam, dark share, detail, edge density, retention og alpha består
   på de genererede composites før runtimeintegration.

#### TASK-007 execution

1. Udled paper-masken fra referencepixels og kendte sceneprøver; bevar
   flossede kanter og den mørke forgrunds occlusion nederst.
2. Brug fire pinnede blanke papirprøver uden tekst, ornament eller bånd.
3. Patchstørrelse er 48×48 sourcepixels, overlap 12 px, seed 20260814.
4. Match hvert hul mod en lavfrekvent belysningsflade og quilt derefter
   højfrekvent tekstur; der må ikke syntetiseres korn fra Gaussian noise som
   primær detaljekilde.
5. Ornamenter, der findes som sourcepixels, kopieres uændret.
6. GREEN:
   `parchmentBlankRetention >= 0.85`, hver prøve >=0.80 og alle alpha/fringe-
   kompositter <=1 px.

#### TASK-008 fail-closed gate

Hvis en gate fortsat fejler efter højst tre configvarianter, må tasken ikke
fortsætte til Stream D. Tilføj i stedet ét åbent item til
`docs/design/asset-queue.json`:

- key: `title:missing-master:TITLE-scene-master-v2`
- assetId: `TITLE-scene-master-v2`
- producer: `manual-approved-outpaint`
- minimum: 2560×1440 lossless scene plus 860×1864 art-directed mobile scene
- invariant: Karl er pixelidentisk i identitet/pose med den godkendte kilde
- unblock: alle REQ-003 til REQ-008-gates består uden tærskelændring

Repoets nuværende konkrete masterblokering er, at
`docs/design/reference/scene-wide.png` ikke findes, den tilsvarende
2560-eksport ikke findes, og ingen godkendt upscaler/outpaint-service er
tilgængelig for den automatiske pipeline. Denne blokering er kun fatal, hvis
den deterministiske kildevej ikke består.

**Commit checkpoint B**

`feat: byg sammenhængende titelkunst`

### Implementation Phase C — Carved wordmark and painted ribbon/chrome materials

- **GOAL-003**: Erstat CSS-efterligninger af malede glyffer og materialer med
  sourceafledte assets, mens al semantik og dynamisk tekst bevares.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Opret `tools/art/title-materials.config.json`, `tools/art/build_title_materials.py` og tests. Udtræk wordmark, ribbon, primary/secondary button-materialer, chip, tool-frame og tip-card-materiale fra den godkendte target. | | |
| TASK-010 | Byg matte-aware RGBA-wordmark og 3-slice/9-slice-materialer. Test komposit mod sort, hvid og parchment; ingen fringe eller overgang over 1 px. | | |
| TASK-011 | Skriv `tools/art/title-materials.manifest.json`; verificér determinisme, source provenance, native display limits og delbudgetter. Commit checkpoint C. | | |

#### TASK-009 execution

**Ownership**

- `tools/art/title-materials.config.json`
- `tools/art/build_title_materials.py`
- `tools/art/tests/test_build_title_materials.py`
- `tools/art/title-materials.manifest.json`
- `src/assets/art/title-materials/**`

**Extractable directly from target**

- Wordmarkens synlige glyffer i headline-regionen.
- Det malede subtitle-bånd og dets flossede ender.
- Begin/Fates-stenmaterialer og deres bevels.
- Welcome-chip, tool-button-materiale og tip-card-materiale.
- Spiral, trofæ, tap, divider og jagtornamenter.

**Not directly observable**

- Rent pergament under wordmark, knaptekst, hint og tipkort.
- Scene bag pergamentet.
- Pixels uden for 1586×992 og højere opløsningsdetalje end source.

De ikke-observerbare områder løses af Stream B's deterministiske rekonstruktion.
De må ikke beskrives som originalpixels. Hvis materialets alpha ikke kan
udledes uden halo, er det et fail-closed masterbehov, ikke et argument for en
bredere feather.

#### TASK-010 execution

1. Byg en lokal blank-baggrund for wordmarkcrop med samme patch-quilting som
   pergamentet.
2. Beregn Lab-differencen mellem source og blank model.
3. Alpha er 0 ved ΔE <= 2, lineær til 1 ved ΔE >= 12; fjern komponenter under
   8 pixels og luk kun 1 px huller.
4. Recover RGB ved standard foreground-matting mod den estimerede baggrund.
5. Opdel ribbon og knapper i caps + ren midterstribe; midterstriben må tiles,
   aldrig skaleres horisontalt.
6. Kør:
   `python3 -m pytest tools/art/tests/test_build_title_materials.py -q`.
7. GREEN: sourcecrops matcher config, output er deterministisk, og alle
   composites består REQ-006.

#### TASK-011 budgets

- Desktop scene + foreground: højst 420 kB.
- Desktop parchment + wordmark + alle kritiske materialer: højst 180 kB.
- Mobile scene + foreground: højst 230 kB.
- Mobile parchment + wordmark + alle kritiske materialer: højst 120 kB.
- En viewport må ikke hente assets for en anden viewport.

**Commit checkpoint C**

`feat: udskær titelens malede materialer`

### Implementation Phase D — Integration and iterative closure

- **GOAL-004**: Integrér de nye lag i den semantiske titelskærm og iterér
  målbart til alle closure-gates og eksisterende kontrakter er grønne.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Opret `src/ui/title-art.ts`; wire `<picture>`-lag ind i `showTitleScreen()` uden at ændre state-, knap- eller modaladfærd. Bevar ét semantisk h1 og marker synlig wordmarkkunst dekorativt. | | |
| TASK-013 | Omskriv kun titelblokken i `src/ui/style.css`: fjern `scene-ext.webp`, blur/mask-sømmen og CSS-wordmarkfyldet; placer scene, foreground, parchment, wordmark og materialer ved alle seks viewports. | | |
| TASK-014 | Opdatér `tests/title-screen.test.ts`, `tests/judge-registry.test.ts` og `tools/ux_audit.mjs` til den nye semantiske kontrakt: synlig art + tilgængelig tekst, korrekt fokus, modal og asset-natural-size. | | |
| TASK-015 | Kør iterative captures med én defektklasse pr. commit-amend-cyklus. Luk først seam/foreground, derefter wordmark/materialer, derefter responsive/payload. Ingen palettetuning. | | |
| TASK-016 | Kør fuld gate, hæv kun baselines, skriv final evidence til `.judge/fidelity-final`, og commit integrationscheckpoint D. | | |

#### TASK-012 execution

**Ownership**

- `src/ui/title-art.ts`
- `src/ui/main.ts`

`title-art.ts` eksporterer kun Vite-resolverede URL'er og de deklarerede
native dimensioner. `showTitleScreen()` skal renderere lagene i denne orden:

1. scene `<picture aria-hidden="true">`
2. foreground `<picture aria-hidden="true">`
3. parchment `<picture aria-hidden="true">`
4. semantisk indhold
5. decorative wordmark image inde i `<h1>`
6. chip og tools

H1-kontrakten er:

```html
<h1 class="title-mark title-block">
  <span class="title-mark-semantic">The Ascent of Karl</span>
  <img class="title-wordmark-art" alt="" aria-hidden="true">
</h1>
```

`title-mark-semantic` skjules med den eksisterende visually-hidden-teknik,
som bevarer accessibility tree. Der må ikke oprettes et ekstra heading.

**RED/GREEN**

- RED:
  `npx vitest run tests/title-screen.test.ts tests/judge-registry.test.ts`
  efter tests er omskrevet til den nye kontrakt.
- GREEN: source-testen ser ét h1, én semantisk tekstspan, dekorativt image,
  uændret Fates/Begin/Continue-logik og ingen positiv `tabindex`.

#### TASK-013 execution

**Ownership**

- `src/ui/style.css`

Følgende er forbudt i den nye titelblok:

- `scene-ext.webp`
- `filter: blur(...)` som samlingsmekanisme
- et scene-pseudoelement med gradientmaskeret lodret eller vandret seam
- `background-clip:text` som synlig wordmark
- runtime-opskalering på de to DPR2-viewports

Følgende bevares:

- dynamic viewport units
- title overlay z-index
- focus-visible sandwich-ring
- reduced-motion-kontrakt
- eksisterende state-afhængige knaplayout

#### TASK-014 execution

1. `tests/title-screen.test.ts` skal teste `<picture>`/dimensioner og den nye
   h1-kontrakt.
2. `tests/judge-registry.test.ts` skal fjerne det gamle forbud mod synligt
   wordmark-image og i stedet kræve dekorativ art + semantisk tekst. Den
   eksisterende structure-deviation for `headline` og `ribbon` fjernes kun,
   hvis deres endelige score når den eksisterende tærskel uden undtagelsen.
3. `tools/ux_audit.mjs` skal i rigtig browser bekræfte:
   præcis én heading, korrekt accessible name, fokusorden, Fates-modal,
   sound-label, ingen horisontal scroll og ingen fysisk upscale på DPR2.
4. GREEN:
   `npx vitest run tests/title-screen.test.ts tests/judge-registry.test.ts`
   og `npm run ux`.

#### TASK-015 iteration order

Brug disse præcise run-navne:

```bash
npm run judge:title-fidelity -- --out .judge/fidelity-d1
npm run judge:title-fidelity -- --out .judge/fidelity-d2
npm run judge:title-fidelity -- --out .judge/fidelity-d3
```

- D1 må kun ændre scene/foreground-placering.
- D2 må kun ændre wordmark/ribbon/chrome-geometri.
- D3 må kun ændre responsive source selection, payload eller natural-size.
- En ændring accepteres kun, hvis den tiltænkte gate forbedres, ingen hård
  gate går fra grøn til rød, og `collectScoreRegressions` rapporterer nul
  fald over 0.02.
- Efter tre mislykkede forsøg i samme defektklasse stoppes arbejdet og
  TASK-008's masterblokering bruges.

#### TASK-016 final gate

Kør:

```bash
npm test
python3 -m pytest tools/art/tests -q
python3 tools/validate.py
npm run build
npm run build:pages
npm run pages:verify
npm run ux
npm run test:visual
npm run judge:determinism
npm run judge:title-fidelity -- --out .judge/fidelity-final
git diff --check
```

Opdatér `tests/visual-baseline.json` med
`max(oldValue, median(finalRun1, finalRun2, finalRun3))` pr. existing aspect.
Ingen værdi må falde. Opdatér registry-tærskler opad, hvis den nye målte
baseline tillader det; sænk aldrig en tærskel.

**Commit checkpoint D**

`feat: luk titelens målte fidelityafstand`

### Implementation Phase E — Later element-art pipeline audit

- **GOAL-005**: Auditér senere elementkunstens buildkontrakt uden at holde den
  allerede grønne titelgates som gidsel.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Kør read-only audit af `tools/art/build_element_art.py`, `tools/art/build_elements.py`, `tools/art/sheet_ingest.py`, deres tests og de committede element-SHA'er. Ingen titelgate afhænger af resultatet. | | |
| TASK-018 | Hvis en delt helperændring fra Stream B/C ændrer elementoutput, isolér titellogikken i egne filer eller revert den delte ændring. Kun en faktisk regression gør TASK-018 blokerende. Commit checkpoint E er separat fra title closure. | | |

**Commit checkpoint E**

`test: auditér elementkunstens pipeline`

## Task DAG

| Node | Task reference | Depends on | Parallel with | Blocking title closure |
|------|----------------|------------|---------------|------------------------|
| A1 | `TASK-001` | none | none | yes |
| A2 | `TASK-002` | `TASK-001` | `TASK-003` | yes |
| A3 | `TASK-003` | `TASK-001` | `TASK-002` | yes |
| A4 | `TASK-004` | `TASK-002`, `TASK-003` | none | yes |
| B1 | `TASK-005` | `TASK-004` | `TASK-009` | yes |
| B2 | `TASK-006` | `TASK-005` | `TASK-009`, `TASK-010` | yes |
| B3 | `TASK-007` | `TASK-005` | `TASK-009`, `TASK-010` | yes |
| B4 | `TASK-008` | `TASK-006`, `TASK-007` | `TASK-011` | yes |
| C1 | `TASK-009` | `TASK-004` | `TASK-005`, `TASK-006`, `TASK-007` | yes |
| C2 | `TASK-010` | `TASK-009` | `TASK-006`, `TASK-007` | yes |
| C3 | `TASK-011` | `TASK-010` | `TASK-008` | yes |
| D1 | `TASK-012` | `TASK-008`, `TASK-011` | none | yes |
| D2 | `TASK-013` | `TASK-012` | none | yes |
| D3 | `TASK-014` | `TASK-012`, `TASK-013` | none | yes |
| D4 | `TASK-015` | `TASK-014` | none | yes |
| D5 | `TASK-016` | `TASK-015` | none | yes |
| E1 | `TASK-017` | `TASK-016` | none | no |
| E2 | `TASK-018` | `TASK-017` | none | only on proven shared-output regression |

## Commit protocol

Hvert checkpoint skal være atomisk og bruge det angivne danske conventional
subject. Commit body skal nævne udførte gates og eventuelle afviste forsøg.
Alle commits skal have:

- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- `Copilot-Session:` sat til den faktiske id fra den session, der laver
  committet; en tidligere sessions id må aldrig kopieres.

## 3. Alternatives

- **ALT-001**: Behold den nuværende CSS/Fraunces-wordmark og sænk
  structure-/ink-tærsklerne. Afvist: current er en regressionsbaseline, ikke
  målet, og brugeren forbyder tærskelsænkning.
- **ALT-002**: Brug hele referencescreenshotet som én statisk hero. Afvist:
  Begin/Continue/Fates/sound bliver ikke dynamiske, semantikken duplikeres,
  mobile art direction forsvinder, og payloadbudgettet brydes.
- **ALT-003**: Generér en ny wide/portrait master som første skridt. Afvist
  indtil den deterministiske target-derived vej har bevist en konkret mangel;
  værktøj/service er ikke tilgængelig for den automatiske pipeline.
- **ALT-004**: Fortsæt med `scene-ext.webp` + blur/mask og finjustér seam med
  flere CSS-lag. Afvist: current seam måler 13.18 mod gate 4.0; flere lag
  skjuler overgangen, men genskaber ikke en kontinuerlig scene.
- **ALT-005**: Global palettejustering. Afvist: tone matcher allerede, og en
  global ændring risikerer at sænke alle eksisterende regionbaselines uden at
  løse de fem faktiske mål.

## 4. Dependencies

- **DEP-001**: Den godkendte, pixelpinnede reference og nuværende
  kalibreringscapture fra provenance-tabellen.
- **DEP-002**: Node 22, projektets eksisterende Playwright/Vite/Vitest.
- **DEP-003**: Python 3.12 med de pinnede build-time billedbiblioteker fra
  Stack-tabellen; ingen ny runtime-afhængighed.
- **DEP-004**: `vite preview` på port 5199, startet og stoppet af capture.
- **DEP-005**: En manuelt godkendt new/outpainted master er en betinget
  dependency, kun hvis TASK-008 failer. Den er ikke tilgængelig ved
  planens oprettelse.

## 5. Files

- **FILE-001**: `plan/design-fidelity-close-1.md` — denne eksekverbare plan.
- **FILE-002**: `docs/design/reference/registry.json` — additive viewports og
  goal metrics; eksisterende regiontal må ikke sænkes.
- **FILE-003**: `tools/judge/title_fidelity.py` — nye pixel- og assetgates.
- **FILE-004**: `tools/judge/title-fidelity.mjs` — capture/scoring-orkestrator.
- **FILE-005**: `tools/judge/capture.mjs` — registrerede viewport/DPR- og
  resource/natural-size-data.
- **FILE-006**: `tests/title-fidelity.test.ts`,
  `tests/judge-capture.test.ts`, `tests/judge-registry.test.ts` — judge- og
  semantikkontrakter.
- **FILE-007**: `tools/art/title-layers.config.json`,
  `tools/art/build_title_layers.py`,
  `tools/art/title-layers.manifest.json`,
  `tools/art/tests/test_build_title_layers.py` — Stream B.
- **FILE-008**: `src/assets/art/title-layers/**` — genererede scene-,
  foreground- og parchmentlag.
- **FILE-009**: `tools/art/title-materials.config.json`,
  `tools/art/build_title_materials.py`,
  `tools/art/title-materials.manifest.json`,
  `tools/art/tests/test_build_title_materials.py` — Stream C.
- **FILE-010**: `src/assets/art/title-materials/**` — wordmark, ribbon og
  chrome-materialer.
- **FILE-011**: `src/ui/title-art.ts`, `src/ui/main.ts`, `src/ui/style.css` —
  integration. Ingen anden UI-fil må ændres.
- **FILE-012**: `tests/title-screen.test.ts`, `tools/ux_audit.mjs` —
  accessibility, interaction og source-selection.
- **FILE-013**: `tests/visual-baseline.json` — må kun beholdes eller hæves.
- **FILE-014**: `package.json` — scriptet `judge:title-fidelity`; ingen ny
  runtime dependency.
- **FILE-015**: `tools/judge/requirements.txt` og
  `.github/workflows/ci.yml` — pinnede build-time billedbiblioteker og et
  separat fidelity-job med Python, Chromium og
  `npm run judge:title-fidelity`.
- **FILE-016**: `docs/design/asset-queue.json` — ændres kun, hvis TASK-008
  registrerer den fail-closed masterblokering.
- **FILE-017**: `tools/art/build_element_art.py`,
  `tools/art/build_elements.py`, `tools/art/sheet_ingest.py`,
  `tools/art/tests/test_build_elements_regression.py` og
  `src/assets/art/elements/**` — Stream E, read-only medmindre en regression
  er bevist.

## 6. Testing

- **TEST-001**: Kalibrering: reference/current giver værdierne og
  tolerancerne i TASK-002; current fejler fem gates.
- **TEST-002**: Registry: alle seks viewports og alle gates findes; ingen
  eksisterende threshold er lavere end før.
- **TEST-003**: Capture: DPR, viewport, currentSrc, natural size, physical
  render size og fetched bytes logges deterministisk.
- **TEST-004**: Scene: seam <=4.0, detail >=300, edge density >=6.1 og
  retention >=95 %.
- **TEST-005**: Parchment: samlet blank retention >=85 %, hver prøve >=80 %.
- **TEST-006**: Alpha: sort/hvid/parchment composites har <=1 px transition
  og fringe.
- **TEST-007**: Payload: desktop <=600 kB, mobile <=350 kB; kun faktisk
  hentede title-critical assets tælles.
- **TEST-008**: DPR2: hvert `<img>` har natural pixels >= renderede fysiske
  pixels i begge akser.
- **TEST-009**: Accessibility: ét h1 med korrekt navn, dekorativ visible art,
  uændret fokusorden og brugbar Fates-modal.
- **TEST-010**: Regression: ingen existing region/aspect falder mere end
  0.02; baselines sænkes ikke.
- **TEST-011**: Determinisme: to art-builds er byte-identiske; to captures
  ligger inden for den eksisterende determinismetolerance.
- **TEST-012**: Elementisolering: Stream B/C ændrer ingen eksisterende
  elementfil; SHA-listen er identisk før og efter title closure.

## 7. Risks & Assumptions

- **RISK-001**: Den godkendte reference indeholder ikke scene-pixels bag
  pergamentet og indeholder ikke højere opløsningsdetalje end 1586×992.
  Deterministisk rekonstruktion kan derfor ramme en ægte informationsgrænse.
  TASK-008 gør grænsen fail-closed.
- **RISK-002**: WebP-budget og 95 % detaljebevarelse kan være i konflikt.
  Løsning: fjern ikke kunst eller sænk retention; brug art direction og lad
  kun den valgte viewportfil blive hentet.
- **RISK-003**: Painted wordmark kan skabe accessibility-duplikering.
  Løsning: én semantic textspan, dekorativ art, rigtig browser-AX-test.
- **RISK-004**: En ny scene kan forbedre target-native og forværre mobile.
  Løsning: separate, registrerede art-directed outputs og gates.
- **RISK-005**: En delt art-helper kan ændre elementkunst ved et uheld.
  Løsning: title-specifikke scripts og SHA-isolation; Stream E bliver kun
  blokerende ved konkret ændring.
- **ASSUMPTION-001**: Download-PNG og repo-WebP er samme godkendte kunst.
  Dette er verificeret pixel-for-pixel i RGB.
- **ASSUMPTION-002**: Global palette er allerede tilstrækkelig; de supplied
  fejl er struktur/detail, ikke tone.
- **ASSUMPTION-003**: Productets settings-knap findes ikke; den eksisterende
  tilladte afvigelse gear→sound forbliver.

## Rollback

1. Gamle title-assets slettes ikke i denne plan. De forbliver urefererede som
   rollbackmateriale indtil en senere oprydning.
2. Revert checkpoint D gendanner gammel markup/CSS uden at fjerne de nye,
   ubrugte assets.
3. Revert checkpoint C og B fjerner derefter materialer og layers.
4. Revert checkpoint A fjerner de nye goal metrics; dette er kun lovligt ved
   fuld rollback af initiativet, aldrig som måde at få en rød implementation
   igennem.
5. `tests/visual-baseline.json` gendannes fra commit før checkpoint D; fordi
   planen aldrig sænker tal, kan rollback ikke skjule en regression.

## Plan self-review

Før plancommittet og igen før TASK-001 udføres:

```bash
git diff --check
git status --short
python3 -c 'from pathlib import Path; p=Path("plan/design-fidelity-close-1.md"); s=p.read_text(); bad=["X"*3,"T"+"BD","FIX"+"ME","TO"+"DO","<"+"replace"+">"]; hits=[x for x in bad if x in s]; assert not hits, hits'
grep -oE '\| (TASK|GOAL)-[0-9]+ \|' plan/design-fidelity-close-1.md | sed -E 's/.*((TASK|GOAL)-[0-9]+).*/\1/' | sort | uniq -d
grep -oE '^- \*\*(REQ|SEC|CON|GUD|RISK|ASSUMPTION|TASK|GOAL|FILE|TEST|PAT|ALT|DEP)-[0-9]+\*\*:' plan/design-fidelity-close-1.md | sed -E 's/^- \*\*([A-Z]+-[0-9]+)\*\*:.*/\1/' | sort | uniq -d
```

De to sidste kommandoer skal returnere tomt output. `git status --short` skal
ved selve plancommittet kun vise `plan/design-fidelity-close-1.md`.

## 8. Related Specifications / Further Reading

- `DESIGN.md` — visuel lov; især titelmaterialer, tilgængelighed og anti-mønstre.
- `plan/design-title-screen-1.md` — den nuværende titelskærms implementeringshistorik.
- `plan/design-visual-target-1.md` — target-derived artprincipper og elementkunst.
- `plan/architecture-visual-judge-1.md` — regressionsdommer, registry,
  `maxDrop` og queue-routing.
- `docs/design/reference/registry.json` — regioner, referenceskærme og
  eksisterende thresholds.
- `docs/design/asset-queue.json` og `docs/design/human-queue.json` — tidligere
  dokumenterede asset- og strukturblokeringer.
