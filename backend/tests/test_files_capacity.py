"""Синтетическая модель проверяет перенос ограничения между переделами."""
from copy import deepcopy
import json

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
import pytest

from backend.files_capacity import router, STAGE_MASS_BASES, PRIMARY_IDS
from backend.app import russian_validation_errors

app = FastAPI()
app.add_exception_handler(RequestValidationError, russian_validation_errors)
app.include_router(router)
client = TestClient(app)


def source_fixture():
    refs = [{"file": "/private/source/пример.xlsx", "sheet": "Мощности", "cells": "A1:F4"}]
    common = {"unit": "кг / сутки", "sourceRefs": refs, "shifts": 2, "hours": 10, "formula": "Мощность = фонд людей × часы × производительность"}
    rows = []
    for stage_id, mass in STAGE_MASS_BASES.items():
        rows.append({**common, "id": stage_id, "name": stage_id, "massBasis": mass,
                     "demand": 1400 if stage_id in PRIMARY_IDS else 10,
                     "capacity": 2800 if stage_id in PRIMARY_IDS else 20,
                     "staffTotal": 2, "kgPerPersonHour": 1})
    values = {
        "feet_pack": {"name": "Упаковка лап", "demand": 100, "capacity": 60, "staffTotal": 3, "kgPerPersonHour": 2},
        "liver": {"name": "Участок ливера", "demand": 50, "capacity": 40, "staffTotal": 2, "kgPerPersonHour": 2},
        "cutting": {"name": "Разделка", "demand": 500, "capacity": 500, "staffTotal": 5, "hours": 10, "shifts": 1},
        "bulk_carcass_pack": {"demand": 400, "capacity": 800, "staffTotal": 40, "kgPerPersonHour": 2},
        "individual_carcass_pack": {"demand": 100, "capacity": 200, "staffTotal": 10, "kgPerPersonHour": 2},
    }
    for row in rows:
        row.update(values.get(row["id"], {}))
    return {
        "schemaVersion": 1,
        "source": {"file": "/private/source/пример.xlsx", "path": "/private/source/пример.xlsx", "status": "Сохранённый расчёт файла", "versions": [{"path": "/private/old.xlsx"}], "sha256": "0" * 64, "capturedAt": "2026-01-01", "liveData": False},
        "period": {"volumeLabel": "Проверочный период", "yieldStructureLabel": "Проверочная структура", "displayUnit": "т / сутки"},
        "plan": {"finishedKgDay": 1000, "wholeKgDay": 500, "cutKgDay": 500, "liveKgDay": 1400, "headsDay": 700},
        "calendars": {"availability": {"value": .8}},
        "rows": rows,
        "cuttingLines": [{"staffTotal": 5, "shifts": 1, "kgPerPersonHour": 12, "equipmentKgPerHour": 50, "netHours": 10}],
        "gaps": ["Стоимость дополнительных ресурсов требует подтверждения"],
    }


def stage(data, stage_id):
    return next(row for row in data["rows"] if row["id"] == stage_id)



@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", str(tmp_path))
    path = tmp_path / "real_data_capacity.json"
    path.write_text(json.dumps(source_fixture(), ensure_ascii=False))
    return path


def evaluate(payload):
    response = client.post("/api/files/capacity/evaluate", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_catalog_baseline_and_private_paths(source):
    response = client.get("/api/files/capacity")
    assert response.status_code == 200
    data = response.json()
    assert data["baseline"]["maxFinishedKgDay"] == 600
    assert data["baseline"]["shortfallKgDay"] == 400
    assert data["baseline"]["limitingId"] == "feet_pack"
    assert set(data["source"]) == {"status", "capturedAt", "liveData"}
    assert "sha256" not in response.text and "sourceRefs" not in response.text
    assert stage(data, "feet_pack")["label"] == "Упаковка лап" and "name" not in stage(data, "feet_pack")
    assert "/private" not in response.text and '"path"' not in response.text
    assert stage(data, "feet_pack")["load"] == pytest.approx(100 / 60)
    assert data["moneyEffect"] is None


def test_isolated_effects_move_constraint_and_combined_gain(source):
    data = evaluate({"feetStaffDelta": 2, "liverStaffDelta": 1, "cuttingNetHoursDelta": 2})
    isolated = {item["id"]: item for item in data["leverEffects"]}
    assert isolated["feetStaffDelta"]["fulfilledPlanDeltaKgDay"] == 200
    assert isolated["feetStaffDelta"]["scenario"]["limitingId"] == "liver"
    assert isolated["liverStaffDelta"]["fulfilledPlanDeltaKgDay"] == 0
    assert isolated["cuttingNetHoursDelta"]["fulfilledPlanDeltaKgDay"] == 0
    assert data["scenario"]["fulfilledPlanKgDay"] == 1000
    assert data["combinedEffect"]["fulfilledPlanDeltaKgDay"] == 400
    assert data["combinedEffect"]["fulfilledPlanDeltaKgDay"] != sum(x["fulfilledPlanDeltaKgDay"] for x in isolated.values())
    assert isolated["cuttingNetHoursDelta"]["stageCapacityDeltaKgDay"] == 100
    assert isolated["feetStaffDelta"]["extraPersonHoursDay"] == 20
    assert isolated["cuttingNetHoursDelta"]["extraPersonHoursDay"] == 12.5
    cut = next(row for row in data["rows"] if row["id"] == "cutting")
    assert cut["extraGrossHoursDay"] == 2.5
    assert cut["extraNetPersonHoursDay"] == 10
    assert all(item["moneyEffect"] is None for item in data["leverEffects"])


def test_output_is_capped_by_original_plan_and_calls_are_independent(source):
    improved = evaluate({"feetStaffDelta": 3, "liverStaffDelta": 2, "cuttingNetHoursDelta": 4})
    assert improved["scenario"]["maxFinishedKgDay"] == 1200
    assert improved["scenario"]["fulfilledPlanKgDay"] == 1000
    assert improved["scenario"]["shortfallKgDay"] == 0
    assert evaluate({})["scenario"]["maxFinishedKgDay"] == 600


@pytest.mark.parametrize("payload", [
    {"feetStaffDelta": -1}, {"feetStaffDelta": 31}, {"feetStaffDelta": 1.5}, {"feetStaffDelta": True},
    {"liverStaffDelta": 21}, {"liverStaffDelta": "1"}, {"cuttingNetHoursDelta": 8.1},
    {"cuttingNetHoursDelta": -1}, {"cuttingNetHoursDelta": True}, {"path": "/private/file"},
])
def test_request_bounds(source, payload):
    assert client.post("/api/files/capacity/evaluate", json=payload).status_code == 422


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_request(source, value):
    response = client.post("/api/files/capacity/evaluate", content='{"cuttingNetHoursDelta":' + value + '}', headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_missing_source_has_russian_error(monkeypatch, tmp_path):
    monkeypatch.delenv("SEVERNAYA_SOURCE_DATA_DIR", raising=False)
    response = client.get("/api/files/capacity")
    assert response.status_code == 404
    assert "подключения" in response.json()["detail"][0]["msg"]
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", str(tmp_path))
    assert client.get("/api/files/capacity").status_code == 404


@pytest.mark.parametrize("case", ["json", "duplicate", "missing_stage", "negative", "nan", "formula", "zero_shifts", "empty_demand"])
def test_invalid_local_source_is_rejected(source, case):
    data = source_fixture()
    if case == "json":
        source.write_text("{")
    else:
        if case == "duplicate":
            data["rows"].append(deepcopy(data["rows"][0]))
        elif case == "missing_stage":
            data["rows"][0]["id"] = "unknown"
        elif case == "negative":
            stage(data, "feet_pack")["demand"] = -1
        elif case == "nan":
            data["source"]["value"] = float("nan")
        elif case == "formula":
            stage(data, "feet_pack")["capacity"] = 61
        elif case == "zero_shifts":
            data["cuttingLines"][0]["shifts"] = 0
        elif case == "empty_demand":
            for row in data["rows"]:
                row["demand"] = 0
        source.write_text(json.dumps(data))
    response = client.get("/api/files/capacity")
    assert response.status_code == 503
    assert "проверки" in response.json()["detail"][0]["msg"]
    assert str(source) not in response.text


def test_zero_capacity_and_inactive_stage_are_safe(source):
    data = source_fixture()
    stage(data, "feet_pack").update(staffTotal=0, capacity=0)
    stage(data, "liver").update(demand=0, capacity=0, staffTotal=0)
    source.write_text(json.dumps(data))
    result = evaluate({})
    assert result["scenario"]["maxFinishedKgDay"] == 0
    assert stage(result, "feet_pack")["load"] is None
    assert stage(result, "liver")["load"] == 0


def test_total_daily_hours_are_bounded(source):
    data = source_fixture()
    data["cuttingLines"][0]["netHours"] = 18
    stage(data, "cutting")["capacity"] = 900
    source.write_text(json.dumps(data))
    response = client.post("/api/files/capacity/evaluate", json={"cuttingNetHoursDelta": 2})
    assert response.status_code == 422
    assert "24" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("case", ["shortened", "unit", "basis", "partial_plan", "plan_sum", "cut_flow", "whole_flow", "primary_flow", "availability", "gross_source_hours", "passport", "period"])
def test_complete_physical_schema_is_required(source, case):
    data = source_fixture()
    if case == "shortened":
        data["rows"] = [row for row in data["rows"] if row["id"] in ("feet_pack", "liver", "cutting")]
    elif case == "unit":
        stage(data, "feet_pack")["unit"] = "т / неделю"
    elif case == "basis":
        stage(data, "feet_pack")["massBasis"] = "Входная тушка"
    elif case == "partial_plan":
        del data["plan"]["liveKgDay"]
    elif case == "plan_sum":
        data["plan"]["finishedKgDay"] += 1
    elif case == "cut_flow":
        stage(data, "cutting")["demand"] += 1
    elif case == "whole_flow":
        stage(data, "bulk_carcass_pack")["demand"] += 1
    elif case == "primary_flow":
        stage(data, "receiving")["demand"] += 1
    elif case == "availability":
        del data["calendars"]["availability"]
    elif case == "passport":
        del data["source"]
    elif case == "period":
        del data["period"]
    elif case == "gross_source_hours":
        data["cuttingLines"][0]["netHours"] = 20
        stage(data, "cutting")["capacity"] = 1000
    source.write_text(json.dumps(data))
    response = client.get("/api/files/capacity")
    assert response.status_code == 503
    assert response.json()["detail"][0]["type"] == "source_invalid"
    assert "input" not in response.text
    assert "/private" not in response.text


def test_extra_hour_is_daily_and_gross_time_accounts_for_all_shifts(source):
    data = source_fixture()
    data["cuttingLines"][0].update(staffTotal=10, shifts=2, netHours=5)
    source.write_text(json.dumps(data))
    result = evaluate({"cuttingNetHoursDelta": 2})
    cutting = stage(result, "cutting")
    assert cutting["capacity"] == 600
    assert cutting["extraNetPersonHoursDay"] == 10
    data["cuttingLines"][0]["netHours"] = 9
    stage(data, "cutting")["capacity"] = 900
    source.write_text(json.dumps(data))
    response = client.post("/api/files/capacity/evaluate", json={"cuttingNetHoursDelta": 2})
    assert response.status_code == 422


def test_stage_retains_formula_assumption_and_source_status(source):
    data = source_fixture()
    stage(data, "evisceration")["assumption"] = "Производительность содержит сценарный прирост"
    source.write_text(json.dumps(data))
    row = stage(evaluate({}), "evisceration")
    assert row["assumption"] == "Производительность содержит сценарный прирост"
    assert row["formula"] == stage(data, "evisceration")["formula"]
    assert row["sourceStatus"] == "Сохраненный расчет файла"


def test_exact_24_gross_hours_is_accepted(source):
    data = source_fixture()
    data["cuttingLines"][0]["netHours"] = 17.2
    stage(data, "cutting")["capacity"] = 860
    source.write_text(json.dumps(data))
    result = evaluate({"cuttingNetHoursDelta": 2})
    assert stage(result, "cutting")["capacity"] == 960


def test_bundled_published_source_is_complete_and_has_safe_metadata(monkeypatch):
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", "bundled")
    response = client.get("/api/files/capacity")
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["rows"]) == 17
    assert data["source"]["status"] == "Сохраненный расчет файла"
    assert "/Users/" not in response.text and '"path"' not in response.text
    assert data["source"]["liveData"] is False
    assert "30%" in stage(data, "evisceration")["assumption"]
    improved = evaluate({"feetStaffDelta": 7, "liverStaffDelta": 3})
    assert improved["scenario"]["fulfilledPlanKgDay"] == pytest.approx(data["plan"]["finishedKgDay"])
