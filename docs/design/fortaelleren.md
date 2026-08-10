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
- Live-genererede one-liners som eksperimentelt tilvalg bag en indstilling,
  aldrig som default.
