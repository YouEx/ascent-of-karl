# Fortælleren — sprog, varietet og AI-pipeline

*Designdokument, supplement til PRD.md og docs/design/bogen.md. Besluttet 2026-08-05.*

## Sprog: engelsk

Fortælleren taler engelsk, og al spiller-vendt tekst er på engelsk. Det ophæver
PRD §3.3's "dansk først" (opdateres ved næste PRD-versionsbump). Spillets titel
er **The Ascent of Karl**, undertitel *reinvent history, badly* (besluttet
2026-08-10) — en parodi på Bronowskis *The Ascent of Man*, som matcher
fortællerens pompøse dokumentarist-register.

## Præsentation

- Fortælleren bor i en **taleboble med hale, der peger ud af skærmbilledet**
  (op mod højre hjørne) — han er til stede, men aldrig synlig.
- **Mute/unmute**-knap i boblen (🔊/🔇), husket i localStorage. Mutet
  fortæller tæller stadig adfærd (han "ser" alt og har noteret det, hvis
  man slår ham til igen — det er en joke i sig selv til senere).

## Varietets-arkitekturen (aldrig samme playthrough to gange)

Alle spil starter med samme elementer, så fortælleren bærer følelsen af nyhed.
Fem lag, der ganges med hinanden:

1. **Variant-puljer**: hver replik har `variants: string[]`. Nøglebeats
   (kombinations-reaktioner, intro, gate, age-up) har **minimum 5 varianter**
   — håndhævet af validatoren. Adfærdsreplikker har minimum 2-3.
2. **Playthrough-seed**: hvert nyt spil seeder fortællerens RNG
   (mulberry32, serialiserbar i save). Variantvalget er dermed nyt pr.
   gennemspilning, men deterministisk pr. save — vigtigt for save/load
   og for at kernen forbliver testbar.
3. **No-repeat på to niveauer**: aldrig samme replik-id to gange i træk,
   og aldrig samme variant af en replik to gange i træk.
4. **Pladsholdere**: `{a}`, `{b}` (parrets elementnavne) og `{element}`
   (sweep-elementet) udfyldes ved afspilning — generiske replikker føles
   specifikke.
5. **Adfærds-triggere** (ud over PRD §2.4's spam/gentagelse/fiasko-streaks):
   - `repeatCombo` — samme kombination igen og igen (3/6)
   - `elementSweep` — samme element kombineret med alt muligt (4/7),
     med `{element}`-navnet i replikken
   - `fast` — meget hurtige forsøg i træk (6/12, tærskel ≤2 sek. pr. forsøg)
   - `slow` — meget lang pause (≥45 sek.) før et forsøg, med cooldown så
     den ikke fyrer konstant. Tid leveres af UI-laget; kernen måler aldrig
     selv tid (determinisme).

## Trækket og trodsen (besluttet 2026-08-11)

Fortælleren siger altid højt, hvad historien vil herfra: *"And so Karl needed
warmth. If only the world around him contained objects…"* Det kaldes **trækket**
(`pull`), og det ligger på problemet i `content/acts/*.json`.

Trækket er ikke et hint til en spiller, der sidder fast — det system findes
allerede som `hints`, og det eskalerer først efter fem fiaskoer. Trækket er en
**erklæret hensigt**. Formålet er ikke at hjælpe; formålet er at give spilleren
noget at være ulydig imod. Uden en erklæring findes der ingen ulydighed at grine
af, og så er en komisk omvej bare en tilfældig kombination.

**"Altid" opnås ved at stå fast, ikke ved at blive gentaget.** Fortælleren siger
trækket ved spilstart og som anden takt efter en opdagelse, med afkøling
(`PULL_COOLDOWN`), og skifter problemet, fyrer det straks — dét er historien der
rykker. Imens markerer UI'et hele tiden det problem, han peger på (`.problem.wanted`,
pil frem for cirkel), så hans hensigt er synlig uden at han skal docere. Det er
den samme lektie som `slowUsed`: sjov én gang, docerende tre.

Ved **genoptagelse** tier han, hvis trækket ikke har flyttet sig, mens han var
væk. Ellers ville hver genindlæsning gentage en replik, spilleren allerede har
hørt — og nulstille afkølingen til den næste ægte påmindelse. Chippen står
stadig markeret; det er dér, "altid" bor.

**Trodsen** (`defiance`) er betalingen. Opfinder spilleren noget andet end det,
der blev bedt om, bemærker fortælleren det, og tonen eskalerer fra tør
bemærkning til opgivende. Tre regler gør den skarp:

1. **Kun opdagelser tæller.** At fejle undervejs er ikke ulydighed — det er at
   prøve. At lykkes med noget *andet* er ulydighed.
2. **Det komiske spor er undtaget fra afkølingen.** At vælge mudderkagen frem
   for løsningen er hele pointen, og den vits må ikke tabes til en timer, der
   blev sat for de tørre bemærkningers skyld. Det kan ikke spamme: komiske fund
   er få, og en gentagelse er ikke en opdagelse.
3. **Stigen gås nedefra, og intet trin kan tabes.** Trinnene er en tone-bue —
   irritation, mistanke, opgivelse — ikke et regnskab. Fortælleren ser hver
   trods (`defianceCount` tælles også når han tier), men *trinnet* rykker først,
   når han rent faktisk siger noget (`spokenDefianceTiers`). Var nøglen bundet
   til den rå tæller, ville en trods inden for afkølingen brænde sit trin, og
   tælleren går kun opad: trinnet var så væk for resten af spillet — inklusive
   hans sidste, opgivende replik. Derfor må replikkerne heller ikke tælle højt
   ("Twice now…"), for et trin kan siges ved et hvilket som helst antal trodser.

Fortælleren taler i **takter**. En opdagelse giver to: hvad der skete, og hvad
historien vil herfra. UI-laget køer dem, så anden takt først skrives ud, når
første er færdig. Ved age-up og slutninger tier trækket — historien har sin egen
store takt dér.

Validatoren håndhæver, at hvert obligatorisk problem har et træk med mindst fem
varianter (det høres hver gang historien rykker), at trods-replikkerne findes,
og at en akt med træk ikke mangler trods-kortet helt.

## Dommen over improvisationer (besluttet 2026-08-13)

`Engine.improvise()` giver fortælleren et struktureret udfald, ikke en løs
tekststreng. Dommen ligger i `content/narrator/act-1.json`, mens de 109
kandidatvarianter ligger separat i
`content/narrator/improvisation-act-1.json`, så stemmefingeraftrykket ikke
kalibreres på de linjer, det selv skal dømme.

Prioriteten ændres kun dér, hvor en mere specifik sandhed findes:

- slutninger samt nye/akutte challenges beholder deres eksisterende plads;
- løser opfindelsen det aktive challenge, erstatter den specifikke
  improvisationsdom challengets generiske `successLine`;
- løser den et problem, står dommen efter challenge-beats, men før en generisk
  opdagelsesreplik;
- en ny opfindelse nulstiller opdagelsens fiasko-/hinttællere; en afvist
  improvisation tæller som en fiasko, mens genbrug ikke foregiver at være nyt;
- løser den intet, bruges `NeedExplanations`; `kind`, `stuff`, `traits`,
  `scale` og `minDepth` kan forklares præcist via spiller-vendte labels, mens
  `allOf`, `anyOf` og `not` bruger bredere sande linjer. `crafted` kan ikke
  fejle for et runtime-improviseret element (`base: false`) og har derfor
  ingen død replikpulje;
- problem/challenge-id'er oversættes til grammatiske navneordfraser
  (`Karl's hunger`, `the wolves`) i content i stedet for at indsætte hele
  `ProblemDef.name`-sætninger;
- genbrug og de tre afvisninger (kanonisk udfald, verdikt-port, dybdeloft)
  har egne puljer; `locked` er skilt fra de øvrige verdikter, fordi svaret
  findes, men endnu ikke er tilgængeligt.

Den absurde løsning er produktets payoff og har derfor den største enkelte
pulje: 24 varianter mod 8 i hver almindelig succesfamilie. Alle puljer har
mindst to replik-id'er, så den eksisterende globale id-no-repeat virker; RNG,
variant-hukommelse og save/load er uændret. Linjerne har ingen `audioId` og
falder derfor ærligt tilbage til tekst. Stemmedommeren ekspanderer hver variant
to gange: en kort profil til fuld stemmescore og en konservativ 23-ords
dybde-3-profil til de hårde ord-/sætningslofter — 218 runtime-linjer i alt.

### Driftsstatus for improvisationsdommen

Dommen er en del af den komplette offline-kæde. Motoren leverer det
strukturerede udfald synkront; fortælleren vælger en håndskrevet,
stemme-gated replik uden netværk. Den valgfrie `/improvise`-Worker kan kun
forbedre opfindelsens `name`/`flavor` og er uafhængig af både dommen og
live-fortællerens `VITE_NARRATOR_URL`.

Kilden er færdig, men produktionen sætter hverken
`VITE_IMPROVISE_ENABLED` eller `VITE_IMPROVISE_URL`. Tre agent-QA-runs fandt
ingen source-defekt; de er ikke ekstern-human evidens. Production-enable
afventer 5–10 explanation-free engelsktalende deltagere på tværs af
crafting-game- og low-game-experience-grupper. Se
`docs/design/improvisation-balance.md` og
`docs/playtest/task-030-improvisation-agent-qa-2026-08-13/README.md`.

## Trelagsmodellen (besluttet 2026-08-12, målt 2026-08-13)

Fortælleren vælger sin replik i én prioriteret kæde (PRD §2.4). De øverste trin
er håndskrevne øjeblikke. Uden live-tilvalget er de nederste trin en komplet
**offline-trelagsmodel** til den samme fiaskoreplik, rangeret efter hvor meget
de ved om parret:

| Lag | Ved om parret | Skrevet af | Andel af møder |
|---|---|---|---:|
| **Bagt** (`pairs-act-1.json`) | begge navne, begge flavors, karlMood, den målte dominerende dom | et menneske, på forhånd | **71.2 %** |
| **Grammatik** (`grammar-act-1.json`) | motorens dom og elementernes taksonomi — ikke navnenes betydning | et menneske, som regler | **28.8 %** |
| **Generisk** (`genericFailure`) | intet | et menneske, som pulje | **0 %** |

**Live** (`src/narrator/live.ts`) er et valgfrit indskud mellem bagt og
grammatik: en model kan kende begge elementer i øjeblikket, men hvis svaret ikke
er klar, fortsætter den komplette offline-kæde uden forskel for spilleren.

Målt over 1200 gennemspilninger med 1005 forskellige par mødt
(`docs/design/narration-coverage.md`, genereret af `tools/coverage_report.mjs`).
Den generiske pulje er dermed blevet en **nødudgang, der i praksis aldrig nås** —
den findes for at intet forsøg kan mødes med tavshed, ikke for at blive hørt.

**Hvorfor rækkefølgen er sådan.** Det bagte lag står først, fordi en replik en
skribent har siddet med altid slår en, der blev skrevet på et sekund. Live står
efter det bagte af samme grund — men før grammatikken, fordi den til gengæld
ved præcis, hvad de to ting *er*, hvor grammatikken kun kender dommen.

**Prisen for laget.** Bagte replikker koster plads, ikke tid: de lazy-loades pr.
akt med en dynamisk `import()`. Akt I har nu 420 opslag / 940 varianter og
fylder 60.833 bytes = 59.4 KiB gzip. Budgettet er 60 KiB pr. akt og bevogtes af
`tools/validate.py`, ikke af build-loggen; der er 607 bytes tilbage, så næste
bagebatch kræver kompression eller en eksplicit budgetbeslutning.
Opslags-id'et *udledes* fra parret frem for at blive gemt — den udledning findes
tre steder (`pairLineId()` i `src/narrator/pairs.ts`, `line_id()` i
`tools/assemble_pairs.py`, og inline i `validate.py`) og skal holdes i sync.
Divergerer de, rapporterer validatoren hvert eneste opslag som dinglende. Det er
en larmende fejl, og det er med vilje.

**Det vigtigste, laget betyder for indholdsarbejdet:** et nyt element kræver ikke
en eneste ny replik. Grammatikken taler ud fra taksonomien, så den kan tale om
noget, der blev til i går. Se `README.md`, "Tilføj et element uden at skrive en
replik".

## AI-pipeline til varianter (PRD §5)

**Princip: modellen genererer udkast i pipelinen — aldrig runtime.** Spillet
skal være gratis at drive, offline-dueligt og deterministisk; varieteten
kommer fra puljerne, ikke fra live-kald.

- **Værktøj**: `tools/generate_lines.py` finder replikker med for få
  varianter og genererer udkast i fortællerens stemme (system-promptet
  indeholder tone-bibelen). Udkast lander i `content/narrator/drafts/`
  og flyttes KUN ind i content efter håndredigering (PRD §5.3).
- **Anbefalet model: Groq free tier med `llama-3.3-70b-versatile`** —
  gratis kvote, ekstremt hurtig inferens, rigeligt god til korte vittige
  replikker. `GROQ_API_KEY` som miljøvariabel.
- **Alternativer**: Google Gemini Flash (gratis tier, god kvalitet) eller
  **lokal Ollama** (`llama3.1:8b`/`qwen3:8b`) hvis det skal være 100 %
  gratis og offline — kvaliteten er lavere, men til førsteudkast der
  alligevel håndredigeres er det fint.
- Skaleringsplan: når akterne vokser, køres værktøjet pr. akt
  (`--act N --min 5`), og skribenten kuraterer. Validatoren fejler CI,
  hvis et nøglebeat kommer under 5 varianter.

## Audio: pre-genereret scratch-voice (besluttet 2026-08-05)

Al fortæller-lyd genereres **på forhånd** og shippes som filer — aldrig
live-TTS (samme princip som tekst-pipelinen: gratis drift, offline, ens
timing for alle spillere).

- **Pipeline**: `tools/generate_audio.py` → én MP3 pr. variant
  (`public/audio/<replik-id>.v<index>.mp3`) + `manifest.json`. UI'et
  afspiller kun filer, der står i manifestet; mangler manifestet, er
  spillet tekst-only.
- **Scratch-stemme**: Edge TTS `en-GB-RyanNeural` (gratis, britisk
  dokumentar-tone), rate -4 %, pitch -2 Hz. Akt I+II = 168 filer, ~9 MB.
- **Regel**: voicede replikker må ikke bruge `{a}`/`{b}`-pladsholdere
  (kombinatorisk eksplosion) — de forbliver tekst-only. `{element}`-replikker
  kan senere pre-renderes pr. element, hvis de skal voices.
- Afspilning: ny replik ducker den gamle (hurtigt fade); autoplay-blokering
  håndteres ved at udskyde til første interaktion; mute-knappen stopper
  også lyden.
- Final voice besluttes i Step 4 efter playtest med scratch-stemmen
  (menneskelig speaker eller premium-TTS — PRD §6, "largest single bet").

## Senere (ikke i denne version)

- "Director"-logik: vægt varianter efter flags (Grub Man-varianter af
  generiske replikker) — datamodellen understøtter det allerede via
  `requiresFlags` på replikker.

## Live-genererede replikker (bygget 2026-08-12)

Bulletpunktet ovenfor lød tidligere "live-genererede one-liners som
eksperimentelt tilvalg bag en indstilling, aldrig som default". Det er nu
bygget: `src/narrator/live.ts` + `worker/` henter en replik om det aktuelle
par, mens spilleren stadig vælger, og lægger den ind som trin 6 i
fiaskokæden. Princippet står ved magt — **det er et tilvalg, ikke en default,
og spillet skal være komplet uden det.** Falder kaldet fra, eller er der intet
svar endnu, mærker spilleren ingenting: grammatikken står lige nedenunder.

Planen, de tre jernregler og den største åbne risiko (SEC-003: proxyen har
ingen rate limit — `ALLOWED_ORIGINS` er en CORS-lås, og CORS er en browserregel,
der ikke stopper `curl`) står i `plan/feature-live-narrator-1.md`.
