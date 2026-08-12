---
goal: Give fortælleren en fjerde kilde til ord — en model der skriver replikken til præcis de to ting spilleren lige prøvede — uden at spillet nogensinde venter, fejler synligt eller bliver afhængigt af den
version: 1.0
date_created: 2026-08-12
last_updated: 2026-08-12
owner: Martin (YouEx)
status: 'In progress'
tags: [feature, narrative, infrastructure, security, cost]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

Denne plan beskriver et lag, der **allerede er bygget**. Det er skrevet i
bagklogskabens lys, og det er med vilje: laget blev prototypet færdigt i én
session, det virker, og det stod derefter uden en plan overhovedet. En
navnløs komponent er en komponent ingen vedligeholder. Planen findes for at
give den et sted at høre til — og for at skrive ned, hvad der *ikke* er
løst endnu, mens det stadig er billigt at rette.

Laget er ikke opfundet her. Det står som **ALT-004** i
`plan/architecture-procedural-narration-1.md` — "serverless proxy med nøglen
på serveren" — med den udtrykkelige betingelse: *"bør først overvejes, når
TASK-026 viser, hvor lidt der reelt mangler."* TASK-026 har kørt. Målingen
i `docs/design/narration-coverage.md` siger 72,4 % bagt, 27,6 % grammatik,
0 % tavshed. Betingelsen er indfriet, og alternativet er dermed ikke
længere et alternativ. Det er en beslutning, der skal skrives ned.

## Hvorfor laget findes

Akt 1 har 187 elementer. Det er 17.578 mulige par. 404 er skrevet i hånden,
og de dækker tre fjerdedele af alt, spillere faktisk møder — men fordelingen
har en hale, og halen er ikke ligegyldig: **det er præcis i halen, spilleren
leder, når han er kørt fast.** De almindelige par har han prøvet.

Grammatikken dækker resten, og den er god. Men den kender kun motorens dom
og elementernes tags. Den kan sige "the wet thing does not take the dry
thing" i tolv variationer. Den kan ikke vide, at det ER en tromme og en bæk,
og at der findes en vittighed i netop dét.

## De tre jernregler

Reglerne er håndhævet af formen, ikke af disciplin. Det er forskellen på et
lag der holder, og et lag der holder indtil nogen har travlt.

1. **Den venter aldrig.** `react()` er synkron og bliver det. Kaldet ud i
   verden sker, når andet felt fyldes — mens spillerens hånd stadig er på
   vej mod knappen. Der er ingen `await` nogen steder i den vej, spillet
   faktisk går.
2. **Den fejler aldrig synligt.** Er svaret ikke landet, taler grammatikken,
   præcis som før. Ingen spinner, ingen tom boble, ingen forskel at få øje
   på. Netværksfejl er ikke en fejltilstand her — det er den normale
   tilstand halvdelen af tiden.
3. **Den spørger aldrig to gange.** Svaret lever i `localStorage` under par
   + dom og overlever genindlæsning.

Og en fjerde, som er den vigtigste: **spillet er komplet uden.** Er
`VITE_NARRATOR_URL` ikke sat, gør hele modulet ingenting. Det er en
forbedring, ikke en afhængighed. Enhver test, enhver måling og ethvert
lokalt spil skal kunne køre uden at kende til laget — derfor er `live` sat
udefra via `attachLive()` og ikke en konstruktørparameter på `Narrator`.

## Kæden, som den ser ud nu

| # | Kilde | Ved | Koster |
|---|-------|-----|--------|
| 1 | Historiske beats | Alt om øjeblikket | Skrevet i hånden |
| 2 | Bagt par-replik | Præcis de to ting | Skrevet i hånden, 404 par |
| 3 | **Live** | Præcis de to ting | Et modelkald, første gang |
| 4 | Grammatik | Dommen og taggene | Gratis, dækker alt |
| 5 | Generisk pulje | Ingenting | Gratis, nås aldrig (TEST-004) |

Live står **efter** det bagte, fordi en replik en skribent har siddet med
altid slår en, der blev skrevet på et sekund. Den står **før**
grammatikken, fordi den til gengæld ved præcis, hvad de to ting er, hvor
grammatikken kun kender dommen.

## 1. Requirements & Constraints

### Kilde og sandhed

- **REQ-001**: Laget skriver **kun** fiasko-replikker (`nofuse`). Succes,
  opdagelser, aldersskift og slutninger er historie og skal blive ved med at
  være skrevet i hånden. En model, der må skrive spillets vendepunkter, er en
  anden plan — og en, der skal træffes bevidst.
- **REQ-002**: Replikken får sit eget id (`live:` + par + dom) frem for at
  genbruge et bagt. Id'et er nøglen til varianthukommelsen, og to
  forskellige skrevne replikker må aldrig kunne opfattes som varianter af
  hinanden.
- **REQ-003**: Al spillervendt tekst er engelsk (CLAUDE.md). Prompten skal
  håndhæve det, og stemmedommeren (narrationsplanens TASK-027-030) skal
  kunne dømme resultatet, når den findes.

### Sikkerhed og penge

- **SEC-001**: Nøglen ligger hos workeren, aldrig i klienten. Sat som secret
  (`npx wrangler secret put OPENAI_API_KEY`), aldrig i `wrangler.toml`.
- **SEC-002**: Workeren svarer kun spillets egen adresse.
  `ALLOWED_ORIGINS` er sat til `https://youex.github.io`. Tom værdi betyder
  alle og må kun bruges lokalt.
- **SEC-003**: **Ikke løst.** Der findes ingen grænse for, hvor mange kald
  én klient må lave. Til sammenligning har
  `plan/feature-improvised-solutions-1.md` en udtrykkelig SEC-003 om loft
  pr. run og pr. IP. Den mangler her, og det er den største åbne risiko i
  laget: en åben proxy mod en betalt model er et regningsproblem, ikke et
  spilproblem. Se TASK-002 og TASK-003.
- **CON-001**: Modellen er `gpt-4o-mini`, valgt fordi replikken er kort og
  skal være billig nok til at være ligegyldig. Skifter den, skal
  stemmedommeren køre igen — en dyrere model er ikke automatisk en bedre
  fortæller.

### Form

- **CON-002**: `react()` forbliver synkron. Ethvert forslag, der gør den
  asynkron, er afvist på forhånd — det er den ene ændring, der ville lade
  netværket bestemme spillets rytme.
- **CON-003**: Klienten har 8 sekunders timeout og en afbryder, der slår
  laget fra efter tre fejl i træk. En død worker må koste ét forsøg, ikke
  ét pr. kombination resten af spillet.
- **CON-004**: Svaret caches i `localStorage` under par + dom. Cachen er
  spillerens, ikke serverens — to spillere, der prøver samme par, koster to
  kald. Se TASK-004.

## 2. Implementation Steps

### Fase 1 — Laget selv (leveret)

| Opgave | Beskrivelse | Færdig | Dato |
|--------|-------------|--------|------|
| TASK-001 | `src/narrator/live.ts` med `LiveNarrator`: `prefetch()`, `get()`, `enabled`, localStorage-cache, 8 s timeout, afbryder efter tre fejl. `worker/` med Cloudflare-worker der proxyer modellen, låser CORS til `ALLOWED_ORIGINS` og holder nøglen som secret. Koblet i `Narrator.react` via `liveLine()` og i `src/ui/main.ts` via `prefetchLine()` i `renderSlots()`. Testdækket i `tests/live.test.ts`. | ✅ | 2026-08-12 |

### Fase 2 — Det der mangler, før den må stå åben

| Opgave | Beskrivelse | Færdig | Dato |
|--------|-------------|--------|------|
| TASK-002 | Loft pr. klient i workeren: tæl kald pr. IP i et rullende vindue (Cloudflare KV eller Durable Object) og svar 429, når loftet er nået. Klienten skal behandle 429 som "intet svar" — altså tavshed og grammatik, ikke en fejl. Sæt loftet ud fra en måling af, hvor mange fiasko-kombinationer et rigtigt run indeholder (`tools/pair_frequency.ts` har tallene). | | |
| TASK-003 | Dagligt udgiftsloft i workeren: over grænsen svarer den 503 og laget slår sig selv fra resten af døgnet. Uden det er den værste dag ubegrænset. | | |
| TASK-004 | Delt cache i KV foran modellen, med parret + dommen som nøgle. I dag betaler vi for samme par én gang pr. spiller. Halen er lang, så gevinsten er reelt begrænset — mål før du bygger, og drop opgaven, hvis træfprocenten er under ~20 %. | | |
| TASK-005 | Deployment skrives ned i `README.md` eller `docs/`: `wrangler deploy`, `wrangler secret put OPENAI_API_KEY`, og hvordan `VITE_NARRATOR_URL` sættes ved build. I dag findes den viden kun i `worker/wrangler.toml`'s kommentarer og i denne plan. | | |
| TASK-006 | Beslut, om laget overhovedet skal udrulles. Det er **Martins beslutning**, ikke en implementeringsdetalje: laget koster penge pr. spiller, og spillet er målt komplet uden det. Alternativet — at bage videre mod N=600 og lade grammatikken tage resten — er gratis og allerede i gang. | | |

### Fase 3 — Kvalitet, når stemmedommeren findes

| Opgave | Beskrivelse | Færdig | Dato |
|--------|-------------|--------|------|
| TASK-007 | Kør de genererede replikker gennem stemmedommeren fra narrationsplanens TASK-027-030. Genereret tekst er præcis den slags indhold, den plans RISK-001 handler om: den driver mod det generiske, og driften er usynlig, fordi hver enkelt replik ser rimelig ud. | | |
| TASK-008 | Høst de bedste live-replikker tilbage til bagte par: log hvilke par der oftest kaldes, og lad `tools/prepare_pairs.ts` foreslå dem som næste batch. Så bliver laget en **kilde til hånd­skrevet indhold**, ikke en erstatning for det. | | |

## 3. Alternatives

- **ALT-001**: Bage videre i hånden mod alle 17.578 par. Afvist på
  aritmetik: 404 par kostede fire runder, og dækningen stiger stadig
  langsommere, fordi halen er flad. Men **fortsat bagning er ikke afvist** —
  de to lever fint side om side, og TASK-008 kobler dem sammen.
- **ALT-002**: Model i klienten (WebLLM/ONNX). Afvist: hundredvis af MB mod
  et budget på 60 KB pr. akt, og en kvalitet under grammatikkens.
- **ALT-003**: Nøglen i klienten med et lavt forbrugsloft. Afvist uden
  diskussion — en nøgle i en statisk side er en offentlig nøgle.
- **ALT-004**: Generere ved build-tid i stedet for ved spilletid, altså blot
  en femte bage-runde med en model i stedet for en skribent. Reelt
  attraktivt, og billigere: ingen worker, ingen nøgle, intet loft, og
  resultatet kan gennemgås af et menneske før det rammer en spiller. Det er
  det rigtige valg, **hvis** TASK-006 falder ud til nej.

## 4. Dependencies

- **DEP-001**: `plan/architecture-procedural-narration-1.md` — laget hænger
  på dens kæde, dens dom og dens grammatik, og eksisterer kun i kraft af
  dens ALT-004.
- **DEP-002**: En Cloudflare-konto med `wrangler`. Ikke installeret som
  projektafhængighed; workeren har sin egen `package.json`.
- **DEP-003**: Stemmedommeren (narrationsplanens fase 5) for fase 3 her.
  Fase 1 og 2 kan køre uden.
- **DEP-004**: `plan/feature-improvised-solutions-1.md` bygger sin **egen**
  worker, der klassificerer nye elementer. Det er en søsterworker, ikke den
  samme: denne skriver tekst om eksisterende fiaskoer, dens skaber nye
  elementer med et `{name, flavor, kind, stuff, traits, scale}`-skema.
  Deler de kode, bliver det ved deployment-opsætningen, ikke ved logikken.

## 5. Files

- **FILE-001**: `src/narrator/live.ts` — leveret. Klienten.
- **FILE-002**: `worker/src/index.ts`, `worker/wrangler.toml`,
  `worker/package.json` — leveret. Proxyen.
- **FILE-003**: `src/narrator/narrator.ts` — ændret: `attachLive()`,
  `liveLine()`, kæden udvidet fra fem til seks trin.
- **FILE-004**: `src/ui/main.ts` — ændret: `prefetchLine()` kaldt fra
  `renderSlots()`, når begge felter er fyldt.
- **FILE-005**: `tests/live.test.ts` — leveret.

## 6. Testing

- **TEST-001**: Uden `VITE_NARRATOR_URL` er laget slået fra, og fortælleren
  opfører sig præcis som før. Dette er den vigtigste test i filen: den
  beviser, at spillet ikke er blevet afhængigt.
- **TEST-002**: Et svar der ikke er landet, giver grammatik — ikke tavshed,
  ikke en tom boble, ikke et kast.
- **TEST-003**: Samme par spørges aldrig to gange; andet opslag rammer
  cachen.
- **TEST-004**: Afbryderen slår laget fra efter tre fejl i træk.
- **TEST-005**: **Mangler.** Ingen test af, at 429 fra loftet (TASK-002)
  behandles som "intet svar". Skrives sammen med TASK-002.

## 7. Risks & Assumptions

- **RISK-001**: **Regningen.** En åben proxy mod en betalt model kan koste
  vilkårligt meget, hvis nogen finder endpointet. `ALLOWED_ORIGINS` er en
  CORS-lås, og CORS er en browserregel — den stopper ikke `curl`. TASK-002
  og TASK-003 er modtrækket, og laget bør ikke stå åbent uden dem.
- **RISK-002**: **Stemmedrift.** Genereret tekst driver mod det generiske,
  og driften er usynlig replik for replik. Modtræk: TASK-007.
- **RISK-003**: **Doven bagning.** Findes laget, forsvinder trangen til at
  skrive de næste 200 par i hånden — og de bagte er stadig de bedste.
  Modtræk: TASK-008 vender laget til en kilde for bagningen, og
  `docs/design/narration-coverage.md` bliver ved med at måle den bagte
  andel, ikke den "dækkede" andel.
- **ASSUMPTION-001**: At spilleren fylder begge felter mærkbart før han
  trykker. Holder den ikke — fordi han dobbeltklikker — kommer svaret for
  sent, og grammatikken taler. Det er ikke en fejl, blot en lavere
  træfprocent, end forhåndshentningen lover.

## 8. Related Specifications / Further Reading

- `plan/architecture-procedural-narration-1.md` — kæden, dommen,
  grammatikken, ALT-004 og stemmedommeren.
- `plan/feature-improvised-solutions-1.md` — søsterworkeren og dens
  SEC-003, som denne plans TASK-002 bør kopiere frem for at genopfinde.
- `docs/design/narration-coverage.md` — ledestjernetallet, der afgør, hvor
  meget laget overhovedet skal dække.
- `CLAUDE.md` — engelsk spillertekst, dansk kode.
