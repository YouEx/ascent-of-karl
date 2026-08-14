# Title scene masters — 2026-08-14

Deterministic local reconstruction from the two SHA-pinned sources in
`tools/art/title-scene-masters.config.json`. No network or generative service
was used.

## Verdict

**Both candidates are blocked. Nothing is promoted to
`docs/design/reference/`.** The full record is in `BLOCKED.md`.

- **Portrait blocked:** the 860×1864 candidate extends the canvas by mirroring
  the approved rows about row 991. Mirror correlation `0.9982` against the
  `0.85` limit, and the top of the extension matches the bottom of the source
  reversed at `0.9938`. It also shows only 860 of the scene's 896 approved
  columns, so `fullCoverage` is false. The earlier claim that manual
  inspection found "a continuous portrait composition without a visible clone
  seam" is withdrawn — it was never measured and it is wrong. The promoted
  file `docs/design/reference/title-scene-portrait-860x1864.png` was deleted.
- **Wide blocked:** the 2560×1440 candidate reuses its own edge terrain in the
  side field (`0.756489` against `0.72`) and carries the same mirror at row
  991 (`0.9966` in columns 2048–2560).

## Exact output

Both candidates are evidence-only and reproducible:

- Portrait SHA-256:
  `b9d6d11fc9377f4ba135a55783eb3dcf1b39e8ed5126ee7df72171d1f06161a5`
  (1,889,819 bytes)
- Wide SHA-256:
  `4a55c5bcc2206d2bdbd97787e425eaba653379835996c9891282d66be65f6932`
  (3,938,869 bytes)
- Visible source retention: portrait `0.9608`, wide `1.0`
- Karl delta: max `0` for both
- Bottom seam gradient ratio: `1.000` for both — a reflection is seamless by
  construction, which is exactly why the seam gate could not catch this

## Evidence

- `BLOCKED.md` — what was requested, what the sources are, what was measured,
  why both candidates were rejected, and the precise unblock
- `contact-sheet.webp` — compact side-by-side inspection sheet
- `wide-blocker-overlay.webp` — side-field blocker in red, mirror axis in
  yellow
- `manifest.json` — sources, exact candidate hashes, gates, metrics, decisions
- `metrics.json` — machine-readable measurement subset

Rebuild (writes this directory, exits 1, publishes nothing):

```sh
python3 tools/art/build_title_scene_masters.py
```

`tools/art/tests/test_build_title_scene_masters.py` asserts that the committed
evidence here is byte-identical to a fresh build and that neither master
exists in `docs/design/reference/`.
