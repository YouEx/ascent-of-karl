"""Skærer den udskårne stentavle ud af det billede, den blev malet på.

Kombinér-knappen er spillets primære handling og var en flad cremefarvet
pille med brun tekst. Referencen har en udskåret stentavle: faset inderramme,
chevron-ornament over og under teksten, og hvid antikva med mørk skygge.
Regionen målte 0.212 — den laveste på hele skærmen.

Tavlen er malet UDEN tekst med vilje. Teksten bliver liggende som rigtig
tekst i DOM'en, så den kan markeres, oplæses og oversættes; et billede med
"Combine" brændt ind ville koste alt det for ingenting.

Den skæres ikke som skydedør. `build_ui.py` deler knapper i venstre hætte,
gentaget midtersøjle og højre hætte, så de kan være vilkårligt brede — men
tavlens ornamenter er centrerede, og en gentaget midtersøjle ville sluge dem.
Knappen er også den ene faste størrelse i doket, ikke en, der følger sit
indhold. Derfor ét billede, strakt til knappens kasse.

Alfa hentes ud af afstanden til den flade cremebaggrund, samme metode som
`build_elements.py`. Farven trækkes bagefter ned, så tavlens median rammer
referencens #ad8667: generatoren maler lysere og mere orange end mockuppen,
og forskellen ses tydeligt ved siden af de øvrige brune flader.

Kør: python3 tools/art/build_combine_slab.py [sti/til/kilde.webp]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/design/reference/combine-slab-src.webp"
OUT = ROOT / "src/assets/art/ui/combine-slab.webp"

TARGET_MEDIAN = (0xAD, 0x86, 0x67)  # målt i referencens knapregion (1058,578,157,109)
WIDTH = 314                          # 2x referencens 157 px
ASPECT = 157 / 109
REF_SPREAD = 49                      # p85-p15 luminans målt i referencens knapregion
ALPHA_FLOOR = 10
ALPHA_FULL = 46


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    if not src.exists():
        raise SystemExit(f"mangler {src}\nSe scriptets docstring.")

    a = np.asarray(Image.open(src).convert("RGB")).astype(np.float64)
    border = np.concatenate([
        a[:10].reshape(-1, 3), a[-10:].reshape(-1, 3),
        a[:, :10].reshape(-1, 3), a[:, -10:].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)

    dist = np.abs(a - bg).max(axis=2)
    alpha = np.clip((dist - ALPHA_FLOOR) / (ALPHA_FULL - ALPHA_FLOOR), 0.0, 1.0)
    safe = np.maximum(alpha, 1e-6)[..., None]
    fg = np.clip((a - (1.0 - alpha)[..., None] * bg) / safe, 0, 255)

    solid = alpha > 0.9
    if solid.sum() < 1000:
        raise SystemExit("fandt ingen tavle — baggrunden er ikke flad nok.")
    ys, xs = np.where(solid)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

    # Farven rettes mod referencens median, ikke mod et skøn. En ren
    # multiplikation frem for et additivt skift: skyggerne i fordybningerne
    # skal blive dybere sammen med fladen, ellers flader relieffet ud.
    # Tonalt spænd rettes FØRST. Generatoren maler stenen FLAD: målt over
    # knapregionen spænder referencen 49 luminanstrin fra p15 til p85 (lys på
    # den øverste facet, forvitring og skygge i kanterne), mens den malede
    # tavle kun spændte 19. Forskellen er ikke kosmetisk — en flad sten ligner
    # plastic ved siden af referencens forvitrede.
    #
    # Strækkes på LUMINANS alene, ikke kanal for kanal. En kanalvis strækning
    # om luminansmedianen klipper de mættede kanaler — målt: blå endte på 0,
    # medianen blev #fa6f00 og kulørrettelsen bagefter dividerede med nul.
    # Her skaleres hver pixels RGB-triple med forholdet mellem ny og gammel
    # luminans, så kulør og mætning står uændret.
    lum = fg[..., 0] * 0.299 + fg[..., 1] * 0.587 + fg[..., 2] * 0.114
    inside = solid & (alpha > 0.99)
    lo, hi = np.percentile(lum[inside], [15, 85])
    spread = max(hi - lo, 1e-6)
    contrast = REF_SPREAD / spread
    mid = float(np.median(lum[inside]))
    target = np.clip((lum - mid) * contrast + mid, 0.0, 255.0)
    fg = np.clip(fg * (target / np.maximum(lum, 1.0))[..., None], 0, 255)
    print(f"  tonalt spænd {spread:.0f} → {REF_SPREAD} (kontrast x{contrast:.2f})")

    # Farven rettes BAGEFTER, ikke før. Strækket klipper mod 0 og 255 og
    # flytter derved medianen; rettes kuløren først, river strækket den skæv
    # igen (målt: tone faldt 0.918 → 0.178 i den rækkefølge).
    #
    # Ren multiplikation frem for et additivt skift: skyggerne i
    # fordybningerne skal blive dybere sammen med fladen, ellers flader
    # relieffet ud.
    have = np.median(fg[y0:y1, x0:x1][solid[y0:y1, x0:x1]], axis=0)
    gain = np.array(TARGET_MEDIAN, dtype=np.float64) / np.maximum(have, 1e-6)
    fg = np.clip(fg * gain, 0, 255)
    print("  median #%02x%02x%02x → #%02x%02x%02x  (gain %.2f %.2f %.2f)"
          % (*have.astype(int), *TARGET_MEDIAN, *gain))

    rgba = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    slab = Image.fromarray(rgba).crop((int(x0), int(y0), int(x1), int(y1)))

    # Tavlen males kvadratisk (760x760), knappen er 1.44 bred. Den strækkes
    # IKKE: 21 % vandret stræk trak bjergtoppene og diamanten skæve, og det
    # var netop ornamenterne der skulle bære ligheden med referencen.
    #
    # I stedet fjernes et bånd MIDT i den tomme sten mellem de to ornamenter.
    # Båndet er ensfarvet slebet sten, så sømmen er usynlig, og begge
    # ornamenter beholder deres malede proportioner præcist.
    need_h = int(round(slab.width / ASPECT))
    cut = slab.height - need_h
    if cut < 0:
        raise SystemExit(f"kilden er allerede for lav: {slab.width}x{slab.height}")
    if cut:
        band = _flattest_band(np.asarray(slab.convert("RGB")).astype(np.float64), cut)
        top = slab.crop((0, 0, slab.width, band))
        bottom = slab.crop((0, band + cut, slab.width, slab.height))
        joined = Image.new("RGBA", (slab.width, need_h))
        joined.paste(top, (0, 0))
        joined.paste(bottom, (0, band))
        print(f"  fjernede {cut} px tomt bånd fra y={band} (ingen stræk)")
        slab = joined

    out = slab.resize((WIDTH, int(round(WIDTH / ASPECT))), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, "WEBP", quality=90, method=6)
    print(f"  {OUT.relative_to(ROOT)}  {out.width}x{out.height}  "
          f"{OUT.stat().st_size / 1024:.1f} kB")


def _flattest_band(rgb: np.ndarray, cut: int) -> int:
    """Finder det roligste vandrette bånd at klippe ud.

    Scorer hver mulig startrække på, hvor lidt rækkerne varierer indbyrdes:
    rammer båndet et ornament eller den facede kant, springer scoren, og
    sømmen ville ses. Søgningen holder sig fra de yderste 12 % af højden, så
    den aldrig spiser af facetten.
    """
    h = rgb.shape[0]
    row_mean = rgb.mean(axis=(1, 2))
    guard = int(h * 0.12)
    best, best_score = guard, float("inf")
    for y in range(guard, h - cut - guard):
        score = float(np.ptp(row_mean[y:y + cut]))
        if score < best_score:
            best, best_score = y, score
    return best


if __name__ == "__main__":
    main()
