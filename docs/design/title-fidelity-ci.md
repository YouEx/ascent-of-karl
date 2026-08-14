# Titel-fidelity i CI

Phase A kan merges som et selvstændigt led i en stacked ændringsrække.
`npm run judge:title-fidelity` kører da i audit-mode: den optager alle seks
viewports, skriver de røde mål og består processen, så eksisterende main forbliver
grøn. Den portable v2-provenance- og algoritmesuite kører stadig i `ux-audit`.

Phase B/C leverer de versionerede assetkontrakter og de fire obligatoriske lag:
`scene`, `foreground`, `parchment` og `wordmark`.

Først i Phase D ændres CI-kaldet til:

```bash
npm run judge:title-fidelity -- --require-green
```

`--require-green` er den afsluttende kontrakt: enhver rød billed-, manifest-,
payload-, dimensions-, retention-, alpha- eller no-upscale-gate giver exit 1.
Flaget må ikke aktiveres tidligere og må ikke erstattes af lavere tærskler.
