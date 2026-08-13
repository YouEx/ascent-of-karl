"""Test af `contact_sheet.py` — kontaktarks-værktøjet (TASK-035).

Bruger syntetiske .webp-fliser bygget i selve testen, så testen ikke
afhænger af de rigtige elementbilleder (som ændrer sig efterhånden som
kunsten leveres).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/art/contact_sheet.py"

sys.path.insert(0, str(ROOT / "tools/art"))
import contact_sheet  # noqa: E402


def make_tile(dir_: Path, name: str, size=(120, 90), color=(120, 90, 60, 255)) -> Path:
    img = Image.new("RGBA", size, color)
    path = dir_ / f"{name}.webp"
    img.save(path, "WEBP", lossless=True)
    return path


class TestDiscoverTiles:
    def test_uden_ids_tager_alle_webp_alfabetisk(self, tmp_path: Path) -> None:
        make_tile(tmp_path, "zebra")
        make_tile(tmp_path, "aal")
        found = contact_sheet.discover_tiles(tmp_path, None)
        assert [name for name, _ in found] == ["aal", "zebra"]

    def test_med_ids_bruger_angivet_raekkefoelge(self, tmp_path: Path) -> None:
        make_tile(tmp_path, "a")
        make_tile(tmp_path, "b")
        found = contact_sheet.discover_tiles(tmp_path, ["b", "a"])
        assert [name for name, _ in found] == ["b", "a"]

    def test_kaster_haardt_paa_manglende_id_i_stedet_for_at_springe_over(self, tmp_path: Path) -> None:
        make_tile(tmp_path, "a")
        with pytest.raises(SystemExit, match="mangler"):
            contact_sheet.discover_tiles(tmp_path, ["a", "spoegelse"])

    def test_kaster_paa_tom_mappe(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit, match="ingen"):
            contact_sheet.discover_tiles(tmp_path, None)


class TestBuildSheet:
    def test_kortets_maal_kommer_fra_designtokens(self) -> None:
        css = contact_sheet.TOKENS_CSS.read_text(encoding="utf-8")

        def px(name: str) -> int:
            match = re.search(rf"--{name}:\s*(\d+)px", css)
            assert match is not None, f"mangler --{name} i tokens.css"
            return int(match.group(1))

        assert contact_sheet.CARD_W == px("element-card-width")
        assert contact_sheet.CARD_H == px("element-card-height")
        assert contact_sheet.ART_MAX_W == px("element-art-max-width")
        assert contact_sheet.ART_MAX_H == px("element-art-max-height")

    def test_arkets_egne_flader_bruger_designpaletten(self) -> None:
        palette = contact_sheet.load_palette()
        assert "sheet_bg" in palette
        assert "sheet_ink" in palette

    def test_arket_indeholder_alle_fliser_og_metadata(self, tmp_path: Path) -> None:
        for n in ("a", "b", "c"):
            make_tile(tmp_path, n)
        tiles = contact_sheet.discover_tiles(tmp_path, None)
        palette = contact_sheet.load_palette()
        sheet, manifest = contact_sheet.build_sheet(tiles, palette, cols=2, source_dir=tmp_path)

        assert manifest["count"] == 3
        assert {t["id"] for t in manifest["tiles"]} == {"a", "b", "c"}
        # 2 søjler, 3 fliser → 2 rækker.
        expected_h = (
            contact_sheet.MARGIN * 2
            + contact_sheet.HEADER_H
            + 2 * (contact_sheet.CARD_H + contact_sheet.LABEL_H + contact_sheet.GUTTER)
            - contact_sheet.GUTTER
        )
        assert sheet.height == expected_h

    def test_hver_flise_har_sha256_af_sin_kildefil(self, tmp_path: Path) -> None:
        path = make_tile(tmp_path, "a")
        tiles = contact_sheet.discover_tiles(tmp_path, None)
        palette = contact_sheet.load_palette()
        _, manifest = contact_sheet.build_sheet(tiles, palette, cols=1, source_dir=tmp_path)
        assert manifest["tiles"][0]["sha256"] == contact_sheet.sha256_of(path)


class TestDeterminism:
    def test_samme_input_giver_byte_identisk_png(self, tmp_path: Path) -> None:
        for n in ("a", "b"):
            make_tile(tmp_path, n)
        out1 = tmp_path / "out1.png"
        out2 = tmp_path / "out2.png"
        contact_sheet.main(["--dir", str(tmp_path), "--out", str(out1)])
        contact_sheet.main(["--dir", str(tmp_path), "--out", str(out2)])
        assert out1.read_bytes() == out2.read_bytes()

    def test_sidecar_json_indeholder_sheetsha256(self, tmp_path: Path) -> None:
        make_tile(tmp_path, "a")
        out = tmp_path / "sheet.png"
        contact_sheet.main(["--dir", str(tmp_path), "--out", str(out)])
        manifest = json.loads(out.with_suffix(".png.json").read_text())
        assert manifest["sheetSha256"] == contact_sheet.sha256_of(out)
        assert manifest["cardSize"] == [contact_sheet.CARD_W, contact_sheet.CARD_H]


class TestCli:
    def test_kan_koeres_som_subprocess(self, tmp_path: Path) -> None:
        make_tile(tmp_path, "a")
        out = tmp_path / "sheet.png"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--dir", str(tmp_path), "--out", str(out)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert out.exists()
        assert out.with_suffix(".png.json").exists()
