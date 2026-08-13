"""Regressionsbevis for dependency-ignore i både rod og nested workspaces."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _check_ignored(path: str) -> str:
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-v", path],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr or f"{path} er ikke ignoreret"
    return result.stdout


def test_node_modules_ignoreres_i_roden_og_worker() -> None:
    assert "/node_modules" in _check_ignored("node_modules")
    assert "node_modules/" in _check_ignored("worker/node_modules/pakke/index.js")
