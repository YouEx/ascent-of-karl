---
goal: Åbne løsningsrummet for problemer og challenges, så enhver kombination der kan klassificeres som en løsning tæller — og lade spilleren opfinde sine egne elementer, uden at spillets kuraterede rygrad falder fra hinanden
version: 1.0
date_created: 2026-08-12
last_updated: 2026-08-12
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
> **Fase 2-5 er slet ikke bygget.** Improviserede elementer, LLM-proxyen,
> fortællerens dom over dem og balanceringen (TASK-009 til TASK-031) mangler
> alle. Kun `TASK-026` i fase 4 afhænger af narrationsplanens fase 5/6
> (stemmedommer, turøkonomi, se DEP-004) — resten af fase 1-4 her gør ikke,
> og skal ikke vente på dem.

Spillets sjoveste indhold findes allerede: **mudderkage** (mudder + bær) mætter Karl, og **klyngen** (nabo + skind) holder ham varm. Begge er mærket `spor: "komisk"`. Ideen om at løse en alvorlig nød på en latterlig måde er ikke ny — den er spillets bedste greb. Den er bare begrænset til de absurditeter, forfatteren nåede at forestille sig på forhånd.

Denne plan generaliserer grebet. Målet er formuleret af Martin: *"anything that can be classified as food"* skal kunne mætte Karl. Det er ikke Infinite Craft, og forskellen er hele pointen. Infinite Craft har intet mål, så dens absurditet er formålsløs; her er der en nød at være absurd *imod*. Vittigheden virker, fordi den skulle opfylde noget.

Ombygningen har to halvdele, og **den første kræver ingen sprogmodel**:

1. **Prædikater i stedet for lister.** I dag er `challenge.solvedBy` en håndholdt allowlist — ulvene besejres af `[ild, spyd, hund, bue, slynge, stenoekse, faelde, hytte, harpun, koelle]`. Det er begrebet *"et våben eller et ly"*, møjsommeligt opremset, og hvert nyt element kræver at nogen husker at føje det til hver relevant liste. Samme sygdom som fiaskoteksten, andet organ. Erstattes af et prædikat over taksonomien fra `plan/architecture-procedural-narration-1.md`.
2. **Improviserede elementer.** Et par uden opskrift kan blive til spillerens egen opfindelse med navn, flavor og — vigtigst — **tags**. Prædikatet afgør så, om tingen løser noget.

Magtdelingen er planens kerne og dens vigtigste enkeltbeslutning:

> **Fortælleren dømmer hvad tingen ER. Motoren dømmer om dét løser problemet.**

Sprogmodellen klassificerer (`{kind, stuff, traits, scale}`) og skriver navn og flavor. Den får aldrig lov at erklære `solves`. Uden den deling kan modellen tales til at godkende hvad som helst, sværhedsgraden flytter ud af Martins hænder, og spillet kan ikke balanceres. Med den deling er semantikken modellens og reglerne motorens — og reglerne er testbare.

En sidste måling styrer sværhedsgraden: **bær og larver er base-elementer, spiselige, og løser ikke sult.** Alle elleve sultløsninger er *fremstillede*. Reglen er altså ikke "spiseligt", men "spiseligt som Karl selv har lavet". Den stod allerede skrevet i indholdet; her får den bare et navn.

## 1. Requirements & Constraints

- **REQ-001**: Et problem eller challenge skal kunne erklære sin løsning som et **prædikat over taksonomien**, ikke som en liste af element-id'er.
- **REQ-002**: Ethvert element, der opfylder prædikatet, løser nøden — uanset om det er kurateret eller opfundet af spilleren i dette run.
- **REQ-003**: Et nyt kurateret element skal automatisk tælle for de challenges, det logisk løser, uden at nogen redigerer en liste.
- **REQ-004**: Sværhedsgraden skal bevares. Prædikatet skal pr. konstruktion udelukke starthånden: alle nuværende løsninger er fremstillede, og det skal `crafted: true` håndhæve.
- **REQ-005**: Spilleren skal kunne improvisere et nyt element ud af et par uden opskrift, og få det navngivet, beskrevet og klassificeret.
- **REQ-006**: Improviserede elementer må **aldrig** kunne udløse akter, sætte flag, låse skæbner op ved ren mængde eller fortrænge kurateret indhold i krøniken.
- **REQ-007**: Spillet skal virke fuldt ud offline og uden proxy. Improvisation degraderer da til deterministiske regler; prædikaterne virker uændret.
- **REQ-008**: Fortællerens afvisning skal være lige så sjov som hans godkendelse. At dømme *imod* spilleren er indhold, ikke en fejlmeddelelse.
- **REQ-009**: Samme par skal give samme improviserede element for alle spillere, når proxyen er tilgængelig (via cache), så spillet kan tales om og deles.
- **SEC-001**: Ingen API-nøgle i klientbundtet. Klassifikation sker bag en proxy, som ejer nøglen.
- **SEC-002**: Improviserede navne indgår i senere prompts og er dermed en langsom prompt-injektionskanal. Navne begrænses hårdt (≤ 3 ord, intet tegnsætningsvildnis, ingen URL'er, ingen citationstegn) og modellen svarer kun med struktureret JSON mod et fast skema. Alt uden for skemaet kasseres.
- **SEC-003**: Rate limit pr. klient i proxyen, og et hårdt loft over improvisationer pr. run. Et spil på en statisk side må ikke kunne bruges som gratis LLM-endpoint.
- **CON-001**: `Engine.resolve` forbliver **synkron, ren og deterministisk** (CON-002 i narrationsplanen). Improvisation er asynkron og sker i et lag *over* motoren, som derefter fodrer det færdige element ind. Ingen netværkskald inde i motoren.
- **CON-002**: `turnLimit` er 50. Improvisation koster en sommer som alt andet — turbudgettet er det naturlige loft for hvor meget slop der kan komme ind i ét liv.
- **CON-003**: Improvisation forudsætter taksonomien fra narrationsplanens fase 1 (TASK-002 til TASK-005 dér). Denne plan kan ikke starte før.
- **CON-004**: Krøniken og delekortet skal kunne vise et improviseret element uden at love, at det er historisk. De kuraterede elementers `note` og `sourceUrl` er spillets troværdighed og må ikke blandes sammen med spillerens påfund.
- **GUD-001**: Vittigheden skal koste noget. En absurd løsning skal være sværere eller dyrere end den oplagte — ellers er absurditet ikke et valg, men den optimale strategi.
- **GUD-002**: Kuratering slår generering. Findes der en håndskrevet opskrift, bruges den. Improvisation er kun for det tomme rum.
- **GUD-003**: Dansk i kode, kommentarer og commits. Al spillervendt tekst på engelsk.
- **PAT-001**: Magtdeling: model klassificerer, motor afgør. Ingen `solves` fra en sprogmodel, nogensinde.
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
| TASK-009 | Udvid `ElementDef` med `origin: "canon" \| "improvised"` (default `canon`) og `parents?: [string, string]`. Improviserede elementer lever i `GameState`, ikke i `content/` — de er runets ejendom og gemmes i savet. | | |
| TASK-010 | Håndhæv rettighederne i `Engine`: improviserede elementer kan ikke bære `ageUp`, `setsFlags` eller `ending`. `inventions()` tæller dem **kun hvis de har løst et problem eller et challenge**. Det belønner den absurde løsning, som er hele pointen, og giver nul gevinst for at spamme. | | |
| TASK-011 | Byg `src/core/improvise.ts` med den deterministiske regelmotor: `deriveTags(a, b): Tags`. Union af forældrenes tags plus transformationer — `+fire` → `hot`, `dry`, og `edible`→`cooked`; `+water` → `wet`; `+tool[sharp]` på `creature` → `flesh`, `dead`; `+clay` → `fragile`. Cirka 20 regler dækker det meste og er sjove i sig selv. | | |
| TASK-012 | Deterministisk navngivning som fallback: skabeloner pr. regel ("Fire-touched {b}", "Mud-caked {a}", "{a} on a stick"). Rimeligt, aldrig genialt — det er gulvet, ikke loftet, præcis som grammatikken i narrationsplanen. | | |
| TASK-013 | Improvisationsdybde: et improviseret element kan kombineres videre, men `depth` (generationer siden canon) må ikke overstige 3. Uden loftet driver kvaliteten mod grå goo, generation for generation. | | |
| TASK-014 | Kobl improvisation til verdikt-motoren: kun `plausible` og `absurd` improviseres. `near-miss` og `locked` gør det **ikke** — dér er den rigtige opskrift lige om hjørnet, og at improvisere ville dræbe puslespillet i samme sekund det blev interessant. | | |
| TASK-015 | Vis improviserede elementer i krøniken visuelt adskilt, uden `note`/`sourceUrl`, med en markør der siger at dette er Karls eget påfund (CON-004). | | |

### Implementation Phase 3

- GOAL-003: Sæt den rigtige dommer på. En sprogmodel bag en proxy klassificerer improviserede elementer og skriver deres navn og flavor — som en forbedring oven på et system, der virker uden.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Byg Cloudflare Worker `proxy/` med ét endpoint `POST /improvise`. Input: de to forældres id, navn, flavor og tags samt runets akt. Output: strikt JSON `{name, flavor, kind, stuff, traits[], scale}`. **Ingen `solves` i skemaet** (PAT-001). Nøglen bor i Workerens secrets (SEC-001). | | |
| TASK-017 | KV-cache med nøgle `pairKey(a,b)`. Cache-hit returnerer uden modelkald. Det giver tre ting på én gang: determinisme på tværs af spillere (REQ-009), en omkostning der falder mod nul, og en liste over hvad spillerne faktisk opfinder. | | |
| TASK-018 | Validér modellens svar i Workeren, ikke i klienten: skema, navnelængde ≤ 3 ord, tegnsætningsfilter, blokliste, tags skal være i de tilladte mængder. Ugyldigt svar → ét retry → derefter fald tilbage til den deterministiske regelmotor (SEC-002). | | |
| TASK-019 | Rate limit pr. IP og et loft på improvisationer pr. run i klienten. Overskredet loft er ikke en fejlbesked, men en fortællerreplik: Karl er løbet tør for idéer i dag (SEC-003, REQ-008). | | |
| TASK-020 | Klientlag `src/core/improviseClient.ts`: async, med timeout på 2,5 s og øjeblikkeligt fald tilbage til regelmotoren. Spillet må aldrig vente på nettet. Motoren forbliver synkron; det færdige element fodres ind (CON-001). | | |
| TASK-021 | Prompten bygges af taksonomien og tre håndskrevne eksempler — inklusive **mudderkage**, som er den bedste beskrivelse af tonen der findes: alvorlig nød, latterlig løsning, ægte klassifikation. | | |

### Implementation Phase 4

- GOAL-004: Lad fortælleren afsige dommen på skærmen, så både ja og nej er indhold.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | Ny udfaldstype `improvised` i `CombineOutcome` med det nye element, dets tags og hvilke nøder det løste. Fortælleren får dermed alt, hvad han skal bruge, uden at gætte. | | |
| TASK-023 | Skriv replikfamilien "dommen": accept (`{element} solves {problem}`), afvisning (elementet er nyt, men løser intet), og den bedste af dem alle — **den absurde accept**, hvor tingen faktisk opfylder prædikatet på en måde ingen havde tænkt. Sidstnævnte skal have flest varianter. | | |
| TASK-024 | Afvisning skal navngive *hvorfor* ud fra tags: "Karl attempts to eat the wheel. The wheel wins." Prædikatet ved præcis hvilket krav der fejlede, så replikken kan pege på det (REQ-008). | | |
| TASK-025 | Krønikeindførsel for improviserede løsninger med spillerens egen opfindelse fremhævet — det er runets historie, og den skal kunne deles. | | |
| TASK-026 | Kør alle nye replikker gennem stemmedommeren fra narrationsplanens fase 5. Ingen undtagelse, fordi teksten er genereret. | | |

### Implementation Phase 5

- GOAL-005: Balancér, mål, og luk sløjfen fra spillerens påfund tilbage til kurateret indhold.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Simulér 2.000 runs med improvisation slået til: hvor mange nøder løses af improviserede elementer, hvor mange somre bruges, og hvor ofte når spilleren en skæbne? Sammenlign med baseline. Hvis improvisation gør spillet nemmere, skal den koste mere end én sommer (GUD-001). | | |
| TASK-028 | Afgør prisen på improvisation ud fra TASK-027, ikke ud fra mavefornemmelse. Kandidater: 1 sommer (som i dag), 2 somre, eller 1 sommer men kun N gange pr. run. | | |
| TASK-029 | Byg `tools/harvest.mjs`: hent de hyppigste cache-poster fra KV, sortér efter hvor mange runs der har set dem, og skriv dem til `content/drafts/harvested.json`. Martin gennemgår og forfremmer de bedste til kurateret indhold med rigtig `note` og `sourceUrl`. Spillerne bliver dermed spillets forfattere — via samme `drafts/`-port som alt andet (PRD §5). | | |
| TASK-030 | Playtest: spil tre runs hvor målet udelukkende er at løse de tre nøder så absurd som muligt. Hvis det ikke er sjovere end at spille normalt, er prædikaterne for løse eller fortællerens domme for tørre. | | |
| TASK-031 | Opdatér `PRD.md` og `DESIGN.md` med magtdelingen (PAT-001) og de to elementklasser, så reglen overlever den næste, der rører systemet. | | |

## 3. Alternatives

- **ALT-001**: **Fuld Infinite Craft** — hvert par giver et nyt element, intet fejler. Fravalgt uændret: uden tomrum er der intet puslespil, `near-miss`-komikken forsvinder, og de 12 skæbner drukner. Denne plan tager Infinite Crafts *generativitet* og lader den arbejde for de kuraterede mål i stedet for at erstatte dem.
- **ALT-002**: **Lad sprogmodellen afgøre `solves` direkte.** Fravalgt og det er planens vigtigste fravalg. Modellen kan overtales, den er ikke stabil på tværs af kald, og sværhedsgraden ville flytte ud af Martins hænder og ind i en prompt. Klassifikation er semantik; løsning er en regel.
- **ALT-003**: **Behold allowlisterne og udvid dem bare.** Fravalgt: ti id'er pr. challenge × nye elementer i det uendelige er præcis den bogholderi-gæld, planen findes for at afskaffe.
- **ALT-004**: **Sprogmodel i browseren (WebLLM).** Fravalgt som fundament af samme grunde som i narrationsplanen — modelvægt mod et spil der loader på under et sekund. Proxy + cache giver samme resultat billigere og virker på mobil.
- **ALT-005**: **Improvisér alle par, ikke kun `plausible`/`absurd`.** Fravalgt: uden verdikt-portvagten er dette Infinite Craft med ekstra trin, og `near-miss`-øjeblikket — det bedste i spillet — ville blive spist af en generisk opfindelse.

## 4. Dependencies

- **DEP-001**: `plan/architecture-procedural-narration-1.md` fase 1 (taksonomien) og fase 2 (verdikt-motoren). Denne plan er ikke mulig uden dem og bør planlægges umiddelbart efter.
- **DEP-002**: Cloudflare Workers free tier + KV. Alternativt enhver funktion, der kan holde en nøgle og en cache.
- **DEP-003**: Groq free tier eller tilsvarende, som allerede brugt i `tools/generate_lines.py`.
- **DEP-004**: Stemmedommeren fra narrationsplanens fase 5 — gælder **kun** `TASK-026` (kør de nye dom-replikker gennem dommeren). Fase 1-4 her (`TASK-001` til `TASK-025`) afhænger ikke af narrationsplanens fase 5/6 (stemmedommer, turøkonomi) og skal ikke afvente dem — kun den ene opgave gør.

## 5. Files

- **FILE-001**: `src/core/types.ts` — `SolvePredicate`, `origin`, `parents`, `depth`, udfaldstypen `improvised`.
- **FILE-002**: `src/core/solves.ts` *(ny)* — prædikat-evaluering. Ren og fuldt testbar.
- **FILE-003**: `src/core/improvise.ts` *(ny)* — deterministisk tag-afledning og navngivning; gulvet der virker offline.
- **FILE-004**: `src/core/improviseClient.ts` *(ny)* — async proxy-kald med timeout og fallback.
- **FILE-005**: `src/core/engine.ts` — løsning afgøres af prædikat; improviserede elementers rettigheder håndhæves.
- **FILE-006**: `content/acts/act-1.json`, `content/challenges.json` — `solvedBy` bliver prædikat; allowlisten overlever som `alsoSolvedBy`.
- **FILE-007**: `content/narrator/act-1.json` — dommens replikfamilie.
- **FILE-008**: `proxy/` *(ny)* — Cloudflare Worker, skema, KV-cache, rate limit.
- **FILE-009**: `tools/predicate_report.mjs` *(ny)* — prædikat mod allowlist, falske negativer er fejl.
- **FILE-010**: `tools/harvest.mjs` *(ny)* — spillernes opfindelser tilbage til `drafts/`.
- **FILE-011**: `src/ui/book.ts` — krøniken skelner kurateret fra improviseret.
- **FILE-012**: `tools/validate.py` — prædikater valideres; `alsoSolvedBy`-overlap advares.

## 6. Testing

- **TEST-001**: `satisfies` er ren og deterministisk; ingen tilstand, ingen tid, ingen tilfældighed.
- **TEST-002**: **Regressionsgarantien.** Hvert af de tre problemers prædikat accepterer alle nuværende løsninger — mudderkage og klyngen inkluderet — og hvert challenge-prædikat accepterer hele sin nuværende `solvedBy`. Ingen falske negativer.
- **TEST-003**: **Sværhedsgraden.** Prædikaterne afviser hele starthånden. Ingen nød kan løses i tur 1 (REQ-004).
- **TEST-004**: Et improviseret element kan ikke sætte flag, udløse age-up eller aktivere en skæbne, uanset tags (REQ-006).
- **TEST-005**: `inventions()` tæller et improviseret element, der har løst en nød, og tæller ikke ét der ikke har (TASK-010).
- **TEST-006**: Improvisationsdybde over 3 afvises.
- **TEST-007**: Verdikt-portvagten: `near-miss` og `locked` improviseres aldrig (TASK-014).
- **TEST-008**: Offline-tilstand: med proxyen slået fra er et helt run spilbart, alle nøder løselige, og udfaldet deterministisk for en given seed (REQ-007).
- **TEST-009**: Workerens validering afviser navne over 3 ord, tags uden for mængden, manglende felter og ethvert `solves`-felt modellen måtte finde på at sende.
- **TEST-010**: Save/load med improviserede elementer i state; gamle saves uden feltet loader (CON-006 i narrationsplanen).
- **TEST-011**: 2.000 simulerede runs med og uden improvisation: skæbne-rate og somreforbrug rapporteres, så TASK-028 kan træffes på tal.

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
- **ASSUMPTION-004**: En gratis models klassifikation er stabil nok, når den kun må svare med tags fra en fast mængde. Opgaven er bevidst gjort lille, netop derfor.

## 8. Related Specifications / Further Reading

- `plan/architecture-procedural-narration-1.md` — taksonomi og verdikt-motor; denne plans forudsætning, og hvor ALT-001 dér nu skal pege herhen
- `PRD.md` §2.2 (problemer), §2.3 (bløde gates), §5 (indhold og AI-udkast)
- `docs/design/challenges.md` — challenge-systemet, hvis `solvedBy`-lister er planens direkte anledning
- `docs/research/raw/research-infinite-craft.md` — hvad der lånes, og hvad der ikke gør
- `content/combos.json` — mudderkage (`mudder+baer`) og klyngen (`nabo+skind`); planens beviser på at grebet allerede virker
