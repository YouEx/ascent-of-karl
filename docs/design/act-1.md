# Akt I — Stenalderen (fokus-akt)

*Akt-dokument per PRD §6. Besluttet 2026-08-05: **vi bygger kun Akt I indtil
den er rigtig fed** — Akt II-V venter til Akt I har bevist loopet i playtest.
PRD'ens 15-25 elementer pr. akt er ophævet for Akt I: målet er så mange
kombinationsmuligheder som muligt, inkl. skøre grene og pop culture.*

## Problemer (obligatoriske, gater age-up)

| Problem | Hovedløsning | Alternative løsninger |
|---|---|---|
| Karl fryser | Ild (gnister + græs) | **Skind-kappe** (kød + økse) — flag `pelsklaedt` |
| Bare næver | Stenøkse (sten + pind) | — |
| Karl er sulten | Stegt kød | **Ristede larver** (flag `larver`), **Fisk/sushi** (vand + spyd) |

Age-up: kobber + malm → bronze (uændret).

## Spor og grene (167 elementer, 205 kombinationer — 200+-målet nået)

> Overblik: se den auto-genererede graf i `act-1-graf.md`
> (regenerér med `python3 tools/story_graph.py`). Adoption fra
> research-supersettet spores i `../research/STATUS.md`.

Bølge 1-spor (2026-08-05): **bolig** (mursten → hytte → landsby, hytte løser
kulde; nedbrændt hytte = "this is fine"), **røg/ånd** (røg → røgsignaler;
helligsted → shaman Ugh → syner), **knogle/jagt** (knogle → kølle →
slagsmål; knoglekast = 2001-cut), **fugle** (føniks, fjer → festdragt →
modeshow), **mad 2.0** (røget kød, saft, mudderkage der løser sult komisk,
surf'n'turf), **kunst/musik 2.0** (lerfigur, håndaftryk, galleri, fløjte,
Stonehenge-koncert = Spinal Tap, trommesolo), **transport 2.0** (tømmerflåde
→ kano, kælk, garage, drive-in, trafikprop), **sport** (stenspil,
brydekamp), **tømmermænd** — plus 14 alternative opskrifter, så centrale
opdagelser kan ræsonneres ad flere veje (fx ild via gnister+pind,
hulemaleri via kul+sten).

- **Hovedsporet**: gnister → ild → økse → spyd → kød → stegt kød → malm →
  kobber → bronze.
- **Flintstones-sporet** 🚗: sten+vand → rullesten → hjul → (+planker) vogn →
  (+nabo) **flintmobil** — fodkraft-bil, flag `bilist`. Undervejs:
  arbejdsbord (Minecraft-ref) af planker+planker.
- **Megalit-sporet** 🗿: sten+mudder → bautasten (2001/Obelix-refs i flavor) →
  bautasten+bautasten → **stenkreds** (Stonehenge).
- **Kunst & musik** 🎸: bær+sten → hulemaleri (flag `kunstner`) →
  (+keramik) **ven** ("Wilson", Cast Away). stamme+pind → tromme →
  (+nabo) **rockband** ("rolling stones", flag `rockstjerne`).
- **Fest-sporet** 🍺: bær+keramik → grottebryg → (+nabo) stenalderfest
  (flag `festabe`). Historisk note: 13.000 år gammelt øl fra Raqefet-hulen.
- **Larve-imperiet** 🐛: larver → ristede larver → larvefarm →
  (+nabo) larvebod (dalens første restaurant).
- **Diverse**: tamsvin ("Dino", Flintstones), boomerang (pind+pind),
  fisk/sushi, damp (foreshadowing Akt V).

Bølge 2-spor: **vejr** (sky → regn → lyn, sne → is), **jagt 2.0** (reb →
net/snare, ulv → **hund**, bue → pil), **familie** (romance → familie →
stamme, grav → eftermæle), **handel** (gave → handel → muslingepenge →
marked, høvding → den første lov), **myter** (ritual, ånd, myte, solgud,
maske, dans), **krop** (nål → tøj, tatovering, spejl, hårklip, skinne) og
**have** (frø → have → høst).

Bølge 3-spor: **fossiler/rav** (myg i rav = Jurassic Park), **monolitten**
(2001) → besøgende (ancient aliens-parodi), **istid-dyr** (mammut →
mammutbenshus), **mad 3.0** (mel → dej → **brød** → kroen), **hav-myter**
(oversvømmelse → den sunkne by = Doggerland, søuhyre, den behårede),
**sport** (træningsmontage → mesteren), **skatte** (idol, fældegrav, den
hellige krukke = gralsparodi) og **tal/skrift** (tællekæp → regnskab,
symbol → **skrift**, kort, kalender).

## Nye personer

- **Ugh (nabo)**: base-element. Muliggør alle sociale kombinationer
  (flintmobil, rockband, fest, larvebod). Kommunikerer i skuffede grynt.

## Pop culture-referencer (i flavor/noter — altid som parodi/hyldest)

Flintstones (flintmobil, Dino), Minecraft (arbejdsbord), 2001: A Space
Odyssey + Obelix (bautasten-flavor), Stonehenge/Spinal Tap (stenkreds),
Rolling Stones (rockband), Cast Away/Wilson (ven), sushi (fisk).
Historiske noter forbliver faktuelle — pop-noter er fakta OM referencen
(fx "Flintstones (1960) var første primetime-tegnefilm").

## Skæbner: Karls liv får en ende (2026-08-05)

Hvert run varer **max 50 somre** (kombinationsforsøg = én sommer;
`content/config.json`). Dybe/skøre opdagelser koster ekstra somre
(`cost`-felt) — jo længere ud ad en gren, desto sværere at holde Karl i
live. Fortælleren varsler alderdommen ved 10/5/1 somre tilbage.

### Skæbne-gate: `endingsUnlockAt` (2026-08-06)

Billigste vej til The Flight of Karl var **5 somre** — en playtester kunne
afslutte sit allerførste run på fire kombinationer og have set 5 % af
spillet. Skæbner er derfor gated på **14 opfindelser**.

- Gaten tæller `Engine.inventions()` — *ikke* `discovered.length`. De 13
  base-elementer er verden Karl vågner op i, ikke noget han har udrettet
  (og age-up lægger næste akts base-elementer i puljen oveni).
- Under grænsen sker opdagelsen normalt, men Karl overlever, og fortælleren
  får sit eget beat (`ending-deflected`, 6 varianter): *"Death arrives,
  looks at how little Karl has accomplished, and decides to come back when
  there is more to work with."*
- **Skæbnen går ikke tabt.** Kombinationen kan gentages senere; motoren
  udløser slutningen på `known`-stien når grænsen er nået. Uden det ville
  et for tidligt forsøg låse en slutning permanent ude.
- Alderdommen (`automatic`) er *ikke* gated — 50 somre er 50 somre,
  uanset hvor lidt Karl nåede.
- Validatoren regner gaten med i nåbarheden: en slutning kræver
  `max(opskrifts-cost, endingsUnlockAt)` somre.

**12 slutninger** (`content/endings.json`) — ikke alle lykkelige:

| Slutning | Achievement | Tone |
|---|---|---|
| 👑 King Karl | King Karl | happy |
| 🌟 The Legend | Rock Legend | bittersweet |
| 🖌️ Into the Painting | The Mad Painter | mad |
| 🪽 The Flight of Karl | Almost Icarus | tragic |
| ⚔️ General Karl | General Karl | tragic |
| 🩹 Dr. Karl | Dr. Karl | happy |
| 🍲 The Last Supper | Death by Cuisine | komisk |
| 🏔️ The Long Winter | The Long Winter | tragic |
| 🕊️ Remembered | Remembered | bittersweet |
| 🌞 The Living God | The Living God | mad |
| ⛵ The Voyage | Into the Unknown | bittersweet |
| 🕯️ A Whole Life | A Whole Life | bittersweet |

Udløsere står i `content/endings.json` + `combos.json` (feltet
`ending`); alderdommen er automatisk ved 50 somre.

En slutning afslutter runnet (motoren låser), fortælleren får sidste ord
("THE END"), og et **achievement** låses op — persisteret på tværs af runs.
Trofæ-modalen (🏆) viser låste skæbner som "???" — samme
replayability-princip som tidslinjens silhuetter: man kan se AT der
findes flere skæbner, ikke hvordan man når dem.

## Design-regler for udvidelser

1. Nye kombinationer skal kunne *ræsonneres* (PRD §8-risiko: vilkårlighed).
2. Skøre grene = komisk spor-tag + evt. flag, så fortælleren kan huske det.
3. Store beats får 5+ fortæller-varianter; små beats bærer flavor-teksten.
4. Superset-listen i `docs/research/` er idébanken for expansion packs —
   intet derfra tilføjes uden dansk kuratering og historisk/komisk vinkel.
