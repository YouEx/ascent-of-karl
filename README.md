# Kolde Karl (Coldcarl)

Et story-drevet alchemy-spil med en sarkastisk fortæller.
*Infinite Craft møder The Stanley Parable i menneskehedens historie.*

Se **[PRD.md](PRD.md)** for vision, mekanik og udviklingsplan.
`CLAUDE.md` beskriver kodestandarder og arbejdsgang.

## Kom i gang

```bash
nvm use          # Node 22
npm install
npm run dev      # dev-server
```

## Kvalitetstjek

```bash
npm run validate   # indholdsvalidering (content/*.json)
npm run typecheck
npm test
npm run build
```

## Status

Step 0 (projektopsætning) — struktur, content-pipeline-skema, validator og
CI er på plads med seed-indhold for Akt I. Næste: Step 1, kombinationsmotor
med prototypens kapitel 1-indhold som testdata.
