"""Ответы файловых маршрутов содержат только поля закрытого перечня.

Все вызовы идут на синтетические фикстуры из tests/fixtures_synthetic.
Каталог backend/client_data приложением при этом не читается.
"""
import re
from pathlib import Path
from typing import get_args, get_origin

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from backend.app import app
from backend.files_clients import _alias_maps, _load as load_catalog
from backend.schemas import (ClientDetails, ClientsCatalog, Costs, DemandCatalog, DemandDetails,
                             DemandEvaluation, Recommendations)

FIXTURES = Path(__file__).resolve().parent / "fixtures_synthetic"
FORBIDDEN_KEYS = {"sourceRefs", "sourceRow", "peerSourceRows", "monthlyCostSourceRows", "sha256",
                  "confirmedAliases", "source", "file", "path", "inn", "ogrn", "phone", "email",
                  "address", "contractNo", "manager", "managers", "managerCount"}
FORBIDDEN_PARTS = ("name", "file", "contract", "phone", "email", "manager", "address", "contact")
ALLOWED_NAME_KEYS = {"sourceNameCount"}  # число названий в источнике, а не название клиента
PHONE = re.compile(r"(?<!\d)(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
INN = re.compile(r"(?<!\d)(?:\d{10}|\d{12})(?!\d)")
OGRN = re.compile(r"(?<!\d)(?:\d{13}|\d{15})(?!\d)")
LOCAL_PATH = re.compile(r"/(?:Users|private|home|var|tmp)/|file://")
SYNTHETIC_PERSONAL = ("secret@example.test", "+70000000000", "7700000000", "1027700000000",
                      "Пример, ул. Тестовая, 1", "Д-000/2000", "Служебное имя", "Клиент пример",
                      "пример.xlsx", "a" * 64)
DEMAND_QUERY = {"dataset": "clients", "month": "2000-01", "days": 7}
ALIAS = re.compile(r"К-\d{3,}")
RAW_CLIENT_ID = "client1"  # исходный id синтетического клиента: в ответах не должен встречаться
CLIENT_KEYS = {"id", "clientId", "label"}  # ключи исходного идентификатора и названия: запрещены в объектах клиента

http = TestClient(app)


@pytest.fixture(autouse=True)
def synthetic_client_data(monkeypatch):
    monkeypatch.setenv("SEVERNAYA_CLIENT_DATA_DIR", str(FIXTURES))


def models_in(annotation):
    if get_origin(annotation) is None and isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    return [model for arg in get_args(annotation) for model in models_in(arg)]


def allowlist_problems(value, model, path="$"):
    """Проверяет, что каждый ключ на каждом уровне объявлен в перечне полей модели."""
    problems = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            problems += allowlist_problems(item, model, f"{path}[{index}]")
    elif isinstance(value, dict):
        fields = {field.serialization_alias or name: field for name, field in model.model_fields.items()}
        for key, item in value.items():
            if key not in fields:
                problems.append(f"{path}.{key}: ключ вне перечня")
                continue
            for nested in models_in(fields[key].annotation):
                problems += allowlist_problems(item, nested, f"{path}.{key}")
    return problems


def forbidden_problems(value, path="$"):
    """Ищет запрещенные ключи и name-поля на всех уровнях вложенности."""
    problems = []
    if isinstance(value, dict):
        for key, item in value.items():
            low = key.lower()
            banned = (key in FORBIDDEN_KEYS or low.endswith("_path")
                      or (key not in ALLOWED_NAME_KEYS and any(part in low for part in FORBIDDEN_PARTS)))
            if banned:
                problems.append(f"{path}.{key}: запрещенный ключ")
            problems += forbidden_problems(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            problems += forbidden_problems(item, f"{path}[{index}]")
    return problems


def contact_problems(value, path="$"):
    """Ищет строковые значения, похожие на телефон, e-mail, ИНН, ОГРН или локальный путь."""
    problems = []
    if isinstance(value, dict):
        for key, item in value.items():
            problems += contact_problems(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            problems += contact_problems(item, f"{path}[{index}]")
    elif isinstance(value, str):
        for label, pattern in (("телефон", PHONE), ("e-mail", EMAIL), ("ИНН", INN), ("ОГРН", OGRN), ("локальный путь", LOCAL_PATH)):
            if pattern.search(value):
                problems.append(f"{path}: похоже на {label}")
    return problems


def client_key_problems(payload):
    """Объекты клиента не содержат id, clientId и label; псевдоним соответствует формату К-NNN."""
    if isinstance(payload.get("client"), dict):
        rows = [("$.client", payload["client"])]
    else:
        rows = [(f"$.clients[{index}]", row) for index, row in enumerate(payload.get("clients") or [])]
    problems = []
    for path, row in rows:
        problems += [f"{path}.{key}: ключ исходного идентификатора или названия клиента" for key in sorted(CLIENT_KEYS & row.keys())]
        if not ALIAS.fullmatch(str(row.get("pseudonym", ""))):
            problems.append(f"{path}.pseudonym: формат псевдонима не соответствует К-NNN")
    if "clientId" in payload:
        problems.append("$.clientId: ключ исходного идентификатора клиента")
    return problems


def assert_clean(payload, model):
    problems = allowlist_problems(payload, model) + forbidden_problems(payload) + contact_problems(payload) + client_key_problems(payload)
    assert not problems, problems[:10]


def check_response(response, model):
    assert response.status_code == 200, response.text
    payload = response.json()
    assert_clean(payload, model)
    for secret in SYNTHETIC_PERSONAL:
        assert secret not in response.text, secret
    return payload


def first_demand_product_id():
    return http.get("/api/files/demand", params=DEMAND_QUERY).json()["products"][0]["id"]


@pytest.mark.parametrize("dataset", ["clients", "deals"])
def test_clients_catalog_allowlist(dataset):
    payload = check_response(http.get("/api/files/clients", params={"dataset": dataset}), ClientsCatalog)
    assert payload["datasetId"] == dataset
    assert payload["clients"]


def test_client_details_allowlist():
    catalog = http.get("/api/files/clients").json()
    payload = check_response(http.get(f"/api/files/clients/{catalog['clients'][0]['pseudonym']}"), ClientDetails)
    assert payload["client"]["products"][0]["monthly"]


def test_recommendations_allowlist():
    alias, _ = _alias_maps(load_catalog(), "clients")
    payload = check_response(http.get("/api/files/recommendations", params={"pseudonym": alias[RAW_CLIENT_ID], "productId": "sku1"}), Recommendations)
    assert payload["products"][0]["bestSignal"]["scenarioRub"] == 40000


def test_costs_selected_allowlist():
    payload = check_response(http.get("/api/files/costs", params={"product": "Товар исходный", "month": "2000-01"}), Costs)
    assert payload["selected"]["label"] == "Товар исходный"
    assert payload["stageCatalog"][0]["label"] == "Разделка"


def test_costs_catalog_allowlist():
    payload = check_response(http.get("/api/files/costs"), Costs)
    assert payload["selectionStatus"] == "choose_product"


def test_demand_catalog_allowlist():
    payload = check_response(http.get("/api/files/demand", params=DEMAND_QUERY), DemandCatalog)
    assert payload["products"]


def test_demand_details_allowlist():
    response = http.get(f"/api/files/demand/{first_demand_product_id()}", params=DEMAND_QUERY)
    payload = check_response(response, DemandDetails)
    assert payload["clients"]


def test_demand_evaluate_allowlist():
    body = {"dataset": "clients", "productId": first_demand_product_id(), "month": "2000-01", "days": 7,
            "plannedDemandKg": 1000.0, "ordersKg": 500.0, "inventoryKg": 100.0, "safetyKg": 50.0,
            "priceRubKg": 200.0, "discountPct": 5.0, "logisticsRubKg": 3.0}
    payload = check_response(http.post("/api/files/demand/evaluate", json=body), DemandEvaluation)
    assert payload["waterfall"][0]["label"] == "До доп. скидки"


def test_forbidden_key_added_to_synthetic_response_fails_check():
    synthetic = {"datasetId": "clients", "clients": [{"id": "client1", "sourceRefs": [{"file": "пример.xlsx", "rows": [2]}]}]}
    assert "$.clients[0].sourceRefs: запрещенный ключ" in forbidden_problems(synthetic)
    with pytest.raises(AssertionError):
        assert_clean(synthetic, ClientsCatalog)


def test_name_field_is_flagged_and_count_is_allowed():
    synthetic = {"summary": {"clientCount": 1, "sourceNameCount": 1, "name": "Иванов Иван"}}
    problems = forbidden_problems(synthetic)
    assert problems == ["$.summary.name: запрещенный ключ"]


def test_key_outside_model_allowlist_is_flagged():
    synthetic = {"products": [{"productId": "sku1", "signals": [{"period": "2000-01", "sourceRow": 2}]}]}
    assert allowlist_problems(synthetic, Recommendations) == ["$.products[0].signals[0].sourceRow: ключ вне перечня"]


def test_contact_values_are_detected():
    synthetic = {"phone": "+79990001122", "mail": "secret@example.test", "inn": "7700000000",
                 "ogrn": "1027700000000", "period": "2000-01", "sourceNameCount": 3,
                 "detailsPath": "/api/files/clients/{id}", "local": "/private/hidden.xlsx"}
    assert len(contact_problems(synthetic)) == 5


def test_client_keys_rule_flags_source_identifiers():
    synthetic = {"clients": [{"id": "client1", "label": "Клиент", "pseudonym": "К-001"}, {"pseudonym": "client2"}]}
    problems = client_key_problems(synthetic)
    assert "$.clients[0].id: ключ исходного идентификатора или названия клиента" in problems
    assert "$.clients[0].label: ключ исходного идентификатора или названия клиента" in problems
    assert "$.clients[1].pseudonym: формат псевдонима не соответствует К-NNN" in problems
    assert client_key_problems({"clientId": "client1"}) == ["$.clientId: ключ исходного идентификатора клиента"]


def test_client_responses_hide_source_identifiers():
    catalog_response = http.get("/api/files/clients")
    catalog = check_response(catalog_response, ClientsCatalog)
    detail_response = http.get(f"/api/files/clients/{catalog['clients'][0]['pseudonym']}")
    detail = check_response(detail_response, ClientDetails)
    demand_response = http.get(f"/api/files/demand/{first_demand_product_id()}", params=DEMAND_QUERY)
    demand = check_response(demand_response, DemandDetails)
    for response, payload in ((catalog_response, catalog), (detail_response, detail), (demand_response, demand)):
        assert RAW_CLIENT_ID not in response.text, "исходный id клиента найден в ответе"
        assert client_key_problems(payload) == []
    assert all(ALIAS.fullmatch(row["pseudonym"]) for row in catalog["clients"])
    assert ALIAS.fullmatch(detail["client"]["pseudonym"])
