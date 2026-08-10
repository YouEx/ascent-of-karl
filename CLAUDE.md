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
  `icons.ts` = stregikoner til krommet.
- `src/assets/` — skrifter og grafik Vite skal hashe. `public/` er for filer der
  skal have et forudsigeligt navn (lyd, manifest, `karl.webp`, og OG-billedet).
- `src/content.ts` — samler content-filerne. Eneste fil der importerer JSON.
- `content/` — ALT indhold: elementer, kombinationer, akter, replikker.
  **Indhold må aldrig hardcodes i kode** (PRD §4.1).
- `tools/validate.py` — indholdsvalidering, kører i CI.

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
   emoji må kun komme fra `content/*.json` (aldrig i krom — brug `src/ui/icons.ts`),
   og okker der bærer tekst eller fokus skal være `--ochre-ink`, ikke `--ochre`.

## Tone (til indholdsarbejde)

- Fortælleren: sarkastisk, teatralsk, aldrig ondskabsfuld — grin *med* spilleren.
- Flavor: varm, tør humor; Karl er elskelig inkompetent.
- Noter: faktuelt korrekte, "sjov viden", aldrig belærende.
