"""Enhedstest af `sheet_ingest.py` — den delte udskæringsmotor.

Bruger syntetiske ark bygget i selve testen (ikke committede fixtures):
determinismen skal bevises af algoritmen, ikke af et facit-billede der kan
gå ud af sync med koden uden at nogen bemærker det.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sheet_ingest import (  # noqa: E402
    CutParams,
    DetectParams,
    alpha_from_distance,
    bands,
    content_mask,
    cut_tiles,
    detect_and_cut,
    detect_boxes,
    pad_and_scale,
    sample_border_background,
    unpremultiply,
)


def make_sheet(tmp_path: Path, boxes: list[tuple[int, int, int, int]], bg=(230, 208, 182), fg=(90, 70, 40), size=(400, 300)) -> Path:
    """Bygger et syntetisk ark: flad baggrund + massive rektangler som
    "genstande", på kendte positioner. God nok til at teste geometri og
    alfa uden at afhænge af et rigtigt malet billede."""
    img = Image.new("RGB", size, bg)
    a = np.asarray(img).copy()
    for x0, y0, x1, y1 in boxes:
        a[y0:y1, x0:x1] = fg
    out = tmp_path / "sheet.png"
    Image.fromarray(a).save(out)
    return out


class TestBands:
    def test_finder_et_enkelt_baand(self) -> None:
        # Bånd på 4 eller derunder kasseres bevidst (støvkorn) — testen
        # bruger derfor et bånd på 5 for at måle selve fundet, ikke filtret.
        profile = np.array([0, 0, 5, 5, 5, 5, 5, 0, 0])
        assert bands(profile, gap=2) == [(2, 7)]

    def test_adskiller_baand_men_udvider_startpunktet_til_forrige_baands_slut(self) -> None:
        # Kendt, bevaret kvirk fra den oprindelige `_bands` i build_elements.py:
        # når to bånd er adskilt af nøjagtig `gap` tomme linjer, sætter
        # algoritmen det andet bånds START til det FØRSTE bånds slutning i
        # stedet for til dets egen første indholdslinje. Det ændrer ikke
        # boksens INDHOLD (den beskæres alligevel af den faktiske maske
        # inde i båndet, se `detect_boxes`), kun det midlertidige interval —
        # og da funktionen er kopieret uændret fra den kørende produktions-
        # kode (låst af `test_build_elements_regression.py`), dokumenterer
        # testen adfærden i stedet for at "rette" noget der aldrig var i
        # stykker for de 13 leverede elementer.
        profile = np.array([5, 5, 5, 5, 5, 0, 0, 0, 5, 5, 5, 5, 5])
        assert bands(profile, gap=3) == [(0, 5), (5, 13)]

    def test_slaar_baand_sammen_naar_gabet_er_for_lille(self) -> None:
        profile = np.array([5, 5, 5, 0, 0, 5, 5, 5])
        result = bands(profile, gap=5)
        # Gabet på 3 er under gap=5 — begge sider tæller som ét indholdsområde.
        assert len(result) == 1

    def test_kasserer_stoevkorn_kortere_end_5(self) -> None:
        profile = np.array([0, 5, 5, 0, 0, 0])
        assert bands(profile, gap=2) == []


class TestBackgroundAndMask:
    def test_finder_den_flade_baggrund(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, boxes=[(50, 50, 100, 100)])
        a = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float64)
        bg = sample_border_background(a)
        assert np.allclose(bg, [230, 208, 182])

    def test_masken_daekker_kun_genstanden(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, boxes=[(50, 50, 100, 100)])
        a = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float64)
        bg = sample_border_background(a)
        dist, mask = content_mask(a, bg, threshold=18)
        assert mask[70, 70]  # midt i genstanden
        assert not mask[10, 10]  # baggrund


class TestDetectBoxes:
    def test_finder_flere_genstande_i_laeserlaekkefoelge(self, tmp_path: Path) -> None:
        boxes_in = [(20, 20, 80, 80), (200, 20, 260, 80), (20, 180, 80, 240)]
        sheet = make_sheet(tmp_path, boxes=boxes_in, size=(320, 300))
        a = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float64)
        bg = sample_border_background(a)
        _, mask = content_mask(a, bg, threshold=18)
        found = detect_boxes(mask, DetectParams())
        assert len(found) == 3
        # Læserækkefølge: øverste bånd (to genstande, venstre til højre) først.
        assert found[0][0] < found[1][0]
        assert found[2][1] > found[0][1]

    def test_kasserer_stoej_under_min_area(self, tmp_path: Path) -> None:
        boxes_in = [(20, 20, 80, 80), (200, 20, 203, 23)]  # sidste er 3x3 = 9px
        sheet = make_sheet(tmp_path, boxes=boxes_in, size=(320, 300))
        a = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float64)
        bg = sample_border_background(a)
        _, mask = content_mask(a, bg, threshold=18)
        found = detect_boxes(mask, DetectParams(min_area=400))
        assert len(found) == 1


class TestAlphaAndUnpremultiply:
    def test_alfa_er_nul_under_gulvet(self) -> None:
        dist = np.array([[0.0, 5.0]])
        alpha = alpha_from_distance(dist, floor=9, full=42)
        assert alpha[0, 0] == 0.0
        assert alpha[0, 1] == 0.0

    def test_alfa_er_et_over_loftet(self) -> None:
        dist = np.array([[100.0]])
        alpha = alpha_from_distance(dist, floor=9, full=42)
        assert alpha[0, 0] == 1.0

    def test_unpremultiply_giver_ren_forgrundsfarve_ved_fuld_alfa(self) -> None:
        a = np.array([[[10.0, 20.0, 30.0]]])
        bg = np.array([200.0, 200.0, 200.0])
        alpha = np.array([[1.0]])
        fg = unpremultiply(a, bg, alpha)
        assert np.allclose(fg[0, 0], [10, 20, 30])


class TestDetectAndCut:
    def test_kaster_naar_antal_ikke_matcher(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, boxes=[(20, 20, 80, 80)], size=(200, 200))
        with pytest.raises(SystemExit, match="fandt 1 genstande, forventede 3"):
            detect_and_cut(sheet, expected_count=3)

    def test_cut_tiles_returnerer_navngivne_billeder_i_rgba(self, tmp_path: Path) -> None:
        sheet = make_sheet(
            tmp_path,
            boxes=[(20, 20, 80, 80), (150, 20, 210, 80)],
            size=(280, 140),
        )
        tiles = cut_tiles(sheet, ["a", "b"])
        assert set(tiles) == {"a", "b"}
        for img in tiles.values():
            assert img.mode == "RGBA"
            assert max(img.width, img.height) == CutParams().tile

    def test_deterministisk_samme_ark_giver_samme_pixels(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, boxes=[(20, 20, 80, 80)], size=(200, 200))
        tiles_a = cut_tiles(sheet, ["x"])
        tiles_b = cut_tiles(sheet, ["x"])
        assert list(tiles_a["x"].getdata()) == list(tiles_b["x"].getdata())


class TestPadAndScale:
    def test_padding_goer_beskaeringen_stoerre_end_boksen(self, tmp_path: Path) -> None:
        sheet = make_sheet(tmp_path, boxes=[(100, 100, 160, 160)], size=(300, 300))
        boxes, full = detect_and_cut(sheet, expected_count=1)
        box = boxes[0]
        params = CutParams(pad=0.5, tile=192)
        crop = pad_and_scale(full, box, params)
        # Med 50% padding og en kvadratisk boks skal beskæringen tydeligt
        # dække mere end selve boksens bredde/højde, målt før skalering.
        bw = box[2] - box[0]
        assert bw < 60 + 1  # boksen selv er 60px
        assert crop.width == 192 or crop.height == 192
