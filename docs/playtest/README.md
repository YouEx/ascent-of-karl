# Playtest-runde 1

*ROADMAP prioritet 2 · PRD Step 5 (fremrykket) · pakken skrevet 2026-08-10*

## Aktuel gate for improvisation

Improvisationskilden er **Source complete — external playtest pending**.
Tre agent-QA-runs fandt ingen source-defekt, men tæller ikke med her:
`task-030-improvisation-agent-qa-2026-08-13/`.

Den eksterne gate er præcis **5–10 engelsktalende deltagere** på tværs af
crafting-game- og low-game-experience-grupper, som spiller **uden
forklaring**. Gaten er fortsat åben. Brug den særskilte, unlisted
ikke-produktions-preview:
<https://youex.github.io/ascent-of-karl/playtest/improvisation/>. Den er
feature-on, men deterministisk offline med tom Worker-URL. Den offentlige root
på <https://youex.github.io/ascent-of-karl/> forbliver feature-off.

### Før du inviterer nogen

Deltagere er engangsressourcer: spiller de en forældet build, kan
observationerne ikke bruges til gaten (PRD §0). Kør derfor, med `main` pushet
og Pages-deployet færdigt:

```bash
npm run build:pages && npm run verify:live
```

Grøn kørsel betyder, at previewet ovenfor ER nuværende `main`: hele artifactet,
2.936 filer, byte for byte — også lyden, som ligger under stabile navne og
derfor ikke afsløres af et hashet bundtnavn. Målt over 6 kørsler tager den 8-51
sekunder — er den langsom, er det CDN-cachen, der er kold, ikke en fejl, og en
kørsel lige efter et deploy ligger typisk i toppen af spændet.
Rød betyder stop: vent på deployet, og send først invitationerne
bagefter. Melder den kun filer "uden svar", er det CDN'et, ikke dit deploy —
kør igen. Nævner den HTTP 429, har du kørt den for tæt på sidste gang: 2.936
opslag i træk tåler Pages ikke, så vent et par minutter.

Lokal kandidat:

```bash
env -u VITE_IMPROVISE_URL VITE_IMPROVISE_ENABLED=true npm run dev
```

Produktionsflaget skal forblive usat, indtil observationer og logs fra denne
runde er dokumenteret.

## Hvorfor denne runde findes

Vi rykkede playtesten frem FØR art, voice og lyd-polish. Grunden er en enkelt
risiko fra PRD §8: **hvis fortællerens humor ikke lander, redder pæn grafik
den ikke.** Det er billigt at skrive 770 replikker om nu og dyrt at gøre det
efter at have illustreret 187 elementer.

Runden skal derfor svare på tre spørgsmål — i den rækkefølge:

1. **Griner de?** (er tonen sjov, eller bare selvhøjtidelig?)
2. **Går de i stå?** (og præcis hvor?)
3. **Kan kombinationerne ræsonneres?** (eller gætter de i blinde?)

Alt andet — balancetal, ordlyd, knapfarver — er sekundært i denne runde.
Skriv det ned, men lad det ikke stjæle observationstid.

## Hvad der IKKE testes

- Om folk kan lide grafikken (der er ingen endelig grafik endnu)
- Om voice-stemmen er den rigtige (scratch-TTS er en pladsholder)
- Svært/let-balancering (det kræver flere runs end 10 personer giver)

Hvis en tester bruger hele sessionen på at tale om lyden, notér det og
styr venligt tilbage.

## Deltagere

**5-10 personer.** Rekrutteringen skal ramme to grupper, fordi de fejler
forskelligt:

| Gruppe | Antal | Hvad de afslører |
|---|---|---|
| Crafting-game experience (Infinite Craft, Little Alchemy, Doodle God) | 3-5 | Om vores kombinationslogik holder mod genre-forventning |
| Low-game-experience | 2-5 | Om onboarding virker uden genre-viden — den hårde test |

Krav: **engelsktalende** (alt spillertekst er engelsk) og villige til at
blive set på mens de spiller. Undgå folk der allerede har hørt om projektet
— de kender pointen og griner af høflighed.

## Format

- **20-30 minutter** pr. person. Ét run er nok; turngrænsen er 50 somre.
- **Ingen forklaring.** Du sender linket og tier. Det er hele testen.
- Helst **med skærmdeling** (video) så du kan se hvor de stopper op, men
  asynkront er bedre end ingenting — så bed dem om `docs/playtest/skema.md`
  og run-resuméet.
- **Hver tester spiller alene.** To personer sammen løser opgaven i
  fællesskab og skjuler præcis den forvirring vi leder efter.

Baseline-link: <https://youex.github.io/ascent-of-karl/>. Det offentlige link
har improvisation slået fra. Improvisationslink:
<https://youex.github.io/ascent-of-karl/playtest/improvisation/>.

## Dig selv som tester 0

Du kommer til at spille det selv først. Det er rigtigt at gøre — men vær
skarp på hvad det kan og ikke kan afgøre, ellers forurener det runden.

**Dit eget run er gyldigt bevis for:** at spillet kan gennemføres uden at
gå i stykker, at turnøkonomien føles rigtig (50 somre — for kort, for langt?),
at slutningen kommer på det rigtige tidspunkt, og at der ikke er UI-friktion
du er holdt op med at lægge mærke til.

**Dit eget run er IKKE bevis for:** at humoren lander (du skrev den), at
kombinationerne kan ræsonneres (du kender dem), eller at onboardingen virker
(du kan spillet). De tre spørgsmål øverst i dette dokument kan kun besvares
af nogen der ikke er dig.

Notér dit run i `resultater.md` som **tester 0**, adskilt fra de rigtige tal,
og lad det ikke tælle med i griner-medianen.

Hold kæft. Det er svært, og det er hele metoden.

**Sig kun disse ting:**

- Ved start: *"Tænk højt. Sig hvad du tror der sker, før du klikker."*
- Ved en pause over ~20 sekunder: *"Hvad tænker du på lige nu?"*
- Ved et direkte spørgsmål: *"Hvad ville du gøre, hvis jeg ikke sad her?"*

**Sig aldrig:**

- "Prøv at trække den ene over på den anden" ← det er testen
- "Du skal finde bogen" ← det er også testen
- "Ja, præcis!" / "Nej, ikke helt" ← du lærer dem spillet i stedet for at måle det

Hvis de går fuldstændig i stå i over to minutter: notér tidspunktet og
hvad de sidst prøvede, og hjælp dem så videre med det MINDST mulige hint.
Et run der ender i frustration efter tre minutter giver ingen data om
fortælleren.

## Det du skal måle

### Primært: griner de?

Sæt en streg hver gang testeren **ler, fniser, smiler synligt eller læser
en replik højt**. Højtlæsning tæller — det er det stærkeste signal om at en
linje ramte. Notér hvilken replik der udløste det.

Målestok: **et run uden en eneste streg er et rødt flag.** Fortælleren er
spillets eneste egentlige indhold ud over kombinationerne.

### Sekundært: hvor går de i stå?

Notér hvert stop over ~20 sekunder: hvad de sidst opdagede, hvad de prøvede
imens, og hvad der løsnede det. Mønstre på tværs af 5+ personer er det der
skal styre bølge 2-content.

Særligt vigtige tærskler:

- **De første 3 kombinationer** — kommer de i gang uden hjælp?
- **14 opdagelser** (`endingsUnlockAt`) — først dér kan et run slutte.
  Når de så langt inden 50 somre?
- **Challenges** (`ulve`, `toerke`, `sygdom`) — forstår de at der løber en frist?

### Tertiært: kan det ræsonneres?

Hver gang de siger *"jeg prøver X + Y fordi ..."* er det et ræsonnement.
Hver gang de klikker to tilfældige felter er det brute force. Notér
forholdet groft (fx "mest ræsonnement de første 10, derefter spam").

Brute force sent i runnet er ikke nødvendigvis en fejl — det kan betyde at
puljen er blevet for stor til at overskue. Notér hvor skiftet sker.

## Efter sessionen

1. Bed dem trykke **"Copy playtest log"** på slutskærmen og sende teksten.
   Den indeholder ét objekt pr. gennemført run (`ending`, `summers`,
   `discoveries`, `solved`, `flags`, `minutes`) **og listen over blindgyder**
   — hver kombination de prøvede som ikke findes, hvor mange gange, og hvilken
   sommer de først prøvede den.

   Blindgyderne er rundens vigtigste enkelttal. Alt andet kan rekonstrueres
   bagefter; hvad nogen *forventede* kan ikke. Et par der går igen hos flere
   testere er ikke en fejl de begik — det er indhold vi mangler, formuleret
   i deres eget sprog. Læg dem i `resultater.md` under "Manglende kombinationer".

   Loggen samler alle runs i samme browser, så en tester der spiller to gange
   kun behøver at kopiere én gang til sidst. Den forlader ikke browseren af
   sig selv, og den indeholder hverken navn, tidspunkt eller id.
2. Send `skema.md`-spørgsmålene (eller stil dem mundtligt).
3. Skriv dine observationer ind i `resultater.md` **samme dag**. Hukommelsen
   om hvor nogen tøvede holder sig ikke til næste morgen.

## Hvornår runden er slut

Når 5 personer er gennemført, eller når du har hørt det samme svar tre gange
i træk. Det sidste sker typisk før det første.

**Beslutningen der skal træffes bagefter:**

| Fund | Konsekvens |
|---|---|
| De griner, men går i stå | Content-arbejde (ROADMAP 3) — humoren holder |
| De går ikke i stå, men griner ikke | Fortælleren skal skrives om FØR art (ROADMAP 4 udskydes) |
| Ingen af delene | Kernesløjfen er problemet, ikke pakken. Tilbage til PRD §8 |
| Begge dele virker | Fortsæt som planlagt: art-stilprøver, så lyd |

## Filer

- `invitation.md` — beskeden du sender (dansk + engelsk)
- `skema.md` — spørgsmålene efter spil
- `observation.md` — skabelon, én pr. tester
- `resultater.md` — samlede fund (udfyldes undervejs)
