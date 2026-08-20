# Titel-fidelity i CI

Titel-fidelity er nu en krævet release-port. CI optager alle seks registrerede
viewports fra produktionsbundtet og kræver de fire billedlag `scene`,
`foreground`, `parchment` og `wordmark`.

Den portable v3-suite bruger geometriankret karakterbevis, multiskala
kanttæthed og den faktiske samlede title-critical netværkspayload. Derfor er
DPR2, ultrabredt lærred og responsive art-directions sammenlignelige uden at
skjule ekstra billedbytes.

CI-kaldet er:

```bash
npm run judge:title-fidelity -- --require-green
```

Enhver rød billed-, manifest-, payload-, dimensions- eller no-upscale-gate giver
exit 1. De aktuelle payloadlofter er 350 kB på mobil og 600 kB på desktop.
