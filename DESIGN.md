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

**Akt-badgen** bæres af `--act-badge` `#1D3145` med `--act-badge-ink` `#F8EBEC` som
tekst — paletten eneste kølige flade, og intet andet må bære den: den er den visuelle
markør for _hvor i historien vi er_. `--act-badge-ink` på `--act-badge` giver
**11,46:1**. Bruges den til andet, holder den op med at betyde noget.

`--navy` `#22384E` var det oprindelige gæt på samme flade; badgen blev sidenhen
genmålt direkte i referencebilledet og fik sine egne, mere præcise tokens (11-08-2026).
`--navy` står tilbage i `tokens.css`, ubrugt — den er ikke et alias, farverne ligger
12 enheder fra hinanden i RGB. Brug `--act-badge`/`--act-badge-ink`, ikke `--navy`.

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

### Titelskærmen (overskrift, fanebånd og sten-knapper)

Titlens egen overskrift, fanebånd ("reinvent history, badly") og de to sten-knapper
(Begin/Continue/New life, Fates) bruger fem nye tokens, ingen delt med resten af
spillet — hugget i samme motiv som Combine-knappen ovenfor, men i titlens egne,
mørkere toner. Panel, ramme og redskabsknapper genbruger derimod bevidst papirets
og flisernes egne, allerede dokumenterede tokens (`Parchment`, `Tile Edge`,
`Valley Dark` og spillets "hugget flise"-opskrift) — titelskærmen er samme flade,
ikke en ny en:

- **Title Stone Hi** `#6A4B30` — overskriftens lyseste facet, toppen af bogstavernes
  lodrette gradient
- **Title Stone** `#422C1C` — overskriftens midtertone, 46 % ned gennem gradienten
- **Title Stone Lo** `#33210F` — overskriftens mørkeste bund og dens 1,6px konturstreg
- **Ribbon Ink** `#6D4118` — fanebåndets tekst
- **Btn Ink** `#42240C` — knappernes tekst (Begin/Continue/New life/Fates)

> **Overskriften er ikke én farve.** Bogstaverne fyldes med en lodret gradient
> (`background-clip: text`, 177°) fra `Title Stone Hi` gennem `Title Stone` til
> `Title Stone Lo` — samme "hugget i sten"-motiv som Combine-knappen, men egne
> toner, fordi overskriften står på pergament, ikke på en fritstående sten-flade.
> Værste kontrast-tilfælde er den LYSESTE ende: `Title Stone Hi` mod `Parchment`
> giver **5,87:1** — over både stor teksts 3:1-grænse og normalteksts 4,5:1.
>
> **Fanebåndet og knapperne sidder ikke på pergamentet, og deres tekst måles derfor
> mod deres EGEN flade, ikke mod papirtrinnene ovenfor.** `Ribbon Ink` mod fanebåndets
> flade `Tile Edge` giver **4,92:1** (`Tile Groove` lå tættere på referencens egen
> tone, men gav kun 4,19:1 og dumpede AA). `Btn Ink` bruges mod en sammenhængende
> CSS-bygget flade af de eksisterende `Tile`/`Field`/`Groove`-tokens. Den mørkeste
> tilladte kombination er fortsat pinnet i `tests/design-tokens.test.ts`; en
> billedudskæring må ikke bruges som skjult kontrastgrundlag.
>
> Titlens to redskabsknapper (trofæ, lyd) genbruger spillets egen "hugget
> flise"-opskrift (`Tile Shade` → `Tile Groove`, samme som `.title-chip`) med
> `Label Ink` som ikonstreg. De er rent grafiske SVG-streger, ikke løbetekst, og
> måles derfor mod WCAG 1.4.11's ikke-tekst-grænse (3:1), ikke tekstens 4,5:1:
> **3,61:1** mod gradientens mørkeste ende.

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

Titelskærmens tre store handlingslabels er den ene dokumenterede undtagelse:
de er del af den bogtrykte hero-komposition og sættes i varm Fraunces. Deres
semantik er stadig knapper, og deres ikon/tæller forbliver UI-krom.

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
pergament. Under 820px falder rammen væk og pergamentet går til fuld bredde — et
vindue med margin på en telefon er spildt plads.

**Pergamenttekstur.** Papirfladerne er ikke flade. Én sømløs fiber-tekstur lægges med
`background-blend-mode: multiply` over papirfarven, så **én fil kan bære alle seks
papirtrin**. Teksturen er diskret nok til at kontrasttallene i §2 stadig holder —
måles de ikke efter påføring, er den for kraftig.

**Knapper.** Papirflade, 1px `Tile Edge`, blæktekst, radius `--radius`. Primær og
sekundær adskilles af **vægt og kant**, ikke af farve. Aktiv tilstand giver 1px
nedadgående forskydning (taktilt tryk). Ingen ydre glød. Ingen farvede skygger.
Minimum 44px berøringsflade.

**Titelskærmens krom er komponenter, ikke screenshots.** Fanebåndet,
Begin/Continue, New life, Fates, redskabsknapperne, velkomstchippen og tipkortets
ramme bygges som semantisk HTML med sammenhængende CSS-flader. De må bruge
`--grain`, tokenbaserede gradienter, én ydre kontur, indre fas/rille og inline-SVG
fra `src/ui/icons.ts`, men aldrig 3-/9-slice, `border-image` eller venstre/midte/
højre-udsnit af et komponentbillede. Handlingerne deler samme genbrugelige
struktur: ikonbrønd, label og valgfri tæller. Hover, pressed, tastaturfokus og
reduced-motion er rigtige komponenttilstande, ikke særskilte billedaktiver.

Det malede verdenslag er fortsat urørligt: scene, pergament, den sourceafledte
wordmark og selvstændige illustrationer må forblive billeder. Det samme gælder
ornamenter, der er komplette motiver i sig selv, fx skillelinje, tap-hånd,
jagtscene, velkomstfigur og ildflise. Skellet er funktionelt: **en illustration
kan være et billede; en interaktiv kontrol eller komponentramme kan ikke.**

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

**Karls opfindelser.** Improviserede elementer er samme fysiske brikker som resten
— de må ikke ligne fremmed software oven på krøniken — men de får en stiplet
blækstreg og den lille engelske markør _"Karl's invention"_. Stregen genbruger
`Dashed`/`Ochre Ink`; der indføres ingen ny farve eller materialefamilie. Markøren
skal være synlig i grid, fundkort og bog uden at dominere elementnavnet. Et
improviseret fund får ikke rarity-etiket, historisk note eller kildeikon: det er
runets eget påfund, ikke en arkæologisk påstand.
Den stiplede streg og okkerfarven må aldrig stå alene: den synlige tekstmarkør
skal følge elementet, så oprindelsen også kan forstås uden farvesyn og uden at
se kanten. Tilgængeligt navn og læserækkefølge skal indeholde både
_"Karl's invention"_ og elementnavnet. Ingen mikrocopy må kalde det en
_historical discovery_, og fraværet af note/kilde må ikke erstattes af et
tomt noteikon, som kunne antyde en manglende historisk reference.
Hele udvidelsens markup og stil ligger under root-attributten
`data-improvise-enabled`; uden den er incumbent mobil- og desktoplayout
beregningsmæssigt og visuelt uændret.

**Slots.** `Slot`-flade med **stiplet** `Dashed`-kant og en blegt aftegnet
element-silhuet i midten. Mellem de to slots sidder et cirkulært pergament-token med
plustegn. Teksten er _"Select an element"_ + _"Choose from below"_ — **aldrig
"Drag"**: drag blev bevidst fjernet 07-08-2026, fordi gestussen stjæler den lodrette
scroll i et langt grid. Referencebilledet siger "Drag or choose from below"; det er
en fælde, og teksten må ikke kopieres.

**Akt-badgen.** `--act-badge`-flade, `--act-badge-ink`-tekst, lille radius, siddende
halvt ud over krønikekortets øverste kant. Det eneste sted den flade må optræde.

**Fortællerboblen.** Pergament med revet kant og jægerglyffen i venstre side.
Kursiv Fraunces. Mutet tilstand: 55 % opacitet og stiplet kant — stadig læsbar,
tydeligt slukket.

**Bogen.** Varmere papir end resten, indre skygge langs falsen, malet bogillustration
frem for 📖. Bogen er det eneste sted, hvor brødtekst må sættes i serif _uden_ at
komme fra `content/*.json`.

**Opfindelser i bogen.** Den kanoniske tidslinje forbliver historisk og læser kun
kurateret content. Under leksikonopslaget ligger i stedet en separat, stiplet sektion
med titlen _"Karl's inventions"_. Dens tomme tilstand forklarer, at par uden opskrift
kan ende her; den må aldrig lægge en improviseret node, note eller `sourceUrl` ind i
tidslinjen. Netværks-copy har kun en lille inline-status ved værkstedet
(loading/ready/fallback), blokerer aldrig Combine og åbner ingen ny modal.
Sektionen har egen navngivet heading og tastaturknapper; den er ikke en visuel
undergren af tidslinjen.

**Status og toast.** Copy-status er en høflig live-region (`role="status"`,
`aria-live="polite"`), og ordene skal gøre ikke-blokeringen eksplicit:
_Combine works now_, _ready_ eller _offline wording_. Afvisninger, dybdeloft
og cap vises som teksttoast med årsag og må ikke kommunikeres med farve eller
animation alene. En story/challenge-replik må gerne vinde fortællerprioritet;
toasten bærer stadig den mekaniske afvisning, mens sommertælleren viser
forbruget.

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
- **Mobil-først kollaps under 820px:** alt bliver én spalte. Ingen vandret scroll
  nogensinde — det er en kritisk fejl, ikke en skønhedsfejl.
- Handlingsknapper bliver i tommelfinger-zonen på mobil (docken), jf.
  `docs/design/ui-mobile.md`.

---

## 6. Bevægelse

- **Fjeder-følelse, ikke lineær:** `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`
  til noget der dukker op, `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` til alt andet.
- **Karls opfindelser er ikke en fjeder-fejring.** Den stiplete copy-status og
  invention-kortets egen reveal bruger én afsluttet, eksponentielt
  decelererende `--ease-out`-bevægelse uden bounce/alternate. Det holder
  netværksforbedringen rolig og gør dens tilstand tydelig uden at konkurrere
  med canonical discovery-fejringen.
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
- ❌ `--act-badge`/`--act-badge-ink` til andet end akt-badgen. Bruges de bredt,
  holder de op med at betyde _hvor i historien vi er_
- ❌ `--navy` — afløst af `--act-badge` (§2), ubrugt, må ikke genoplives
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
- ❌ **Komponentscreenshots som UI.** Ingen 3-/9-slice, `border-image` eller
  venstre/midte/højre-PNG/WebP til titlens fanebånd, handlingsknapper,
  redskabsknapper, velkomstchip eller tipkort. Scene, pergament, wordmark og
  selvstændige illustrationer er ikke omfattet.
- ❌ **Tekstfarve valgt mod den lyseste flade.** Den skal holde mod den mørkeste
  papirflade den kan lande på (`Slot` `#DEC6B0`) — se etiketfælden i §2
- ❌ **Emoji i UI-krom** — ingen emoji i knaptekster, faner eller etiketter.
  **Emoji er heller ikke længere spillets illustrationssprog.** Reglen lød tidligere
  at ikoner fra `content/*.json` var kunst og derfor tilladt; det er nu modbevist ved
  måling fire gange (elementfliserne, kombinationsknappen, dokkens felter, de tre
  problemknapper). Systemets emoji er blege og flade mod pergament, og CSS'en endte
  med at kompensere med `saturate()` og `mix-blend-mode` — altså male hen over et
  forkert billede. Én af dem var direkte forkert: vi tegnede en kølle hvor referencen
  viser en mave.
  **Ikoner skæres ud af referencen.** `tools/art/build_*.py` klipper motivet ud,
  emitterer `sizes.json` med referencens egne mål, og markup'en sætter `width`/`height`
  eksplicit. Ikonerne har ikke samme mål (23×24, 27×30, 28×29) — en fælles `max-height`
  ville flade den forskel ud. Emoji i `content/*.json` overlever kun som **fallback**
  når et motiv endnu ikke er skåret.

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

- **Additivt og valgfrit pr. element.** Findes `src/assets/art/elements/<element-id>.webp`,
  vises den; ellers vises elementets emoji. **Ingen kodeændring pr. billede** —
  `src/ui/art.ts` finder filerne selv via `import.meta.glob` og eksponerer dem
  som `glyphHTML()`/`hasArt()`. Spillet skal kunne gå live uden en eneste
  illustration.
- **Format:** WebP, kvadratisk, 256×256 (@2x for 128px-fliser).
- **Vægt:** ≤ 10 kB pr. element. 187 × 10 kB ≈ 1,9 MB — derfor hentes kun de
  **13 base-elementer** ved start; resten dovent (`loading="lazy"`).
- **Navngivning:** `<element-id>.webp`, nøjagtig elementets `id` fra
  `content/*.json`. Opslaget sker på id, ikke på navn.
- **Kontrol før commit:** alle nye billeder ses som **kontaktark i flisestørrelse**,
  ikke ét ad gangen i fuld opløsning. Drift i lysretning, margin og mætning er
  usynlig ved 100 % og øjenfaldende i et grid — og griddet er det, spilleren ser.

### Kontaktarkets mål

Kontaktarket er ikke en særskilt komposition. Det genbruger spillets egne tokens,
så en ændring af flisen automatisk ændrer review-arket:

| Rolle | Token | Mål |
| --- | --- | --- |
| Elementkort, desktop | `--element-card-width` × `--element-card-height` | 129×121 px |
| Kunstfelt | `--element-art-max-width` × `--element-art-max-height` | 91×67 px |
| Luft mellem review-fliser | `--contact-sheet-gutter` | 12 px |
| Review-margin | `--contact-sheet-margin` | 16 px |
| Navnelinje | `--contact-sheet-label-height` / `--contact-sheet-label-font-size` | 22 px / 12 px |
| Header | `--contact-sheet-header-height` / `--contact-sheet-header-font-size` | 56 px / 15 px |

Flader og blæk læses tilsvarende fra `Parchment`, `Tile` og `Ink`; kontaktarket
må ikke indføre egne farver.

---

## 10. Visuel verifikation

Visuelt arbejde lukkes med den versionerede dommer i `tools/judge/` — ikke med
en løs "ser bedre ud"-vurdering.

1. `docs/design/reference/registry.json` vælger reference, deterministisk
   scenarie, native viewport, DOM-ankre, vægte, tærskler og dokumenterede
   tilladte afvigelser.
2. `tools/judge/capture.mjs` bygger produktionsbundtet, starter selv
   `vite preview` på port 5199, optager med Playwright og lukker browser og
   server igen på både succes og fejl.
3. `tools/judge/metrics.py` måler `structure`, `tone`, `ink`, `geometry` og
   `materiality` pr. region. DOM-geometri bruges, hvor browseren kender tallet;
   pixels bruges ikke til at gætte et mål, der allerede findes.
4. `tools/judge/overlay.py` laver helskærms- og regionsbevis:
   reference, render, 50/50-blend og heatmap. De billeder skal ses med øjnene;
   en score uden billedgennemsyn er ikke en accept.
5. Dommersløjfen må kun ændre tokens i `src/ui/tuning.css`. Et forslag
   beholdes kun ved samlet fremgang og højst 0,02 fald i både regions-overall
   og hvert af de fem aspekter.
   Malet kunst og strukturelle fund køes i `docs/design/asset-queue.json` og
   `docs/design/human-queue.json` i stedet for at blive CSS-efterlignet.

Den accepterede regressionslinje ligger i `tests/visual-baseline.json` og
identificerer den commit, som tallene blev optaget på. En baseline må kun
ændres efter en frisk capture + måling ved registrets native viewports og
inspektion af overlays. `npm run test:visual` genkører den rigtige browser- og
målepipeline og fejler ved et fald over 0,02 i overall, structure, tone, ink,
geometry eller materiality; den er bevidst langsom og opt-in og må ikke belaste
`npm test`.

Praktisk lukkerunde:

```bash
node tools/judge/capture.mjs --screen all --out .judge/<run>
python3 tools/judge/metrics.py --run .judge/<run>
python3 tools/judge/overlay.py --run .judge/<run>
npm run test:visual
```

## 11. Ændringslog

| Dato       | Ændring                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14-08-2026 | §2/§3/§4/§8: titlens krom er nu semantisk HTML/CSS, ikke sammensyede komponentudsnit. Fanebånd, handlinger, redskaber, velkomstchip og tipkort får kontinuerlige tokenbyggede flader med rigtige interaktionstilstande; scene, pergament, source-wordmark og selvstændige illustrationer bevares som billeder. |
| 13-08-2026 | §10: den visuelle dommer er nu den gældende lukningsmetode: commit-identificeret baseline, rigtig produktions-capture, fem regionsmetrikker, obligatoriske overlays, 0,02-regressionsgrænse og en langsom opt-in-test uden for `npm test`. |
| 13-08-2026 | §4: spillerens improviserede elementer er dokumenteret som samme pergamentmateriale med stiplet blæk og markøren "Karl's invention"; bogen holder dem i en separat sektion uden note, kilde eller canonical tidslinjenode, og copy-status er inline og ikke-blokerende. |
| 12-08-2026 | §8: emoji er ikke længere illustrationssproget. Ikoner skæres ud af referencen (`tools/art/build_*.py` + `sizes.json` + eksplicit `width`/`height`); emoji er kun fallback. Metoden bag: når en flades struktur, blæk og materialitet alle er lave, skæres HELE fladen ud af referencen og CSS'ens `border`, `--grain` og `box-shadow` slettes — ellers påføres krommet to gange. Brugt på krøniken, fortælleren, dokkens felter og elementfliserne. |
| 12-08-2026 | §2/§4/§8: akt-badgen dokumenteret med sine egne tokens `--act-badge`/`--act-badge-ink` (#1D3145/#F8EBEC, 11,46:1) i stedet for 11-08-2026-rækkens `navy`-gæt (`--navy`, pergament-på-navy 8,96:1), som aldrig blev den flade, der faktisk kom i brug. `--navy` står urørt men ubrugt i `tokens.css`. Token-dækningstesten udvidet til at kræve begge de rigtige hexer i dette dokument. |
| 11-08-2026 | Målbilledet flyttet til `target-2026-08-11.webp`: malet landskab som lærred, tan pergament, varmt blæk, navy akt-badge, hulemaleri-ornamenter, elementkunst (§9). Typografireglen omskrevet til "serif taler, sans betjener". Rettet to kontrastfejl i referencen (etiketbrun 3,21:1 og Combine-knap 2,18:1). |
| 10-08-2026 | Første version afledt af pastelreferencen. Ophævede den midlertidige mørke hulemaleri-æstetik.                                                                                                                                                                                                                |
