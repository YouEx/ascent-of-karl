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
- **SEC-003**: **Løst (fase 2, 2026-08-12).** Et enkelt globalt, navngivet
  Durable Object (`worker/src/coordinator-do.ts`) er nu den ene atomare
  koordinator for begge grænser: et rullende vindue pr. IP-hash (TASK-002)
  og et dagligt UTC-loft over kald, der når opstrøms (TASK-003). IP'en
  hashes (SHA-256) før den nogensinde rører lager — den rå IP gemmes
  aldrig. Se afsnittet "Fase 2 — målte tal" nedenfor for de præcise,
  målte tærskler og udregningen bag dem.
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
- **CON-004**: Svaret caches i `localStorage` under par + dom
  (spillerens egen cache) OG, siden fase 2, i den delte Durable
  Object-cache (TASK-004): to spillere, der prøver samme par, koster nu
  ét kald, ikke to — men klientens `localStorage`-cache er stadig værd at
  have, for den sparer selv den korte tur til workeren.

## 2. Implementation Steps

### Fase 1 — Laget selv (leveret)

| Opgave | Beskrivelse | Færdig | Dato |
|--------|-------------|--------|------|
| TASK-001 | `src/narrator/live.ts` med `LiveNarrator`: `prefetch()`, `get()`, `enabled`, localStorage-cache, 8 s timeout, afbryder efter tre fejl. `worker/` med Cloudflare-worker der proxyer modellen, låser CORS til `ALLOWED_ORIGINS` og holder nøglen som secret. Koblet i `Narrator.react` via `liveLine()` og i `src/ui/main.ts` via `prefetchLine()` i `renderSlots()`. Testdækket i `tests/live.test.ts`. | ✅ | 2026-08-12 |

### Fase 2 — Det der mangler, før den må stå åben

| Opgave | Beskrivelse | Færdig | Dato |
|--------|-------------|--------|------|
| TASK-002 | Loft pr. klient i workeren: ét globalt Durable Object (`worker/src/coordinator-do.ts`) tæller kald pr. IP-hash i et rullende vindue (`worker/src/limiter.ts`) og svarer 429 med en sand `Retry-After`, når loftet er nået. Klienten (`src/narrator/live.ts`) behandler 429 som "intet svar": ingen tælling til den almindelige afbryder, og intet nyt forsøg før `Retry-After` er gået. Loftet — 20 kald/60 sek. — er udledt af det MÅLTE, hårde `turnLimit`-loft pr. run (50, bekræftet af simuleringen) og en fysisk-tids-udregning, ikke et gæt. Se "Fase 2 — målte tal" nedenfor. | ✅ | 2026-08-12 |
| TASK-003 | Dagligt UTC-udgiftsloft i samme Durable Object (`worker/src/budget.ts`): kun kald, der reserverer budget og når opstrøms (cache-misses), tæller — et cache-hit koster intet af loftet. Over grænsen svarer workeren 503 med `Retry-After` frem til næste UTC-midnat, og klienten slår laget fra indtil da uden at røre den almindelige afbryder. Loftet — 350/døgn — er udledt af den målte 95.-percentil af distinkte par+dom-nøgler pr. run, ganget med en udtrykkeligt antaget (ikke målt) travl-dag-trafik. Se "Fase 2 — målte tal". | ✅ | 2026-08-12 |
| TASK-004 | Delt cache i Durable Object'ets egen storage (ikke KV — ét stateful binding er simplere end to), nøglet på sorteret par + dom (`worker/src/cache-key.ts`). Målt FØR bygget: træfprocenten er beregnet til 96,9 % over 1.200 simulerede runs (langt over 20 %-grænsen), så cachen er bygget. Kun vellykket, renset modeltekst caches; fejl caches aldrig; samtidige misses på samme nøgle deles (`worker/src/concurrency.ts`), så en byge kun koster ét kald. Se "Fase 2 — målte tal" for hele udregningen. | ✅ | 2026-08-12 |
| TASK-005 | Deployment dokumenteret i `docs/deployment/live-narrator.md` (Durable Object-migration/binding, `OPENAI_API_KEY` som secret, sikre `[vars]`, `wrangler deploy`, `VITE_NARRATOR_URL` ved build, sådan verificeres helbred/429/503, og den hurtige nødstop) med en kort henvisning fra `README.md`. Ingen hemmelige værdier eller priser i dokumentet. | ✅ | 2026-08-12 |
| TASK-006 | Beslut, om laget overhovedet skal udrulles. Det er **Martins beslutning**, ikke en implementeringsdetalje: laget koster penge pr. spiller, og spillet er målt komplet uden det. Alternativet — at bage videre mod N=600 og lade grammatikken tage resten — er gratis og allerede i gang. **Stadig åben** — fase 2 gør laget klar til at blive slået til, den beslutter ikke, at det skal. | | |

#### Fase 2 — målte tal

Alle tre tærskler er udledt af data, ikke gættet. Sådan:

- **Cache-træfprocent (TASK-004), 96,9 %.** `docs/design/pair-frequency.json`
  (produceret af `tools/pair_frequency.ts` over 1.200 simulerede runs, tre
  spillestile) lister par-møder for hvert distinkt par+dom (`nofuse`-udfald,
  dvs. par der IKKE matcher en opskrift). Vigtigt: `prefetchLine()`
  (`src/ui/main.ts`) spørger workeren for **alle** disse par — også dem der
  har en bagt replik og derfor aldrig bruger svaret — for den tjekker kun
  `engine.matchCombo()`, ikke om linjen allerede er bagt. Cache-regnestykket
  bruger derfor ALLE nofuse-møder, ikke kun de ubagte: 40.802 møder i alt,
  fordelt på 1.245 distinkte par+dom-nøgler. Træfprocent for en delt
  server-cache (hvor "træf" betyder: en tidligere spillers kald har allerede
  fyldt netop denne nøgle, og denne forespørgsel får svaret gratis) er
  derfor `(40802 − 1245) / 40802 ≈ 0,969`. Da 96,9 % ≥ 20 %-grænsen, er
  cachen bygget (modsat en afvisning, hvis den havde ligget under). Et
  snævrere regnestykke, der kun tæller par UDEN en bagt linje (11.244 møder,
  942 distinkte nøgler), giver 91,6 % — stadig langt over grænsen, og nævnt
  her for at vise, at konklusionen ikke afhænger af, hvilket af de to man
  bruger.
- **Rullende rate-limit-vindue (TASK-002), 20 kald / 60 sek.** Simuleringen
  måler PAR PR. RUN, ikke forløbet tid mellem klik, og kan derfor ikke
  alene sætte et 60-sekunders vindue. Udregningen kombinerer to målte/kendte
  fakta med én eksplicit tidsantagelse: (1) det hårde loft pr. run er 50
  (`content/config.json`'s `turnLimit`, bekræftet af simuleringen: p95=50,
  max=50 over alle 1.200 runs), (2) hvert par kræver mindst to fysiske
  handlinger, et forsøg en tredje, og selv en meget hurtig spiller kan
  næppe gøre dette hurtigere end ca. hvert 1.-2. sekund i træk — så et helt
  50-parrers run kan fysisk ikke gennemføres på under ca. 50-100 sekunder.
  20/60 sek. ligger dermed komfortabelt under halvdelen af et helt runs
  loft inden for ethvert givent minut. Se kommentaren i
  `worker/wrangler.toml` for den fulde udregning.
- **Dagligt opstrømsloft (TASK-003), 350 kald/UTC-døgn.** Distinkte
  par+dom-nøgler pr. run (samme ALLE-nofuse-grundlag som cache-tallet
  ovenfor, altså inklusive bagte par, fordi de også udløser et rigtigt
  worker-kald) har gennemsnit ~25,4 og 95.-percentil ~33 over de 1.200
  runs. Ganget med en udtrykkeligt ANTAGET (ikke målt — der findes ingen
  rigtig trafik endnu) travleste-dag-belastning på ~10 fulde
  gennemspilninger: 10 × 33 ≈ 330, uden fradrag for genbrug på tværs af de
  10 runs samme dag (et bevidst for-højt, konservativt skøn, fordi cachen i
  virkeligheden ville dække en del af overlappet allerede samme dag). 350
  runder det op med en smule margin.
- **Metode og forbehold.** Tallene kommer fra en deterministisk simulering
  af motoren (`src/core/engine.ts` + `src/narrator/narrator.ts`), ikke fra
  rigtig produktionstrafik — der findes ingen endnu, laget er ikke
  udrullet. Cache-træfprocenten er direkte udledt af de 1.200 simulerede
  runs' par-frekvens uden yderligere antagelser. Rate-limit-vinduet og det
  daglige loft kombinerer denne samme, direkte målte par-frekvens med
  hver sin eksplicit angivne antagelse (hhv. fysisk klikke-hastighed og
  antal runs på den travleste dag), fordi ingen ren måling alene kan sætte
  et tal på "pr. minut" eller "pr. døgn", når al data er PR. RUN. Begge
  antagelser er skrevet ud, så de kan efterprøves og justeres, når rigtig
  trafik findes — loftet er sat som en Wrangler-var netop for at gøre det
  let.

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

- **FILE-001**: `src/narrator/live.ts` — leveret. Klienten. Fase 2 tilføjede
  429/503-håndtering (`quietUntil`) og `id` i `describe()`-payloaden, så
  workeren kan bygge cache-nøglen.
- **FILE-002**: `worker/src/index.ts` (tynd oprindelses-gate + DO-routing),
  `worker/wrangler.toml` (Durable Object-binding/migration + `[vars]`),
  `worker/package.json` — leveret/opdateret. Proxyen.
- **FILE-003**: `src/narrator/narrator.ts` — ændret: `attachLive()`,
  `liveLine()`, kæden udvidet fra fem til seks trin.
- **FILE-004**: `src/ui/main.ts` — ændret: `prefetchLine()` kaldt fra
  `renderSlots()`, når begge felter er fyldt.
- **FILE-005**: `tests/live.test.ts` — leveret/udvidet med 429/503-tests.
- **FILE-006** (fase 2): `worker/src/{limiter,budget,cache-key,origin,
  validate,clean,concurrency,ip,store,model,coordinator,coordinator-do,
  cf-types,env}.ts` — de rene beslutningsmoduler plus den tynde
  Cloudflare-tilpasning. `cf-types.ts` er håndskrevne, minimale typer i
  stedet for en ny `@cloudflare/workers-types`-afhængighed. `env.ts` er
  fortolkningen af Wrangler-vars (streng → tal med fallback), trukket ud
  for sig selv, fordi en fejl her ellers ville være usynlig: et første
  udkast brugte samme "positivt heltal"-regel til det daglige loft som
  til rate-limit-vinduet, hvilket ville have gjort TASK-005's nødstop
  ("sæt dagligt loft til 0") virkningsløst — `"0"` ville stille og
  roligt være faldet tilbage til defaulten. Fanget og rettet, se TEST-007.
- **FILE-007** (fase 2): `tests/worker-security.test.ts` (23 tests: rate
  limit, budget, cache-nøgle, oprindelse, validering, env-fortolkning) og
  `tests/worker-coordinator.test.ts` (7 tests: cache/budget/stampede/
  rækkefølge) — kører i root-Vitest uden en Cloudflare-testpool, jf.
  kravet om at holde adapteren tynd og de rene moduler importerbare.
- **FILE-008** (fase 2): `docs/deployment/live-narrator.md` — TASK-005,
  udrulningsopskriften, med en kort henvisning fra `README.md`.

## 6. Testing

- **TEST-001**: Uden `VITE_NARRATOR_URL` er laget slået fra, og fortælleren
  opfører sig præcis som før. Dette er den vigtigste test i filen: den
  beviser, at spillet ikke er blevet afhængigt.
- **TEST-002**: Et svar der ikke er landet, giver grammatik — ikke tavshed,
  ikke en tom boble, ikke et kast.
- **TEST-003**: Samme par spørges aldrig to gange; andet opslag rammer
  cachen.
- **TEST-004**: Afbryderen slår laget fra efter tre fejl i træk.
- **TEST-005**: **Leveret (fase 2).** 429 fra loftet (TASK-002) behandles
  som "intet svar": ingen tælling til den almindelige afbryder, intet nyt
  forsøg før `Retry-After` er gået (`tests/live.test.ts`).
- **TEST-006** (fase 2): 503 fra det daglige loft (TASK-003) er samme
  slags tavshed frem til den UTC-nulstilling, workeren opgav — og laget
  taler helt normalt igen, så snart den er passeret, hvilket beviser at
  503 aldrig rørte den permanente afbryder (`tests/live.test.ts`).
- **TEST-007** (fase 2): De rene worker-moduler — rullende vindue
  (tillader op til loftet, afviser det næste, tillader igen når det
  ældste tidsstempel er udløbet), daglig budget-reservation under
  simuleret samtidighed, cache-nøglens rækkefølge-uafhængighed og
  dom-følsomhed, oprindelsespolitik, og validering af misdannet/for stort
  input — testet direkte, uden en Cloudflare-runtime
  (`tests/worker-security.test.ts`).
- **TEST-008** (fase 2): Koordinatorens sammenspil — cache-hit reserverer
  ikke budget, fejl caches aldrig, samtidige misses på samme nøgle deles
  til ét kald, rate-limit håndhæves før validering og cache, og
  misdannet/for stort input afvises før budgettet røres
  (`tests/worker-coordinator.test.ts`).
- **TEST-009** (fase 2): `env.ts`'s fortolkning af Wrangler-vars — herunder
  det eksplicitte tilfælde `toNonNegativeInt("0", …) === 0`, altså
  TASK-005's nødstop. Skrevet efter en reel selv-fundet fejl: en tidlig
  udgave brugte `n > 0` også til det daglige loft, hvilket ville have gjort
  `DAILY_MAX_UPSTREAM_CALLS="0"` virkningsløst (faldt tilbage til
  defaulten). Testen blev bekræftet RØD med den gamle regel genindsat,
  derefter GRØN igen efter rettelsen — se commit-historikken
  (`tests/worker-security.test.ts`).

## 7. Risks & Assumptions

- **RISK-001**: **Regningen.** **Delvist afværget (fase 2, 2026-08-12.)**
  En åben proxy mod en betalt model kan koste vilkårligt meget, hvis nogen
  finder endpointet. `ALLOWED_ORIGINS` er nu håndhævet som en RIGTIG 403
  (`worker/src/index.ts`), ikke kun en CORS-header — CORS er en
  browserregel og stopper aldrig `curl` alene. TASK-002 (rate limit pr.
  IP-hash) og TASK-003 (dagligt UTC-loft over opstrømskald) er begge
  leveret og er det egentlige modtræk, fordi Origin kan forfalskes; loftet
  kan ikke. **Observation, ikke rettet her:** `prefetchLine()`
  (`src/ui/main.ts`, fase 1) spørger workeren for ethvert ikke-opskrift-par
  — også par der allerede har en bagt replik og derfor aldrig bruger
  svaret, fordi den kun tjekker `matchCombo`, ikke bagt-status. Det er
  regnet med i TASK-003/004's målte tal ovenfor (som dermed er retvisende
  for den rigtige belastning), men betyder at en del af det daglige budget
  reelt går til kald, hvis svar aldrig når spilleren. En fremtidig
  optimering kunne lade `prefetchLine()` også tjekke bagt-status før den
  spørger — det ligger uden for denne fases opgaver (TASK-002-005) og er
  ikke rørt.
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
