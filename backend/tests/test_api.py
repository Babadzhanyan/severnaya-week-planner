"""Сервер проверяет ограничения, согласование и сохранённые версии."""
from copy import deepcopy
import json
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import model

client = TestClient(app)


def post(path, body):
    response = client.post("/api/" + path, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def approved():
    return post("snapshot", {"params": {}, "confirmations": {"com": True, "prod": True, "fin": True}})


def test_catalog_and_canonical_economics():
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/catalog").json() == model.CATALOG
    response = post("evaluate", {"params": {}})
    assert response["result"]["contribution"] == 2_600_000
    assert response["alternatives"]["baseline"]["result"]["contribution"] == 2_520_000
    assert response["alternatives"]["best"]["params"]["cut"] == 50


@pytest.mark.parametrize("route", model.ROUTES)
def test_route_mass_and_stage_requirements(route):
    result = post("evaluate", {"params": {"route": route}})["result"]
    assert sum(result["produced"].values()) + result["loss"] == pytest.approx(100)
    deboning = next(stage for stage in result["stages"] if stage["id"] == "deboning")
    assert deboning["load"] == result["cut"] * model.ROUTES[route]["deboneInputShare"]


def test_stock_and_future_sale_are_separate():
    result = post("evaluate", {"params": {"demand": {"fillet": 10}}})["result"]
    assert result["inventoryT"] == 6
    assert result["contribution"] == 740_000
    assert result["inventoryValue"] == 1_320_000
    assert result["expectedContribution"] == 2_060_000
    assert post("roi", {"params": result["params"]})["eligible"] is False


def test_business_invalid_returns_explanation():
    result = post("evaluate", {"params": {"demand": {"whole": 0}}})["result"]
    assert result["valid"] is False
    assert "обязательства" in result["errors"][0]


def test_zero_capacity_blocks_route():
    result = post("evaluate", {"params": {"stageCapacity": {"deboning": 0}}})["result"]
    assert result["valid"] is True and result["feasible"] is False
    assert result["stages"][1]["utilization"] is None


def test_request_absorbs_forecast_and_is_idempotent():
    request = {"requestId": "заказ-1", "product": "fillet", "quantity": 3.2, "price": 310, "service": 5}
    response = post("request", {"params": {}, "request": request})
    assert response["canApply"] is True
    assert response["forecastConsumed"] == 3.2
    assert response["params"]["demand"]["fillet"] == 16
    repeated = post("request", {"params": response["params"], "request": request})
    assert repeated["duplicate"] is True and repeated["canApply"] is False
    assert repeated["params"] == response["params"]
    assert client.get("/api/catalog").json()["defaults"]["requests"] == {}


def test_partial_request_cannot_be_applied():
    result = post("request", {"params": {}, "request": {"requestId": "большой", "product": "fillet", "quantity": 25, "price": 300}})
    assert result["covered"] <= 16 and result["canApply"] is False


def test_approval_requires_confirmations_and_feasibility():
    assert post("snapshot", {"params": {}})["approved"] is False
    assert post("snapshot", {"params": {"cut": 60}, "confirmations": {"com": True, "prod": True, "fin": True}})["approved"] is False
    snapshot = approved()
    fact = post("fact", {"snapshot": snapshot})
    assert fact["plan"] == 2_600_000
    assert fact["priceDelta"] == -80_000
    assert fact["costDelta"] == -10_000
    assert fact["actual"] == 2_510_000
    assert snapshot == approved()


@pytest.mark.parametrize("field", ["params", "result", "confirmations", "approved", "fingerprint", "modelVersion", "label"])
def test_snapshot_tampering_requires_reapproval(field):
    snapshot = approved()
    if field == "params":
        snapshot[field]["rawCost"] += 1
    elif field == "result":
        snapshot[field]["contribution"] += 1
    elif field == "confirmations":
        snapshot[field]["com"] = False
    elif field == "approved":
        snapshot[field] = False
    elif field == "fingerprint":
        snapshot[field] = "0" * 64
    else:
        snapshot[field] = "иная версия"
    response = client.post("/api/fact", json={"snapshot": snapshot})
    assert response.status_code == 409
    assert "повторного утверждения" in response.json()["detail"][0]["msg"]


def test_fact_retains_saved_parameters_and_scales_with_cut():
    saved = approved()
    post("evaluate", {"params": {"cut": 40}})
    assert post("fact", {"snapshot": saved})["plan"] == 2_600_000
    response = post("fact", {"params": {"cut": 40}})
    assert response["priceDelta"] == -64_000
    assert response["costDelta"] == -8_000


def test_roi_and_commercial_threshold():
    result = post("roi", {"params": {}, "options": {"weeks": 52, "execution": .75, "investment": 1_000_000, "annualOpex": 120_000}})
    assert result["weeklyEffect"] == 80_000
    assert result["annualEffect"] == 3_120_000
    assert result["netEffect"] == 3_000_000
    assert result["roi"] == 2
    commercial = post("commercial", {"client": {"volume": 10, "share": 60, "price": 230, "service": 20}})
    assert commercial == {"change": 0, "threshold": 60, "net": 210}


@pytest.mark.parametrize("params", [{"rawCost": -1}, {"hours": 169}, {"cut": "50"}, {"cut": True}, {"totalInput": 1_000_001}, {"route": "unknown"}, {"prices": {"alien": 10}}, {"extra": 1}, {"requests": {"constructor": {"product": "fillet", "quantity": 1, "price": 300}}}])
def test_structural_validation_is_russian(params):
    response = client.post("/api/evaluate", json={"params": params})
    assert response.status_code == 422
    for error in response.json()["detail"]:
        assert any("а" <= char.lower() <= "я" for char in error["msg"])
        assert "input" not in error


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_values_are_rejected(value):
    response = client.post("/api/evaluate", content='{"params":{"rawCost":' + value + '}}', headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_request_limits_and_exclusive_fact_source():
    assert client.post("/api/fact", json={}).status_code == 422
    assert client.post("/api/fact", json={"params": {}, "snapshot": approved()}).status_code == 422
    assert client.post("/api/evaluate", content=b" " * 1_048_577).status_code == 413
    assert client.post("/api/snapshot", json={"confirmations": {"com": "true"}}).status_code == 422
    assert client.post("/api/roi", json={"options": {"weeks": 54}}).status_code == 422
    assert client.post("/api/roi", json={"options": {"execution": 1.01}}).status_code == 422
    reservations = {str(index): {"product": "fillet", "quantity": 1, "price": 300} for index in range(101)}
    assert client.post("/api/evaluate", json={"params": {"requests": reservations}}).status_code == 422


def test_accepted_request_stays_within_next_call_limits():
    params = model.defaults()
    params["requests"] = {str(index): {"product": "fillet", "quantity": .01, "price": 300, "service": 0} for index in range(100)}
    params["orders"]["fillet"] = 1
    response = client.post("/api/request", json={"params": params, "request": {"requestId": "следующий", "product": "fillet", "quantity": .01, "price": 300}})
    assert response.status_code == 422


def test_http_errors_use_russian_messages():
    assert "требует" in client.get("/api/missing").json()["detail"][0]["msg"]
    assert "требует" in client.get("/api/evaluate").json()["detail"][0]["msg"]
