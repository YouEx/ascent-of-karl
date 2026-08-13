"""Tests må aldrig bruge destruktive git-kommandoer som oprydning."""
from __future__ import annotations

from pathlib import Path

REGRESSION_TEST = Path(__file__).with_name("test_build_elements_regression.py")


def test_elementregressionen_bruger_ikke_git_checkout() -> None:
    source = REGRESSION_TEST.read_text(encoding="utf-8")
    assert '["git", "checkout"' not in source
