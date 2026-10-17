"""Загрузчик недели из обезличенной выгрузки агрегатов по контракту v4 (версия схемы 1).

Файл week_config.json содержит только агрегаты. Поля вне контракта отклоняются целиком,
поэтому ответ собирается только из проверенных полей и не содержит строк клиентов или людей.
Служебные поля контракта (версия, статусы, конфликты) принимаются и в ответ не попадают.
"""
import json
import math
import os
from pathlib import Path

from . import model

SCHEMA_VERSION = 1
SOURCE_KIND = "aggregates"
FILE_NAME = "week_config.json"
ENV_NAME = "SEVERNAYA_ANON_EXPORT_DIR"
DEFAULT_DIR = Path(__file__).resolve().parent / "contract"
PRODUCT_CODES = tuple(model.CATALOG["products"])
ROUTE_CODES = tuple(model.CATALOG["routes"])
# Известные ключи мощностей контракта. Расчет использует только обвалку, остальные ключи принимаются и проверяются.
STAGE_CODES = ("deboning", "packing", "packingLegs", "liver", "evisceration", "freezing")
WEEK_KEYS = {"schemaVersion", "source", "period", "scaleWeekKg", "rawCostRubKg", "products", "routes", "freezeCostRubKg", "capacityTDay"}
WEEK_OUT_KEYS = WEEK_KEYS | {"capacityWeekT"}
# Служебные поля контракта: принимаются при проверке, в объект недели для расчета и в ответ не попадают.
SERVICE_KEYS = {"contractVersion", "previousVersionFile", "workingDaysPerWeek", "workingDaysPerWeekStatus", "revenueBaseRub", "freezeCostRubKgStatus", "conflicts"}
INPUT_KEYS = WEEK_OUT_KEYS | {"sources"}
# Блоки заказов и денежных фактов затрат необязательны, при наличии проверяются целиком и отдаются на верхнем уровне ответа.
BLOCK_KEYS = ("orders", "costFacts")
ORDER_KEYS = ("productId", "period", "status", "qtyKg", "priceRubKg", "channel", "source")
# Статусы заказов: confirmed (подтвержден), forecast (прогноз), history (история). Другие значения отклоняются.
ORDER_STATUSES = ("confirmed", "forecast", "history")
# Денежные факты затрат заданы для филе (fillet) и бескостного бедра (legMeat).
COST_FACT_PRODUCTS = ("fillet", "legMeat")
COST_FACT_KEYS = ("costRubKgOutput", "period", "source")
# Требуется подтверждение: 7 дней в неделе – гипотеза заказчика, переводит суточную мощность контракта в недельную.
WORK_DAYS_PER_WEEK = 7


class WeekError(Exception):
    """Ошибка загрузки недели: HTTP-статус, тип ошибки и текст для пользователя."""

    def __init__(self, status, kind, message):
        super().__init__(message)
        self.status, self.kind, self.message = status, kind, message


def config_path():
    return Path(os.environ.get(ENV_NAME) or DEFAULT_DIR) / FILE_NAME


def _invalid(where):
    return WeekError(503, "week_invalid", "Файл недели требует проверки: " + where)


def _reject_constant(name):
    raise ValueError("недопустимая константа JSON: " + name)


def _keys(obj, expected, where, optional=()):
    if not isinstance(obj, dict) or not set(expected) <= set(obj) or set(obj) - set(expected) - set(optional):
        raise _invalid("состав полей в разделе «" + where + "» не совпадает с контрактом")


def _number(value, where, *, nullable=True, low=0.0, high=None):
    if value is None and nullable:
        return
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            or value < low or (high is not None and value > high)):
        raise _invalid("значение «" + where + "» требует конечного числа в допустимом диапазоне")


def _text(value, where):
    if not isinstance(value, str):
        raise _invalid("значение «" + where + "» требует текст")


def _check_orders(orders):
    if not isinstance(orders, list):
        raise _invalid("orders требует список")
    for index, order in enumerate(orders):
        where = "orders[" + str(index) + "]"
        _keys(order, ORDER_KEYS, where)
        if order["productId"] not in PRODUCT_CODES:
            raise _invalid("значение «" + where + ".productId» требует код продукта из каталога")
        if order["status"] not in ORDER_STATUSES:
            raise _invalid("значение «" + where + ".status» требует confirmed, forecast или history")
        _number(order["qtyKg"], where + ".qtyKg", nullable=False)
        _number(order["priceRubKg"], where + ".priceRubKg")
        for key in ("period", "channel", "source"):
            _text(order[key], where + "." + key)


def _check_cost_facts(facts):
    _keys(facts, COST_FACT_PRODUCTS, "costFacts")
    for code, fact in facts.items():
        where = "costFacts." + code
        _keys(fact, COST_FACT_KEYS, where)
        # null допустим: значение не подтверждено, пояснение пишется в source.
        _number(fact["costRubKgOutput"], where + ".costRubKgOutput")
        _text(fact["period"], where + ".period")
        _text(fact["source"], where + ".source")


def validate(data):
    _keys(data, INPUT_KEYS, "верхний уровень", optional=SERVICE_KEYS | set(BLOCK_KEYS))
    if type(data["schemaVersion"]) is not int or data["schemaVersion"] != SCHEMA_VERSION:
        raise _invalid("версия схемы должна быть " + str(SCHEMA_VERSION))
    if data["source"] != SOURCE_KIND:
        raise _invalid("источник должен быть агрегатами")
    _keys(data["period"], ("label", "basis"), "period")
    _text(data["period"]["label"], "period.label")
    _text(data["period"]["basis"], "period.basis")
    _number(data["scaleWeekKg"], "scaleWeekKg", nullable=False)
    _number(data["rawCostRubKg"], "rawCostRubKg")
    _number(data["freezeCostRubKg"], "freezeCostRubKg")
    _keys(data["products"], PRODUCT_CODES, "products")
    for code, product in data["products"].items():
        _keys(product, ("listPriceRubKg", "freezePriceRubKg", "priceSource"), "products." + code)
        _number(product["listPriceRubKg"], "products." + code + ".listPriceRubKg")
        _number(product["freezePriceRubKg"], "products." + code + ".freezePriceRubKg")
        _text(product["priceSource"], "products." + code + ".priceSource")
    _keys(data["routes"], ROUTE_CODES, "routes")
    for code, route in data["routes"].items():
        _keys(route, ("yields", "variableCostRubKg", "sourceNote"), "routes." + code, optional=("rawInRate",))
        if "rawInRate" in route and type(route["rawInRate"]) is not bool:
            raise _invalid("значение «routes." + code + ".rawInRate» требует логическое значение")
        if not isinstance(route["yields"], dict) or not set(route["yields"]) <= set(PRODUCT_CODES):
            raise _invalid("выходы маршрута «" + code + "» содержат неизвестный продукт")
        for product_code, share in route["yields"].items():
            _number(share, "routes." + code + ".yields." + product_code, high=1.0)
        _number(route["variableCostRubKg"], "routes." + code + ".variableCostRubKg")
        _text(route["sourceNote"], "routes." + code + ".sourceNote")
    for name in ("capacityTDay", "capacityWeekT"):
        _keys(data[name], STAGE_CODES, name)
        for code, value in data[name].items():
            _number(value, name + "." + code)
    if not isinstance(data["sources"], list):
        raise _invalid("sources требует список")
    for index, item in enumerate(data["sources"]):
        where = "sources[" + str(index) + "]"
        _keys(item, ("field", "file", "sheet", "period", "status"), where)
        # Статус источника в контракте v4 свободный текст с пояснением, поэтому проверяется только тип.
        for key in ("field", "file", "sheet", "period", "status"):
            _text(item[key], where + "." + key)
    if "orders" in data:
        _check_orders(data["orders"])
    if "costFacts" in data:
        _check_cost_facts(data["costFacts"])


def weekly_deboning(day_t):
    """Недельная мощность обвалки, т/неделю: суточная мощность контракта × рабочие дни. Пустое значение дает null, подстановки нет."""
    return None if day_t is None else round(day_t * WORK_DAYS_PER_WEEK, 6)


def load_week():
    path = config_path()
    if not path.is_file():
        raise WeekError(404, "week_missing", "Файл недели не найден в каталоге обезличенной выгрузки. Укажите каталог в переменной " + ENV_NAME)
    try:
        # Файл читается на каждый запрос: при размере около 12 КБ кэш не нужен.
        data = json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except (OSError, ValueError) as exc:
        raise WeekError(503, "week_invalid", "Файл недели требует проверки формата JSON") from exc
    validate(data)
    week = {key: data[key] for key in WEEK_KEYS}
    week["capacityWeekT"] = {"deboning": weekly_deboning(data["capacityTDay"]["deboning"])}
    result = {"week": week, "sources": data["sources"]}
    # Блоки заказов и затрат идут рядом с объектом недели: объект недели для расчета не меняется.
    result.update({key: data[key] for key in BLOCK_KEYS if key in data})
    return result
