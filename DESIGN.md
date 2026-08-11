# Design System: The Ascent of Karl

_Styrende reference for alt visuelt arbejde. Implementeret i `src/ui/tokens.css` —
dokumentet og token-filen skal altid stemme overens. Ændrer du en farve her, ændrer
du den samme token dér, og omvendt._

Afledt af Martins referencebillede **`docs/design/reference/target-2026-08-11.webp`**
(11-08-2026). Alle farver er pixelsamplet som **regionsmedianer** fra den fil — ikke
gættet, ikke smagt frem. Metoden er gengivet i §2, så enhver kan efterprøve dem.

> **Migrationsstatus (11-08-2026).** Dette dokument beskriver **målbilledet**.
> `tokens.css` indeholder både målpaletten og den forrige pastelpalet, fordi
> komponenterne stadig er koblet til den sidste. Koblingen flyttes i
> `plan/design-visual-target-1.md` fase 2-5. Reglen "dokument og token skal stemme
> overens" er derfor opfyldt i den retning der betyder noget: **alt dette dokument
> nævner, findes som token.**
>
> Pastel-tokens ligger mellem `LEGACY START` og `LEGACY SLUT` i `tokens.css` og
> slettes **samlet** når sidste komponent er flyttet. Alt uden for det spænd er
> permanent. `--rust` er den ene undtagelse: navnet er permanent, men værdien er
> stadig pastellens `#a24b37`, fordi tokenet er live fire steder i `style.css`.
> Den varme afløser hedder `--rust-warm` og kobles på i fase 2-5.
>
> **Kendt brud der rettes samtidig:** `style.css` hardkoder `rgba(162, 75, 55, 0.18)`
> i `ch-pulse` (to steder) i stedet for at bruge tokenet — et brud på §8's
> "farve uden token" som ligger i koden i dag.

---

## 1. Visuel atmosfære

**En krønike åbnet på et bjerg ved gyldne time.** Spillet er et pergamentvindue der
svæver over et malet dallandskab: kolde blålilla skyer øverst, en varm solnedgang
i horisonten, mørke skovklædte skrænter nederst. Vinduet er papir — tan pergament
med synlig fiber, revne kanter og en hårfin lys ramme — og alt indhold ligger på
det papir som sider i en bog, der er blevet båret rundt for længe.

Karl selv er stadig håndtegnet med tyk tuschkontur, og hans streg må aldrig blive
glat eller vektor-ren. Kontrasten mellem det store, smukke, alvorlige landskab og
den tørre, blækagtige typografi _er_ spillets vittighed: fortælleren taler som en
pompøs dokumentarist over et episk vidtstrakt panorama, mens der sidder en mand på
jorden og gnider to sten mod hinanden.

**Hulemaleriet er tilbage — som ornament, ikke som æstetik.** Den mørke læder/brun-
retning fra `docs/design/ui-mobile.md` er og bliver ophævet; den var altid markeret
som midlertidig. Det der vender tilbage, er noget andet: okkerfarvede
hulemaleri-_motiver_ tegnet **på** pergamentet — jægeren med spyddet, dyrefrisen med
hjorten, Karl-flisen i titellinjen. De er blege, lavkontrast og altid dekoration.
Skellet er skarpt: hulemaleri må være **motiv på papir**, aldrig **flade under UI**.

| Akse           | Niveau                 | Konsekvens                                                                                                                         |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Density**    | 4 (Daily App Balanced) | Titelskærmen er luftig; element-griddet er tættere, fordi opdagelse kræver overblik.                                               |
| **Variance**   | 7 (Offset Asymmetric)  | Hero er delt, ikke centreret. Karl bryder ud af sin spalte. Ornamenter sidder asymmetrisk — jægeren til venstre, frisen til højre. |
| **Motion**     | 5 (Fluid)              | Fjedrende, kort, aldrig lineær. Fejring ved fund, ro alle andre steder.                                                            |
| **Creativity** | 9                      | Teksturen, ornamenterne og den håndtegnede streg er ikke pynt — de er brandet.                                                     |

**Følelsen der skal rammes:** man har lyst til at røre ved skærmen, og man forventer
at blive gjort mildt til grin.

---

## 2. Farvepalette & roller

Alle værdier er hentet fra referencebilledet med **regionsmedian**: et rektangel
lægges over fladen, og medianen af hver kanal tages. Enkelt-pixel-sampling er
forbudt her — den rammer tekst, korn eller pensselstrøg og lyver. Verificér med
`python3` + Pillow mod filen i `docs/design/reference/`.

### Lærredet (baggrunden, aldrig indhold)

Lærredet er **et malet landskab**, ikke en gradient. Billedet er kilden; farverne
herunder er dets egne, og de bruges som `background-color` **under** maleriet, så
siden aldrig blinker hvid før filen er hentet.

- **Dusk Violet** `#8983A1` — himlens kolde top
- **Dusk Rose** `#9D889E` — himlens varmere højre side
- **Haze** `#E9BDAA` — disen over horisonten
- **Sunset Glow** `#F5D9AC` — det varme lys i horisonten. Spillets lyseste punkt.
- **Valley Dark** `#3E322D` — dalens skovbund, nederste kant

Sektioner får **ikke** hver sin baggrundsfarve — de ligger alle på det samme maleri.

### Papiret (flader der bærer indhold)

Seks trin, alle varme og tan. Rækkefølgen er lyshedstrappen: jo mere en flade skal
træde frem, jo lysere er den.

- **Chronicle** `#EEE0CD` — krønikekortet, det lyseste papir
- **Parchment** `#ECDCC7` — hovedpapiret: kort, paneler, fortællerkortet
- **Tile** `#E7D3BA` — element-fliser
- **Field** `#E2CDB9` — søgefelt og andre indtastningsflader
- **Titlebar** `#DFCDBF` — titellinjen
- **Slot** `#DEC6B0` — tomme slots, det mørkeste papir

Kanter og rammer:

- **Tile Edge** `#D8BFA5` — flisernes og kortenes kant
- **Dashed** `#CBB19E` — den stiplede kant om tomme slots
- **Frame** `#CCADAB` — appvinduets hårfine lyse ramme mod landskabet

### Blækket (tekst og streg)

**Blækket er varmt.** Referencen skriver i brunsort, ikke i det kølige blåsorte, som
den forrige palet brugte. Koldt blæk på varmt pergament ser beskidt ud — det er den
enkeltændring, der flytter mest.

- **Ink** `#1A120E` — primær tekst og konturer. **13,7:1** på pergament.
  **Aldrig `#000000`.**
- **Soft Ink** `#4A3D35` — sekundær tekst, kursiv brødtekst i krøniken, metadata.
  **7,8:1** på pergament.
- **Label Ink** `#66513F` — etiketter, kickers, `THE NARRATOR`, tællernes ledetekst.
  Se advarslen nedenfor.
- **Faint Rule** `rgba(26, 18, 14, 0.14)` — 1px strukturlinjer og papirkanter
- **Ink Veil** `rgba(26, 18, 14, 0.46)` — modal-underlag (ikke sort, ikke uigennemsigtigt)

> **Etiketfælden.** Referencens egen etiketbrun er `#92745A`. Den giver **3,21:1**
> på pergament og **dumper AA for småtekst**. `Label Ink` `#66513F` er samme kulør
> og mætning, sænket i lyshed til den klarer **≥4,5:1 mod hver eneste papirflade**
> (lavest: 4,55:1 på `Slot`). Det er nøjagtig samme fælde som okkeren i den forrige
> palet — _en farve der ser rigtig ud på den lyseste flade, dumper på den mørkeste._
> Reglen er mekanisk: **bærer den bogstaver, skal den holde mod `Slot` `#DEC6B0`,
> ikke mod `Chronicle`.**

### Accent

- **Ochre** `#A9722B` — kanter, prikker, valgt-tilstand. **Kun flader og streger.**
- **Ochre Ink** `#7A531F` — alt der er tekst eller fokusfelt.
- **Ochre Tint** `rgba(169, 114, 43, 0.12)` — svag fyld bag valgt tilstand

**Navy** `#22384E` er ny og er paletten eneste kølige farve. Den bærer **akt-badgen**
og intet andet: den er den visuelle markør for _hvor i historien vi er_. Pergament på
navy giver **8,96:1**. Bruges navy til andet, holder den op med at betyde noget.

Referencens egen CTA er stadig tilbageholdende — **tilbageholdenhed er accenten**.
En knap bliver ikke okker, fordi den er vigtig; den bliver okker, fordi den er aktiv.

### Ornamentokker (kun grafik — aldrig tekst, aldrig kant)

Hulemaleri-motiverne tegnes i disse to og må ligge lavt i kontrast. De har **intet**
kontrastkrav, fordi de aldrig bærer information:

- **Ornament** `#C7A181` — jægerglyffen på fortællerkortet (1,77:1 — bevidst blegt)
- **Ornament Faint** `#DBBB9C` — dyrefrisen i krøniken (1,35:1 — næsten et vandmærke)

Er et ornament læsbart som information, er det tegnet forkert. Se §8.

### Sten (Combine-knappen)

- **Stone** `#846040` — knappens flade
- **Stone Edge** `#A88263` — den lyse facet foroven, det udskårne look
- **Stone Text** `#F4E6D2` — de "udskårne" lyse bogstaver

> **Referencen dumper på sin egen vigtigste knap.** Mockuppens Combine har cremetekst
> på `#BC9776`, hvilket er **2,18:1** — reelt ulæseligt. Det må ikke kopieres. Stenen
> er derfor mørknet til `#846040` med samme kulør og mætning, hvilket giver **4,59:1**
> og faktisk ligner _mere_ udskåret klippe end den blege tan gjorde. Motivet fra
> referencen — lyse bogstaver hugget ind i sten — er bevaret; kun lysheden er rettet.

### Tilstandsfarver (semantik, ikke dekoration)

Et spil har tilstande en hjemmeside ikke har. De her fem er **betydning** og må kun
bruges til den betydning de er defineret med:

- **Moss** `#4F7A45` — løst problem, lykkelig slutning
- **Rust** `#762214` — frist der løber, sult, tragisk slutning. **≥6,38:1** mod
  hvert papirtrin (7,78:1 på `Parchment`, lavest mod `Slot`).
- **Frost** `#182540` — kulde. **9,57:1** på `Frost Chip`.
- **Plum** `#6B4E96` — vanvittig slutning
- **Bronze** `#8A6A3B` — bittersød slutning, sjælden opdagelse

**Problem-chips farves af deres tilstand, ikke ens.** Referencen viser det tydeligt:
_Karl is freezing_ er kold og grå-blå, _Karl is hungry_ har rustrød tekst, _Bare hands_
er neutral. Chippen låner sin tekstfarve fra tilstanden og sin flade fra papiret:

- **Frost Chip** `#CFCCCE` — flade for kulde-chips (den eneste kølige papirflade)
- Sult og fare: `Rust`-tekst på `Parchment`-flade
- Neutral: `Ink`-tekst på `Parchment`-flade

### Illustrationslaget (kun i grafik — aldrig i UI)

Båndene og Karl må aldrig låne farve til en knap, og en knap må aldrig låne deres.

- **Ribbon Sky** `#A3CDFD` · **Ribbon Cyan** `#8FD9EE` · **Ribbon Rose** `#FAB3E7`
  (titelskærmens bånd omkring Karl)
- **Karl's Gold** `#FED831` — Karls hår. Spillets mest mættede farve, netop derfor
  forbeholdt ham.

---

## 3. Typografi

**Reglen:** _serif taler, sans betjener._

Referencen sætter **alt** i serif — også knapper, søgefelt og tællere. Det gør vi
ikke, og det er en bevidst afvigelse. Men den gamle regel (_"serif er fortællerens
verden, sans er spillerens værktøj"_) var for snæver: den tvang elementnavne som
_Wild boar_ og _Dry grass_ ned i UI-fonten, og de er ikke UI. De er spillets ordforråd.

Den nye regel er **mekanisk kontrollérbar** — man kan se svaret i kodebasen frem for
at diskutere det:

> **Kommer strengen fra `content/*.json` eller fra fortællerens mund? → Fraunces.**
> **Er strengen skrevet i grænsefladen? → Plus Jakarta Sans.**

| Fraunces (indhold)                      | Plus Jakarta Sans (grænseflade)       |
| --------------------------------------- | ------------------------------------- |
| Fortællerens replikker                  | Knaptekster, inkl. **Combine**        |
| Spillets titel og aktnavne              | Tællere (`1/50`, `0/174`)             |
| **Elementnavne** (`Stone`, `Wild boar`) | Søgefeltets placeholder               |
| Element-flavor og noter                 | Etiketter og kickers (`THE NARRATOR`) |
| Problem-chips (`Karl is freezing`)      | Faneblade og filtre (`New finds`)     |
| Krønikens prosa og slutningerne         | Statuslinjer og fejlbeskeder          |

Problem-chips ligger i serif, fordi de er fortællerens udsagn om Karl, ikke
kontroller — man _læser_ dem, man betjener dem ikke. Combine ligger i sans, fordi
den er ren mekanik: den er knappen der får maskinen til at køre.

- **Display / narrativ:** **Fraunces** (variabel: `opsz`, `wght`, `SOFT`, `WONK`).
  Bogtrykt, en anelse skæv, varm. `WONK` skrues op på titlen og ned i brødtekst.
- **UI / brødtekst:** **Plus Jakarta Sans** (variabel). Geometrisk-humanistisk, rund
  uden at være barnlig.
- **Tal:** ingen tredje font. `font-variant-numeric: tabular-nums` på tællere, så
  "Summer 9/50" ikke hopper.
- **Begge selvhostes** via `@fontsource-variable` — spillet skal kunne køre offline
  og uden CDN-kald (PRD §5).

### Skala (`clamp()`, aldrig faste px på overskrifter)

| Rolle                   | Størrelse                            | Font                 | Tracking   |
| ----------------------- | ------------------------------------ | -------------------- | ---------- |
| Hero-titel              | `clamp(2.75rem, 8.5vw, 5.5rem)`      | Fraunces 600, WONK 1 | `-0.02em`  |
| Spiltitel (titellinjen) | `clamp(1.35rem, 3.4vw, 2.1rem)`      | Fraunces 600         | `-0.015em` |
| Sektionstitel           | `clamp(1.5rem, 4vw, 2rem)`           | Fraunces 600         | `-0.015em` |
| Fortæller               | `clamp(1rem, 2.4vw, 1.15rem)` kursiv | Fraunces 400         | `0`        |
| Elementnavn             | `0.9rem`                             | Fraunces 500         | `0`        |
| Brødtekst               | `1rem` / leading 1.55                | Jakarta 400          | `0`        |
| UI-etiket               | `0.875rem`                           | Jakarta 500          | `0`        |
| Kicker                  | `0.72rem` VERSALER                   | Jakarta 600          | `0.16em`   |

- Brødtekst maks. **65 tegn** pr. linje (`--measure`).
- Hierarki skabes med **vægt og farve** før størrelse.
- Aldrig gradient-tekst. Aldrig `text-shadow` som effekt. _Undtagelse:_ Combine-
  knappens udskårne bogstaver må have én 1px mørk `text-shadow` nedad — det er
  relief, ikke glød, og den er defineret som token.

---

## 4. Komponenter

**Appvinduet.** Hele spillet ligger i ét afrundet vindue der svæver over landskabet:
radius `--radius-xl`, hårfin `Frame`-kant, stor blød skygge, let gennemsigtigt
pergament. Under 768px falder rammen væk og pergamentet går til fuld bredde — et
vindue med margin på en telefon er spildt plads.

**Pergamenttekstur.** Papirfladerne er ikke flade. Én sømløs fiber-tekstur lægges med
`background-blend-mode: multiply` over papirfarven, så **én fil kan bære alle seks
papirtrin**. Teksturen er diskret nok til at kontrasttallene i §2 stadig holder —
måles de ikke efter påføring, er den for kraftig.

**Knapper.** Papirflade, 1px `Tile Edge`, blæktekst, radius `--radius`. Primær og
sekundær adskilles af **vægt og kant**, ikke af farve. Aktiv tilstand giver 1px
nedadgående forskydning (taktilt tryk). Ingen ydre glød. Ingen farvede skygger.
Minimum 44px berøringsflade.

**Combine-knappen** er undtagelsen: udskåret sten (`Stone` med `Stone Edge`-facet
foroven), lyse bogstaver, chevron-ornament langs underkanten. Den løses med
CSS-gradient + SVG-ornament, **ikke som bitmap**, så den kan skifte størrelse og
tilstand (disabled/hover/active) uden nye filer.

**Kort og paneler.** Pergament på landskabet, radius `--radius-lg`, hårfin kant og en
blød skygge tonet mod baggrundens kulør — aldrig neutral grå. Fortællerkortet har
**revet kant** (SVG-maske, ikke PNG, så den skalerer og kan farves med tokens).

**Element-fliser (griddet).** `Tile`-flade, radius `--radius`, `Tile Edge`,
**illustration over navn**. Navnet er Fraunces (§3). Illustrationen er **valgfri pr.
element**: findes filen, vises den; ellers vises elementets emoji. Se §9. Valgt flise
markeres med okker kant + indre okker hårlinje — begge valgte slots markeres, ikke kun
den sidst rørte. Ny opdagelse markeres i hjørnet.

**Slots.** `Slot`-flade med **stiplet** `Dashed`-kant og en blegt aftegnet
element-silhuet i midten. Mellem de to slots sidder et cirkulært pergament-token med
plustegn. Teksten er _"Select an element"_ + _"Choose from below"_ — **aldrig
"Drag"**: drag blev bevidst fjernet 07-08-2026, fordi gestussen stjæler den lodrette
scroll i et langt grid. Referencebilledet siger "Drag or choose from below"; det er
en fælde, og teksten må ikke kopieres.

**Akt-badgen.** `Navy`-flade, pergamentfarvet tekst, lille radius, siddende halvt
ud over krønikekortets øverste kant. Det eneste sted navy må optræde.

**Fortællerboblen.** Pergament med revet kant og jægerglyffen i venstre side.
Kursiv Fraunces. Mutet tilstand: 55 % opacitet og stiplet kant — stadig læsbar,
tydeligt slukket.

**Bogen.** Varmere papir end resten, indre skygge langs falsen, malet bogillustration
frem for 📖. Bogen er det eneste sted, hvor brødtekst må sættes i serif _uden_ at
komme fra `content/*.json`.

**Problem-chips.** Papirflade, tilstandsfarvet tekst og ikon (§2). Serif.

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
- **Ingen overlap:** tekst må aldrig lægges oven på Karl, på et bånd med detaljer
  eller på et hulemaleri-ornament. Ornamenterne og båndene passerer bag indholdet i
  deres eget lag, og et ornament der havner bag læsbar tekst, flyttes — det gøres
  ikke bare mere gennemsigtigt.
- **Landskabet er baggrund, ikke indhold:** intet i maleriet må være nødvendigt at
  se. Appvinduet må dække hvad som helst af det på en lille skærm.
- Fuld højde er altid `100dvh` — aldrig `100vh` (iOS Safari springer).
- Indholdsbredde begrænses: spil 960px (appvinduet), hero 1240px.
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
  — aldrig som gentaget baggrund på mange elementer. Over et malet lærred skal det
  skrues **ned**: maleriet har sin egen struktur, og to kornlag oven på hinanden
  bliver til mudder.
- **`prefers-reduced-motion` er ufravigelig:** al bevægelse slukkes, men information
  må aldrig gå tabt — sjældenhed vises da som statisk glød i stedet for puls.

---

## 7. Delekort og ikoner

Alle sociale aktiver og app-ikoner **genereres** fra designsystemet — de
tegnes ikke i et billedprogram. Kilden er `tools/social/card.html`, og
`npm run social` bygger dem. Scriptet starter sin egen Vite-server på en
ledig port, så der er intet at huske at starte først. Kræver ImageMagick
(`brew install imagemagick`).

Reglen bag: et delekort lavet i hånden bliver forældet i samme øjeblik en
token ændrer sig, og ingen opdager det — fordi ingen ser sit eget delekort.
Da spillet skiftede navn, lå der i tre dage et kort med det gamle navn på
hvert eneste link. Et script kan køres igen; en PNG kan kun huskes.

| Fil                    | Mål      | Format          | Bruges til                             |
| ---------------------- | -------- | --------------- | -------------------------------------- |
| `og-image.jpg`         | 1200×630 | JPEG q88        | `og:image`, Twitter/X, iMessage, Slack |
| `icon-512.png`         | 512×512  | PNG, 192 farver | manifest, Android-splash               |
| `icon-192.png`         | 192×192  | PNG, 192 farver | manifest                               |
| `apple-touch-icon.png` | 180×180  | PNG, 192 farver | iOS-hjemmeskærm                        |
| `favicon-32.png`       | 32×32    | PNG             | fanebladet                             |

**Format er ikke en smagssag her.** Kortet er filmkorn over en blød
gradient — det motiv er PNG dårligst til (1,1 MB mod 100 kB som JPEG).
Ikonerne _skal_ være PNG (manifest og apple-touch accepterer ikke JPEG), så
vægten tages i stedet med farvereduktion: **192 farver uden dithering.**
Dithering støjer synligt på pastellen og firedobler filen.

**Motivet er det samme i alle størrelser:** Karl. Kortet viser ham helt, i
samme komposition som titelskærmen. Ikonerne er hans ansigt beskåret
kvadratisk — håret og øjnene er den eneste del af tegningen der stadig kan
aflæses ved 32 px. Ingen særskilt logo-mærke, ingen initialer, intet
abstrakt symbol: spillet har en hovedperson, og det er ham folk skal se i
fanebladet.

Filmkornet er slået fra på ikonerne. Ved 32-180 px kan det ikke ses.

**Efter et paletskifte skal `npm run social` køres igen.** Kortene er bygget af
tokens, men de er _committede filer_ — de opdaterer ikke sig selv. Præcis den fejl
kostede tre dage med et forkert navn på hvert link, og et paletskifte er samme
slags fejl med en anden farve.

---

## 8. Anti-mønstre (forbudt)

- ❌ Ren sort `#000000` — brug `Ink`
- ❌ **Koldt blæk på varmt pergament.** Den forrige palets `#16151A` er blåsort og
  ser beskidt ud på tan papir. Blæk er varmt nu.
- ❌ Inter, Georgia, Times New Roman og system-serif
- ❌ Neon, ydre glød, farvede skygger, gradient-tekst
- ❌ `Navy` til andet end akt-badgen. Bruges den bredt, holder den op med at betyde
  _hvor i historien vi er_
- ❌ Centreret hero
- ❌ Overlappende elementer og absolut-positioneret tekst oven på illustration
- ❌ **Ornament bag læsbar tekst.** Dyrefrisen og jægeren skal have deres eget rum.
  Løsningen er at flytte ornamentet, ikke at sænke dets opacitet, til teksten "går an"
- ❌ **Hulemaleri som flade.** Motiv på pergament: ja. Mørk stenflade under UI: nej —
  det er den ophævede æstetik der lister sig ind igen (§1)
- ❌ Tre lige brede kort på række
- ❌ Cirkulære spinnere — brug skeletter i indholdets egne mål
- ❌ Fyldtekst: "Scroll ned", pilehop, "Swipe"
- ❌ **"Drag" i nogen tekst.** Spillet har ikke drag, og har det ikke med vilje
  (§4). En tekst der lover det, er en fejl uanset hvad referencen viser
- ❌ Opdigtede tal og statistik. Tællere viser rigtig spiltilstand eller ingenting
- ❌ Vandret scroll på mobil
- ❌ **Farve uden token.** Rå hex i `style.css` er forbudt (CLAUDE.md regel 8)
- ❌ **Tekstfarve valgt mod den lyseste flade.** Den skal holde mod den mørkeste
  papirflade den kan lande på (`Slot` `#DEC6B0`) — se etiketfælden i §2
- ❌ **Emoji i UI-krom** — ingen emoji i knaptekster, faner eller etiketter.
  _Undtagelse:_ emoji som **indhold** (elementernes og skæbnernes ikoner fra
  `content/*.json`) er spillets illustrationssprog og er tilladt. Skellet er:
  kommer tegnet fra indholdet, er det kunst; skriver vi det i en knap, er det slop.
  **Kendt brud pr. 11-08-2026:** `⏳` i titellinjens sommertæller
  (`src/ui/main.ts`, `renderAge()`) er krom og skal erstattes af et rigtigt ikon.

---

## 9. Elementkunst

De 187 elementer skal males. Det er langt det største aktiv-arbejde i spillet, og
det eneste sted hvor **konsistens ikke kan komme af disciplin** — 187 billeder lavet
over uger driver fra hinanden, uanset hvor omhyggelig man er. Konsistensen skal komme
af en kontrakt og en normaliserings-pipeline (CLAUDE.md regel 9: aktiver genereres,
tegnes aldrig i hånden).

### Stilkontrakt

Dette afsnit er **prompt-kilden**. Ændrer man den, ændrer man alle fremtidige
billeder — derfor står den her og ikke i et script.

- **Motiv:** ét objekt, centreret, set forfra eller i svag trekvart. Ingen scene,
  ingen baggrundshandling, ingen horisont.
- **Stil:** blødt malerisk, som en naturhistorisk plancheillustration. Synlige
  penselstrøg tilladt; fotorealisme og 3D-render er det ikke.
- **Lys:** altid fra **øverste venstre**. Ét lys. Ingen modlys, ingen dramatisk
  skygge.
- **Kant:** blød malerisk afslutning. **Ingen sort kontur**, ingen outline-stil,
  ingen cel-shading.
- **Baggrund:** fuldt gennemsigtig. Ingen flade, ingen vignette, ingen farvet plade.
- **Skygge:** **ingen indbagt skygge.** Faldskygge tilføjes i CSS, hvor den kan
  tilpasses flisens baggrund. Bages den ind, sidder den fast på én papirfarve og
  ser forkert ud i det øjeblik fliseflowet skifter.
- **Lærred:** kvadratisk, med **fast luft omkring motivet** — motivet fylder ca.
  80 % af rammen. Ensartet margin er det, der får et grid til at se roligt ud;
  billeder beskåret tæt hopper i størrelse fra flise til flise.
- **Farve:** skal kunne ligge på tan pergament. Rene kolde blå og neonfarver
  falder igennem — hold dig inden for landskabets og papirets varme register,
  undtagen hvor motivet i sagens natur er koldt (is, vand).

### Levering

- **Additivt og valgfrit pr. element.** Findes `public/art/<element-id>.webp`,
  vises den; ellers vises elementets emoji. **Ingen kodeændring pr. billede.**
  Spillet skal kunne gå live uden en eneste illustration.
- **Format:** WebP, kvadratisk, 256×256 (@2x for 128px-fliser).
- **Vægt:** ≤ 10 kB pr. element. 187 × 10 kB ≈ 1,9 MB — derfor hentes kun de
  **13 base-elementer** ved start; resten dovent (`loading="lazy"`).
- **Navngivning:** `<element-id>.webp`, nøjagtig elementets `id` fra
  `content/*.json`. Opslaget sker på id, ikke på navn.
- **Kontrol før commit:** alle nye billeder ses som **kontaktark i flisestørrelse**,
  ikke ét ad gangen i fuld opløsning. Drift i lysretning, margin og mætning er
  usynlig ved 100 % og øjenfaldende i et grid — og griddet er det, spilleren ser.

---

## 10. Ændringslog

| Dato       | Ændring                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11-08-2026 | Målbilledet flyttet til `target-2026-08-11.webp`: malet landskab som lærred, tan pergament, varmt blæk, navy akt-badge, hulemaleri-ornamenter, elementkunst (§9). Typografireglen omskrevet til "serif taler, sans betjener". Rettet to kontrastfejl i referencen (etiketbrun 3,21:1 og Combine-knap 2,18:1). |
| 10-08-2026 | Første version afledt af pastelreferencen. Ophævede den midlertidige mørke hulemaleri-æstetik.                                                                                                                                                                                                                |
