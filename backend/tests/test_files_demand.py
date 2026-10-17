"""Проверки точного объединения продукции и формул спроса на синтетических данных."""
import copy
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from backend.app import russian_validation_errors
from backend.files_demand import router
from backend.tests.test_files_costs import fixture as cost_fixture


def monthly(month="2000-01", volume=310, revenue=6200, cost=3100, margin=2500):
    return {"period": month, "volumeKg": volume, "revenueRub": revenue, "reportedCostRub": cost,
            "marginRub": margin, "rowCount": 1, "reportedCostCoverage": {"knownRowCount": 1},
            "sourceRefs": [{"file": "пример.xlsx", "sheet": "Продажи", "cells": "A:G", "rows": [2]}]}


def product(identifier="sku_a", name="Продукт А", cost_key="Продукт А", rows=None):
    return {"id": identifier, "name": name, "costProductKey": cost_key, "state": "Охлаждённый", "monthly": rows or [monthly()]}


def fixture():
    clients = [
        {"id": "c1", "name": "Клиент А", "manager": "Служебное имя", "products": [product(rows=[monthly(), monthly("2000-02", 290, 8700)]), product("raw_1", "Неизвестный продукт", None)]},
        {"id": "c2", "name": "Клиент Б", "email": "private@example.test", "products": [product(rows=[monthly(volume=620, revenue=15500)]), product("raw_2", "Неизвестный продукт", None)]},
    ]
    return {"period": {"start": "2000-01", "end": "2000-12"}, "datasets": [
        {"id": "clients", "label": "Клиентский отчёт", "clients": clients},
        {"id": "deals", "label": "Отчёт сделок", "clients": [{"id": "c3", "name": "Клиент В", "products": [product(rows=[monthly(volume=31, revenue=310)])]}]},
    ]}


class DemandTests(unittest.TestCase):
    def setUp(self):
        self.catalog, self.costs = fixture(), cost_fixture()
        self.load = patch("backend.files_demand.load_clients", side_effect=lambda: self.catalog)
        self.cost_load = patch("backend.files_demand.load_costs", side_effect=lambda: self.costs)
        self.load.start(); self.cost_load.start()
        self.addCleanup(self.load.stop); self.addCleanup(self.cost_load.stop)
        app = FastAPI(); app.include_router(router)
        app.add_exception_handler(RequestValidationError, russian_validation_errors)
        self.client = TestClient(app); self.addCleanup(self.client.close)

    def get(self, path="", **params):
        return self.client.get("/api/files/demand" + path, params={"month": "2000-01", **params})

    def identifier(self):
        return next(p["id"] for p in self.get().json()["products"] if p["costProductKey"] == "Продукт А")

    def evaluate(self, **changes):
        body = {"productId": self.identifier(), "month": "2000-01", "days": 7, "plannedDemandKg": 100,
                "ordersKg": 50, "inventoryKg": 30, "safetyKg": 10, "priceRubKg": 30, "discountPct": 10, "logisticsRubKg": 2}
        body.update(changes)
        return self.client.post("/api/files/demand/evaluate", json=body)

    def test_exact_aggregation_all_products_and_weighted_price(self):
        data = self.get().json()
        self.assertEqual(data["summary"]["productCount"], 3)
        p = next(p for p in data["products"] if p["costProductKey"])
        self.assertEqual(p["clientCount"], 2)
        self.assertEqual(p["volumeKg"], 930)
        self.assertAlmostEqual(p["priceRubKg"], 21700/930)
        self.assertEqual(p["suggestedDemandKg"], 210)
        self.assertIsNone(p["ordersKg"])

    def test_unknown_product_ids_remain_distinct(self):
        raw = [p for p in self.get().json()["products"] if p["costProductKey"] is None]
        self.assertEqual(len(raw), 2)
        self.assertNotEqual(raw[0]["id"], raw[1]["id"])
        self.assertTrue(all(p["costProductionRubKg"] is None for p in raw))

    def test_stable_key_across_month_and_dataset(self):
        identifier = self.identifier()
        self.assertEqual(self.get(month="2000-02").json()["products"][0]["id"], identifier)
        self.assertEqual(self.get(dataset="deals").json()["products"][0]["id"], identifier)
        self.assertEqual(self.get(dataset="deals").json()["summary"]["volumeKg"], 31)

    def test_details_months_clients_and_cells(self):
        data = self.get("/" + self.identifier()).json()
        self.assertEqual(len(data["history"]), 12)
        self.assertEqual(len(data["clients"]), 2)
        self.assertEqual(sorted(client["pseudonym"][-3:] for client in data["clients"]), ["001", "002"])
        self.assertTrue(all("name" not in client for client in data["clients"]))
        self.assertEqual(data["history"][1]["historyDays"], 29)
        self.assertFalse(data["history"][2]["observed"])
        self.assertEqual(data["product"]["label"], "Продукт А")
        self.assertNotIn("sourceRefs", data["product"])
        self.assertNotIn("sourceRefs", self.get("/" + self.identifier()).text)
        self.assertEqual(data["cost"]["productionCostRubKg"], 135)
        self.assertEqual(data["cost"]["month"], "2000-01")

    def test_full_formulas_and_effect_decomposition(self):
        response = self.evaluate(); self.assertEqual(response.status_code, 200)
        data = response.json(); s = data["scenario"]
        self.assertEqual(s["productionNeedKg"], 80)
        self.assertEqual(s["grossRevenueRub"], 3000)
        self.assertEqual(s["netPriceRubKg"], 27)
        self.assertEqual(s["revenueRub"], 2700)
        self.assertEqual(s["discountEffectRub"], -300)
        self.assertEqual(s["additionalLogisticsRub"], 200)
        self.assertEqual(s["revenueAfterAdditionalLogisticsRub"], 2500)
        self.assertAlmostEqual(s["deltaRevenueRub"], s["purePriceEffectRub"] + s["discountEffectRub"])
        self.assertAlmostEqual(s["deltaRevenueRub"], s["priceChangeRubKg"] * 100)
        self.assertIsNone(s["fullMarginRub"]); self.assertIsNone(s["capacityFeasible"])
        self.assertTrue(data["completeness"]["inputsComplete"])
        self.assertEqual(sum(b["value"] for b in data["waterfall"][:-1]), data["waterfall"][-1]["value"])

    def test_orders_are_included_once(self):
        s = self.evaluate(ordersKg=100).json()["scenario"]
        self.assertEqual(s["productionNeedKg"], 80)
        self.assertEqual(self.evaluate(ordersKg=101).status_code, 422)

    def test_unknown_orders_preserve_production_but_gap(self):
        data = self.evaluate(ordersKg=None).json()
        self.assertEqual(data["scenario"]["productionNeedKg"], 80)
        self.assertFalse(data["completeness"]["ordersKnown"])

    def test_missing_inventory_or_safety_requires_data(self):
        for field in ("inventoryKg", "safetyKg"):
            self.assertIsNone(self.evaluate(**{field: None}).json()["scenario"]["productionNeedKg"])

    def test_excess_inventory_yields_zero(self):
        self.assertEqual(self.evaluate(inventoryKg=200).json()["scenario"]["productionNeedKg"], 0)

    def test_price_and_discount_require_explicit_input(self):
        for field in ("priceRubKg", "discountPct"):
            data = self.evaluate(**{field: None}).json()
            self.assertIsNone(data["scenario"]["revenueRub"])
            self.assertEqual(data["waterfall"], [])
        self.assertIsNotNone(self.evaluate(discountPct=None).json()["scenario"]["purePriceEffectRub"])

    def test_zero_and_full_discount(self):
        self.assertEqual(self.evaluate(discountPct=100).json()["scenario"]["revenueRub"], 0)
        self.assertEqual(self.evaluate(priceRubKg=0).json()["scenario"]["netPriceRubKg"], 0)
        s = self.evaluate(plannedDemandKg=0, ordersKg=0, safetyKg=0, inventoryKg=0).json()["scenario"]
        self.assertEqual(s["revenueRub"], 0); self.assertEqual(s["productionNeedKg"], 0)

    def test_logistics_is_additional_and_optional(self):
        s = self.evaluate(logisticsRubKg=None).json()["scenario"]
        self.assertEqual(s["revenueRub"], 2700)
        self.assertIsNone(s["additionalLogisticsRub"])
        self.assertIsNone(s["revenueAfterAdditionalLogisticsRub"])

    def test_validation_rejects_bounds_types_and_extra(self):
        for values in ({"days":0},{"days":1.5},{"plannedDemandKg":-1},{"ordersKg":True},{"discountPct":101},{"priceRubKg":"30"},{"inventoryKg":-1},{"unknown":0}):
            self.assertEqual(self.evaluate(**values).status_code, 422, values)
        body = '{"productId":"x","month":"2000-01","plannedDemandKg":NaN}'
        self.assertEqual(self.client.post('/api/files/demand/evaluate', content=body, headers={"Content-Type":"application/json"}).status_code, 422)

    def test_invalid_and_unavailable_months(self):
        self.assertEqual(self.get(month="2000-13").status_code, 422)
        self.assertEqual(self.get(month="1999-01").status_code, 404)
        self.assertEqual(self.get(days=0).status_code, 422)
        self.assertEqual(self.get(dataset="other").status_code, 422)
        self.assertEqual(self.get("/missing").status_code, 404)

    def test_partial_cost_and_exact_month(self):
        self.costs["skuRows"][0]["status"] = "requires_data"
        self.costs["skuRows"][0]["coverage"] = "partial"
        p = self.get().json()["products"][0]
        self.assertIsNone(p["costProductionRubKg"]); self.assertEqual(p["costStatus"], "partial")

    def test_raw_cost_flag_preserves_unknown_in_details_and_evaluation(self):
        row = self.costs["skuRows"][0]
        row.update(rawCostRubKg=0, productionCostRubKg=35, status="requires_data", coverage="partial", issues=["raw_cost_requires_confirmation"])
        row["fieldStatus"]["rawCostRubKg"] = "zero"
        for data in (self.get('/' + self.identifier()).json(), self.evaluate().json()):
            cost = data["cost"]
            self.assertIsNone(cost["rawCostRubKg"])
            self.assertIsNone(cost["productionCostRubKg"])
            self.assertEqual(cost["fieldStatus"]["rawCostRubKg"], "requires_data")
            self.assertEqual(cost["processingCostRubKg"], 30)
            self.assertEqual(cost["packingRubKg"], 5)
            self.assertIn("raw_cost_requires_confirmation", cost["issues"])

    def test_confirmed_zero_cost_remains_zero(self):
        row = self.costs["skuRows"][0]
        row.update(rawCostRubKg=0, productionCostRubKg=35)
        row["fieldStatus"]["rawCostRubKg"] = "zero"
        cost = self.get('/' + self.identifier()).json()["cost"]
        self.assertEqual(cost["rawCostRubKg"], 0)
        self.assertEqual(cost["productionCostRubKg"], 35)
        self.assertEqual(cost["fieldStatus"]["rawCostRubKg"], "zero")

    def test_missing_cost_articles_preserve_unknown_by_field_status(self):
        row = self.costs["skuRows"][0]
        row.update(status="requires_data", coverage="partial", issues=["source_values_missing"])
        for field, status in (("rawCostRubKg", "error"), ("processingCostRubKg", "missing_formula_cache"), ("packingRubKg", "blank")):
            row[field] = None
            row["fieldStatus"][field] = status
        row["productionCostRubKg"] = None
        row["fieldStatus"]["productionCostRubKg"] = "requires_data"
        cost = self.evaluate().json()["cost"]
        for field in ("rawCostRubKg", "processingCostRubKg", "packingRubKg", "productionCostRubKg"):
            self.assertIsNone(cost[field])
            self.assertEqual(cost["fieldStatus"][field], "requires_data")

    def test_missing_breakdown_retains_known_processing_amount(self):
        row = self.costs["skuRows"][0]
        row.update(status="requires_data", coverage="partial", issues=["stage_details_missing"])
        cost = self.evaluate().json()["cost"]
        self.assertEqual(cost["processingCostRubKg"], 30)
        self.assertEqual(cost["fieldStatus"]["processingCostRubKg"], "saved")
        self.assertIsNone(cost["productionCostRubKg"])

    def test_missing_cost_file_keeps_sales_catalog(self):
        with patch("backend.files_demand.load_costs", side_effect=HTTPException(404, "Требуются данные")):
            self.assertEqual(self.get().status_code, 200)
            self.assertIsNone(self.get().json()["products"][0]["costProductionRubKg"])

    def test_malformed_cost_file_is_visible(self):
        with patch("backend.files_demand.load_costs", side_effect=HTTPException(503, "Требуется проверка")):
            self.assertEqual(self.get().status_code, 503)

    def test_private_fields_do_not_enter_demand_projection(self):
        text = self.get().text + self.get('/' + self.identifier()).text
        for word in ("Служебное имя", "private@example.test", "manager", "/private/"):
            self.assertNotIn(word, text)

    def test_negative_volume_retains_history_and_requires_reference(self):
        self.catalog = copy.deepcopy(self.catalog)
        p = self.catalog["datasets"][0]["clients"][0]["products"][1]
        p["monthly"][0]["volumeKg"] = -10
        raw = next(x for x in self.get().json()["products"] if x["volumeKg"] == -10)
        self.assertIsNone(raw["suggestedDemandKg"]); self.assertIsNone(raw["priceRubKg"])

    def test_missing_cost_coverage_preserves_unknown(self):
        self.catalog["datasets"][0]["clients"][0]["products"][0]["monthly"][0]["reportedCostCoverage"]["knownRowCount"] = 0
        p = next(x for x in self.get().json()["products"] if x["costProductKey"])
        self.assertIsNone(p["reportedCostRubKg"]); self.assertEqual(p["reportedCostStatus"], "partial")

    def test_missing_source_remains_404(self):
        with patch("backend.files_demand.load_clients", side_effect=HTTPException(404, "Требуется каталог")):
            self.assertEqual(self.get().status_code, 404)
