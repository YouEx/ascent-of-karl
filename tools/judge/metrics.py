#!/usr/bin/env python3
"""Metrikker — den visuelle dommers målebånd.

Fem ORTOGONALE tal pr. region. Ortogonale er hele pointen: en helhedsscore
skjuler netop de fejl, vi jagter. Baggrundsmaleriet fylder over halvdelen af
pixels, så en forkert skriftstørrelse i titellinjen rykker en global SSIM med
under 0,001. En score på 0,72 er ikke handlingsanvisende.

    structure    form og layout, uden farve  (SSIM på gradientmagnitude)
    tone         paletten                    (ΔE2000 mellem regionsmedianer)
    ink          typografisk vægt og størrelse (mørk-pixel-dækning)
    geometry     position og størrelse       (DOM-boks mod referencerektangel)
    materiality  malet tekstur mod flad CSS-farve (højpas-energi)

`materiality` findes, fordi ingen standardmetrik navngiver vores STØRSTE
defektklasse. En flad #ECDCC7 og et malet pergament har næsten samme median og
kan have samme SSIM — men den ene er tom. Uden dette tal ville dommeren
foreslå farvejusteringer i det uendelige til noget, der mangler en tekstur.

Alle fem returnerer 0..1 hvor 1 = identisk med referencen.

Kør:  python3 tools/judge/metrics.py [--run .judge/latest] [--json]
Se plan/architecture-visual-judge-1.md fase 3 (TASK-014, TASK-015).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "docs/design/reference/registry.json"

# ---------------------------------------------------------------- hjælpere


def _to_gray(a: np.ndarray) -> np.ndarray:
    # Rec. 709-luma. Et rent gennemsnit ville gøre en mættet okker lige så lys
    # som et blegt pergament, og så måler `structure` farve i stedet for form.
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separabel gaussisk sløring i ren numpy.

    PIL's GaussianBlur nægter float-billeder ("image has wrong mode"), og
    scipy er ikke en afhængighed vi vil tage for atten array-additioner.
    """
    r = max(1, int(round(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-(x**2) / (2 * sigma**2))
    k /= k.sum()

    pad = np.pad(a, ((0, 0), (r, r)), mode="reflect")
    tmp = np.zeros_like(a, dtype=np.float64)
    for i, w in enumerate(k):
        tmp += w * pad[:, i : i + a.shape[1]]

    pad = np.pad(tmp, ((r, r), (0, 0)), mode="reflect")
    out = np.zeros_like(a, dtype=np.float64)
    for i, w in enumerate(k):
        out += w * pad[i : i + a.shape[0], :]
    return out


def _resize_to(a: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Skalerer renderen til referencens mål.

    Størrelsesforskelle fanges af `geometry` og skal IKKE også forurene
    `structure`. Normaliseres de ikke væk her, ville ét fejlmål blive
    rapporteret som fire forskellige defekter.
    """
    h, w = shape
    img = Image.fromarray(a.astype(np.uint8))
    return np.asarray(img.resize((w, h), Image.LANCZOS), dtype=np.float64)


def _ssim(x: np.ndarray, y: np.ndarray) -> float:
    """SSIM med gaussisk vindue. Egen implementering frem for scikit-image:
    afhængigheden er tung, og formlen er tyve linjer (DEP-002)."""
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    r = 1.5
    mx, my = _blur(x, r), _blur(y, r)
    mxx, myy, mxy = mx * mx, my * my, mx * my
    sxx = _blur(x * x, r) - mxx
    syy = _blur(y * y, r) - myy
    sxy = _blur(x * y, r) - mxy
    num = (2 * mxy + c1) * (2 * sxy + c2)
    den = (mxx + myy + c1) * (sxx + syy + c2)
    return float(np.clip((num / np.maximum(den, 1e-12)).mean(), 0.0, 1.0))


def _srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB 0-255 → CIELAB (D65). Vektoriseret over vilkårlig form."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = c @ m.T / np.array([0.95047, 1.00000, 1.08883])
    eps = 216 / 24389
    kappa = 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)


def delta_e_2000(lab1: np.ndarray, lab2: np.ndarray) -> float:
    """CIEDE2000. ΔE76 ville være nok til at skelne rød fra blå, men vores
    palet er seks nærtbeslægtede varme tan-nuancer, og der lyver ΔE76."""
    l1, a1, b1 = (float(v) for v in lab1)
    l2, a2, b2 = (float(v) for v in lab2)
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    cbar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(cbar**7 / (cbar**7 + 25**7))) if cbar > 0 else 0.5
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0

    dlp = l2 - l1
    dcp = c2p - c1p
    if c1p * c2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dHp = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dhp) / 2)

    lbar = (l1 + l2) / 2
    cbarp = (c1p + c2p) / 2
    if c1p * c2p == 0:
        hbarp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbarp = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hbarp = (h1p + h2p + 360) / 2
    else:
        hbarp = (h1p + h2p - 360) / 2

    t = (
        1
        - 0.17 * math.cos(math.radians(hbarp - 30))
        + 0.24 * math.cos(math.radians(2 * hbarp))
        + 0.32 * math.cos(math.radians(3 * hbarp + 6))
        - 0.20 * math.cos(math.radians(4 * hbarp - 63))
    )
    dtheta = 30 * math.exp(-(((hbarp - 275) / 25) ** 2))
    rc = 2 * math.sqrt(cbarp**7 / (cbarp**7 + 25**7)) if cbarp > 0 else 0.0
    sl = 1 + (0.015 * (lbar - 50) ** 2) / math.sqrt(20 + (lbar - 50) ** 2)
    sc = 1 + 0.045 * cbarp
    sh = 1 + 0.015 * cbarp * t
    rt = -math.sin(math.radians(2 * dtheta)) * rc
    return math.sqrt(
        (dlp / sl) ** 2
        + (dcp / sc) ** 2
        + (dHp / sh) ** 2
        + rt * (dcp / sc) * (dHp / sh)
    )


# ---------------------------------------------------------------- metrikker


def m_structure(ref: np.ndarray, rnd: np.ndarray) -> float:
    """Form og layout uden farve. Gradientmagnitude frem for rå gråtone: den
    er ligeglad med, at vores papir er en anelse lysere, og fanger i stedet
    hvor kanterne ligger."""
    gr, gd = _to_gray(ref), _to_gray(rnd)
    def grad(g):
        gx = np.zeros_like(g); gy = np.zeros_like(g)
        gx[:, 1:-1] = g[:, 2:] - g[:, :-2]
        gy[1:-1, :] = g[2:, :] - g[:-2, :]
        return np.hypot(gx, gy)
    return _ssim(grad(gr), grad(gd))


def m_tone(ref: np.ndarray, rnd: np.ndarray) -> tuple[float, float]:
    """Paletten. Median frem for gennemsnit: en enkelt mørk overskrift må ikke
    trække hele fladens farve med sig.

    Eksponentielt henfald frem for lineær afskæring. En lineær `1 - ΔE/12`
    rammer nul ved ΔE 12 — og vores værste region ligger på 13,7. Så ville en
    ægte forbedring fra 13,7 til 12,5 stadig aflæses som 0,000, accept-porten
    ville forkaste rettelsen, og sløjfen kunne aldrig komme i gang. Metrikken
    skal være strengt aftagende over HELE sit område, ellers er den ubrugelig
    som gradient.
    """
    lab_r = _srgb_to_lab(np.median(ref.reshape(-1, 3), axis=0))
    lab_d = _srgb_to_lab(np.median(rnd.reshape(-1, 3), axis=0))
    de = delta_e_2000(lab_r, lab_d)
    return float(math.exp(-de / 8.0)), de


def m_ink(ref: np.ndarray, rnd: np.ndarray) -> float:
    """Typografisk vægt og størrelse. Måler hvor stor en andel af fladen der
    er blæk, relativt til fladens EGET papirniveau — ellers ville et lysere
    papir alene se ud som tyndere tekst."""
    def coverage(a):
        g = _to_gray(a)
        paper = np.percentile(g, 85)
        return float((g < paper - 28).mean())
    cr, cd = coverage(ref), coverage(rnd)
    if cr == 0 and cd == 0:
        return 1.0
    return float(1.0 - abs(cr - cd) / max(cr, cd, 1e-6))


def m_geometry(rect: list[int], box: dict | None, scale: float) -> tuple[float, dict]:
    """Position og størrelse — fra DOM-målene, ikke fra pixels. Mangler
    ankeret, er afstanden total; det er præcis, hvad en manglende komponent er.

    Samme eksponentielle henfald som `tone` og af samme grund: en region der
    ligger 400 px forkert, skal stadig kunne VISE fremgang, når den kommer
    ned på 200 px. Klipper metrikken til nul, står sløjfen i stampe."""
    if not box:
        return 0.0, {"missing_anchor": True}
    rx, ry, rw, rh = rect
    dx_px = box["x"] * scale - rx
    dy_px = box["y"] * scale - ry
    dw_px = box["width"] * scale - rw
    dh_px = box["height"] * scale - rh
    err = (
        abs(dx_px) / max(rw, 1)
        + abs(dy_px) / max(rh, 1)
        + abs(dw_px) / max(rw, 1)
        + abs(dh_px) / max(rh, 1)
    )
    raw = {
        "dx": round(dx_px, 1), "dy": round(dy_px, 1),
        "dw": round(dw_px, 1), "dh": round(dh_px, 1),
        "ref": rect,
        "got": [round(box["x"], 1), round(box["y"], 1),
                round(box["width"], 1), round(box["height"], 1)],
    }
    return float(math.exp(-2.0 * err)), raw


def m_materiality(ref: np.ndarray, rnd: np.ndarray) -> float:
    """Malet tekstur mod flad CSS-farve.

    Højpasenergi: fladen minus sin egen slørede udgave. Et pergament har korn
    over hele fladen; en CSS-farve har nul. Vi måler FORHOLDET, ikke
    forskellen, så en flade med dobbelt så meget korn straffes lige så meget
    som en med halvt.
    """
    def energy(a):
        g = _to_gray(a)
        return float(np.std(g - _blur(g, 2.0)))
    er, ed = energy(ref), energy(rnd)
    if er < 1e-6:
        return 1.0
    return float(max(0.0, 1.0 - abs(ed - er) / er))


def _tone_only(ref: np.ndarray, rnd: np.ndarray) -> float:
    """Kun scoren fra m_tone — selftesten sammenligner tal, ikke tupler."""
    return m_tone(ref, rnd)[0]


METRIC_NAMES = ("structure", "tone", "ink", "geometry", "materiality")


def score_region(ref_img: Image.Image, region: dict, box: dict | None,
                 render_crop: Path, full_render: Path, scale: float) -> dict:
    x, y, w, h = region["rect"]
    ref = np.asarray(ref_img.crop((x, y, x + w, y + h)).convert("RGB"), dtype=np.float64)

    # Nogle regioner er MALEDE FLADER, ikke DOM-elementer (fx landskabet på
    # titelskærmen). De har intet anker at klippe efter, så de klippes ud af
    # helskærmsbilledet på referencens eget rektangel. Viewporten er sat til
    # referencens native mål, så udsnittet er præcist.
    rect_mode = region.get("mode") == "rect"
    empty = {**{n: 0.0 for n in METRIC_NAMES}, "overall": 0.0,
             "missing": True, "raw": {}}

    if rect_mode:
        if not full_render.exists():
            return empty
        rnd = np.asarray(
            Image.open(full_render).convert("RGB").crop((x, y, x + w, y + h)),
            dtype=np.float64,
        )
    else:
        if not render_crop.exists():
            return empty
        rnd = np.asarray(Image.open(render_crop).convert("RGB"), dtype=np.float64)
        rnd = _resize_to(rnd, ref.shape[:2])

    tone, delta_e = m_tone(ref, rnd)
    if rect_mode:
        # Uden anker er der intet at måle position på, og en kunstig 0 ville
        # trække regionen ned for en fejl, der ikke findes.
        geom, geom_raw = 1.0, {"mode": "rect"}
    else:
        geom, geom_raw = m_geometry(region["rect"], box, scale)

    out = {
        "structure": m_structure(ref, rnd),
        "tone": tone,
        "ink": m_ink(ref, rnd),
        "geometry": geom,
        "materiality": m_materiality(ref, rnd),
    }
    out["overall"] = float(sum(out[n] for n in METRIC_NAMES) / len(METRIC_NAMES))
    out["missing"] = False
    # Rå tal, så dommeren kan sige "ΔE er 13,7" i stedet for "farven ser
    # forkert ud", og foreslå en konkret værdi frem for en retning.
    out["raw"] = {"deltaE": round(delta_e, 2), **geom_raw}
    return out


def score_screen(screen: dict, run: Path) -> dict:
    ref_img = Image.open(ROOT / screen["file"]).convert("RGB")
    metrics_path = run / "metrics" / f"{screen['id']}.json"
    dom = json.loads(metrics_path.read_text())["regions"] if metrics_path.exists() else {}

    # Viewporten SÆTTES til referencens native mål af capture.mjs, så skalaen
    # er 1. Feltet findes alligevel, så en fremtidig optagelse ved anden
    # opløsning ikke lydløst giver forkerte geometrital.
    scale = 1.0
    full_render = run / "render" / f"{screen['id']}.png"

    regions = {}
    for region in screen["regions"]:
        entry = dom.get(region["id"], {})
        crop = run / "render" / screen["id"] / f"{region['id']}.png"
        regions[region["id"]] = {
            **score_region(ref_img, region, entry.get("box"), crop, full_render, scale),
            "weight": region.get("weight", 1),
            "threshold": region.get("threshold", 0.85),
        }

    total_w = sum(r["weight"] for r in regions.values()) or 1
    overall = sum(r["overall"] * r["weight"] for r in regions.values()) / total_w
    failing = [k for k, v in regions.items() if v["overall"] < v["threshold"]]
    return {"screen": screen["id"], "overall": overall,
            "failing": failing, "regions": regions}


def selftest() -> int:
    """TEST-002/TEST-003. En itu metrik kan se ud som fremskridt; derfor
    efterprøves målebåndet selv, før nogen tror på et tal."""
    fails = []

    # ΔE2000 mod Sharmas kendte prøvepar
    for lab1, lab2, want in [
        ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
        ((50.0, 2.4900, -0.0010), (50.0, -2.4900, 0.0009), 7.1792),
        ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
    ]:
        got = delta_e_2000(np.array(lab1), np.array(lab2))
        if abs(got - want) > 0.01:
            fails.append(f"ΔE2000 {lab1}->{lab2}: fik {got:.4f}, ventede {want}")

    rng = np.random.default_rng(7)
    a = rng.integers(60, 200, size=(64, 64, 3)).astype(np.float64)

    # Identisk med sig selv → 1,0 på alle fem
    for name, fn in (("structure", m_structure), ("tone", _tone_only),
                     ("ink", m_ink), ("materiality", m_materiality)):
        v = fn(a, a.copy())
        if v < 0.999:
            fails.append(f"{name}(a,a) = {v:.4f}, ventede 1.0")

    # Mod en sort flade → lavt på alle fem
    black = np.zeros_like(a)
    for name, fn in (("structure", m_structure), ("tone", _tone_only),
                     ("materiality", m_materiality)):
        v = fn(a, black)
        if v > 0.5:
            fails.append(f"{name}(a,sort) = {v:.4f}, ventede <0.5")

    # TEST-003: materiality skal SKELNE flad farve fra tekstur
    flat = np.full((64, 64, 3), 236.0)
    textured = flat + rng.normal(0, 9, size=flat.shape)
    v_flat = m_materiality(textured, flat)
    v_tex = m_materiality(textured, textured + rng.normal(0, 0.3, flat.shape))
    if not (v_flat < 0.35 < v_tex):
        fails.append(f"materiality skelner ikke: flad={v_flat:.3f} tekstur={v_tex:.3f}")

    # geometry: perfekt boks → 1,0; manglende anker → 0,0
    if abs(m_geometry([10, 20, 100, 50], {"x": 10, "y": 20, "width": 100, "height": 50}, 1.0)[0] - 1.0) > 1e-9:
        fails.append("geometry(perfekt) != 1.0")
    if m_geometry([10, 20, 100, 50], None, 1.0)[0] != 0.0:
        fails.append("geometry(manglende) != 0.0")

    # Monotoni: tone og geometry maa ALDRIG saturere. En metrik der klipper
    # til nul kan ikke vise fremgang, og accept-porten ville forkaste aegte
    # rettelser. Det var en rigtig fejl i foerste udgave (ΔE 13,7 -> 0,000).
    worse = _tone_only(np.full((8, 8, 3), 236.0), np.full((8, 8, 3), 40.0))
    better = _tone_only(np.full((8, 8, 3), 236.0), np.full((8, 8, 3), 120.0))
    if not (0.0 < worse < better < 1.0):
        fails.append(f"tone saturerer: vaerre={worse:.5f} bedre={better:.5f}")
    g_far = m_geometry([0, 0, 100, 50], {"x": 400, "y": 0, "width": 100, "height": 50}, 1.0)[0]
    g_near = m_geometry([0, 0, 100, 50], {"x": 200, "y": 0, "width": 100, "height": 50}, 1.0)[0]
    if not (0.0 < g_far < g_near < 1.0):
        fails.append(f"geometry saturerer: fjern={g_far:.5f} naer={g_near:.5f}")

    for f in fails:
        print("FEJL:", f)
    print("selftest:", "bestået" if not fails else f"{len(fails)} fejl")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=".judge/latest")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--baseline", help="tidligere scores.json at vise delta mod")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    run = ROOT / args.run
    registry = json.loads(REGISTRY.read_text())
    prev = {}
    if args.baseline and (ROOT / args.baseline).exists():
        prev = json.loads((ROOT / args.baseline).read_text())

    result = {"screens": {}}
    for screen in registry["screens"]:
        result["screens"][screen["id"]] = score_screen(screen, run)

    # Én samlet score på tværs af skærme. Accept-porten læser netop dette felt,
    # og uden det kastede den TypeError frem for at fælde dom — en port, der
    # fejler i stedet for at afvise, er værre end ingen port.
    # Vægtet efter regionsantal, så en skærm med ni regioner ikke tæller lige
    # så meget som én med to.
    n = sum(len(s["regions"]) for s in result["screens"].values())
    result["overall"] = round(
        sum(s["overall"] * len(s["regions"]) for s in result["screens"].values()) / n, 6
    ) if n else 0.0

    out = run / "scores.json"
    out.write_text(json.dumps(result, indent=2))

    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    for sid, s in result["screens"].items():
        print(f"\n{sid}  samlet {s['overall']:.3f}")
        print(f"  {'region':<12} {'struct':>7} {'tone':>7} {'ink':>7} "
              f"{'geom':>7} {'mater':>7} {'I ALT':>7}  {'Δ':>7}")
        for rid, r in sorted(s["regions"].items(), key=lambda kv: kv[1]["overall"]):
            before = prev.get("screens", {}).get(sid, {}).get("regions", {}).get(rid, {})
            delta = f"{r['overall'] - before['overall']:+.3f}" if before else "     —"
            flag = " " if r["overall"] >= r["threshold"] else "✗"
            print(f"{flag} {rid:<12} {r['structure']:>7.3f} {r['tone']:>7.3f} "
                  f"{r['ink']:>7.3f} {r['geometry']:>7.3f} {r['materiality']:>7.3f} "
                  f"{r['overall']:>7.3f}  {delta:>7}")
        if s["failing"]:
            print(f"  under tærskel: {', '.join(s['failing'])}")
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
