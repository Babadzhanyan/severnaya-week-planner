"""Коммерческое предложение: строки спроса, поглощение прогноза, чистая цена и подсказки действий.

Строка спроса: товар, упаковка, день, зона, клиент, класс, объем, условия предложения и версия.
Спрос группы (товар, упаковка, зона, клиент) за неделю равен большему из двух значений:
объема прогноза и суммы твердых объемов (договоренность, подтвержденный заказ, дополнительная заявка).
Твердый объем поглощает прогноз до его величины и сверх него добавляет спрос.
Перенос между днями одной недели не меняет ни одну из этих сумм.
Команда с тем же идентификатором и тем же содержимым записывается один раз.
Объемы в килограммах, цены в руб. / кг. Формулы чистой цены ждут подтверждения финансов:
статьи без подтвержденных данных получают статус «Требуется подтверждение».
"""
import hashlib
import json
import math
import re
from datetime import date

CLASS_LABELS = {
    "forecast": "Прогноз",
    "agreement": "Договоренность",
    "confirmed_order": "Подтвержденный заказ",
    "additional_request": "Дополнительная заявка",
}
FIRM_CLASSES = ("agreement", "confirmed_order", "additional_request")
GROUP_KEYS = ("product", "packing", "zone", "client")
TERMS = ("priceRubKg", "discountPct", "bonusRubKg", "logisticsRubKg", "returnsPct", "deferralDays", "taxBasis")
LINE_FIELDS = ("id", "product", "packing", "day", "zone", "client", "rowClass", "volumeKg", *TERMS)
LIMITS = {"priceRubKg": 1e6, "discountPct": 100, "bonusRubKg": 1e6, "logisticsRubKg": 1e6, "returnsPct": 100}
CLIENT_ALIAS = re.compile(r"К-[0-9]{3,}")
CLIENT_MSG = "Клиент указывается псевдонимом К-###"
EXTRA_MSG = "Запрос содержит поле за пределами согласованной структуры"
CONFIRMED, OPEN = "Подтверждено", "Требуется подтверждение"
LEVERS = (
    ("discount", "Точечная скидка"),
    ("day", "Другой день"),
    ("batch", "Партия"),
    ("packing", "Упаковка"),
    ("channel", "Канал"),
    ("delivery", "Доставка"),
    ("basket", "Сопряженная корзина"),
)


class CommercialError(Exception):
    def __init__(self, status, kind, message, loc=("body",)):
        super().__init__(message)
        self.status, self.kind, self.message, self.loc = status, kind, message, list(loc)

    def body(self):
        return {"detail": [{"loc": self.loc, "msg": self.message, "type": self.kind}]}


def _fail(kind, message, *loc):
    return CommercialError(422, kind, message, ["body", *loc])


def _number(value, low, high, *loc):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise _fail("value_error", f"Значение требует число от {low} до {high}", *loc)
    return float(value)


def _text(value, limit, *loc):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
        raise _fail("string_invalid", f"Значение требует от 1 до {limit} знаков", *loc)
    return value.strip()


def _day(value, *loc):
    try:
        if isinstance(value, str) and len(value) == 10:
            return date.fromisoformat(value).isoformat()
    except ValueError:
        pass
    raise _fail("value_error", "День требует дату ГГГГ-ММ-ДД", *loc)


def _alias(value, *loc):
    if not isinstance(value, str) or not CLIENT_ALIAS.fullmatch(value):
        raise CommercialError(422, "client_alias_invalid", CLIENT_MSG, ["body", *loc])
    return value


def _term(field, value):
    if value is None:
        return None
    if field == "deferralDays":
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 366:
            raise _fail("value_error", "Отсрочка требует целое число дней от 0 до 366", field)
        return value
    if field == "taxBasis":
        if not isinstance(value, dict) or set(value) != {"deductionRubKg", "confirmedBy"}:
            raise _fail("value_error", "Налоговая основа требует поля deductionRubKg и confirmedBy", field)
        return {"deductionRubKg": _number(value["deductionRubKg"], -1e6, 1e6, field, "deductionRubKg"),
                "confirmedBy": _text(value["confirmedBy"], 80, field, "confirmedBy")}
    return _number(value, 0, LIMITS[field], field)


def _line(command):
    if not isinstance(command, dict):
        raise _fail("dict_type", "Строка требует объект")
    if set(command) - set(LINE_FIELDS):
        raise _fail("extra_forbidden", EXTRA_MSG)
    for field in ("id", "product", "packing", "day", "zone", "client", "rowClass", "volumeKg"):
        if field not in command:
            raise _fail("missing", "Поле строки требует значения", field)
    if not isinstance(command["rowClass"], str) or command["rowClass"] not in CLASS_LABELS:
        raise _fail("literal_error", "Класс выбирается из справочника", "rowClass")
    line = {
        "id": _text(command["id"], 100, "id"),
        "product": _text(command["product"], 100, "product"),
        "packing": _text(command["packing"], 100, "packing"),
        "day": _day(command["day"], "day"),
        "zone": _text(command["zone"], 100, "zone"),
        "client": _alias(command["client"], "client"),
        "rowClass": command["rowClass"],
        "volumeKg": _number(command["volumeKg"], 0, 1e9, "volumeKg"),
        "offerVersion": 1,
    }
    line.update({field: _term(field, command.get(field)) for field in TERMS})
    return line


def _digest(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _row(lines, line_id):
    line = lines.get(line_id)
    if line is None:
        raise CommercialError(404, "row_not_found", "Строка спроса не найдена", ["path", "id"])
    return line


def upsert_line(lines, command):
    """Добавляет строку. Повтор той же команды возвращает False и не создает второй объект."""
    line = _line(command)
    digest = _digest(line)
    current = lines.get(line["id"])
    if current is None:
        lines[line["id"]] = {**line, "commandHash": digest}
        return True
    if current.get("commandHash") == digest:
        return False
    raise CommercialError(409, "command_conflict", "Команда с этим идентификатором записана с другими значениями", ["body", "id"])


def move_volume(lines, command_id, source_id, to_day, volume_kg):
    """Переносит объем строки на другой день той же недели. Повтор команды не меняет данные."""
    command_id = _text(command_id, 100, "id")
    to_day = _day(to_day, "toDay")
    source = _row(lines, source_id)
    moved = _number(volume_kg, 0, 1e9, "volumeKg")
    existing = lines.get(command_id)
    if existing is not None:
        if existing.get("movedFrom") == source_id and existing["day"] == to_day and existing["volumeKg"] == moved:
            return False
        raise CommercialError(409, "command_conflict", "Команда с этим идентификатором записана с другими значениями", ["body", "id"])
    if to_day == source["day"]:
        raise _fail("value_error", "Перенос требует другой день", "toDay")
    if date.fromisoformat(to_day).isocalendar()[:2] != date.fromisoformat(source["day"]).isocalendar()[:2]:
        raise _fail("value_error", "Перенос ограничен одной неделей", "toDay")
    if not 0 < moved <= source["volumeKg"]:
        raise _fail("value_error", "Объем переноса требует положительное значение, не превышающее объем строки", "volumeKg")
    source["volumeKg"] -= moved
    lines[command_id] = {**{k: v for k, v in source.items() if k != "commandHash"}, "id": command_id, "day": to_day,
                         "volumeKg": moved, "movedFrom": source_id}
    return True


def change_offer(lines, line_id, changes):
    """Меняет условия одной строки и поднимает ее версию. Другие строки и их объемы не меняются."""
    line = _row(lines, line_id)
    if not isinstance(changes, dict) or set(changes) - set(TERMS):
        raise _fail("extra_forbidden", EXTRA_MSG, "changes")
    updated = {field: _term(field, value) for field, value in changes.items()}
    if all(line[field] == value for field, value in updated.items()):
        return False
    line.update(updated)
    line["offerVersion"] += 1
    return True


def _item(key, label, value):
    ok = value is not None
    return {"key": key, "label": label, "rubKg": value, "status": "confirmed" if ok else "requires_confirmation",
            "statusLabel": CONFIRMED if ok else OPEN}


def _confirmed_tax(tax):
    return bool(tax) and tax.get("deductionRubKg") is not None and isinstance(tax.get("confirmedBy"), str) and tax["confirmedBy"].strip() != ""


def net_price(offer):
    """Чистая цена руб. / кг: цена, скидка, бонус, логистика, возвраты, отсрочка и налоговая основа.

    Возврат уменьшает выручку на долю от цены после скидки. Отсрочка подтверждена только при нулевом сроке.
    netRubKg равен None, пока хотя бы одна статья требует подтверждения.
    """
    price, discount = offer.get("priceRubKg"), offer.get("discountPct")
    bonus, logistics, returns = offer.get("bonusRubKg"), offer.get("logisticsRubKg"), offer.get("returnsPct")
    days, tax = offer.get("deferralDays"), offer.get("taxBasis")
    priced = price is not None and discount is not None
    after_discount = price * (1 - discount / 100) if priced else None
    components = [
        _item("price", "Предлагаемая цена", price),
        _item("discount", "Скидка", -price * discount / 100 if priced else None),
        _item("bonus", "Бонус", None if bonus is None else -bonus),
        _item("logistics", "Логистика", None if logistics is None else -logistics),
        _item("returns", "Возвраты", None if after_discount is None or returns is None else -after_discount * returns / 100),
        _item("deferral", "Отсрочка", 0.0 if days == 0 else None),
        _item("tax", "Налоговая основа", -tax["deductionRubKg"] if _confirmed_tax(tax) else None),
    ]
    complete = all(item["rubKg"] is not None for item in components)
    confirmed = sum(item["rubKg"] for item in components if item["rubKg"] is not None)
    return {"netRubKg": sum(item["rubKg"] for item in components) if complete else None, "confirmedRubKg": confirmed,
            "complete": complete, "components": components}


def _tonnes(kg):
    return f"{kg / 1000:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def _explain(forecast_kg, firm_kg, absorbed_kg, incremental_kg, demand_kg, delta):
    if forecast_kg == 0 and firm_kg == 0:
        return "Строки спроса за неделю отсутствуют"
    if incremental_kg == 0:
        text = f"Твердый спрос {_tonnes(firm_kg)} т поглощает {_tonnes(absorbed_kg)} т прогноза: объем недели остается {_tonnes(demand_kg)} т"
        if delta is not None and abs(delta) < 1e-9:
            return text + ". Прирост вклада нулевой: объем и цена совпадают с прогнозом"
        return text
    return f"Твердый спрос {_tonnes(firm_kg)} т при прогнозе {_tonnes(forecast_kg)} т добавляет {_tonnes(incremental_kg)} т к спросу недели"


def group_demand(lines, group, variable_cost_rub_kg=None):
    """Недельный спрос группы и вклад относительно прогноза; стоимость переменных затрат нужна при росте объема."""
    members = [row for row in lines.values() if all(row[key] == group[key] for key in GROUP_KEYS)]
    forecast = [row for row in members if row["rowClass"] == "forecast"]
    firm = [row for row in members if row["rowClass"] in FIRM_CLASSES]
    forecast_kg = math.fsum(row["volumeKg"] for row in forecast)
    firm_kg = math.fsum(row["volumeKg"] for row in firm)
    absorbed_kg = min(forecast_kg, firm_kg)
    incremental_kg = firm_kg - absorbed_kg
    demand_kg = forecast_kg + incremental_kg
    delta = None
    if all(row["priceRubKg"] is not None for row in forecast + firm) and (variable_cost_rub_kg is not None or incremental_kg == 0):
        forecast_avg = math.fsum(row["volumeKg"] * row["priceRubKg"] for row in forecast) / forecast_kg if forecast_kg > 0 else 0.0
        firm_value = math.fsum(row["volumeKg"] * row["priceRubKg"] for row in firm)
        cost = variable_cost_rub_kg or 0.0
        delta = firm_value - absorbed_kg * forecast_avg - cost * incremental_kg
    return {"forecastKg": forecast_kg, "firmKg": firm_kg, "absorbedForecastKg": absorbed_kg, "incrementalKg": incremental_kg,
            "demandKg": demand_kg, "contributionDeltaRub": delta,
            "explanation": _explain(forecast_kg, firm_kg, absorbed_kg, incremental_kg, demand_kg, delta)}


def economic_boundary(cost_rub_kg, logistics_rub_kg, deductions_rub_kg, target_margin_pct):
    """Граница уступки по формуле переговорной цены: отчисления плюс (затраты плюс логистика) / (1 минус маржа)."""
    values = (cost_rub_kg, logistics_rub_kg, deductions_rub_kg, target_margin_pct)
    if any(value is None for value in values) or not 0 <= target_margin_pct <= 99.9:
        return None
    return deductions_rub_kg + (cost_rub_kg + logistics_rub_kg) / (1 - target_margin_pct / 100)


def _reference(key, label, value, kind, note):
    return {"key": key, "label": label, "rubKg": value, "kind": kind, "status": "confirmed" if value is not None else OPEN, "note": note}


def price_references(*, historical_average_rub_kg, historical_max_rub_kg, offer_price_rub_kg, boundary_rub_kg):
    """Четыре разных значения цены. Историческая максимальная цена остается наблюдением."""
    return [
        _reference("historicalDeal", "Ориентир исторической сделки", historical_average_rub_kg, "Ориентир", "Средняя цена исторических сделок"),
        _reference("currentOffer", "Действующее предложение", offer_price_rub_kg, "Предложение", "Цена текущего предложения клиенту"),
        _reference("marketObservation", "Рыночное наблюдение", historical_max_rub_kg, "Наблюдение", "Максимальная историческая цена сделки"),
        _reference("economicBoundary", "Экономическая граница уступки", boundary_rub_kg, "Граница", "Минимальная цена при целевой марже"),
    ]


def action_hints(feasibility):
    """Подсказки только из расчета выполнимости: caller помечает True действия, которые сняли ограничение."""
    if not isinstance(feasibility, dict) or not isinstance(feasibility.get("feasible"), bool):
        raise _fail("value_error", "Выполнимость требует признак feasible", "feasibility")
    if feasibility["feasible"]:
        return {"hints": [], "reason": "Заявка выполнима, изменения не требуются"}
    levers = feasibility.get("levers") or {}
    hints = [{"key": key, "label": label} for key, label in LEVERS if levers.get(key) is True]
    reason = "Расчет выполнимости нашел действия, которые снимают ограничение" if hints else "Ни одно проверенное действие не снимает ограничение"
    return {"hints": hints, "reason": reason}


def commercial_view(client):
    """Замена /api/commercial: цена после обслуживания. Вклад и порог замещения ждут подтверждения финансов."""
    return {"net": client["price"] - client["service"], "change": None, "threshold": None, "status": OPEN,
            "gaps": ["Налоговая основа", "Отсрочка", "Полная себестоимость для изменения вклада и порога замещения"]}
