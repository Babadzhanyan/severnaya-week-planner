"""Расчет сохраненной экономики разделки из локального каталога источников."""
from copy import deepcopy
import json
import math
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import input_paths
from .schemas import EconomicsCatalog

router = APIRouter(prefix="/api/files/economics", tags=["Расчеты исходных файлов"])
ROUTE_IDS = ("level_1", "level_2_leg", "level_2_back_thigh", "level_3", "level_4")
PRODUCT_IDS = (
    "breast_skin", "breast_fillet", "breast_bone", "neck_breast_skin", "mdm_raw",
    "hindquarter_skin", "whole_leg_skin", "hind_back", "thigh_skin", "drumstick_skin",
    "thigh_soup_set", "drumstick_soup_set", "thigh_meat", "meat_trimming", "tubular_bones",
    "thigh_skin_only", "thigh_with_back", "wing_no_tip", "wing_tip", "wing_soup_set",
    "scapular_back", "waste_loss",
)


class FilesEconomicsBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    routeId: Literal["level_1", "level_2_leg", "level_2_back_thigh", "level_3", "level_4"] = "level_1"
    cutInputKg: float = Field(default=1000, ge=0, le=1_000_000_000)
    priceChangePct: float = Field(default=0, ge=-100, le=1000)
    packagingChangePct: float = Field(default=0, ge=-100, le=1000)


def _error(status: int, message: str, kind: str) -> HTTPException:
    return HTTPException(status_code=status, detail=[{"loc": ["source"], "msg": message, "type": kind}])


def _number(value, *, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError("Значение источника требует конечного положительного числа или нуля")
    return float(value)


def _sanitize(value):
    """Сохраняет ячейки и имена книг, исключает локальные пути компьютера."""
    if isinstance(value, dict):
        return {key: _sanitize(item) for key, item in value.items()
                if key not in {"path", "read_file", "absolute_path", "source_path"} and not key.endswith("_path")}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, str) and (value.startswith("/") or value.startswith("file://") or (len(value) > 2 and value[1:3] == ":\\")):
        return value.replace("\\", "/").rsplit("/", 1)[-1]
    return value


def _load():
    source_dir = input_paths.source_root()
    if source_dir is None:
        raise _error(404, "Для расчета требуется подключенный каталог исходных файлов", "source_missing")
    try:
        economics = json.loads(input_paths.economics(source_dir).read_text(encoding="utf-8"))
        yields = json.loads(input_paths.yields(source_dir).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise _error(404, "Для расчета требуется подключенный каталог исходных файлов", "source_missing") from exc
    except (OSError, ValueError) as exc:
        raise _error(503, "Каталог исходных файлов требует проверки формата", "source_invalid") from exc
    try:
        _validate_sources(economics, yields)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError) as exc:
        raise _error(503, "Цены, выходы и версии исходных файлов требуют согласованного каталога", "source_inconsistent") from exc
    return economics, yields



def _ordered_records(rows, key, identifiers):
    if not isinstance(rows, list) or [row[key] for row in rows] != list(identifiers):
        raise ValueError("Состав и порядок справочника требуют согласования")
    return {row[key]: row for row in rows}


def _same_number(actual, expected, *, tolerance=1e-8):
    if actual is None or expected is None:
        if actual is not expected:
            raise ValueError("Пустое значение требует явного статуса")
    elif (isinstance(actual, bool) or not isinstance(actual, (int, float)) or
          not math.isfinite(actual) or not math.isclose(actual, expected, rel_tol=0, abs_tol=tolerance)):
        raise ValueError("Сохраненное значение требует сверки")


def _validate_sources(economics, yields):
    """Сверяет две независимые выгрузки по ключам, долям и исходному результату."""
    whole = economics["whole_baseline"]
    _number(whole["price_rub_per_kg"])
    _number(whole["packaging_rub_per_kg"])
    _same_number(whole["revenue_after_packaging_rub_per_kg"], whole["price_rub_per_kg"] - whole["packaging_rub_per_kg"])
    products = _ordered_records(economics["products"], "product_id", PRODUCT_IDS)
    _ordered_records(yields["products"], "id", PRODUCT_IDS)
    routes = _ordered_records(yields["routes"], "id", ROUTE_IDS)
    econ_routes = _ordered_records(economics["routes"], "route_id", ROUTE_IDS)
    for product in products.values():
        # Обязательное поле с null отличается от потерянного столбца выгрузки.
        _number(product["bulk"]["price_rub_per_product_kg"], allow_none=True)
        _number(product["bulk"]["packaging_rub_per_product_kg"], allow_none=True)
    matching_sources = [row for row in economics["source_manifest"] if row["file"] == economics["primary_source"]]
    if len(matching_sources) != 1:
        raise ValueError("Первичный источник требует единственной версии")
    econ_hash = matching_sources[0]["sha256"]
    yield_hash = yields["sources"]["efficiency"]["sha256"]
    if any(not isinstance(h, str) or len(h) != 64 or any(c not in "0123456789abcdef" for c in h.lower()) for h in (econ_hash, yield_hash)) or econ_hash.lower() != yield_hash.lower():
        raise ValueError("Контрольные суммы первичного источника требуют согласования")
    for rid, route in routes.items():
        outputs = {}
        for row in route["outputs"]:
            product_id, fraction = row["product_id"], _number(row["yield_fraction"])
            if fraction > 1 or product_id not in products or product_id in outputs:
                raise ValueError("Выход продукта требует проверки")
            outputs[product_id] = fraction
        _same_number(math.fsum(outputs.values()), 1)
        saved = econ_routes[rid]["modes"]["bulk"]
        terms = _ordered_records(saved["terms"], "product_id", PRODUCT_IDS)
        for product_id, term in terms.items():
            fraction = _number(term["yield_fraction"])
            actual = outputs.get(product_id, 0)
            if (fraction > 0) != (actual > 0):
                raise ValueError("Положительные выходы требуют полного совпадения")
            _same_number(actual, fraction)
            product = products[product_id]["bulk"]
            _same_number(term["price_rub_per_kg"], product["price_rub_per_product_kg"])
            _same_number(term["packaging_rub_per_kg"], product["packaging_rub_per_product_kg"])
        calculated, completeness = _calculate(economics, route, 1)
        for stored_key, result_key in (
            ("revenue_rub_per_input_kg", "revenue"),
            ("packaging_rub_per_input_kg", "packaging"),
            ("revenue_after_packaging_rub_per_input_kg", "netRevenue"),
            ("added_result_rub_per_input_kg", "incrementalResult"),
        ):
            _same_number(saved[stored_key], calculated[result_key], tolerance=1e-6)
        if (saved["complete_product_price_coverage"] is not completeness["complete"] or
                saved["missing_valued_products"] != completeness["missingProducts"]):
            raise ValueError("Полнота оценки продуктов требует согласования")


def _catalog(economics, yields):
    # Внешний каталог содержит только разделку; годовой аудит хранится в локальном отчете.
    # Имена книг, контрольные суммы и пути в ответ не попадают; сверка выполнена при загрузке.
    selected = {key: deepcopy(economics[key]) for key in
                ("version", "purpose", "integration_contract", "whole_baseline", "products", "routes")
                if key in economics}
    selected_yields = {key: deepcopy(yields[key]) for key in
                       ("schema_version", "audited_at", "products", "routes", "gaps")
                       if key in yields}
    for route in selected_yields.get("routes", []):
        for output in route.get("outputs", []):
            output.pop("annual_duplicate", None)
    return {"economics": _sanitize(selected), "yields": _sanitize(selected_yields)}


def _calculate(economics, route, input_kg, price_change=0, packaging_change=0):
    products = {row["product_id"]: row for row in economics["products"]}
    revenue_terms, packaging_terms, missing = [], [], []
    price_multiplier, packaging_multiplier = 1 + price_change / 100, 1 + packaging_change / 100
    for output in route["outputs"]:
        product_id, fraction = output["product_id"], output["yield_fraction"]
        product = products[product_id]["bulk"]
        price, packaging = product["price_rub_per_product_kg"], product["packaging_rub_per_product_kg"]
        if fraction > 0 and product_id != "waste_loss" and (price is None or packaging is None):
            missing.append(product_id)
        # Повторяется арифметика сохраненного Excel; null остается видимым через completeness.
        revenue_terms.append(fraction * (price or 0) * price_multiplier)
        packaging_terms.append(fraction * (packaging or 0) * packaging_multiplier)
    revenue, packaging = math.fsum(revenue_terms), math.fsum(packaging_terms)
    whole = economics["whole_baseline"]
    whole_price, whole_packaging = whole["price_rub_per_kg"], whole["packaging_rub_per_kg"]
    net, whole_net = revenue - packaging, whole_price - whole_packaging
    per_kg = {"revenue": revenue, "packaging": packaging, "netRevenue": net,
              "wholePrice": whole_price, "wholePackaging": whole_packaging,
              "wholeNetRevenue": whole_net, "incrementalResult": net - whole_net}
    totals = {"revenue": revenue * input_kg, "packaging": packaging * input_kg,
              "netRevenue": net * input_kg, "wholeRevenue": whole_price * input_kg,
              "wholePackaging": whole_packaging * input_kg, "wholeNetRevenue": whole_net * input_kg,
              "incrementalResult": (net - whole_net) * input_kg, "rubPerKg": per_kg}
    complete = {"complete": len(missing) == 0, "missingProducts": missing,
                "status": "Цены и упаковка продуктов заполнены" if not missing else "Требуется подтверждение: цены и упаковка отдельных продуктов"}
    return totals, complete


@router.get("", response_model=EconomicsCatalog, response_model_exclude_unset=True)
def get_files_economics():
    economics, yields = _load()
    return _catalog(economics, yields)


@router.post("/evaluate")
def evaluate_files_economics(body: FilesEconomicsBody):
    economics, yields = _load()
    routes = {route["id"]: route for route in yields["routes"]}
    selected = routes[body.routeId]
    baseline, _ = _calculate(economics, selected, body.cutInputKg)
    scenario, completeness = _calculate(economics, selected, body.cutInputKg, body.priceChangePct, body.packagingChangePct)
    price_only, _ = _calculate(economics, selected, body.cutInputKg, body.priceChangePct, 0)
    packaging_only, _ = _calculate(economics, selected, body.cutInputKg, 0, body.packagingChangePct)
    effects = []
    for identifier, name, result in [("price", "Изменение цен разделки", price_only),
                                     ("packaging", "Изменение затрат упаковки", packaging_only),
                                     ("joint", "Совместное изменение", scenario)]:
        per_kg = result["rubPerKg"]["incrementalResult"] - baseline["rubPerKg"]["incrementalResult"]
        effects.append({"id": identifier, "name": name, "incrementalPerKg": per_kg, "incrementalResult": per_kg * body.cutInputKg})
    comparison = []
    for route in yields["routes"]:
        result, complete = _calculate(economics, route, body.cutInputKg, body.priceChangePct, body.packagingChangePct)
        comparison.append({"routeId": route["id"], "name": route["name"], "incrementalResult": result["incrementalResult"],
                           "rubPerKg": result["rubPerKg"], "completeness": complete})
    gaps = list(economics.get("integration_contract", {}).get("profit_requirements", []))
    if not completeness["complete"]:
        gaps.insert(0, "Сохраненный Excel оценивает пустые цены и упаковку как 0; сумма требует дополнения данных")
    return {"routeId": body.routeId, "inputKg": body.cutInputKg,
            "period": economics.get("integration_contract", {}).get("finance_period"),
            "resultLabel": "Добавочный результат после упаковки", "baseline": baseline, "scenario": scenario,
            "leverEffects": effects, "comparison": comparison, "completeness": completeness, "gaps": gaps}
