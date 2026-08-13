#!/usr/bin/env python3
"""Kører hele den deterministiske art-pipeline i rigtig rækkefølge.

De første scripts skærer krom og elementkunst ud af de committede referencebilleder i
`docs/design/reference/` — det er samme håndværk som `tools/social/`, bare
uden en fælles CLI, fordi de er skrevet ét ad gangen efterhånden som
dommeren fandt næste forkerte flade. Denne fil samler dem, den erstatter dem
ikke: hvert script beholder sin egen `main()` og kan stadig køres alene.

Rækkefølgen er ikke vilkårlig, og ikke alfabetisk. To par har en ægte
afhængighed:

- `build_bg_wide.py` skriver `bg-wide-2560.webp`, og `build_app_texture.py`
  læser den fil igen. Producenten kører derfor først.
- `build_elements.py` maler alle 13 grundelementer fra `elements-sheet.png`.
  `build_element_art.py` skærer siden 11 af dem (alt undtagen korn og okse,
  akt 2's elementer, som ikke står i referencen) på ny direkte fra
  UI-referencen — en senere rettelse, fordi dommeren målte grundmalingens
  streg som 30 % fladere end referencens. De skriver til samme filer i
  `src/assets/art/elements/`, så rettelsen skal køre sidst, ellers overskriver
  den ældre, kraftigere streg den nyere, svagere.

Fire scripts er bevidst UDELADT — ingen af dem kan køre på en frisk clone:
- `outpaint_scene.py` kalder en billedmodel (Gemini) over nettet. Resultatet
  er ikke deterministisk, og scriptet skriver som standard til /tmp — det er
  et bevidst, manuelt skridt Martin kører når scenen skal genmales, ikke en
  del af en rutinemæssig genopbygning.
- `build_scene_wide.py` læser `docs/design/reference/scene-wide.png`, som er
  outpaint_scene.py's output. Filen er ikke committet (kun `bg-wide.png` og
  `elements-sheet.png` er), så scriptet fejler uden det manuelle skridt først
  — at sætte det ind i den automatiske kæde ville bare flytte fejlen hertil.
- `build_app_field.py` og `build_bg_from_ref.py` læser begge
  `.judge/latest/render/game.png` — et FRISKT skærmbillede af selve spillet,
  taget af `npm run judge:capture`. `.judge/` er urspporet og regenereres pr.
  kørsel, så filen findes ikke på en frisk clone, og et gammelt billede ville
  maskere UI'et forkert i stedet for slet ikke at køre. `build_bg_from_ref.py`
  bruger desuden det eksisterende `bg-wide-2560.webp` som forlæg for kanterne
  — den forfiner et billede, den starter ikke forfra. Begge er derfor et
  bevidst to-trins skridt (capture, så kør scriptet), ikke en del af kæden her.

Kørsel: `npm run art` (eller `python3 tools/art/build_all.py` direkte).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ART_DIR = Path(__file__).resolve().parent

# Producenter først, rettelsen af grundelementerne sidst (se docstring).
# Derefter regenereres batchmanifestet fra content og kontaktarket fra de
# færdige elementfiler. Resten har ingen indbyrdes afhængighed og holdes
# alfabetisk så en diff af denne liste er let at læse.
SCRIPTS = [
    "build_bg_wide.py",
    "build_elements.py",
    "build_grain.py",
    "build_app_texture.py",
    "build_chronicle_art.py",
    "build_chronicle_paper.py",
    "build_combine_slab.py",
    "build_dock_art.py",
    "build_header_icons.py",
    "build_mark.py",
    "build_narrator_paper.py",
    "build_parchment.py",
    "build_problem_icons.py",
    "build_sparkle.py",
    "build_ui.py",
    "build_element_art.py",
    "build_batch_manifest.py",
    "contact_sheet.py",
]


def main() -> int:
    for name in SCRIPTS:
        script = ART_DIR / name
        if not script.exists():
            print(f"❌ {name} findes ikke i {ART_DIR}")
            return 1
        print(f"\n▶ {name}")
        result = subprocess.run([sys.executable, str(script)], cwd=ROOT)
        if result.returncode != 0:
            print(f"❌ {name} fejlede (exit {result.returncode})")
            return result.returncode
    print(f"\n✅ {len(SCRIPTS)} scripts kørt. outpaint_scene.py, build_scene_wide.py, "
          "build_app_field.py og build_bg_from_ref.py er udeladt — se docstring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
