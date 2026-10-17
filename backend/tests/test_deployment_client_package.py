"""Публичный пакет загружается через относительный путь развертывания."""
from contextlib import chdir
import gzip
import json
import math
from pathlib import Path
import re
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import app
from backend.files_clients import _alias_maps, _load as load_catalog

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "backend/client_data"
FILES = ("real_data_clients.json.gz", "next_stage_clients/recommendations_by_client.json", "next_stage_finance/full_costs_ui.json")
PRIVATE_KEY = re.compile(r"^(manager|managers|managerCount|manager_name|employee|employees|contact|contacts|phone|email|path|absolute_path|source_path)$", re.I)
PRIVATE_TEXT = re.compile(r"/Users/|/private/|/home/|/var/|/tmp/|file://|[A-Za-z]:\\|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")


def read(name):
    path = PACKAGE / name
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes())


@unittest.skipUnless(PACKAGE.is_dir(), "Папка backend/client_data отсутствует: тесты используют локальные данные клиентов")
class DeploymentClientPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.signals, cls.costs = [read(name) for name in FILES]

    def setUp(self):
        self.cwd = chdir(ROOT); self.cwd.__enter__(); self.addCleanup(self.cwd.__exit__, None, None, None)
        self.env = patch.dict("os.environ", {"SEVERNAYA_CLIENT_DATA_DIR": "backend/client_data"})
        self.env.start(); self.addCleanup(self.env.stop)
        self.client = TestClient(app)

    def test_package_metadata_contains_business_data_only(self):
        def scan(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    self.assertIsNone(PRIVATE_KEY.search(key), "Пакет содержит служебное поле")
                    self.assertFalse(key.endswith("_path"), "Пакет содержит локальный путь")
                    scan(item)
            elif isinstance(value, list):
                for item in value: scan(item)
            elif isinstance(value, str):
                self.assertIsNone(PRIVATE_TEXT.search(value), "Пакет содержит контакт или локальный путь")
        for document in (self.catalog, self.signals, self.costs): scan(document)

    def test_both_catalogs_and_largest_client_are_complete(self):
        for dataset in ("clients", "deals"):
            response = self.client.get("/api/files/clients", params={"dataset": dataset})
            self.assertEqual(response.status_code, 200)
            result = response.json(); self.assertEqual(len(result["clients"]), result["summary"]["clientCount"])
            largest = max(result["clients"], key=lambda c: c["revenueRub"])
            response = self.client.get(f"/api/files/clients/{largest['pseudonym']}", params={"dataset": dataset})
            self.assertEqual(response.status_code, 200); client = response.json()["client"]
            self.assertEqual(client["pseudonym"], largest["pseudonym"]); self.assertEqual(len(client["products"]), largest["productCount"])
            self.assertAlmostEqual(client["revenueRub"], math.fsum(p["revenueRub"] for p in client["products"]), delta=.002)
            self.assertTrue(all(p["monthly"] for p in client["products"]))
            self.assertLess(len(response.content), 4_000_000)

    def test_real_signal_preserves_exact_keys_and_formula(self):
        dataset = self.signals["datasets"][0]
        client = next(c for c in dataset["clients"] if any(p["historicalSignals"] for p in c["products"]))
        product = next(p for p in client["products"] if p["historicalSignals"])
        pseudonym = _alias_maps(load_catalog(), dataset["id"])[0][client["clientId"]]
        response = self.client.get("/api/files/recommendations", params={"dataset": dataset["id"], "pseudonym": pseudonym, "productId": product["productId"]})
        self.assertEqual(response.status_code, 200); result = response.json(); signal = result["products"][0]["bestSignal"]
        self.assertNotIn("clientId", result); self.assertEqual(result["productId"], product["productId"])
        self.assertEqual(result["label"], "Гипотеза исторического периода")
        self.assertAlmostEqual(signal["scenarioRub"], (signal["referencePriceRubKg"]-signal["priceRubKg"])*signal["focalVolumeKg"], delta=.002)
        self.assertIsNone(result["marketCeilingRubKg"]); self.assertIsNone(result["confirmedProfitRub"])

    def test_cost_register_uses_product_month_and_stage_method(self):
        response = self.client.get("/api/files/costs"); self.assertEqual(response.status_code, 200)
        result = response.json(); self.assertEqual(result["counts"]["records"], len(self.costs["skuRows"]))
        source = next(row for row in self.costs["skuRows"] if row["productionCostRubKg"] is not None)
        response = self.client.get("/api/files/costs", params={"product": source["product_key"], "month": source["period"]})
        self.assertEqual(response.status_code, 200); result = response.json(); selected = result["selected"]
        self.assertEqual(result["method"], "stage_allocation"); self.assertEqual(selected["period"], source["period"])
        self.assertEqual(selected["product_key"], source["product_key"])
        self.assertAlmostEqual(selected["productionCostRubKg"], sum(selected[k] for k in ("rawCostRubKg", "processingCostRubKg", "packingRubKg")), delta=1e-7)
        self.assertNotIn("sourceRefs", selected)
