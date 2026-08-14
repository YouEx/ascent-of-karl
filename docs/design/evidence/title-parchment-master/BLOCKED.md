# TITLE-parchment-master-v1 — blocked

**Date:** 2026-08-14  
**Approved source:** `docs/design/reference/title-2026-08-11.webp`  
**Source SHA-256:** `8205f9dd8411be00cefd87c9218b92b3676bbce783e655bf84d0a168cdd74850`  
**Requested master:** 760×1680 lossless RGBA

## Verdict

The approved composite is insufficient to reconstruct a visually credible,
continuous parchment master without inventing conspicuous texture. No candidate
was published to `src/assets/art/title-layers/`.

The final diagnostic keeps every accepted observable parchment pixel exactly
and has a meaningful one-pixel alpha edge, but it is still rejected: the lower
extension reads as synthesized weave, the large UI holes retain rectangular
lighting/shadow evidence, and reconstructed paper has only 50.6% of the
source paper's measured high-frequency energy.

Inspect:

- `contact-sheet.png` — reference, 50/50 overlay, and alpha on black, white,
  and parchment.
- `manifest.json` — deterministic dimensions, hashes, retention, coherence,
  repetition, and alpha metrics.

## Full-plate evidence

| Metric | Required | Final diagnostic |
|---|---:|---:|
| Observable source pixels | — | 248,615 |
| Reconstructed plate pixels | — | 762,217 |
| Source pixel retention | 99.9–100% | 100% |
| Texture energy ratio | 0.80–1.20 | **0.506** |
| Reconstruction-boundary gradient ratio | ≤4.0 | 2.793 |
| Row-banding peak ratio | ≤8.0 | 1.858 |
| Exact repeated 48px patches | 0 | 0 |
| Max non-adjacent patch correlation | ≤0.995 | 0.987 |
| Alpha transition | ≤1 px | 1 px |
| Alpha fringe on black/white/parchment | ≤1 px | 0 px |

Retention is `retained observable pixels / observable source pixels`; it is not
clipped and cannot exceed 100%.

## Three bounded attempts

1. **Overlap-add, distinct full-source patches:** energy 0.237; visible title
   ghosts, horizontal seams, and soft vertical striping.
2. **Detrended/scaled patches:** energy 0.544; visible patch lattice and
   rectangular button/card fills.
3. **Minimum-cut seams with contextual inpaint:** energy 0.506; UI shadow
   geometry remains visible and the extension still reads as repetitive weave.

All attempts used the complete eligible source field, not the previous four
48×48 sample quilt. None used network services or third-party generation.

## Precise unblock

Provide one locally approved, UI-free, lossless RGBA parchment source at
minimum 760×1680 with:

- the same painterly illumination, cracks and cave ornaments;
- a complete torn/painted silhouette;
- no title, ribbon, buttons, hint, tip card, foreground or scene matte;
- the currently observable approved parchment pixels retained exactly.

The deterministic pipeline can then validate retention, full-plate coherence,
repetition and alpha without synthesizing the missing majority of the plate.
