"""Недельный план: фронтир, стакан спроса, статусы и предохранитель масштаба.

Python-зеркало функций platform/model.js. Соответствие имен:
  buildFrontier   -> build_frontier
  buildStakan     -> build_stakan
  planStatus      -> plan_status
  scaleGuard      -> scale_guard
  efficientPoints -> efficient_points
  planConfig      -> plan_config
Ключи словарей совпадают с JS (camelCase), поэтому входы из JSON передаются без переименования.
Единицы: вход и выпуск в кг, цены в руб / кг, объем разделки V в т, суммы в рублях.
Суммы считаются циклом в порядке JS-модели: sum() в Python 3.12 и новее складывает с компенсацией.
"""
import math
import time

EPS = 1e-7
RUB_EPS = 1e-6
CLASS_RANK = {"confirmed": 1, "forecast": 2, "extra": 3}
PRODUCT_NAMES = {
    "whole": "Тушка", "fillet": "Филе грудки", "legs": "Ножки", "wing": "Крыло", "frame": "Каркас",
    "breast": "Грудка на кости", "legMeat": "Мякоть ножки", "legBone": "Кость ножки", "legSkin": "Кожа ножки",
}
# routes в model.js: здесь только поля, которые читают функции фронтира.
ROUTES = {
    "whole": {"name": "Целая тушка", "yields": {}, "variableCost": 8},
    "coarse": {"name": "Крупная разделка", "yields": {"breast": .40, "legs": .35, "wing": .11, "frame": .13}, "variableCost": 19},
    "fillet": {"name": "Филе и ножки", "yields": {"fillet": .32, "legs": .35, "wing": .11, "frame": .20}, "variableCost": 20.3},
    "deep": {"name": "Обвалка грудки и ножки", "yields": {"fillet": .32, "legMeat": .24, "legBone": .075, "legSkin": .025, "wing": .11, "frame": .20}, "variableCost": 28},
}
# planConfig в model.js. По умолчанию весовая методика, решение финансов: требуется подтверждение.
plan_config = {
    "scaleWeekKg": 4009615,  # масштаб недели: 4 009 615 кг = 208,5 млн кг в год (продажа май 2025 – апрель 2026), решение заказчика
    "scaleGuardShare": .5,
    "scaleNote": "Решение заказчика: 208,5 млн кг в год (продажа май 2025 – апрель 2026)",
    "regulationCutT": 40,
    "regulationNote": "Требуется подтверждение: единица регламента 40 т (в неделю или в сутки), блокер P1",
    "minCutT": None,
    "minCutNote": "Требуется подтверждение: минимальная партия разделки, блокер P2",
    "costMethod": "weight",  # spec: спецформула (140 + h_j) / y_j; любое значение кроме weight считается спецформулой
    "costNote": "Требуется подтверждение: методика себестоимости, блокер P1. По спецификации затраты разделки учитываются по каждому продукту маршрута",
    "gridStepT": 1,
    "thresholds": {
        "execution": {"direction": "higher", "ok": .95, "warn": .85},
        "gapToIdeal": {"direction": "lower", "ok": .02, "warn": .05},
        "freezeShare": {"direction": "lower", "ok": .15, "warn": .25},
        "avgPrice": {"direction": "higher", "ok": .98, "warn": .95},
        "yieldDeviation": {"direction": "lower", "ok": .5, "warn": 1.5},
        "confirmedOrders": {"direction": "higher", "ok": .7, "warn": .5},
        "routeLinks": {"direction": "higher", "ok": .9, "warn": .6},
    },
}
STATUS_LEVELS = {
    "none": {"level": "none", "symbol": "○", "word": "Нет данных", "color": "#52677D"},
    "risk": {"level": "risk", "symbol": "■", "word": "Риск", "color": "#C0392B"},
    "warn": {"level": "warn", "symbol": "▲", "word": "Внимание", "color": "#F2AA00"},
    "ok": {"level": "ok", "symbol": "●", "word": "В норме", "color": "#2E8B57"},
}
# Постановка решателя границы (Д06, работа 4): переменные, ограничения, целевая функция, непрерывность и целочисленные партии.
FRONTIER_SPEC = {
    "variables": "V, т: объем разделки; непрерывный, опрашивается сеткой шагом gridStepT",
    "objective": "максимум K(V), руб.: сумма вкладов продуктов маршрута и тушки",
    "constraints": ["0 ≤ V ≤ min(мощность недели, вход недели)", "вход − V × 1000 ≥ минимальный заказ тушки",
                    "V ≥ минимальная партия разделки, если задана", "выпуск и отгрузка не меньше обязательства (commitmentKg)"],
    "integerBatches": "не заданы: минимальная партия разделки не подтверждена (блокер P2)",
}


def is_finite(value):
    """Аналог Number.isFinite: логические значения и None числами не считаются."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def total(values):
    """Сложение циклом от нуля, как reduce((sum, v) => sum + v, 0) в JS."""
    result = 0
    for value in values:
        result += value
    return result


def js_round(value):
    """Math.round для неотрицательных чисел: половина округляется вверх."""
    floor = math.floor(value)
    return float(floor + 1 if value - floor >= .5 else floor)


def js_text(value):
    """Число в строке так же, как при конкатенации в JS: 100 печатается как 100, а не 100.0."""
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def no_data(reason):
    return {**STATUS_LEVELS["none"], "reason": reason}


def plan_status(key, value):
    """JS: planStatus. Порядок проверки: порог, затем пустое значение, затем риск, внимание и норма."""
    t = plan_config["thresholds"].get(key)
    if not t or not is_finite(t.get("ok")) or not is_finite(t.get("warn")):
        return no_data("Требуется подтверждение: порог «" + key + "» не задан")
    if not is_finite(value):
        return no_data("Нет данных")
    higher = t["direction"] == "higher"
    good = value >= t["ok"] if higher else value <= t["ok"]
    fine = value >= t["warn"] if higher else value <= t["warn"]
    return dict(STATUS_LEVELS["ok"] if good else STATUS_LEVELS["warn"] if fine else STATUS_LEVELS["risk"])


def scale_guard(week):
    """JS: scaleGuard. Вход недели ниже 0,5 × масштаба выводит предупреждение; граница и стакан считаются."""
    limit_kg = plan_config["scaleWeekKg"] * plan_config["scaleGuardShare"]
    input_kg = week.get("inputKg") if week else None
    blocked = not (is_finite(input_kg) and input_kg >= limit_kg)
    return {
        "blocked": blocked, "inputKg": input_kg, "limitKg": limit_kg, "note": plan_config["scaleNote"],
        "status": {**STATUS_LEVELS["warn"], "reason": "Масштаб недели ниже ожидаемого"} if blocked else None,
    }


def as_number(value):
    """Число из контракта или None: пустое и нечисловое значение не подставляется."""
    return value if is_finite(value) else None


def as_share(value):
    """Доля выхода из контракта: от 0 до 1. Проценты (32 при норме 0,32) дают None, то есть статус «Нет данных»."""
    return value if is_finite(value) and 0 <= value <= 1 else None


def capacity_of(base, config):
    """JS: capacityOf. Блок capacityWeekT контракта главный: его deboning, пустое значение дает None и статус «Нет данных».
    Без блока действует мощность недели."""
    if "capacityWeekT" not in config:
        return base.get("capacityWeekT")
    block = config.get("capacityWeekT")
    return as_number(block.get("deboning")) if isinstance(block, dict) else None


def resolve_week(week, config=None):
    """JS: resolveWeek. Если контракта нет, действуют учебные значения: source = training.
    С контрактом подставляются сырье, выходы и переменные затраты маршрутов, цена списка для строк заказа с пустой ценой, мощность разделки из блока capacityWeekT: source = aggregates.
    Пустое значение контракта остается None и дает статус «Нет данных»."""
    if config is None:
        return {"week": week, "source": "training", "gap": None}
    if config.get("schemaVersion") != 1:
        return {"week": week, "source": "aggregates", "gap": "Требуется подтверждение: поддерживается только версия контракта недели 1"}
    base = week or {}
    cfg_routes = config.get("routes") or {}
    cfg_products = config.get("products") or {}
    table = {}
    for code, route in ROUTES.items():
        cfg = cfg_routes.get(code) or {}
        cfg_yields = cfg.get("yields") or {}
        table[code] = {**route, "yields": {pid: as_share(cfg_yields.get(pid)) for pid in route["yields"]},
                       "variableCost": as_number(cfg.get("variableCostRubKg")),
                       "rawInRate": cfg.get("rawInRate") is True}
    orders = []
    for o in base.get("orders") or []:
        list_price = as_number((cfg_products.get(o.get("product")) or {}).get("listPriceRubKg"))
        orders.append({**o, "priceRubKg": list_price} if o.get("priceRubKg") is None and list_price is not None else o)
    resolved_week = {**base, "capacityWeekT": capacity_of(base, config), "rawCostRubKg": as_number(config.get("rawCostRubKg")),
                     "routeTable": table, "orders": orders}
    return {"week": resolved_week, "source": "aggregates", "gap": None}


def route_table_of(week):
    """JS: routeTableOf. Таблица маршрутов недели: из контракта, иначе учебная ROUTES."""
    return week.get("routeTable") or ROUTES


def route_of(week):
    code = week.get("routeCode")
    table = route_table_of(week)
    return table.get(code) if code in table else None


def products_of(week):
    """JS: productsOf. Тушка плюс продукты маршрута в порядке yields."""
    route = route_of(week)
    return ["whole", *route["yields"].keys()] if route else []


def output_kg(week, product_id, cut_t):
    if product_id == "whole":
        return week["inputKg"] - cut_t * 1000
    return cut_t * 1000 * route_of(week)["yields"][product_id]


def unit_cost_register(week, product_id):
    """JS: unitCostRegister. Единичная себестоимость из регистра, руб / кг выпуска; сырье учитывается один раз.
    Признак маршрута rawInRate: True – ставка уже включает сырье, используется как есть; False или без признака – сырье добавляется один раз.
    Тушка: ставка целой тушки. Прочие продукты: (сырье + затраты маршрута) / сумма выходов (weight) или спецформула (сырье + h_j) / y_j.
    Сырье берется из недели: пустое значение дает статус «Нет данных» в data_gap, подстановки 140 нет."""
    route = route_of(week)
    rate = route_table_of(week)["whole"] if product_id == "whole" else route
    raw = 0 if rate.get("rawInRate") is True else week["rawCostRubKg"]
    if product_id == "whole":
        return raw + rate["variableCost"]
    method = week.get("costMethod") or plan_config["costMethod"]
    yield_base = total(route["yields"].values()) if method == "weight" else route["yields"][product_id]
    return (raw + route["variableCost"]) / yield_base


def data_gap(week):
    """JS: dataGap. Причина, по которой расчет нельзя выполнить, или None."""
    route = route_of(week)
    if not route:
        return "Схема разделки не найдена в справочнике"
    if not is_finite(week.get("capacityWeekT")):
        return "Нет данных: мощность разделки не задана"
    if not is_finite(week.get("rawCostRubKg")):
        return "Нет данных: цена сырья"
    if not is_finite(route_table_of(week)["whole"].get("variableCost")):
        return "Нет данных: переменные затраты целой тушки"
    if not is_finite(route.get("variableCost")):
        return "Нет данных: переменные затраты маршрута «" + route["name"] + "»"
    for product_id, share in route["yields"].items():
        if not is_finite(share):
            return "Нет данных: выход «" + PRODUCT_NAMES[product_id] + "» по маршруту «" + route["name"] + "»"
    ids = products_of(week)
    freeze = week.get("freezePriceRubKg") or {}
    for product_id in ids:
        if not is_finite(freeze.get(product_id)):
            return "Нет цены заморозки: " + PRODUCT_NAMES[product_id]
    for o in week.get("orders") or []:
        if o.get("product") not in ids:
            continue
        priced = (is_finite(o.get("priceRubKg")) and o["priceRubKg"] >= 0
                  and is_finite(o.get("qtyKg")) and o["qtyKg"] >= 0 and o.get("orderClass") in CLASS_RANK)
        probable = o.get("orderClass") != "forecast" or (is_finite(o.get("probability")) and 0 <= o["probability"] <= 1)
        if not priced or not probable:
            return "Нет цены или условий заказа в строке " + str(o.get("id") or "?")
    return None


def allocate_product(week, cut_t, product_id):
    """JS: allocateProduct. Класс по возрастанию, цена по убыванию, дата по возрастанию.
    Класс 3 допускается только при цене от заморозки f_j и выше. Остаток уходит в заморозку по f_j."""
    freeze_price = week["freezePriceRubKg"][product_id]
    cost = unit_cost_register(week, product_id)
    supply = output_kg(week, product_id, cut_t)
    rows = []
    for o in week.get("orders") or []:
        if o.get("product") != product_id:
            continue
        q = o["probability"] * o["qtyKg"] if o.get("orderClass") == "forecast" else o["qtyKg"]
        rows.append({"id": o.get("id"), "cls": CLASS_RANK[o["orderClass"]], "priceRubKg": o["priceRubKg"],
                     "date": o.get("orderDate") or "", "a": 0, "q": q})
    rows.sort(key=lambda r: (r["cls"], -r["priceRubKg"], r["date"]))
    used = 0
    for r in rows:
        r["a"] = 0 if (r["cls"] == 3 and r["priceRubKg"] < freeze_price) else min(r["q"], max(0, supply - used))
        used += r["a"]
    frozen_kg = max(0, supply - used)
    return {
        "id": product_id, "supplyKg": supply, "unitCostRubKg": cost, "freezePriceRubKg": freeze_price,
        "rows": rows, "frozenKg": frozen_kg,
        "revenueRub": total(r["a"] * r["priceRubKg"] for r in rows) + frozen_kg * freeze_price,
        "K": total(r["a"] * (r["priceRubKg"] - cost) for r in rows) + frozen_kg * (freeze_price - cost),
    }


def cut_point(week, cut_t):
    """JS: cutPoint. Точка фронтира при объеме разделки V: суммы по всем продуктам маршрута и тушке."""
    parts = [allocate_product(week, cut_t, pid) for pid in products_of(week)]
    return {
        "V": cut_t, "K": total(p["K"] for p in parts), "R": total(p["frozenKg"] for p in parts),
        "producedKg": total(p["supplyKg"] for p in parts), "flag": cut_t > plan_config["regulationCutT"],
    }


def commitment_boundary(week, cut_t):
    """JS: commitmentBoundary. Обязательства week.commitmentKg (кг по продукту) при объеме разделки cut_t, т.
    Выпуск и отгрузка продукта с обязательством не меньше заявленного кг. minCutT – наименьший объем разделки, при котором
    выпуск обязательных продуктов достаточен; maxCutT – наибольший объем, при котором хватает тушки. Нарушение называет продукт,
    требуемый и доступный объем в кг и разрыв; нехватка мощности дает разрыв в тоннах разделки."""
    ids = products_of(week)
    violations = []
    min_cut, max_cut, active = 0, None, []
    for product_id, need in (week.get("commitmentKg") or {}).items():
        if product_id not in ids or not is_finite(need) or need < 0:
            violations.append({"kind": "product", "product": product_id, "label": "Обязательство требует продукта маршрута и числа не меньше нуля"})
            continue
        if need <= EPS:
            continue
        active.append((product_id, need))
        if product_id == "whole":
            limit = (week["inputKg"] - need) / 1000
            max_cut = limit if max_cut is None else min(max_cut, limit)
        elif route_of(week)["yields"][product_id] > 0:
            min_cut = max(min_cut, need / (1000 * route_of(week)["yields"][product_id]))
        else:
            violations.append({"kind": "yield", "product": product_id, "label": "Выход продукта равен нулю: обязательство недостижимо"})
    cap = week.get("capacityWeekT")
    if is_finite(cap) and min_cut > cap + EPS:
        violations.append({"kind": "capacity", "label": "Объем разделки для обязательства выше мощности недели",
                           "requiredCutT": min_cut, "capacityCutT": cap, "shortfallCutT": min_cut - cap})
    for product_id, need in active:
        supply = output_kg(week, product_id, cut_t)
        name = PRODUCT_NAMES[product_id]
        if supply < need - EPS:
            violations.append({"kind": "supply", "product": product_id, "label": "Выпуск «" + name + "» ниже обязательства",
                               "requiredKg": need, "availableKg": supply, "shortfallKg": need - supply})
            continue
        shipped = total(r["a"] for r in allocate_product(week, cut_t, product_id)["rows"])
        if shipped < need - EPS:
            violations.append({"kind": "shipment", "product": product_id, "label": "Отгрузка «" + name + "» ниже обязательства",
                               "requiredKg": need, "shippedKg": shipped, "shortfallKg": need - shipped})
    return {"cutT": cut_t, "feasible": not violations, "minCutT": min_cut, "maxCutT": max_cut, "violations": violations}


def resource_limits(resources):
    """JS: resourceLimits. Ресурсы недели: [{id, name, capacityKg, consumers: [{product, kg}]}].
    Нагрузка ресурса – сумма потребителей; общий ресурс (люди, линия, часть тушки) учитывается один раз.
    Ресурс без мощности (None) не дает нуля: граница доказанной выполнимости считается по известным ресурсам, неизвестные перечисляются.
    Ранжирование по загрузке: первый ресурс – ограничение, второй – следующее после расширения первого.
    ponytail: мощность за неделю без дней и смен; календарь смен и норм подключает L2 (units.py)."""
    known, unknown, violations = [], [], []
    for r in resources:
        load = total(c["kg"] for c in (r.get("consumers") or []))
        cap = r.get("capacityKg")
        if not is_finite(cap) or cap < 0:
            unknown.append({"id": r["id"], "name": r.get("name")})
            continue
        util = load / cap if cap > EPS else (0 if load <= EPS else None)
        rec = {"id": r["id"], "name": r.get("name"), "loadKg": load, "capacityKg": cap, "utilization": util}
        known.append(rec)
        if load > cap + EPS:
            violations.append({**rec, "shortfallKg": load - cap})
    ranked = sorted(known, key=lambda x: (x["utilization"] is None, -(x["utilization"] or 0)))
    return {"provenFeasible": not violations, "violations": violations, "unknown": unknown, "unknownCount": len(unknown),
            "ranking": ranked, "binding": ranked[0] if ranked else None, "next": ranked[1] if len(ranked) > 1 else None}


def efficient_points(points):
    """JS: efficientPoints. Сортировка R по возрастанию, K по убыванию, V по возрастанию; K должен расти строго."""
    out = []
    best = float("-inf")
    for p in sorted(points, key=lambda p: (p["R"], -p["K"], p["V"])):
        if p["K"] > best + RUB_EPS:
            out.append(p)
            best = p["K"]
    return out


def optimum_of(points):
    """JS: optimumOf. Максимум K; при равенстве в пределах RUB_EPS меньший V."""
    best = None
    for p in points:
        if best is None or p["K"] > best["K"] + RUB_EPS or (abs(p["K"] - best["K"]) <= RUB_EPS and p["V"] < best["V"]):
            best = p
    return best


def build_frontier(input_week, config=None):
    """JS: buildFrontier. Для каждого объема разделки V считаются K(V) и R(V). Допустимы V = 0 и V из [V_min, V_max]."""
    started = time.perf_counter()
    resolved = resolve_week(input_week, config)
    week = resolved["week"]
    guard = scale_guard(week)
    empty = {"guard": guard, "status": guard["status"], "points": [], "efficient": [], "optimum": None,
             "variants": {}, "invariant": None, "gap": None, "cap": None, "notes": [], "unconfirmed": [], "source": resolved["source"],
             "solver": None, "commitment": None}
    missing = resolved["gap"] or data_gap(week)
    if missing:
        return {**empty, "status": no_data(missing)}
    input_t = week["inputKg"] / 1000
    min_cut = week["minCutT"] if is_finite(week.get("minCutT")) else plan_config["minCutT"]
    whole_min_kg = week["minWholeKg"] if is_finite(week.get("minWholeKg")) else 0
    commitments = bool(week.get("commitmentKg"))
    max_cut = 0 if week.get("routeCode") == "whole" else max(0, min(week["capacityWeekT"], input_t))
    grid = [k * plan_config["gridStepT"] for k in range(0, math.floor(max_cut) + 1)]
    grid.append(max_cut)
    grid.extend(share * input_t for share in (.3, .4, .5))
    cuts = list(dict.fromkeys(js_round(v * 1e6) / 1e6 for v in grid if v <= max_cut + EPS))

    def feasible(v):
        # Обязательства (commitmentKg) отсекают объемы, при которых выпуск или отгрузка ниже заявленного кг.
        return ((v <= EPS or min_cut is None or v >= min_cut - EPS) and week["inputKg"] - v * 1000 >= whole_min_kg - EPS
                and (not commitments or commitment_boundary(week, v)["feasible"]))

    points = [cut_point(week, v) for v in sorted(v for v in cuts if feasible(v))]
    variants = {}
    for name, share in (("30%", .3), ("40%", .4), ("50%", .5)):
        point = next((p for p in points if abs(p["V"] - share * input_t) < 1e-6), None)
        if point is not None:
            variants[name] = point
    whole_variant = next((p for p in points if p["V"] == 0), None)
    if whole_variant is not None:
        variants["whole"] = whole_variant
    optimum = optimum_of(points)
    best_variant_k = max(p["K"] for p in variants.values()) if variants else None
    invariant = None
    if optimum is not None:
        invariant = {"holds": best_variant_k is None or optimum["K"] >= best_variant_k - RUB_EPS,
                     "optimumK": optimum["K"], "bestVariantK": best_variant_k}

    risks, warns, notes, unconfirmed = [], [], [], []
    if guard["blocked"]:
        warns.append(guard["status"]["reason"])
    if not points:
        risks.append("Нет допустимых точек на фронтире")
    if commitments and not points:
        risks.append("Обязательство не выполняется ни при одном допустимом объеме разделки")
    if points and all(p["K"] < 0 for p in points):
        risks.append("Все K < 0")
    ids = products_of(week)
    if not any(o.get("product") in ids for o in week.get("orders") or []):
        notes.append("Нет заказов, весь выпуск в заморозке")
    if optimum is not None and optimum["flag"]:
        risks.append("Нужно решение о разделке")
        notes.append("Нужно решение о разделке")
    if optimum is not None and optimum["producedKg"] > 0:
        level = plan_status("freezeShare", optimum["R"] / optimum["producedKg"])["level"]
        if level == "risk":
            risks.append("Доля заморозки выше порога")
        if level == "warn":
            warns.append("Доля заморозки в зоне внимания")
    if min_cut is None:
        unconfirmed.append(plan_config["minCutNote"])
    if (week.get("costMethod") or plan_config["costMethod"]) != "weight":
        unconfirmed.append(plan_config["costNote"])
    unconfirmed.append(plan_config["regulationNote"])
    if risks:
        status = {**STATUS_LEVELS["risk"], "reason": "; ".join(risks)}
    elif warns:
        status = {**STATUS_LEVELS["warn"], "reason": "; ".join(warns)}
    else:
        status = dict(STATUS_LEVELS["ok"])
    gap = None
    if min_cut is not None and min_cut > 0:
        gap = {"fromT": 0, "toT": min_cut, "label": "Разрыв: объем от 0 до " + js_text(min_cut) + " т, промежуточные точки исключены"}
    cap = None
    if week.get("routeCode") != "whole":
        cap = {"V": max_cut, "label": "Предел мощности" if week["capacityWeekT"] < input_t else "Предел доступного карказа"}
    commitment = None
    if commitments:
        boundary = commitment_boundary(week, 0)
        commitment = {"minCutT": boundary["minCutT"], "maxCutT": boundary["maxCutT"], "capacityCutT": max_cut,
                      "feasiblePoints": len(points), "violationsAtZero": boundary["violations"]}
    solver = {"name": "сеточный перебор", "reason": "Одна переменная: объем разделки. SciPy HiGHS в окружении не подключен",
              "status": "лучший проверенный вариант" if optimum is not None else "Нет допустимого варианта",
              "provenOptimum": False, "toleranceT": plan_config["gridStepT"], "points": len(points),
              "gap": None, "gapNote": "Оптимум не доказан: разрыв не вычислен",
              "timeMs": round((time.perf_counter() - started) * 1000, 3), "spec": dict(FRONTIER_SPEC)}
    return {
        "guard": guard, "status": status, "points": points, "efficient": efficient_points(points),
        "optimum": optimum, "variants": variants, "invariant": invariant, "gap": gap, "cap": cap,
        "notes": notes, "unconfirmed": unconfirmed, "source": resolved["source"],
        "solver": solver, "commitment": commitment,
    }


def build_stakan(input_week, cut_t, product_id, config=None):
    """JS: buildStakan. Ступени по убыванию цены, ширина – объем, высота – цена; заморозка – отдельная ступень по f_j."""
    resolved = resolve_week(input_week, config)
    week = resolved["week"]
    guard = scale_guard(week)
    empty = {"blocked": guard["blocked"], "status": guard["status"], "productId": product_id, "steps": [],
             "frozen": None, "lines": None, "supplyKg": None, "revenueRub": None, "stepsRevenueRub": None, "source": resolved["source"]}
    missing = resolved["gap"] or data_gap(week) or (None if product_id in products_of(week) else "Продукт вне маршрута")
    if missing:
        return {**empty, "status": no_data(missing)}
    a = allocate_product(week, cut_t, product_id)
    rows = sorted((r for r in a["rows"] if r["q"] > 0), key=lambda r: (-r["priceRubKg"], r["cls"]))
    steps = []
    x = 0
    for r in rows:
        x0 = x
        x += r["q"]
        steps.append({
            "id": r["id"], "cls": r["cls"], "priceRubKg": r["priceRubKg"], "x0": x0, "x1": x,
            "demandKg": r["q"], "distributedKg": r["a"], "hatchedKg": r["q"] - r["a"],
            "distribution": "полностью" if r["a"] >= r["q"] - RUB_EPS else ("частично" if r["a"] > RUB_EPS else "нет"),
        })
    frozen = {"priceRubKg": a["freezePriceRubKg"], "volumeKg": a["frozenKg"], "areaRub": a["frozenKg"] * a["freezePriceRubKg"]}
    return {
        "blocked": guard["blocked"], "status": guard["status"], "productId": product_id, "steps": steps, "frozen": frozen,
        "lines": {"freezePriceRubKg": a["freezePriceRubKg"], "costRubKg": a["unitCostRubKg"]},
        "supplyKg": a["supplyKg"], "revenueRub": a["revenueRub"], "K": a["K"],
        "stepsRevenueRub": total(s["distributedKg"] * s["priceRubKg"] for s in steps) + frozen["areaRub"],
        "source": resolved["source"],
    }
