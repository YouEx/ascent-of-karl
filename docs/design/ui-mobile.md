# UI & UX — mobil-først

*Designdokument, supplement til `bogen.md`. Besluttet 2026-08-05 efter
research af mobile UX-patterns og en gennemgang af skærmbilleder fra det
daværende UI.*

## Problemerne vi løste

Skærmbillederne af det gamle UI viste fire konkrete fejl:

1. **Tidslinjen skalerede ikke.** 92 noder, heraf 81 uopdagede: en mur af
   spørgsmålstegn med krydsende kanter. Designet virkede ved 15
   kombinationer, ikke ved 95.
2. **Dublerede ikoner.** Stick/Log delte 🪵, Mud/Planks delte 🟫, Dry
   grass/Wild grain delte 🌾 — ulæseligt i et grid med snesevis af kort.
3. **Mobil-headeren brækkede**: akt-navnet ombrød ét ord pr. linje.
4. **Ingen hovedmenu.** Spillet startede direkte, uden titelskærm,
   Fortsæt-mulighed eller sted at se skæbner før man går i gang.

## Research: hvad virker på mobil

- **Tommelfinger-zonen er nederste tredjedel.** Omtrent halvdelen af brugere
  navigerer enhåndet med tommelfingeren; toppen af skærmen kræver greb-skift.
  Primære handlinger hører nederst ([Parachute Design][thumb],
  [Elaris][elaris]).
- **Bund-navigation/sticky CTA er standarden** for hyppige handlinger og
  bør ligge permanent i bunden ([UXPin][uxpin], [Design Studio][dsuiux]).
- **Touch-targets: min. 44×44 pt (Apple HIG) / 48 dp (Material), 8 pt
  afstand** ([LogRocket][logrocket], [TetraLogical][tetra]).
- **Store inventories kræver søgning.** Little Alchemy 2 løser 700
  elementer med søgefelt og alfabet-spring; Infinite Craft med et
  søgbart sidepanel ([Poki-guide][poki]).

## Beslutninger

### Layout: én DOM, to arrangementer

Kilden er én DOM; CSS arrangerer den forskelligt. Ingen dublering af markup.

**Mobil (< 820 px)**
- Header (sticky, kompakt: titel, ⏳-tæller, 📖/🏆/↺ som ikon-knapper)
- ~~Fortæller-boblen (sticky under headeren — den er spillets stemme og må
  aldrig scrolle væk)~~ **Ophævet 2026-08-14 (Martin).** Boblen blev til den
  levende krønike: et opslag på to sider, 384 px højt på 390×844. Klæbede det,
  lå det oven på element-griddet og opslugte tryk på brikkerne — Playwright
  fangede det som "subtree intercepts pointer events". Krøniken følger derfor
  siden i flow på mobil. Prisen er accepteret bevidst: griddet begynder under
  folden, og spilleren scroller ned til brikkerne. Stemmen er stadig det første
  man møder, den er bare ikke længere pinned.
- Problem-chips, søgefelt (sticky), element-grid (scroller)
- **Docken**: værkstedet (2 slots + Kombinér) er `position: fixed` i
  bunden — altid i tommelfinger-zonen, med `env(safe-area-inset-bottom)`
- **Bogen** åbnes som fuldskærms-sheet via 📖 (badge viser antal opdagelser)

**Desktop (≥ 820 px)**: bogen er inline igen, docken ligger i flow over
griddet, og 📖-knappen skjules. Rækkefølgen styres af `order`.

### Interaktion
- Drag er primær; slip på et element kombinerer straks, slip i en slot
  lægger elementet der. Tap-tap + Kombinér er stadig fallback, og tryk på
  en fyldt slot tømmer den.
- Alle interaktive flader er mindst 48 px; grid-kort er 76 px høje.
- Søgefeltet bruger 16 px skrift, så iOS ikke zoomer ved fokus.

### Element-grid
- Søgning på navn + filteret **✨ New** (kun opdaget i denne session).
- Nye opdagelser markeres med ✨ indtil de bruges — så de kan findes i et
  grid med snesevis af kort.
- Ikoner skal være unikke; håndhævet af `tools/validate.py`.

### Tidslinjen: progressive disclosure
I stedet for at vise alle uopdagede elementer viser bogen nu:

- alle **opdagede** noder med deres forbindelser, og
- **frontier**: de uopdagede der kan nås med ÉN kombination af det
  spilleren allerede har (respekterer flag-krav), tegnet som stiplede
  silhuetter med teksten *"within reach"*, og
- en optælling af resten: *"N more discoveries lie further out."*

Det bevarer "retning uden spoilers" fra `bogen.md`, men gør hvert
spørgsmålstegn til et konkret, opnåeligt mål i stedet for støj — og
grafen skalerer, når akten vokser mod 200+ kombinationer.
Logikken er ren og testet (`src/core/timeline.ts`).

### Titelskærm
Vises ved indlæsning: titel, tagline, **Continue** (hvis der er et save),
**New life**, **🏆 Fates n/8** og et interaktions-hint. Bonus: klikket er
den første brugerinteraktion, hvilket låser browserens autoplay op, så
fortællerens intro-replik kan afspilles med lyd.

## Ikke i denne version

- Alfabet-spring/kategorier i griddet (søgning dækker indtil videre)
- Gruppering af tidslinjen pr. spor (bolig, transport, kunst …)
- Haptik på mobil, swipe-gestus til at lukke bogen
- Landscape-specifikt layout til tablets

[thumb]: https://parachutedesign.ca/blog/thumb-zone-ux/
[elaris]: https://elaris.software/blog/mobile-ux-thumb-zones-2025/
[uxpin]: https://www.uxpin.com/studio/blog/mobile-navigation-patterns-pros-and-cons/
[dsuiux]: https://www.designstudiouiux.com/blog/mobile-navigation-ux/
[logrocket]: https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/
[tetra]: https://tetralogical.com/blog/2022/12/20/foundations-target-size/
[poki]: https://poki.com/en/g/little-alchemy-2
