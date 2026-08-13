"""Test af `build_batch_manifest.py` — TASK-038's grundlag: en maskinlæsbar
opdeling af de resterende elementer i planens tematiske bunker
(sten/træ/mad/dyr/værktøj/ild/samfund), som input til fremtidige tematiske
kildeark. Ren klassifikation af `content/elements.json`s egne felter
(`kind`/`stuff`/`id`) — ingen AI, ingen gætteri om et element der ikke findes.

Bemærk: scriptet foreslår en klassifikation, det redigerer ALDRIG
`plan/design-visual-target-1.md`s status — se scriptets docstring for
hvorfor ("ild"-bunken er bevidst udvidet til vejrfænomener, en fortolkning
der er markeret som et åbent spørgsmål til Martin/planens ejer, ikke en
plan-redigering denne prøvelse selv foretager).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_batch_manifest as bbm  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


class TestClassify:
    def test_creature_gaar_til_dyr(self) -> None:
        assert bbm.classify({"id": "x", "kind": "creature", "stuff": "flesh"}) == "dyr"

    def test_tool_gaar_til_vaerktoej_selv_som_sten(self) -> None:
        # Værktøj vinder over sten/træ-materiale, fordi bunken hedder
        # "værktøj", ikke "genstande lavet af sten" — se docstring.
        assert bbm.classify({"id": "stenoekse", "kind": "tool", "stuff": "stone"}) == "vaerktoej"

    def test_food_gaar_til_mad(self) -> None:
        assert bbm.classify({"id": "x", "kind": "food", "stuff": "plant"}) == "mad"

    def test_stone_materiale_gaar_til_sten(self) -> None:
        assert bbm.classify({"id": "x", "kind": "material", "stuff": "stone"}) == "sten"

    def test_wood_materiale_gaar_til_trae(self) -> None:
        assert bbm.classify({"id": "x", "kind": "material", "stuff": "wood"}) == "trae"

    def test_navngivet_vejrfaenomen_gaar_til_ild(self) -> None:
        assert bbm.classify({"id": "regn", "kind": "phenomenon", "stuff": "none"}) == "ild"
        assert bbm.classify({"id": "ild", "kind": "phenomenon", "stuff": "none"}) == "ild"

    def test_abstrakt_faenomen_gaar_til_samfund(self) -> None:
        assert bbm.classify({"id": "romance", "kind": "phenomenon", "stuff": "none"}) == "samfund"

    def test_person_og_abstract_gaar_til_samfund(self) -> None:
        assert bbm.classify({"id": "x", "kind": "person", "stuff": "none"}) == "samfund"
        assert bbm.classify({"id": "y", "kind": "abstract", "stuff": "none"}) == "samfund"

    def test_kender_alle_syv_bunker(self) -> None:
        assert bbm.BUCKETS == ["sten", "trae", "mad", "dyr", "vaerktoej", "ild", "samfund"]

    def test_manglende_klassifikationsfelt_er_en_hard_fejl(self) -> None:
        with pytest.raises(ValueError, match="mangler.*stuff"):
            bbm.classify({"id": "ukendt", "kind": "material"})


class TestBuildBatches:
    def test_udelader_de_13_leverede_grundelementer(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        all_ids = {item["id"] for bucket in manifest["buckets"].values() for item in bucket}
        assert not (all_ids & bbm.DELIVERED_IDS)

    def test_hvert_resterende_element_er_i_praecis_en_bunke(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        all_ids = [item["id"] for bucket in manifest["buckets"].values() for item in bucket]
        expected = {e["id"] for e in elements if e["id"] not in bbm.DELIVERED_IDS}
        assert set(all_ids) == expected
        assert len(all_ids) == len(expected)  # ingen dubletter på tværs af bunker

    def test_manifest_metadata_stemmer(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        assert manifest["deliveredCount"] == len(bbm.DELIVERED_IDS)
        assert manifest["remainingCount"] == len(elements) - len(bbm.DELIVERED_IDS)
        assert manifest["remainingCount"] == sum(len(v) for v in manifest["buckets"].values())

    def test_bunkerne_er_i_planens_navngivne_raekkefoelge(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        assert list(manifest["buckets"].keys()) == bbm.BUCKETS

    def test_element_poster_har_de_felter_et_kildeark_skal_bruge(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        any_item = next(iter(manifest["buckets"]["dyr"]))
        assert set(any_item.keys()) >= {"id", "name", "act", "kind", "stuff"}

    def test_manifestet_dokumenterer_at_alle_resterende_er_akt_1(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        manifest = bbm.build_batches(elements, bbm.DELIVERED_IDS)
        acts = {item["act"] for bucket in manifest["buckets"].values() for item in bucket}
        assert acts == {1}

    def test_afviser_et_leveret_id_der_ikke_findes_i_content(self) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        with pytest.raises(ValueError, match="leverede id.*findes ikke"):
            bbm.build_batches(elements, bbm.DELIVERED_IDS | {"findes-ikke"})


class TestDeterminism:
    def test_samme_input_giver_byte_identisk_json(self, tmp_path: Path) -> None:
        elements = json.loads((ROOT / "content/elements.json").read_text())
        out_a = tmp_path / "a.json"
        out_b = tmp_path / "b.json"
        bbm.write_manifest_json(bbm.build_batches(elements, bbm.DELIVERED_IDS), out_a)
        bbm.write_manifest_json(bbm.build_batches(elements, bbm.DELIVERED_IDS), out_b)
        assert out_a.read_bytes() == out_b.read_bytes()


class TestCli:
    def test_main_skriver_gyldig_json_til_den_rigtige_sti(self, tmp_path: Path) -> None:
        out = tmp_path / "element-batches.json"
        bbm.main(["--out", str(out)])
        manifest = json.loads(out.read_text())
        assert manifest["remainingCount"] == 174
