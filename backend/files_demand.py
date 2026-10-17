"""Помесячная история продукции и проверка условий спроса отдела продаж."""
import calendar
import hashlib
import json
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .files_clients import _load as load_clients, _alias_maps
from .files_costs import load_costs
from .public_mode import refuse_in_public_mode
from .schemas import DemandCatalog, DemandDetails, DemandEvaluation

router = APIRouter(prefix="/api/files/demand", tags=["Спрос по продукции предприятия"])
MONTH_PATTERN = r"^[1-9]\d{3}-(0[1-9]|1[0-2])$"
REFERENCE = "Равномерное распределение сохраненного объема месяца по календарным дням"
GAPS = ["История продаж служит ориентиром; текущие заказы подтверждает отдел продаж",
        "Потребность отдельного продукта требует проверки совместного выхода и мощности переделов",
        "Полная себестоимость, налоговая сопоставимость и коммерческие условия требуют подтверждения"]
_cached_source = None
_cached_index = None


class DemandBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    dataset: Literal["clients", "deals"] = "clients"
    productId: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    month: str = Field(pattern=MONTH_PATTERN)
    days: int = Field(default=7, ge=1, le=366)
    plannedDemandKg: float = Field(ge=0, le=1_000_000_000)
    ordersKg: float | None = Field(default=None, ge=0, le=1_000_000_000)
    inventoryKg: float | None = Field(default=None, ge=0, le=1_000_000_000)
    safetyKg: float | None = Field(default=None, ge=0, le=1_000_000_000)
    priceRubKg: float | None = Field(default=None, ge=0, le=1_000_000)
    discountPct: float | None = Field(default=None, ge=0, le=100)
    logisticsRubKg: float | None = Field(default=None, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def check_orders(self):
        if self.ordersKg is not None and self.plannedDemandKg < self.ordersKg:
            raise ValueError("Общий спрос должен покрывать подтвержденные заказы")
        return self


def _missing(message):
    return HTTPException(status_code=404, detail=message)


def _days(month):
    return calendar.monthrange(*map(int, month.split("-")))[1]


def _months(start, end):
    year, month = map(int, start.split("-"))
    result = []
    while f"{year:04d}-{month:02d}" <= end:
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return result


def _identity(product):
    key = product["costProductKey"]
    return ("exact", key) if key is not None else ("source", product["name"], product.get("state"), product["id"])


def _index(catalog):
    global _cached_source, _cached_index
    if catalog is _cached_source:
        return _cached_index
    result = {}
    for dataset in catalog["datasets"]:
        products = {}
        for client in dataset["clients"]:
            for product in client["products"]:
                identity = _identity(product)
                identifier = "demand_" + hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[:20]
                entry = products.setdefault(identifier, {"id": identifier,
                    "name": product["costProductKey"] or product["name"], "costProductKey": product["costProductKey"],
                    "identityBasis": "exact_cost_product_key" if product["costProductKey"] is not None else "exact_source_name_and_id", "records": {}})
                for row in product["monthly"]:
                    entry["records"].setdefault(row["period"], []).append((client, product, row))
        result[dataset["id"]] = products
    _cached_source, _cached_index = catalog, result
    return result


def _totals(records):
    rows = [r for _, _, r in records]
    amount = lambda field: math.fsum(row[field] for row in rows)
    volume, revenue, cost, margin = (amount(k) for k in ("volumeKg", "revenueRub", "reportedCostRub", "marginRub"))
    coverage = all(row.get("reportedCostCoverage", {}).get("knownRowCount") == row.get("rowCount") for row in rows)
    return {"volumeKg": volume, "revenueRub": revenue, "reportedCostRub": cost, "reportedMarginRub": margin,
            "priceRubKg": revenue / volume if volume > 0 else None,
            "reportedCostRubKg": cost / volume if volume > 0 and coverage else None,
            "reportedMarginRubKg": margin / volume if volume > 0 else None,
            "reportedCostStatus": "saved" if coverage else "partial", "clientCount": len({c["id"] for c, _, _ in records}),
            "rowCount": sum(r.get("rowCount", 0) for r in rows)}


def _cost_catalog():
    try:
        return load_costs()
    except HTTPException as error:
        if error.status_code == 404:
            return None
        raise


def _cost(entry, month, catalog):
    key = entry["costProductKey"]
    result = {"status": "product_requires_mapping" if key is None else "period_requires_data",
              "productionCostRubKg": None, "fullCostRubKg": None, "method": "stage_allocation",
              "costBasis": "output_kg", "taxBasis": None, "month": month, "period": month,
              "rawCostRubKg": None, "processingCostRubKg": None, "packingRubKg": None,
              "fieldStatus": {field: "requires_data" for field in ("rawCostRubKg", "processingCostRubKg", "packingRubKg", "productionCostRubKg")}, "issues": [],
              "costProductKey": key}
    row = next((r for r in (catalog or {}).get("skuRows", []) if key is not None and r["product_key"] == key and r["period"] == month), None)
    if row:
        complete = row["coverage"] == "allocated_production" and row["status"] == "saved" and not row["issues"]
        result.update(status="saved" if complete else "partial", productionCostRubKg=row["productionCostRubKg"] if complete else None)
        result["issues"] = list(row["issues"])
        for field in ("rawCostRubKg", "processingCostRubKg", "packingRubKg"):
            status = row["fieldStatus"][field]
            confirmed = status in {"saved", "zero"} and not (field == "rawCostRubKg" and "raw_cost_requires_confirmation" in row["issues"])
            result[field] = row[field] if confirmed else None
            result["fieldStatus"][field] = status if confirmed else "requires_data"
        result["fieldStatus"]["productionCostRubKg"] = row["fieldStatus"]["productionCostRubKg"] if complete else "requires_data"
    return result


def _entry(entry, month, days, costs):
    records = entry["records"].get(month, [])
    totals, cost = _totals(records), _cost(entry, month, costs)
    volume = totals["volumeKg"]
    return {**{key: entry[key] for key in ("id", "name", "costProductKey", "identityBasis")}, **totals,
            "month": month, "historyDays": _days(month), "days": days,
            "suggestedDemandKg": volume / _days(month) * days if volume >= 0 else None,
            "ordersKg": None, "costProductionRubKg": cost["productionCostRubKg"], "costStatus": cost["status"],
            "status": "historical_reference" if volume > 0 else "requires_positive_volume"}


def _context(dataset, month):
    catalog = load_clients()
    months = _months(catalog["period"]["start"], catalog["period"]["end"])
    if month not in months:
        raise _missing("Выбранный месяц требует данных клиентского отчета")
    return catalog, _index(catalog)[dataset], months


def _find(products, identifier, month):
    entry = products.get(identifier)
    if entry is None or month not in entry["records"]:
        raise _missing("Продукт требует выбора из продукции выбранного месяца")
    return entry


@router.get("", response_model=DemandCatalog, response_model_exclude_unset=True)
def demand_catalog(dataset: Literal["clients", "deals"] = "clients", month: str = Query(default="2026-03", pattern=MONTH_PATTERN), days: int = Query(default=7, ge=1, le=366)):
    catalog, products, months = _context(dataset, month)
    costs = _cost_catalog()
    rows = [_entry(entry, month, days, costs) for entry in products.values() if month in entry["records"]]
    rows.sort(key=lambda row: (-row["volumeKg"], row["name"]))
    return {"datasetId": dataset, "month": month, "days": days, "months": months, "historyDays": _days(month),
            "referenceMethod": REFERENCE, "products": rows,
            "summary": {"productCount": len(rows), "volumeKg": math.fsum(row["volumeKg"] for row in rows), "revenueRub": math.fsum(row["revenueRub"] for row in rows)},
            "datasets": [{"id": ds["id"], "label": ds["label"]} for ds in catalog["datasets"]],
            "scopeNote": "Выбранный отчет образует отдельный набор; охват двух отчетов пересекается", "gaps": GAPS}


# Детализация содержит список клиентов (поле clients): в публичном режиме отключена.
@router.get("/{product_id}", response_model=DemandDetails, response_model_exclude_unset=True, dependencies=[Depends(refuse_in_public_mode)])
def demand_details(product_id: str, dataset: Literal["clients", "deals"] = "clients", month: str = Query(default="2026-03", pattern=MONTH_PATTERN), days: int = Query(default=7, ge=1, le=366)):
    catalog, products, months = _context(dataset, month)
    entry, costs = _find(products, product_id, month), _cost_catalog()
    aliases, _ = _alias_maps(catalog, dataset)
    groups = {}
    for record in entry["records"][month]:
        groups.setdefault(record[0]["id"], []).append(record)
    clients = [{"pseudonym": aliases[key], **_totals(records)} for key, records in groups.items()]
    clients.sort(key=lambda row: -row["volumeKg"])
    history = [{"month": period, "historyDays": _days(period), "observed": period in entry["records"],
                **_totals(entry["records"].get(period, []))} for period in months]
    return {"datasetId": dataset, "month": month, "days": days, "referenceMethod": REFERENCE,
            "product": _entry(entry, month, days, costs), "clients": clients, "history": history, "cost": _cost(entry, month, costs), "gaps": GAPS}


@router.post("/evaluate", response_model=DemandEvaluation, response_model_exclude_unset=True)
def evaluate_demand(body: DemandBody):
    _, products, _ = _context(body.dataset, body.month)
    entry, costs = _find(products, body.productId, body.month), _cost_catalog()
    product = _entry(entry, body.month, body.days, costs)
    quantity, price, discount = body.plannedDemandKg, body.priceRubKg, body.discountPct
    historic = product["priceRubKg"]
    net = price * (1 - discount / 100) if price is not None and discount is not None else None
    revenue = quantity * net if net is not None else None
    gross = quantity * price if price is not None else None
    reference = quantity * historic if historic is not None else None
    logistics = quantity * body.logisticsRubKg if body.logisticsRubKg is not None else None
    production = max(0, quantity + body.safetyKg - body.inventoryKg) if body.safetyKg is not None and body.inventoryKg is not None else None
    completeness = {"ordersKnown": body.ordersKg is not None, "stockKnown": body.inventoryKg is not None,
                    "safetyKnown": body.safetyKg is not None, "priceKnown": price is not None,
                    "discountKnown": discount is not None, "logisticsKnown": body.logisticsRubKg is not None}
    missing = [label for key, label in (("ordersKnown", "Подтвердить заказы"), ("stockKnown", "Указать доступный запас"),
               ("safetyKnown", "Указать целевой остаток"), ("priceKnown", "Указать цену"), ("discountKnown", "Указать скидку"),
               ("logisticsKnown", "Указать дополнительную логистику сценария")) if not completeness[key]]
    waterfall = [] if revenue is None else [{"name": "До доп. скидки", "value": gross, "total": True},
                 {"name": "Дополнительная скидка", "value": revenue - gross}, {"name": "Выручка", "value": revenue, "total": True}]
    return {"datasetId": body.dataset, "product": product, "inputs": body.model_dump(),
            "reference": {"method": REFERENCE, "priceRubKg": historic, "sameQuantityKg": quantity, "sameQuantityRevenueRub": reference, "suggestedDemandKg": product["suggestedDemandKg"]},
            "scenario": {"productionNeedKg": production, "grossRevenueRub": gross, "revenueRub": revenue, "netPriceRubKg": net,
                         "priceChangeRubKg": net - historic if net is not None and historic is not None else None,
                         "deltaRevenueRub": revenue - reference if revenue is not None and reference is not None else None,
                         "purePriceEffectRub": quantity * (price - historic) if price is not None and historic is not None else None,
                         "discountEffectRub": revenue - gross if revenue is not None else None,
                         "additionalLogisticsRub": logistics, "revenueAfterAdditionalLogisticsRub": revenue - logistics if revenue is not None and logistics is not None else None,
                         "fullMarginRub": None, "capacityFeasible": None},
            "cost": _cost(entry, body.month, costs), "waterfall": waterfall,
            "completeness": {**completeness, "inputsComplete": all(completeness.values()), "missing": missing}, "gaps": [*missing, *GAPS]}
