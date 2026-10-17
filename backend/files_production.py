"""Каталог производственной цепочки и нагрузки схем из локальной матрицы."""
import json
import math
import os
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .files_capacity import STAGE_MASS_BASES
from .files_economics import PRODUCT_IDS, ROUTE_IDS, _sanitize
from .production_routes import TOLERANCE, evaluate_route, validate_matrix, _references
from .schemas import ProductionCatalog, ProductionEvaluation


router = APIRouter(prefix="/api/files/production", tags=["Производственная цепочка из файлов"])
REFERENCE_FIELDS = ("source_id", "sheet", "cell", "formula", "saved_value")
SOURCE_STATUS = "Сценарное сопоставление исторических периодов / действующие нормы требуют подтверждения"


class ProductionInputs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    routeId: str = Field(min_length=1, max_length=64)
    carcassKgDay: float = Field(ge=0, allow_inf_nan=False)


def _error(status, message, kind, location="source"):
    return HTTPException(status_code=status, detail=[{
        "loc": [location], "msg": message, "type": kind,
    }])


def _require(condition):
    if not condition:
        raise ValueError("Контракт производственного источника требует проверки")


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _walk_references(value):
    if isinstance(value, dict):
        if "source_id" in value and ("sheet" in value or "cell" in value):
            yield value
        for item in value.values():
            yield from _walk_references(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_references(item)


def _matches_saved_number(refs, value):
    return any(isinstance(ref["saved_value"], (int, float))
               and not isinstance(ref["saved_value"], bool)
               and math.isclose(ref["saved_value"], value, rel_tol=0, abs_tol=TOLERANCE)
               for ref in refs)


def _validate_source(matrix):
    """Дополняет общий валидатор проверкой паспортов и адресов исходных данных."""
    validate_matrix(matrix)
    _require("chain_nodes" in matrix)
    _require({row["id"] for row in matrix["routes"]} == set(ROUTE_IDS))
    _require({row["id"] for row in matrix["products"]} == set(PRODUCT_IDS))
    _require({row["id"] for row in matrix["stages"]} == set(STAGE_MASS_BASES))
    for stage in matrix["stages"]:
        _require(stage["mass_basis"] == STAGE_MASS_BASES[stage["id"]])
        # Матрица ставит ссылку мощности первой, затем хранит исходную нагрузку.
        _require(_matches_saved_number(stage["source_refs"][:1], stage["capacity_kg_day"]))
    sources = matrix.get("sources")
    _require(isinstance(sources, dict) and bool(sources))
    for source_id, source in sources.items():
        _require(_text(source_id) and isinstance(source, dict))
        _require(_text(source.get("file")))
        _require(isinstance(source.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", source["sha256"]))
        _require(source.get("source_id", source_id) == source_id)
    registered_refs = {}
    for ref in _walk_references(matrix):
        _references([ref], "Источник производственной цепочки")
        _require(ref["source_id"] in sources)
        key = tuple(ref[field] for field in REFERENCE_FIELDS[:3])
        signature = json.dumps([ref["formula"], ref["saved_value"]], ensure_ascii=False, allow_nan=False)
        _require(key not in registered_refs or registered_refs[key] == signature)
        registered_refs[key] = signature
    for route in matrix["routes"]:
        _require(isinstance(route.get("source_period"), dict) and bool(route["source_period"]))
        _require(route.get("approved_current_norm") is False)
        for output in route["outputs"]:
            _require(all(_matches_saved_number([ref], output["coefficient_kg_per_kg"])
                         for ref in output["source_refs"]))
    for row in matrix["route_stage_matrix"]:
        if row["coefficient_kg_per_kg_carcass"] is None:
            _require(bool(row["gap_ids"]))
        for item in row.get("product_coefficients", []):
            # Последняя ссылка признака указывает на ячейку 0 / 1 исходной позиции.
            _require(_matches_saved_number(item["source_refs"][-1:], item["coefficient"]))
    status, period = matrix.get("selected_dataset_status"), matrix.get("capacity_period")
    _require(isinstance(status, dict) and status.get("approved_current_norm") is False)
    _require(isinstance(period, dict) and all(_text(period.get(key)) for key in ("volumeLabel", "yieldStructureLabel")))
    nodes = {node["id"] for node in matrix["chain_nodes"]}
    aliases = matrix.get("ui_node_aliases", [])
    _require(isinstance(aliases, list))
    alias_ids = set()
    for alias in aliases:
        _require(isinstance(alias, dict) and _text(alias.get("ui_node_id")))
        _require(isinstance(alias.get("chain_node_id"), str) and alias["chain_node_id"] in nodes)
        _require(alias["ui_node_id"] not in alias_ids)
        alias_ids.add(alias["ui_node_id"])


def load_source():
    selected_dir = os.environ.get("SEVERNAYA_SOURCE_DATA_DIR")
    if not selected_dir:
        raise _error(404, "Производственная цепочка требует подключения локальной папки источников", "source_missing")
    directory = Path(__file__).resolve().parent / "source_data" if selected_dir == "bundled" else Path(selected_dir)
    try:
        matrix = json.loads((directory / "next_stage_production" / "route_matrix.json").read_text(encoding="utf-8"))
        json.dumps(matrix, allow_nan=False)
        _validate_source(matrix)
    except FileNotFoundError as exc:
        raise _error(404, "Производственная цепочка требует файла next_stage_production/route_matrix.json", "source_missing") from exc
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError) as exc:
        raise _error(503, "Матрица производства требует согласования структуры, единиц, баз массы и источников", "source_invalid") from exc
    return matrix


def _counts(matrix):
    known = sum(row["coefficient_kg_per_kg_carcass"] is not None for row in matrix["route_stage_matrix"])
    return {"routes": len(matrix["routes"]), "products": len(matrix["products"]),
            "stages": len(matrix["stages"]), "nodes": len(matrix["chain_nodes"]),
            "totalCalculable": known, "totalRequired": len(matrix["route_stage_matrix"]) - known}


def _period(matrix, route=None):
    return _sanitize({"capacity": matrix["capacity_period"],
                      "yields": route["source_period"] if route else matrix["selected_dataset_status"]})


@router.get("/catalog", response_model=ProductionCatalog, response_model_exclude_unset=True)
def production_catalog():
    matrix = load_source()
    return _sanitize({"routes": [{"id": route["id"], "name": route["name"]} for route in matrix["routes"]],
                      "chainNodes": matrix["chain_nodes"], "stageNodeLinks": matrix["stage_node_links"],
                      "uiNodeAliases": matrix.get("ui_node_aliases", []), "gaps": matrix["gaps"],
                      "counts": _counts(matrix), "sourceStatus": SOURCE_STATUS, "period": _period(matrix)})


@router.post("/evaluate", response_model=ProductionEvaluation, response_model_exclude_unset=True)
def production_evaluate(inputs: ProductionInputs):
    matrix = load_source()
    route = next((route for route in matrix["routes"] if route["id"] == inputs.routeId), None)
    if route is None:
        raise _error(422, "Расчет требует схему из подключенного каталога", "route_unknown", "routeId")
    try:
        calculated = evaluate_route(matrix, inputs.routeId, inputs.carcassKgDay)
        json.dumps(calculated, allow_nan=False)
    except (ValueError, OverflowError) as exc:
        raise _error(422, "Масса входа требует значения в пределах конечного расчета", "calculation_range", "carcassKgDay") from exc
    source_rows = {row["stage_id"]: row for row in matrix["route_stage_matrix"] if row["route_id"] == inputs.routeId}
    rows = []
    for stage in calculated["stage_loads"]:
        source = source_rows[stage["stage_id"]]
        rows.append({"id": stage["stage_id"], "name": stage["name"],
                     "demandKgDay": stage["load"], "capacityKgDay": stage["capacity"],
                     "coefficient": source["coefficient_kg_per_kg_carcass"],
                     "calculation": source["calculation"], "massBasis": stage["mass_basis"],
                     "unit": stage["unit"],
                     "gapIds": source["gap_ids"], "utilization": stage["utilization"], "status": stage["status"]})
    known = sum(row["demandKgDay"] is not None for row in rows)
    return {"routeId": inputs.routeId, "inputKgDay": inputs.carcassKgDay, "rows": rows,
            "knownCount": known, "requiredCount": len(rows) - known,
            "complete": calculated["complete"], "feasible": calculated["feasible"],
            "fullChainFeasible": None, "sourceStatus": SOURCE_STATUS,
            "period": _period(matrix, route), "counts": _counts(matrix)}
