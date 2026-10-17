"""Чтение проверенного среза производственных затрат из локального пакета."""
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Response

from .schemas import Costs

router = APIRouter(prefix="/api/files/costs", tags=["Производственная себестоимость"])
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
RATES = ("rawCostRubKg", "processingCostRubKg", "packingRubKg", "productionCostRubKg", "logisticsRubKg")
ROW_FIELDS = ("period", "product_key", "name", "volumeKg", *RATES, "logisticsIncluded", "fullCostRubKg", "fullCostConfirmed", "coverage", "status", "issues", "fieldStatus", "stageBreakdown", "articleBreakdown", "sourceRefs")
META_FIELDS = ("schemaVersion", "method", "periods", "costBasis", "costBasisLabel", "taxBasis", "taxBasisStatus", "fullCostStatus", "logisticsStatus", "breakdownStatus", "stageCatalog", "articleCatalog", "issueLabels", "statusLabels")


def failure(status, message, kind):
    return HTTPException(status_code=status, detail=[{"loc": ["source"], "msg": message, "type": kind}])


def number(value, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Требуется конечное число")
    return float(value)


def equal(actual, expected):
    if not math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-7):
        raise ValueError("Сумма статей требует сверки")


def text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Требуется подпись источника")
    return value


def validate(data):
    if data["schemaVersion"] != 1 or data["method"] != "stage_allocation" or data["costBasis"] != "output_kg":
        raise ValueError("Требуется согласованная версия и база расчета")
    if data["taxBasis"] is not None:
        raise ValueError("Налоговая основа требует подтверждения")
    periods = data["periods"]
    if not isinstance(periods, list) or not periods or len(set(periods)) != len(periods) or any(not MONTH.fullmatch(x) for x in periods):
        raise ValueError("Месяцы требуют проверки")
    text(data["source"]["file"])
    if not re.fullmatch(r"[0-9a-fA-F]{64}", data["source"]["sha256"]):
        raise ValueError("Требуется контрольная сумма источника")
    for field in ("costBasisLabel", "taxBasisStatus", "fullCostStatus", "logisticsStatus", "breakdownStatus"):
        text(data[field])
    catalogs = {}
    for key in ("stageCatalog", "articleCatalog"):
        catalog = data[key]
        ids = [text(x["id"]) for x in catalog]
        if not ids or len(ids) != len(set(ids)):
            raise ValueError("Справочник содержит повторные статьи")
        for item in catalog:
            text(item["name"])
        catalogs[key] = ids
    if not isinstance(data["issueLabels"], dict) or not isinstance(data["statusLabels"], dict):
        raise ValueError("Требуются расшифровки статусов")
    rows = data["skuRows"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("Требуются строки продуктов")
    keys = set()
    for row in rows:
        for field in ROW_FIELDS:
            if field not in row:
                raise ValueError("Строка потеряла обязательное поле")
        key = (row["period"], text(row["product_key"]))
        if key in keys or row["period"] not in periods:
            raise ValueError("Ключ продукта и месяца требует проверки")
        keys.add(key)
        text(row["name"])
        if number(row["volumeKg"], True) is not None and row["volumeKg"] < 0:
            raise ValueError("Объем требует проверки")
        if row["logisticsIncluded"] is not False or row["fullCostConfirmed"] is not False or row["fullCostRubKg"] is not None:
            raise ValueError("Граница производственных затрат требует подтверждения")
        if row["status"] not in {"saved", "requires_data"} or row["coverage"] not in {"allocated_production", "partial"}:
            raise ValueError("Требуется явный статус полноты")
        if not isinstance(row["issues"], list) or any(issue not in data["issueLabels"] for issue in row["issues"]):
            raise ValueError("Требуется описание пробела данных")
        for field in RATES:
            value = number(row[field], True)
            status = row["fieldStatus"][field]
            if status not in data["statusLabels"]:
                raise ValueError("Требуется описание статуса числа")
            if value is None and status in {"saved", "zero"}:
                raise ValueError("Пустое значение ошибочно помечено сохраненным")
            if value is not None and status not in {"saved", "zero"}:
                raise ValueError("Значение и его статус расходятся")
            if status == "zero" and value != 0:
                raise ValueError("Сохраненный ноль требует нулевого значения")
        main = [row[field] for field in RATES[:3]]
        total = row["productionCostRubKg"]
        if total is not None:
            if any(value is None for value in main):
                raise ValueError("Итог требует всех трех составляющих")
            equal(total, math.fsum(main))
        if any(row[field] is None for field in RATES[:4]) and row["status"] != "requires_data":
            raise ValueError("Пробелы требуют видимого статуса")
        if row["issues"] and row["status"] != "requires_data":
            raise ValueError("Оговорки требуют видимого статуса")
        for field, catalog in (("stageBreakdown", "stageCatalog"), ("articleBreakdown", "articleCatalog")):
            breakdown = row[field]
            if not isinstance(breakdown, list) or [x["id"] for x in breakdown] != catalogs[catalog]:
                raise ValueError("Детализация потеряла статью или изменила порядок")
            values = [number(x["rubKg"], True) for x in breakdown]
            if all(value is not None for value in values) and row["processingCostRubKg"] is not None:
                equal(math.fsum(values), row["processingCostRubKg"])
            elif any(value is None for value in values) and "stage_details_missing" not in row["issues"]:
                raise ValueError("Пробел детализации требует оговорки")
        if set(row["sourceRefs"]) != {"register", "stages", "adjustments"}:
            raise ValueError("Требуются ссылки регистра, переделов и корректировок")
        for reference in row["sourceRefs"].values():
            text(reference)
    if data["quality"]["rowCount"] != len(rows):
        raise ValueError("Число строк требует сверки")
    if data["quality"]["partialRowCount"] != sum(row["status"] == "requires_data" for row in rows):
        raise ValueError("Число частичных строк требует сверки")


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items() if key not in {"path", "read_file", "absolute_path", "source_path"} and not key.endswith("_path")}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, str) and (value.startswith(("/", "file://")) or re.match(r"^[A-Za-z]:[\\/]", value)):
        return value.replace("\\", "/").rsplit("/", 1)[-1]
    return value


def selected_row(row):
    result = {field: row[field] for field in ROW_FIELDS if field != "sourceRefs"}
    result["fieldStatus"] = {key: row["fieldStatus"][key] for key in RATES}
    for field in ("stageBreakdown", "articleBreakdown"):
        result[field] = [{"id": item["id"], "rubKg": item["rubKg"]} for item in row[field]]
    return clean(result)


@lru_cache(maxsize=3)
def read_checked(path, mtime, size):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        validate(data)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
        raise failure(503, "Регистр производственных затрат требует проверки сумм, статусов и источников", "cost_source_invalid") from exc
    return data


def load_costs():
    directory = os.environ.get("SEVERNAYA_CLIENT_DATA_DIR")
    if not directory:
        raise failure(404, "Производственные затраты требуют подключения локального пакета данных", "cost_source_missing")
    path = Path(directory) / "next_stage_finance" / "full_costs_ui.json"
    try:
        stamp = path.stat()
    except OSError as exc:
        raise failure(404, "Производственные затраты требуют подключения локального пакета данных", "cost_source_missing") from exc
    return read_checked(str(path.resolve()), stamp.st_mtime_ns, stamp.st_size)


@router.get("", response_model=Costs, response_model_exclude_unset=True)
def costs(response: Response, month: str | None = None, product: str | None = None):
    if month is not None and not MONTH.fullmatch(month):
        raise failure(422, "Месяц указывается в формате ГГГГ-ММ", "cost_month_invalid")
    if product is not None and (not product.strip() or len(product) > 500):
        raise failure(422, "Выберите точное наименование продукта из регистра", "cost_product_invalid")
    data = load_costs()
    products = {}
    for row in data["skuRows"]:
        entry = products.setdefault(row["product_key"], {"key": row["product_key"], "name": row["name"], "periods": []})
        entry["periods"].append(row["period"])
    selected = None
    status = "choose_product"
    if product is not None:
        if product not in products:
            status = "product_requires_mapping"
        else:
            chosen_month = month or max(products[product]["periods"])
            selected = next((row for row in data["skuRows"] if row["product_key"] == product and row["period"] == chosen_month), None)
            status = "selected" if selected is not None else "period_requires_data"
    result = {field: clean(data[field]) for field in META_FIELDS}
    for field in ("stageCatalog", "articleCatalog"):
        result[field] = [{"id": item["id"], "name": item["name"]} for item in data[field]]
    result.update({"products": sorted(products.values(), key=lambda item: item["name"]),
                   "counts": {"products": len(products), "records": len(data["skuRows"]), "partialRecords": data["quality"]["partialRowCount"]},
                   "selectionStatus": status, "selected": selected_row(selected) if selected else None})
    response.headers["Cache-Control"] = "private, no-store"
    return result
