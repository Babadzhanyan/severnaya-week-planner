"""Публичный режим: клиентские маршруты и детализация спроса отвечают 404; факты открыты как агрегаты; каталог спроса без клиентских ключей.

Вызовы идут на синтетические фикстуры из tests/fixtures_synthetic, каталог backend/client_data не читается.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.files_clients import _alias_maps, _load as load_catalog
from backend.public_mode import ENV_NAME

FIXTURES = Path(__file__).resolve().parent / "fixtures_synthetic"
DEMAND = {"dataset": "clients", "month": "2000-01", "days": 7}
RESTRICTED = {"clients", "retailChains", "deliveryZones", "channels", "sourceRefs", "confirmedAliases"}
http = TestClient(app)


@pytest.fixture(autouse=True)
def synthetic_client_data(monkeypatch):
    monkeypatch.setenv("SEVERNAYA_CLIENT_DATA_DIR", str(FIXTURES))
    monkeypatch.delenv(ENV_NAME, raising=False)


def restricted_keys(value):
    if isinstance(value, dict):
        return {key for key in value if key in RESTRICTED} | {found for item in value.values() for found in restricted_keys(item)}
    if isinstance(value, list):
        return {found for item in value for found in restricted_keys(item)}
    return set()


def restricted_calls():
    """Адреса, которые содержат клиентские данные; собираются в локальном режиме."""
    alias, _ = _alias_maps(load_catalog(), "clients")
    product = http.get("/api/files/demand", params=DEMAND).json()["products"][0]["id"]
    return [
        ("/api/files/clients", None),
        (f"/api/files/clients/{alias['client1']}", None),
        ("/api/files/recommendations", {"pseudonym": alias["client1"], "productId": "sku1"}),
        (f"/api/files/demand/{product}", DEMAND),
    ]


# Факты – агрегаты без строк клиентов и сотрудников: открыты и в публичном режиме.
OPEN_CALLS = [("/api/facts", None)]


def test_local_mode_serves_restricted_routes():
    for path, params in restricted_calls() + OPEN_CALLS:
        assert http.get(path, params=params).status_code == 200, path


def test_public_mode_refuses_restricted_routes(monkeypatch):
    calls = restricted_calls()
    monkeypatch.setenv(ENV_NAME, "1")
    for path, params in calls:
        response = http.get(path, params=params)
        assert response.status_code == 404, path
        assert response.json()["detail"][0]["type"] == "public_mode", path


def test_public_mode_opens_facts_aggregates(monkeypatch):
    monkeypatch.setenv(ENV_NAME, "1")
    for path, params in OPEN_CALLS:
        assert http.get(path, params=params).status_code == 200, path
    # Раздел channels (доли каналов сбыта) есть в RESTRICTED: до подтверждения владельца это исключение фиксируется явно.
    assert restricted_keys(http.get("/api/facts").json()) == {"channels"}


@pytest.mark.parametrize("value", ["0", "true", ""])
def test_only_exact_one_enables_public_mode(monkeypatch, value):
    monkeypatch.setenv(ENV_NAME, value)
    assert http.get("/api/files/clients").status_code == 200


def test_public_mode_catalog_has_no_restricted_keys(monkeypatch):
    monkeypatch.setenv(ENV_NAME, "1")
    response = http.get("/api/files/demand", params=DEMAND)
    assert response.status_code == 200
    assert restricted_keys(response.json()) == set()
