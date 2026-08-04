# Bogen — leksikon, tidslinje og replayability

*Designdokument, supplement til PRD.md. Besluttet 2026-08-04.*

## Vision

Skærmen deles i to store dele:

1. **Bogen (øverst):** et leksikon over menneskets historie med blanke sider,
   der udfyldes efterhånden som spilleren opdager ting. Udfyldes med enten
   historisk "realistiske" illustrationer (hovedsporet) eller de skøre
   alternative kombinationer spilleren laver (komiske spor).
2. **Værkstedet (nederst):** her trækker spilleren elementer ovenpå hinanden
   for at drive historien fremad.

Bogen viser udfaldet af ens kombinationer visuelt og løbende — den er både
journal, belønning og kompas.

## Forgrenet tidslinje

Tidslinjen kan **splitte sig i flere retninger**. Hovedsporet følger den
virkelige teknologihistorie; komiske valg (larver, mudderbad) åbner sidegrene
med egne opdagelser. Replayability ligger i at *se* de uudforskede stier:

- **Opdagede** poster vises med illustration, navn og forbindelseslinjer —
  opskriften afsløres først når man har lavet den.
- **Uopdagede** poster vises som stiplede silhuetter/blanke sider: man kan se
  *at* der mangler noget og *hvor på tidslinjen* det hører til (retning uden
  spoilers, PRD §4.3), men ikke hvordan man når derhen.
- **Komiske grene** har deres egen visuelle lane/farve, så en gennemspilning
  tydeligt viser "din version" af historien — og hvad man gik glip af.

Datagrundlag: grafen udledes automatisk af `content/combos.json`
(`src/core/timeline.ts`) — skribenter skal ikke vedligeholde en separat
tidslinje. Kombinationer kan tagges `"spor": "komisk"`; alt andet er hovedspor.

## Art-brief (til Step 4-stilprøver)

- **Enkel streg, alá hulemalerier** — men med sjove detaljer.
- Illustrationerne bærer Karls følelsesliv: super stolt over at opfinde noget
  ligegyldigt; komisk ked af det, når han fejler.
- Indtil rigtige illustrationer findes, bruger prototypen emoji + et
  `karlMood`-felt pr. element (fx `stolt`, `ked`, `flov`, `fornaermet`,
  `forvirret`) som stemnings-badge. Feltet bliver senere briefen til
  illustratoren: "tegn Karl [stolt] ved siden af mudderbadet".
- Bogen holdes i papir/pergament-toner som kontrast til det mørke UI.

## Interaktion (afvigelse fra PRD §2.1)

PRD v0.1 sagde "tap/klik, ingen drag på mobil". Besluttet i stedet:

- **Drag er primær interaktion**: træk et element ovenpå et andet for at
  kombinere (pointer events — virker med både mus og touch).
- **Tap-tap bevares som fallback**: to tryk vælger to elementer og
  kombinér-knappen udfører. Vigtigt for tilgængelighed (motorik, skærmlæsere)
  og som sikkerhedsnet på små skærme.
- Et element kan kombineres med sig selv ved at trække kortet over på dets
  egen plads (sten + sten).

PRD'en opdateres med dette ved næste versionsbump (v0.2).

## Ikke i denne version (senere)

- Rigtige streg-illustrationer (Step 4, efter 3 stilprøver)
- Bladre-animation/sidevending og lyd i bogen
- Zoom/pan på lange tidslinjer (bliver relevant fra Akt III)
- Deling af "min tidslinje" som billede (marketing-idé: TikTok/Shorts)
