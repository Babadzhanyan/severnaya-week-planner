"""Единицы и мощности: эталон 92,86918 %, перевод по календарю, паспорта, учебные пределы.

Все значения синтетические или взяты из эталона пакета. Исходные файлы предприятия не читаются.
"""
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import units as u
from backend.files_capacity import router as capacity_router, STAGE_MASS_BASES, PRIMARY_IDS


SOURCE_CELL = {"sheet": "2.2", "cells": "D19"}
BULK_DEMAND, BULK_CAPACITY = 313221.7507, 337272


def base(physical="Живой вес в эквиваленте общего потока", weighing="Требуется подтверждение: точка взвешивания"):
    return {"physicalBase": physical, "weighingPoint": weighing}


# 1. Эталон пакета: 313 221,75 / 337 272 кг в сутки = 92,86918 %
def test_reference_packing_load_matches_package():
    assert round(u.load_percent(BULK_DEMAND, BULK_CAPACITY), 5) == 92.86918
    assert round(u.load_percent(313221.75, BULK_CAPACITY), 1) == 92.9
    assert u.load_percent(BULK_DEMAND, 0) is None
    assert u.load_percent(None, BULK_CAPACITY) is None


def test_load_is_not_rounded_and_rejects_invalid_numbers():
    assert u.load_percent(50, 200) == 25
    for bad in (float("nan"), float("inf"), True, "1"):
        with pytest.raises(ValueError):
            u.load_percent(bad, 200)


# 2. Пороги статуса совпадают со строками мощности: выше 90 % высокая загрузка, выше мощности превышение
@pytest.mark.parametrize("flow, capacity, status", [
    (BULK_DEMAND, BULK_CAPACITY, "Высокая загрузка"),
    (100, 100, "Высокая загрузка"),
    (90, 100, "Резерв мощности"),
    (101, 100, "Превышение мощности"),
    (0, 0, "Резерв мощности"),
    (5, 0, "Превышение мощности"),
    (None, 100, "Нет данных"),
])
def test_load_status_thresholds(flow, capacity, status):
    assert u.load_status(flow, capacity) == status


# 3. Перевод т <-> кг и сутки <-> неделя сохраняет загрузку при согласованном календаре
def test_mass_conversion_round_trip():
    assert u.to_t(BULK_CAPACITY) == pytest.approx(337.272)
    assert u.to_kg(u.to_t(BULK_DEMAND)) == pytest.approx(BULK_DEMAND)


@pytest.mark.parametrize("days", [5, 6, 7])
def test_load_is_invariant_under_the_same_calendar(days):
    week_flow, week_capacity = u.day_to_week(BULK_DEMAND, days), u.day_to_week(BULK_CAPACITY, days)
    assert u.load_percent(week_flow, week_capacity) == pytest.approx(u.load_percent(BULK_DEMAND, BULK_CAPACITY))
    assert u.week_to_day(week_flow, days) == pytest.approx(BULK_DEMAND)


def test_mismatched_calendars_change_the_load():
    mixed = u.load_percent(u.day_to_week(BULK_DEMAND, 6), u.day_to_week(BULK_CAPACITY, 7))
    assert mixed != pytest.approx(u.load_percent(BULK_DEMAND, BULK_CAPACITY))


def test_calendar_days_must_be_explicit_and_positive():
    for bad in (0, -1, None, True, float("nan")):
        with pytest.raises(ValueError):
            u.day_to_week(BULK_CAPACITY, bad)
    with pytest.raises(TypeError):
        u.day_to_week(BULK_CAPACITY)  # рабочие дни не задаются по умолчанию


def test_per_shift_and_per_hour():
    assert u.per_shift(BULK_CAPACITY, 2) == pytest.approx(168636)
    assert u.per_hour(BULK_CAPACITY, 2, 10) == pytest.approx(16863.6)


# QA-07: рабочие дни недели не подставляются; гипотеза контракта выводится в подпись как «Требуется подтверждение»
def test_working_days_label_shows_contract_hypothesis_status():
    hypothesis = "гипотеза, принята заказчиком"
    assert u.working_days_label(7, hypothesis) == "Требуется подтверждение: 7 рабочих дней, гипотеза"
    assert u.working_days_label(7, "требуется подтверждение") == "Требуется подтверждение: 7 рабочих дней"
    assert u.working_days_label(7, None) == "Требуется подтверждение: 7 рабочих дней"


def test_working_days_label_after_confirmation_has_no_hypothesis_prefix():
    assert u.working_days_label(5, "подтверждено заказчиком") == "5 рабочих дней"
    assert u.working_days_label(7.0, "подтверждено") == "7 рабочих дней"
    assert u.working_days_label(1, "подтверждено") == "1 рабочий день"
    assert u.working_days_label(2, "подтверждено") == "2 рабочих дня"
    assert u.working_days_label(11, "подтверждено") == "11 рабочих дней"
    assert u.working_days_label(22, "подтверждено") == "22 рабочих дня"


@pytest.mark.parametrize("days", [None, 0, -7, 5.5, True, float("nan"), float("inf"), "7"])
def test_working_days_label_never_substitutes_seven(days):
    label = u.working_days_label(days, "гипотеза, принята заказчиком")
    assert label == "Требуется подтверждение: число рабочих дней недели не задано"
    assert "7" not in label


def test_working_days_are_not_defaulted_in_week_conversion():
    with pytest.raises(TypeError):
        u.day_to_week(BULK_CAPACITY)
    with pytest.raises(TypeError):
        u.week_to_day(BULK_CAPACITY)


# 4. Паспорт ячейки сохраняет значение, единицу, базу, точку взвешивания, период, календарь и правило
def test_unit_passport_keeps_every_field_and_no_file_names():
    passport = u.unit_passport(SOURCE_CELL, BULK_DEMAND, "кг / сутки", base(), "Учебный период",
                               "Доступность календаря 0,8", "кг / смену = кг / сутки / смены")
    assert set(passport) == {"sourceCell", "value", "unit", "physicalBase", "weighingPoint", "period",
                             "calendar", "conversionRule", "status"}
    assert passport["sourceCell"] == SOURCE_CELL and passport["status"] == "Сохраненный расчет файла"
    assert "file" not in json.dumps(passport) and "path" not in json.dumps(passport)


def test_unit_passport_without_value_has_no_data_status_and_rejects_incomplete_base():
    passport = u.unit_passport(SOURCE_CELL, None, "кг / сутки", base(), "Период", "Календарь", "Правило")
    assert passport["value"] is None and passport["status"] == "Нет данных"
    with pytest.raises(ValueError, match="passport_incomplete"):
        u.unit_passport(SOURCE_CELL, 1, "кг / сутки", {"physicalBase": "Живой вес"}, "Период", "Календарь", "Правило")
    with pytest.raises(ValueError, match="passport_incomplete"):
        u.unit_passport(SOURCE_CELL, "1", "кг / сутки", base(), "Период", "Календарь", "Правило")


def test_resource_card_carries_numerator_denominator_percent_and_sources():
    card = u.resource_card(BULK_DEMAND, BULK_CAPACITY, "кг / сутки", "Учебный период", [SOURCE_CELL], None)
    assert card["numerator"] == BULK_DEMAND and card["denominator"] == BULK_CAPACITY
    assert round(card["percent"], 5) == 92.86918 and card["status"] == "Высокая загрузка"
    assert card["sourceCells"] == [SOURCE_CELL]
    with pytest.raises(ValueError):
        u.resource_card(BULK_DEMAND, BULK_CAPACITY, "кг / сутки", "Период", [], None)


# 5. Вес тушки 2 кг: формула включает потроха и потери, целая тушка 1,89862685 кг, товарные части 1,85752963 кг
def test_carcass_passport_checks_the_offal_deduction():
    passport = u.carcass_passport()
    assert passport["wholeKgHead"]["value"] == 1.89862685
    assert passport["wholeKgHead"]["derivedValue"] == 1.8986
    assert passport["wholeKgHead"]["derivedCheck"] is True
    assert passport["offalAndLossKgHead"] == pytest.approx(0.1014)
    assert passport["wholeYieldFromLivePct"] == pytest.approx(94.9313425)
    assert passport["goodsKgHead"]["value"] == 1.85752963
    assert passport["liveKgHead"]["status"].startswith("Требуется подтверждение")


def test_carcass_passport_flags_wrong_deduction():
    assert u.carcass_passport(offal_share_pct=6.0)["wholeKgHead"]["derivedCheck"] is False


# 6. Пример 30 тыс. голов × 2 кг = 60 т: функция расчета, норма ждет подтверждения периода
def test_flock_example_is_a_function_with_pending_norm():
    example = u.flock_example()
    assert example["massT"] == pytest.approx(60.0)
    assert example["status"] == "Требуется подтверждение"
    assert "периода и точки взвешивания" in example["statusReason"]
    with pytest.raises(ValueError):
        u.flock_example(heads=0)


# 7. 4 009 % диагностируется как смешение исходных условий; 4 010 т не равно доступной неделе
def test_training_percent_is_diagnosed_and_stays_training():
    diagnosis = u.training_load_diagnosis()
    assert diagnosis["percent"] == pytest.approx(4009.0)
    assert diagnosis["status"] == "Учебный пример"
    assert "Смешение исходных условий" in diagnosis["diagnosis"] and "4 009 т" in diagnosis["diagnosis"]


def test_historical_week_is_not_the_available_week():
    week = u.historical_week_equivalent()
    assert week["valueKg"] == pytest.approx(4009615.3846, rel=1e-9)
    assert week["valueTRounded"] == 4010
    assert week["formula"] == "208,5 млн кг / 52"
    assert week["status"] == "Исторический срез"
    assert week["weekAvailability"]["status"] == "Нет данных"
    dated = u.historical_week_equivalent(dated_plan_kg=3900000)
    assert dated["weekAvailability"]["valueKg"] == 3900000


# 8. Учебные пределы сохраняют статус до назначения потока; замена только валовой упаковкой
def test_training_limit_stays_training_without_designated_flow():
    limit = u.training_limit("Упаковка, т в неделю", 100)
    assert u.replace_training_limit(limit, None)["status"] == "Учебный пример"
    assert u.replace_training_limit(limit, None)["replacedBy"] is None


def test_training_limit_is_replaced_only_by_bulk_pack_flow():
    limit = u.training_limit("Упаковка, т в неделю", 100)
    flow = {"flowId": "bulk_carcass_pack", "name": "Валовая упаковка тушки", "capacityKgDay": BULK_CAPACITY,
            "status": "Сохранённый расчёт файла"}
    replaced = u.replace_training_limit(limit, flow)
    assert replaced["valueT"] == pytest.approx(337.272) and replaced["unit"] == "т / сутки"
    assert replaced["replacedBy"] == "bulk_carcass_pack" and replaced["replacedLabel"] == limit["label"]
    with pytest.raises(ValueError, match="flow_mismatch"):
        u.replace_training_limit(limit, {**flow, "flowId": "individual_carcass_pack"})
    with pytest.raises(ValueError):
        u.replace_training_limit(limit, {k: v for k, v in flow.items() if k != "status"})


# 9. Сверка с эталоном пакета: совпадение и расхождение различимы
def test_reference_check_matches_or_flags_conflict():
    assert u.reference_check(BULK_DEMAND, BULK_CAPACITY)["status"] == "Совпадает с эталоном пакета"
    conflict = u.reference_check(400, 800)
    assert conflict["status"].startswith("Требуется подтверждение")
    assert round(conflict["referencePct"], 5) == 92.86918 and conflict["percent"] == 50
    assert u.reference_check(None, 800)["status"] == "Нет данных"


# 10. Головы, живая масса, тушка, разделка, выход и упаковка учитываются однократно
PLAN = {"headsDay": 700, "liveKgDay": 1400, "wholeKgDay": 500, "cutKgDay": 500, "finishedKgDay": 1000}


def test_flow_split_counts_internal_transition_once():
    split = u.flow_split(PLAN, 500)
    assert split["countedOnce"] is True
    assert split["productOutputKg"]["value"] == 1000 and split["packedKg"]["value"] == 500
    assert split["cuttingInputKg"]["value"] is None
    assert split["cuttingInputKg"]["status"].startswith("Требуется подтверждение")
    assert split["wholeYieldFromLivePct"] == pytest.approx(500 / 1400 * 100)


def test_flow_split_detects_double_counted_packing():
    assert u.flow_split(PLAN, 600)["countedOnce"] is False


# 11. Семнадцать показателей ресурса: кг в час / сутки / смену, головы в час, часы, линии, потери, упаковка
ROW = {"id": "receiving", "capacity": 800.0, "shifts": 2, "hours": 10, "massBasis": "Живой вес в эквиваленте общего потока"}


def test_resource_metrics_for_live_stage():
    metrics = u.resource_metrics(ROW, PLAN, 0.8)
    assert metrics["kgPerDay"] == 800 and metrics["kgPerShift"] == 400 and metrics["kgPerHour"] == 40
    assert metrics["headsPerHour"] == pytest.approx(40 / 2)  # 1400 / 700 = 2 кг живой массы на голову
    assert metrics["headsPerHourStatus"].startswith("Расчетно по плану")
    assert metrics["netHoursDay"] == 20 and metrics["grossHoursDay"] == pytest.approx(25)
    assert metrics["parallelLines"] is None and metrics["parallelLinesStatus"].startswith("Нет данных")
    assert metrics["lossPct"] is None and metrics["lossStatus"].startswith("Требуется подтверждение")
    assert metrics["packKind"] is None


def test_resource_metrics_for_cutting_and_packing_edges():
    cutting = u.resource_metrics({**ROW, "id": "cutting", "massBasis": "Готовые позиции"}, PLAN, 0.8, line_count=2)
    assert cutting["parallelLines"] == 2 and cutting["headsPerHour"] is None
    assert cutting["parallelLinesStatus"] == "Сохраненный расчет файла"
    packing = u.resource_metrics({**ROW, "id": "bulk_carcass_pack", "massBasis": "Готовая тушка"}, PLAN, None)
    assert packing["packKind"] == "Валовая упаковка тушки" and packing["grossHoursDay"] is None
    idle = u.resource_metrics({**ROW, "hours": 0}, PLAN, 0.8)
    assert idle["kgPerHour"] is None and idle["headsPerHour"] is None


# 12. Интеграция с мощностями: синтетический набор во временной папке
def source_fixture():
    refs = [{"file": "пример.xlsx", "sheet": "Мощности", "cells": "A1:F4"}]
    common = {"unit": "кг / сутки", "sourceRefs": refs, "shifts": 2, "hours": 10, "formula": "Мощность = люди × часы × производительность"}
    rows = []
    for stage_id, mass in STAGE_MASS_BASES.items():
        rows.append({**common, "id": stage_id, "name": stage_id, "massBasis": mass,
                     "demand": 1400 if stage_id in PRIMARY_IDS else 10,
                     "capacity": 2800 if stage_id in PRIMARY_IDS else 20, "staffTotal": 2, "kgPerPersonHour": 1})
    values = {
        "feet_pack": {"name": "Упаковка ног", "demand": 100, "capacity": 60, "staffTotal": 3, "kgPerPersonHour": 2},
        "liver": {"name": "Участок ливера", "demand": 50, "capacity": 40, "staffTotal": 2, "kgPerPersonHour": 2},
        "cutting": {"name": "Разделка", "demand": 500, "capacity": 500, "staffTotal": 5, "hours": 10, "shifts": 1},
        "bulk_carcass_pack": {"name": "Валовая упаковка", "demand": 400, "capacity": 800, "staffTotal": 40, "kgPerPersonHour": 2},
        "individual_carcass_pack": {"name": "Индивидуальная упаковка", "demand": 100, "capacity": 200, "staffTotal": 10, "kgPerPersonHour": 2},
    }
    for row in rows:
        row.update(values.get(row["id"], {}))
    return {
        "schemaVersion": 1,
        "source": {"file": "пример.xlsx", "status": "Сохранённый расчёт файла", "sha256": "0" * 64,
                   "capturedAt": "2026-01-01", "liveData": False},
        "period": {"volumeLabel": "Учебный период", "yieldStructureLabel": "Учебная структура", "displayUnit": "т / сутки"},
        "plan": dict(PLAN),
        "calendars": {"availability": {"value": .8}},
        "rows": rows,
        "cuttingLines": [{"staffTotal": 5, "shifts": 1, "kgPerPersonHour": 12, "equipmentKgPerHour": 50, "netHours": 10}],
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", str(tmp_path))
    (tmp_path / "real_data_capacity.json").write_text(json.dumps(source_fixture(), ensure_ascii=False), encoding="utf-8")
    app = FastAPI()
    app.include_router(capacity_router)
    return TestClient(app)


def test_capacity_rows_expose_passport_and_seventeen_metrics(client):
    response = client.get("/api/files/capacity")
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["rows"]) == 17
    keys = {"kgPerDay", "kgPerShift", "kgPerHour", "headsPerHour", "netHoursDay", "grossHoursDay", "parallelLines",
            "lossPct", "packKind", "sourceCells", "conversionRule", "card", "loadPct", "operationsStatus"}
    for row in data["rows"]:
        assert keys <= set(row)
        assert row["card"]["numerator"] == row["demand"] and row["card"]["denominator"] == row["capacity"]
        assert row["card"]["sourceCells"] == [{"sheet": "Мощности", "cells": "A1:F4"}]
    cutting = next(row for row in data["rows"] if row["id"] == "cutting")
    assert cutting["parallelLines"] == 1 and cutting["kgPerHour"] == pytest.approx(50)
    bulk = next(row for row in data["rows"] if row["id"] == "bulk_carcass_pack")
    assert bulk["loadPct"] == pytest.approx(50) and bulk["packKind"] == "Валовая упаковка тушки"


def test_capacity_response_keeps_private_fields_out(client):
    text = client.get("/api/files/capacity").text
    assert "/private" not in text and "sourceRefs" not in text and "sha256" not in text and '"file"' not in text


def test_capacity_flow_split_reference_and_unit_passports(client):
    data = client.get("/api/files/capacity").json()
    assert data["flowSplit"]["countedOnce"] is True
    assert data["flowSplit"]["packedKg"]["value"] == 500
    assert data["referenceCheck"]["status"].startswith("Требуется подтверждение")
    passports = data["unitPassports"]
    assert passports["historicalWeek"]["valueTRounded"] == 4010
    assert passports["carcass"]["wholeKgHead"]["derivedCheck"] is True
    assert passports["trainingDiagnosis"]["percent"] == pytest.approx(4009.0)
    assert passports["flockExample"]["massT"] == pytest.approx(60.0)


def test_evaluation_scenario_keeps_metrics_after_cutting_lever(client):
    data = client.post("/api/files/capacity/evaluate", json={"cuttingNetHoursDelta": 2}).json()
    cutting = next(row for row in data["rows"] if row["id"] == "cutting")
    assert cutting["netHoursDay"] == pytest.approx(12)
    assert cutting["kgPerHour"] == pytest.approx(cutting["capacity"] / 12)
