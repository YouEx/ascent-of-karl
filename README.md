# The Ascent of Karl

*reinvent history, badly*

*Infinite Craft møder The Stanley Parable i menneskehedens historie.*

Du kombinerer elementer for at genopfinde civilisationens milepæle — mens en
sarkastisk fortæller kommenterer alle dine valg. Dine dumme beslutninger
(larver i stedet for stegt kød) bliver til historie-grene i stedet for fejl.

📖 **[PRODUCT.md](PRODUCT.md)** er den styrende reference for produktretning;
**[PRD.md](PRD.md)** bevarer detalje og historik.
🛠 **[CLAUDE.md](CLAUDE.md)** har kodestandarder og arkitektur.

Fortælleren kan valgfrit skrive replikker live via en model (se
`plan/feature-live-narrator-1.md`) — slået fra som default, og komplet uden
den. Er den nogensinde slået til, er opskriften
[docs/deployment/live-narrator.md](docs/deployment/live-narrator.md).

## Improvisation: Source Complete — External Playtest Pending

Kilden er færdig: deterministiske offline-opfindelser, atomisk Engine-flow,
canonical prioritet, cap **6**, pris **én sommer**, narrator-dom,
feature-gated UI/Chronicle/playtest v2, valgfri copy-only Worker-rute, sikker
snapshot-høst og robust balancecheck.

**Produktion er ikke aktiveret.** Pages-buildet tvinger den eksisterende
offentlige root til feature-off. Samme artifact rummer en særskilt, unlisted
offline-kandidat:
<https://youex.github.io/ascent-of-karl/playtest/improvisation/>. Kun dér er
produktflaget `true`; både improvisations- og live-fortæller-URL tvinges tomme
i begge builds. Kandidaten foretager derfor nul Worker-kald og bruger ingen
secrets eller betalt trafik. Det er ikke production-enable.

Tre agent-QA-runs fandt ingen source-defekt, men tæller ikke som
ekstern-human evidens. Næste handling er **5–10 engelsktalende deltagere**
fra både crafting-game- og low-game-experience-grupper, som spiller uden
forklaring. Produktionsflaget forbliver slukket indtil da. Se
`plan/feature-improvised-solutions-1.md` og
`docs/playtest/task-030-improvisation-agent-qa-2026-08-13/`.
Den eksterne playtestgate er fortsat åben.

## Kom i gang

```bash
npm install
npm run dev        # åbn den viste URL i browseren
```

Improvisation kan prøves lokalt uden netværk:

```bash
env -u VITE_IMPROVISE_URL VITE_IMPROVISE_ENABLED=true npm run dev
```

Det er den komplette mekanik med deterministisk fallback-copy. En Worker-URL
er ikke nødvendig for lokal produkt-QA.

## Udvikling

```bash
npm test           # unit tests af motor + fortæller
npm run validate   # indholdsvalidering (kræver python3)
npm run improvise:report:check
npm run playtest:evidence:check
npm run build      # typecheck + produktion-build
npm run build:pages  # root off + indlejret offline playtest
npm run verify:pages # verificér et bygget Pages-artifact
```

## Tilføj et element uden at skrive en replik

Fortælleren har en komplet offline-trelagsmodel under de håndskrevne øjeblikke:
bagt replik → grammatik → generisk nødudgang. Det nederste brugbare lag er en
**grammatik, der taler ud fra taksonomien** frem for ud fra elementnavne
(`docs/design/fortaelleren.md`, "Trelagsmodellen"). Derfor kan et nyt element få
kommentarer fra dag ét, uden at nogen skriver en linje tekst til det. Det
valgfrie live-lag kan lægges mellem bagt og grammatik, men ændrer ikke workflowet.

1. Tilføj elementet i `content/elements.json` med `kind`, `stuff`, `scale` og
   mindst ét `trait` — alle fire skal findes i `content/taxonomy.json`. Skriv
   også `flavor`; validatoren advarer uden den, og grammatikken læser den.
2. Tilføj mindst én kombination i `content/combos.json`. Er elementet en
   opdagelse, skal det have en historisk `note`.
3. `npm run validate` — den fejler på ukendte tags, dinglende id'er og
   blindgyder, og fortæller hvad der mangler.

Der er ikke noget trin 4. Fejler man med det nye element, siger fortælleren
noget, der nævner begge ting og passer til motorens dom. Vil man have en
*bedre* replik til et bestemt par, kan den bages senere med
`tools/prepare_pairs.ts` → `tools/assemble_pairs.py`, men det er en forbedring,
ikke en forudsætning.

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
- [x] **Akt I komplet** (se `ROADMAP.md` + `docs/design/act-1.md`):
      187 elementer, **409 canonical kombinationer** og 15 skæbner
- [x] Skæbne-gate: slutninger kræver 14 opfindelser, så et første run ikke
      kan slutte efter fire kombinationer (`docs/design/act-1.md`)
- [x] Research-superset: 14.913 opskrifter fra genren som idébank
      (`docs/research/`), adoption spores i `STATUS.md`
- [x] Story-grafer (`docs/design/act-1-graf.md`, auto-genereret) og
      GitHub Pages-deploy-workflow
- [x] Mobil-først UI (`docs/design/ui-mobile.md`): titelskærm, fast
      værksteds-dock i tommelfinger-zonen, bogen som sheet, søgning i
      griddet, frontier-tidslinje
- [x] Improvisationens source-implementering og agent-QA; production-off
- [ ] Ekstern improvisationsplaytest: 5–10 explanation-free engelsktalende
      deltagere i de to krævede erfaringsgrupper
- [ ] Step 4 — vertical slice: art, lyd, voice, polish (se `ROADMAP.md`)
