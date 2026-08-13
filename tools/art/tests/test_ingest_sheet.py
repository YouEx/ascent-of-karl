"""Test af `ingest_sheet.py` — den generiske to-trins indtagelse for
tematiske kildeark (TASK-038's grundlag: "manifest/ingestion/crop support
for thematic source sheets").

To trin, med et menneske imellem, aldrig en model i selve beskæringen:

1. `detect`  — kører sheet_ingest's fremspringsdetektion på et ark og
   skriver en manifest-JSON med bokse i læserækkefølge og `id: null`.
   Ingen id'er gættes her; et menneske udfylder dem ved at se kontaktarket
   eller kildearket selv.
2. `apply`   — læser den (nu udfyldte) manifest, tjekker at arket ikke er
   ændret siden (sha256-lås), og skærer/skalerer/gemmer nøjagtigt de
   navngivne bokse — samme aritmetik og samme WebP-parametre som
   `build_elements.py` altid har brugt.

Al determinisme og "gæt ikke"-disciplin fra `build_elements.py` skal gælde
her: samme ark + samme manifest => byte-identisk output, og en uoverens-
stemmelse (ændret ark, dubletter, tomme id'er der forventes udfyldt) er en
hård fejl, aldrig en tavs antagelse.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ingest_sheet  # noqa: E402
from sheet_ingest import CutParams, DetectParams  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "ingest_sheet.py"


def make_sheet(tmp_path: Path, boxes: list[tuple[int, int, int, int]], bg=(230, 208, 182), fg=(90, 70, 40), size=(400, 200)) -> Path:
    img = Image.new("RGB", size, bg)
    a = np.asarray(img).copy()
    for x0, y0, x1, y1 in boxes:
        a[y0:y1, x0:x1] = fg
    out = tmp_path / "sheet.png"
    Image.fromarray(a).save(out)
    return out


TWO_BOXES = [(20, 20, 120, 120), (220, 20, 320, 120)]


class TestBuildManifest:
    def test_manifest_indeholder_forventede_felter(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        assert manifest["version"] == 1
        assert manifest["sheetSha256"] == ingest_sheet.sha256_of(sheet)
        assert manifest["sheetWidth"] == 400
        assert manifest["sheetHeight"] == 200
        assert len(manifest["tiles"]) == 2
        for i, tile in enumerate(manifest["tiles"]):
            assert tile["index"] == i
            assert tile["id"] is None
            assert len(tile["box"]) == 4

    def test_bokse_er_i_laesereakkefoelge(self, tmp_path: Path) -> None:
        # venstre boks (x0=20) skal komme før højre boks (x0=220)
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        x0s = [t["box"][0] for t in manifest["tiles"]]
        assert x0s == sorted(x0s)


class TestManifestJsonRoundtrip:
    def test_write_og_load_giver_samme_manifest(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        out = tmp_path / "manifest.json"
        ingest_sheet.write_manifest_json(manifest, out)
        loaded = ingest_sheet.load_manifest(out)
        assert loaded == manifest

    def test_samme_input_giver_byte_identisk_json(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        out_a = tmp_path / "a.json"
        out_b = tmp_path / "b.json"
        ingest_sheet.write_manifest_json(ingest_sheet.build_manifest(sheet, DetectParams(), CutParams()), out_a)
        ingest_sheet.write_manifest_json(ingest_sheet.build_manifest(sheet, DetectParams(), CutParams()), out_b)
        assert out_a.read_bytes() == out_b.read_bytes()

    def test_json_har_afsluttende_linjeskift_og_er_gyldig(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        out = tmp_path / "manifest.json"
        ingest_sheet.write_manifest_json(ingest_sheet.build_manifest(sheet, DetectParams(), CutParams()), out)
        text = out.read_text()
        assert text.endswith("\n")
        json.loads(text)  # kaster hvis ugyldig


class TestValidateManifest:
    def test_afviser_aendret_ark(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "a"
        manifest["tiles"][1]["id"] = "b"
        # Ændr arket efter manifestet blev bygget
        img = Image.open(sheet).convert("RGB")
        a = np.asarray(img).copy()
        a[0, 0] = (1, 2, 3)
        Image.fromarray(a).save(sheet)
        with pytest.raises(SystemExit, match="sha256|ændret|matcher ikke"):
            ingest_sheet.validate_manifest(manifest, sheet)

    def test_afviser_dubletter(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "samme"
        manifest["tiles"][1]["id"] = "samme"
        with pytest.raises(SystemExit, match="dublet|dobbelt"):
            ingest_sheet.validate_manifest(manifest, sheet)

    def test_accepterer_null_id_som_bevidst_udeladt(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "kun-den-ene"
        manifest["tiles"][1]["id"] = None
        ingest_sheet.validate_manifest(manifest, sheet)  # kaster ikke

    def test_accepterer_gyldig_manifest(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "a"
        manifest["tiles"][1]["id"] = "b"
        ingest_sheet.validate_manifest(manifest, sheet)  # kaster ikke

    def test_afviser_id_der_kan_skrive_uden_for_outputmappen(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "../../udenfor"
        with pytest.raises(SystemExit, match="ugyldigt id"):
            ingest_sheet.validate_manifest(manifest, sheet)

    def test_afviser_boks_uden_for_kildearket(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "a"
        manifest["tiles"][0]["box"] = [-1, 20, 120, 120]
        with pytest.raises(SystemExit, match="boks"):
            ingest_sheet.validate_manifest(manifest, sheet)


class TestApplyManifest:
    def test_skaerer_kun_navngivne_fliser_og_springer_null_over(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "venstre"
        manifest["tiles"][1]["id"] = None
        out_dir = tmp_path / "out"
        saved = ingest_sheet.apply_manifest(manifest, sheet, out_dir)
        assert list(saved.keys()) == ["venstre"]
        assert (out_dir / "venstre.webp").exists()
        assert not (out_dir / "hoejre.webp").exists()

    def test_output_er_deterministisk(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "venstre"
        manifest["tiles"][1]["id"] = "hoejre"
        out_a = tmp_path / "out_a"
        out_b = tmp_path / "out_b"
        ingest_sheet.apply_manifest(manifest, sheet, out_a)
        ingest_sheet.apply_manifest(manifest, sheet, out_b)
        assert (out_a / "venstre.webp").read_bytes() == (out_b / "venstre.webp").read_bytes()
        assert (out_a / "hoejre.webp").read_bytes() == (out_b / "hoejre.webp").read_bytes()

    def test_kaster_paa_uvalideret_manifest(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "samme"
        manifest["tiles"][1]["id"] = "samme"
        with pytest.raises(SystemExit):
            ingest_sheet.apply_manifest(manifest, sheet, tmp_path / "out")


class TestCli:
    def test_detect_saa_apply_giver_webp_filer(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest_path = tmp_path / "manifest.json"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "detect", "--sheet", str(sheet), "--out", str(manifest_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        manifest = json.loads(manifest_path.read_text())
        assert len(manifest["tiles"]) == 2

        manifest["tiles"][0]["id"] = "venstre"
        manifest["tiles"][1]["id"] = "hoejre"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")

        out_dir = tmp_path / "out"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "apply", "--manifest", str(manifest_path), "--out-dir", str(out_dir)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert (out_dir / "venstre.webp").exists()
        assert (out_dir / "hoejre.webp").exists()

    def test_apply_kaster_paa_aendret_ark_via_cli(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, TWO_BOXES)
        manifest = ingest_sheet.build_manifest(sheet, DetectParams(), CutParams())
        manifest["tiles"][0]["id"] = "a"
        manifest["tiles"][1]["id"] = "b"
        manifest_path = tmp_path / "manifest.json"
        ingest_sheet.write_manifest_json(manifest, manifest_path)

        img = Image.open(sheet).convert("RGB")
        a = np.asarray(img).copy()
        a[0, 0] = (9, 9, 9)
        Image.fromarray(a).save(sheet)

        result = subprocess.run(
            [sys.executable, str(SCRIPT), "apply", "--manifest", str(manifest_path), "--out-dir", str(tmp_path / "out")],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "sha256" in result.stderr or "ændret" in result.stderr or "matcher ikke" in result.stderr
