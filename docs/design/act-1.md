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

## Spor og grene (85 elementer, 86 kombinationer — bølge 1 af 200+-målet)

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

## Nye personer

- **Ugh (nabo)**: base-element. Muliggør alle sociale kombinationer
  (flintmobil, rockband, fest, larvebod). Kommunikerer i skuffede grynt.

## Pop culture-referencer (i flavor/noter — altid som parodi/hyldest)

Flintstones (flintmobil, Dino), Minecraft (arbejdsbord), 2001: A Space
Odyssey + Obelix (bautasten-flavor), Stonehenge/Spinal Tap (stenkreds),
Rolling Stones (rockband), Cast Away/Wilson (ven), sushi (fisk).
Historiske noter forbliver faktuelle — pop-noter er fakta OM referencen
(fx "Flintstones (1960) var første primetime-tegnefilm").

## Design-regler for udvidelser

1. Nye kombinationer skal kunne *ræsonneres* (PRD §8-risiko: vilkårlighed).
2. Skøre grene = komisk spor-tag + evt. flag, så fortælleren kan huske det.
3. Store beats får 5+ fortæller-varianter; små beats bærer flavor-teksten.
4. Superset-listen i `docs/research/` er idébanken for expansion packs —
   intet derfra tilføjes uden dansk kuratering og historisk/komisk vinkel.
