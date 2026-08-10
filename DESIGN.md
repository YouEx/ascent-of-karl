# Design System: The Ascent of Karl

*Styrende reference for alt visuelt arbejde. Implementeret i `src/ui/tokens.css` —
dokumentet og token-filen skal altid stemme overens. Ændrer du en farve her, ændrer
du den samme token dér, og omvendt.*

Afledt af Martins referencebillede (10-08-2026): pastel morgengry, håndtegnet Karl,
editorial serif, cremefarvet knap. Ophæver den midlertidige "hulemaleri"-æstetik fra
`docs/design/ui-mobile.md` (mørk læder/brun) — den var altid markeret som midlertidig.

---

## 1. Visuel atmosfære

**En oplyst bog trykt på en forårsmorgen.** Baggrunden er et blødt daggry, der falder
fra kold himmelblå øverst til varm rosa nederst — aldrig fladt, aldrig neon. Ovenpå
ligger papir: cremefarvede flader med hårfine blækkanter, som sider lagt på et bord.
Karl selv er håndtegnet med tyk tuschkontur, og hans streg må aldrig blive glat eller
vektor-ren. Kontrasten mellem det luftige daggry og den tørre, blækagtige typografi
*er* spillets vittighed: fortælleren taler som en pompøs dokumentarist, mens der sidder
en mand på jorden og gnider to sten mod hinanden.

| Akse | Niveau | Konsekvens |
|---|---|---|
| **Density** | 4 (Daily App Balanced) | Titelskærmen er luftig; element-griddet er tættere, fordi opdagelse kræver overblik. |
| **Variance** | 7 (Offset Asymmetric) | Hero er delt, ikke centreret. Karl bryder ud af sin spalte. |
| **Motion** | 5 (Fluid) | Fjedrende, kort, aldrig lineær. Fejring ved fund, ro alle andre steder. |
| **Creativity** | 9 | Båndene, kornet og den håndtegnede streg er ikke pynt — de er brandet. |

**Følelsen der skal rammes:** man har lyst til at røre ved skærmen, og man forventer
at blive gjort mildt til grin.

---

## 2. Farvepalette & roller

Alle værdier er hentet direkte fra referencebilledet med pixelsampling — ikke gættet.

### Lærredet (baggrunden, aldrig indhold)
- **Dawn Blue** `#C9DEFA` — daggryets kolde top
- **Lilac Haze** `#DED8F4` — overgangen på midten
- **Blush Pink** `#F8CCD6` — den varme underkant
- **Warm Mist** `#FDEFEC` — lyseste hjørne, nederst til højre

Lærredet er én sammenhængende gradient over hele viewporten (`--canvas`). Sektioner
får **ikke** hver sin baggrundsfarve — de ligger på det samme daggry.

### Papiret (flader der bærer indhold)
- **Bone Paper** `#F5F3EA` — knapper, kort, paneler, bogen. Den varme creme fra
  referencens knap.
- **Chalk** `#FBFAF6` — hævet flade oven på papir (modal over kort)
- **Paper Edge** `#E7E2D3` — papirets egen kant, faner, inaktive flader

### Blækket (tekst og streg)
- **Ink** `#16151A` — primær tekst og konturer. Referencens faktiske overskriftsfarve.
  **Aldrig `#000000`.**
- **Slate Ink** `#55535F` — sekundær tekst, metadata, hjælpetekst
- **Faint Rule** `rgba(22, 21, 26, 0.14)` — 1px strukturlinjer og papirkanter
- **Ink Veil** `rgba(22, 21, 26, 0.42)` — modal-underlag (ikke sort, ikke uigennemsigtigt)

### Accent (én, og kun én — i to læsbarhedstrin)
- **Ochre** `#A9722B` — kanter, rammer, prikker, stråler, valgt-tilstand.
  Mætning 74 %, altså under loftet på 80 %. **Kun til flader og streger.**
- **Ochre Ink** `#7A531F` — samme kulør, mørkere. **Alt der er tekst eller
  fokusfelt.** Undertitlen, badge-fyld, kickers, aktive chips, `:focus-visible`.

Hvorfor to: `#A9722B` giver kun **3,0:1** mod pastellærredet. Det er nok til en
streg (AA kræver 3:1 for ikke-tekst), men dumper for bogstaver. `#7A531F` rammer
**≥4,7:1 mod hvert eneste lærredsstop** og 6,5:1 på papir. Reglen er mekanisk:
*bærer den bogstaver eller markerer den fokus, er den `--ochre-ink`.*

Referencens egen CTA er cremefarvet med blæktekst — **tilbageholdenhed er accenten**.
Ochre bruges til at vise *tilstand*, ikke til at råbe. En knap bliver ikke okker,
fordi den er vigtig; den bliver okker, fordi den er aktiv.

### Tilstandsfarver (afvigelse fra "max 1 accent" — bevidst og afgrænset)
Et spil har tilstande en hjemmeside ikke har: et problem er løst eller ej, en frist
løber, en skæbne har en tone. De her fire er **semantik, ikke dekoration**, og må kun
bruges til den betydning de er defineret med:

- **Moss** `#4F7A45` — løst problem, lykkelig slutning
- **Rust** `#A24B37` — frist der løber, tragisk slutning
- **Plum** `#6B4E96` — vanvittig slutning
- **Bronze** `#8A6A3B` — bittersød slutning, sjælden opdagelse

### Illustrationslaget (kun i grafik — aldrig i UI)
Båndene og Karl må aldrig låne farve til en knap, og en knap må aldrig låne deres.

- **Ribbon Sky** `#A3CDFD` · **Ribbon Cyan** `#8FD9EE` · **Ribbon Rose** `#FAB3E7`
- **Karl's Gold** `#FED831` — Karls hår. Spillets mest mættede farve, netop derfor
  forbeholdt ham.

---

## 3. Typografi

**Regelen der bærer resten:** *serif er fortællerens verden, sans er spillerens værktøj.*
Fortælleren, titler og bogens prosa sættes i Fraunces. Alt spilleren *betjener* —
knapper, faner, etiketter, tællere — sættes i Plus Jakarta Sans. Man kan høre forskel
på, hvem der taler.

- **Display / narrativ:** **Fraunces** (variabel: `opsz`, `wght`, `SOFT`, `WONK`).
  Bogtrykt, en anelse skæv, varm. `WONK` skrues op på titlen og ned i brødtekst.
- **UI / brødtekst:** **Plus Jakarta Sans** (variabel). Geometrisk-humanistisk, rund
  uden at være barnlig.
- **Tal:** ingen tredje font. `font-variant-numeric: tabular-nums` på tællere, så
  "Summer 9/50" ikke hopper.
- **Begge selvhostes** via `@fontsource-variable` — spillet skal kunne køre offline
  og uden CDN-kald (PRD §5).

### Skala (`clamp()`, aldrig faste px på overskrifter)
| Rolle | Størrelse | Font | Tracking |
|---|---|---|---|
| Hero-titel | `clamp(2.75rem, 8.5vw, 5.5rem)` | Fraunces 600, WONK 1 | `-0.02em` |
| Sektionstitel | `clamp(1.5rem, 4vw, 2rem)` | Fraunces 600 | `-0.015em` |
| Fortæller | `clamp(1rem, 2.4vw, 1.15rem)` kursiv | Fraunces 400 | `0` |
| Brødtekst | `1rem` / leading 1.55 | Jakarta 400 | `0` |
| UI-etiket | `0.875rem` | Jakarta 500 | `0` |
| Kicker | `0.72rem` VERSALER | Jakarta 600 | `0.16em` |

- Brødtekst maks. **65 tegn** pr. linje (`--measure`).
- Hierarki skabes med **vægt og farve** før størrelse.
- Aldrig gradient-tekst. Aldrig `text-shadow` som effekt.

---

## 4. Komponenter

**Knapper.** Cremefarvet flade (`Bone Paper`), 1px blækkant, blæktekst, radius 12px —
præcis referencens knap. Primær og sekundær adskilles af **vægt og kant**, ikke af
farve: primær har fuld blækkant og medium vægt, sekundær har `Faint Rule` og normal
vægt. Aktiv tilstand giver 1px nedadgående forskydning (taktilt tryk). Ingen ydre
glød. Ingen farvede skygger. Minimum 44px berøringsflade.

**Kort og paneler.** `Bone Paper` på lærredet, radius 16px, hårfin kant og en blød,
**lilla-tonet** skygge (`0 6px 24px rgba(58,44,84,0.10)`) — skygger tones altid mod
baggrundens kulør, aldrig mod neutral grå.

**Element-fliser (griddet).** Papirflade, radius 12px, emoji over navn. Valgt flise
markeres med okker kant + indre okker hårlinje — begge valgte slots markeres, ikke
kun den sidst rørte. Ny opdagelse markeres i hjørnet.

**Fortællerboblen.** Papir med hale der peger ud af skærmen (op mod højre hjørne).
Kursiv Fraunces. Mutet tilstand: 55 % opacitet og stiplet kant — stadig læsbar, tydeligt
slukket.

**Bogen.** Varmere papir end resten (`Bone Paper` mod `Paper Edge`-faner), indre skygge
langs falsen. Bogen er det eneste sted, hvor brødtekst må sættes i serif.

**Overlejringer.** Underlag `Ink Veil`, aldrig ren sort. Alle overlejringer går gennem
`openOverlay()` (`src/ui/overlay.ts`) og arver dermed: baggrundsklik, Esc, browser-back,
fokusfælde og scroll-lås. Se `docs/design/ux-checklist.md` — **ingen blindgyder.**

**Tomme tilstande.** Sammensat sætning i fortællerens stemme ("Nothing matches that.
Karl checked twice."), aldrig "Ingen resultater".

---

## 5. Layout

- **Hero er delt, ikke centreret:** tekst i venstre spalte, Karl i højre, med Karl
  brydende ud over sin spaltekant. Under 900px falder han **under** teksten — aldrig
  bag den.
- **CSS Grid** til struktur. Ingen `calc()`-procentmatematik.
- **Ingen overlap:** tekst må aldrig lægges oven på Karl eller på et bånd med detaljer.
  Båndene passerer bag indholdet i deres eget lag.
- Fuld højde er altid `100dvh` — aldrig `100vh` (iOS Safari springer).
- Indholdsbredde begrænses: spil 760px, hero 1240px.
- **Mobil-først kollaps under 768px:** alt bliver én spalte. Ingen vandret scroll
  nogensinde — det er en kritisk fejl, ikke en skønhedsfejl.
- Handlingsknapper bliver i tommelfinger-zonen på mobil (docken), jf.
  `docs/design/ui-mobile.md`.

---

## 6. Bevægelse

- **Fjeder-følelse, ikke lineær:** `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`
  til noget der dukker op, `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` til alt andet.
- Varigheder: `120ms` (tryk) · `220ms` (overgang) · `420ms` (fejring).
- **Kun `transform` og `opacity`.** Aldrig `top`, `left`, `width`, `height`.
- **Fejring skaleres med sjældenhed** (`docs/design/sjaeldenhed.md`): almindelig
  opdagelse popper stille, sjælden får stråler, unik får halo. Larm er en belønning,
  ikke en standard.
- Kornet ligger på ét `position: fixed` pseudo-element med `pointer-events: none`
  — aldrig som gentaget baggrund på mange elementer.
- **`prefers-reduced-motion` er ufravigelig:** al bevægelse slukkes, men information
  må aldrig gå tabt — sjældenhed vises da som statisk glød i stedet for puls.

---

## 7. Anti-mønstre (forbudt)

- ❌ Ren sort `#000000` — brug `Ink`
- ❌ Inter, Georgia, Times New Roman og system-serif
- ❌ Neon, ydre glød, farvede skygger, gradient-tekst
- ❌ Mere end én accentfarve i UI (tilstandsfarverne er semantik, ikke undtagelser)
- ❌ Centreret hero
- ❌ Overlappende elementer og absolut-positioneret tekst oven på illustration
- ❌ Tre lige brede kort på række
- ❌ Cirkulære spinnere — brug skeletter i indholdets egne mål
- ❌ Fyldtekst: "Scroll ned", pilehop, "Swipe"
- ❌ Opdigtede tal og statistik. Tællere viser rigtig spiltilstand eller ingenting
- ❌ Vandret scroll på mobil
- ❌ **Emoji i UI-krom** — ingen emoji i knaptekster, faner eller etiketter.
  *Undtagelse:* emoji som **indhold** (elementernes og skæbnernes ikoner fra
  `content/*.json`) er spillets illustrationssprog og er tilladt. Skellet er:
  kommer tegnet fra indholdet, er det kunst; skriver vi det i en knap, er det slop.
