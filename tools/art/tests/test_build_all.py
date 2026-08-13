"""Kontrakttest for `npm run art`-orkestratoren.

Batchmanifestet og kontaktarket er ikke løse hjælpeværktøjer: de er de sidste
to deterministiske trin efter at de committede aktiver er genbygget.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_all  # noqa: E402


def test_pipeline_afsluttes_med_manifest_og_kontaktark() -> None:
    assert build_all.SCRIPTS[-2:] == [
        "build_batch_manifest.py",
        "contact_sheet.py",
    ]
