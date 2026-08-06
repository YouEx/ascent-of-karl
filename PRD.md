# PRD: Kolde Karl
### Et story-drevet alchemy-spil med en sarkastisk fortæller

**Version:** 0.1 (grundlag for udvikling)
**Status:** Prototype af kapitel 1 gennemført og valideret konceptuelt
**Format:** Dette dokument er skrevet til at ligge i roden af repoet som `PRD.md` og fungere som styrende reference for al udvikling i Claude Code.

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
1. **Problem** præsenteres i historien ("Karl fryser")
2. Spilleren **kombinerer** to elementer (tap/klik, ingen drag på mobil)
3. **Resultat**: ny opdagelse (flavor-tekst + historisk note) / kendt element / ingenting
4. **Fortælleren reagerer** på resultatet og/eller spillestilen
5. Nøgleopdagelser **løser problemer** og driver historien; epoke-opdagelser udløser **age-up**

### 2.2 Regler
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
Fortælleren har fire triggertyper, i prioriteret rækkefølge:
1. **Story-beats** (håndskrevne, højest prioritet): reaktion på nøgleopdagelser og valg
2. **Adfærd**: sten-spam-tællere (eskalering ved 3/5/8), gentagne identiske kombinationer, lange pauser, hurtige streaks af fiaskoer
3. **Flags/hukommelse**: refererer tidligere valg ("Larvemanden er tilbage")
4. **Generiske fiaskoer**: roterende pulje, aldrig samme replik to gange i træk

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
- 150-250 elementer i alt
- ~60-80 håndskrevne fortæller-replikker pr. akt (story + adfærd + flags)
- 2-4 timers spilletid, én gennemspilning
- Minimum 2 markant forskellige "liv" pr. gennemspilning (nok flags til at anden gennemspilning føles ny)
- Alle opdagelser har: navn, ikon/illustration, flavor-tekst (1-2 sætninger, komisk), historisk note (1 sætning, faktuel: hvornår/hvor/hvordan)

### 3.3 Tone & skrivestil
- Flavor: varm, tør humor — Karl er elskelig inkompetent
- Fortæller: sarkastisk, teatralsk, aldrig ondskabsfuld; grin *med* spilleren
- Historiske noter: faktuelt korrekte, kildechecket, formuleret som "sjov viden", aldrig belærende
- Sprog: dansk først; engelsk lokalisering før Steam-launch (fortæller-replikker NYOVERSÆTTES kreativt, ikke direkte)

---

## 4. Teknik

### 4.1 Stack (beslutning)
- **Engine: Godot 4** (GDScript) — gratis, let eksport til mobil + desktop + web, velegnet til 2D/UI-tunge spil, godt CLI-workflow til Claude Code
- Alternativ hvis web-first prioriteres: TypeScript + React/PixiJS (prototypen kan genbruges). Beslut i Step 1.
- Data-drevet design: ALT indhold (elementer, kombinationer, replikker, flags) ligger i JSON/CSV — aldrig hardcodet
- Save-system: lokal fil (slots), autosave pr. opdagelse

### 4.2 Arkitektur (moduler)
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
1. Godot vs. web-stack — afgøres af spike
2. Skal Karl være synlig karakter på skærmen (reagerer visuelt på flags) eller kun i tekst? *(Anbefaling: synlig — flags som visuelt payoff er stærkt)*
3. Fortæller på dansk med engelske undertekster som kunstnerisk valg, eller fuld engelsk dub? *(Afgør før Step 6)*
4. Navn: "Kolde Karl" er arbejdstitel — international titel skal findes (krav: fungerer på engelsk, antyder både historie og humor)

---

*Næste handling i Claude Code: Step 0 — opret repo-strukturen, kopiér dette dokument ind som `PRD.md`, og kør stack-spiken.*
