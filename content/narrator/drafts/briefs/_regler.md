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
- **Ingen pladsholdere overhovedet** — heller ikke `{partner}` eller
  `{shared}`. De findes kun i grammatikken.
- **Længde:** 1-3 sætninger. De bedste af de eksisterende replikker er korte
  og lander på et enkelt billede.
- **Varianter skal være forskellige vinkler**, ikke omskrivninger af hinanden.
  Fire varianter på samme vits er én variant.

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
