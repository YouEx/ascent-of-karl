# Kolde Karl (Coldcarl) — notes for Claude sessions

## Styrende reference

`PRD.md` i roden er den styrende reference for al udvikling. Læs relevante
afsnit før du ændrer mekanik, indhold eller struktur. Udviklingsplanen
(PRD §6) følges step for step — gå ikke videre før et steps Definition of
Done er mødt.

## Stack

- TypeScript + Vite (web-first). Godot-sporet fra PRD §4.1 er stadig åbent
  som beslutning, men web-stacken er valgt som udgangspunkt: prototypen var
  web, CI kan bygge og teste den, og den kan senere pakkes til mobil/desktop
  (Capacitor/Tauri). Genåbn kun beslutningen med Martin.
- Node 22 (`.nvmrc`) — brug samme version lokalt som i CI.
- Tests: vitest (unit), validator: `tools/validate.py`.

## Kommandoer

- `npm run dev` — dev-server
- `npm run typecheck` — TypeScript-check
- `npm test` — unit tests
- `npm run validate` — indholdsvalidering (kører også i CI)
- `npm run build` — typecheck + produktion-build

## Ufravigelige principper

- **Alt indhold er data.** Elementer, kombinationer, replikker, flags og
  akter ligger i `/content` som JSON — aldrig hardcodet i `/src`. En
  skribent skal kunne tilføje en komplet opdagelse uden at røre kode.
- **Validator skal være grøn.** Kør `npm run validate` efter enhver
  indholdsændring; CI blokerer på fejl.
- **Historiske noter kræver `kilde_url`** og skal være faktuelt korrekte.
- Kombinationer er uordnede (a+b == b+a) og et element kan kombineres med
  sig selv.
- Fortæller-replikker skrives på dansk med tør, sarkastisk — aldrig
  ondskabsfuld — tone (PRD §3.3). AI-førsteudkast er ok, men markér dem
  tydeligt til håndredigering.

## Struktur

- `src/core` — kombinationsmotor, flags, save/load (ren logik, ingen DOM)
- `src/narrator` — trigger-system og prioritering (PRD §2.4)
- `src/acts` — akt-styring, problemer, age-up
- `src/ui` — al rendering
- `content/` — elements.json, combos.json, narrator/*.json, acts/*.json
- `tools/validate.py` — indholdsvalidering

## GitHub Actions

- Ingen `schedule:`-triggers uden eksplicit aftale med Martin.
- Behold `concurrency: cancel-in-progress` på push/PR-workflows.
