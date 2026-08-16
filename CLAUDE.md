# The Ascent of Karl — udviklerguide

Læs `PRODUCT.md` først — det er den styrende reference for produktformål,
capabilities, current-vs-target og succes. `PRD.md` er vigtig detalje og
historik, men må ikke overtrumfe `PRODUCT.md`.

Før en spiller-vendt ændring: kompilér den relevante kontekst:

```bash
npm run product:context -- "beskriv ændringen"
# eller entydigt:
npm run product:context -- --capability sandbox.invention
```

Ændrer opgaven formål, current truth, approved target eller kvalitativ
acceptance, opdatér `PRODUCT.md` og kontrakten i `docs/product/` FØR kode.
`npm run product:check` skal være grøn. Den genererede graf er evidens og
agentkontekst — aldrig autoritet.

## Stack-beslutning (Step 0, afklaret)

**TypeScript + Vite (web-first).** Begrundelse: bygger og tester i CI uden
engine-binær, kører straks på mobil + desktop via browser, prototypen kan
genbruges, og indholdet er ren JSON der kan flyttes til Godot senere hvis
distributionen kræver det (Steam-wrap via Electron/Tauri er også en vej).
Beslutningen kan genbesøges før Step 4 uden at indholdet skal skrives om.

## Kommandoer

```bash
npm install          # første gang
npm run dev          # dev-server med hot reload
npm test             # unit tests (vitest)
npm run test:visual  # langsom, eksplicit visuel regression (rigtig browser)
npm run validate     # indholdsvalidering (python3 tools/validate.py)
npm run improvise:report        # regenerér balance-rapport til stdout
npm run improvise:report:check  # byte/hash/cap/cost mod committed facit
npm run playtest:evidence:check # verificér TASK-030-agentbevisets WebP/referencer
npm run harvest -- --input path/to/fixture.json --dry-run # offline høsteaudit
npm run audit:narration # browseraudit: synlig tekst = faktisk lyd, korrekt beat-rækkefølge
npm run build        # typecheck + produktion-build
npm run build:pages  # root feature-off + indlejret offline playtest-preview
npm run verify:pages # kontrollér det allerede byggede Pages-artifact
npm run product:check # produktkontrakter + grafdrift + kendte agentsvar
npm run product:context -- "opgave" # formålsførst kontekstpakke
```

Produktionens `harvest` kræver en deployet Worker, en eksplicit betroet origin
og et admin-token i miljøet; brug aldrig token som CLI-argument. Se
`docs/deployment/live-narrator.md`.

## Arkitektur

- `src/core/` — kombinationsmotor, flags, save/load. **Ren og deterministisk**:
  ingen DOM, ingen tilfældighed, ingen indholdskendskab.
- `src/core/solves.ts` — ren evaluering af data-drevne løsningsprædikater.
  Samme prædikat gælder canonical og improviserede elementer.
- `src/core/improvise.ts` + `Engine.attempt()` — deterministisk tag/copy-gulv,
  stabile ids, dybdeloft, cap 6 / én sommer og det atomiske flow, hvor en
  canonical opskrift altid vinder før improvisation.
- `src/narrator/` — trigger-prioritering (story > adfærd > flags > generisk),
  tællere, hint-eskalering, no-repeat og narratorens dom over improvisation.
  Kender kun `Engine` og content-typerne.
- `src/ui/` — al DOM og præsentation. Kun UI må røre `document`/`localStorage`.
  `tokens.css` = designsystemets variabler, `style.css` = brugen af dem,
  `icons.ts` = stregikoner til krommet, `art.ts` = malet elementkunst (slår
  element-id op mod udskårne billeder i `src/assets/art/elements/`, falder
  tilbage til content-emoji hvis ingen findes), `playtest.ts` = logger
  blindgyder og afsluttede runs lokalt (`docs/playtest/`).
  `improvise-flow.ts` ejer produktflagets seam, `improvise-client.ts` ejer
  den valgfrie copy-prefetch, `improvise-view.ts` holder opfindelser ude af
  den historiske tidslinje, og `improvise-playtest.ts` skriver det separate
  `karl-playtest-improvisation-v2`-format.
- `src/ui/audio.ts` — recorded scratch-voice først, lokal browser-TTS som
  eksakt fallback for dynamiske/manglende replikker. Et nyt tekstbeat stopper
  altid gammel lyd, og beat-køen venter på både tekst og faktisk audio-end.
- `src/assets/` — skrifter og grafik Vite skal hashe. `public/` er for filer der
  skal have et forudsigeligt navn (lyd, manifest, `karl.webp`, delekort og ikoner).
- `src/content.ts` — samler content-filerne. Eneste fil der importerer JSON.
- `content/` — ALT indhold: elementer, kombinationer, akter, replikker.
  **Indhold må aldrig hardcodes i kode** (PRD §4.1).
- `tools/validate.py` — indholdsvalidering, kører i CI.
- `tools/improvise_report*.ts` — robust, deterministisk balance-rapport og
  check af artifact/hash/produkt-defaults.
- `tools/harvest.mjs` — sikker, review-only transport fra en autentificeret
  Worker-snapshot eller offline fixture til et ubetroet draft. Intet
  auto-promoveres.
- `worker/` — én valgfri Cloudflare Worker med uafhængige modelruter.
  `/improvise` returnerer kun valideret `{name, flavor}`; den ejer aldrig
  gameplay-tags eller `solves`.
- `tools/social/` — delekort og app-ikoner. Genereres, redigeres aldrig i hånden.
- `tools/art/` — element- og kromkunst skåret ud af Martins referencebilleder
  i `docs/design/reference/`. `npm run art` kører de deterministiske scripts
  i rigtig rækkefølge, regenererer elementernes batchmanifest og bygger det
  lokale kontaktark til review (se `build_all.py`'s docstring for hvilke trin
  der er udeladt og hvorfor). Genereres, redigeres aldrig i hånden — ret
  referencen eller udskæringen i scriptet, aldrig den udskrevne webp.
- `tools/judge/` — den visuelle tilbagekobling: deterministisk scenarie,
  produktions-`vite preview`, Playwright-optagelse, fem regionsmetrikker,
  50/50-overlejringer, fund/rutning og accept/fortryd. Sløjfen må kun skrive
  token-overrides i `src/ui/tuning.css`; kunst og struktur går i de
  versionerede køer under `docs/design/`. Se `DESIGN.md` §10 og
  `plan/architecture-visual-judge-1.md`.
- `docs/design/reference/` — Martins referencebilleder. Kilden til paletten;
  farver samples som regionsmedianer, aldrig som enkelt-pixels.
  `registry.json` er samtidig dommerens maskinlæsbare skærm-, region-,
  anker-, vægt- og tærskelkontrakt.
- `plan/` — implementeringsplaner for større visuelle/strukturelle spor.
- `docs/product/` + `tools/product-knowledge/` — validerede capabilities,
  tvetydige scenarier, deterministisk produktgraf og task-aware agentkontekst.
  `PRODUCT.md` er menneskeautoriteten; grafen er afledt.

## Regler

1. **Data-drevet**: nye elementer/kombinationer/replikker tilføjes KUN i
   `content/*.json`. Ny akt = ny JSON-fil + én linje i `src/content.ts`.
2. **Kør `npm test` og `npm run validate` før hvert commit.** CI kræver begge grønne.
3. Fortæller-replikker refereres altid pr. id — validatoren fanger døde referencer.
4. Historiske noter SKAL have `sourceUrl` (PRD §5: kildekrav pr. note).
5. Al spiller-vendt tekst er på ENGELSK (beslutning 2026-08-05, se
   `docs/design/fortaelleren.md` — ophæver PRD §3.3's "dansk først").
   Kode, kommentarer og docs: dansk domænesprog er ok, hold identifiers
   ASCII (`stenoekse`, ikke `stenøkse`). Element-id'er forbliver danske.
6. Engine- og narrator-tilstand skal altid kunne serialiseres (save/load).
7. **Nye overlejringer skal gå gennem `openOverlay()`** (`src/ui/overlay.ts`)
   og tilføjes til `OVERLAYS` i `tools/ux_audit.mjs`. Se
   `docs/design/ux-checklist.md` — princippet er ingen blindgyder: mindst to
   veje ud, og browserens back lukker overlejringen i stedet for spillet.
8. **`DESIGN.md` er lov for alt visuelt.** Farver, typografi, form og bevægelse
   findes som tokens i `src/ui/tokens.css` — skriv aldrig en rå hex-værdi eller
   en font-familie i `style.css`. Ny farve eller nyt trin: opdatér DESIGN.md
   FØRST, dernæst tokens.css, og brug så variablen. To hårde regler derfra:
   emoji må kun komme fra `content/*.json` (aldrig i krom — brug `src/ui/icons.ts`
   eller udskåret kunst fra `tools/art/`, se DESIGN.md §8), og okker der bærer
   tekst eller fokus skal være `--ochre-ink`, ikke `--ochre`.
   **`tests/design-tokens.test.ts` håndhæver det maskinelt:** hver farve DESIGN.md
   nævner skal findes som token, og hver tekstfarve skal klare 4,5:1 mod det
   MØRKESTE papir den kan lande på — ikke mod det lyseste. Skal en farve bevidst
   ikke være et token, skrives grunden i testens `REJECTED`-liste.
9. **Delekort og ikoner tegnes ikke — de genereres.** Kilden er
   `tools/social/card.html`; `npm run social` bygger dem (starter selv en
   Vite-server; kræver ImageMagick). Ændrer du navn, undertitel, palet eller
   Karl-tegningen, så kør scriptet igen og commit resultatet. Ret ALDRIG en
   PNG i public/ i hånden — den bliver forældet uden at nogen opdager det,
   fordi ingen ser sit eget delekort. Se `DESIGN.md` §7.
10. **Visuelt arbejde dømmes, ikke gættes.** Kør en frisk capture + måling og
    se render, 50/50-overlay og heatmap, før en visuel ændring accepteres.
    `tests/visual-baseline.json` er en commit-identificeret, accepteret
    måling; den må kun opdateres efter en ny rigtig kørsel og menneskeligt
    gennemsyn. `npm run test:visual` er langsom og opt-in, bruger den rigtige
    capture/metrics-pipeline og fejler, hvis et regions-overall eller ét af de
    fem aspekter falder mere end 0,02. Den må aldrig flyttes ind i `npm test`s
    hurtige sti.
11. **Kernen har aldrig netværk.** Samme state + input skal give samme id,
    tags, løsning og turforbrug uden Worker. En model må kun forbedre
    `name`/`flavor` via UI-laget; den må aldrig levere `kind`, `stuff`,
    `traits`, `scale`, `solves`, flags, age-up eller ending.
12. **Improvisation er production-off indtil ekstern gate.** Pages-kontrakten
    skal tvinge den offentlige root til `VITE_IMPROVISE_ENABLED=false`.
    Den må gerne bygge den særskilte, unlisted
    `/playtest/improvisation/`-kandidat med flaget `true`, men både
    `VITE_IMPROVISE_URL` og `VITE_NARRATOR_URL` skal tvinges tomme i **begge**
    builds. Previewet er ikke production-enable. Root må først vurderes
    aktiveret, når 5–10 engelsktalende deltagere på tværs af crafting-game-
    og low-game-experience-grupper har spillet uden forklaring, og evidensen
    er dokumenteret.
13. **Synlig fortællertekst og faktisk lyd er samme beat.** En replik uden MP3
    må aldrig lade den forrige lyd fortsætte. Den siges med exact-text
    browser-TTS eller markeres ærligt text-only, og `npm run audit:narration`
    skal bevise start/complete-rækkefølgen over spilstart og kombinationer.
14. **Produktformål før implementering.** Enhver spiller-vendt capability har
    current truth, approved target, kvalitativ acceptance og lifecycle/gate i
    `docs/product/capabilities.json`. Brug kontekstkompilatoren før ændringen.
    En target-state er ikke shipped behavior, og Graphify må aldrig omskrive
    produktets autoritet.

## Tone (til indholdsarbejde)

- Fortælleren: sarkastisk, teatralsk, aldrig ondskabsfuld — grin *med* spilleren.
- Flavor: varm, tør humor; Karl er elskelig inkompetent.
- Noter: faktuelt korrekte, "sjov viden", aldrig belærende.
