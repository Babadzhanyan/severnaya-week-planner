"""Проверки связности регистра на вымышленных продуктах и суммах."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.files_costs import RATES, read_checked, router


def fixture():
    rows = []
    for product, period, partial in (("Продукт А", "2000-01", False), ("Продукт А", "2000-02", False), ("Продукт Б", "2000-02", True)):
        raw = 0.0 if partial else 100.0
        rows.append({"period": period, "product_key": product, "name": product, "volumeKg": 2000,
                     "rawCostRubKg": raw, "processingCostRubKg": 30.0, "packingRubKg": 5.0,
                     "productionCostRubKg": raw + 35.0, "logisticsRubKg": 7.0,
                     "logisticsIncluded": False, "fullCostRubKg": None, "fullCostConfirmed": False,
                     "coverage": "partial" if partial else "allocated_production", "status": "requires_data" if partial else "saved",
                     "issues": ["raw_cost_requires_confirmation"] if partial else [],
                     "fieldStatus": {key: "zero" if key == "rawCostRubKg" and partial else "saved" for key in RATES},
                     "stageBreakdown": [{"id": "cutting", "rubKg": 33.0}, {"id": "allocation_adjustment", "rubKg": -3.0}],
                     "articleBreakdown": [{"id": "labour", "rubKg": 28.0}, {"id": "other", "rubKg": 5.0}, {"id": "allocation_adjustment", "rubKg": -3.0}],
                     "sourceRefs": {"register": "Регистр!A2:O2", "stages": "Переделы!A4:CD4", "adjustments": "Расчёт!BU14,BU17"}})
    return {"schemaVersion": 1, "method": "stage_allocation", "periods": ["2000-01", "2000-02"],
            "source": {"file": "/private/account/пример.xlsx", "sha256": "a" * 64, "path": "/private/account/secret.xlsx"},
            "costBasis": "output_kg", "costBasisLabel": "Выпуск, кг", "taxBasis": None,
            "taxBasisStatus": "Требуется подтверждение: налоговая основа", "fullCostStatus": "Требуется подтверждение: состав расходов",
            "logisticsStatus": "Распределённая ставка логистики", "breakdownStatus": "Корректировка связывает детализацию с регистром",
            "stageCatalog": [{"id": "cutting", "name": "Разделка"}, {"id": "allocation_adjustment", "name": "Корректировка"}],
            "articleCatalog": [{"id": "labour", "name": "Труд"}, {"id": "other", "name": "Прочие расходы"}, {"id": "allocation_adjustment", "name": "Корректировка"}],
            "issueLabels": {"raw_cost_requires_confirmation": "Требуется подтверждение: сырьё", "stage_details_missing": "Требуется детализация", "source_values_missing": "Требуются значения"},
            "statusLabels": {"saved": "Сохранено", "zero": "Сохранённый ноль", "error": "Ошибка источника", "requires_data": "Требуются данные"},
            "skuRows": rows, "quality": {"rowCount": 3, "partialRowCount": 1}, "internal_audit": "Служебное содержимое"}


class FilesCostsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict("os.environ", {"SEVERNAYA_CLIENT_DATA_DIR": self.tmp.name})
        self.env.start()
        self.data = fixture()
        self.directory = Path(self.tmp.name) / "next_stage_finance"
        self.directory.mkdir()
        self.write()
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.tmp.cleanup()
        read_checked.cache_clear()

    def write(self):
        (self.directory / "full_costs_ui.json").write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")
        read_checked.cache_clear()

    def get(self, **params):
        return self.client.get("/api/files/costs", params=params)

    def test_config_gate_remains_closed_after_successful_read(self):
        self.assertEqual(self.get().status_code, 200)
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(self.get().status_code, 404)

    def test_catalog_returns_keys_and_counts_without_private_records(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["counts"], {"products": 2, "records": 3, "partialRecords": 1})
        self.assertIsNone(result["selected"])
        self.assertEqual(result["selectionStatus"], "choose_product")
        self.assertNotIn("source", result)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        for private in ("/private/", "skuRows", "internal_audit", '"path"', "sourceRefs", "sha256", "пример.xlsx"):
            self.assertNotIn(private, response.text)

    def test_product_month_stays_exact_and_breakdowns_reconcile(self):
        result = self.get(product="Продукт А", month="2000-01").json()["selected"]
        self.assertEqual(result["period"], "2000-01")
        self.assertEqual(result["productionCostRubKg"], 135)
        self.assertEqual(result["logisticsRubKg"], 7)
        self.assertFalse(result["logisticsIncluded"])
        self.assertIsNone(result["fullCostRubKg"])
        for field in ("stageBreakdown", "articleBreakdown"):
            self.assertEqual(sum(row["rubKg"] for row in result[field]), 30)
        self.assertEqual(result["label"], "Продукт А")
        self.assertNotIn("name", result)
        self.assertNotIn("sourceRefs", result)

    def test_internal_fields_of_details_stay_local(self):
        self.data["skuRows"][0]["stageBreakdown"][0]["private_note"] = "Служебная заметка"
        self.data["stageCatalog"][0]["private_note"] = "Служебная заметка"
        self.write()
        response = self.get(product="Продукт А", month="2000-01")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("private_note", response.text)

    def test_omitted_month_selects_latest_available_for_exact_product(self):
        self.assertEqual(self.get(product="Продукт А").json()["selected"]["period"], "2000-02")

    def test_unknown_product_and_missing_month_preserve_empty_selection(self):
        unknown = self.get(product="Продукт А с другим названием").json()
        self.assertIsNone(unknown["selected"])
        self.assertEqual(unknown["selectionStatus"], "product_requires_mapping")
        missing = self.get(product="Продукт Б", month="2000-01").json()
        self.assertIsNone(missing["selected"])
        self.assertEqual(missing["selectionStatus"], "period_requires_data")

    def test_partial_row_keeps_saved_zero_and_confirmation_issue(self):
        row = self.get(product="Продукт Б").json()["selected"]
        self.assertEqual(row["rawCostRubKg"], 0)
        self.assertEqual(row["fieldStatus"]["rawCostRubKg"], "zero")
        self.assertEqual(row["status"], "requires_data")
        self.assertFalse(row["fullCostConfirmed"])
        self.assertIn("raw_cost_requires_confirmation", row["issues"])

    def test_source_error_preserves_null(self):
        row = self.data["skuRows"][0]
        row.update(rawCostRubKg=None, productionCostRubKg=None, status="requires_data", issues=["source_values_missing"])
        row["fieldStatus"].update(rawCostRubKg="error", productionCostRubKg="error")
        self.data["quality"]["partialRowCount"] = 2
        self.write()
        selected = self.get(product="Продукт А", month="2000-01").json()["selected"]
        self.assertIsNone(selected["rawCostRubKg"])
        self.assertIsNone(selected["productionCostRubKg"])

    def test_invalid_totals_duplicate_keys_and_nan_are_rejected(self):
        original = copy.deepcopy(self.data)
        mutations = [lambda d: d["skuRows"][0].update(productionCostRubKg=136),
                     lambda d: d["skuRows"][0]["stageBreakdown"][0].update(rubKg=34),
                     lambda d: d["skuRows"].append(copy.deepcopy(d["skuRows"][0])),
                     lambda d: d["skuRows"][0].update(rawCostRubKg=float("nan")),
                     lambda d: d["skuRows"][0].update(fullCostConfirmed=True),
                     lambda d: d["skuRows"][0].update(logisticsIncluded=True)]
        for mutate in mutations:
            self.data = copy.deepcopy(original)
            mutate(self.data)
            self.write()
            self.assertEqual(self.get().status_code, 503)

    def test_missing_reference_and_breakdown_item_are_rejected(self):
        self.data["skuRows"][0]["sourceRefs"].pop("adjustments")
        self.write()
        self.assertEqual(self.get().status_code, 503)
        self.data = fixture()
        self.data["skuRows"][0]["articleBreakdown"].pop()
        self.write()
        self.assertEqual(self.get().status_code, 503)

    def test_invalid_query_and_missing_package_are_explicit(self):
        self.assertEqual(self.get(month="2000-13").status_code, 422)
        self.assertEqual(self.get(product=" ").status_code, 422)
        (self.directory / "full_costs_ui.json").unlink()
        self.assertEqual(self.get().status_code, 404)


if __name__ == "__main__":
    unittest.main()
