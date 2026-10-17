"""Паритет backend/plan_frontier.py с golden-файлом, построенным из model.js на синтетических входах.

Сверяются V*, K(V*), K по вариантам 30 / 40 / 50 % и тушке, статусы, эффективные точки,
стакан филе в оптимуме, таблица planStatus и предохранитель scaleGuard.
Допуск по рублям и килограммам: 1e-3. V* и статусы совпадают точно.
"""
import copy
import json
import math
from pathlib import Path

import pytest

from backend import plan_frontier as pf

GOLDEN = Path(__file__).resolve().parent / "fixtures_synthetic" / "parity_golden.json"
GOLDEN_DATA = json.loads(GOLDEN.read_text(encoding="utf-8"))
RUB_TOL = GOLDEN_DATA["meta"]["tolerance"]["rub"]
V_TOL = GOLDEN_DATA["meta"]["tolerance"]["V"]
CASES = GOLDEN_DATA["cases"]


def assert_close(actual, expected, where, tol=RUB_TOL):
    assert actual is not None, (where, "нет значения")
    assert math.isclose(actual, expected, rel_tol=0, abs_tol=tol), (where, actual, expected)


def assert_status(actual, expected, where):
    for key in ("level", "symbol", "word"):
        assert actual[key] == expected[key], (where, key, actual[key], expected[key])


def test_plan_config_default_is_weight():
    assert pf.plan_config["costMethod"] == "weight"


@pytest.mark.parametrize("key", list(GOLDEN_DATA["planConfig"]))
def test_plan_config_matches_golden(key):
    assert pf.plan_config[key] == GOLDEN_DATA["planConfig"][key], key


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_frontier_matches_golden(case):
    exp = case["expected"]
    f = pf.build_frontier(case["input"])
    assert f["guard"]["blocked"] == exp["guardBlocked"], case["id"]
    assert_status(f["status"], exp["status"], "status")
    assert f["status"].get("reason") == exp["status"]["reason"], "reason"
    assert len(f["points"]) == exp["pointsCount"], "pointsCount"
    assert len(f["efficient"]) == len(exp["efficientV"]), "efficient count"
    for got, want in zip(f["efficient"], exp["efficientV"]):
        assert_close(got["V"], want, "efficient V", V_TOL)

    if exp["optimum"] is None:
        assert f["optimum"] is None, "V* должен отсутствовать"
    else:
        want = exp["optimum"]
        assert_close(f["optimum"]["V"], want["V"], "V*", V_TOL)
        assert_close(f["optimum"]["K"], want["K"], "K(V*), руб.")
        assert_close(f["optimum"]["R"], want["R"], "R(V*), кг")
        assert f["optimum"]["flag"] == want["flag"], "flag"

    assert set(f["variants"]) == set(exp["variants"]), "варианты"
    for name, want in exp["variants"].items():
        assert_close(f["variants"][name]["V"], want["V"], "V " + name, V_TOL)
        assert_close(f["variants"][name]["K"], want["K"], "K " + name + ", руб.")

    invariant = f["invariant"]["holds"] if f["invariant"] else None
    assert invariant == exp["invariantHolds"], "инвариант K(V*)"
    assert f["notes"] == exp["notes"], "notes"
    assert f["unconfirmed"] == exp["unconfirmed"], "unconfirmed"
    assert (f["gap"]["toT"] if f["gap"] else None) == exp["gapToT"], "разрыв"
    assert (f["cap"]["label"] if f["cap"] else None) == exp["capLabel"], "предел"

    if "stakanFilletAtOptimum" in exp:
        want = exp["stakanFilletAtOptimum"]
        s = pf.build_stakan(case["input"], exp["optimum"]["V"], "fillet")
        assert_close(s["supplyKg"], want["supplyKg"], "стакан: выпуск, кг")
        assert_close(s["revenueRub"], want["revenueRub"], "стакан: выручка, руб.")
        assert_close(s["stepsRevenueRub"], want["stepsRevenueRub"], "стакан: сумма ступеней, руб.")
        assert_close(s["K"], want["K"], "стакан: K, руб.")


@pytest.mark.parametrize("row", GOLDEN_DATA["planStatus"], ids=lambda r: f"{r['key']}-{r['value']}")
def test_plan_status_matches_golden(row):
    assert_status(pf.plan_status(row["key"], row["value"]), row["expected"], row["key"])


@pytest.mark.parametrize("row", GOLDEN_DATA["scaleGuard"], ids=lambda r: str(r["inputKg"]))
def test_scale_guard_matches_golden(row):
    assert pf.scale_guard({"inputKg": row["inputKg"]})["blocked"] == row["expectedBlocked"]


# Контракт недели (aggregates_local/week_config.json, версия 1). Значения совпадают с учебными: результат должен совпасть.
CONTRACT = {
    "schemaVersion": 1,
    "source": "aggregates",
    "rawCostRubKg": 140,
    "products": {"fillet": {"listPriceRubKg": 300}},
    "routes": {
        "whole": {"yields": {}, "variableCostRubKg": 8},
        "fillet": {"yields": {"fillet": .32, "legs": .35, "wing": .11, "frame": .20}, "variableCostRubKg": 20.3},
    },
}


def golden_week(case_id="weight_base"):
    return copy.deepcopy(next(c["input"] for c in CASES if c["id"] == case_id))


def test_scale_week_is_user_decision():
    assert pf.plan_config["scaleWeekKg"] == 4009615


def test_training_source_without_contract():
    week = golden_week()
    assert pf.build_frontier(week)["source"] == "training"
    assert pf.build_stakan(week, 40, "fillet")["source"] == "training"


def test_contract_with_training_values_keeps_result():
    week = golden_week()
    training = pf.build_frontier(week)
    with_contract = pf.build_frontier(week, CONTRACT)
    assert with_contract["source"] == "aggregates"
    assert_close(with_contract["optimum"]["V"], training["optimum"]["V"], "V*", V_TOL)
    assert_close(with_contract["optimum"]["K"], training["optimum"]["K"], "K(V*), руб.")


@pytest.mark.parametrize("patch, reason", [
    ({"rawCostRubKg": None}, "Нет данных: цена сырья"),
    ({"routes": {**CONTRACT["routes"], "fillet": {**CONTRACT["routes"]["fillet"], "variableCostRubKg": None}}},
     "Нет данных: переменные затраты маршрута «Филе и ножки»"),
    ({"routes": {**CONTRACT["routes"], "fillet": {**CONTRACT["routes"]["fillet"], "yields": {"fillet": 32, "legs": .35, "wing": .11, "frame": .20}}}},
     "Нет данных: выход «Филе грудки» по маршруту «Филе и ножки»"),
    ({"schemaVersion": 2}, "Требуется подтверждение: поддерживается только версия контракта недели 1"),
])
def test_empty_contract_value_gives_no_data(patch, reason):
    result = pf.build_frontier(golden_week(), {**CONTRACT, **patch})
    assert result["status"]["symbol"] == "○"
    assert result["status"]["reason"] == reason
    assert result["points"] == [] and result["optimum"] is None


# Блок capacityWeekT контракта: deboning задает предел разделки недели; пустое значение дает статус «Нет данных».
NO_CAPACITY = "Нет данных: мощность разделки не задана"
WEEK_CONFIG = Path(__file__).resolve().parents[3] / "aggregates_local" / "week_config.json"


def test_capacity_block_sets_week_limit():
    result = pf.build_frontier(golden_week(), {**CONTRACT, "capacityWeekT": {"deboning": 300}})
    assert result["source"] == "aggregates"
    assert result["cap"] == {"V": 300, "label": "Предел мощности"}
    assert result["points"] and all(p["V"] <= 300 + 1e-9 for p in result["points"])


def test_contract_without_capacity_block_keeps_week_capacity():
    week = golden_week()
    week["capacityWeekT"] = 300
    assert pf.build_frontier(week, CONTRACT)["cap"]["V"] == 300


def test_empty_capacity_block_gives_no_data():
    config = {**CONTRACT, "capacityWeekT": {"deboning": None}}
    result = pf.build_frontier(golden_week(), config)
    assert result["status"]["symbol"] == "○"
    assert result["status"]["reason"] == NO_CAPACITY
    assert result["points"] == [] and result["optimum"] is None
    assert pf.build_stakan(golden_week(), 40, "fillet", config)["status"]["reason"] == NO_CAPACITY


def test_missing_week_capacity_gives_no_data_text():
    week = golden_week()
    del week["capacityWeekT"]
    assert pf.build_frontier(week)["status"]["reason"] == NO_CAPACITY


@pytest.mark.skipif(not WEEK_CONFIG.exists(), reason="aggregates_local лежит вне репозитория platform, в CI файла нет")
def test_week_config_capacity_gives_js_limit():
    # Читается только блок capacityWeekT. JS задает предел как min(capacityWeekT.deboning, объем входа в т).
    deboning = json.loads(WEEK_CONFIG.read_text(encoding="utf-8"))["capacityWeekT"]["deboning"]
    week = golden_week()
    result = pf.build_frontier(week, {**CONTRACT, "capacityWeekT": {"deboning": deboning}})
    assert_close(result["cap"]["V"], min(deboning, week["inputKg"] / 1000), "предел разделки, т", V_TOL)


def test_list_price_fills_order_without_price():
    week = golden_week()
    week["orders"].append({"id": "пустая-цена", "product": "fillet", "orderClass": "extra", "qtyKg": 10000,
                           "priceRubKg": None, "orderDate": "2026-10-18"})
    assert pf.resolve_week(week, CONTRACT)["week"]["orders"][-1]["priceRubKg"] == 300
    assert pf.build_stakan(week, 40, "fillet")["status"]["symbol"] == "○"
    assert pf.build_stakan(week, 40, "fillet", CONTRACT)["source"] == "aggregates"
