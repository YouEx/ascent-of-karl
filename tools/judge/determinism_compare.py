#!/usr/bin/env python3
"""Determinisme-komparatoren — TEST-001s dommer over sig selv.

Sammenligner N optagelser af SAMME scenarie parvist og måler to tal:

    afvigende pixel   antal pixel, hvor mindst én kanal ikke er identisk
    kanaldelta        den STØRSTE forskel i én enkelt kanal, hvor som helst

Grænsen (TASK-006/TEST-001) er 100 afvigende pixel OG maks. kanaldelta
12/255, sat med rigelig margin over det faktisk målte (~43 pixel, delta 7)
efter grain-bagningen — se src/ui/tokens.css' body::after og
tools/art/build_body_grain.mjs for hele diagnosen. Parvis (alle par, ikke
kun mod én kanonisk kørsel) betyder den rapporterede værste afvigelse er den
SANDE værste på tværs af samtlige kørsler, ikke kun afstanden til én
vilkårligt valgt "kanonisk" optagelse.

`--selftest` beviser grænsen selv, med syntetiske billeder hvor antal
afvigende pixel og kanaldelta er kendte PRÆCIS — ikke skærmbilleder, hvor
Chromiums egen ikke-determinisme ville gøre en selvtest af selve
målebåndet lige så ureproducerbar som det, den skal måle.

Kør:
  python3 tools/judge/determinism_compare.py --selftest
  python3 tools/judge/determinism_compare.py --paths a.png b.png c.png ...
Se plan/architecture-visual-judge-1.md TASK-006, TEST-001.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def load(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"), dtype=np.uint8)


def compare_pair(a: np.ndarray, b: np.ndarray) -> tuple[int, int]:
    """Returnerer (afvigende pixel, maks. kanaldelta) for ét billedpar."""
    if a.shape != b.shape:
        raise ValueError(f"billedstørrelse stemmer ikke overens: {a.shape} vs {b.shape}")
    # int16 FØR subtraktion — uint8-underløb ville gøre 5 - 250 til 11, ikke -245.
    diff = np.abs(a.astype(np.int16) - b.astype(np.int16))
    max_delta = int(diff.max()) if diff.size else 0
    differing_pixels = int(np.any(diff > 0, axis=-1).sum())
    return differing_pixels, max_delta


def compare_all(paths: list[str], max_pixels: int, max_delta: int) -> dict:
    """Sammenligner alle par blandt `paths` og finder den VÆRSTE afvigelse
    på tværs af samtlige par — ikke kun mod én kanonisk kørsel."""
    images = [(p, load(Path(p))) for p in paths]
    worst_pixels = 0
    worst_delta = 0
    worst_pixels_pair: tuple[str, str] | None = None
    worst_delta_pair: tuple[str, str] | None = None
    pairs = []
    for i in range(len(images)):
        for j in range(i + 1, len(images)):
            pi, a = images[i]
            pj, b = images[j]
            px, delta = compare_pair(a, b)
            pairs.append({"a": pi, "b": pj, "pixels": px, "delta": delta})
            if px > worst_pixels:
                worst_pixels, worst_pixels_pair = px, (pi, pj)
            if delta > worst_delta:
                worst_delta, worst_delta_pair = delta, (pi, pj)
    passed = worst_pixels <= max_pixels and worst_delta <= max_delta
    return {
        "passed": passed,
        "n_runs": len(paths),
        "n_pairs": len(pairs),
        "max_pixels_allowed": max_pixels,
        "max_delta_allowed": max_delta,
        "worst_pixels": worst_pixels,
        "worst_delta": worst_delta,
        "worst_pixels_pair": worst_pixels_pair,
        "worst_delta_pair": worst_delta_pair,
        "pairs": pairs,
    }


def _make_pair(shape: tuple[int, int, int], n_diff: int, delta: int) -> tuple[np.ndarray, np.ndarray]:
    """Bygger to billeder, der afviger i PRÆCIS `n_diff` pixel med PRÆCIS
    kanaldelta `delta` — ingen browser, ingen rasterisering, kun kendte tal.
    Ændrer kun én kanal pr. valgt pixel, så maks. kanaldelta bliver netop
    `delta`, ikke summen af flere kanalers ændringer."""
    rng = np.random.default_rng(42)
    base = np.full(shape, 100, dtype=np.uint8)
    other = base.copy()
    flat = other.reshape(-1, shape[-1])
    idx = rng.choice(flat.shape[0], size=n_diff, replace=False)
    flat[idx, 0] = 100 + delta
    return base, other


def selftest() -> int:
    """Beviser grænsen 100 px / 12-delta selv, før den bruges til at dømme
    rigtige optagelser. Uden denne er tolerancen en påstand, ikke et tal.

    To lag pr. grænsetilfælde: (1) `compare_pair` returnerer PRÆCIS det
    forventede antal afvigende pixel og kanaldelta — beviser selve tallene.
    (2) `compare_all` — den FAKTISKE funktion porten kalder — træffer den
    rigtige accept/afvis-dom på et rigtigt (midlertidigt) PNG-par, ikke en
    ombygget kopi af tolerance-formlen her i selvtesten. Uden lag 2 kunne
    denne selvtest bestå, selvom en fremtidig fejl i compare_all (fx `<`
    byttet om til `<=`, eller omvendt) aldrig blev fanget."""
    fails = []
    shape = (20, 20, 3)  # 400 pixel i alt — nok plads til 101 afvigende

    def save_pair(a: np.ndarray, b: np.ndarray, tmpdir: str) -> list[str]:
        pa, pb = Path(tmpdir) / "a.png", Path(tmpdir) / "b.png"
        Image.fromarray(a).save(pa)
        Image.fromarray(b).save(pb)
        return [str(pa), str(pb)]

    cases = [
        # (n_diff, delta, forventet_passed, beskrivelse)
        (100, 12, True, "grænsen selv (100 px / delta 12) skal bestå"),
        (101, 12, False, "101 afvigende pixel (1 over grænsen) skal fejle"),
        (100, 13, False, "kanaldelta 13 (1 over grænsen) skal fejle"),
        (0, 0, True, "identiske billeder skal bestå"),
    ]
    for n_diff, delta, want_pass, desc in cases:
        a, b = _make_pair(shape, n_diff, delta)
        px, got_delta = compare_pair(a, b)
        if (px, got_delta) != (n_diff, delta):
            fails.append(f"fixtur n_diff={n_diff} delta={delta} gav px={px} delta={got_delta} — kildefixturen selv er forkert")
            continue
        with tempfile.TemporaryDirectory() as td:
            result = compare_all(save_pair(a, b, td), max_pixels=100, max_delta=12)
        if result["passed"] != want_pass:
            fails.append(f"{desc}: compare_all gav passed={result['passed']}")

    # compare_all() skal finde den VÆRSTE af flere par, ikke bare det første,
    # og sammenligne ALLE par (C(n,2)), ikke kun mod én kanonisk kørsel.
    a0 = np.full(shape, 100, dtype=np.uint8)
    _, c = _make_pair(shape, 5, 3)
    _, e = _make_pair(shape, 50, 20)
    imgs = [a0, a0.copy(), c, e]
    with tempfile.TemporaryDirectory() as td:
        paths = []
        for i, arr in enumerate(imgs):
            p = Path(td) / f"run{i}.png"
            Image.fromarray(arr).save(p)
            paths.append(str(p))
        result = compare_all(paths, max_pixels=100, max_delta=12)
        if result["worst_delta"] != 20:
            fails.append(f"compare_all fandt ikke værste delta (20) blandt flere par: fik {result['worst_delta']}")
        if result["passed"]:
            fails.append("compare_all accepterede delta 20 > grænsen 12 — skal fejle")
        if result["n_pairs"] != 6:  # C(4,2)
            fails.append(f"compare_all sammenlignede {result['n_pairs']} par, ventede 6 (C(4,2))")

    for f in fails:
        print("FEJL:", f)
    print("selftest:", "bestået" if not fails else f"{len(fails)} fejl")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--paths", nargs="+", help="PNG-filer at sammenligne parvist (mindst 2)")
    ap.add_argument("--max-pixels", type=int, default=100)
    ap.add_argument("--max-delta", type=int, default=12)
    ap.add_argument("--out", help="skriv result.json i denne mappe")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    if not args.paths or len(args.paths) < 2:
        print("brug: --paths <fil1.png> <fil2.png> [...flere] (mindst 2)", file=sys.stderr)
        return 2

    result = compare_all(args.paths, args.max_pixels, args.max_delta)

    if args.out:
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "result.json").write_text(json.dumps(result, indent=2))

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"{result['n_pairs']} par sammenlignet på tværs af {result['n_runs']} optagelser")
        print(f"  værste afvigende pixel:  {result['worst_pixels']:>4}  (grænse {args.max_pixels})")
        print(f"  værste kanaldelta:       {result['worst_delta']:>4}  (grænse {args.max_delta})")
        if result["worst_pixels_pair"]:
            print(f"    pixel-værste par: {Path(result['worst_pixels_pair'][0]).parent.parent.name} "
                  f"vs {Path(result['worst_pixels_pair'][1]).parent.parent.name}")
        if result["worst_delta_pair"]:
            print(f"    delta-værste par: {Path(result['worst_delta_pair'][0]).parent.parent.name} "
                  f"vs {Path(result['worst_delta_pair'][1]).parent.parent.name}")
        print("bestået — inden for målt tolerance" if result["passed"] else "FEJLET — overskrider tolerance")

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
