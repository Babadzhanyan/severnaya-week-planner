"""Загрузчик недели: синтетические файлы создаются во временной папке. Реальный контракт v4 читается только в одном тесте, он пропускается, если файла нет."""
import json

import pytest
from fastapi.testclient import TestClient

from backend import anon_export, model
from backend.anon_export import ENV_NAME, FILE_NAME, WEEK_OUT_KEYS, WORK_DAYS_PER_WEEK, WeekError, load_week
from backend.app import app

http = TestClient(app)
PRODUCTS = ("whole", "fillet", "legs", "wing", "frame", "breast", "legMeat", "legBone", "legSkin")
ROUTES = ("whole", "coarse", "fillet", "deep")
STAGES = ("deboning", "packing", "packingLegs", "liver", "evisceration", "freezing")
REAL_DIR = anon_export.DEFAULT_DIR
SERVICE_FIELDS = {
    "contractVersion": "v4",
    "previousVersionFile": "week_config_v3.json",
    "workingDaysPerWeek": 7,
    "workingDaysPerWeekStatus": "требуется подтверждение",
    "revenueBaseRub": 1000,
    "freezeCostRubKgStatus": "требуется подтверждение",
    "conflicts": ["синтетический конфликт"],
}


def synthetic_config():
    return {
        "schemaVersion": 1,
        "source": "aggregates",
        "period": {"label": "синтетический период", "basis": "синтетическая база"},
        "scaleWeekKg": 1000000,
        "rawCostRubKg": 120.5,
        "products": {code: {"listPriceRubKg": 100.0, "freezePriceRubKg": None, "priceSource": "Синтетический источник"} for code in PRODUCTS},
        "routes": {
            "whole": {"yields": {}, "variableCostRubKg": 8.0, "sourceNote": "Синтетическая схема"},
            "coarse": {"yields": {"breast": 0.4, "legs": 0.35}, "variableCostRubKg": None, "sourceNote": "Синтетическая схема"},
            "fillet": {"yields": {"fillet": 0.32}, "variableCostRubKg": 20.3, "sourceNote": "Синтетическая схема"},
            "deep": {"yields": {"fillet": 0.32, "legMeat": 0.24}, "variableCostRubKg": 28.0, "sourceNote": "Синтетическая схема"},
        },
        "freezeCostRubKg": None,
        "capacityTDay": {"deboning": 40, "packing": None, "packingLegs": 5, "liver": 3, "evisceration": 2, "freezing": 6},
        "capacityWeekT": {"deboning": 280, "packing": None, "packingLegs": 35, "liver": 21, "evisceration": 14, "freezing": 42},
        "sources": [{"field": "Синтетическое поле", "file": "synthetic.xlsx", "sheet": "Лист1", "period": "синтетический", "status": "расчет по файлу; требуется подтверждение"}],
    }


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(ENV_NAME, str(tmp_path))
    return tmp_path


def write_config(directory, data):
    (directory / FILE_NAME).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def mutate_extra_top(cfg):
    cfg["clientName"] = "Синтетическое имя"


def mutate_extra_product(cfg):
    cfg["products"]["whole"]["phone"] = "синтетический телефон"


def mutate_extra_source(cfg):
    cfg["sources"][0]["contact"] = "синтетический контакт"


def mutate_missing_product(cfg):
    del cfg["products"]["legBone"]


def mutate_unknown_route(cfg):
    cfg["routes"]["extra"] = cfg["routes"]["whole"]


def mutate_unknown_yield_product(cfg):
    cfg["routes"]["fillet"]["yields"]["giblets"] = 0.1


def mutate_percent_yield(cfg):
    cfg["routes"]["coarse"]["yields"]["breast"] = 40


def mutate_missing_stage(cfg):
    del cfg["capacityTDay"]["freezing"]


def mutate_status_not_text(cfg):
    cfg["sources"][0]["status"] = None


def mutate_missing_sources(cfg):
    del cfg["sources"]


def mutate_bool_scale(cfg):
    cfg["scaleWeekKg"] = True


def mutate_text_scale(cfg):
    cfg["scaleWeekKg"] = "1000000"


def mutate_null_scale(cfg):
    cfg["scaleWeekKg"] = None


def mutate_schema_version(cfg):
    cfg["schemaVersion"] = 2


def mutate_bool_schema_version(cfg):
    cfg["schemaVersion"] = True


def mutate_source_kind(cfg):
    cfg["source"] = "clients"


def mutate_unknown_capacity_day(cfg):
    cfg["capacityTDay"]["giblets"] = 1.5


def mutate_unknown_capacity_week(cfg):
    cfg["capacityWeekT"]["giblets"] = 10.5


def mutate_missing_capacity_week(cfg):
    del cfg["capacityWeekT"]


def synthetic_order(**changes):
    order = {"productId": "fillet", "period": "синтетический период", "status": "confirmed", "qtyKg": 1000,
             "priceRubKg": 100.0, "channel": "синтетический канал", "source": "синтетический источник"}
    order.update(changes)
    return order


def synthetic_cost_facts():
    return {
        "fillet": {"costRubKgOutput": 141.4867668, "period": "синтетический период", "source": "синтетический источник"},
        "legMeat": {"costRubKgOutput": None, "period": "синтетический период", "source": "синтетический источник; требуется подтверждение"},
    }


def mutate_orders_not_list(cfg):
    cfg["orders"] = {}


def mutate_extra_order_field(cfg):
    cfg["orders"] = [synthetic_order(phone="синтетический телефон")]


def mutate_unknown_order_product(cfg):
    cfg["orders"] = [synthetic_order(productId="giblets")]


def mutate_unknown_order_status(cfg):
    cfg["orders"] = [synthetic_order(status="unknown")]


def mutate_negative_order_qty(cfg):
    cfg["orders"] = [synthetic_order(qtyKg=-1)]


def mutate_cost_fact_missing_product(cfg):
    cfg["costFacts"] = {"fillet": synthetic_cost_facts()["fillet"]}


def mutate_cost_fact_extra_field(cfg):
    cfg["costFacts"] = synthetic_cost_facts()
    cfg["costFacts"]["fillet"]["phone"] = "синтетический телефон"


def mutate_negative_cost_fact(cfg):
    cfg["costFacts"] = synthetic_cost_facts()
    cfg["costFacts"]["legMeat"]["costRubKgOutput"] = -141.9


INVALID_CASES = [mutate_extra_top, mutate_extra_product, mutate_extra_source, mutate_missing_product,
                 mutate_unknown_route, mutate_unknown_yield_product, mutate_percent_yield, mutate_missing_stage,
                 mutate_status_not_text, mutate_missing_sources, mutate_bool_scale, mutate_text_scale,
                 mutate_null_scale, mutate_schema_version, mutate_bool_schema_version, mutate_source_kind,
                 mutate_unknown_capacity_day, mutate_unknown_capacity_week, mutate_missing_capacity_week,
                 mutate_orders_not_list, mutate_extra_order_field, mutate_unknown_order_product,
                 mutate_unknown_order_status, mutate_negative_order_qty, mutate_cost_fact_missing_product,
                 mutate_cost_fact_extra_field, mutate_negative_cost_fact]


def test_product_and_route_codes_match_catalog_contract():
    assert anon_export.PRODUCT_CODES == PRODUCTS
    assert anon_export.ROUTE_CODES == ROUTES
    assert anon_export.STAGE_CODES == STAGES
    assert set(model.CATALOG["defaults"]["stageCapacity"]) <= set(anon_export.STAGE_CODES)


def test_valid_config_returns_week_without_sources_and_sources_as_is(config_dir):
    cfg = synthetic_config()
    write_config(config_dir, cfg)
    result = load_week()
    assert set(result) == {"week", "sources"}
    assert set(result["week"]) == WEEK_OUT_KEYS
    expected = {key: value for key, value in cfg.items() if key != "sources"}
    expected["capacityWeekT"] = {"deboning": 40 * WORK_DAYS_PER_WEEK}
    assert result["week"] == expected
    assert result["sources"] == cfg["sources"]


def test_missing_file_gives_404_with_text(config_dir):
    with pytest.raises(WeekError) as caught:
        load_week()
    assert caught.value.status == 404
    assert caught.value.kind == "week_missing"
    assert "не найден" in caught.value.message


def test_missing_file_route_returns_404_without_fallback(config_dir):
    response = http.get("/api/week")
    assert response.status_code == 404
    detail = response.json()["detail"][0]
    assert detail["type"] == "week_missing"
    assert "не найден" in detail["msg"]


def test_route_returns_week_and_sources_for_valid_config(config_dir):
    cfg = synthetic_config()
    write_config(config_dir, cfg)
    response = http.get("/api/week")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"week", "sources"}
    assert set(body["week"]) == WEEK_OUT_KEYS
    assert body["sources"] == cfg["sources"]


def test_default_path_is_used_when_env_is_unset(monkeypatch):
    monkeypatch.delenv(ENV_NAME, raising=False)
    assert anon_export.config_path() == anon_export.DEFAULT_DIR / FILE_NAME


def test_invalid_json_gives_503(config_dir):
    (config_dir / FILE_NAME).write_text("{", encoding="utf-8")
    with pytest.raises(WeekError) as caught:
        load_week()
    assert caught.value.status == 503


def test_nan_constant_is_rejected(config_dir):
    text = json.dumps(synthetic_config()).replace('"scaleWeekKg": 1000000', '"scaleWeekKg": NaN')
    (config_dir / FILE_NAME).write_text(text, encoding="utf-8")
    with pytest.raises(WeekError) as caught:
        load_week()
    assert caught.value.status == 503


@pytest.mark.parametrize("mutate", INVALID_CASES, ids=lambda fn: fn.__name__)
def test_contract_violations_are_rejected_without_leaking_values(config_dir, mutate):
    cfg = synthetic_config()
    mutate(cfg)
    write_config(config_dir, cfg)
    with pytest.raises(WeekError) as caught:
        load_week()
    assert caught.value.status == 503
    assert caught.value.kind == "week_invalid"
    assert "Синтетическое имя" not in caught.value.message
    assert "синтетический телефон" not in caught.value.message


def test_weekly_deboning_capacity_is_daily_times_work_days(config_dir):
    cfg = synthetic_config()
    cfg["capacityTDay"]["deboning"] = 213.4
    write_config(config_dir, cfg)
    assert load_week()["week"]["capacityWeekT"] == {"deboning": pytest.approx(213.4 * WORK_DAYS_PER_WEEK)}


def test_empty_daily_deboning_gives_null_weekly_capacity(config_dir):
    cfg = synthetic_config()
    cfg["capacityTDay"]["deboning"] = None
    write_config(config_dir, cfg)
    assert load_week()["week"]["capacityWeekT"] == {"deboning": None}


def test_route_passes_weekly_capacity_inside_week_object(config_dir):
    write_config(config_dir, synthetic_config())
    body = http.get("/api/week").json()
    assert body["week"]["capacityWeekT"] == {"deboning": 40 * WORK_DAYS_PER_WEEK}


def test_service_fields_are_accepted_and_dropped(config_dir):
    assert set(SERVICE_FIELDS) == anon_export.SERVICE_KEYS
    cfg = synthetic_config()
    cfg.update(SERVICE_FIELDS)
    write_config(config_dir, cfg)
    result = load_week()
    assert set(result["week"]) == WEEK_OUT_KEYS
    assert result["sources"] == cfg["sources"]


def test_orders_and_cost_facts_blocks_are_accepted(config_dir):
    cfg = synthetic_config()
    cfg["orders"] = [synthetic_order(status=status) for status in ("confirmed", "forecast", "history")]
    cfg["orders"].append(synthetic_order(productId="legMeat", priceRubKg=None))
    cfg["costFacts"] = synthetic_cost_facts()
    write_config(config_dir, cfg)
    result = load_week()
    assert set(result["week"]) == WEEK_OUT_KEYS
    assert result["sources"] == cfg["sources"]


def test_empty_orders_list_is_accepted(config_dir):
    cfg = synthetic_config()
    cfg["orders"] = []
    write_config(config_dir, cfg)
    assert set(load_week()["week"]) == WEEK_OUT_KEYS


@pytest.mark.skipif(not (REAL_DIR / FILE_NAME).is_file(), reason="файл контракта v4 отсутствует в каталоге агрегатов")
def test_real_contract_v4_passes_loader_and_route(monkeypatch):
    monkeypatch.setenv(ENV_NAME, str(REAL_DIR))
    assert set(load_week()["week"]) == WEEK_OUT_KEYS
    response = http.get("/api/week")
    assert response.status_code == 200
    assert set(response.json()["week"]) == WEEK_OUT_KEYS
