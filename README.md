# Kolde Karl ❄️

*Infinite Craft møder The Stanley Parable i menneskehedens historie.*

Du kombinerer elementer for at genopfinde civilisationens milepæle — mens en
sarkastisk fortæller kommenterer alle dine valg. Dine dumme beslutninger
(larver i stedet for stegt kød) bliver til historie-grene i stedet for fejl.

📖 **[PRD.md](PRD.md)** er den styrende reference for al udvikling.
🛠 **[CLAUDE.md](CLAUDE.md)** har kodestandarder og arkitektur.

## Kom i gang

```bash
npm install
npm run dev        # åbn den viste URL i browseren
```

## Udvikling

```bash
npm test           # unit tests af motor + fortæller
npm run validate   # indholdsvalidering (kræver python3)
npm run build      # typecheck + produktion-build
```

## Status

- [x] Step 0 — projektopsætning, stack-beslutning (TypeScript/Vite, se CLAUDE.md), CI
- [x] Step 1 — data-drevet kombinationsmotor med flags, solves, save/load + tests
- [x] Step 2 (v1) — fortæller-system: trigger-prioritering, adfærdstællere,
      flag-hukommelse, hint-eskalering, no-repeat
- [x] Step 3 (v1) — problemer, blødt age-up-gate, Akt I → Akt II-overgang
- [x] Bogen v1 — leksikon med forgrenet tidslinje (collapsed som default),
      blanke sider som stiplede silhuetter, drag-and-drop (`docs/design/bogen.md`)
- [x] Fortæller v2 — engelsk stemme i taleboble med mute, 5+ varianter pr.
      nøglebeat, playthrough-seed, nye triggers (sweep/hurtig/langsom) og
      AI-udkast-pipeline (`docs/design/fortaelleren.md`, `tools/generate_lines.py`)
- [x] Fortæller-audio — pre-genereret scratch-voice (Edge TTS, 168 filer,
      ~9 MB) med manifest, ducking og autoplay-håndtering
      (`tools/generate_audio.py`)
- [ ] Step 4 — vertical slice: art, lyd, voice, polish
- Akt I er spilbar med 23 elementer, 15 kombinationer og 150+ fortæller-varianter
