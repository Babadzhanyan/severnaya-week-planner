"""Денежный регистр (Д05): сырьё учитывается однократно, мосты сходятся с серверным итогом, паритет с model.js.

Входы синтетические. Числа приёмки 1–4 взяты из План_следующей_итерации.md, раздел Д05, дословно.
Контроль повтора: при признаке rawInRate целой тушки контрольный unit_cost не равен 257,7 руб. / кг.
"""
import json
import math
import subprocess
from pathlib import Path

import pytest

from backend import model, plan_frontier as pf

ROOT = Path(__file__).resolve().parents[2]
EPS = 1e-7

# Контракт недели: ставка целой тушки 130,5 уже содержит сырьё 114,9; сырьё недели 127,2 руб. / кг.
CONTRACT = {
    "schemaVersion": 1,
    "rawCostRubKg": 127.2,
    "routes": {
        "whole": {"variableCostRubKg": 130.5, "rawInRate": True},
        "fillet": {"yields": {"fillet": .32, "legs": .35, "wing": .11, "frame": .20}, "variableCostRubKg": 20.3},
    },
}
BASE_WEEK = {"inputKg": 4_000_000, "routeCode": "fillet", "capacityWeekT": 4000, "costMethod": "weight",
             "freezePriceRubKg": {"whole": 140, "fillet": 220, "legs": 145, "wing": 135, "frame": 20},
             "orders": [{"id": "w1", "product": "whole", "orderClass": "confirmed", "qtyKg": 2_400_000, "priceRubKg": 170, "orderDate": "2026-10-18"}]}


def resolved(whole=None, **patch):
    """Неделя с контрактом. whole подменяет маршрут целой тушки; по умолчанию ставка 130,5 с признаком rawInRate true."""
    week = {**BASE_WEEK, **patch}
    contract = CONTRACT if whole is None else {**CONTRACT, "routes": {**CONTRACT["routes"], "whole": whole}}
    return pf.resolve_week(week, contract)["week"]


def run_js(calls):
    """Исполняет функции model.js (тот же способ, что test_parity.py) и возвращает JSON-результаты."""
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
    """Сверка Python с JS: числа с допуском 1e-7, структура и строки точно. Время решателя не сверяется."""
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


# Д05, приёмка 1: филе 117,3393655101 + 20,0100687032 + 4,1373325945 = 141,4867668079; бедро 141,9475847510.
# Упаковка бедра 4,5981505377 получена как итог 141,9475847510 минус сырьё и цех; спецификация округляет её до 4,59815054.
FILLET_STACK = [{"id": "raw", "label": "Сырьё", "valueRubKg": 117.3393655101},
                {"id": "cex", "label": "Цех", "valueRubKg": 20.0100687032},
                {"id": "pack", "label": "Упаковка", "valueRubKg": 4.1373325945}]
BEDRO_STACK = [FILLET_STACK[0], FILLET_STACK[1], {"id": "pack", "label": "Упаковка", "valueRubKg": 4.5981505377}]


def test_historical_stack_matches_acceptance_totals():
    fillet = model.cost_stack(FILLET_STACK)
    bedro = model.cost_stack(BEDRO_STACK)
    # Филе: сумма компонентов из пакета дает ...078, итог пакета ...079; разница 1e-10 из округления. Допуск 1e-9, относительный допуск отключен.
    assert math.isclose(fillet["totalRubKg"], 141.4867668079, rel_tol=0, abs_tol=1e-9)
    assert math.isclose(bedro["totalRubKg"], 141.9475847510, rel_tol=0, abs_tol=1e-9)
    assert fillet["steps"][-1] == {"id": "total", "label": "Итог, руб. / кг выпуска", "valueRubKg": fillet["totalRubKg"],
                                   "fromRubKg": 0, "toRubKg": fillet["totalRubKg"], "kind": "total"}
    assert fillet["steps"][1]["fromRubKg"] == pytest.approx(117.3393655101) and fillet["steps"][1]["toRubKg"] == pytest.approx(137.3494342133)


def test_spec_rounded_packaging_is_flagged_by_its_rounding_gap():
    # Упаковка 4,59815054 из спецификации дает 141,9475847533: отклонение 2,3e-9 при допуске 1e-9. Вопрос к финансам и технологу.
    rounded = model.cost_stack(BEDRO_STACK[:2] + [{"id": "pack", "label": "Упаковка", "valueRubKg": 4.59815054}])
    assert math.isclose(rounded["totalRubKg"], 141.9475847533, rel_tol=0, abs_tol=1e-9)
    assert not math.isclose(rounded["totalRubKg"], 141.9475847510, rel_tol=0, abs_tol=1e-9)


# Д05, приёмка 2: сырьё однократно. Ставка 130,5 = 114,9 + 10,8 + 4,8; условный пример 127,2 + 10,8 + 4,8 = 142,8.
def test_rate_components_reproduce_whole_rate_once():
    assert math.isclose(114.9 + 10.8 + 4.8, 130.5, rel_tol=0, abs_tol=EPS)
    assert math.isclose(127.2 + 10.8 + 4.8, 142.8, rel_tol=0, abs_tol=EPS)


def test_rate_with_raw_inside_is_used_as_is():
    # Признак rawInRate true: ставка 130,5 уже содержит сырье 114,9, сырье не добавляется.
    cost = pf.unit_cost_register(resolved(), "whole")
    assert math.isclose(cost, 130.5, rel_tol=0, abs_tol=EPS)
    assert not math.isclose(cost, 257.7, rel_tol=0, abs_tol=1e-6)


def test_rate_without_raw_adds_raw_once_gives_conditional_example():
    # Признак rawInRate false: ставка 10,8 + 4,8 = 15,6 руб. / кг без сырья, сырье недели 127,2 добавляется однократно: 142,8.
    cost = pf.unit_cost_register(resolved({"variableCostRubKg": 15.6, "rawInRate": False}), "whole")
    assert math.isclose(cost, 142.8, rel_tol=0, abs_tol=1e-9)


def test_missing_flag_defaults_to_raw_added_once():
    # Без признака rawInRate действует false: учебная ставка 8 руб. / кг, сырье 127,2 из контракта добавляется однократно.
    cost = pf.unit_cost_register(resolved({"variableCostRubKg": 8}), "whole")
    assert math.isclose(cost, 127.2 + 8, rel_tol=0, abs_tol=1e-9)


def test_fillet_unit_cost_uses_one_raw_material_once():
    # (сырье 127,2 + операции 20,3) / сумма выходов 0,98: сырье входит один раз.
    assert math.isclose(pf.unit_cost_register(resolved(), "fillet"), (127.2 + 20.3) / 0.98, rel_tol=1e-12)


# Д05, приёмка 3: мост запаса по партиям, количественный и стоимостный.
MOVEMENTS = [
    {"lot": "A", "kind": "opening", "kg": 1000, "valueRub": 100000},
    {"lot": "A", "kind": "purchase", "kg": 200, "valueRub": 30000},
    {"lot": "A", "kind": "output", "kg": 500, "valueRub": 50000},
    {"lot": "A", "kind": "transfer", "kg": 100, "valueRub": 10000},
    {"lot": "A", "kind": "shipment", "kg": 300, "valueRub": 30000},
    {"lot": "A", "kind": "writeoff", "kg": 50, "valueRub": 5000},
]


def test_stock_bridge_closes_by_lot_in_kg_and_rub():
    bridge = model.stock_bridge(MOVEMENTS, {"A": 1250})
    assert bridge["balanced"] is True and bridge["matches"] == {"A": True}
    assert bridge["totals"]["closingKg"] == 1250
    assert bridge["totals"]["closingValueRub"] == 135000
    flows = bridge["lots"]["A"]["flows"]
    assert flows["opening"] + flows["purchase"] + flows["output"] - flows["transfer"] - flows["shipment"] - flows["writeoff"] == 1250


def test_stock_bridge_reports_mismatch_and_negative_stock():
    bridge = model.stock_bridge(MOVEMENTS, {"A": 1000})
    assert bridge["matches"] == {"A": False} and bridge["balanced"] is False
    shortage = model.stock_bridge([{"lot": "B", "kind": "shipment", "kg": 5, "valueRub": 50}])
    assert shortage["negativeLots"] == ["B"] and shortage["balanced"] is False


def test_stock_bridge_rejects_unknown_movement_kind():
    bridge = model.stock_bridge([{"lot": "C", "kind": "продажа", "kg": 1, "valueRub": 1}])
    assert bridge["errors"] and bridge["balanced"] is False


# Д05, приёмка 4: сумма статей денежного моста равна серверному итогу; цена применяется к выбранному объему однократно.
def test_money_bridge_sum_equals_server_contribution():
    for patch in ({"cut": 30}, {"cut": 40}, {"cut": 50}, {"cut": 30, "rawCost": 200}, {"cut": 0, "route": "whole"}):
        bridge = model.money_bridge(model.evaluate(patch))
        assert bridge["reconciled"] is True, patch
        assert abs(bridge["diffRub"]) <= EPS, patch


def test_price_change_is_applied_once_to_sold_volume():
    base = model.evaluate({"cut": 30})
    raised = model.evaluate({"cut": 30, "prices": {"fillet": 310}})
    sold_kg = base["allocations"]["fillet"]["sold"] * 1000
    assert math.isclose(raised["contribution"] - base["contribution"], sold_kg * 10, rel_tol=1e-12)


def test_bridge_sum_flags_mismatch_against_server_total():
    items = [{"id": "a", "valueRub": 1.5}, {"id": "b", "valueRub": 2.25}, {"id": "t", "valueRub": 3.75, "kind": "total"}]
    assert model.bridge_sum(items)["reconciled"] is True
    assert model.bridge_sum(items[:2] + [{"id": "t", "valueRub": 4, "kind": "total"}])["reconciled"] is False


def test_contribution_split_marks_missing_finance_items():
    split = model.contribution_split(model.evaluate({"cut": 30}))
    assert split["managedContributionRub"] == model.evaluate({"cut": 30})["contribution"]
    assert split["distributedProductionCostRub"] == model.evaluate({"cut": 30})["rawCost"] + model.evaluate({"cut": 30})["routeCost"]
    for key in ("fullCost", "periodProfit", "cashFlow"):
        assert split[key + "Rub"] is None
        assert split[key + "Status"].startswith("Требуется подтверждение")


def test_lever_package_keeps_interaction_as_separate_term():
    levers = {"cut": {"cut": 40}, "price": {"prices": {"fillet": 310}}}
    result = model.lever_residual({"cut": 30}, levers)
    assert result["interactionRub"] == pytest.approx(result["jointRub"] - sum(result["individualRub"].values()))
    # Цена филе зависит от выбранного объема разделки: остаток взаимодействий не равен нулю.
    assert abs(result["interactionRub"]) > 1


def test_merge_patch_merges_nested_objects_only():
    assert model.merge_patch({"prices": {"fillet": 300, "whole": 170}, "cut": 30}, {"prices": {"fillet": 310}})["prices"] == {"fillet": 310, "whole": 170}


# Паритет Python и JS для новых функций регистра.
def test_register_functions_match_javascript():
    week = resolved({"variableCostRubKg": 15.6, "rawInRate": False})
    training = resolved({"variableCostRubKg": 8})
    calls = [
        {"fn": "unitCostRegister", "args": [week, "whole"]},
        {"fn": "unitCostRegister", "args": [week, "fillet"]},
        {"fn": "unitCostRegister", "args": [resolved(), "whole"]},
        {"fn": "unitCostRegister", "args": [training, "whole"]},
        {"fn": "costStack", "args": [FILLET_STACK]},
        {"fn": "stockBridge", "args": [MOVEMENTS, {"A": 1250}]},
        {"fn": "moneyBridge", "args": [model.evaluate({"cut": 30})]},
        {"fn": "contributionSplit", "args": [model.evaluate({"cut": 30})]},
        {"fn": "leverResidual", "args": [{"cut": 30}, {"cut": {"cut": 40}, "price": {"prices": {"fillet": 310}}}]},
        {"fn": "bridgeSum", "args": [[{"id": "a", "valueRub": 1.5}, {"id": "t", "valueRub": 1.5, "kind": "total"}]]},
    ]
    js = run_js(calls)
    py = [
        pf.unit_cost_register(week, "whole"), pf.unit_cost_register(week, "fillet"),
        pf.unit_cost_register(resolved(), "whole"), pf.unit_cost_register(training, "whole"),
        model.cost_stack(FILLET_STACK), model.stock_bridge(MOVEMENTS, {"A": 1250}),
        model.money_bridge(model.evaluate({"cut": 30})), model.contribution_split(model.evaluate({"cut": 30})),
        model.lever_residual({"cut": 30}, {"cut": {"cut": 40}, "price": {"prices": {"fillet": 310}}}),
        model.bridge_sum([{"id": "a", "valueRub": 1.5}, {"id": "t", "valueRub": 1.5, "kind": "total"}]),
    ]
    for index, (actual, expected) in enumerate(zip(py, js)):
        same(actual, expected, calls[index]["fn"])


def test_cost_classes_cover_six_attributes_and_flag_tax_basis():
    keys = {"id", "name", "kgBase", "operation", "variability", "taxBasis", "period", "recognition"}
    assert all(set(item) == keys for item in model.COST_CLASSES)
    # Налоговая основа не выбрана финансами: статус «Требуется подтверждение», а не значение.
    assert all(item["taxBasis"].startswith("Требуется подтверждение") for item in model.COST_CLASSES)
