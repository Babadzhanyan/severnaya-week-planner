"""Сверка Python с независимым исполнением канонических JS-формул."""
from copy import deepcopy
import json
import math
from pathlib import Path
import random
import subprocess

import pytest
from backend import model

ROOT = Path(__file__).resolve().parents[2]


def assert_equivalent(actual, expected, path="result"):
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected, (path, actual, expected)
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool)
        assert math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-7), (path, actual, expected)
    elif isinstance(expected, list):
        assert len(actual) == len(expected), path
        for index, (a, e) in enumerate(zip(actual, expected)):
            assert_equivalent(a, e, f"{path}[{index}]")
    else:
        assert actual.keys() == expected.keys(), (path, actual.keys() ^ expected.keys())
        for key in expected:
            assert_equivalent(actual[key], expected[key], path + "." + key)


def build_cases():
    rng = random.Random(20261013)
    inputs = [{}, {"cut": 40}, {"route": "coarse"}, {"route": "deep"}, {"route": "whole"}, {"stageCapacity": {"deboning": 0}}, {"stageCapacity": {"packing": 0}}, {"demand": {"fillet": 10}}, {"demand": {"whole": 0}}, {"cut": 101}, {"prices": {"fillet": 2}}, {"cut": 31.25, "demand": {"fillet": 10}}]
    for index in range(400):
        p = model.defaults()
        p.update(route=rng.choice(list(model.ROUTES)), totalInput=rng.randint(0, 200), rawCost=rng.randint(0, 250), minWhole=rng.randint(0, 70), capacity=rng.randint(0, 150), hours=rng.randint(0, 168), rate=rng.choice([0, .625, 1, 1.5]), coldCapacity=rng.randint(0, 100))
        p["cut"] = round(rng.random() * p["totalInput"], 3)
        p["stageCapacity"] = {key: rng.randint(0, 200) for key in p["stageCapacity"]}
        for product in model.IDS:
            p["prices"][product] = rng.randint(0, 450)
            p["service"][product] = rng.randint(0, 30)
            p["demand"][product] = rng.randint(0, 200)
            p["orders"][product] = rng.randint(0, int(p["demand"][product]))
        if index % 10 == 0:
            product = rng.choice(model.IDS)
            p["requests"]["партия-1"] = {"product": product, "quantity": 1, "price": 200, "service": 5}
            p["orders"][product] += 1
            p["demand"][product] += 1
        inputs.append(p)
    cases = []
    for index, p in enumerate(inputs):
        cases.extend([{"fn": "evaluate", "args": [p]}, {"fn": "alternatives", "args": [p]}, {"fn": "fact", "args": [p]}, {"fn": "roi", "args": [p, {"weeks": index % 54, "execution": .75, "investment": 1_000_000, "annualOpex": 200_000}]}])
    for index in range(120):
        p = model.defaults()
        p["route"] = rng.choice(list(model.ROUTES))
        p["cut"] = rng.choice([30, 40, 50])
        p["prices"]["fillet"] = rng.choice([1, 300, 350])
        r = {"requestId": "заказ-" + str(index), "product": rng.choice(model.IDS), "quantity": rng.choice([.25, 1, 5, 20, 100]), "price": rng.randint(0, 500), "service": rng.randint(0, 50), "forecastAbsorption": index % 2 == 0}
        cases.append({"fn": "checkRequest", "args": [p, r]})
    for confirms in ({}, {"com": True, "prod": True}, {"com": True, "prod": True, "fin": True}, {"commercial": True, "production": True, "finance": True}):
        cases.append({"fn": "snapshot", "args": [{}, confirms]})
    for p in inputs[:100]:
        cases.append({"fn": "changeLevers", "args": [p]})
    numeric_ids = model.defaults()
    numeric_ids["orders"]["fillet"] = 25
    numeric_ids["demand"]["fillet"] = 25
    numeric_ids["requests"] = {"10": {"product": "fillet", "quantity": 10, "price": 400, "service": 2}, "2": {"product": "fillet", "quantity": 10, "price": 200, "service": 3}, "01": {"product": "fillet", "quantity": 5, "price": 300, "service": 1}}
    cases.append({"fn": "evaluate", "args": [numeric_ids]})
    cases.append({"fn": "fact", "args": [numeric_ids]})
    return cases


CASES = build_cases()


@pytest.fixture(scope="module")
def js_results():
    script = """
    const fs=require('fs'), vm=require('vm');
    const context={module:{exports:{}}};vm.createContext(context);
    vm.runInContext(fs.readFileSync('model.js','utf8'),context);
    const m=context.module.exports;
    const cases=JSON.parse(fs.readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(cases.map(c=>m[c.fn](...c.args))));
    """
    run = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps(CASES), capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


@pytest.mark.parametrize("index", range(len(CASES)))
def test_javascript_parity(index, js_results):
    case = CASES[index]
    function = getattr(model, {"checkRequest": "check_request", "changeLevers": "change_levers"}.get(case["fn"], case["fn"]))
    params = deepcopy(case["args"])
    result = function(*params)
    assert_equivalent(result, js_results[index], case["fn"])
    assert params == case["args"], "Вычисление сохраняет исходный ввод"
