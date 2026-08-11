# Playtest-runde 1

*ROADMAP prioritet 2 · PRD Step 5 (fremrykket) · pakken skrevet 2026-08-10*

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
| Spiller crafting-spil (Infinite Craft, Little Alchemy, Doodle God) | 3-5 | Om vores kombinationslogik holder mod genre-forventning |
| Spiller stort set ingen spil | 2-5 | Om onboarding virker uden genre-viden — den hårde test |

Krav: **engelskkyndige** (alt spillertekst er engelsk) og villige til at
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

Link: <https://youex.github.io/Coldcarl/>

## Sådan gør du under sessionen

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

1. Bed dem trykke **"Copy run summary"** på slutskærmen og sende teksten.
   Den indeholder `ending`, `summers`, `discoveries`, `solved`, `flags` og
   `minutes` — nok til at rekonstruere runnet uden telemetri.
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
