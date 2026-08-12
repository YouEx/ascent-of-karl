# The Ascent of Karl — udviklerguide

Læs `PRD.md` først — det er den styrende reference for al udvikling.

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
npm run validate     # indholdsvalidering (python3 tools/validate.py)
npm run build        # typecheck + produktion-build
```

## Arkitektur

- `src/core/` — kombinationsmotor, flags, save/load. **Ren og deterministisk**:
  ingen DOM, ingen tilfældighed, ingen indholdskendskab.
- `src/narrator/` — trigger-prioritering (story > adfærd > flags > generisk),
  tællere, hint-eskalering, no-repeat. Kender kun `Engine` og content-typerne.
- `src/ui/` — al DOM og præsentation. Kun UI må røre `document`/`localStorage`.
  `tokens.css` = designsystemets variabler, `style.css` = brugen af dem,
  `icons.ts` = stregikoner til krommet, `art.ts` = malet elementkunst (slår
  element-id op mod udskårne billeder i `src/assets/art/elements/`, falder
  tilbage til content-emoji hvis ingen findes), `playtest.ts` = logger
  blindgyder og afsluttede runs lokalt (`docs/playtest/`).
- `src/assets/` — skrifter og grafik Vite skal hashe. `public/` er for filer der
  skal have et forudsigeligt navn (lyd, manifest, `karl.webp`, delekort og ikoner).
- `src/content.ts` — samler content-filerne. Eneste fil der importerer JSON.
- `content/` — ALT indhold: elementer, kombinationer, akter, replikker.
  **Indhold må aldrig hardcodes i kode** (PRD §4.1).
- `tools/validate.py` — indholdsvalidering, kører i CI.
- `tools/social/` — delekort og app-ikoner. Genereres, redigeres aldrig i hånden.
- `tools/art/` — element- og kromkunst skåret ud af Martins referencebilleder
  i `docs/design/reference/`. `npm run art` kører de deterministiske scripts
  i rigtig rækkefølge (se `build_all.py`'s docstring for hvilke der er
  udeladt og hvorfor). Genereres, redigeres aldrig i hånden — ret referencen
  eller udskæringen i scriptet, aldrig den udskrevne webp.
- `docs/design/reference/` — Martins referencebilleder. Kilden til paletten;
  farver samples som regionsmedianer, aldrig som enkelt-pixels.
- `plan/` — implementeringsplaner for større visuelle/strukturelle spor.

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

## Tone (til indholdsarbejde)

- Fortælleren: sarkastisk, teatralsk, aldrig ondskabsfuld — grin *med* spilleren.
- Flavor: varm, tør humor; Karl er elskelig inkompetent.
- Noter: faktuelt korrekte, "sjov viden", aldrig belærende.
