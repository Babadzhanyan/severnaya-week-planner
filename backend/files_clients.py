"""Локальный каталог двух клиентских отчетов с раздельными итогами."""
from functools import lru_cache
import gzip
import json
import math
import random
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from . import input_paths
from .public_mode import refuse_in_public_mode
from .schemas import ClientDetails, ClientsCatalog

router = APIRouter(prefix="/api/files/clients", tags=["Клиентские данные исходных файлов"], dependencies=[Depends(refuse_in_public_mode)])
DATASETS = ("clients", "deals")
MONEY = ("volumeKg", "revenueRub", "reportedCostRub", "reportedLogisticsRub", "reconciliationRub", "marginRub")
NULLABLE = ("fullCostRubKg", "discountRub", "logisticsRub", "marketCeilingRubKg")
FINANCIAL = set(MONEY) | set(NULLABLE) | {
    "rowCount", "priceRubKg", "reportedCostRubKg", "reportedTotalCostRub", "marginRubKg",
    "fullCostRub", "logisticsCoverage", "reportedCostCoverage", "allocationCoverage",
    "quantityAdjustmentKg", "revenueAdjustmentRub", "reportedRawCostRub",
    "reportedProcessingCostRub", "reportedPackagingCostRub", "knownAllocatedProductionCostRub",
    "allocatedProductionCostRub",
    "observedMinPriceRubKg", "observedMaxPriceRubKg", "observedPriceBasis", "priceObservationCount",
    "priceExcludedRowCount", "months", "status",
}
PRODUCT = FINANCIAL | {"id", "name", "productKey", "costProductKey", "sourceSkuName", "state", "period", "marginBasis"}
# Исходный id и название клиента в перечень ответа не входят: клиент адресуется псевдонимом.
CLIENT = FINANCIAL | {"channels", "deliveryZones", "retailChains", "marginBasis"}
MONTHLY = set(MONEY) | set(NULLABLE) | {
    "period", "productKey", "costProductKey",
    "rowCount", "priceRubKg", "marginRubKg", "reportedTotalCostRub",
    "reportedRawCostRub", "reportedProcessingCostRub", "reportedPackagingCostRub",
    "allocatedProductionCostRub", "knownAllocatedProductionCostRub", "allocationCoverage",
    "logisticsCoverage", "reportedCostCoverage", "observedMinPriceRubKg",
    "observedMaxPriceRubKg", "priceObservationCount", "priceExcludedRowCount",
}



def _error(status, message, kind):
    return HTTPException(status_code=status, detail=[{"loc": ["source"], "msg": message, "type": kind}])


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _same(actual, expected):
    if not _finite(actual) or not math.isclose(actual, expected, rel_tol=0, abs_tol=.002):
        raise ValueError("Сумма требует сверки с источником")


def _validate_record(record):
    if not isinstance(record, dict):
        raise ValueError("Запись требует словаря полей")
    for key in MONEY:
        if not _finite(record[key]):
            raise ValueError("Денежное значение требует конечного числа")
    for key in NULLABLE:
        value = record[key]
        if value is not None and not _finite(value):
            raise ValueError("Пробел требует явного пустого значения")
    _same(record["reconciliationRub"], record["revenueRub"] - record["reportedCostRub"] - record["reportedLogisticsRub"] - record["marginRub"])
    if record.get("priceRubKg") is not None:
        if record["volumeKg"] <= 0:
            raise ValueError("Средняя цена требует положительного объема")
        _same(record["priceRubKg"], record["revenueRub"] / record["volumeKg"])
    if record.get("marginRubKg") is not None:
        if record["volumeKg"] <= 0:
            raise ValueError("Маржа на кг требует положительного объема")
        _same(record["marginRubKg"], record["marginRub"] / record["volumeKg"])
    if record.get("reportedCostRubKg") is not None:
        if record["volumeKg"] <= 0:
            raise ValueError("Затраты на кг требуют положительного объема")
        _same(record["reportedCostRubKg"], record["reportedCostRub"] / record["volumeKg"])
    if record.get("observedMinPriceRubKg") is not None and record.get("observedMaxPriceRubKg") is not None:
        if not 0 <= record["observedMinPriceRubKg"] <= record["observedMaxPriceRubKg"]:
            raise ValueError("Диапазон исторических цен требует сверки")


def _sum_matches(total, parts):
    for key in MONEY:
        _same(total[key], math.fsum(part[key] for part in parts))


def _check_finite_tree(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Числовое поле требует конечного значения")
    if isinstance(value, dict):
        for item in value.values():
            _check_finite_tree(item)
    elif isinstance(value, list):
        for item in value:
            _check_finite_tree(item)


def _validate(catalog):
    _check_finite_tree(catalog)
    if catalog["schemaVersion"] != 1 or [d["id"] for d in catalog["datasets"]] != list(DATASETS):
        raise ValueError("Каталог требует двух согласованных наборов")
    for ds in catalog["datasets"]:
        clients = ds["clients"]
        if len({c["id"] for c in clients}) != len(clients) or ds["summary"]["clientCount"] != len(clients):
            raise ValueError("Справочник клиентов требует уникальных ключей")
        _validate_record(ds["summary"])
        _sum_matches(ds["summary"], clients)
        for c in clients:
            if not isinstance(c["name"], str) or not c["name"].strip():
                raise ValueError("Клиент требует исходного названия")
            _validate_record(c)
            products = c["products"]
            if len({p["id"] for p in products}) != len(products):
                raise ValueError("Продукты клиента требуют уникальных ключей")
            _sum_matches(c, products)
            for p in products:
                _validate_record(p)
                # Исходный код продукта переносится целиком либо остается null.
                if p["productKey"] != p["costProductKey"] or p["sourceSkuName"] != p["costProductKey"]:
                    raise ValueError("Связь с себестоимостью требует точного кода источника")
                monthly = p["monthly"]
                if len({m["period"] for m in monthly}) != len(monthly) or sorted(m["period"] for m in monthly) != sorted(p["months"]):
                    raise ValueError("Помесячная детализация требует уникальных периодов")
                _sum_matches(p, monthly)
                for month in monthly:
                    _validate_record(month)
                    if month["costProductKey"] != p["costProductKey"]:
                        raise ValueError("Месяц требует того же кода продукта")


def _safe(value):
    """Выдает только экономику и деловые названия, сохраняет координаты ячеек."""
    if isinstance(value, dict):
        return {key: _safe(item) for key, item in value.items()
                if key not in {"path", "source_path", "absolute_path", "manager", "managers", "managerCount", "manager_name", "email", "phone", "contact", "contacts"}
                and not key.endswith("_path")}
    if isinstance(value, list):
        return [_safe(item) for item in value]
    if isinstance(value, str) and (value.startswith("/") or value.startswith("file://")):
        return value.replace("\\", "/").rsplit("/", 1)[-1]
    return value


def _pick(record, fields):
    return _safe({key: value for key, value in record.items() if key in fields})


_ALIASES = {}  # {набор: (каталог, {id клиента: псевдоним}, {псевдоним: id клиента})}; только в памяти процесса
_ALIAS_LOCK = threading.Lock()


def _alias_maps(catalog, dataset):
    # Номера 1..N переставляются случайно и действуют, пока не изменен файл каталога.
    # Таблица не пишется на диск и в ответах не возвращается.
    # ponytail: при смене каталога таблица строится заново; путь улучшения – хранить таблицу на весь срок процесса.
    with _ALIAS_LOCK:
        cached = _ALIASES.get(dataset)
        if cached is None or cached[0] is not catalog:
            clients = _selected(catalog, dataset)["clients"]
            numbers = list(range(1, len(clients) + 1))
            random.SystemRandom().shuffle(numbers)
            forward = {c["id"]: f"К-{number:03d}" for c, number in zip(clients, numbers)}
            cached = _ALIASES[dataset] = (catalog, forward, {alias: key for key, alias in forward.items()})
    return cached[1], cached[2]


def _client(record, detailed=False):
    result = _pick(record, CLIENT)
    result["products"] = []
    for p in record["products"]:
        product = _pick(p, PRODUCT)
        if detailed:
            product["monthly"] = [_pick(m, MONTHLY) for m in p["monthly"]]
        result["products"].append(product)
    return result


@lru_cache(maxsize=2)
def _read_catalog(path, mtime_ns, size):
    try:
        source = Path(path)
        raw = gzip.decompress(source.read_bytes()) if source.suffix == ".gz" else source.read_bytes()
        catalog = json.loads(raw)
        _validate(catalog)
        return catalog
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError) as exc:
        raise _error(503, "Клиентский каталог требует сверки структуры, сумм и исходных строк", "client_source_invalid") from exc


def _load():
    directory = input_paths.client_root()
    if directory is None:
        raise _error(404, "Для просмотра клиентов требуется подключенный локальный каталог", "client_source_missing")
    path = input_paths.clients(directory)
    try:
        stat = path.stat()
    except OSError as exc:
        raise _error(404, "Для просмотра клиентов требуется подключенный локальный каталог", "client_source_missing") from exc
    return _read_catalog(str(path.resolve()), stat.st_mtime_ns, stat.st_size)


def _selected(catalog, dataset):
    return next(ds for ds in catalog["datasets"] if ds["id"] == dataset)


@router.get("", response_model=ClientsCatalog, response_model_exclude_unset=True)
def clients_catalog(dataset: Literal["clients", "deals"] = Query(default="clients")):
    catalog = _load()
    selected = _selected(catalog, dataset)
    aliases, _ = _alias_maps(catalog, dataset)
    return {
        "datasetId": dataset, "period": catalog["period"], "units": catalog.get("units", {}),
        "datasets": [{"id": ds["id"], "label": ds["label"], **{key: ds["summary"][key] for key in ("clientCount", "sourceNameCount", "rowCount", "volumeKg", "revenueRub")}} for ds in catalog["datasets"]],
        "summary": _pick(selected["summary"], FINANCIAL | {"clientCount", "sourceNameCount", "productCount", "channelCount", "deliveryZoneCount"}),
        "clients": [{**_pick(c, CLIENT), "pseudonym": aliases[c["id"]], "productCount": len(c["products"])} for c in selected["clients"]],
        "quality": _safe(selected["quality"]), "gaps": _safe(catalog["gaps"]),
        "sources": [_pick(s, {"role", "period", "vat"}) for s in catalog["sources"]],
        "scopeNote": "Два отчета имеют пересекающийся охват; каждый итог относится к выбранному отчету",
        "detailsPath": "/api/files/clients/{pseudonym}?dataset=" + dataset,
    }


@router.get("/{pseudonym}", response_model=ClientDetails, response_model_exclude_unset=True)
def client_details(pseudonym: str, dataset: Literal["clients", "deals"] = Query(default="clients")):
    catalog = _load()
    selected = _selected(catalog, dataset)
    _, reverse = _alias_maps(catalog, dataset)
    if pseudonym not in reverse:
        raise _error(404, "Клиент требует выбора из текущего отчета", "client_missing")
    client = next(c for c in selected["clients"] if c["id"] == reverse[pseudonym])
    return {"datasetId": dataset, "period": catalog["period"], "client": {**_client(client, detailed=True), "pseudonym": pseudonym}, "gaps": _safe(catalog["gaps"])}
