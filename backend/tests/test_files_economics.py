"""Проверки контракта на вымышленных числах; исходные данные хранятся отдельно."""
import copy
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.exceptions import RequestValidationError
from backend.app import russian_validation_errors
from backend.files_economics import PRODUCT_IDS, ROUTE_IDS, router


def fixture():
    products = [{"product_id": pid, "bulk": {"price_rub_per_product_kg": 0, "packaging_rub_per_product_kg": 0}} for pid in PRODUCT_IDS]
    for product in products:
        if product["product_id"] == "breast_skin":
            product["bulk"] = {"price_rub_per_product_kg": 40, "packaging_rub_per_product_kg": 4}
        elif product["product_id"] in {"thigh_skin_only", "waste_loss"}:
            product["bulk"] = {"price_rub_per_product_kg": None, "packaging_rub_per_product_kg": None}
    economics = {"version": 1, "primary_source": "пример.xlsx", "whole_baseline": {"price_rub_per_kg": 20, "packaging_rub_per_kg": 2, "revenue_after_packaging_rub_per_kg": 18},
                 "products": products, "routes": [], "integration_contract": {"finance_period": "2000-01", "profit_requirements": ["Подтверждение затрат"]},
                 "source_manifest": [{"file": "пример.xlsx", "path": "/private/account/пример.xlsx", "sha256": "a" * 64}],
                 "annual_context": [{"secret": "Служебный годовой аудит"}], "quality": {"checks": ["Служебные проверки"]}}
    yields = {"products": [{"id": row["product_id"], "name": row["product_id"]} for row in products],
              "sources": {"efficiency": {"file": "/private/account/пример.xlsx", "read_file": "/private/account/working.xlsx", "sha256": "a" * 64}},
              "routes": [{"id": rid, "name": "Схема " + str(i), "outputs": [
                  {"product_id": "breast_skin", "yield_fraction": .8 if i < 4 else .7},
                  {"product_id": "thigh_skin_only", "yield_fraction": 0 if i < 4 else .1},
                  {"product_id": "waste_loss", "yield_fraction": .2}]} for i, rid in enumerate(ROUTE_IDS)]}
    yields["reference_datasets"] = {"private_annual": "Служебный годовой пример"}
    yields["pork_reference"] = {"private_quantity": 123}
    yields["verification"] = {"private_test": True}
    yields["sources"]["annual"] = {"file": "/private/annual.xlsx"}
    yields["routes"][0]["outputs"][0]["annual_duplicate"] = {"private_reference": True}
    refresh_economics(economics, yields)
    return economics, yields


def refresh_economics(economics, yields):
    """Создаёт согласованный сохранённый снимок для вымышленных исходных данных."""
    products = {row["product_id"]: row for row in economics["products"]}
    economics["routes"] = []
    whole = economics["whole_baseline"]
    for route in yields["routes"]:
        outputs = {row["product_id"]: row["yield_fraction"] for row in route["outputs"]}
        terms = [{"product_id": pid, "yield_fraction": outputs.get(pid, 0),
                  "price_rub_per_kg": products[pid]["bulk"]["price_rub_per_product_kg"],
                  "packaging_rub_per_kg": products[pid]["bulk"]["packaging_rub_per_product_kg"]} for pid in PRODUCT_IDS]
        revenue = sum(t["yield_fraction"] * (t["price_rub_per_kg"] or 0) for t in terms)
        packaging = sum(t["yield_fraction"] * (t["packaging_rub_per_kg"] or 0) for t in terms)
        missing = [t["product_id"] for t in terms if t["yield_fraction"] > 0 and t["product_id"] != "waste_loss" and
                   (t["price_rub_per_kg"] is None or t["packaging_rub_per_kg"] is None)]
        economics["routes"].append({"route_id": route["id"], "modes": {"bulk": {
            "terms": terms, "revenue_rub_per_input_kg": revenue, "packaging_rub_per_input_kg": packaging,
            "revenue_after_packaging_rub_per_input_kg": revenue - packaging,
            "added_result_rub_per_input_kg": revenue - packaging - whole["price_rub_per_kg"] + whole["packaging_rub_per_kg"],
            "complete_product_price_coverage": len(missing) == 0, "missing_valued_products": missing}}})


class FilesEconomicsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict("os.environ", {"SEVERNAYA_SOURCE_DATA_DIR": self.tmp.name})
        self.env.start()
        self.economics, self.yields = fixture()
        self.write()
        app = FastAPI()
        app.add_exception_handler(RequestValidationError, russian_validation_errors)
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.tmp.cleanup()

    def write(self):
        directory = Path(self.tmp.name)
        (directory / "real_data_economics.json").write_text(json.dumps(self.economics))
        (directory / "real_data_yields.json").write_text(json.dumps(self.yields))

    def evaluate(self, **kwargs):
        response = self.client.post("/api/files/economics/evaluate", json=kwargs)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_catalog_sanitizes_machine_paths_and_limits_finance_scope(self):
        response = self.client.get("/api/files/economics")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data), {"economics", "yields"})
        self.assertNotIn("sources", data["yields"])
        self.assertNotIn("/private/", response.text)
        self.assertNotIn("read_file", response.text)
        self.assertNotIn("annual_context", response.text)
        self.assertNotIn("quality", data["economics"])
        for key in ["reference_datasets", "pork_reference", "verification", "annual_duplicate"]:
            self.assertNotIn(key, response.text)
        self.assertNotIn("primary_source", data["economics"])
        self.assertNotIn("sha256", response.text)

    def test_default_calculation_exposes_common_mass_and_exact_bridge(self):
        data = self.evaluate()
        self.assertEqual(data["routeId"], "level_1")
        self.assertEqual(data["inputKg"], 1000)
        self.assertEqual(data["period"], "2000-01")
        self.assertEqual(data["baseline"], data["scenario"])
        result = data["scenario"]
        self.assertEqual(result["revenue"], 32000)
        self.assertEqual(result["packaging"], 3200)
        self.assertEqual(result["netRevenue"], 28800)
        self.assertEqual(result["wholeNetRevenue"], 18000)
        self.assertEqual(result["incrementalResult"], 10800)
        self.assertAlmostEqual(result["rubPerKg"]["incrementalResult"], 10.8)
        self.assertTrue(data["completeness"]["complete"])
        self.assertEqual(len(data["comparison"]), 5)
        self.assertEqual([r["routeId"] for r in data["comparison"]], list(ROUTE_IDS))
        for effect in data["leverEffects"]:
            self.assertEqual(effect["incrementalResult"], 0)

    def test_levers_change_cut_products_and_preserve_whole_comparator(self):
        data = self.evaluate(cutInputKg=250, priceChangePct=10, packagingChangePct=25)
        result, base = data["scenario"], data["baseline"]
        self.assertEqual(result["wholeRevenue"], base["wholeRevenue"])
        self.assertEqual(result["wholePackaging"], base["wholePackaging"])
        self.assertAlmostEqual(result["revenue"], 8800)
        self.assertEqual(result["packaging"], 1000)
        self.assertAlmostEqual(result["incrementalResult"], 3300)
        effects = {r["id"]: r for r in data["leverEffects"]}
        self.assertAlmostEqual(effects["price"]["incrementalResult"], 800)
        self.assertAlmostEqual(effects["packaging"]["incrementalResult"], -200)
        self.assertAlmostEqual(effects["joint"]["incrementalResult"], 600)
        self.assertAlmostEqual(effects["joint"]["incrementalResult"], result["incrementalResult"] - base["incrementalResult"])
        self.assertAlmostEqual(effects["joint"]["incrementalResult"], effects["price"]["incrementalResult"] + effects["packaging"]["incrementalResult"])
        self.assertAlmostEqual(data["comparison"][0]["incrementalResult"], result["incrementalResult"])

    def test_partial_source_preserves_saved_zero_semantics_and_marks_missing(self):
        data = self.evaluate(routeId="level_4")
        self.assertFalse(data["completeness"]["complete"])
        self.assertEqual(data["completeness"]["missingProducts"], ["thigh_skin_only"])
        self.assertAlmostEqual(data["scenario"]["incrementalResult"], 7200)
        self.assertFalse(data["comparison"][4]["completeness"]["complete"])
        self.assertTrue(data["gaps"])

    def test_zero_input_keeps_rates_and_zeroes_all_totals(self):
        data = self.evaluate(cutInputKg=0, priceChangePct=15)
        for key, value in data["scenario"].items():
            if key != "rubPerKg":
                self.assertEqual(value, 0, key)
        self.assertGreater(data["scenario"]["rubPerKg"]["revenue"], 0)
        for effect in data["leverEffects"]:
            self.assertEqual(effect["incrementalResult"], 0)

    def test_negative_result_and_zero_costs_preserve_arithmetic(self):
        data = self.evaluate(priceChangePct=-100, packagingChangePct=-100)
        self.assertEqual(data["scenario"]["revenue"], 0)
        self.assertEqual(data["scenario"]["packaging"], 0)
        self.assertEqual(data["scenario"]["incrementalResult"], -18000)
        self.assertEqual(data["scenario"]["wholeNetRevenue"], 18000)

    def test_validation_rejects_unknown_routes_bounds_boolean_and_extra_fields(self):
        cases = [{"routeId": "foreign"}, {"cutInputKg": -1}, {"cutInputKg": 1e9 + 1},
                 {"cutInputKg": True}, {"priceChangePct": "10"}, {"priceChangePct": -100.01},
                 {"packagingChangePct": 1000.01}, {"wholePrice": 999}]
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(self.client.post("/api/files/economics/evaluate", json=case).status_code, 422)
        for token in ["NaN", "Infinity", "-Infinity"]:
            with self.subTest(token=token):
                response = self.client.post("/api/files/economics/evaluate", content='{"cutInputKg":'+token+'}', headers={"content-type": "application/json"})
                self.assertEqual(response.status_code, 422)

    def test_absent_and_invalid_sources_return_explicit_status(self):
        p = Path(self.tmp.name) / "real_data_economics.json"
        p.unlink()
        for endpoint in ["catalog", "evaluate"]:
            response = self.client.get("/api/files/economics") if endpoint == "catalog" else self.client.post("/api/files/economics/evaluate", json={})
            self.assertEqual(response.status_code, 404)
            self.assertNotIn(self.tmp.name, response.text)
        p.write_text("{")
        self.assertEqual(self.client.get("/api/files/economics").status_code, 503)

    def test_inconsistent_source_versions_and_mass_are_rejected(self):
        original = copy.deepcopy(self.yields)
        self.yields["sources"]["efficiency"]["sha256"] = "b" * 64
        self.write()
        self.assertEqual(self.client.get("/api/files/economics").status_code, 503)
        self.yields = original
        self.yields["routes"][0]["outputs"][0]["yield_fraction"] = .9
        self.write()
        self.assertEqual(self.client.post("/api/files/economics/evaluate", json={}).status_code, 503)

    def test_negative_source_cost_requires_correction(self):
        self.economics["products"][0]["bulk"]["packaging_rub_per_product_kg"] = -1
        self.write()
        self.assertEqual(self.client.get("/api/files/economics").status_code, 503)


    def assert_inconsistent(self):
        self.write()
        for method, endpoint in [("get", "/api/files/economics"), ("post", "/api/files/economics/evaluate")]:
            response = self.client.get(endpoint) if method == "get" else self.client.post(endpoint, json={})
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["detail"][0]["type"], "source_inconsistent")

    def test_catalog_preserves_all_product_and_route_keys_in_order(self):
        data = self.client.get("/api/files/economics").json()
        self.assertEqual([r["product_id"] for r in data["economics"]["products"]], list(PRODUCT_IDS))
        self.assertEqual([r["id"] for r in data["yields"]["products"]], list(PRODUCT_IDS))
        self.assertEqual([r["route_id"] for r in data["economics"]["routes"]], list(ROUTE_IDS))
        self.assertEqual([r["id"] for r in data["yields"]["routes"]], list(ROUTE_IDS))
        self.assertEqual(len(PRODUCT_IDS), 22)
        for rid in ROUTE_IDS:
            data = self.evaluate(routeId=rid)
            row = next(r for r in data["comparison"] if r["routeId"] == rid)
            self.assertEqual(row["rubPerKg"], data["scenario"]["rubPerKg"])
            self.assertEqual(row["completeness"], data["completeness"])

    def test_hashes_are_required_and_canonical_source_is_unique(self):
        mutations = [
            lambda e, y: e["source_manifest"][0].pop("sha256"),
            lambda e, y: y["sources"]["efficiency"].pop("sha256"),
            lambda e, y: e["source_manifest"][0].update(sha256=None),
            lambda e, y: y["sources"]["efficiency"].update(sha256=""),
            lambda e, y: y["sources"]["efficiency"].update(sha256="z" * 64),
            lambda e, y: e["source_manifest"].append(copy.deepcopy(e["source_manifest"][0])),
            lambda e, y: e.update(primary_source="Другой источник.xlsx"),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(case=i):
                self.economics, self.yields = fixture()
                mutate(self.economics, self.yields)
                self.assert_inconsistent()

    def test_product_and_route_composition_and_order_require_exact_agreement(self):
        mutations = [
            lambda e, y: e["products"].pop(),
            lambda e, y: y["products"].pop(),
            lambda e, y: e["products"].append(copy.deepcopy(e["products"][0])),
            lambda e, y: y["products"][1].update(id=PRODUCT_IDS[0]),
            lambda e, y: e["products"].reverse(),
            lambda e, y: y["products"].reverse(),
            lambda e, y: e["routes"].pop(),
            lambda e, y: y["routes"].pop(),
            lambda e, y: e["routes"][1].update(route_id=ROUTE_IDS[0]),
            lambda e, y: y["routes"].append(copy.deepcopy(y["routes"][0])),
            lambda e, y: e["routes"].reverse(),
            lambda e, y: y["routes"].reverse(),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(case=i):
                self.economics, self.yields = fixture()
                mutate(self.economics, self.yields)
                self.assert_inconsistent()

    def test_missing_price_field_and_explicit_null_have_distinct_statuses(self):
        self.economics["products"][0]["bulk"].pop("price_rub_per_product_kg")
        self.assert_inconsistent()
        self.economics, self.yields = fixture()
        self.economics["products"][0]["bulk"]["price_rub_per_product_kg"] = None
        refresh_economics(self.economics, self.yields)
        self.write()
        data = self.evaluate()
        self.assertFalse(data["completeness"]["complete"])
        self.assertEqual(data["completeness"]["missingProducts"], [PRODUCT_IDS[0]])
        self.economics["products"][0]["bulk"]["price_rub_per_product_kg"] = 0
        refresh_economics(self.economics, self.yields)
        self.write()
        data = self.evaluate()
        self.assertTrue(data["completeness"]["complete"])
        self.assertEqual(data["scenario"]["revenue"], 0)
        self.assertLess(data["scenario"]["incrementalResult"], 0)

    def test_mass_preserving_yield_edit_is_detected_against_economic_coefficients(self):
        self.yields["routes"][0]["outputs"][0]["yield_fraction"] = .79
        self.yields["routes"][0]["outputs"][2]["yield_fraction"] = .21
        self.assertAlmostEqual(sum(x["yield_fraction"] for x in self.yields["routes"][0]["outputs"]), 1)
        self.assert_inconsistent()
        # Совпавшие доли при прежних сохранённых суммах также требуют нового снимка.
        terms = self.economics["routes"][0]["modes"]["bulk"]["terms"]
        terms[0]["yield_fraction"] = .79
        terms[-1]["yield_fraction"] = .21
        self.assert_inconsistent()

    def test_economic_terms_require_all_products_and_explicit_matching_prices(self):
        mutations = [
            lambda terms: terms.pop(),
            lambda terms: terms.append(copy.deepcopy(terms[0])),
            lambda terms: terms.reverse(),
            lambda terms: terms[0].update(yield_fraction=.7),
            lambda terms: terms[0].update(price_rub_per_kg=41),
            lambda terms: terms[0].update(packaging_rub_per_kg=5),
            lambda terms: terms[0].update(price_rub_per_kg=None),
            lambda terms: terms[0].pop("price_rub_per_kg"),
            lambda terms: terms[0].pop("packaging_rub_per_kg"),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(case=i):
                self.economics, self.yields = fixture()
                mutate(self.economics["routes"][0]["modes"]["bulk"]["terms"])
                self.assert_inconsistent()

    def test_saved_sums_and_completeness_match_recalculation(self):
        for key in ["revenue_rub_per_input_kg", "packaging_rub_per_input_kg", "revenue_after_packaging_rub_per_input_kg", "added_result_rub_per_input_kg"]:
            with self.subTest(key=key):
                self.economics, self.yields = fixture()
                self.economics["routes"][0]["modes"]["bulk"][key] += 1
                self.assert_inconsistent()
        self.economics, self.yields = fixture()
        self.economics["routes"][0]["modes"]["bulk"]["complete_product_price_coverage"] = False
        self.assert_inconsistent()
        self.economics, self.yields = fixture()
        self.economics["routes"][4]["modes"]["bulk"]["missing_valued_products"] = []
        self.assert_inconsistent()
        self.economics, self.yields = fixture()
        self.economics["whole_baseline"]["revenue_after_packaging_rub_per_kg"] = 99
        self.assert_inconsistent()

    def test_output_rows_reject_duplicates_unknown_products_and_missing_positive_products(self):
        mutations = [
            lambda rows: rows.append(copy.deepcopy(rows[0])),
            lambda rows: rows[0].update(product_id="foreign"),
            lambda rows: rows.pop(0),
            lambda rows: rows[0].update(yield_fraction=None),
            lambda rows: rows[0].pop("yield_fraction"),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(case=i):
                self.economics, self.yields = fixture()
                mutate(self.yields["routes"][0]["outputs"])
                self.assert_inconsistent()

    def test_sparse_zero_outputs_preserve_complete_positive_basket(self):
        for route in self.yields["routes"]:
            route["outputs"] = [row for row in route["outputs"] if row["yield_fraction"] > 0]
        self.write()
        data = self.evaluate()
        self.assertAlmostEqual(data["scenario"]["incrementalResult"], 10800)
        self.assertEqual(len(data["comparison"]), 5)

    def test_working_application_registers_both_financial_endpoints(self):
        from backend.app import app
        with TestClient(app) as client:
            response = client.get("/api/files/economics")
            self.assertEqual(response.status_code, 200, response.text)
            response = client.post("/api/files/economics/evaluate", json={"cutInputKg": 1000})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertAlmostEqual(response.json()["scenario"]["incrementalResult"], 10800)
            (Path(self.tmp.name) / "real_data_yields.json").unlink()
            self.assertEqual(client.get("/api/files/economics").status_code, 404)


    def test_unconfigured_source_returns_404_even_with_bundled_files_present(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SEVERNAYA_SOURCE_DATA_DIR", None)
            self.assertEqual(self.client.get("/api/files/economics").status_code, 404)
            self.assertEqual(self.client.post("/api/files/economics/evaluate", json={}).status_code, 404)

    def test_public_bundle_contains_primary_dataset_and_calculates_five_routes(self):
        with patch.dict(os.environ, {"SEVERNAYA_SOURCE_DATA_DIR": "bundled"}):
            response = self.client.get("/api/files/economics")
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(len(data["economics"]["products"]), 22)
            self.assertEqual(len(data["yields"]["routes"]), 5)
            self.assertNotIn("sources", data["yields"])
            for excluded in ["/Users/", "/private/", '"path"', '"read_file"', '"annual_context"',
                             '"sales_context"', '"pork_reference"', '"reference_datasets"', '"other_books"']:
                self.assertNotIn(excluded, response.text)
            for rid in ROUTE_IDS:
                result = self.evaluate(routeId=rid)
                self.assertEqual(len(result["comparison"]), 5)
                rate = result["scenario"]["rubPerKg"]
                self.assertTrue(all(math.isfinite(v) for v in rate.values()))
                self.assertAlmostEqual(rate["incrementalResult"], rate["revenue"] - rate["packaging"] - rate["wholePrice"] + rate["wholePackaging"])
                self.assertTrue(math.isfinite(result["scenario"]["incrementalResult"]))


if __name__ == "__main__":
    unittest.main()
