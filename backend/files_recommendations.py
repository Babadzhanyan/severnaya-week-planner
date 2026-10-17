"""Ценовые сигналы истории с точными ключами клиентского каталога."""
from functools import lru_cache
import json
import math
from pathlib import Path
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from . import input_paths
from .files_clients import _alias_maps, _load as _load_clients
from .public_mode import refuse_in_public_mode
from .schemas import Recommendations

router = APIRouter(prefix="/api/files/recommendations", tags=["Ценовые сигналы исходных файлов"], dependencies=[Depends(refuse_in_public_mode)])
THRESHOLDS = {"focalMinKg": 1000, "peerMinKg": 10000, "peerMinClients": 2, "gapMinShare": .1}
LABEL = "Гипотеза исторического периода"


def _error(status, message):
    return HTTPException(status_code=status, detail=message)


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_signal(signal, product, client_id, source_rows):
    numbers = ("priceRubKg", "referencePriceRubKg", "observedPeerMinRubKg", "observedPeerMaxRubKg",
               "peerVolumeKg", "focalVolumeKg", "scenarioRub")
    if any(not _number(signal[k]) or signal[k] < 0 for k in numbers):
        raise ValueError("Значения сигнала требуют конечных положительных чисел")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", signal["period"]) or signal["period"] not in product["months"]:
        raise ValueError("Период сигнала требует месяца выбранного продукта")
    peers = signal["peerClients"]
    if not isinstance(peers, int) or isinstance(peers, bool) or peers < THRESHOLDS["peerMinClients"]:
        raise ValueError("Сигнал требует достаточного числа других клиентов")
    reference = signal["referencePriceRubKg"]
    if (reference <= 0 or signal["focalVolumeKg"] < THRESHOLDS["focalMinKg"]
            or signal["peerVolumeKg"] < THRESHOLDS["peerMinKg"]
            or 1-signal["priceRubKg"]/reference <= THRESHOLDS["gapMinShare"]
            or not signal["observedPeerMinRubKg"] <= reference <= signal["observedPeerMaxRubKg"]):
        raise ValueError("Сигнал требует соблюдения порогов исходного расчета")
    if not math.isclose(signal["scenarioRub"], (reference-signal["priceRubKg"])*signal["focalVolumeKg"], rel_tol=1e-10, abs_tol=.01):
        raise ValueError("Сценарий требует сверки цены и объема")
    rows = [signal["sourceRow"], *signal["peerSourceRows"]]
    if any(not isinstance(row, int) or isinstance(row, bool) or row < 2 for row in rows) or signal["sourceRow"] in signal["peerSourceRows"]:
        raise ValueError("Сигнал требует отдельных исходных строк клиента и группы")
    if len(set(signal["peerSourceRows"])) != len(signal["peerSourceRows"]):
        raise ValueError("Строки группы требуют уникальных адресов")
    owner = (client_id, product["id"], signal["period"])
    if source_rows.get(signal["sourceRow"]) != owner:
        raise ValueError("Строка сигнала требует выбранного клиента, продукта и месяца")
    peer_clients = set()
    for row in signal["peerSourceRows"]:
        peer = source_rows.get(row)
        if peer is None or peer[0] == client_id or peer[1:] != owner[1:]:
            raise ValueError("Строки сравнения требуют других клиентов того же продукта и месяца")
        peer_clients.add(peer[0])
    if len(peer_clients) != signal["peerClients"]:
        raise ValueError("Число клиентов сравнения требует сверки с исходными строками")


def _validate(data, catalog):
    if data["schemaVersion"] != 1 or [d["id"] for d in data["datasets"]] != ["clients", "deals"]:
        raise ValueError("Сигналы требуют двух исходных контуров")
    if data["sourceWorkbookSha256"] not in {s.get("sha256") for s in catalog["sources"]}:
        raise ValueError("Сигналы требуют исходной книги клиентского каталога")
    for dataset in data["datasets"]:
        original = next(d for d in catalog["datasets"] if d["id"] == dataset["id"])
        clients = {c["id"]: c for c in original["clients"]}
        if len(dataset["clients"]) != len(clients) or {c["clientId"] for c in dataset["clients"]} != set(clients):
            raise ValueError("Сигналы требуют точного состава клиентов")
        source_rows = {}
        for original_client in original["clients"]:
            for product in original_client["products"]:
                for month in product["monthly"]:
                    owner = (original_client["id"], product["id"], month["period"])
                    for reference in month["sourceRefs"]:
                        for row in reference["rows"]:
                            if row in source_rows and source_rows[row] != owner:
                                raise ValueError("Исходная строка требует единственного клиента, продукта и месяца")
                            source_rows[row] = owner
        count = 0
        seen = set()
        for client in dataset["clients"]:
            if type(client["priorityGroup"]) is not int or client["priorityGroup"] not in {1, 2, 3, 4}:
                raise ValueError("Приоритет требует группы от 1 до 4")
            if not isinstance(client["action"], str) or not client["action"].strip():
                raise ValueError("Клиент требует явного действия")
            if not isinstance(client["requirements"], list) or any(
                    key not in data["requirements"] or not isinstance(data["requirements"][key], str)
                    or not data["requirements"][key].strip() for key in client["requirements"]):
                raise ValueError("Требования клиента используют согласованный справочник")
            products = {p["id"]: p for p in clients[client["clientId"]]["products"]}
            if len(client["products"]) != len(products) or {p["productId"] for p in client["products"]} != set(products):
                raise ValueError("Сигналы требуют точного состава продуктов клиента")
            for product in client["products"]:
                original_product = products[product["productId"]]
                if product["costProductKey"] != original_product["costProductKey"]:
                    raise ValueError("Сигнал требует точного кода продукта")
                for signal in product["historicalSignals"]:
                    _validate_signal(signal, original_product, client["clientId"], source_rows)
                    key = (signal["period"], signal["sourceRow"])
                    if key in seen:
                        raise ValueError("Сигналы требуют уникальных исходных строк")
                    seen.add(key)
                    count += 1
            historical = math.fsum(signal["scenarioRub"] for product in client["products"] for signal in product["historicalSignals"])
            amount = client["historicalReviewRub"]
            if historical > 0:
                if not _number(amount) or not math.isclose(amount, historical, rel_tol=1e-10, abs_tol=.01):
                    raise ValueError("Историческая оценка клиента требует сверки с сигналами")
            elif amount is not None:
                raise ValueError("Клиент с пустым набором сигналов сохраняет null")
        if count != dataset["historicalSignalRows"]:
            raise ValueError("Число сигналов требует сверки")


@lru_cache(maxsize=2)
def _read(path, mtime_ns, size):
    return json.loads(Path(path).read_text())


def _load():
    directory = input_paths.client_root()
    if directory is None:
        raise _error(404, "Ценовые сигналы требуют подключенного локального расчета")
    path = input_paths.recommendations(directory)
    try:
        stat = path.stat()
    except OSError as exc:
        raise _error(404, "Ценовые сигналы требуют подключенного локального расчета") from exc
    try:
        data = _read(str(path.resolve()), stat.st_mtime_ns, stat.st_size)
        _validate(data, _load_clients())
        return data
    except (OSError, ValueError, KeyError, TypeError, AttributeError, StopIteration, OverflowError) as exc:
        raise _error(503, "Ценовые сигналы требуют сверки ключей, периодов и формул") from exc


@router.get("", response_model=Recommendations, response_model_exclude_unset=True)
def recommendations(dataset: Literal["clients", "deals"] = Query(default="clients"),
                    pseudonym: str = Query(min_length=1, max_length=20, pattern=r"^К-\d{3,}$"),
                    productId: str | None = Query(default=None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")):
    data = _load()
    selected = next(d for d in data["datasets"] if d["id"] == dataset)
    _, reverse = _alias_maps(_load_clients(), dataset)
    client_id = reverse.get(pseudonym)
    client = next((c for c in selected["clients"] if client_id is not None and c["clientId"] == client_id), None)
    if client is None:
        raise _error(404, "Ценовой сигнал требует клиента выбранного отчета")
    matching = [p for p in client["products"] if productId is None or p["productId"] == productId]
    if productId is not None and not matching:
        raise _error(404, "Ценовой сигнал требует продукта выбранного клиента")
    products = []
    for product in matching:
        signals = []
        for raw in product["historicalSignals"]:
            signal = {key: raw[key] for key in ("period", "channel", "sourceRow", "priceRubKg", "referencePriceRubKg", "observedPeerMinRubKg", "observedPeerMaxRubKg", "peerClients", "peerVolumeKg", "focalVolumeKg", "scenarioRub", "status")}
            signal["priceGapRubKg"] = signal["referencePriceRubKg"] - signal["priceRubKg"]
            signal["gapShare"] = signal["priceGapRubKg"] / signal["referencePriceRubKg"]
            signals.append(signal)
        signals.sort(key=lambda s: (-s["scenarioRub"], s["period"], s["sourceRow"]))
        if signals or productId is not None:
            products.append({"productId": product["productId"], "costProductKey": product["costProductKey"], "signalCount": len(signals),
                             "bestSignal": signals[0] if signals else None, "signals": signals,
                             "requirements": [data["requirements"][key] for key in product["requirements"]]})
    return {"datasetId": dataset, "productId": productId, "label": LABEL,
            "action": client["action"], "priorityGroup": client["priorityGroup"],
            "historicalReviewRub": client["historicalReviewRub"],
            "historicalReviewBasis": "Сумма исторических сигналов выбранного клиента по всем продуктам и месяцам отчета",
            "requirements": [data["requirements"][key] for key in client["requirements"]],
            "signalCount": sum(p["signalCount"] for p in products), "products": products,
            "thresholds": THRESHOLDS, "priceMethod": data["priceMethod"], "boundsBasis": data["boundsBasis"],
            "scopeNote": "Каждый сигнал относится к своему месяцу и объему; денежный сценарий учитывается отдельно от других оценок",
            "marketCeilingRubKg": None, "confirmedProfitRub": None}
