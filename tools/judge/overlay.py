#!/usr/bin/env python3
"""Overlejring og rapport — den visuelle dommers bevismateriale.

50/50-overlejringen er ikke et fejlfindingsknep, det er den teknik der VIRKEDE,
da alt andet fejlede. Tærskelbaserede profilscanninger (mørke rækkeløb,
Sobel-bånd, x-udstrækning) blev slået af pergamentets krakelering og af
"Karl"s lys-til-mørk-forløb: ord smeltede sammen til ét bånd, og x-målinger
returnerede hele vinduet hver gang. Overlejringen afgjorde hvert eneste
spørgsmål i ét kig.

Derfor er den et førsteklasses artefakt i hver iteration — både for dommeren
og for et menneske, der vil se efter.

Producerer:
    overlay/<screen>.png            hel skærm, 50/50
    overlay/<screen>/<id>.png       pr. region: reference | render | 50/50
    overlay/<screen>-heat.png       diff-varmekort
    report.html                     alt sammen, sorteret efter værste først

Kør:  python3 tools/judge/overlay.py [--run .judge/latest]
Se plan/architecture-visual-judge-1.md fase 3 (TASK-016) og fase 5 (TASK-028).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "docs/design/reference/registry.json"


def blend(ref: Image.Image, rnd: Image.Image) -> Image.Image:
    if rnd.size != ref.size:
        rnd = rnd.resize(ref.size, Image.LANCZOS)
    return Image.blend(ref.convert("RGB"), rnd.convert("RGB"), 0.5)


def side_by_side(ref: Image.Image, rnd: Image.Image, gap: int = 12) -> Image.Image:
    """Reference | render | 50/50. Tre felter, fordi de tre svarer på hvert
    sit spørgsmål: hvad skulle der stå, hvad står der, og hvor langt er der."""
    if rnd.size != ref.size:
        rnd = rnd.resize(ref.size, Image.LANCZOS)
    mix = blend(ref, rnd)
    w, h = ref.size
    out = Image.new("RGB", (w * 3 + gap * 2, h), (24, 20, 18))
    for i, im in enumerate((ref, rnd, mix)):
        out.paste(im.convert("RGB"), (i * (w + gap), 0))
    return out


def heatmap(ref: Image.Image, rnd: Image.Image) -> Image.Image:
    """Hvor er forskellen? Rød = stor afvigelse. Viser hvilke REGIONER der
    fortjener opmærksomhed, når man ikke ved hvor man skal kigge."""
    if rnd.size != ref.size:
        rnd = rnd.resize(ref.size, Image.LANCZOS)
    a = np.asarray(ref.convert("RGB"), dtype=np.float64)
    b = np.asarray(rnd.convert("RGB"), dtype=np.float64)
    d = np.abs(a - b).mean(axis=2) / 255.0
    base = np.asarray(ref.convert("L"), dtype=np.float64) * 0.45
    out = np.stack([
        np.clip(base + d * 255 * 1.6, 0, 255),
        np.clip(base + (1 - d) * 40, 0, 255),
        np.clip(base, 0, 255),
    ], axis=-1)
    return Image.fromarray(out.astype(np.uint8))


def build(run: Path) -> dict:
    registry = json.loads(REGISTRY.read_text())
    scores_path = run / "scores.json"
    scores = json.loads(scores_path.read_text()) if scores_path.exists() else {"screens": {}}

    for screen in registry["screens"]:
        sid = screen["id"]
        full_render_path = run / "render" / f"{sid}.png"
        if not full_render_path.exists():
            continue
        ref_full = Image.open(ROOT / screen["file"]).convert("RGB")
        rnd_full = Image.open(full_render_path).convert("RGB")

        (run / "overlay" / sid).mkdir(parents=True, exist_ok=True)
        blend(ref_full, rnd_full).save(run / "overlay" / f"{sid}.png")
        heatmap(ref_full, rnd_full).save(run / "overlay" / f"{sid}-heat.png")

        for region in screen["regions"]:
            x, y, w, h = region["rect"]
            ref_crop = ref_full.crop((x, y, x + w, y + h))
            if region.get("mode") == "rect":
                rnd_crop = rnd_full.crop((x, y, x + w, y + h))
            else:
                p = run / "render" / sid / f"{region['id']}.png"
                if not p.exists():
                    continue
                rnd_crop = Image.open(p).convert("RGB")
            side_by_side(ref_crop, rnd_crop).save(
                run / "overlay" / sid / f"{region['id']}.png"
            )
            # Fire rene enkeltbilleder pr. region, ud over triptykonet ovenfor.
            # judge.mjs er ren Node uden noget billedbibliotek — den kan ikke
            # selv klippe et udsnit ud af triptykonet, så vision-modellen skal
            # have hvert billede for sig, allerede beskåret og på samme mål.
            rnd_for_diff = rnd_crop.resize(ref_crop.size, Image.LANCZOS) if rnd_crop.size != ref_crop.size else rnd_crop
            ref_crop.convert("RGB").save(run / "overlay" / sid / f"{region['id']}-ref.png")
            rnd_crop.convert("RGB").save(run / "overlay" / sid / f"{region['id']}-render.png")
            blend(ref_crop, rnd_for_diff).save(run / "overlay" / sid / f"{region['id']}-blend.png")
            heatmap(ref_crop, rnd_for_diff).save(run / "overlay" / sid / f"{region['id']}-heat.png")
    return scores


BAR = (
    '<div class="bar"><span style="width:{pct}%;background:{col}"></span>'
    '<b>{val:.3f}</b></div>'
)


def _colour(v: float, threshold: float) -> str:
    if v >= threshold:
        return "#4f7a45"
    if v >= threshold - 0.15:
        return "#a9722b"
    return "#a24b37"


def report(run: Path, scores: dict) -> Path:
    rows = []
    for sid, s in scores.get("screens", {}).items():
        regions = sorted(s["regions"].items(), key=lambda kv: kv[1]["overall"])
        cards = []
        for rid, r in regions:
            metrics = "".join(
                f"<td>{BAR.format(pct=int(r[m] * 100), col=_colour(r[m], r['threshold']), val=r[m])}</td>"
                for m in ("structure", "tone", "ink", "geometry", "materiality")
            )
            raw = r.get("raw", {})
            hints = []
            if raw.get("deltaE") is not None:
                hints.append(f"ΔE {raw['deltaE']}")
            if raw.get("dx") is not None:
                hints.append(
                    f"forskudt {raw['dx']:+.0f},{raw['dy']:+.0f} px · "
                    f"størrelse {raw['dw']:+.0f},{raw['dh']:+.0f} px"
                )
            if raw.get("missing_anchor"):
                hints.append("ANKER MANGLER")
            cards.append(f"""
            <tr class="head">
              <th colspan="7">
                <span class="dot" style="background:{_colour(r['overall'], r['threshold'])}"></span>
                {rid}
                <em>vægt {r['weight']} · tærskel {r['threshold']:.2f} · i alt {r['overall']:.3f}</em>
                <small>{' · '.join(hints)}</small>
              </th>
            </tr>
            <tr class="nums"><td>struktur</td>{metrics}<td class="w">{r['overall']:.3f}</td></tr>
            <tr class="img"><td colspan="7">
              <img src="overlay/{sid}/{rid}.png" alt="{rid}: reference, render, 50/50" loading="lazy">
              <div class="cap"><span>reference</span><span>vores</span><span>50/50</span></div>
            </td></tr>""")
        rows.append(f"""
        <section>
          <h2>{sid} <em>samlet {s['overall']:.3f}</em></h2>
          <div class="wide">
            <figure><img src="overlay/{sid}.png" loading="lazy"><figcaption>50/50-overlejring</figcaption></figure>
            <figure><img src="overlay/{sid}-heat.png" loading="lazy"><figcaption>afvigelseskort — rød er værst</figcaption></figure>
          </div>
          <table>{''.join(cards)}</table>
        </section>""")

    html = f"""<!doctype html><html lang="da"><head><meta charset="utf-8">
<title>Visuel dommer — rapport</title><style>
:root{{color-scheme:light dark}}
body{{font:15px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0;padding:32px;
background:#14110f;color:#efe4d6}}
h1{{font-size:26px;margin:0 0 6px}} h1 em{{font-weight:400;opacity:.6;font-size:16px}}
h2{{font-size:20px;margin:44px 0 12px;border-bottom:1px solid #3a2f28;padding-bottom:8px}}
h2 em{{font-weight:400;opacity:.65;font-size:15px}}
.wide{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}}
figure{{margin:0}} figure img{{width:100%;border-radius:8px;display:block}}
figcaption{{opacity:.6;font-size:13px;padding-top:5px}}
table{{width:100%;border-collapse:collapse}}
tr.head th{{text-align:left;padding:20px 0 6px;font-size:16px;font-weight:600}}
tr.head em{{font-weight:400;opacity:.55;font-size:13px;margin-left:8px}}
tr.head small{{display:block;opacity:.75;font-weight:400;font-size:12.5px;
margin-top:3px;color:#e0b98f}}
.dot{{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}}
tr.nums td{{font-size:12px;opacity:.85;padding:2px 6px 2px 0;width:16%}}
tr.nums td.w{{font-weight:700;opacity:1}}
.bar{{position:relative;background:#2b2320;border-radius:3px;height:17px}}
.bar span{{position:absolute;inset:0 auto 0 0;border-radius:3px}}
.bar b{{position:relative;font-size:11px;padding-left:5px;line-height:17px;
mix-blend-mode:difference;color:#fff}}
tr.img td{{padding:8px 0 14px}} tr.img img{{width:100%;border-radius:6px;display:block}}
.cap{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:11.5px;
opacity:.5;padding-top:4px;text-align:center}}
</style></head><body>
<h1>Visuel dommer <em>— afstand til referencen, region for region</em></h1>
<p style="opacity:.7;max-width:70ch;margin:0 0 8px">Sorteret med det værste
først. Fem ortogonale mål, fordi en helhedsscore skjuler netop de fejl der
betyder noget. Midterste billede i hver stribe er vores; det tredje er
50/50-overlejringen.</p>
{''.join(rows)}
</body></html>"""
    out = run / "report.html"
    out.write_text(html)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=".judge/latest")
    args = ap.parse_args()
    run = ROOT / args.run
    scores = build(run)
    out = report(run, scores)
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
