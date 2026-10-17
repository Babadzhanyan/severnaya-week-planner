"""Единицы и мощности: перевод массы и времени, паспорт ячейки книги, карточка и метрики ресурса.

Модуль не читает файлы и не формирует ответ API. Числа передает вызывающий код.
Паритет с src/capacity-units.js проверяют backend/tests/test_units.py и tests/capacity-units.test.mjs.
"""
from math import isclose, isfinite

KG_IN_T = 1000
HIGH_LOAD_PCT = 90
OVER_TOLERANCE_KG = 1e-6

STATUS_SOURCE = "Сохраненный расчет файла"
STATUS_TRAINING = "Учебный пример"
STATUS_NO_DATA = "Нет данных"
STATUS_CONFIRM = "Требуется подтверждение"
STATUS_HISTORICAL = "Исторический срез"
STATUS_HIGH = "Высокая загрузка"
STATUS_OVER = "Превышение мощности"
STATUS_RESERVE = "Резерв мощности"

RULE_TEXT = ("кг / смену = кг / сутки / смены; кг / час = кг / сутки / (смены × часы); "
             "чистые часы в сутки = смены × часы; валовые часы = чистые часы / доступность календаря; "
             "неделя = сутки × рабочие дни календаря")
WEIGHING_POINT_STATUS = "Требуется подтверждение: точка взвешивания (технолог)"
LOSS_STATUS = "Требуется подтверждение: потери передела (технолог)"
HEADS_STATUS_PLAN = "Расчетно по плану: живая масса / головы плана"
HEADS_STATUS_CONFIRM = "Требуется подтверждение: выход на голову (технолог)"
LINES_STATUS_MISSING = "Нет данных: число линий в источнике не задано"
OPERATIONS_STATUS = "Требуется подтверждение: перечень операций (технолог)"
LIVE_BASIS = "Живой вес"

BULK_PACK_ID = "bulk_carcass_pack"
INDIVIDUAL_PACK_ID = "individual_carcass_pack"
PACK_KIND = {
    "bulk_carcass_pack": "Валовая упаковка тушки",
    "individual_carcass_pack": "Индивидуальная упаковка тушки",
    "byproduct_pack": "Индивидуальные субпродукты",
    "feet_pack": "Упаковка ног",
    "ishida_pack": "Упаковка ISHIDA",
}
# Эталон приемки: лист 2.2 исходной карты, ячейки D19 (поток) и F19 (мощность), кг в сутки.
BULK_REFERENCE = {
    "flowId": BULK_PACK_ID,
    "name": "Валовая упаковка тушки",
    "demandKgDay": 313221.7507,
    "capacityKgDay": 337272,
    "numeratorCell": {"sheet": "2.2", "cells": "D19"},
    "denominatorCell": {"sheet": "2.2", "cells": "F19"},
}
ANNUAL_SALES_KG = 208_500_000
SALES_WEEKS = 52


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        raise ValueError(f"{name}_invalid")
    return float(value)


def _positive_count(value, name):
    number = _number(value, name)
    if number <= 0:
        raise ValueError(f"{name}_invalid")
    return number


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name}_required")
    return value.strip()


def load_percent(flow, capacity):
    """Загрузка в процентах: поток / мощность × 100 в одной физической базе. Пустая мощность дает None."""
    if flow is None or capacity is None:
        return None
    flow, capacity = _number(flow, "flow"), _number(capacity, "capacity")
    if capacity <= 0:
        return None
    return flow / capacity * 100


def load_status(flow, capacity):
    """Статус загрузки по тем же порогам, что у строк мощности: выше мощности, выше 90 %, резерв."""
    if flow is None or capacity is None:
        return STATUS_NO_DATA
    flow, capacity = _number(flow, "flow"), _number(capacity, "capacity")
    if flow - capacity > OVER_TOLERANCE_KG:
        return STATUS_OVER
    if capacity <= 0:
        return STATUS_RESERVE
    return STATUS_HIGH if flow / capacity * 100 > HIGH_LOAD_PCT else STATUS_RESERVE


def to_t(kg):
    return _number(kg, "kg") / KG_IN_T


def to_kg(t):
    return _number(t, "t") * KG_IN_T


def day_to_week(value_per_day, working_days):
    """Суточное значение в недельное: число рабочих дней берется из подтвержденного календаря."""
    return _number(value_per_day, "day") * _positive_count(working_days, "working_days")


def week_to_day(value_per_week, working_days):
    return _number(value_per_week, "week") / _positive_count(working_days, "working_days")


WORKING_DAYS_UNCONFIRMED = f"{STATUS_CONFIRM}: число рабочих дней недели не задано"


# ponytail: только целые дни; среднюю неделю (309 / 52 = 5,9) подпись покажет как «не задано», добавить подпись среднего, когда контракт его задаст
def _whole_count(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value != int(value) or value <= 0:
        return None
    return int(value)


def work_days_word(count):
    last, two = count % 10, count % 100
    if last == 1 and two != 11:
        return "рабочий день"
    return "рабочих дня" if 2 <= last <= 4 and (two < 12 or two > 14) else "рабочих дней"


def working_days_label(working_days, status=None):
    """Подпись рабочих дней недели. Число передает контракт; значения по умолчанию (например, 7) нет.
    Статус из контракта попадает в подпись: до подтверждения действует «Требуется подтверждение»."""
    count = _whole_count(working_days)
    if count is None:
        return WORKING_DAYS_UNCONFIRMED
    word = f"{count} {work_days_word(count)}"
    text = status.strip() if isinstance(status, str) else ""
    if text.lower().startswith("подтвержд"):
        return word
    basis = text.split(",")[0].strip().lower()
    if not basis or basis == STATUS_CONFIRM.lower():
        return f"{STATUS_CONFIRM}: {word}"
    return f"{STATUS_CONFIRM}: {word}, {basis}"


def per_shift(value_per_day, shifts):
    return _number(value_per_day, "day") / _positive_count(shifts, "shifts")


def per_hour(value_per_day, shifts, hours):
    return _number(value_per_day, "day") / (_positive_count(shifts, "shifts") * _positive_count(hours, "hours"))


def unit_passport(cell, value, unit, base, period, calendar, rule):
    """Паспорт ячейки книги: значение, единица, физическая база, точка взвешивания, период, календарь, правило."""
    try:
        passport = {
            "sourceCell": {"sheet": _text(cell["sheet"], "sheet"), "cells": _text(cell["cells"], "cells")},
            "value": None if value is None else _number(value, "value"),
            "unit": _text(unit, "unit"),
            "physicalBase": _text(base["physicalBase"], "physicalBase"),
            "weighingPoint": _text(base["weighingPoint"], "weighingPoint"),
            "period": _text(period, "period"),
            "calendar": _text(calendar, "calendar"),
            "conversionRule": _text(rule, "rule"),
        }
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("passport_incomplete") from exc
    passport["status"] = STATUS_NO_DATA if value is None else STATUS_SOURCE
    return passport


def resource_card(flow, capacity, unit, period, source_cells, status=None):
    """Строка карточки ресурса: числитель, знаменатель, процент, единица, период, ячейки-источники, статус."""
    if not isinstance(source_cells, (list, tuple)) or not source_cells:
        raise ValueError("source_cells_required")
    return {
        "numerator": flow,
        "denominator": capacity,
        "percent": load_percent(flow, capacity),
        "unit": _text(unit, "unit"),
        "period": _text(period, "period"),
        "sourceCells": [dict(cell) for cell in source_cells],
        "status": status or load_status(flow, capacity),
    }


def resource_metrics(row, plan, availability, line_count=None):
    """17 показателей ресурса по строке мощности: кг в сутки, смену и час, головы в час, часы, линии, потери, упаковка."""
    capacity = _number(row["capacity"], "capacity")
    shifts = _positive_count(row["shifts"], "shifts")
    hours = _number(row["hours"], "hours")
    net_day = shifts * hours
    heads_per_hour, heads_status = None, HEADS_STATUS_CONFIRM
    if str(row.get("massBasis", "")).startswith(LIVE_BASIS) and plan.get("liveKgDay") and plan.get("headsDay"):
        kg_per_head = _number(plan["liveKgDay"], "liveKgDay") / _positive_count(plan["headsDay"], "headsDay")
        heads_per_hour = capacity / net_day / kg_per_head if net_day > 0 else None
        heads_status = HEADS_STATUS_PLAN
    return {
        "kgPerDay": capacity,
        "kgPerShift": capacity / shifts,
        "kgPerHour": capacity / net_day if net_day > 0 else None,
        "headsPerHour": heads_per_hour,
        "headsPerHourStatus": heads_status,
        "netHoursDay": net_day,
        "grossHoursDay": net_day / availability if availability and availability > 0 else None,
        "parallelLines": line_count,
        "parallelLinesStatus": STATUS_SOURCE if line_count is not None else LINES_STATUS_MISSING,
        "lossPct": None,
        "lossStatus": LOSS_STATUS,
        "packKind": PACK_KIND.get(row["id"]),
        "operationsStatus": OPERATIONS_STATUS,
    }


def flow_split(plan, packed_kg_day):
    """Головы, живая масса, целая тушка, разделка, выход товара и запакованный поток.

    Внутренний переход учитывается однократно: выход товара = целая тушка + разделка, упаковка = целая тушка.
    """
    heads = _number(plan["headsDay"], "headsDay")
    live = _number(plan["liveKgDay"], "liveKgDay")
    whole = _number(plan["wholeKgDay"], "wholeKgDay")
    cut = _number(plan["cutKgDay"], "cutKgDay")
    finished = _number(plan["finishedKgDay"], "finishedKgDay")
    packed = _number(packed_kg_day, "packed")
    counted_once = isclose(finished, whole + cut, rel_tol=1e-8, abs_tol=1e-6) and isclose(packed, whole, rel_tol=1e-8, abs_tol=1e-6)
    return {
        "heads": {"value": heads, "unit": "гол / сутки", "physicalBase": "Головы птицы", "status": STATUS_SOURCE},
        "liveKg": {"value": live, "unit": "кг / сутки", "physicalBase": LIVE_BASIS, "status": STATUS_SOURCE},
        "wholeKg": {"value": whole, "unit": "кг / сутки", "physicalBase": "Тушка целая", "status": STATUS_SOURCE},
        "cuttingInputKg": {"value": None, "unit": "кг / сутки", "physicalBase": "Входная потрошеная тушка",
                           "status": f"{STATUS_CONFIRM}: вход разделки (технолог)"},
        "cuttingOutputKg": {"value": cut, "unit": "кг / сутки", "physicalBase": "Готовые позиции разделки",
                            "status": STATUS_SOURCE},
        "productOutputKg": {"value": finished, "unit": "кг / сутки", "physicalBase": "Выход товара: целая тушка и разделка",
                            "status": STATUS_SOURCE},
        "packedKg": {"value": packed, "unit": "кг / сутки",
                     "physicalBase": "Запакованный поток: валовая и индивидуальная упаковка", "status": STATUS_SOURCE},
        "wholeYieldFromLivePct": whole / live * 100 if live > 0 else None,
        "countedOnce": counted_once,
    }


def reference_check(demand_kg_day, capacity_kg_day):
    """Сверка валовой упаковки с эталоном пакета: 313 221,7507 / 337 272 кг в сутки."""
    reference_pct = load_percent(BULK_REFERENCE["demandKgDay"], BULK_REFERENCE["capacityKgDay"])
    result = {"flowId": BULK_PACK_ID, "referencePct": reference_pct, "percent": load_percent(demand_kg_day, capacity_kg_day)}
    if demand_kg_day is None or capacity_kg_day is None:
        return {**result, "status": STATUS_NO_DATA}
    same = (isclose(_number(demand_kg_day, "demand"), BULK_REFERENCE["demandKgDay"], abs_tol=0.01)
            and isclose(_number(capacity_kg_day, "capacity"), BULK_REFERENCE["capacityKgDay"], abs_tol=1e-6))
    return {**result, "status": "Совпадает с эталоном пакета" if same else f"{STATUS_CONFIRM}: расхождение с эталоном пакета"}


def training_limit(label, value_t, unit="т / неделя"):
    """Учебный предел: пример до подключения паспорта ресурса."""
    return {"label": _text(label, "label"), "valueT": _number(value_t, "value_t"), "unit": _text(unit, "unit"),
            "status": STATUS_TRAINING, "replacedBy": None}


def replace_training_limit(limit, flow=None):
    """Учебный предел заменяется ресурсом только вместе с назначенным потоком валовой упаковки.

    Пока поток не назначен, предел остается учебным примером. Индивидуальная упаковка рассчитывается отдельно.
    """
    if flow is None:
        return dict(limit)
    if flow.get("flowId") != BULK_PACK_ID:
        raise ValueError("flow_mismatch")
    capacity_kg = _number(flow.get("capacityKgDay"), "capacityKgDay")
    return {
        "label": _text(flow.get("name"), "name"),
        "valueT": to_t(capacity_kg),
        "unit": "т / сутки",
        "status": _text(flow.get("status"), "status"),
        "replacedBy": BULK_PACK_ID,
        "replacedLabel": _text(limit["label"], "label"),
    }


def flock_example(heads=30000, kg_per_head=2.0):
    """Функция расчета: поголовье × масса на голову. Норма остается в статусе подтверждения."""
    return {
        "heads": _positive_count(heads, "heads"),
        "kgPerHead": _positive_count(kg_per_head, "kgPerHead"),
        "massT": _positive_count(heads, "heads") * _positive_count(kg_per_head, "kgPerHead") / KG_IN_T,
        "status": STATUS_CONFIRM,
        "statusReason": "Требуется подтверждение периода и точки взвешивания",
        "owner": "технолог и планирование",
    }


def training_load_diagnosis(volume_t=4009, limit_t=100):
    """Диагноз 4 009 %: выпуск в тоннах делится на учебный предел в тоннах, то есть смешаны исходные условия."""
    volume = _number(volume_t, "volume_t")
    limit = _positive_count(limit_t, "limit_t")
    return {
        "volumeT": volume,
        "limitT": limit,
        "percent": load_percent(volume, limit),
        "status": STATUS_TRAINING,
        "diagnosis": (f"Смешение исходных условий: выпуск {f'{int(volume):,}'.replace(',', ' ')} т "
                      f"делится на учебные {f'{int(limit):,}'.replace(',', ' ')} т упаковки"),
    }


def week_availability(dated_plan_kg=None):
    """Доступность выбранной недели: только из датированного производственного плана."""
    source = "датированный производственный план выбранной недели"
    if dated_plan_kg is None:
        return {"status": STATUS_NO_DATA, "valueKg": None, "source": source}
    return {"status": "Доступно по датированному плану", "valueKg": _number(dated_plan_kg, "plan"), "source": source}


def historical_week_equivalent(annual_kg=ANNUAL_SALES_KG, weeks=SALES_WEEKS, dated_plan_kg=None):
    """4 010 т: исторический недельный эквивалент годовых продаж; доступность выбранной недели считается отдельно."""
    value_kg = _number(annual_kg, "annual_kg") / _positive_count(weeks, "weeks")
    value_t = to_t(value_kg)
    return {
        "label": "Исторический недельный эквивалент годовых продаж",
        "formula": f"{str(annual_kg / 1_000_000).replace('.', ',')} млн кг / {weeks}",
        "valueKg": value_kg,
        "valueT": value_t,
        "valueTRounded": round(value_t),
        "status": STATUS_HISTORICAL,
        "weekAvailability": week_availability(dated_plan_kg),
    }


def carcass_passport(live_kg=2.0, offal_share_pct=5.07, whole_kg=1.89862685, goods_kg=1.85752963):
    """Паспорт параметра «Вес тушки» 2 кг: формула включает потроха и потери, целая тушка сохраняет свое основание."""
    live = _positive_count(live_kg, "live_kg")
    share = _number(offal_share_pct, "offal_share_pct")
    whole = _positive_count(whole_kg, "whole_kg")
    goods = _positive_count(goods_kg, "goods_kg")
    derived_whole = live * (1 - share / 100)
    return {
        "parameter": "Вес тушки",
        "sourceCell": {"sheet": f"{STATUS_CONFIRM}: лист книги", "cells": "B6"},
        "liveKgHead": {"value": live, "status": f"{STATUS_CONFIRM}: состав массы (технолог)",
                       "composition": "формула включает потроха и потери"},
        "offalSharePct": share,
        "offalAndLossKgHead": live * share / 100,
        "wholeKgHead": {"value": whole, "derivedValue": round(derived_whole, 4),
                        "derivedCheck": isclose(derived_whole, whole, abs_tol=5e-5), "status": STATUS_SOURCE},
        "goodsKgHead": {"value": goods, "status": f"{STATUS_CONFIRM}: основание товарных частей (технолог)"},
        "wholeYieldFromLivePct": whole / live * 100,
        "goodsYieldFromWholePct": goods / whole * 100,
    }
