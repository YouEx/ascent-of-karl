# Sådan skrives en bagt par-replik

Du skriver replikker til Fortælleren i *The Ascent of Karl*. Læs først
`docs/design/fortaelleren.md` og skim `content/narrator/act-1.json` for at få
stemmen i øret. Spillerteksten er **engelsk**.

## Hvad en bagt replik er

Når spilleren sætter to ting sammen og der ikke sker noget, svarer spillet i
tre lag:

1. **bagt replik** — skrevet til præcis dette par. ← det er dem du skriver
2. **grammatik** — 306 varianter der kun kender dommen og taggene
3. nødudgang — nås aldrig

Grammatikken er allerede god. Din replik optager dens plads, og hvis din er
ringere, har du gjort spillet dårligere. Derfor gælder én prøve over alle
andre:

> **Kunne replikken bruges om et andet par? Så er den kasseret.**

"The dry grass and the stick refused to cooperate" kunne stå om hvad som
helst. "Karl rubbed the stick against the dry grass for a while, then stopped,
because his arms were tired. He was four minutes from inventing fire." kunne
kun stå om netop dem — den ved hvad de er, og hvad de næsten blev.

Hver brief giver dig begge navne, hvad tingene er lavet af, deres flavor-tekst
og hvad Karl mener om dem. Brug det. Det er hele grunden til at en bagt replik
kan være bedre end grammatikken.

## Reglerne

- **Skriv navnene ud** som almindelig tekst — ikke `{a}`/`{b}`. Brug dem
  præcis som de står i briefen, men med lille begyndelsesbogstav midt i en
  sætning: "the dry grass", "the stick". Begge navne SKAL stå i hver variant.
- **Rækkefølgen er ligegyldig for spillet**, men din sætning skal læses
  naturligt. Nævn dem i den rækkefølge der lyder bedst.
- **Skriv kun til den dom briefen angiver.** Dommene betyder:
  - `plausible` — det burde have virket. Fortælleren undskylder på Karls vegne.
  - `near-miss` — den ene af de to hører faktisk sammen med noget andet.
    Fortælleren ved hvad, og nyder at tie. **Røb ALDRIG hvad der mangler.**
  - `absurd` — de to ting hører til i hver sin verden. Tør opgivelse.
  - `clash` — deres egenskaber bider hinanden (våd mod tør, levende mod død).
  - `self` — samme ting mod sig selv.
  - `inert` — den ene indgår aldrig i noget. Blindgyde.
  - `locked` — der ER en opskrift, men tiden er ikke inde. Opmuntrende.
- **Nogle navne er flertal** ("Grubs", "Berries", "Sparks", "Planks", "Seeds",
  "Visions", "Wings", "Skis"). Skriv "the grubs *were*", ikke "the grubs *is*".
- **Forbudt:** "nothing happens", "nothing happened", "no reaction",
  "doesn't work", og enhver formulering der lyder som en fejlmeddelelse.
  Fortælleren er krønikeskriver, ikke en manual.
- **Udråbstegn er forbudt.** Han hæver aldrig stemmen. Tørheden er pointen.
- **Ingen pladsholdere** — med én undtagelse, som gælder `near-miss` og kun
  `near-miss`: se afsnittet nedenfor. `{a}`, `{b}`, `{partner}` og `{shared}`
  er forbudt overalt.
- **Længde:** 1-3 sætninger. De bedste af de eksisterende replikker er korte
  og lander på et enkelt billede.
- **Varianter skal være forskellige vinkler**, ikke omskrivninger af hinanden.
  Fire varianter på samme vits er én variant.

## near-miss: den ene pladsholder du SKAL bruge

Ved `near-miss` ved motoren hvilken af de to der faktisk hører hjemme i en
opskrift. Grammatikken kan pege på den med `{right}` — "the {right} did fine,
the {wrong} did not" — og det er dens stærkeste træk. En bagt replik der ikke
kan pege, ville derfor være en forringelse, ikke en forbedring.

Derfor: **hver `near-miss`-variant skal indeholde `{right}` mindst én gang.**
`{wrong}` er valgfri. De to erstattes ved runtime med det rigtige navn i småt,
og de er altid korrekte — også når det samme par møder en anden opskrift i en
anden spiltilstand. Skriv dem aldrig med stort og aldrig i flertal.

Briefen fortæller dig IKKE hvem af de to der er den rigtige. Det er med
vilje: du kan ikke vide det, og det skal du heller ikke — derfor findes
pladsholderen. Skriv sætningen så den holder uanset hvem af dem det er.

Begge navne skal stadig stå udskrevet i varianten. Pladsholderen er en
pegende bisætning oven på den konkrete scene, ikke en erstatning for den:

> Karl swung the stone axe at the mud, which gave way without giving anything
> back. The {right} was the half of this with somewhere else to be.

## Leverance

Ren JSON, ingen forklarende tekst omkring:

```json
{ "pairs": [
    { "key": "graes+pind", "verdict": "plausible",
      "variants": ["...", "...", "...", "..."] }
] }
```

`key` og `verdict` kopieres ordret fra briefen. Antallet af varianter står i
briefen (4 for de hyppigste par, 2 for resten).

## Tjek din egen fil før du melder færdig

```bash
cd ~/repos/Coldcarl && python3 tools/check_pairs.py <din-fil.json>
```

Ret alt den påpeger, og kør igen til den er tavs.
