# Title scene masters — 2026-08-14

Deterministic local reconstruction from the two SHA-pinned approved sources in
`tools/art/title-scene-masters.config.json`. No network or generative service
was used.

## Verdict

- **Portrait approved:** `docs/design/reference/title-scene-portrait-860x1864.png`
  is a visually continuous scene-only 860×1864 PNG.
- **Wide blocked:** the 2560×1440 candidate is evidence-only. Manual inspection
  still shows repeated lower edge detail and a soft vertical join in the marked
  region. It was not promoted to `docs/design/reference/`.

## Exact output

- Portrait SHA-256:
  `b9d6d11fc9377f4ba135a55783eb3dcf1b39e8ed5126ee7df72171d1f06161a5`
- Portrait bytes: `1889819`
- Source retention: `1.0` (`833010` visible pixels, `0` changed)
- Karl delta: max `0`, mean `0.0` across `390000` pixels
- Bottom seam gradient ratio: `1.0`

The rejected wide candidate is reproducible with SHA-256
`4a55c5bcc2206d2bdbd97787e425eaba653379835996c9891282d66be65f6932`.
Its source-reuse correlation is `0.756489235319935`, above the configured
maximum of `0.72`.

## Evidence

- `contact-sheet.webp` — compact side-by-side inspection sheet
- `wide-blocker-overlay.webp` — rejected region marked in red
- `manifest.json` — sources, exact output hashes, metrics, and decisions
- `metrics.json` — machine-readable measurement subset

Rebuild:

```sh
python3 tools/art/build_title_scene_masters.py \
  --output-dir .judge/title-scene-masters/final \
  --evidence-dir docs/design/evidence/title-scene-masters-2026-08-14 \
  --manifest docs/design/evidence/title-scene-masters-2026-08-14/manifest.json \
  --promote-portrait
```
