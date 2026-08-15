# PRD: The Ascent of Karl
### Et story-drevet alchemy-spil med en sarkastisk fortæller

**Version:** 0.1 (grundlag for udvikling)
**Status:** Historisk produktgrundlag med gældende beslutningstillæg pr. 2026-08-14
**Format:** Dette dokument er skrevet til at ligge i roden af repoet som `PRD.md` og fungere som styrende reference for al udvikling i Claude Code.

---

## 0. Gældende beslutningstillæg: improviserede løsninger

Dette afsnit er den aktuelle produktkontrakt. Det **ophæver kun modstridende
detaljer** i de historiske afsnit nedenfor; visionen, kerneloopet og den
kuraterede historiske rygrad består.

### To elementklasser med forskellige rettigheder

| Klasse | Oprindelse og rettigheder |
|---|---|
| **`canon`** | Kommer fra valideret content. En åben håndskrevet opskrift vinder altid. Canon kan have historisk `note`/`sourceUrl`, stå i den historiske tidslinje, sætte flags, udløse age-up og føre til en slutning. |
| **`improvised`** | Skabes deterministisk i det aktuelle run med `origin`, ordnede `parents` og `depth`. Den kan løse problemer og challenges gennem de samme data-drevne prædikater, men kan aldrig sætte flags, udløse age-up eller slutninger eller låse skæbner op ved ren mængde. Den vises som *Karl's invention* adskilt fra den historiske tidslinje og får aldrig historisk note eller kilde. |

### Magtdeling og offline-first flow

Regelmotoren afgør deterministisk id, `kind`, `stuff`, `traits`, `scale`,
forældre, dybde og om et prædikat løses. Fortælleren dømmer udfaldet. En
valgfri model må **kun** forbedre `name` og `flavor`; modeloutput kan aldrig
ændre tags, mekanik eller `solves`.

`Engine.attempt()` udfører én atomisk, synkron state-transition: vælg først en
åben canonical opskrift; ellers lad verdikt-porten acceptere kun `plausible`
eller `absurd`, opret/genbrug elementet, afgør behov/challenge og afslut turen.
Der er intet netværk i kernen. Med produktflaget slået til og uden Worker-URL
er hele flowet derfor stadig komplet og deterministisk; Worker-ruten er et
uafhængigt, copy-only tilvalg.

### Pris, loft og release-gate

- Ethvert ikke-canonical forsøg koster **én sommer**, også ved genbrug eller
  afvisning.
- Et run kan skabe højst **6 unikke improviserede elementer**. Genbrug er
  fortsat tilladt; et syvende nyt element afvises og bruger stadig sommeren.
- Beslutningen er valgt af den robuste, reproducerbare balancekørsel
  `fnv1a32:fa873b0e`; se
  `docs/design/improvisation-balance.md`.
- Tre agentstyrede browser-runs fandt ingen source-defekt, men er **ikke**
  ekstern-human evidens. Se
  `docs/playtest/task-030-improvisation-agent-qa-2026-08-13/`.
- Produktionsflaget forbliver slukket, indtil **5–10 engelsktalende
  deltagere** på tværs af grupperne *crafting-game-experience* og
  *low-game-experience* har spillet uden forklaring, og observationer/logs er
  dokumenteret efter `docs/playtest/README.md`.

**Produktionssandhed pr. 2026-08-14:** Pages-buildet tvinger den eksisterende
offentlige root til `VITE_IMPROVISE_ENABLED=false`. Samme artifact har en
unlisted, ikke-produktions-playtest på
<https://youex.github.io/ascent-of-karl/playtest/improvisation/>, hvor flaget
er `true`, men både improvisations- og live-fortæller-URL tvinges tomme.
Previewet er derfor deterministisk offline uden Worker-kald, secrets, trafik
eller omkostning. Det er adgang til den åbne eksterne gate, ikke
production-enable; root forbliver feature-off, indtil gaten ovenfor er
dokumenteret.

**Forudsætning 2026-08-15 — deploy før rekruttering: OPFYLDT.** Reglen står
ved magt for hver fremtidig runde: **push `main` og lad Pages-deployet køre,
FØR deltagere rekrutteres** — ellers testes en forældet build på
engangsdeltagere, og observationerne kan ikke bruges til gaten. Da reglen blev
skrevet, svarede det deployede artifact til `de4bcdb`, mens `main` lå 25
commits foran: den live CSS manglede 393 bytes regler i
`@media(max-width:900px),(max-aspect-ratio:1/1)` — mobil-layoutet fra
`738b8da`/`a093244` — havde ingen af titelskærmens tokens (`--slab-face`,
`--cave-dark`, `data-paint`) og var bygget før stemmerettelsen (`9ed780e`),
hvor engelske replikker blev læst op med OS'ets danske stemme.

`main` er siden pushet og deployet. Selve påstanden "live svarer til `main`"
skrives ikke længere ned som hashes her — første udgave af dette afsnit gjorde
netop det, og to commits senere var de forældede, så noten påstod noget usandt.
En påstand om foranderlig tilstand hører hjemme i en kørsel. Kør derfor før
hver runde:

```
npm run build:pages && npm run verify:live
```

`tools/verify_live_deploy.mjs` henter hver eneste fil i artifactet — begge
varianter, 2.936 filer, inklusive de 1.415 lydfiler pr. variant, som ligger
under stabile navne — og sammenligner sha256 mod det lokale build. Den er
fail-closed: 404, netværksfejl og en tom kørsel tæller alle som afvigelse,
aldrig som bekræftelse; filer, der slet ikke svarer (429/5xx), forsøges igen og
meldes adskilt fra ægte bytedrift, så en CDN-blip ikke sender dig ud i et
unødigt gen-deploy. En kølig kørsel tager 8-30 sekunder; køres den flere gange
i tæt rækkefølge, hastighedsbegrænser Pages (HTTP 429), og værktøjet siger det
med rene ord i stedet for at melde drift. Grøn kørsel betyder, at det
deltagerne møder, ER nuværende `main` — hele vejen, ikke kun de hashede assets.
Gaten selv er uændret åben — den lukkes først af de 5–10 dokumenterede
deltagere.

---

## 1. Vision & elevator pitch

**Pitch:** *Infinite Craft møder The Stanley Parable i menneskehedens historie.* Du kombinerer elementer for at genopfinde civilisationens milepæle — men en sarkastisk fortæller kommenterer alle dine valg, og dine dumme beslutninger (larver i stedet for stegt kød) bliver til historie-grene i stedet for fejl.

**Kernefølelse:** "Hvad mon der sker hvis..." efterfulgt af enten et *aha* (historisk indsigt) eller et *haha* (fortællerens reaktion). Helst begge.

**Hvad gør det unikt (de tre søjler):**
1. **Kombinations-puslespil med historisk logik** — kombinationer følger virkelig teknologihistorie, så man kan ræsonnere sig frem i stedet for at brute-force.
2. **Forgrenet fortælling uden fejl** — komiske valg lukker ikke historien, de drejer den. Valg akkumulerer som flags og giver payoff senere.
3. **Reaktiv fortæller** — kommenterer ikke kun historien, men *måden du spiller på* (gentagelser, sten-spam, fiaskoer, tempo). Fortælleren er hint-system, humor og brand i én.

**Målgruppe:** Spillere af Stanley Parable, Baba Is You, Infinite Craft, Little Alchemy; casual-puslespillere der vil have narrativ; sekundært: undervisningsmarkedet (historieformidling).

**Anti-mål (hvad spillet IKKE er):**
- Ikke open-ended sandbox med tusindvis af vilkårlige kombinationer
- Ikke et quiz-/læringsspil — historien er belønning, aldrig pensum
- Ikke free-to-play med reklamer (ødelægger fortællerens timing)

---

## 2. Core loop & spilmekanik

### 2.1 Loopet
> **Historisk formulering, præciseret af §0:** en historisk note følger kun
> canonical opdagelser. Et improviseret resultat mærkes i stedet som Karls
> opfindelse.

1. **Problem** præsenteres i historien ("Karl fryser")
2. Spilleren **kombinerer** to elementer (tap/klik, ingen drag på mobil)
3. **Resultat**: ny opdagelse (flavor-tekst + historisk note) / kendt element / ingenting
4. **Fortælleren reagerer** på resultatet og/eller spillestilen
5. Nøgleopdagelser **løser problemer** og driver historien; epoke-opdagelser udløser **age-up**

### 2.2 Regler
> **Udvidet af §0:** et par uden åben opskrift kan, når featuret er slået til,
> blive en deterministisk improvisation. Canon vinder altid først.

- Hvert element kan kombineres med sig selv (sten + sten = gnister)
- En kombination kan have flere gyldige løsninger på samme problem (hovedspor + komisk spor)
- Valg sætter **flags** (fx `larver`, `stinker`) der refereres i senere dialog, tilgængelige kombinationer og slutninger
- **Grene fletter med ar**: historien samles i hovedbeats, men flags efterlader permanente spor (dialog, Karls udseende, låste/åbnede løsninger)

### 2.3 Age-up (Age of Empires-inspireret)
- Hver akt = en epoke med afgrænset elementpulje (15-25 elementer)
- Én defineret **nøglekombination** pr. akt udløser epokeskift med banner + fortæller-tale
- Age-up kræver at aktens obligatoriske problemer er løst (blødt gate: fortælleren nægter ellers at "rykke historien videre" med en sarkastisk begrundelse)
- Pr. akt: 3-5 **nødvendige** opdagelser, 10+ **valgfrie** med anekdoter og flags

### 2.4 Fortæller-systemet (spillets hjerte)
Fortælleren vælger sin replik i én prioriteret kæde. De fire øverste trin er
håndskrevne øjeblikke; de fire nederste er fiaskokæden, der sørger for, at et
forsøg aldrig mødes med tavshed:

1. **Slutninger og udfordringer**: fortællerens sidste ord i et run, og de
   frister der presser alt andet i baggrunden
2. **Story-beats** (håndskrevne): reaktion på nøgleopdagelser og valg. Hans eget
   råd, der slog fejl, står før adfærd — der findes intet øjeblik med højere
   signal end at spilleren gjorde præcis, hvad der blev bedt om, og intet skete
3. **Adfærd**: spam-tællere (eskalering ved 3/5/8), gentagne identiske
   kombinationer, sweeps, lange pauser, hurtige streaks — og hint-eskaleringen
4. **Flags/hukommelse**: refererer tidligere valg ("Larvemanden er tilbage")
5. **Bagt parreplik**: skrevet på forhånd om præcis disse to ting
6. **Live-replik**: skrevet på stedet om det samme par, hvis den nåede frem
   mens spilleren valgte (tilvalg, se `plan/feature-live-narrator-1.md`)
7. **Grammatik**: en replik der nævner begge ting, valgt ud fra motorens dom
8. **Generiske fiaskoer**: roterende pulje — nødudgangen, der i praksis aldrig nås

**Offline-trelagsmodellen.** Uden live-tilvalget er trin 5, 7 og 8 tre komplette
lag til den samme replik: bagt → grammatik → generisk nødudgang. Det bagte lag
er skrevet af et menneske om netop de to elementer. Grammatikken kender kun
motorens dom og elementernes taksonomi, og kan derfor tale om et hvilket som
helst par, også ét der blev til i går. Den generiske pulje ved intet og nås kun,
hvis grammatikken er defekt. Live-replikken i trin 6 er et valgfrit indskud
mellem bagt og grammatik, aldrig en forudsætning for den komplette offline-kæde.
Målt over 1200 gennemspilninger falder 71.2 % af møderne på det bagte lag,
28.8 % på grammatikken og 0 % på tavshed
(`docs/design/narration-coverage.md`). Konsekvensen for indholdsarbejdet er, at
et nyt element ikke kræver en eneste ny replik — se `README.md`.

**Fortællerens karakterbue over spillet:** pompøs dokumentarist → slidt og resigneret → modvilligt imponeret. Skrives som én sammenhængende karakter af én skribent.

**Hint-funktion:** I stedet for hint-knap eskalerer fortælleren selv til stadig tydeligere vink efter X fiaskoer på samme problem.

---

## 3. Indhold & struktur

### 3.1 Akter (v1.0 scope: 5 akter)
| Akt | Epoke | Nøglekombination (age-up) | Tema/problemer |
|---|---|---|---|
| I | Stenalderen | Kobber + malm → Bronze | Overlevelse: kulde, sult, værktøj |
| II | Bronzealderen | Jernmalm + trækulsovn → Jern | Landbrug, landsby, handel |
| III | Jernalderen/Antikken | Papyrus + rørpen → Skrift | Viden, magt, filosofi |
| IV | Middelalderen | Bogtrykpresse | Tro, pest, håndværk |
| V | Renæssance → Industri | Dampmaskine (finale) | Videnskab, maskiner, Karls eftermæle |

*(Akt-detaljer designes i separate `acts/act-N.md` dokumenter, se §6)*

### 3.2 Indholdsmængde v1.0
> **Historisk canonical scope:** kravet om historisk note gælder canonical
> opdagelser. Improviserede elementer følger rettighederne i §0.

- 150-250 elementer i alt
- ~60-80 håndskrevne fortæller-replikker pr. akt (story + adfærd + flags)
- 2-4 timers spilletid, én gennemspilning
- Minimum 2 markant forskellige "liv" pr. gennemspilning (nok flags til at anden gennemspilning føles ny)
- Alle opdagelser har: navn, ikon/illustration, flavor-tekst (1-2 sætninger, komisk), historisk note (1 sætning, faktuel: hvornår/hvor/hvordan)

### 3.3 Tone & skrivestil
> **Sprogbeslutningen er superseded:** al spillervendt tekst er nu engelsk;
> se `docs/design/fortaelleren.md`.

- Flavor: varm, tør humor — Karl er elskelig inkompetent
- Fortæller: sarkastisk, teatralsk, aldrig ondskabsfuld; grin *med* spilleren
- Historiske noter: faktuelt korrekte, kildechecket, formuleret som "sjov viden", aldrig belærende
- Sprog: dansk først; engelsk lokalisering før Steam-launch (fortæller-replikker NYOVERSÆTTES kreativt, ikke direkte)

---

## 4. Teknik

### 4.1 Stack (beslutning)
> **Historisk stackbeslutning — ophævet af `CLAUDE.md`:** den implementerede
> stack er TypeScript + Vite. De data-drevne principper nedenfor består.

- **Engine: Godot 4** (GDScript) — gratis, let eksport til mobil + desktop + web, velegnet til 2D/UI-tunge spil, godt CLI-workflow til Claude Code
- Alternativ hvis web-first prioriteres: TypeScript + React/PixiJS (prototypen kan genbruges). Beslut i Step 1.
- Data-drevet design: ALT indhold (elementer, kombinationer, replikker, flags) ligger i JSON/CSV — aldrig hardcodet
- Save-system: lokal fil (slots), autosave pr. opdagelse

### 4.2 Arkitektur (moduler)
> **Historisk målstruktur — ophævet af den faktiske moduloversigt i
> `CLAUDE.md`.**

```
/game
  /core        # kombinationsmotor, flags, save/load
  /narrator    # trigger-system, prioritering, kø, typewriter/audio-afspilning
  /acts        # akt-styring, problemer, age-up
  /ui          # elementgrid, opdagelseskort, banner, journal
/content
  elements.json      # id, navn, ikon, akt
  combos.json        # a+b → resultat, flavor, note, flags, solves, ageUp
  narrator/*.json    # replikker pr. trigger-type og akt
  acts/*.json        # problemer, gates, age-up-krav
/tools
  validate.py        # indholdsvalidering (se §5)
```

### 4.3 Nøgle-features (tekniske krav)
- **Journal/tidslinje**: visuel oversigt over opdagelser placeret på en tidslinje; viser "huller" som stiplede silhuetter (retning uden spoilers)
- **Flag-system**: globalt key-value store; alle fortæller-replikker kan betinges af flags
- **Fortæller-audio**: replik-ID → lydfil, med tekst-fallback; afbrydelses-logik (ny replik ducker/afbryder gammel elegant)
- **Telemetri (opt-in)**: kombinationsforsøg, tid pr. problem, hvor spillere går i stå — til balancering
- Tilgængelighed: reduced motion, skalerbar tekst, farveblind-sikre tilstande, spilbart uden lyd

---

## 5. Content-pipeline (kritisk for skalering)

**Princip:** En skribent skal kunne tilføje en komplet opdagelse uden at røre kode.

1. **Kilde:** Ét regneark (eller `combos.csv`) med kolonner: `element_a, element_b, resultat, flavor, historisk_note, kilde_url, narrator_replik, flags_sat, flags_krævet, løser_problem, akt, age_up`
2. **Validator (`tools/validate.py`)** kører i CI og fanger: forældreløse elementer (kan aldrig skabes), uopnåelige problemer, cirkulære krav, manglende replikker på nøglebeats, duplikerede kombinationer
3. **AI-assisteret førsteudkast** af flavor/replikker er tilladt → **altid håndredigeret** af hovedskribenten for tone og timing
4. **Historisk fakta-check:** hver note har `kilde_url`; stikprøvekontrol før hver release
5. Regneark → JSON build-step, så indhold kan hot-reloades i dev

---

## 6. Udviklingsplan i steps

> **Historisk masterplan:** beholdes som produktets oprindelige
> beslutningshistorik. Aktuel sekvens og status står i `ROADMAP.md`; for
> improvisation gælder §0.

> Hvert step har en Definition of Done (DoD). Steps 1-3 er fundamentet — gå ikke videre før DoD er mødt.

### Step 0 — Projektopsætning *(1-2 dage)*
- Opret repo med struktur fra §4.2, dette PRD som `PRD.md`, `CLAUDE.md` med kodestandarder
- Beslut endeligt: Godot vs. TypeScript/web (spike: porter prototypen til begge på max én dag hver, vælg)
- **DoD:** Tom app bygger og kører på mobil + desktop; CI kører validator

### Step 1 — Kombinationsmotor + datamodel *(1 uge)*
- Implementér core: elementer, kombinationer, flags, solves, save/load — 100 % data-drevet fra JSON
- Portér prototypens kapitel 1-indhold som testdata
- **DoD:** Prototypens gameplay kører i enginen udelukkende via content-filer; unit tests på motoren

### Step 2 — Fortæller-system *(1-2 uger)*
- Trigger-prioritering (§2.4), replik-kø, adfærdstællere, flag-betingelser, typewriter + audio-hooks
- **DoD:** Alle prototype-replikker + 20 nye adfærdsreplikker fungerer; ingen replik gentages i træk; hint-eskalering virker

### Step 3 — Akt-system & age-up *(1 uge)*
- Problemer, gates, age-up-banner, akt-overgange, journal/tidslinje v1
- **DoD:** Akt I → Akt II-overgang fuldt fungerende med gate ("løs problemerne først")

### Step 4 — Vertical slice: Akt I i fuld kvalitet *(4-6 uger)*
- Endelig art-stil (håndtegnet/hulemaleri-æstetik — testes med 3 stilprøver først), alle Akt I-elementer illustreret
- Lyddesign: UI-lyde, ambience, opdagelses-sting
- **Fortæller-voice acting:** cast dansk speaker, indspil Akt I (largest single bet — testes med scratch-recording først)
- Polish: animationer, haptics (mobil), onboarding uden tutorial-tekst (fortælleren ER tutorialen)
- **DoD:** 20-30 min spiloplevelse i shippable kvalitet; playtest med 10 personer udefra; ≥7/10 "vil spille videre"

### Step 5 — Playtest-runde 1 & justering *(2 uger)*
- Metode: se folk spille UDEN forklaring; log hvor de griner, går i stå, stopper
- Justér balancering, hint-eskalering, replik-timing ud fra data
- **DoD:** Beslutning: greenlight fuld produktion / pivot / stop

### Step 6 — Fuld produktion: Akt II-V *(4-6 måneder)*
- Content-sprints pr. akt: design (akt-dokument) → regneark → validering → implementering → intern test
- Voice-indspilning i 2 batches (Akt II-III, Akt IV-V)
- Løbende: engelsk lokalisering starter efter Akt III er låst
- **DoD pr. akt:** validator grøn, playtestet, replikker indtalt

### Step 7 — Beta, polish & tilgængelighed *(4-6 uger)*
- Lukket beta (50-100 spillere), telemetri-analyse, balancepatches
- Achievements (inkl. "Fik fortælleren til at opgive dig"), Steam-integration, cloud saves
- **DoD:** Crash-fri, gennemspilbar af udefrakommende uden hjælp, tilgængelighedskrav fra §4.3 opfyldt

### Step 8 — Launch *(løbende)*
- **Rækkefølge:** Steam (PC/Mac) først → mobil (iOS/Android) 1-3 måneder efter
- Pris: betal-én-gang, 60-80 kr / $6.99-9.99; ingen reklamer, ingen IAP i v1
- Marketing: fortælleren som stemme i AL marketing (trailers hvor han kommenterer traileren); demo på Steam Next Fest; TikTok/Shorts med "dumme valg"-klip
- **Post-launch:** gratis akt VI ("Rumalderen") som content-update; workshop/UGC overvejes til v2

---

## 7. Team, budget & finansiering

**Minimumsteam:** 1 udvikler + 1 skribent/designer (kan være samme person + AI-assistance i starten). Tilkøb: illustrator (freelance, pr. akt), speaker (dagshyre pr. batch), lyddesigner (freelance).

**Finansiering at søge (DK):**
- **DFI's spilordning** (Det Danske Filminstitut) — konceptudvikling + produktion; dette PRD + vertical slice er præcis hvad ansøgningen kræver
- Vision Denmark, Nordisk Film Spilfonden
- Ansøg efter Step 4 (vertical slice i hånden = stærkest mulige ansøgning)

**Senere tool-integrationer (som aftalt):** billedgenerering til illustrations-førsteudkast og TTS til scratch-voice under udvikling kobles på via connectors, når vi når Step 4 — endelig art og voice er altid menneskeskabt.

---

## 8. Succeskriterier & risici

**Succes v1.0:**
- Playtest: ≥70 % gennemfører Akt I, ≥50 % starter anden gennemspilning frivilligt
- Steam: "Very Positive" (≥80 % positive), 10.000 solgte år 1 (break-even-mål sættes efter budget)
- Fortælleren nævnes i ≥50 % af anmeldelser (beviser differentiatoren)

**Toprisici & mitigering:**
| Risiko | Mitigering |
|---|---|
| Fortæller-humor lander ikke | Scratch-voice + playtest i Step 4 FØR dyr indspilning; én skribent ejer stemmen |
| Content-produktion bliver flaskehals | Pipeline (§5) bygges før fuld produktion; validator fanger fejl tidligt |
| Kombinationer føles vilkårlige | Historisk logik som designregel; playtest-metrik: "kunne du ræsonnere dig frem?" |
| Scope creep (for mange akter/grene) | Hård grænse: 5 akter, "flet med ar" frem for ægte divergens |
| Historiske fejl går viralt | Kildekrav pr. note + stikprøvekontrol |

---

## 9. Åbne spørgsmål (afklares i Step 0-1)
> **Historisk liste:** 1 er afgjort til TypeScript/Vite, 2 er afgjort ja, og
> 3 er afgjort til engelsk spillertekst. Punkterne bevares som historik.

1. Godot vs. web-stack — afgøres af spike
2. Skal Karl være synlig karakter på skærmen (reagerer visuelt på flags) eller kun i tekst? *(Anbefaling: synlig — flags som visuelt payoff er stærkt)*
3. Fortæller på dansk med engelske undertekster som kunstnerisk valg, eller fuld engelsk dub? *(Afgør før Step 6)*
4. ~~Navn~~ **Afklaret 2026-08-10:** titlen er **The Ascent of Karl**, undertitel *reinvent history, badly*. (Arbejdstitlen var "Kolde Karl".)

---

*Historisk næste handling (superseded): Step 0 — opret repo-strukturen,
kopiér dette dokument ind som `PRD.md`, og kør stack-spiken. Aktuel næste
handling er den eksterne playtest-gate i §0.*
