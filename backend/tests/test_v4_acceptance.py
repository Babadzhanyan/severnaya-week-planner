"""Независимые приемочные тесты итерации v4 (L7, Д12).

Проверяют числа, единицы и пороги текста пакета Проверка_внедрения_v4 дословно.
Тесты написаны до реализации: падение означает расхождение кода с пакетом.
Рядом с каждым тестом указан владелец направления, который устраняет расхождение.
Тесты не пропускаются. Единственное изменение набора проверок: ключ name исключен из запрещенных (F6, см. FORBIDDEN_KEYS).

Неделя берется из синтетической фикстуры backend/tests/fixtures_v4 через переменную SEVERNAYA_ANON_EXPORT_DIR.
Реальные каталоги данных этот файл не открывает.
"""
import hashlib
import json
import re
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures_v4"
WEEK_FILE = FIXTURES / "week_config.json"
ENV_WEEK = "SEVERNAYA_ANON_EXPORT_DIR"
ENV_SCENARIO_DB = "SEVERNAYA_SCENARIO_DB"

# Запрещенные ключи: ключи источника из backend/tests/test_restricted_fields_static.py (KEYS) и персональные ключи
# (телефон, почта, контакт, руководитель). Ключ name исключен (F6): контракт сохраняет name в существующих ответах
# каталога и в ответах сценариев, а в документах пакета запрета на name нет.
# Дальнейшее сужение набора: Требуется подтверждение (владелец: архитектор). Список исключений пуст.
FORBIDDEN_KEYS = {"confirmedAliases", "sourceRefs", "sha256", "peerSourceRows", "manager", "contact", "phone", "email"}
ALLOWLIST = set()

DATASETS = {"capacity", "economics", "costs", "clients", "demand", "productionCatalog"}


def week_fixture():
    return json.loads(WEEK_FILE.read_text(encoding="utf-8"))


@pytest.fixture
def synthetic_week(monkeypatch):
    """Направляет загрузчик недели на синтетическую фикстуру."""
    monkeypatch.setenv(ENV_WEEK, str(FIXTURES))
    return monkeypatch


def resolved_plan_week(week, routeCode=None):
    """Разрешает неделю так же, как расчет фронтира: контракт недели передается и как база, и как config.

    Пакет: сырье 114,9 входит в ставку целой тушки 130,5. Признак rawInRate true у маршрута целой тушки передается в контракте недели.
    """
    from backend import plan_frontier

    config = json.loads(json.dumps(week))
    base = json.loads(json.dumps(week))
    if routeCode is not None:
        base["routeCode"] = routeCode
    return plan_frontier.resolve_week(base, config=config)["week"]


def find_forbidden(payload):
    """Возвращает пути ключей из FORBIDDEN_KEYS, которых нет в ALLOWLIST."""
    found = []

    def walk(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                here = path + "." + key
                if key in FORBIDDEN_KEYS and here not in ALLOWLIST:
                    found.append(here)
                walk(value, here)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, path + "[" + str(index) + "]")

    walk(payload, "$")
    return found


# ---------------------------------------------------------------- Заказы и API (Д02, владелец L4)

def test_order_1000_kg_returns_from_week_api_with_same_fields(synthetic_week):
    """Заказ 1 000 кг проходит валидатор и возвращается в API с тем же ключом, датой, продуктом, объемом и классом.

    Соответствие полей: дата – period, продукт – productId, объем – qtyKg, класс – status.
    Ключ заказа в контракте не задан: Требуется подтверждение (владелец: архитектор).
    Тест сверяет все поля строки, включая ключ при появлении поля.
    """
    from fastapi.testclient import TestClient
    from backend import anon_export
    from backend.app import app

    data = week_fixture()
    expected = data["orders"][0]
    assert expected["qtyKg"] == 1000
    anon_export.validate(data)

    response = TestClient(app).get("/api/week")
    assert response.status_code == 200, response.text
    body = response.json()
    orders = body.get("orders", (body.get("week") or {}).get("orders"))
    assert orders is not None, "Блок orders отсутствует в ответе /api/week"
    assert len(orders) == 1, "В ответе ожидается один заказ"
    assert orders[0] == expected


def test_cost_facts_return_from_week_api_unchanged(synthetic_week):
    """costFacts возвращаются из load_week вместе с orders (План, Д02, работа 1). Владелец: L4."""
    from fastapi.testclient import TestClient
    from backend.app import app

    expected = week_fixture()["costFacts"]
    response = TestClient(app).get("/api/week")
    assert response.status_code == 200, response.text
    body = response.json()
    facts = body.get("costFacts", (body.get("week") or {}).get("costFacts"))
    assert facts == expected, "Блок costFacts отсутствует или отличается от входа"


# ---------------------------------------------------------------- Себестоимость: повтор сырья (Ревью, План Д05, владелец L3)

def test_unit_cost_counts_raw_material_once(synthetic_week):
    """Ставка 130,5 с признаком rawInRate уже содержит сырье 114,9. Сумма 127,2 + 130,5 = 257,7 не является итоговым unit_cost.

    Условный пример 142,8 (127,2 + 10,8 + 4,8) для ставки без сырья проверен в backend/tests/test_money_register.py.
    """
    from backend import anon_export, plan_frontier

    week = anon_export.load_week()["week"]
    resolved = resolved_plan_week(week)
    value = plan_frontier.unit_cost_register(resolved, "whole")
    assert value == pytest.approx(130.5, abs=1e-6)
    assert value != pytest.approx(257.7, abs=1e-6), "Повтор сырья 127,2 + 130,5 дает 257,7 руб. / кг"


def test_unit_cost_from_contract_does_not_sum_raw_twice(synthetic_week):
    """Контракт недели с признаком rawInRate: итоговый unit_cost не равен 257,7 руб. / кг."""
    from backend import anon_export, plan_frontier

    week = anon_export.load_week()["week"]
    resolved = resolved_plan_week(week)
    value = plan_frontier.unit_cost_register(resolved, "whole")
    assert value is None or abs(value - 257.7) > 0.05, "Повтор сырья 127,2 + 130,5 дает 257,7 руб. / кг"


# ---------------------------------------------------------------- Перевод единиц и ресурс упаковки (Визуальная спецификация, владелец L2)

def test_bulk_packing_load_is_92_86918_percent():
    """313 221,75 / 337 272 × 100 = 92,86918 % (допуск 1e-4). Лист 2.2, ячейки D19 и F19."""
    from backend import units

    assert units.load_percent(313221.7507, 337272) == pytest.approx(92.86918, abs=1e-4)
    assert units.load_percent(313221.75, 337272) == pytest.approx(92.86918, abs=1e-4)


def test_bulk_packing_passport_cites_sheet_2_2_cells_d19_f19():
    """Паспорт валовой упаковки ссылается на лист 2.2 и ячейки D19 и F19, значение равно 313 221,7507."""
    from backend import units

    passport = units.unit_passport(
        cell={"sheet": "2.2", "cells": "D19, F19"},
        value=313221.7507,
        unit="кг / сутки",
        base={"physicalBase": "валовая тушка, кг / сутки", "weighingPoint": "упаковка валовой тушки"},
        period="сутки",
        calendar="рабочие дни недели",
        rule="313 221,7507 / 337 272 кг / сутки × 100",
    )
    assert passport["sourceCell"]["sheet"] == "2.2"
    assert "D19" in passport["sourceCell"]["cells"] and "F19" in passport["sourceCell"]["cells"]
    assert passport["value"] == pytest.approx(313221.7507)


def test_training_packing_4009_percent_is_training_example_not_working():
    """При учебных 100 т и выпуске 4 009 т статус «учебный пример»; процент 4 009 % не выводится как рабочий."""
    from backend import units

    diagnosis = units.training_load_diagnosis(4009, 100)
    assert diagnosis["status"] == units.STATUS_TRAINING
    assert diagnosis["status"].lower() == "учебный пример"
    assert diagnosis["percent"] == pytest.approx(4009, abs=1e-6)


def test_training_limit_stays_training_until_bulk_flow_is_assigned():
    """Учебные 100 т сохраняют статус учебного примера до подключения паспорта ресурса (План, Д06)."""
    from backend import units

    limit = units.training_limit("Учебные 100 т в неделю", 100)
    kept = units.replace_training_limit(limit, flow=None)
    assert kept["status"].lower() == "учебный пример"


# ---------------------------------------------------------------- Обязательство филе (Ревью, План Д06, владелец L3)

def test_fillet_commitment_600t_excludes_zero_cut(synthetic_week):
    """Обязательство 600 000 кг филе: вариант 0 т разделки исключен, выпуск филе 0 кг недопустим."""
    from backend import anon_export, plan_frontier

    week = anon_export.load_week()["week"]
    week["commitmentKg"] = {"fillet": 600000}
    resolved = resolved_plan_week(week, routeCode="fillet")
    boundary = plan_frontier.commitment_boundary(resolved, 0)
    assert boundary["feasible"] is False
    assert boundary["violations"], "Нарушение обязательства не названо"
    text = json.dumps(boundary["violations"], ensure_ascii=False)
    assert "fillet" in text or "филе" in text.lower()
    assert boundary["minCutT"] is None or boundary["minCutT"] > 0


# ---------------------------------------------------------------- Границы объема разделки (Ревью, План Д06, владелец L3)

def test_contribution_30t_2_44_million_and_31_25t_2_45_million_and_31_25_inside_search():
    """30 т дают 2,44 млн руб.; 31,25 т дают 2,45 млн руб.; 31,25 т лучше 30 т в области поиска."""
    from backend import model

    at_30 = model.evaluate({"cut": 30})
    at_31_25 = model.evaluate({"cut": 31.25})
    assert round(at_30["contribution"] / 1e6, 2) == 2.44
    assert round(at_31_25["contribution"] / 1e6, 2) == 2.45
    assert at_30["feasible"] is True
    assert at_31_25["feasible"] is True

    search = model.search_cut(area={"fromT": 30, "toT": 50, "stepT": 0.25})
    point = next(item for item in search["points"] if item["cutT"] == 31.25)
    assert point["contribution"] == pytest.approx(at_31_25["contribution"], abs=1e-6)
    assert point["contribution"] > at_30["contribution"]
    assert search["best"] is not None
    assert search["best"]["contribution"] >= point["contribution"] - 1e-6


# ---------------------------------------------------------------- Стек филе и денежный мост (Визуальная спецификация, владелец L3 и L5)

@pytest.mark.parametrize(
    "items, expected_total",
    [
        ([117.3393655101, 20.0100687032, 4.1373325945], 141.4867668079),
        ([117.3393655101, 20.0100687032, 4.59815054], 141.9475847510),
    ],
)
def test_money_bridge_items_reconcile_with_server_total(items, expected_total):
    """Сумма статей филе 117,3393655101 + 20,0100687032 + 4,1373325945 равна 141,4867668079 (допуск 1e-7).

    Бескостное бедро: 141,9475847510. Сверка с серверным итогом выполняется с допуском EPS = 1e-7.
    """
    from backend import model

    bridge = [{"valueRub": value, "kind": "cost"} for value in items]
    bridge.append({"valueRub": expected_total, "kind": "total"})
    result = model.bridge_sum(bridge)
    assert result["sumRub"] == pytest.approx(expected_total, abs=1e-6)
    assert result["reconciled"] is True
    assert abs(result["diffRub"]) <= 1e-7


def test_money_bridge_reports_mismatch_beyond_eps():
    """Расхождение больше допуска 1e-7 сверка показывает как несходимость."""
    from backend import model

    bridge = [{"valueRub": value, "kind": "cost"} for value in (117.3393655101, 20.0100687032, 4.1373325945)]
    bridge.append({"valueRub": 141.4867668079 + 0.0001, "kind": "total"})
    assert model.bridge_sum(bridge)["reconciled"] is False


# ---------------------------------------------------------------- Ключи ответов API (пакет: запрещенные ключи, владелец L4 и L2)

@pytest.mark.parametrize("url", ["/api/week", "/api/catalog", "/api/health"])
def test_api_responses_have_no_forbidden_keys(synthetic_week, url):
    """Ни один ответ API не содержит ключей confirmedAliases, sourceRefs, sha256, peerSourceRows, manager, contact, phone, email.

    Ключ name в каталоге (названия продуктов и маршрутов) разрешен контрактом и в набор не входит (F6).
    """
    from fastapi.testclient import TestClient
    from backend.app import app

    response = TestClient(app).get(url)
    assert response.status_code == 200, (url, response.text)
    assert (url, find_forbidden(response.json())) == (url, [])


def test_scenario_api_responses_have_no_forbidden_keys(monkeypatch, tmp_path):
    """Ответы сценариев (контракт, раздел 3) не содержат запрещенных ключей. Ключ name в ответах сценариев разрешен контрактом."""
    from fastapi.testclient import TestClient
    from backend.app import app

    monkeypatch.setenv(ENV_SCENARIO_DB, str(tmp_path / "scenarios.sqlite3"))
    client = TestClient(app)
    body = {
        "keyFields": {
            "dataEdition": hashlib.sha256(b"synthetic-edition").hexdigest(),
            "product": "fillet",
            "day": "2026-10-19",
            "zone": "Зона 1",
            "packing": "вакуум",
            "client": "К-001",
            "scheme": "fillet",
            "paramsVersion": hashlib.sha256(b"synthetic-params").hexdigest(),
        },
        "name": "Проверка сценария",
        "authorLabel": "Коммерция",
        "baseRevision": None,
        "content": {"params": {}, "request": {}, "roi": {}, "commercial": {}},
    }
    created = client.post("/api/scenarios", json=body)
    assert created.status_code == 201, created.text
    scenario_id = created.json()["id"]

    urls = ["/api/scenarios", "/api/scenarios/" + str(scenario_id), "/api/scenarios/" + str(scenario_id) + "/export"]
    violations = []
    for url in urls:
        response = client.get(url)
        assert response.status_code == 200, (url, response.text)
        found = find_forbidden(response.json())
        if found:
            violations.append((url, found))
    assert violations == []


# ---------------------------------------------------------------- Публикация: состав наборов, пути и имена файлов не выводятся (контракт, раздел 2; владелец L1)

def test_publication_passport_lists_six_datasets_without_paths_or_file_names(tmp_path):
    """Паспорт публикации перечисляет шесть наборов, статусы «доступен» или «отсутствует», и не содержит путей и имен файлов."""
    from backend import anon_export, model, publication_passport

    passport = publication_passport.build_passport(tmp_path, model.VERSION, model.VERSION, anon_export.SCHEMA_VERSION)
    names = {dataset["name"] for dataset in passport["datasets"]}
    assert names == DATASETS
    for dataset in passport["datasets"]:
        assert dataset["status"] in {"доступен", "отсутствует"}
    assert passport["deployment"] == "локальная сборка"
    assert re.fullmatch(r"[0-9a-f]{64}", passport["dataEdition"])

    text = json.dumps(passport, ensure_ascii=False)
    assert str(tmp_path) not in text, "Абсолютный путь попал в паспорт"
    assert not re.search(r"\.(json|csv|xlsx|xls|gz|txt|parquet)\b", text), "Имя файла попало в паспорт"
    assert "/" not in text, "Разделитель пути попал в паспорт"
