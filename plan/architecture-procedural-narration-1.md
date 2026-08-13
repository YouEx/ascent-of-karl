---
goal: Gøre fortælleren i stand til at fortælle om præcis de to ting spilleren lagde sammen — hver gang, for hvert par, uden at "nothing happens" nogensinde optræder igen
version: 1.0
date_created: 2026-08-12
last_updated: 2026-08-13
owner: Martin (YouEx)
status: 'In progress'
tags: [architecture, engine, narrator, content, tooling, feature]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

> **Fase 1-3 er leveret og udrullet** (2026-08-12). Motoren dømmer på tags,
> hver dom bærer bevismateriale, og 312 varianter fordelt på 52 grupper giver
> hvert par et svar der nævner begge elementer ved navn. Målt på 2.933
> fiasko-ture svarer grammatikken på 62,3 %; resten tager frister, hint og
> slutninger, som alle er mere presserende. `genericFailure` nås aldrig —
> håndhævet af `tests/grammar.test.ts`, ikke af skøn.
>
> **Fase 4 er ført frem til bundtloftet** (2026-08-13). Ni bagte fiasker blev
> fjernet, fordi parrene siden fik en opskrift; validatoren og
> `tests/pairs.test.ts` bevogter nu RISK-005 mod både betingede, ubetingede og
> blandede opskrifter. Derefter tilføjede runde 3 de
> næste 25 målte par. Facittet har **420 opslag / 940 varianter**; 294 af de
> 1.005 målte par har mindst én bagt dom, og de dækker **71.2 %** af alle
> fiasko-møder over 1.200 gennemspilninger. Grammatikken tager 28.8 %;
> tavshed tager 0. Filen lazy-loades og vejer **60.833 bytes = 59.4 KiB gzip**
> mod CON-003's loft på 60 KiB. Der er 607 bytes tilbage. TASK-022 er derfor
> stadig åben: 304 af den målte top-600 er bagt, og næste batch kræver
> kompression eller en eksplicit budgetbeslutning — loftet hæves ikke stiltiende.
>
> **Recovery-beslutning for improvisation** (2026-08-13): verdikt-motoren er
> nu også den deterministiske portvagt for `Engine.improvise()`. Kun
> `plausible`/`absurd` fortsætter; improviserede forældre må ikke kaldes
> `inert` alene, fordi de naturligt mangler i canon-indexet. Gameplay-
> klassifikation og ids ejes af offline-regler. En fremtidig model må kun
> forbedre navn/flavor og ændrer hverken denne plans verdikt eller tags.

Ved planens start havde spillet 187 elementer og 225 opskrifter: 17.578
mulige uordnede par (inklusive selv-par), hvor 17.353 faldt tilbage på otte
generiske hånlinjer. **Status 2026-08-13:** opskriftsbogen har 409
kombinationer, grammatikken svarer på alle øvrige par med begge navne, og
den nu 14-linjers generiske pulje er en teknisk nødudgang med 0 hits i 2.000
simulerede runs.

Målt på den rigtige motor over 4.000 gennemspilninger: **80,6 % af alle forsøg fejler**, og et liv er 50 somre. En spiller møder altså omkring 40 fiaskoer pr. run og ser dermed hver af de otte linjer omkring fem gange på ét liv. **Fiaskoteksten er ikke en randbemærkning i spillet — den er spillets største tekstflade.** Den er i dag den eneste flade uden indhold.

Samme måling giver løsningens form: de 4.000 runs rørte kun **1.657 forskellige par**, og de 500 hyppigste dækkede **96 %** af alle møder. Rummet er kombinatorisk uendeligt; *oplevelsen* er det ikke. Derfor skal planen ikke skrive 17.578 replikker og heller ikke kalde en sprogmodel ved runtime. Den skal gøre tre ting:

1. **Give motoren en dom i stedet for en boolean.** `{ kind: "nothing" }` bærer i dag ingen information — ikke engang hvilke to elementer der blev prøvet. En fortæller kan ikke fortælle om noget, han ikke får at vide. Alt andet i planen hviler på dette.
2. **Lægge et grammatikgulv ind**, så hvert tænkeligt par — også fremtidige elementer — har en replik der nævner netop de to ting. Offline, deterministisk, gratis.
3. **Bage håndskrevet kvalitet ind i hovedet af fordelingen**, hvor spillerne faktisk er, så gulvet sjældent er det man hører.

Planen er en ombygning af udfaldsmodellen, ikke en omskrivning af spillet. Motorens rene, deterministiske kontrakt består.

## 1. Requirements & Constraints

- **REQ-001**: Ethvert kombinationsforsøg skal give en replik, der navngiver begge de valgte elementer eller utvetydigt henviser til dem. Ingen replik må kunne gives til to vilkårlige par uden ændring.
- **REQ-002**: `"Nothing happens"` og enhver anden indholdsløs afvisning fjernes fra spillet. Den generiske pulje afskaffes som *primær* mekanisme og bevares kun som teknisk nødudgang, der aldrig nås i praksis (jf. TEST-004).
- **REQ-003**: Motoren skal for hvert ikke-matchende par udlede en **dom** med bevismateriale, ikke blot konstatere fravær af opskrift.
- **REQ-004**: En opskrift, der findes men er spærret af flag eller akt, skal give en anden dom end et par uden opskrift. *Dette er en eksisterende fejl:* `Engine.matchCombo` filtrerer flag-spærrede opskrifter fra og returnerer `undefined`, hvorefter `resolve` svarer `{ kind: "nothing" }`. Spilleren får samme afvisning for et rigtigt, endnu ikke åbnet greb som for vrøvl.
- **REQ-005**: Fortællerens hints skal kunne udledes af domme, så et forslag er sandt pr. konstruktion i stedet for pr. validator (lukker sløjfen om `suggests`-hukommelsen fra `d70d232`).
- **REQ-006**: Genererede replikker skal være i fortællerens stemme, målt mod de eksisterende håndskrevne replikker, ikke skønnet.
- **REQ-007**: Systemet skal skalere med indhold: nye elementer må aldrig kunne indføre et par uden dækning, uden at nogen skriver noget.
- **REQ-008**: Spilleren skal opleve fiasko som en pointe, ikke som en straf — fiaskoreplikken er belønningen for at prøve noget skævt.
- **SEC-001**: Ingen API-nøgle må ende i klientbundtet. Spillet er en statisk GitHub Pages-side; alt hvad der udleveres til browseren er offentligt.
- **CON-001**: Ingen server. Ingen runtime-afhængighed af tredjepart i det færdige spil.
- **CON-002**: Motoren skal forblive ren og deterministisk: samme state + samme input → samme udfald. Al tilfældighed går gennem den serialiserbare `rngState` i `NarratorState`.
- **CON-003**: Bundtbudget. Bagt tekst må lazy-loades pr. akt og må ikke belaste første indlæsning. Grænse: ≤ 60 KB gzip pr. akt.
- **CON-004**: `turnLimit` er 50. Hver replik konkurrerer om ekstremt lidt spillertid; længde koster mere her end i et spil uden urets pres.
- **CON-005**: PRD §5 gælder uændret: en sprogmodel skriver aldrig direkte i `content/`. Udkast lander i `content/narrator/drafts/` og flyttes ind af et menneske.
- **CON-006**: Gamle saves skal blive ved med at loade. `Narrator.loadState` og `Engine.loadState` fletter over frisk state; nye felter skal have brugbare defaults.
- **GUD-001**: Mål frem for skøn. Enhver påstand om dækning, hyppighed eller kvalitet skal komme fra et kørt værktøj — samme metode som den visuelle dommer i `plan/architecture-visual-judge-1.md`.
- **GUD-002**: Dommen bestemmer *komisk register*, ikke informationsmængde. En fiasko er en vits om to konkrete ting, ikke en fejlmeddelelse med gode manerer.
- **GUD-003**: Sjov én gang, docerende tre. Alt nyt skal arve `slowUsed`- og `SUGGESTION_TTL`-lektien: afkøling, forbrug ved brug, eller begge.
- **GUD-004**: Dansk i kode, kommentarer og commits. Al spillervendt tekst på engelsk.
- **PAT-001**: Motoren afgør *hvad der skete*; fortælleren afgør *hvordan det siges*. Grammatik og bagte replikker hører til fortællerlaget og må ikke sive ind i `engine.ts`.
- **PAT-002**: Tre lag med faldende kvalitet og stigende dækning: bagt replik → grammatik → nødudgang. Hvert lag er komplet uden lagene over sig.
- **PAT-003**: Al indholdsudvidelse valideres af `tools/validate.py`, som skal kunne afvise et brud uden at nogen kører spillet.
- **PAT-004**: Taksonomi frem for regler pr. element. Elementer bærer egenskaber; domme udledes af egenskaber. Ingen `if (id === "sten")` nogen steder.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Erstat gætteriet med tal, og giv de 187 elementer den semantik en fortæller kan tale ud fra. Uden taksonomien er alle senere faser umulige; uden målingen er de uprioriterede.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Byg `tools/sim.mjs`: kør N gennemspilninger på den rigtige `Engine` og udskriv mødefordelingen af par. To politikker: `random` (baseline, allerede målt: 1.657 par, 80,6 % fiasko) og `greedy` (foretrækker par der deler `stuff`-tag eller har givet fund før — en proxy for en rigtig spiller). Skriv resultatet til `docs/design/pair-frequency.json` som rangeret liste `[{pair, count, share, cumShare}]`. Commit output. | ✅ | 2026-08-11 |
| TASK-002 | Udvid `ElementDef` i `src/core/types.ts` med taksonomi: `kind` (material \| tool \| food \| creature \| person \| structure \| phenomenon \| abstract), `stuff` (stone \| wood \| plant \| flesh \| clay \| metal \| water \| fire \| fibre \| bone \| none), `traits` (streng-array fra fast liste: hard, soft, sharp, blunt, hot, cold, wet, dry, alive, dead, edible, heavy, light, fragile, sticky), `scale` (hand \| body \| camp \| landscape). Alle felter valgfrie i typen, obligatoriske i validatoren, så migrationen kan ske i to skridt. | ✅ | 2026-08-11 |
| TASK-003 | Skriv `tools/tag_elements.py` efter mønstret i `tools/generate_lines.py`: send hvert element (id, navn, flavor, karlMood) til Groq/Ollama og bed om taksonomi som JSON. Skriv til `content/drafts/element-tags.json`. **Rører aldrig `content/elements.json`** (CON-005). | ✅ | 2026-08-11 |
| TASK-004 | Gennemgå de 187 udkast i hånden og flet dem ind i `content/elements.json`. Prioritér de 40 elementer der optræder oftest i `pair-frequency.json` — deres tags er dem spilleren møder. | ✅ | 2026-08-11 |
| TASK-005 | Tilføj validatorregler i `tools/validate.py`: hvert element skal have `kind`, `stuff`, `scale` og mindst ét `traits`-element; alle værdier skal være i de tilladte mængder; ukendt trait er en fejl, ikke en advarsel. | ✅ | 2026-08-11 |
| TASK-006 | Rapportér i `docs/design/pair-frequency.json`-noten hvor mange af de 63 elementer, der ikke indgår i nogen opskrift, ligger i toppen af mødefordelingen. Disse er spillets blindgyder og får deres egen dom (`inert`) i fase 2. | ✅ | 2026-08-11 |

### Implementation Phase 2

- GOAL-002: Motoren skal aldrig svare "ingenting". Den skal svare *hvorfor* ingenting, med bevismateriale nok til at nogen kan lave en vits ud af det.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Erstat `{ kind: "nothing" }` i `src/core/types.ts` med `{ kind: "nofuse"; a: ElementDef; b: ElementDef; verdict: Verdict; evidence: VerdictEvidence }`. Behold `"nothing"` som deprecated alias i én release, så saves og tests kan migrere. | ✅ | 2026-08-12 |
| TASK-008 | Opret `src/core/verdict.ts` med den rene klassifikator `judgePair(engine, a, b): { verdict, evidence }`. Ingen tilfældighed, ingen tekst, ingen afhængighed af fortælleren. Rækkefølgen er prioriteret og første match vinder. | ✅ | 2026-08-12 |
| TASK-009 | Implementér dom `locked`: der findes en `ComboDef` for parret, men `flagsAllow` eller akt spærrer den. Evidens: de manglende flag. **Retter REQ-004.** Kræver at `Engine.matchCombo` udstiller de frafiltrerede kandidater i stedet for at kaste dem væk. | ✅ | 2026-08-12 |
| TASK-010 | Implementér dom `near-miss`: ét af de to elementer indgår i en rigtig opskrift sammen med et element spilleren allerede har opdaget. Evidens: den rigtige partner og resultatet. Dette er den mest værdifulde dom — den er både komisk ("halvt rigtigt") og den eneste ærlige kilde til et hint. | ✅ | 2026-08-12 |
| TASK-011 | Implementér de resterende domme: `self` (a+a uden selvopskrift), `inert` (mindst ét element indgår i ingen opskrift overhovedet), `clash` (tags udelukker hinanden, fx hot+wet, alive+edible-uden-værktøj, fragile+heavy), `plausible` (deler `stuff` eller er tool+material / fire+food — et rigtig godt indfald der bare ikke er skrevet), `absurd` (afstand i `kind` og `scale` er stor). `plausible` og `absurd` er default-parret: alt der ikke faldt i en tidligere dom er ét af de to. | ✅ | 2026-08-12 |
| TASK-012 | Skriv fordelingsrapporten `tools/verdict_report.mjs`: kør `judgePair` på alle 17.578 par og på `pair-frequency.json`-hovedet, og udskriv fordelingen pr. dom. Mål: ingen dom under 3 % og ingen over 45 % i den vægtede fordeling — ellers er taksonomien for grov, og TASK-011's tærskler skal justeres. | ✅ | 2026-08-12 |
| TASK-013 | Opdatér alle forbrugere af `CombineOutcome`: `src/ui/main.ts`, `src/narrator/narrator.ts`, `src/core/challenge.ts`, `src/ui/playtest.ts`. Compileren udpeger dem, når `"nothing"` fjernes fra unionen. | ✅ | 2026-08-12 |
| TASK-014 | Kobl dommen til `suggests`-hukommelsen: når fortælleren hinter ud fra en `near-miss`- eller `locked`-dom, registreres parret via den eksisterende `rememberSuggestions`-vej. Et hint udledt af en dom kan ikke lyve (REQ-005). | ✅ | 2026-08-12 |

### Implementation Phase 3

- GOAL-003: Læg gulvet. Hvert af de 17.578 par — og hvert par nye elementer nogensinde kan danne — får en replik der nævner netop de to ting. Offline, deterministisk, gratis.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | Dekonstruér de eksisterende håndskrevne replikker: gennemgå `narratorLine`-replikkerne og de generiske og udtræk deres byggedele (optakt, vending, punchline-form). Grammatikkens dele skal være forfatterens egne ord, ellers falder stemmen fra hinanden mellem lagene. Skriv resultatet til `content/narrator/grammar-act-1.json`. **Det oprindelige arbejdsskøn var 71; dagens indhold har 74 referencer til 61 unikke `narratorLine`-tekster. Fase 5 bruger det bredere, egentlige stemmekorpus: 173 håndskrevne linjedefinitioner / 866 varianter.** | ✅ | 2026-08-12 |
| TASK-016 | Definér grammatikformatet: regler nøglet på `verdict` og valgfri tag-signatur, fx `plausible:stone+wood`, med fald tilbage til `plausible:*`. Hver regel har varianter og kan bruge `{a}`, `{b}`, `{trait}`, `{mood}`, `{partner}` (fra evidensen). Genbrug `NarratorLineDef`-formen, så validator, lyd-opslag og varianthukommelse virker uændret. | ✅ | 2026-08-12 |
| TASK-017 | Byg `src/narrator/grammar.ts`: `renderVerdict(state, outcome): SpokenLine`. Vælger regel på mest specifikke tag-signatur, vælger variant gennem den eksisterende `rand()`/`pickVariant`-mekanik, udfylder pladsholdere gennem den eksisterende `fill`. Ingen ny RNG (CON-002). | ✅ | 2026-08-12 |
| TASK-018 | Tilføj anti-gentagelse på tværs af domme. Det første globale K=6-vindue bestod den lokale test, men TEST-007 fandt op til 5 gentagelser i ét run. `NarratorState.recentGrammar` holder nu en separat, implicit cyklus pr. pulje: alle replikker i dommen skal høres, før puljen nulstilles. | ✅ | 2026-08-12 |
| TASK-019 | Indsæt grammatikken i `reactTo` som nyt trin lige før `genericFailureLine`. Den generiske pulje bliver dermed uopnåelig i praksis og bevares kun som nødudgang, hvis grammatikken mangler en regel — hvilket TEST-004 forbyder. | ✅ | 2026-08-12 |
| TASK-020 | Skriv mindst 6 varianter pr. dom for de otte domme (≈ 48 regler) og tag-specialiseringer for de 12 hyppigste `stuff`-par fra TASK-001. | ✅ | 2026-08-12 |

**Tillæg 13-08-2026:** En branch-gennemgang fandt, at en udtømt pulje blev
nulstillet helt før næste lodtrækning. Dermed kunne den nye cyklus begynde med
det samme joke-id, som netop sluttede den gamle. En deterministisk 1.000-runs
test fandt fem konkrete frø før rettelsen. Reset-logikken udelukker nu kun den
seneste replik fra den første lodtrækning og starter derefter en fuld ny cyklus
med det valgte id. Resultat: ingen nabogentagelser, stadig højst tre forekomster
pr. run i TEST-007's 2.000 runs, og nødudgangen forbliver på 0 hits.

### Implementation Phase 4

- GOAL-004: Bag håndskrevet kvalitet ind, hvor spillerne faktisk er. Grammatikken skal være gulvet man sjældent hører, ikke loftet.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Byg pipelinen der skriver par-replikker: `tools/prepare_pairs.ts` udskriver batch-briefs med begge navne, flavor, karlMood, den målte dominerende dom, evidensen og de grammatikreplikker udkastet skal slå. Udkast lander i `content/narrator/drafts/pairs-*.json`. (Blev briefs til en skribent frem for et direkte modelkald — samme opgave, men udkastet kan læses og afvises af et menneske, jf. CON-005.) | ✅ | 2026-08-12 |
| TASK-022 | Fastlæg N ud fra måling, ikke mavefornemmelse: N=500 dækker 96 % af møderne, N=1000 dækker 99,3 %. Start ved N=600 og udvid, hvis TEST-007 viser, at gulvet høres for ofte. **Status 2026-08-13: 420 opslag / 940 varianter; 294 målte par og 71.2 % vægtet dækning. 304 af top-600 er bagt. Runde 3 nåede 59.4 KiB af 60 KiB-loftet (607 bytes tilbage), så N=600 er ikke bevist nået og opgaven forbliver åben, indtil indholdet komprimeres eller budgettet besluttes på ny.** | | |
| TASK-023 | Menneskelig gennemgang af udkastene. Afvis frem for at rette: en middelmådig bagt replik er værre end grammatikken, fordi den optager pladsen. Godkendte replikker flyttes til `content/narrator/pairs-act-1.json`. (`tools/check_pairs.py` er porten, og `assemble_pairs.py` kører den igen ved fletning — tillid er ikke en kontrol.) | ✅ | 2026-08-12 |
| TASK-024 | Lazy-load de bagte replikker pr. akt med en dynamisk `import()`, så de ikke ligger i første bundt (CON-003). Mål den faktiske gzip-størrelse og skriv den i planens statusnote. **Målt efter integrationsrettelsen: 60.833 bytes = 59.4 KiB gzip.** Budgettet bevogtes af `tools/validate.py`, ikke af build-loggen. | ✅ | 2026-08-12 |
| TASK-025 | Slå bagte replikker op som første trin i fiaskokæden: bagt → grammatik → nødudgang. Opslaget sker på `pairKey`, så rækkefølgen af de to elementer er ligegyldig. | ✅ | 2026-08-12 |
| TASK-026 | Byg `tools/coverage_report.mjs`: hvor stor en andel af den *vægtede* mødefordeling har en bagt replik? Rapportér tallet i `docs/design/narration-coverage.md` og opdatér ved hver bagning. Dette er projektets ledestjerne-tal. | ✅ | 2026-08-12 |

### Implementation Phase 5

- GOAL-005: Bevis at de genererede replikker lyder som fortælleren. Samme metode som den visuelle dommer: mål afstanden, afvis på tallet, ikke på fornemmelsen.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Byg `tools/voice/metrics.py`: udled et stemmefingeraftryk fra de håndskrevne replikker — ordlængdefordeling, sætninger pr. replik, andel af present tense, tegnsætningsrytme, ordforråd uden for korpus, forekomst af de faste figurer (Karl, vildsvinet, "Grub Man"). **71 var det oprindelige arbejdsskøn for `narratorLine`, ikke det rigtige korpusmål: dagens indhold har 74 referencer til 61 unikke tekster, mens stemmekorpusset er 173 håndskrevne linjedefinitioner / 866 varianter. Fingeraftrykket ligger diffbart i `docs/design/narration-voice-fingerprint.json`.** | ✅ | 2026-08-13 |
| TASK-028 | Byg `tools/voice/judge.py`: score enhver kandidatreplik mod fingeraftrykket, 0–1 pr. dimension. Afvis på: over 3 sætninger, over 32 ord, forbudte konstruktioner, moderne ordforråd og genbrug af en punchline. **Leveret med kilde-sammensatte porte: 3/32 er generatorgrænsen for grammatik/live; menneskegodkendte par beholder `check_pairs.py`'s 320-tegnskontrakt og et frosset ordtal-bånd. Kun 14 dokumenterede, generiske lukninger er undtaget fra punchline-genbrug.** | ✅ | 2026-08-13 |
| TASK-029 | Kør dommeren over hele grammatikken (alle regler × alle varianter) og over de bagte replikker. Sæt tærsklen ud fra de håndskrevne replikkers egen score, ikke ud fra et ønsketal. **Tærsklen er håndskrevet p5 = 0,8871. 312 grammatikvarianter og nu 940 bagte varianter passerer; `calibrate.py` regenererer rapporten, mens parrenes godkendte 908-variant-ordtal-baseline forbliver frosset og kun flyttes eksplicit.** | ✅ | 2026-08-13 |
| TASK-030 | Sæt dommeren i `npm run validate` som hård port. Ingen replik kommer i `content/` uden at bestå. Uenigheder mellem dommer og menneske logges i `docs/design/human-queue.json` efter dens eksisterende skema. **`tools/validate.py` kalder nu den ene samlede port, som også beviser byte-for-byte reproducerbarhed fra både grammatik- og par-drafts samt parrenes strukturelle kontrakt.** | ✅ | 2026-08-13 |
| TASK-031 | Byg regressionstesten: simulér mindst 200 runs, opsaml hver afgivet replik, og fejl hvis nogen replik optræder mere end 3 gange pr. run, eller hvis andelen af nødudgangsreplikker er over 0. **Bygget i `tests/narrator-regression.test.ts` og skærpet til 2.000 runs. Nødudgang: 0 hits. Gentagelsesloft: 3 efter at testen fandt og drev rettelsen af TASK-018.** | ✅ | 2026-08-12 |

### Implementation Phase 6

- GOAL-006: Ret balancen, som den nye tekst afslører, og udrul.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-032 | Afgør turøkonomien. Når fiasko bliver sjovt, bliver 50 somre en straf for at lege. Tre muligheder at måle på: (a) uændret, (b) `plausible`- og `near-miss`-fiaskoer koster en halv sommer, (c) turLimit hæves til 60. Beslutning træffes på playtest, ikke på skrivebordet. Dette er en designbeslutning til Martin, ikke en implementeringsdetalje. | | |
| TASK-033 | Playtest i browseren: spil tre fulde runs, log hver replik, og læs dem som en samlet tekst. Illusionen holder eller falder på helheden, ikke på den enkelte linje. | | |
| TASK-034 | Fjern den deprecated `"nothing"`-alias fra `types.ts` og de 14 generiske replikker fra `content/narrator/act-1.json`, når TEST-004 har været grøn i to udrulninger. | | |
| TASK-035 | Opdatér `PRD.md` §2.4 og `docs/design/fortaelleren.md` med den nye trelagsmodel, og skriv en note i `README.md` om, hvordan man tilføjer et element uden at skrive en eneste replik. **Leveret som en komplet offline-kæde (bagt → grammatik → nødudgang) med live tydeligt markeret som valgfrit indskud; README beskriver det data-drevne add-element-workflow.** | ✅ | 2026-08-13 |

## 3. Alternatives

- **ALT-001**: **Infinite Craft-modellen** — lad en sprogmodel opfinde et *nyt element* for hvert par, så intet nogensinde fejler. Fravalgt **som narrationsløsning**: den afskaffer fiaskoen i stedet for at fortælle den, og uden tomrum forsvinder både puslespillet og `near-miss`-komikken. **Delvist omgjort 2026-08-12:** generativiteten er værd at have, men styret mod de kuraterede *mål* frem for at erstatte dem — se `plan/feature-improvised-solutions-1.md`, hvor kun par dømt `plausible`/`absurd` kan improviseres, og hvor motoren, ikke modellen, afgør om resultatet løser en nød. Verdikt-motoren i fase 2 er portvagten, der gør den forskel mulig.
- **ALT-002**: **Bag alle 17.578 par på forhånd.** Fravalgt på tal: målingen viser at 1.657 par nås overhovedet, og 500 dækker 96 %. De resterende ~16.000 replikker ville koste generering og gennemgang for en dækning på under 1 % af oplevelsen — og ville stadig ikke dække element nr. 188.
- **ALT-003**: **Sprogmodel i browseren (WebLLM/WebGPU).** Fravalgt som fundament: 1-4 GB modelvægte mod et spil der i dag indlæses på under et sekund, ingen understøttelse på ældre mobil, og ikke-deterministisk output i en motor hvis kontrakt er determinisme (CON-002). Kan tilføjes senere som ren pynt oven på gulvet.
- **ALT-004**: **Serverless proxy (Cloudflare Worker) med nøgle på serveren.** Fravalgt som fundament, men den rigtige vej hvis live-generering senere ønskes: den løser SEC-001 uden at lægge nøgler i bundtet. Bør først overvejes når TASK-026 viser, hvor lidt der reelt mangler.
- **ALT-005**: **Skriv bare flere replikker i hånden.** Fravalgt: 225 opskrifter tog projektet måneder, og problemet er ikke opskrifterne — det er de 17.353 par uden. Håndskrift skalerer ikke med kvadratet på elementantallet.

## 4. Dependencies

- **DEP-001**: Groq free tier (`llama-3.3-70b-versatile`) eller lokal Ollama, som allerede brugt af `tools/generate_lines.py`. Kun byggetid; ingen runtime-afhængighed.
- **DEP-002**: `vitest` til simulering og regressionstest — allerede i projektet.
- **DEP-003**: `tools/validate.py` skal udvides, ikke erstattes; den er porten alt indhold går igennem.
- **DEP-004**: `docs/design/human-queue.json` og dens skema — genbruges til stemmedommerens uenigheder. Læs skemaet før append; en blind tilføjelse har tidligere slettet indholdet.

## 5. Files

- **FILE-001**: `src/core/types.ts` — `ElementDef` udvides med taksonomi; `CombineOutcome` får `nofuse` med dom og evidens.
- **FILE-002**: `src/core/verdict.ts` *(ny)* — den rene klassifikator. Hjertet i ombygningen.
- **FILE-003**: `src/core/engine.ts` — `matchCombo` skal udstille frafiltrerede kandidater; `resolve` kalder `judgePair` i stedet for at returnere tomhed.
- **FILE-004**: `src/narrator/grammar.ts` *(ny)* — grammatikgulvet.
- **FILE-005**: `src/narrator/narrator.ts` — ny fiaskokæde: bagt → grammatik → nødudgang; anti-gentagelse på tværs af domme.
- **FILE-006**: `content/elements.json` — 187 elementer får tags.
- **FILE-007**: `content/narrator/grammar-act-1.json` *(ny)* — grammatikregler pr. dom.
- **FILE-008**: `content/narrator/pairs-act-1.json` *(ny)* — bagte replikker, lazy-loaded.
- **FILE-009**: `tools/sim.mjs` *(ny)*, `tools/verdict_report.mjs` *(ny)*, `tools/coverage_report.mjs` *(ny)* — måleværktøjerne.
- **FILE-010**: `tools/tag_elements.py` *(ny)*, `tools/generate_pairs.py` *(ny)* — byggetidsgenerering, altid til `drafts/`.
- **FILE-011**: `tools/voice/metrics.py` *(ny)*, `tools/voice/judge.py` *(ny)* — stemmedommeren.
- **FILE-012**: `tools/validate.py` — tag-regler, grammatikdækning, stemmeport.
- **FILE-013**: `docs/design/pair-frequency.json` *(ny)*, `docs/design/narration-coverage.md` *(ny)* — de committede måletal.

## 6. Testing

- **TEST-001**: `judgePair` er ren og deterministisk — samme input giver samme dom over 1.000 kald; ingen afhængighed af `Math.random` eller tid.
- **TEST-002**: Hver af de otte domme har mindst én kendt par-fixture, der udløser præcis den dom. `sten+graes` skal give `near-miss` med `sten+sten → gnister` som evidens.
- **TEST-003**: En flag-spærret opskrift giver `locked` og aldrig `plausible`/`absurd` — regressionstest for REQ-004.
- **TEST-004**: **Totaldækning.** Kør `renderVerdict` på alle 17.578 par i alle domme og fejl, hvis nogen kombination havner i nødudgangen eller producerer en replik uden begge elementnavne. Dette er testen der håndhæver REQ-001 og REQ-002.
- **TEST-005**: Nyt element uden håndskrevne replikker er stadig fuldt dækket — tilføj et syntetisk element i testen og kør TEST-004 igen (REQ-007).
- **TEST-006**: Gamle saves uden tags og uden de nye `NarratorState`-felter loader og kan spille videre (CON-006).
- **TEST-007**: Mindst 200 simulerede runs: ingen replik gentages mere end 3 gange i ét run; andelen af møder dækket af en *bagt* replik rapporteres og må ikke falde mellem to kørsler. ✅ 2026-08-12 — testen kører 2.000 runs og samler 47.264 fiaskokæde-replikker. Nødudgang: 0 hits. Værste gentagelse: 3 efter rettelsen af TASK-018 og udvidelsen af den hyppigste pulje fra 8 til 9 replikker. Bagt-dæknings-rapportering findes fortsat som manuelt måltal i `tools/coverage_report.mjs` (TASK-026), ikke som automatiseret regressionsspærre.
- **TEST-008**: Stemmedommeren kalibreres mod de 866 håndskrevne varianter. ✅ 2026-08-13 — tærsklen er deres egen p5 (0,8871), så ca. 95 % ligger på eller over den ved konstruktion; kandidatlofterne 3 sætninger/32 ord anvendes ikke bagud på korpusset, fordi 144 ægte varianter bruger fortællerens stakkato med 4+ sætninger. Hvis denne fordeling driver, ændres målebåndet synligt i fingerprint-diffet frem for at underkende forfatterens egen stemme.
- **TEST-009**: Hver grammatikregel har mindst 6 varianter, og ingen variant er identisk med en anden på tværs af domme. ✅ 2026-08-12
- **TEST-010**: Bundtstørrelse: første indlæsning vokser ikke, og de lazy-loadede par pr. akt holder sig under 60 KB gzip (CON-003). ✅ 2026-08-12 — CON-003-halvdelen sad allerede i `tools/validate.py`. Tilføjet `tools/bundle_budget.mjs`, kørt som sidste skridt i `npm run build`, til at håndhæve at hovedbundtet ikke vokser (målt 303.528 B / 96.825 B gzip, loft 110 KB). Kan ikke ligge i `validate.py`: CI's `validate-content`-job kører uden Node-setup.

## 7. Risks & Assumptions

- **RISK-001**: **Stemmeklippet.** Grammatikreplikker kan lyde fladere end det håndskrevne korpus (173 linjedefinitioner / 866 varianter), og kontrasten er synlig netop fordi de bedste replikker står lige ved siden af. Modtræk: TASK-015 bygger grammatikken af forfatterens egne dele, og fase 5 måler afstanden i stedet for at håbe.
- **RISK-002**: **Gentagelse dræber illusionen hurtigere end fladhed.** Med ~40 fiaskoer pr. run rammer selv 48 regler den samme replik flere gange. Modtræk: TASK-018 og TEST-007. **Fundet og lukket 2026-08-12:** det første globale K=6-vindue gav 20 overtrædelser og op til 5 gentagelser over 200 runs. Puljerne gennemløbes nu hver for sig, og `plausible` fik en niende replik. Den skærpede måling over 2.000 runs ender på højst 3. Regressionstesten er den blivende port.
- **RISK-003**: **Taksonomien bliver for grov**, så `plausible` sluger alt og alle vitser lyder ens. Modtræk: TASK-012 måler fordelingen og tvinger justering, før der skrives en eneste replik.
- **RISK-004**: **Turøkonomien vælter.** Sjove fiaskoer inviterer til at lege, men 50 somre straffer leg. Modtræk: TASK-032 gør det til en målt beslutning frem for en utilsigtet bivirkning.
- **RISK-005**: **Bagte replikker forældes**, når opskrifter tilføjes: et par der var `plausible` bliver til en rigtig opskrift, og den bagte fiaskoreplik bliver løgn. Modtræk: `pairs-*.json` nøgles på dom *og* par, og validatoren afviser en bagt fiaskoreplik for et par der har fået en opskrift.
- **RISK-006**: **Ombygningen rører `CombineOutcome`**, som alt i UI'et læser. Modtræk: den deprecated alias i TASK-007 og compilerens egen udpegning i TASK-013; ingen "big bang".
- **ASSUMPTION-001**: Målingen med tilfældig spiller er en brugbar *nedre* grænse for koncentrationen. En rigtig spiller kombinerer mere meningsfuldt og rammer derfor hovedet af fordelingen hyppigere — men prøver også bevidst skæve ting, som den tilfældige politik undersampler. TASK-001's `greedy`-politik findes for at prøve antagelsen af.
- **ASSUMPTION-002**: De 63 elementer uden opskrift er blindgyder ved design og ikke manglende indhold. Hvis TASK-006 viser, at de er hyppige, er det rigtige svar at skrive opskrifter, ikke vitser.
- **ASSUMPTION-003**: En gratis sprogmodel kan skrive brugbare *udkast* i denne stemme. Det er allerede forudsat af `tools/generate_lines.py` og PRD §5; fase 5 er forsikringen, hvis antagelsen svigter.
- **ASSUMPTION-004**: Fiaskoreplikken må gerne hjælpe. `near-miss` og `locked` er både vitser og vejvisere, og det er dét, der gør spillet til andet end gætteri.

## 8. Related Specifications / Further Reading

- `PRD.md` §2.1 (kombinationsloopet), §2.3 (bløde gates), §2.4 (fortællerens triggerrækkefølge), §5 (indhold og AI-udkast)
- `DESIGN.md` §3 (stemme og typografi)
- `docs/design/fortaelleren.md` — fortællerens stemme og modelanbefalinger
- `docs/design/challenges.md` — challenge-systemet, som deler turbudget med kombinationer
- `plan/architecture-visual-judge-1.md` — dommer-og-sløjfe-mønstret, som fase 5 er en kopi af på tekstsiden
- `docs/research/raw/research-infinite-craft.md` — hvorfor Infinite Crafts model er fravalgt (ALT-001)
- `d70d232` — `suggests`-hukommelsen, som fase 2 lukker sløjfen om
