"""Граница плана (Д06): обязательства, сеточный перебор, ресурсы, смесь маршрутов и паритет с model.js.

Входы синтетические. Числа приёмки 1–3 взяты из План_следующей_итерации.md, раздел Д06, дословно.
Статус решателя: без доказанного оптимума выводится «лучший проверенный вариант», слово «оптимум» не выводится.
"""
import copy
import json
import math
import subprocess
from pathlib import Path

import pytest

from backend import model, plan_frontier as pf

ROOT = Path(__file__).resolve().parents[2]
EPS = 1e-7
CONTRACT = {
    "schemaVersion": 1,
    "rawCostRubKg": 127.2,
    "routes": {
        "whole": {"variableCostRubKg": 130.5, "rawInRate": True},
        "fillet": {"yields": {"fillet": .32, "legs": .35, "wing": .11, "frame": .20}, "variableCostRubKg": 20.3},
    },
}
COMMITMENT_KG = 600_000  # Обязательство 600000 кг филе (Д06, приёмка 1)
FILLET_ORDER = {"id": "филе-600", "product": "fillet", "orderClass": "confirmed", "qtyKg": COMMITMENT_KG, "priceRubKg": 300, "orderDate": "2026-10-18"}
WEEK = {"inputKg": 4_000_000, "routeCode": "fillet", "capacityWeekT": 4000, "costMethod": "weight",
        "freezePriceRubKg": {"whole": 140, "fillet": 220, "legs": 145, "wing": 135, "frame": 20},
        "orders": [{"id": "w1", "product": "whole", "orderClass": "confirmed", "qtyKg": 2_400_000, "priceRubKg": 170, "orderDate": "2026-10-18"}, FILLET_ORDER],
        "commitmentKg": {"fillet": COMMITMENT_KG}}


def week(**patch):
    return copy.deepcopy({**WEEK, **patch})


def rweek(**patch):
    """Неделя после resolve_week с контрактом: прямые вызовы регистра и границы требуют сырья и маршрутов контракта."""
    return pf.resolve_week(week(**patch), CONTRACT)["week"]


def run_js(calls):
    script = """
    const fs=require('fs'), vm=require('vm');
    const context={module:{exports:{}}};vm.createContext(context);
    vm.runInContext(fs.readFileSync('model.js','utf8'),context);
    const m=context.module.exports;
    const cases=JSON.parse(fs.readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(cases.map(c=>m[c.fn](...c.args))));
    """
    run = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps(calls), capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


def same(actual, expected, path="result"):
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected, (path, actual, expected)
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), path
        assert math.isclose(actual, expected, rel_tol=1e-10, abs_tol=EPS), (path, actual, expected)
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), path
        for index, (a, e) in enumerate(zip(actual, expected)):
            same(a, e, f"{path}[{index}]")
    else:
        keys = set(expected) - {"timeMs"}
        assert set(actual) - {"timeMs"} == keys, (path, set(actual) ^ keys)
        for key in keys:
            same(actual[key], expected[key], f"{path}.{key}")


# Д06, приёмка 1: выпуск и отгрузка обязательства; вариант 0 т разделки исключён; конфликт имеет количественное объяснение.
def test_zero_cut_is_excluded_by_commitment():
    boundary = pf.commitment_boundary(rweek(), 0)
    assert boundary["feasible"] is False
    assert [v["kind"] for v in boundary["violations"]] == ["supply"]
    assert boundary["violations"][0]["availableKg"] == 0
    assert boundary["violations"][0]["requiredKg"] == COMMITMENT_KG


def test_commitment_needs_minimal_cut_and_is_met_at_that_cut():
    boundary = pf.commitment_boundary(rweek(), 1875)
    assert boundary["minCutT"] == pytest.approx(1875)
    assert boundary["feasible"] is True
    below = pf.commitment_boundary(rweek(), 1874)
    assert below["feasible"] is False
    assert below["violations"][0]["shortfallKg"] == pytest.approx(320)


def test_commitment_conflict_has_quantitative_explanation():
    # Мощность недели 1493,8 т даёт 478 016 кг филе: разрыв 121 984 кг; для обязательства нужно 1875 т разделки.
    short = rweek(capacityWeekT=1493.8)
    boundary = pf.commitment_boundary(short, 1493.8)
    assert boundary["feasible"] is False
    capacity = [v for v in pf.commitment_boundary(short, 1000)["violations"] if v["kind"] == "capacity"][0]
    assert capacity["requiredCutT"] == pytest.approx(1875)
    assert capacity["shortfallCutT"] == pytest.approx(1875 - 1493.8)
    supply = [v for v in boundary["violations"] if v["kind"] == "supply"][0]
    assert supply["availableKg"] == pytest.approx(478_016)
    assert supply["shortfallKg"] == pytest.approx(121_984)


def test_commitment_without_fillet_order_fails_shipment():
    no_order = rweek(orders=[WEEK["orders"][0]])
    boundary = pf.commitment_boundary(no_order, 1875)
    assert [v["kind"] for v in boundary["violations"]] == ["shipment"]
    assert boundary["violations"][0]["shippedKg"] == 0


def test_frontier_keeps_only_cuts_that_meet_commitment():
    frontier = pf.build_frontier(week(), CONTRACT)
    assert frontier["points"], "при мощности 4000 т есть допустимые объемы"
    assert min(p["V"] for p in frontier["points"]) >= 1875 - 1e-9
    assert all(p["V"] != 0 for p in frontier["points"])
    assert frontier["commitment"]["minCutT"] == pytest.approx(1875)
    assert pf.unit_cost_register(pf.resolve_week(week(), CONTRACT)["week"], "whole") == pytest.approx(130.5)


def test_frontier_reports_risk_when_commitment_exceeds_capacity():
    frontier = pf.build_frontier(week(capacityWeekT=1493.8), CONTRACT)
    assert frontier["points"] == [] and frontier["optimum"] is None
    assert frontier["status"]["level"] == "risk"
    assert "Обязательство не выполняется ни при одном допустимом объеме разделки" in frontier["status"]["reason"]


def test_frontier_solver_status_is_best_verified_not_optimum():
    frontier = pf.build_frontier(week(), CONTRACT)
    solver = frontier["solver"]
    assert solver["status"] == "лучший проверенный вариант"
    assert solver["provenOptimum"] is False and solver["gap"] is None
    assert solver["toleranceT"] == 1 and solver["timeMs"] >= 0
    assert "оптимум" not in solver["status"].lower()


def test_legacy_commitment_blocks_zero_cut_with_quantity():
    # Учебная модель: обязательство 600 т филе как подтвержденный заказ и спрос.
    zero_cut = model.evaluate({"cut": 0, "route": "fillet", "orders": {"fillet": 600}, "demand": {"fillet": 600}})
    assert zero_cut["feasible"] is False
    assert "Филе грудки: разрыв заказа 600 т" in zero_cut["violations"]
    partial = model.evaluate({"cut": 30, "route": "fillet", "orders": {"fillet": 600}, "demand": {"fillet": 600}})
    assert "Филе грудки: разрыв заказа 590,4 т" in partial["violations"]


# Д06, приёмка 2: контроль 30 / 40 / 50 т; 31,25 т дают 2,45 млн руб. и допустимы; сеточный перебор включает 31,25.
def test_control_volumes_match_acceptance_values():
    assert model.evaluate({"cut": 30})["contribution"] == pytest.approx(2_440_000)
    control = model.evaluate({"cut": 31.25})
    assert control["contribution"] == pytest.approx(2_450_000)
    assert control["feasible"] is True


def test_grid_search_includes_control_volume_and_reports_best_verified():
    search = model.search_cut({})
    cuts = [point["cutT"] for point in search["points"]]
    assert 31.25 in cuts and cuts[0] == 30 and cuts[-1] == 50
    assert search["area"]["points"] == 81 and search["feasibleCount"] == 81
    feasible = [p for p in search["points"] if p["feasible"]]
    assert search["best"]["contribution"] == max(p["contribution"] for p in feasible)
    assert search["solver"]["status"] == "лучший проверенный вариант"
    assert search["solver"]["provenOptimum"] is False and search["solver"]["toleranceT"] == .25
    # Требуется подтверждение: пакет называет выбор 30 т, учебные параметры по умолчанию дают 50 т (2,6 млн руб.).
    assert search["best"]["cutT"] == 50


# Д06, приёмка 3 и мост ресурсов: неизвестный ресурс не дает нуля; общий ресурс считается один раз; следующее ограничение.
RESOURCES = [
    {"id": "люди", "name": "Общие люди", "capacityKg": 100, "consumers": [{"product": "whole", "kg": 60}, {"product": "fillet", "kg": 30}]},
    {"id": "линия", "name": "Линия упаковки", "capacityKg": None, "consumers": [{"product": "fillet", "kg": 10}]},
    {"id": "холод", "name": "Холодильная камера", "capacityKg": 80, "consumers": [{"product": "fillet", "kg": 90}]},
]


def test_unknown_resource_gives_proven_bound_not_zero():
    result = pf.resource_limits([RESOURCES[1]])
    assert result["provenFeasible"] is True
    assert result["unknownCount"] == 1 and result["ranking"] == [] and result["binding"] is None


def test_shared_resource_is_counted_once_and_binding_is_ranked():
    result = pf.resource_limits(RESOURCES)
    assert result["provenFeasible"] is False
    assert [v["id"] for v in result["violations"]] == ["холод"]
    people = [r for r in result["ranking"] if r["id"] == "люди"][0]
    assert people["loadKg"] == 90  # 60 тушка + 30 филе: один поток, без двойного счета
    assert result["binding"]["id"] == "холод" and result["next"]["id"] == "люди"


def test_extra_shift_relieves_binding_resource_and_shows_next_constraint():
    # Третья смена при двух текущих сменах: мощность холода растет в (2 + 1) / 2 раза, с 80 до 120 кг.
    relieved = [dict(r) for r in RESOURCES]
    relieved[2] = {**RESOURCES[2], "capacityKg": 80 * 3 / 2}
    result = pf.resource_limits(relieved)
    assert result["provenFeasible"] is True
    assert result["binding"]["id"] == "люди"


# Смесь маршрутов: баланс «выход плюс потери равны входу».
@pytest.mark.parametrize("total_t, mix", [(100, {"fillet": 30, "coarse": 20}), (100, {"deep": 25}), (100, {})])
def test_route_mix_closes_mass_balance(total_t, mix):
    result = model.mix_outputs(total_t, mix)
    assert result["valid"] is True and result["balanced"] is True
    assert abs(result["massBalanceKg"]) <= 1e-6


def test_route_mix_rejects_unknown_route():
    assert model.mix_outputs(100, {"ghost": 10})["valid"] is False


# Паритет Python и JS для новых функций границы.
def test_boundary_functions_match_javascript():
    calls = [
        {"fn": "commitmentBoundary", "args": [rweek(), 0]},
        {"fn": "commitmentBoundary", "args": [rweek(), 1875]},
        {"fn": "resourceLimits", "args": [RESOURCES]},
        {"fn": "searchCut", "args": [{}, None]},
        {"fn": "mixOutputs", "args": [100, {"fillet": 30, "coarse": 20}]},
        {"fn": "buildFrontier", "args": [week(), CONTRACT]},
    ]
    js = run_js(calls)
    py = [
        pf.commitment_boundary(rweek(), 0), pf.commitment_boundary(rweek(), 1875),
        pf.resource_limits(RESOURCES), model.search_cut({}, None),
        model.mix_outputs(100, {"fillet": 30, "coarse": 20}), pf.build_frontier(week(), CONTRACT),
    ]
    for index, expected in enumerate(js):
        same(py[index], expected, calls[index]["fn"])
