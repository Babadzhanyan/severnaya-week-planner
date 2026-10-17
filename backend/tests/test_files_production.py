"""Синтетические источники проверяют частичный расчёт производственной цепочки."""
from copy import deepcopy
import json

from fastapi.testclient import TestClient
import pytest

from backend.app import app
from backend.files_capacity import STAGE_MASS_BASES
from backend.files_economics import PRODUCT_IDS, ROUTE_IDS
from backend.production_routes import CARCASS_BASIS, UNIT


client = TestClient(app)


def source_fixture():
    """Значения придуманы для проверки контракта и относятся к учебному набору."""
    def ref(cell, value, sheet="Пример"):
        return {"source_id": "synthetic", "sheet": sheet, "cell": cell,
                "formula": None, "saved_value": value}

    outputs_first = {"breast_skin": .3, "hindquarter_skin": .4, "wing_no_tip": .1,
                     "wing_tip": .05, "wing_soup_set": .05, "scapular_back": .1}
    route_outputs = [outputs_first,
                     {"breast_fillet": .5, "whole_leg_skin": .4, "waste_loss": .1},
                     {"breast_fillet": .4, "thigh_with_back": .5, "waste_loss": .1},
                     {"breast_fillet": .4, "thigh_skin": .4, "waste_loss": .2},
                     {"breast_fillet": .4, "thigh_meat": .5, "waste_loss": .1}]
    products = [{"id": key, "name": f"Продукт {i}", "category": "Учебный продукт"}
                for i, key in enumerate(PRODUCT_IDS)]
    routes = []
    for i, route_id in enumerate(ROUTE_IDS):
        routes.append({"id": route_id, "name": f"Схема {i}", "basis": CARCASS_BASIS,
                       "approved_current_norm": False, "source_period": {"saved_calculation_period": "Учебный период"},
                       "loss_product_id": "waste_loss", "outputs": [
                           {"product_id": key, "coefficient_kg_per_kg": route_outputs[i].get(key, 0),
                            "source_refs": [ref(f"A{j + 1}", route_outputs[i].get(key, 0), f"Выходы {i}")]}
                           for j, key in enumerate(PRODUCT_IDS)]})
    stages = [{"id": key, "name": f"Передел {i}", "unit": UNIT, "mass_basis": mass,
               "capacity_kg_day": 1000, "source_refs": [ref(f"B{i + 1}", 1000)]}
              for i, (key, mass) in enumerate(STAGE_MASS_BASES.items())]
    rows = []
    for i, route in enumerate(routes):
        for stage in stages:
            row = {"route_id": route["id"], "stage_id": stage["id"],
                   "demand_basis": stage["mass_basis"], "calculation": "explicit_flow_required",
                   "coefficient_kg_per_kg_carcass": None, "product_ids": [],
                   "gap_ids": ["norm_required"], "source_refs": deepcopy(stage["source_refs"])}
            if stage["id"] in ("breast_fillet", "thigh_fillet"):
                product_id = "thigh_meat" if stage["id"] == "thigh_fillet" else "breast_fillet"
                row.update(calculation="route_outputs", product_ids=[product_id],
                           coefficient_kg_per_kg_carcass=route_outputs[i].get(product_id, 0))
            if i == 0 and stage["id"] in ("cutting", "bulk_carcass_pack", "individual_carcass_pack"):
                weight = 1 if stage["id"] == "cutting" else 0
                row.update(calculation="weighted_route_outputs", product_ids=list(outputs_first),
                           coefficient_kg_per_kg_carcass=weight,
                           product_coefficients=[{"product_id": product, "coefficient": weight,
                                                  "source_refs": [ref(f"C{j + 1}", weight, stage["id"])]}
                                                 for j, product in enumerate(outputs_first)])
            rows.append(row)
    nodes = [{"id": f"node_{i}", "name": f"Узел {i}", "section_ids": [f"section_{i}"]} for i in range(13)]
    sections = [{"id": f"section_{i}", "node_id": f"node_{i}", "name": f"Раздел {i}",
                 "operation_ids": [f"operation_{j}" for j in range(27) if j % 13 == i]} for i in range(13)]
    operations = []
    for i in range(27):
        stage = stages[i] if i < 17 else None
        operations.append({"id": f"operation_{i}", "name": f"Операция {i}", "section_id": f"section_{i % 13}",
                           "stage_id": stage["id"] if stage else None, "equipment_ids": [],
                           "capacity_kind": "throughput" if stage else "inventory",
                           "capacity_value": 1000 if stage else None, "capacity_unit": UNIT if stage else "кг",
                           "mass_basis": stage["mass_basis"] if stage else "Учебный запас",
                           "status": "Требуется паспорт", "gap_ids": ["norm_required"]})
    return {"schema_version": 1, "products": products, "routes": routes, "stages": stages,
            "route_stage_matrix": rows, "chain_nodes": nodes, "sections": sections,
            "operations": operations, "equipment": [],
            "chain_links": [{"id": f"link_{i}", "from_node_id": f"node_{i}", "to_node_id": f"node_{i + 1}",
                             "flow_name": "Учебный поток", "coefficient": None, "coefficient_unit": "кг / кг",
                             "time_lag_days": None, "status": "Требуется норма", "gap_ids": ["norm_required"]}
                            for i in range(12)],
            "stage_node_links": [{"stage_id": stage["id"], "chain_node_id": f"node_{i % 13}"}
                                 for i, stage in enumerate(stages)],
            "ui_node_aliases": [{"ui_node_id": "screen_node", "chain_node_id": "node_0"}],
            "gaps": [{"id": "norm_required", "name": "Требуется учебная норма"}],
            "sources": {"synthetic": {"file": "/private/production/пример.xlsx", "path": "/private/production/пример.xlsx",
                                      "sha256": "a" * 64, "read_file": "/private/production/пример.xlsx"}},
            "selected_dataset_status": {"approved_current_norm": False, "saved_calculation_period": "Учебный период"},
            "capacity_period": {"volumeLabel": "Учебный месяц", "yieldStructureLabel": "Учебная структура"}}


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", str(tmp_path))
    directory = tmp_path / "next_stage_production"
    directory.mkdir()
    path = directory / "route_matrix.json"
    path.write_text(json.dumps(source_fixture(), ensure_ascii=False), encoding="utf-8")
    return path


def evaluate(route_id="level_1", amount=100):
    return client.post("/api/files/production/evaluate", json={"routeId": route_id, "carcassKgDay": amount})


def test_registered_catalog_preserves_metadata_and_sanitizes_paths(source):
    response = client.get("/api/files/production/catalog")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["counts"] == {"routes": 5, "products": 22, "stages": 17, "nodes": 13,
                              "totalCalculable": 13, "totalRequired": 72}
    assert [row["id"] for row in data["routes"]] == list(ROUTE_IDS)
    assert len(data["chainNodes"]) == 13 and len(data["stageNodeLinks"]) == 17
    assert data["uiNodeAliases"] == [{"ui_node_id": "screen_node", "chain_node_id": "node_0"}]
    assert "sources" not in data and "sha256" not in response.text and "xlsx" not in response.text
    assert "/private/" not in response.text and "read_file" not in response.text
    assert data["period"]["capacity"]["volumeLabel"] == "Учебный месяц"


def test_all_five_routes_keep_known_zero_and_unknown_distinct(source):
    known = missing = 0
    for route_id in ROUTE_IDS:
        response = evaluate(route_id)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["inputKgDay"] == 100
        assert data["knownCount"] == (5 if route_id == "level_1" else 2)
        assert data["requiredCount"] == (12 if route_id == "level_1" else 15)
        assert data["complete"] is False and data["feasible"] is None and data["fullChainFeasible"] is None
        for row in data["rows"]:
            if row["coefficient"] is None:
                assert row["demandKgDay"] is None and row["utilization"] is None and row["gapIds"]
            else:
                assert row["demandKgDay"] == pytest.approx(100 * row["coefficient"])
            assert row["unit"] == UNIT and row["massBasis"] == STAGE_MASS_BASES[row["id"]]
            assert "sourceRefs" not in row and row["label"] and "name" not in row
        known += data["knownCount"]
        missing += data["requiredCount"]
    assert (known, missing) == (13, 72)
    first = {row["id"]: row for row in evaluate().json()["rows"]}
    assert first["cutting"]["demandKgDay"] == 100
    for stage_id in ("bulk_carcass_pack", "individual_carcass_pack", "breast_fillet", "thigh_fillet"):
        assert first[stage_id]["demandKgDay"] == first[stage_id]["coefficient"] == 0


@pytest.mark.parametrize("route_id", ROUTE_IDS)
def test_zero_input_keeps_required_loads_unknown(source, route_id):
    data = evaluate(route_id, 0).json()
    for row in data["rows"]:
        assert row["demandKgDay"] == (None if row["coefficient"] is None else 0)
    assert data["complete"] is False and data["feasible"] is None


def test_known_overload_rejects_partial_feasibility(source):
    data = evaluate("level_4", 2100).json()
    thigh = next(row for row in data["rows"] if row["id"] == "thigh_fillet")
    assert thigh["demandKgDay"] == 1050 and thigh["utilization"] == 1.05
    assert data["feasible"] is False and data["complete"] is False and data["fullChainFeasible"] is None


@pytest.mark.parametrize("payload", [
    {}, {"routeId": "level_1"}, {"carcassKgDay": 100},
    {"routeId": "unknown", "carcassKgDay": 100}, {"routeId": 1, "carcassKgDay": 100},
    {"routeId": "level_1", "carcassKgDay": -1}, {"routeId": "level_1", "carcassKgDay": True},
    {"routeId": "level_1", "carcassKgDay": "100"}, {"routeId": "level_1", "carcassKgDay": None},
    {"routeId": "level_1", "carcassKgDay": 100, "cutInputKg": 1000},
    {"routeId": "level_1", "carcassKgDay": 100, "path": "/private/data.json"},
])
def test_invalid_request_returns_422(source, payload):
    assert client.post("/api/files/production/evaluate", json=payload).status_code == 422


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_request_returns_422(source, value):
    response = client.post("/api/files/production/evaluate",
                           content='{"routeId":"level_1","carcassKgDay":' + value + '}',
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_maximum_finite_input_returns_finite_response(source):
    response = evaluate("level_1", 1.7976931348623157e308)
    assert response.status_code in (200, 422)
    json.dumps(response.json(), allow_nan=False)


def test_missing_source_reports_404(monkeypatch, tmp_path):
    monkeypatch.delenv("SEVERNAYA_SOURCE_DATA_DIR", raising=False)
    assert client.get("/api/files/production/catalog").status_code == 404
    monkeypatch.setenv("SEVERNAYA_SOURCE_DATA_DIR", str(tmp_path))
    assert client.get("/api/files/production/catalog").status_code == 404


@pytest.mark.parametrize("change", [
    lambda m: m["routes"].pop(),
    lambda m: m["routes"][0].update(basis="кг живой массы"),
    lambda m: m["routes"][0]["outputs"][0].update(coefficient_kg_per_kg=.6),
    lambda m: m["stages"][0].update(unit="т / сутки"),
    lambda m: m["stages"][0].update(mass_basis="Другая масса"),
    lambda m: m["stages"][0].update(capacity_kg_day=True),
    lambda m: m["stages"][0].update(capacity_kg_day=-1),
    lambda m: m["stages"][0]["source_refs"][0].update(saved_value=900),
    lambda m: m["route_stage_matrix"].pop(),
    lambda m: m["route_stage_matrix"][0].update(coefficient_kg_per_kg_carcass=0),
    lambda m: m["route_stage_matrix"][0].update(gap_ids=[]),
    lambda m: m["route_stage_matrix"][0].update(demand_basis="Другая масса"),
    lambda m: m["sources"]["synthetic"].update(sha256="broken"),
    lambda m: m["sources"].clear(),
    lambda m: m["stages"][0]["source_refs"][0].update(source_id="unknown"),
    lambda m: m["stages"][0]["source_refs"][0].pop("formula"),
    lambda m: m["stages"][0]["source_refs"][0].update(saved_value=float("nan")),
    lambda m: m["routes"][0].update(approved_current_norm=True),
    lambda m: m["selected_dataset_status"].update(approved_current_norm=True),
    lambda m: m["capacity_period"].pop("volumeLabel"),
    lambda m: m["chain_nodes"].pop(),
    lambda m: m["operations"][0].update(capacity_value=900),
    lambda m: m["ui_node_aliases"][0].update(chain_node_id="unknown"),
])
def test_invalid_source_returns_503_on_both_endpoints(source, change):
    matrix = source_fixture()
    change(matrix)
    source.write_text(json.dumps(matrix, ensure_ascii=False), encoding="utf-8")
    for response in (client.get("/api/files/production/catalog"), evaluate()):
        assert response.status_code == 503, response.text
        assert response.json()["detail"][0]["type"] == "source_invalid"
        assert "/private/" not in response.text


@pytest.mark.parametrize("contents", ["{", "null", "[]", "true", '{"schema_version":1}'])
def test_malformed_source_has_controlled_503(source, contents):
    source.write_text(contents, encoding="utf-8")
    assert client.get("/api/files/production/catalog").status_code == 503


def test_counts_follow_data_and_no_complete_chain_is_inferred(source):
    matrix = source_fixture()
    for row in matrix["route_stage_matrix"]:
        if row["route_id"] == "level_1" and row["stage_id"] == "cutting":
            row.update(calculation="mapping_required", coefficient_kg_per_kg_carcass=None, product_ids=[])
            row.pop("product_coefficients")
    source.write_text(json.dumps(matrix, ensure_ascii=False), encoding="utf-8")
    data = evaluate().json()
    assert data["counts"]["totalCalculable"] == 12 and data["counts"]["totalRequired"] == 73
    assert data["knownCount"] == 4 and data["fullChainFeasible"] is None


def test_capacity_reference_cannot_be_replaced_by_demand_reference(source):
    matrix = source_fixture()
    stage = matrix["stages"][0]
    stage["source_refs"].append({"source_id": "synthetic", "sheet": "Спрос", "cell": "D1",
                                 "formula": None, "saved_value": 900})
    stage["capacity_kg_day"] = 900
    matrix["operations"][0]["capacity_value"] = 900
    source.write_text(json.dumps(matrix, ensure_ascii=False), encoding="utf-8")
    assert client.get("/api/files/production/catalog").status_code == 503


def test_weighted_coefficients_require_the_saved_operation_flag(source):
    matrix = source_fixture()
    row = next(row for row in matrix["route_stage_matrix"]
               if row["route_id"] == "level_1" and row["stage_id"] == "cutting")
    for product in row["product_coefficients"]:
        product["coefficient"] = 0
    row["coefficient_kg_per_kg_carcass"] = 0
    source.write_text(json.dumps(matrix, ensure_ascii=False), encoding="utf-8")
    assert evaluate().status_code == 503
