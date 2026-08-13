---
goal: Åbne løsningsrummet for problemer og challenges, så enhver kombination der kan klassificeres som en løsning tæller — og lade spilleren opfinde sine egne elementer, uden at spillets kuraterede rygrad falder fra hinanden
version: 1.0
date_created: 2026-08-12
last_updated: 2026-08-13
owner: Martin (YouEx)
status: 'In progress'
tags: [feature, architecture, engine, narrator, content, infrastructure]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

> **Fase 1 er leveret** (2026-08-12). Alle otte opgaver er i drift. Løsning for
> både problemer og challenges afgøres nu af `SolvePredicate`
> (`src/core/types.ts`, med et ekstra `minDepth`-felt ud over specifikationen)
> via `satisfies`/`solvesNeed` (`src/core/solves.ts`) i både `Engine.resolve`
> og `challenge.resolves` — ikke af allowlister. `content/predicates.json`
> dækker alle tre problemer, alle tre challenges og desuden de tre
> akt-1-problemer denne plan aldrig nævnte (kedsomhed, ensomhed, mening).
> Facittjekket (TASK-005) er leveret som `tools/predicate_report.py` i Python,
> ikke som den planlagte `.mjs` — funktionelt ækvivalent, og krydstjekket mod
> TypeScript-tvillingen af `tools/parity_fixture.py` + `tests/solves.test.ts`.
> `npm run predicates` viser **0 falske negativer**. Allowlisten
> (`challenge.solvedBy` → `alsoSolvedBy`, TASK-006) er nu en eksplicit
> override for undtagelser, prædikatet ikke kan udtrykke —
> `challenge.resolves()` slår op i prædikatet ELLER `alsoSolvedBy`, symmetrisk
> med hvordan `combo.solves` allerede virkede. Alle 29 tidligere poster viste
> sig at være dækket af prædikatet allerede (0 reelle undtagelser i dag), så
> de tre lister er prunet til tomme; `tools/validate.py` advarer, hvis en
> fremtidig post dér også fanges af prædikatet, og kræver mindst 5 reelle
> løsninger pr. challenge (prædikat ELLER `alsoSolvedBy`) i stedet for en
> minimumslængde på selve listen. Det historiske facit — alt der nogensinde
> er bekræftet som en løsning — bor nu i
> `docs/design/taxonomy-ground-truth.json`, ikke i `alsoSolvedBy`.
> `combo.solves` (TASK-008) er wired som eksplicit override i
> `Engine.resolve`, bevist af en regressionstest der fejler, hvis overriden
> fjernes.
>
> **Fase 2's offline core er leveret** (2026-08-13).
> TASK-009–014 er implementeret test-first i `src/core/improvise.ts`,
> `Engine.improvise()` og det serialiserede `GameState`. TASK-022 og TASK-024
> er nu også ført helt gennem fortællerforbrugeren: udfaldene får deres egen
> prioriterede dom, og det rekursive prædikatbevis oversættes til spillertekst
> uden rå tags/id'er. UI-halvdelene er fortsat åbne, og produktflaget er
> fortsat slukket.
>
> **Arkitekturrecovery, der erstatter den stale modeldeling nedenfor:**
> deterministiske regler ejer altid `kind`, `stuff`, `traits`, `scale`,
> `parents`, `depth`, id og `solves`-afgørelsen. En fremtidig model må kun
> forbedre `name` og `flavor`. Motoren opretter og anvender elementet atomisk,
> synkront og uden netværk; der findes ikke længere et legitimt flow, hvor en
> model klassificerer et element og fodrer gameplay-tags ind i motoren.
>
> **Fase 3's server-copyhalvdel og klient er leveret som kilde, men slukket.**
> `TASK-016`-`TASK-018` og `TASK-021` er leveret under den frosne
> integrationskontrakt nedenfor; serverhalvdelen af `TASK-019` og `TASK-029`
> er leveret. `TASK-015`, `TASK-020` og `TASK-025` er nu også leveret:
> `Engine.attempt()` vælger canon før improvisation i én transition,
> `src/ui/improvise-client.ts` prefetcher copy uden await, og bogen holder
> Karls opfindelser ude af den historiske tidslinje. Hele spillerfladen er
> fortsat gated af `VITE_IMPROVISE_ENABLED === "true"`; deploy-workflowet
> sætter hverken det flag eller `VITE_IMPROVISE_URL`, så der er ingen trafik.
> Fortællerens dom er leveret og stemme-gated. `TASK-019`'s klient-cap og
> `TASK-027`/`TASK-028`'s balancering er nu leveret: 2.000 parrede runs i tre
> seed-planer valgte én sommer og højst seks unikke opfindelser pr. run
> (`docs/design/improvisation-balance.md`). Secrets, deploy, rigtig trafik og
> den menneskelige TASK-030-playtest er fortsat åbne.

Spillets sjoveste indhold findes allerede: **mudderkage** (mudder + bær) mætter Karl, og **klyngen** (nabo + skind) holder ham varm. Begge er mærket `spor: "komisk"`. Ideen om at løse en alvorlig nød på en latterlig måde er ikke ny — den er spillets bedste greb. Den er bare begrænset til de absurditeter, forfatteren nåede at forestille sig på forhånd.

Denne plan generaliserer grebet. Målet er formuleret af Martin: *"anything that can be classified as food"* skal kunne mætte Karl. Det er ikke Infinite Craft, og forskellen er hele pointen. Infinite Craft har intet mål, så dens absurditet er formålsløs; her er der en nød at være absurd *imod*. Vittigheden virker, fordi den skulle opfylde noget.

Ombygningen har to halvdele, og **den første kræver ingen sprogmodel**:

1. **Prædikater i stedet for lister.** I dag er `challenge.solvedBy` en håndholdt allowlist — ulvene besejres af `[ild, spyd, hund, bue, slynge, stenoekse, faelde, hytte, harpun, koelle]`. Det er begrebet *"et våben eller et ly"*, møjsommeligt opremset, og hvert nyt element kræver at nogen husker at føje det til hver relevant liste. Samme sygdom som fiaskoteksten, andet organ. Erstattes af et prædikat over taksonomien fra `plan/architecture-procedural-narration-1.md`.
2. **Improviserede elementer.** Et par uden opskrift kan blive til spillerens
   egen opfindelse. Den deterministiske klientkerne leverer klassifikationen;
   den valgfrie Worker forbedrer kun navn og flavor. Prædikatet afgør derefter,
   om den deterministiske klassifikation løser noget.

Magtdelingen er planens kerne og dens vigtigste enkeltbeslutning:

> **Regelmotoren dømmer hvad tingen ER. Prædikaterne dømmer om dét løser problemet.**

Den deterministiske regelmotor klassificerer (`{kind, stuff, traits, scale}`)
og bygger fallback-copy, mens Workeren kun må forbedre navn og flavor. Modellen
får hverken tags eller `solves` i sit outputskema. Uden den deling kan modellen
tales til at godkende hvad som helst, sværhedsgraden flytter ud af Martins
hænder, og spillet kan ikke balanceres. Med den deling er både semantik og
spilregler testbare; modellen er kosmetisk.

En sidste måling styrer sværhedsgraden: **bær og larver er base-elementer, spiselige, og løser ikke sult.** Alle elleve sultløsninger er *fremstillede*. Reglen er altså ikke "spiseligt", men "spiseligt som Karl selv har lavet". Den stod allerede skrevet i indholdet; her får den bare et navn.

## 1. Requirements & Constraints

- **REQ-001**: Et problem eller challenge skal kunne erklære sin løsning som et **prædikat over taksonomien**, ikke som en liste af element-id'er.
- **REQ-002**: Ethvert element, der opfylder prædikatet, løser nøden — uanset om det er kurateret eller opfundet af spilleren i dette run.
- **REQ-003**: Et nyt kurateret element skal automatisk tælle for de challenges, det logisk løser, uden at nogen redigerer en liste.
- **REQ-004**: Sværhedsgraden skal bevares. Prædikatet skal pr. konstruktion udelukke starthånden: alle nuværende løsninger er fremstillede, og det skal `crafted: true` håndhæve.
- **REQ-005**: Spilleren skal kunne improvisere et nyt element ud af et par uden opskrift. Regler klassificerer det deterministisk; fallback navngiver og beskriver det på engelsk, og Workeren kan valgfrit forbedre navn/flavor.
- **REQ-006**: Improviserede elementer må **aldrig** kunne udløse akter, sætte flag, låse skæbner op ved ren mængde eller fortrænge kurateret indhold i krøniken.
- **REQ-007**: Spillet skal virke fuldt ud offline og uden proxy. Improvisation degraderer da til deterministiske regler; prædikaterne virker uændret.
- **REQ-008**: Fortællerens afvisning skal være lige så sjov som hans godkendelse. At dømme *imod* spilleren er indhold, ikke en fejlmeddelelse.
- **REQ-009**: Samme par skal give samme improviserede element for alle spillere, når proxyen er tilgængelig (via cache), så spillet kan tales om og deles.
- **SEC-001**: Ingen API-nøgle i klientbundtet. Klassifikation sker bag en proxy, som ejer nøglen.
- **SEC-002**: Improviserede navne indgår i senere prompts og er dermed en langsom prompt-injektionskanal. Navne begrænses hårdt (≤ 3 ord, intet tegnsætningsvildnis, ingen URL'er, ingen citationstegn), og en fremtidig model må kun svare med struktureret `{name, flavor}`. Alt andet kasseres.
- **SEC-003**: Rate limit pr. klient i proxyen, og et hårdt loft over improvisationer pr. run. Et spil på en statisk side må ikke kunne bruges som gratis LLM-endpoint.
- **CON-001**: `Engine.combine`, `Engine.improvise` og deres state-transitioner forbliver **synkrone, rene og deterministiske** (CON-002 i narrationsplanen). En fremtidig async copy-forbedring må ligge udenfor motoren og må kun erstatte navn/flavor. Ingen netværkskald eller gameplay-tags kommer ind i motoren.
- **CON-002**: `turnLimit` er 50. Den robuste måling 2026-08-13 fastholder én sommer pr. ikke-canonical forsøg og tilføjer et eksplicit loft på seks unikke improviserede elementer pr. run. Genbrug er tilladt; et syvende nyt element afvises og koster stadig forsøgets ene sommer.
- **CON-003**: Improvisation forudsætter taksonomien fra narrationsplanens fase 1 (TASK-002 til TASK-005 dér). Denne plan kan ikke starte før.
- **CON-004**: Krøniken og delekortet skal kunne vise et improviseret element uden at love, at det er historisk. De kuraterede elementers `note` og `sourceUrl` er spillets troværdighed og må ikke blandes sammen med spillerens påfund.
- **GUD-001**: Vittigheden skal koste noget. En absurd løsning skal være sværere eller dyrere end den oplagte — ellers er absurditet ikke et valg, men den optimale strategi.
- **GUD-002**: Kuratering slår generering. Findes der en håndskrevet opskrift, bruges den. Improvisation er kun for det tomme rum.
- **GUD-003**: Dansk i kode, kommentarer og commits. Al spillervendt tekst på engelsk.
- **PAT-001**: Magtdeling: regler klassificerer, motoren afgør, og modellen skriver kun copy. Ingen tags, mekanik eller `solves` fra en sprogmodel, nogensinde.
- **PAT-002**: Verdikt-motoren fra narrationsplanen er **portvagt** for improvisation. Kun par, der dømmes `plausible` eller `absurd`, kan improviseres. Det er værnet mod Infinite Craft-slop: ikke alt bliver til noget.
- **PAT-003**: To elementklasser med forskellige rettigheder — `canon` og `improvised` — frem for ét fladt rum.
- **PAT-004**: Cachen er indhold. Et improviseret element, der er set af mange, er en kandidat til kuratering.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Erstat allowlisterne med prædikater. Denne fase kræver ingen sprogmodel, ingen proxy og intet nyt indhold — og den leverer alene størstedelen af "enhver løsning tæller".

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Definér `SolvePredicate` i `src/core/types.ts`: `{ kind?: ElementKind[]; stuff?: Stuff[]; traits?: Trait[]; anyOf?: SolvePredicate[]; allOf?: SolvePredicate[]; not?: SolvePredicate; crafted?: boolean; minScale?: Scale }`. Rent data, ingen kode i indholdet. **Leveret med et ekstra felt `minDepth?: number` ud over specifikationen** — `crafted` alene holder kun nøden væk fra tur 0, ikke fra tur 1; bærsaft og østers bærer samme tags, kun opskrift-dybden skiller dem. | ✅ | 2026-08-12 |
| TASK-002 | Skriv `src/core/solves.ts` med `satisfies(el: ElementDef, p: SolvePredicate, ctx): boolean`. Ren funktion. `crafted: true` betyder `!el.base` — det er præcis den grænse, indholdet allerede trækker. | ✅ | 2026-08-12 |
| TASK-003 | Udled prædikaterne for de tre problemer **af de eksisterende løsninger**, ikke af fantasi. `sult`: `{ traits: ["edible"], crafted: true }` — skal acceptere alle elleve nuværende løsninger inkl. mudderkage og afvise bær og larver. `kulde`: `{ anyOf: [{traits:["hot"]}, {traits:["insulating"]}, {kind:["structure"]}], crafted: true }`. `vaerktoej`: `{ kind: ["tool"], crafted: true }`. **`content/predicates.json` dækker desuden de tre resterende akt-1-problemer, som denne opgave ikke nævnte** (kedsomhed, ensomhed, mening). | ✅ | 2026-08-12 |
| TASK-004 | Udled prædikaterne for de tre challenges. `ulve`: `{ anyOf: [{kind:["tool"], traits:["sharp"]}, {traits:["hot"]}, {kind:["structure"]}, {kind:["creature"], traits:["tame"]}], crafted: true }` — skal acceptere alle ti i den nuværende `solvedBy`. `toerke` og det tredje challenge på samme måde. | ✅ | 2026-08-12 |
| TASK-005 | Byg `tools/predicate_report.mjs`: for hvert problem og challenge, list hvilke af de 187 elementer prædikatet accepterer, og diff mod den nuværende allowlist. **Falske negativer (et element på listen som prædikatet afviser) er en fejl. Falske positiver skal læses én for én** — de fleste er gevinsten (elementer der *burde* have været på listen), men nogle er huller i taksonomien. **Leveret som `tools/predicate_report.py` (Python), ikke som den specificerede `.mjs`** — funktionelt ækvivalent; `npm run predicates` kører den, og `tools/parity_fixture.py` + `tests/solves.test.ts` holder den i sync med TypeScript-tvillingen i `src/core/solves.ts`. | ✅ | 2026-08-12 |
| TASK-006 | Behold `solvedBy`-listen som `alsoSolvedBy` for undtagelser, prædikatet ikke kan udtrykke. Validatoren advarer, hvis en post dér også fanges af prædikatet — så listen ikke stille bliver ved med at vokse. | ✅ | 2026-08-12 |
| TASK-007 | Skift `Engine` til at afgøre løsning gennem `satisfies` for både `problem` og `challenge`. Ved opdagelse tjekkes det nye element mod alle uløste nøder — ikke kun mod `combo.solves`. | ✅ | 2026-08-12 |
| TASK-008 | Fjern `combo.solves` som eneste kilde. Feltet bevares som eksplicit *override*, når en bestemt opskrift skal løse en bestemt nød uanset tags (fx en akt-kritisk beat). | ✅ | 2026-08-12 |

### Implementation Phase 2

- GOAL-002: Giv motoren en anden elementklasse, så spilleren kan opfinde ting uden at spillets rygrad kan brydes. Stadig ingen sprogmodel — improvisationen kører her på deterministiske regler.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Udvid `ElementDef` med bagudkompatibelt `origin` (fravær = `canon`), `parents` kun for improviserede elementer og gemt `depth`. Improviserede elementer lever i `GameState.improvisedElements`; gamle saves normaliseres til tomt registry. | ✅ | 2026-08-13 |
| TASK-010 | Håndhæv rettighederne i `Engine`: improviserede elementer kan ikke bære `ageUp`, `setsFlags` eller `ending`. `inventions()` bevarer canon-semantikken og tæller kun improviserede ids i `creditedImprovised`, når de faktisk har løst et problem eller challenge — også hvis krediteringen sker på en senere tur. | ✅ | 2026-08-13 |
| TASK-011 | Byg `src/core/improvise.ts` med den deterministiske regelmotor `deriveTags(a,b)`. Reglerne bruger kun den eksisterende taksonomi: ild → `hot`/`dry`, vand → `wet`, ler → `wet`/`fragile`, skarpt værktøj + creature → `food`/`flesh`/`dead`/`edible`, tool + material arver materialets `stuff`, ellers faste kind/stuff-prioriteter. Det stale planlagte trait `cooked` blev ikke indført. | ✅ | 2026-08-13 |
| TASK-012 | Deterministisk engelsk fallback-copy pr. regel plus stabilt, kollisionsfrit og rækkefølgeuafhængigt id af det ordnede forældrepar. | ✅ | 2026-08-13 |
| TASK-013 | Improvisationsdybde er præcist `max(parent.depth)+1`. Dybde 3 eksisterer og markeres terminal; et forsøg på dybde 4 afvises efter præcis én tur. | ✅ | 2026-08-13 |
| TASK-014 | `Engine.improvise()` bruger verdikt-motoren som portvagt: kun `plausible` og `absurd` fortsætter. Canon-opskrifter, `near-miss`, `locked`, `inert`, `self` og `clash` afvises. Improviserede forældre er ikke længere `inert` alene, fordi de mangler i den kanoniske opskriftsindex. | ✅ | 2026-08-13 |
| TASK-015 | **Leveret bag produktflaget:** grid, fundkort og en separat sektion i bogen bruger markøren “Karl's invention” og stiplet blæk. Improviserede poster renderer aldrig `note`/`sourceUrl` og indsættes ikke i den canonical tidslinje. | ✅ | 2026-08-13 |

### Implementation Phase 3

- GOAL-003: Sæt et valgfrit copy-lag på. Den eksisterende Worker skriver kun navn og flavor — som en forbedring oven på en deterministisk klassifikation, der virker uden.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | **Leveret under frosset kontrakt:** genbrug den EKSISTERENDE Worker og `Coordinator`; `POST /improvise` accepterer eksakt `{a,b,act}` med kanoniske id'er og returnerer offentligt kun `{name,flavor}`. Ingen `proxy/`, ingen KV, ingen mekaniske felter fra modellen. | ✅ | 2026-08-13 |
| TASK-017 | **Leveret:** sorteret par+akt-cache i det eksisterende Durable Object storage, med automatisk navnerum fra den faktisk renderede promptkontrakt+model. Cache-hit undgår både modelkald og improvisationsbudget; samtidige misses coalesces kun inden for samme par+akt. | ✅ | 2026-08-13 |
| TASK-018 | **Leveret under frosset kontrakt:** strikt modelskema `{name,flavor}` og servervalidering af eksakte felter, ≤3 ord, URL'er, citationstegn, kontroltegn, tegnsætningsvildnis og flavor-grænse. Ugyldigt svar giver eksplicit 502, caches aldrig og retries ikke automatisk; den senere klient ejer fallback. | ✅ | 2026-08-13 |
| TASK-019 | **Leveret:** serverens rullende og daglige globalt/pr.-IP-kvoter består. Klienten/motoren håndhæver det robuste loft på seks unikke opfindelser pr. run, udledt af det serialiserede registry; canonical opskrifter vinder først, genbrug er tilladt, sen copy kan kun forbedre et eksisterende id, og `run-limit` har sin egen stemme-gatede fortællerfamilie. Feature-on UI gemmer nu også verdict/depth/run-limit-afvisninger, så reload hverken refunderer sommeren eller challenge-tikket. Loftet er UX/balance, aldrig erstatning for servergrænsen. | ✅ | 2026-08-13 |
| TASK-020 | **Leveret som `src/ui/improvise-client.ts` (ikke den stale core-sti):** prefetch starter ved andet valg, sender eksakt `{a,b,act}` for canonical forældre, har 2,5 s timeout og strikt `{name,flavor}`-validering. Combine læser kun allerede-klar copy synkront og venter aldrig; sen copy bruger motorens copy-only enhancement på det stabile id. Selection-generationen guards før enhver save/render/status-sideeffekt, så et forladt A+B-svar ikke kan kapre C+D. URL'en er valgfri og uafhængig af live-fortælleren. | ✅ | 2026-08-13 |
| TASK-021 | Prompten bygges af serveropslåede kanoniske forældrenavne/flavor/taksonomi og tre håndskrevne toneeksempler — **mudderkage**, ristede larver og klyngen. | ✅ | 2026-08-13 |

### Implementation Phase 4

- GOAL-004: Lad fortælleren afsige dommen på skærmen, så både ja og nej er indhold.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | Ny udfaldstype `improvised` i `CombineOutcome` med elementet, `reused`, løst problem/challenge og `needExplanations`. Core/type + fortællerforbruger er leveret; UI er fortsat uden for denne opgave. | ✅ | 2026-08-13 |
| TASK-023 | Skriv replikfamilien "dommen": accept (`{element} solves {problem}`), afvisning (elementet er nyt, men løser intet), og den bedste af dem alle — **den absurde accept**, hvor tingen faktisk opfylder prædikatet på en måde ingen havde tænkt. Sidstnævnte har 24 varianter mod 8 i hver almindelig succesfamilie. | ✅ | 2026-08-13 |
| TASK-024 | Afvisning navngiver *hvorfor* fra `NeedExplanations`: atomare krav får spiller-vendte labels, mens `allOf`/`anyOf`/`not` bruger bredere, bevisligt sande formuleringer frem for gæt. `crafted` er eksplicit uopnåelig for runtime-opfindelser (`base: false`) og har ingen død tekstpulje. | ✅ | 2026-08-13 |
| TASK-025 | **Leveret bag produktflaget:** bogen har en særskilt “Karl's inventions”-sektion med lærende tomtilstand, og slutskærmen viser et bounded resume. Den historiske `karl-playtest-v1`-shape er urørt feature-off; inventions/forsøg ligger separat i `karl-playtest-improvisation-v2` og logger par, accepted/rejected/reused, løst behov/challenge, copy-kilde og latency/timeout uden persondata. | ✅ | 2026-08-13 |
| TASK-026 | Alle 109 nye varianter køres gennem `voice_judge.gate()` fra `npm run validate`: fuld stemmescore med kort navn plus hårde ord-/sætningslofter med konservativt 23-ords dybde-3-navn (218 runtime-ekspansioner). En injiceret lav-stemme variant beviser afvisningsvejen. | ✅ | 2026-08-13 |

### Implementation Phase 5

- GOAL-005: Balancér, mål, og luk sløjfen fra spillerens påfund tilbage til kurateret indhold.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | **Leveret robust:** `npm run improvise:report` bygger baseline-planer og replayer eksakt samme par i treatment. Værktøjet måler først no-cap-reference og afprøver derefter hvert heltalsloft 1..det samme run-sæts observerede maksimum (19 i denne måling), plus no-cap/2-sommer-reference, med 2.000 parrede runs i tre prædefinerede seed-planer. Rapporten dækker skæbne/slutning, problemer, challenges, somre, accept/genbrug/afvisning, absurd/plausibel, kredit, canonical displacement, dybde og percentiler. Artefakten `docs/design/improvisation-balance-results.json` og `fnv1a32:fa873b0e` blev reproduceret byte-identisk; `npm run improvise:report:check` holder artefakt, robust selection og produkt-defaults i sync i eksisterende CI. | ✅ | 2026-08-13 |
| TASK-028 | **Leveret robust:** guard-band-grænser skal bestås i alle tre seed-planer, og gray-goo-reglen kræver created p95 ≤ 20 % af baseline canonical p50. Cap 6 var det højeste beståede loft; cap 7-16 og no-cap fejlede gray-goo-reglen i alle planer. Cap 6 gav 0,00pp fate-/required-delta, 100,01 % canonical retention, 0,0005 positiv displacement/run og 16,54 % improviseret andel af required solves. To somre/no-cap fejlede med 77,16 % retention og 7,293 displacement/run. Produktflaget forbliver slukket. | ✅ | 2026-08-13 |
| TASK-029 | **Server/export-halvdel leveret:** autentificeret `GET /admin/improvisations` eksporterer den aktuelle namespacede DO-cache i stabil leksikalsk par+akt-rækkefølge med cursor-after-key og efterspørgsels-/hit-/upstream-tællinger. Et eksternt høsteværktøj, faktisk trafik, skrivning til `content/drafts/harvested.json` og menneskelig forfremmelse er stadig åbne; intet høstes automatisk. | ◐ | 2026-08-13 |
| TASK-030 | Playtest: spil tre runs hvor målet udelukkende er at løse de tre nøder så absurd som muligt. Hvis det ikke er sjovere end at spille normalt, er prædikaterne for løse eller fortællerens domme for tørre. | | |
| TASK-031 | Opdatér `PRD.md` og `DESIGN.md` med magtdelingen (PAT-001) og de to elementklasser, så reglen overlever den næste, der rører systemet. | | |

## 3. Alternatives

- **ALT-001**: **Fuld Infinite Craft** — hvert par giver et nyt element, intet fejler. Fravalgt uændret: uden tomrum er der intet puslespil, `near-miss`-komikken forsvinder, og de 12 skæbner drukner. Denne plan tager Infinite Crafts *generativitet* og lader den arbejde for de kuraterede mål i stedet for at erstatte dem.
- **ALT-002**: **Lad sprogmodellen afgøre klassifikation eller `solves`.** Fravalgt og skærpet af arkitekturrecoveryen 2026-08-13. Modellen kan overtales og er ikke stabil på tværs af kald; både semantik og sværhedsgrad forbliver derfor deterministiske regler. Modellen må kun forbedre copy.
- **ALT-003**: **Behold allowlisterne og udvid dem bare.** Fravalgt: ti id'er pr. challenge × nye elementer i det uendelige er præcis den bogholderi-gæld, planen findes for at afskaffe.
- **ALT-004**: **Sprogmodel i browseren (WebLLM).** Fravalgt som fundament af samme grunde som i narrationsplanen — modelvægt mod et spil der loader på under et sekund. Proxy + cache giver samme resultat billigere og virker på mobil.
- **ALT-005**: **Improvisér alle par, ikke kun `plausible`/`absurd`.** Fravalgt: uden verdikt-portvagten er dette Infinite Craft med ekstra trin, og `near-miss`-øjeblikket — det bedste i spillet — ville blive spist af en generisk opfindelse.

## 4. Dependencies

- **DEP-001**: `plan/architecture-procedural-narration-1.md` fase 1 (taksonomien) og fase 2 (verdikt-motoren). Denne plan er ikke mulig uden dem og bør planlægges umiddelbart efter.
- **DEP-002**: Den eksisterende Cloudflare Worker + Durable Object storage. Ingen KV-binding.
- **DEP-003**: Groq free tier eller tilsvarende, som allerede brugt i `tools/generate_lines.py`.
- **DEP-004**: Stemmedommeren fra narrationsplanens fase 5 — gælder **kun** `TASK-026` (kør de nye dom-replikker gennem dommeren). Fase 1-4 her (`TASK-001` til `TASK-025`) afhænger ikke af narrationsplanens fase 5/6 (stemmedommer, turøkonomi) og skal ikke afvente dem — kun den ene opgave gør.

## 5. Files

- **FILE-001**: `src/core/types.ts` — `SolvePredicate`, `origin`, `parents`, `depth`, udfaldstypen `improvised`.
- **FILE-002**: `src/core/solves.ts` *(ny)* — prædikat-evaluering. Ren og fuldt testbar.
- **FILE-003**: `src/core/improvise.ts` *(ny)* — deterministisk tag-afledning og navngivning; gulvet der virker offline.
- **FILE-004**: `src/ui/improvise-client.ts` — async prefetch/cache med 2,5 s timeout, strikt copy-svar og synkront `get()`.
- **FILE-005**: `src/core/engine.ts` — løsning afgøres af prædikat; improviserede elementers rettigheder håndhæves.
- **FILE-006**: `content/acts/act-1.json`, `content/challenges.json` — `solvedBy` bliver prædikat; allowlisten overlever som `alsoSolvedBy`.
- **FILE-007**: `content/narrator/act-1.json` +
  `content/narrator/improvisation-act-1.json` — dommens puljer/labels og de
  stemme-gatede kandidatvarianter.
- **FILE-008**: `worker/src/improvise*.ts` + den eksisterende Worker/`Coordinator` — skema, model-copy, DO-cache, kvoter, oprydning og admin-eksport.
- **FILE-009**: `tools/predicate_report.mjs` *(ny)* — prædikat mod allowlist, falske negativer er fejl.
- **FILE-010**: `tools/harvest.mjs` *(stadig åben)* — den leverede servereksport er inputtet; faktisk høst tilbage til `drafts/` er ekstern og ikke bygget.
- **FILE-011**: `src/ui/book.ts` — krøniken skelner kurateret fra improviseret.
- **FILE-012**: `tools/validate.py` — prædikater valideres; `alsoSolvedBy`-overlap advares.
- **FILE-013**: `tools/improvise_report.ts` + `tools/improvise_report_cli.ts` — parret, deterministisk balance-simulering og JSON/menneskerapport.
- **FILE-014**: `docs/design/improvisation-balance.md` + `docs/design/improvisation-balance-results.json` — metode, tærskler, råt facit, anbefaling og menneskelig caveat.

## 6. Testing

- **TEST-001**: `satisfies` er ren og deterministisk; ingen tilstand, ingen tid, ingen tilfældighed.
- **TEST-002**: **Regressionsgarantien.** Hvert af de tre problemers prædikat accepterer alle nuværende løsninger — mudderkage og klyngen inkluderet — og hvert challenge-prædikat accepterer hele sin nuværende `solvedBy`. Ingen falske negativer.
- **TEST-003**: **Sværhedsgraden.** Prædikaterne afviser hele starthånden. Ingen nød kan løses i tur 1 (REQ-004).
- **TEST-004**: Et improviseret element kan ikke sætte flag, udløse age-up eller aktivere en skæbne, uanset tags (REQ-006).
- **TEST-005**: `inventions()` tæller et improviseret element, der har løst en nød, og tæller ikke ét der ikke har (TASK-010).
- **TEST-006**: Improvisationsdybde over 3 afvises.
- **TEST-007**: Verdikt-portvagten: `near-miss` og `locked` improviseres aldrig (TASK-014).
- **TEST-008**: Offline-tilstand: med proxyen slået fra er et helt run spilbart, alle nøder løselige, og udfaldet deterministisk for en given seed (REQ-007).
- **TEST-009**: Workerens validering afviser navne over 3 ord, ekstra felter, URL'er, citationstegn, kontroltegn, tegnsætningsvildnis og for lang flavor; enhver mekanik modellen måtte finde på at sende er et ekstra felt og afvises.
- **TEST-010**: Save/load med improviserede elementer i state; gamle saves uden feltet loader (CON-006 i narrationsplanen).
- **TEST-011**: 2.000 parrede simulerede runs pr. seed-plan og konfiguration: skæbne-rate, problemer, challenges, somre, improvisationsudfald, canonical displacement, dybde og percentiler rapporteres. Testene beviser eksakt action-plan-symmetri, dynamisk kandidatinterval 1..observeret no-cap-maksimum, tre seed-planer, robust guard band, gray-goo-selection, reproducerbarhed, stale artefakt/default-drift og at en bevidst gratis/no-cap-konfiguration dømmes ude.

## 7. Risks & Assumptions

- **RISK-001**: **Improvisation bliver den optimale strategi.** Hvis en opfundet ting løser sult lige så let som stegt kød, er der ingen grund til at finde den rigtige opskrift, og det kuraterede indhold bliver overflødigt. Modtræk: GUD-001 (vittigheden koster), TASK-014 (portvagten), TASK-028 (prisen sættes på måling).
- **RISK-002**: **Grå goo.** Improviseret på improviseret driver mod meningsløshed. Modtræk: dybdeloft på 3 og tag-nedarvning, der holder afkommet forbundet med sine forældre.
- **RISK-003**: **Prædikatet er for løst, og alt løser alt.** Modtræk: TASK-005 lister accepterede elementer pr. nød og læses i hånden, før noget slås til.
- **RISK-004**: **Prompt-injektion gennem opfundne navne.** Bounded input gør kanalen smal, men ikke lukket. Modtræk: SEC-002 — strikt skema, hård navnebegrænsning, validering på serveren.
- **RISK-005**: **Proxyen dør, og spillet føles fattigt.** Modtræk: REQ-007 gør regelmotoren til et komplet, spilbart lag, ikke en fejltilstand.
- **RISK-006**: **Troværdigheden.** Spillets kuraterede elementer har `note` og `sourceUrl` — rigtig arkæologi. Hvis spillerens påfund blandes sammen med dem, mister begge dele værdi. Modtræk: CON-004 og TASK-015.
- **ASSUMPTION-001**: Taksonomien fra narrationsplanen er præcis nok til at bære prædikaterne. TASK-005 er prøven; hvis den fejler, er svaret flere traits, ikke flere lister.
- **ASSUMPTION-002**: "Fremstillet" (`!base`) er den rigtige grænse for sværhedsgrad. Det er læst direkte af indholdet: alle 11 sultløsninger er fremstillede, og de spiselige base-elementer løser intet.
- **ASSUMPTION-003**: Spillere vil hellere lede efter den mest absurde løsning end den hurtigste, når spillet belønner det. TASK-030 er prøven.
- **ASSUMPTION-004**: En lille model kan forbedre kort copy uden at være gameplay-kritisk. Hvis den er ustabil eller utilgængelig, er fallback-elementet allerede komplet og klassifikationen uændret.

## 8. Related Specifications / Further Reading

- `plan/architecture-procedural-narration-1.md` — taksonomi og verdikt-motor; denne plans forudsætning, og hvor ALT-001 dér nu skal pege herhen
- `PRD.md` §2.2 (problemer), §2.3 (bløde gates), §5 (indhold og AI-udkast)
- `docs/design/challenges.md` — challenge-systemet, hvis `solvedBy`-lister er planens direkte anledning
- `docs/research/raw/research-infinite-craft.md` — hvad der lånes, og hvad der ikke gør
- `content/combos.json` — mudderkage (`mudder+baer`) og klyngen (`nabo+skind`); planens beviser på at grebet allerede virker
