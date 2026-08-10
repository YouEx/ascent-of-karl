# Sjældenhed

*Besluttet 2026-08-07. Implementering: `src/core/rarity.ts`, håndhævet af
`tools/validate.py`.*

## Beslutningen: udledt, ikke skrevet

Med 187 elementer ville håndmærkning drifte fra den første nye kombination,
og to personer ville aldrig blive enige om hvad "rare" betyder. Sjældenhed
er derfor **beregnet ud fra kombinationsgrafen**.

Den vigtige egenskab: *tilføjer man en genvej til et element, bliver det
automatisk mindre sjældent* — hvilket jo er sandheden. Etiketten kan ikke
komme til at lyve om indholdet, fordi den ER indholdet.

## Hvad måles

Tre ting, alle aflæselige i grafen:

1. **Afstand** — færreste kombinationer fra start-elementerne.
2. **Entydighed** — hvor mange opskrifter fører hertil? Én vej betyder at du
   skulle finde netop *den* vej.
3. **Konsekvens** — koster den ekstra somre? Er den en blindgyde (altså en
   destination, ikke en ingrediens)? Afslutter den Karls historie?

```
score = afstand
      + 2  hvis kun én opskrift fører hertil
      + 2  hvis elementet aldrig bruges videre
      + 2  pr. ekstra sommer den koster

common  score < 8
rare    score ≥ 8
unique  score ≥ 14  ELLER elementet afslutter runnet
```

Base-elementer er altid `common`: de er ikke fundet, de var der.

## Fordelingen

**128 common (68 %) · 47 rare (25 %) · 12 unique (6 %)** — "de fleste
almindelige, nogle sjældne, få enestående".

`unique` er blevet påfaldende ren: det er præcis de tolv elementer der
afslutter Karls historie. Kroningen, Flugten, Den Levende Gud, Den Sunkne
By. Det er ikke tilfældigt — det er runnets klimaks, og de bør føles sådan.

En detalje der er værd at forstå: **Bread ligger i `common` trods dybde 7.**
Der er to veje derhen, og den fører videre til kroen. Sjældenhed måler hvor
*entydig* vejen var, ikke bare hvor lang. Det er med vilje.

## Tre niveauer af fejring

| | Kicker | Stråler | Gnister | Halo | Ramme |
|---|---|---|---|---|---|
| common | dæmpet grå | — | — | — | normal |
| rare | accentfarve | ✓ | 8 | — | accent |
| unique | guld, spatieret | ✓ hurtigere | 16 | ✓ pulserende | 3px, glødende |

De fleste fund skal **ikke** larme — ellers betyder det intet når et
sjældent dukker op. Common får et roligt pop og en dæmpet etiket.

`prefers-reduced-motion` slår al bevægelse fra, men beholder den glødende
ramme: sjældenheden skal stadig kunne aflæses.

Etiketten vises også i bogens opslag, så den kan genfindes efter fundets
øjeblik.

## Håndhævelse

Validatoren beregner den samme formel og:

- **rapporterer fordelingen** ved hver kørsel, så drift er synlig
- **advarer** hvis `unique` overstiger 10 % (så mister ordet sin betydning)
  eller `common` falder under 45 %
- **fejler** hvis et slutnings-element ikke er `unique`

`tests/rarity.test.ts` holder desuden fast i at formlen er deterministisk,
at base altid er common, og at en tilføjet genvej sænker sjældenheden.

## Hvis du vil justere

Ændr `RARE_AT` / `UNIQUE_AT` i `src/core/rarity.ts` og kør `npm run validate`
— fordelingen printes med det samme. Vægtene (de tre `+2`) er kalibreret mod
Akt I's 187 elementer; rører du dem, så se på *hvilke elementer* der skifter
kurv, ikke kun på procenterne.
