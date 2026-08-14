# TITLE-scene-masters-v2 — both candidates blocked

**Date:** 2026-08-14
**Approved source:** `docs/design/reference/title-2026-08-11.webp`
**Source SHA-256:** `8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850`
**Requested masters:** 2560×1440 wide and 860×1864 portrait, scene-only, lossless

## What was requested

Two scene-only title masters — no wordmark, no buttons, no parchment or UI —
built from the approved title reference so that the canonical 896×992 scene
and every visible Karl pixel survive untouched, and the new canvas around them
reads as one continuous painted scene.

## Sources

- `docs/design/reference/title-2026-08-11.webp` (1586×992) is the approved
  composite. Its right-hand 896×992 region is the canonical scene; it is the
  only human-approved pixel source for scene and Karl. Two rounded tool
  surfaces (`[680,10,780,110]` and `[780,10,896,110]`) are occluded UI and are
  therefore excluded from source truth in both directions of the retention
  measurement.
- `docs/design/reference/bg-wide.png` (1913×822) is a landscape plate that was
  never approved as title art. It is pinned as `continuation-donor-only`
  (`sources.approvedLandscape.provenance.humanApproved: false`) and may only
  supply new canvas area, never scene or Karl.
- No PSD, XCF, layered original, taller scene plate or clean mobile source
  exists locally. There is no approved pixel information at all below row 992
  or outside the 896 canonical columns. Every pixel there is a claim, not an
  observation.

## Verdict

Neither candidate may be published. Both extend the canvas downwards by
**reflecting the approved rows about row 991** — the extension is not a
continuation of the scene, it is the scene folded back on itself.

The portrait was promoted on 2026-08-14 on the hand-written basis that
"manual inspection found a continuous portrait composition without a visible
clone seam or repeated subject". That claim is withdrawn. It was never
measured, and it is wrong: the foliage and the rock ledge immediately below
Karl are a mirror image of the foliage and ledge immediately above the join.
`docs/design/reference/title-scene-portrait-860x1864.png` has been deleted.

## Why the old gates could not see it

`repeatCorrelation` compares a donor with a generated region **in the same
orientation** — it detects a translated copy. A reflection reverses row order,
so a translated comparison of a mirrored block yields a low correlation and the
gate stays green. Measured on the portrait: the extension has
`maxTileCorrelation` 0.098, i.e. no repeating tile at any period from 4 to 64
rows. By that gate the extension looks like new material.

The seam gate was worse than blind — it was actively reassuring. The bottom
seam gradient ratio is exactly **1.000** for both candidates, because a
reflection has, by construction, the same gradient across the axis as the
source has inside itself. A mirror is perfectly seamless. So is a fold.

The transition gate agrees for the same reason: high-frequency energy at
scales 4, 16 and 64 rows below the join measures 0.915, 0.989 and 0.928 of the
energy above it, all inside the accepted 0.80–1.20 band. A reflection cannot
fail a texture-statistics test — it has the source's own statistics.

## The mirror-symmetry gate

For every candidate axis, in both parities and in column tiles of 512 px, the
band of 32 rows above the axis is correlated against the 32 rows below it,
reversed, on the high-passed luma channel. The gate is
`gates.mirrorCorrelationMax = 0.85` and it is measured for both candidates and
for the approved sources themselves on every build.

The `on-row` parity matters. A reflection produced by `[::-1]` on a slice that
drops its own last row — which is what this pipeline does, and what
`numpy.pad(mode="reflect")` and `BORDER_REFLECT_101` do — has its axis **on**
a row, not between two rows. Measured with a between-rows axis only, the
portrait's exact reflection reads as 0.760 and would have passed.

Calibration on every approved reference in `docs/design/reference/`, measured
with the shipped function:

| Image | Best mirror correlation | Axis |
|---|---:|---:|
| `bg-wide.png` | 0.092 | 477 |
| `elements-sheet.png` | 0.146 | 1129 |
| `combine-slab-src.webp` | 0.424 | 553 |
| `title-2026-08-11.webp` | 0.638 | 785 |
| `target-2026-08-11.webp` | 0.656 | 96 |
| **portrait candidate** | **0.998** | **991** |
| **wide candidate** | **0.997** | **991** |

No hand-painted approved reference exceeds 0.66. Both candidates exceed 0.99.
The threshold sits 1.30× above the highest genuine reference and 0.85× of the
candidates, and the build fails closed if a control source ever crosses it.

The originally proposed formulation — best axis mean deviation against the
median axis — was measured and rejected as a gate. It is reported as
`deviationRatio` for information only. Flat regions produce near-zero
deviation without any mirroring at all: on the same axis convention
`bg-wide.png` scores 0.52 and `elements-sheet.png` scores 1.60 while the
portrait scores 3.01, and on a full-width sweep `elements-sheet.png` reaches
43.8× purely because its background is blank. A ratio threshold that fails the
portrait would fail approved art.

## Full-plate evidence

| Metric | Required | Portrait | Wide |
|---|---:|---:|---:|
| Canonical scene coverage | 896×992 | 860×992 | 896×992 |
| `fullCoverage` | true | **false** | true |
| Visible source retention | ≥0.95 | 0.9608 | 1.0000 |
| Changed visible source pixels | 0 | 33,996 | 0 |
| Karl max delta | 0 | 0 | 0 |
| Bottom seam gradient ratio | ≤2.0 | 1.000 | 1.000 |
| Left seam gradient ratio | ≤2.0 | — | 0.061 |
| Transition energy ratio (4/16/64) | 0.80–1.20 | 0.92/0.99/0.93 | 0.91/0.99/0.93 |
| Max tile correlation | ≤0.92 | 0.098 | 0.090 |
| Extension-vs-source reuse | ≤0.65 / ≤0.72 | **0.9938** (mirrored) | **0.9955** (mirrored) |
| Side-field donor reuse | ≤0.72 | — | **0.7565** |
| **Mirror correlation** | **≤0.85** | **0.9982** (row 991) | **0.9966** (row 991) |

Portrait mean deviation at the winning axis is 6.05 against a median of 18.22
across all axes in the same columns; median mirror correlation across all axes
is 0.013, so the winning axis is not a property of the image, it is a single
manufactured reflection.

Retention is `retained visible canonical pixels / visible canonical pixels`.
The portrait's 0.9608 is not damage to what it shows — it changes nothing it
covers — it is the 36 canonical columns it does not show at all. A master that
crops 4% of the approved scene away is not a faithful master of that scene, so
`fullCoverage` is a gate in its own right.

## Two rejected candidates, one cause

1. **Portrait 860×1864.** Blocked on the mirror gate (0.9982 at row 991),
   on extension-vs-source reuse (0.9938, mirrored, one-row offset) and on
   coverage (860 of 896 canonical columns). SHA-256 of the reproducible
   candidate: `b9d6d11fc9377f4ba135a55783eb3dcf1b39e8ed5126ee7df72171d1f06161a5`.
2. **Wide 2560×1440.** Blocked on the same mirror at row 991 (0.9966 in
   columns 2048–2560), on extension-vs-source reuse (0.9955, mirrored), and
   on the side field's reuse of its own donor edge (0.7565 against 0.72) —
   the blocker recorded on 2026-08-14 and still true. SHA-256:
   `4a55c5bcc2206d2bdbd97787e425eaba653379835996c9891282d66be65f6932`.

Both were built by the same deterministic local pipeline. No network service,
no generative model, no third-party asset and no patch quilting was used, and
none would be acceptable here.

## Precise unblock

Provide one locally approved, lossless, UI-free scene source that already
contains the pixels the masters need:

- at least 1864 rows of painted scene below the current row 0, in the same
  painterly light, so the lower canvas is observed rather than reflected;
- at least 896 columns for the portrait framing, so no approved column has to
  be cropped away;
- Karl and the currently visible canonical scene pixels unchanged, so
  retention and `karlDelta` can still be verified exactly.

The pipeline then measures retention, coverage, Karl, seams, transition,
repetition and mirror symmetry without inventing anything, and a promotion can
be requested with a manual approval bound to the candidate's, the contact
sheet's, the generator's and the config's hashes.

## Inspect

- `contact-sheet.webp` — both candidates side by side with their verdicts.
- `wide-blocker-overlay.webp` — the side-field blocker in red and the mirror
  axis in yellow.
- `manifest.json` — sources, hashes, all gates, all metrics, both decisions.
- `metrics.json` — the machine-readable measurement subset.

Rebuild and re-verify:

```sh
python3 tools/art/build_title_scene_masters.py
```

The command writes the evidence in this directory, exits 1 because both
candidates are blocked, and publishes nothing.
