"""Чистая Python-модель. Тонны, руб/кг и рубли; все данные учебные.

Формулы продолжают model.js версии 2.0. Производственный сервер выполняет
вычисления Python; JavaScript служит эталоном только при проверке переноса.
"""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import json
import math
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("catalog.json").read_text(encoding="utf-8"))
PRODUCTS = CATALOG["products"]
ROUTES = CATALOG["routes"]
IDS = list(PRODUCTS)
VERSION = CATALOG["version"]
EPS = 1e-7
LABEL = "Иллюстрация: учебные данные"
NAMES = {
    "totalInput": "Доступное сырьё", "rawCost": "Цена сырья", "capacity": "Мощность разделки",
    "hours": "Рабочее время", "rate": "Скорость разделки", "minWhole": "Минимальный заказ тушки",
    "cut": "Вход разделки", "coldCapacity": "Ёмкость хранения", "freezeCost": "Стоимость заморозки",
    "prices": "цена реализации", "demand": "общий спрос", "orders": "подтверждённый заказ",
    "service": "стоимость обслуживания", "frozenPrices": "цена замороженного продукта",
    "weeks": "Число недель", "execution": "Доля исполнения", "investment": "Объём вложений",
    "annualOpex": "Стоимость сопровождения за год",
}


def total(values):
    """Сохраняет последовательность сложения канонической JS-модели."""
    result = 0
    for value in values:
        result += value
    return result


def request_items(requests):
    """Числовые ключи сохраняют порядок Object.entries исходного макета."""
    indexed, named = [], []
    for key, value in requests.items():
        if key.isascii() and key.isdecimal() and str(int(key)) == key and int(key) < 4_294_967_295:
            indexed.append((int(key), key, value))
        else:
            named.append((key, value))
    return [(key, value) for _, key, value in sorted(indexed)] + named


def defaults():
    return deepcopy(CATALOG["defaults"])


def zero():
    return dict.fromkeys(IDS, 0)


def display(value):
    """Русский формат, округление половины от нуля как Intl.NumberFormat."""
    rounded = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    integer, dot, fraction = format(rounded, "f").partition(".")
    sign = "-" if integer.startswith("-") else ""
    digits = integer.lstrip("-")
    groups = []
    while digits:
        groups.insert(0, digits[-3:])
        digits = digits[:-3]
    tail = fraction.rstrip("0")
    return sign + "\u00a0".join(groups) + ("," + tail if tail else "")


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalize(input_params=None):
    incoming = input_params or {}
    d = defaults()
    p = {**d, **deepcopy(incoming)}
    for key in ("prices", "demand", "orders", "service", "routeCosts", "frozenPrices", "stageCapacity"):
        p[key] = {**d[key], **(incoming.get(key) or {})}
    p["requests"] = deepcopy(incoming.get("requests") or {})
    if p["route"] == "whole":
        p["cut"] = 0
    return p


def validate(p):
    errors = []
    for key in ("totalInput", "rawCost", "capacity", "hours", "rate", "minWhole", "cut", "coldCapacity", "freezeCost"):
        if not finite(p[key]) or p[key] < 0:
            errors.append(NAMES[key] + " требует конечного числа ≥ 0")
    if p["route"] not in ROUTES:
        errors.append("Схема разделки требует выбора из справочника")
    for key in ("prices", "demand", "orders", "service", "frozenPrices"):
        for product in IDS:
            if not finite(p[key][product]) or p[key][product] < 0:
                errors.append(PRODUCTS[product]["name"] + ": " + NAMES[key] + " требует числа ≥ 0")
    for key in ("routeCosts", "stageCapacity"):
        for item, value in p[key].items():
            if not finite(value) or value < 0:
                name = (ROUTES.get(item, {}).get("name", "Выбранный маршрут") + ": стоимость обработки") if key == "routeCosts" else {"deboning": "Мощность обвалки", "packing": "Мощность упаковки", "freezing": "Мощность заморозки"}.get(item, "Мощность передела")
                errors.append(name + " требует числа ≥ 0")
    if finite(p["totalInput"]) and finite(p["cut"]) and p["cut"] > p["totalInput"] + EPS:
        errors.append("Вход разделки превышает доступное сырьё")
    for request_id, request in request_items(p["requests"]):
        if not request or request.get("product") not in PRODUCTS or not finite(request.get("quantity")) or request["quantity"] <= 0 or not finite(request.get("price")) or request["price"] < 0 or not finite(request.get("service")) or request["service"] < 0:
            errors.append("Заявка " + request_id + " требует проверки количества и условий")
    for product in IDS:
        order = max(p["minWhole"], p["orders"][product]) if product == "whole" else p["orders"][product]
        if order > p["demand"][product] + EPS:
            errors.append(PRODUCTS[product]["name"] + ": обязательства превышают общий спрос")
        reserved = total(r.get("quantity", 0) or 0 for _, r in request_items(p["requests"]) if r and r.get("product") == product)
        if reserved > p["orders"][product] + EPS:
            errors.append(PRODUCTS[product]["name"] + ": резерв заявки превышает подтверждённый объём")
    return errors


def stage(identifier, name, load, capacity, active):
    return {"id": identifier, "name": name, "load": load, "capacity": capacity, "unit": "т за неделю", "utilization": load / capacity if capacity > 0 else (None if load > EPS else 0), "binding": active and load >= capacity - EPS, "active": active, "sourceStatus": "Учебная мощность; действующую норму подтверждает производство"}


def allocate(product, quantity, p):
    order = max(p["minWhole"], p["orders"][product]) if product == "whole" else p["orders"][product]
    reqs = [(key, r) for key, r in request_items(p["requests"]) if r["product"] == product]
    reserved = total(r["quantity"] for _, r in reqs)
    old_sold = min(quantity, max(0, order - reserved))
    remainder = quantity - old_sold
    revenue = old_sold * p["prices"][product] * 1000
    service_cost = old_sold * p["service"][product] * 1000
    request_rows = []
    for request_id, request in reqs:
        sold = min(remainder, request["quantity"])
        remainder -= sold
        revenue += sold * request["price"] * 1000
        service_cost += sold * request["service"] * 1000
        request_rows.append({"requestId": request_id, **request, "sold": sold, "shortfall": request["quantity"] - sold})
    order_sold = old_sold + total(r["sold"] for r in request_rows)
    forecast = max(0, p["demand"][product] - order)
    forecast_sold = min(remainder, forecast)
    remainder -= forecast_sold
    revenue += forecast_sold * p["prices"][product] * 1000
    service_cost += forecast_sold * p["service"][product] * 1000
    return {"product": product, "produced": quantity, "orders": order, "forecast": forecast, "demand": p["demand"][product], "orderSold": order_sold, "forecastSold": forecast_sold, "sold": order_sold + forecast_sold, "remaining": remainder, "shortfall": max(0, order - order_sold), "revenue": revenue, "serviceCost": service_cost, "price": p["prices"][product], "requestRows": request_rows}


def evaluate(input_params=None):
    p = normalize(input_params)
    errors = validate(p)
    if errors:
        return {"valid": False, "feasible": False, "errors": errors, "violations": errors, "signals": [{"level": "bad", "title": label, "detail": "Параметры требуют проверки", "action": "Проверить ввод", "owner": "Планирование"} for label in errors], "params": p, "produced": zero(), "allocations": {}, "stages": [], "contribution": None, "expectedContribution": None, "inventoryT": None}
    route = ROUTES[p["route"]]
    cut = p["cut"]
    whole = p["totalInput"] - cut
    produced = zero()
    produced["whole"] = whole
    for product, share in route["yields"].items():
        produced[product] = cut * share
    loss = cut * route["loss"]
    mass_balance = p["totalInput"] - total(produced.values()) - loss
    allocations = {product: allocate(product, produced[product], p) for product in IDS}
    inventory = total(allocations[product]["remaining"] for product in IDS)
    inventory_value = total(allocations[product]["remaining"] * p["frozenPrices"][product] * 1000 for product in IDS)
    revenue = total(allocations[product]["revenue"] for product in IDS)
    service_cost = total(allocations[product]["serviceCost"] for product in IDS)
    raw_cost = p["totalInput"] * p["rawCost"] * 1000
    route_cost = (whole * p["routeCosts"]["whole"] + cut * p["routeCosts"][p["route"]]) * 1000
    freeze_cost = inventory * p["freezeCost"] * 1000
    contribution = revenue - service_cost - raw_cost - route_cost - freeze_cost
    effective_capacity = min(p["capacity"], p["hours"] * p["rate"])
    stages = [stage("cutting", "Разделка", cut, effective_capacity, cut > EPS), stage("deboning", "Обвалка", cut * route["deboneInputShare"], p["stageCapacity"]["deboning"], route["deboneInputShare"] > 0 and cut > EPS), stage("packing", "Упаковка", total(produced.values()), p["stageCapacity"]["packing"], p["totalInput"] > EPS), stage("freezing", "Заморозка", inventory, p["stageCapacity"]["freezing"], inventory > EPS)]
    storage = {"load": inventory, "capacity": p["coldCapacity"], "unit": "т единовременно", "utilization": inventory / p["coldCapacity"] if p["coldCapacity"] > 0 else (None if inventory > EPS else 0), "binding": inventory > EPS and inventory >= p["coldCapacity"] - EPS, "sourceStatus": "Учебная ёмкость хранения"}
    violations = []
    if whole + EPS < p["minWhole"]:
        violations.append("Тушка: разрыв обязательства " + display(p["minWhole"] - whole) + " т")
    for s in stages:
        if s["load"] > s["capacity"] + EPS:
            violations.append(s["name"] + ": загрузка превышает мощность на " + display(s["load"] - s["capacity"]) + " т")
    if inventory > p["coldCapacity"] + EPS:
        violations.append("Хранение: остаток превышает ёмкость на " + display(inventory - p["coldCapacity"]) + " т")
    for product in IDS:
        if allocations[product]["shortfall"] > EPS and not (product == "whole" and whole < p["minWhole"]):
            violations.append(PRODUCTS[product]["name"] + ": разрыв заказа " + display(allocations[product]["shortfall"]) + " т")
    if abs(mass_balance) > EPS:
        violations.append("Материальный баланс требует сверки выходов")
    signals = [{"level": "bad", "title": label, "detail": "Условие ограничивает утверждение", "action": "Изменить план", "owner": "Планирование"} for label in violations]
    if inventory > EPS:
        signals.append({"level": "warn", "title": "Остаток " + display(inventory) + " т требует будущей реализации", "detail": "Текущая выручка учитывает размещённые продажи; будущая оценка запаса показана отдельно", "action": "Подтвердить спрос и срок", "owner": "Коммерция и склад"})
    for s in stages:
        if s["active"] and s["binding"] and s["load"] <= s["capacity"] + EPS:
            signals.append({"level": "warn", "title": s["name"] + ": мощность задействована полностью", "detail": "Дополнительный выпуск требует изменения мощности или маршрута", "action": "Проверить доступные часы", "owner": "Производство"})
    if not violations:
        signals.append({"level": "ok", "title": "План выполняет заданные ограничения", "detail": "Выходы, обязательства и ресурсы проверены на учебных параметрах", "action": "Сравнить варианты", "owner": "Планирование"})
    return {"valid": True, "feasible": not violations, "errors": [], "violations": violations, "signals": signals, "params": p, "route": p["route"], "cut": cut, "whole": whole, "produced": produced, "loss": loss, "massBalance": mass_balance, "allocations": allocations, "revenue": revenue, "serviceCost": service_cost, "rawCost": raw_cost, "routeCost": route_cost, "freezeCost": freeze_cost, "contribution": contribution, "inventoryT": inventory, "inventoryValue": inventory_value, "expectedContribution": contribution + inventory_value, "stages": stages, "storage": storage, "effectiveCapacity": effective_capacity, "upstream": {"name": "Охлаждённая тушка после убоя", "quantity": p["totalInput"], "unit": "т", "scope": "Вход модели; живой вес и убой требуют отдельного пересчёта"}, "label": LABEL}


def candidate(p, cut, identifier, name, route=None):
    result = evaluate({**deepcopy(p), "cut": cut, "route": route or p["route"]})
    return {"id": identifier, "name": name, "label": name, "params": result["params"], "result": result}


def best_contribution(items, result_key=None):
    best = None
    for item in items:
        value = item[result_key] if result_key else item
        previous = best[result_key] if result_key and best else best
        if best is None or value["contribution"] > previous["contribution"] + EPS:
            best = item
    return best


def alternatives(input_params=None):
    p = normalize(input_params)
    candidates = [candidate(p, 0, "whole", "Вся партия тушкой")] if p["route"] == "whole" else [candidate(p, p["totalInput"] * share, "option-" + str(index), name) for index, (share, name) in enumerate(((.3, "Разделка 30%"), (.4, "Разделка 40%"), (.5, "Разделка 50%")))]
    best = best_contribution([c for c in candidates if c["result"]["feasible"]], "result")
    baseline = candidate(p, p["totalInput"] * .4, "baseline", "База: филе и ножки, 40%", "fillet")
    return {"candidates": candidates, "best": best, "baseline": baseline, "comparable": baseline["result"]["feasible"], "method": "Лучший из проверенных вариантов по результату размещённых продаж", "label": LABEL}


def check_request(input_params, request):
    p = normalize(input_params)
    r = {"service": 0, "forecastAbsorption": True, **request}
    errors = []
    if not isinstance(r.get("requestId"), str) or not r["requestId"] or r["requestId"] in ("__proto__", "constructor", "prototype"):
        errors.append("Заявка требует допустимого идентификатора")
    if r.get("product") not in PRODUCTS:
        errors.append("Заявка требует продукта из справочника")
    if not finite(r.get("quantity")) or r["quantity"] <= 0:
        errors.append("Количество заявки требует числа > 0")
    if not finite(r.get("price")) or r["price"] < 0 or not finite(r["service"]) or r["service"] < 0:
        errors.append("Цена и обслуживание требуют чисел ≥ 0")
    before = evaluate(p)
    errors.extend(before["errors"])
    if errors:
        return {"valid": False, "feasible": False, "canApply": False, "errors": errors, "params": p}
    request_id, product = r["requestId"], r["product"]
    if request_id in p["requests"]:
        return {"valid": True, "feasible": False, "duplicate": True, "canApply": False, "errors": [], "params": p, "result": before, "acceptedQuantity": p["requests"][request_id]["quantity"], "message": "Заявка уже включена в резерв"}
    order = max(p["minWhole"], p["orders"]["whole"]) if product == "whole" else p["orders"][product]
    forecast_consumed = min(r["quantity"], max(0, p["demand"][product] - order)) if r["forecastAbsorption"] else 0
    p["orders"][product] = order + r["quantity"]
    p["demand"][product] += r["quantity"] - forecast_consumed
    p["requests"][request_id] = {key: r[key] for key in ("product", "quantity", "price", "service")}
    current = evaluate(p)
    route = ROUTES[p["route"]]
    max_cut = max(0, min(p["capacity"], p["hours"] * p["rate"], p["totalInput"] - p["minWhole"], p["stageCapacity"]["deboning"] / route["deboneInputShare"] if route["deboneInputShare"] > 0 else p["totalInput"]))
    target = max(0, p["totalInput"] - p["orders"]["whole"]) if product == "whole" else (p["orders"][product] / route["yields"][product] if route["yields"].get(product) else p["cut"])
    cuts = [0] if p["route"] == "whole" else list(dict.fromkeys([p["cut"], max_cut, min(max_cut, target), p["totalInput"] * .3, p["totalInput"] * .4, p["totalInput"] * .5]))
    options = [evaluate({**p, "cut": cut}) for cut in cuts]
    admissible = [v for v in options if v["feasible"]]

    def row(v):
        return next(x for x in v["allocations"][product]["requestRows"] if x["requestId"] == request_id)

    partial = [v for v in options if v["valid"] and v["whole"] + EPS >= v["params"]["minWhole"] and all(s["load"] <= s["capacity"] + EPS for s in v["stages"]) and v["storage"]["load"] <= v["storage"]["capacity"] + EPS and all(v["allocations"][key]["shortfall"] <= (r["quantity"] if key == product else 0) + EPS for key in IDS)]
    partial_best = None
    for v in partial:
        if partial_best is None or row(v)["sold"] > row(partial_best)["sold"] + EPS or (abs(row(v)["sold"] - row(partial_best)["sold"]) < EPS and v["contribution"] > partial_best["contribution"] + EPS):
            partial_best = v
    result = best_contribution(admissible) or partial_best or current
    covered = row(result)["sold"]
    delta = result["contribution"] - before["contribution"]
    can_apply = result["feasible"] and covered >= r["quantity"] - EPS
    return {"valid": True, "feasible": can_apply, "duplicate": False, "canApply": can_apply, "errors": [], "violations": result["violations"], "params": result["params"], "result": result, "requested": r["quantity"], "covered": covered, "acceptedQuantity": covered, "shortfall": r["quantity"] - covered, "forecastConsumed": forecast_consumed, "incrementalDemand": r["quantity"] - forecast_consumed, "extraCut": result["cut"] - before["cut"], "additionalCut": result["cut"] - before["cut"], "relatedOutputs": {key: result["produced"][key] - before["produced"][key] for key in IDS if key != product}, "deltaContribution": delta, "currentCoverage": row(current)["sold"], "requiresReplan": abs(result["cut"] - before["cut"]) > EPS, "message": "Заявка получает полный резерв" if can_apply else "Заявка требует изменения плана", "explanation": "Покрытие " + display(covered) + " из " + display(r["quantity"]) + " т; перевод прогноза в заказ " + display(forecast_consumed) + " т; изменение вклада " + display(delta / 1000) + " тыс руб"}


def snapshot(input_params, confirmations=None):
    result = evaluate(input_params)
    confirms = confirmations or {}
    missing = [keys for keys in (("com", "commercial"), ("prod", "production"), ("fin", "finance")) if not any(confirms.get(key) is True for key in keys)]
    if not result["feasible"] or missing:
        return {"valid": False, "approved": False, "errors": result["violations"] + (["Подтверждения коммерции, производства и финансов завершают согласование"] if missing else [])}
    return {"valid": True, "approved": True, "params": deepcopy(result["params"]), "result": deepcopy(result), "confirmations": deepcopy(confirms), "label": "Утверждённый учебный снимок"}


def fact(input_params):
    source = input_params.get("params", input_params)
    plan = evaluate(source)
    if not plan["valid"]:
        return {"valid": False, "errors": plan["errors"]}
    p = deepcopy(plan["params"])
    p["prices"]["fillet"] -= min(5, p["prices"]["fillet"])
    for r in p["requests"].values():
        if r["product"] == "fillet":
            r["price"] = max(0, r["price"] - 5)
    price_result = evaluate(p)
    if p["route"] != "whole":
        p["routeCosts"][p["route"]] += .2
    actual = evaluate(p)
    price_delta = price_result["contribution"] - plan["contribution"]
    cost_delta = actual["contribution"] - price_result["contribution"]
    return {"valid": True, "plan": plan["contribution"], "actual": actual["contribution"], "delta": actual["contribution"] - plan["contribution"], "priceDelta": price_delta, "costDelta": cost_delta, "execution": actual["contribution"] / plan["contribution"] if plan["contribution"] > 0 else None, "planResult": plan, "actualResult": actual, "rows": [{"id": "plan", "name": "Утверждённый план", "value": plan["contribution"], "kind": "total"}, {"id": "price", "name": "Цена филе", "value": price_delta, "kind": "delta", "owner": "Коммерция", "formula": "Объём проданного филе × изменение цены"}, {"id": "cost", "name": "Затраты разделки", "value": cost_delta, "kind": "delta", "owner": "Производство", "formula": "Вход разделки × −0,2 руб/кг"}, {"id": "actual", "name": "Учебный факт", "value": actual["contribution"], "kind": "total"}], "label": "Иллюстрация: снижение цены филе в пределах 5 руб/кг, затраты разделки +0,2 руб/кг"}


def roi(input_params, options=None):
    o = {"weeks": 52, "execution": 1, "investment": None, "annualOpex": None, **(options or {})}
    errors = []
    for key in ("weeks", "execution", "investment", "annualOpex"):
        if not (o[key] is None and key in ("investment", "annualOpex")) and (not finite(o[key]) or o[key] < 0):
            errors.append(NAMES[key] + " требует числа ≥ 0")
    if o["execution"] > 1:
        errors.append("Доля исполнения располагается от 0 до 1")
    if not finite(o["weeks"]) or o["weeks"] % 1 != 0 or o["weeks"] > 53:
        errors.append("Календарь года содержит от 0 до 53 целых недель")
    result, baseline = evaluate(input_params), alternatives(input_params)["baseline"]["result"]
    if not result["feasible"] or not baseline["feasible"]:
        errors.append("Годовое сравнение требует двух выполнимых планов")
    if (result["inventoryT"] or 0) > EPS or (baseline["inventoryT"] or 0) > EPS:
        errors.append("Годовое сравнение с запасами требует календаря их реализации")
    if errors:
        return {"eligible": False, "valid": False, "errors": errors, "label": LABEL}
    weekly_effect = result["contribution"] - baseline["contribution"]
    gross_effect = weekly_effect * o["weeks"]
    annual_effect = gross_effect * o["execution"]
    complete = o["annualOpex"] is not None and o["investment"] is not None
    net_effect = annual_effect - o["annualOpex"] if o["annualOpex"] is not None else None
    first_cash = net_effect - o["investment"] if complete else None
    return {"eligible": True, "valid": True, "errors": [], **o, "budgetComplete": complete, "weeklyEffect": weekly_effect, "grossEffect": gross_effect, "annualEffect": annual_effect, "netEffect": net_effect, "firstYearCash": first_cash, "roi": first_cash / o["investment"] if complete and o["investment"] > 0 else None, "paybackYears": o["investment"] / net_effect if complete and o["investment"] > 0 and net_effect > 0 else None, "baseline": baseline, "result": result, "label": "Учебное повторение одинаковых недель", "conditions": ["Одинаковые вход, цены, спрос и мощности во всех неделях", "Продана вся корзина", "Налоги и изменение оборотного капитала требуют отдельного расчёта"]}


def commercial(client):
    net = client["price"] - client["service"]
    return {"net": net, "change": client["volume"] * 1000 * (net * client["share"] / 100 + 135 * (1 - client["share"] / 100) - 180), "threshold": 45 / (net - 135) * 100 if net > 135 else None}


def change_levers(input_params, comparison=None):
    p = normalize(input_params)
    b = normalize(comparison or {**defaults(), "cut": 40})
    fields = [("totalInput", "Доступная тушка", "т"), ("rawCost", "Цена сырья", "руб/кг"), ("capacity", "Мощность разделки", "т"), ("hours", "Доступные часы", "ч"), ("rate", "Скорость разделки", "т/ч"), ("minWhole", "Заказ тушки", "т"), ("cut", "Вход разделки", "т"), ("coldCapacity", "Ёмкость хранения", "т")]
    changes = [{"key": key, "name": name, "before": b[key], "after": p[key], "unit": unit} for key, name, unit in fields if p[key] != b[key]]
    if p["route"] != b["route"]:
        changes.append({"key": "route", "name": "Схема разделки", "before": ROUTES[b["route"]]["name"], "after": ROUTES[p["route"]]["name"], "unit": ""})
    for field in ("prices", "demand", "service"):
        for product in IDS:
            if p[field][product] != b[field][product]:
                changes.append({"key": field + "." + product, "name": PRODUCTS[product]["name"] + ": " + {"prices": "цена", "demand": "спрос", "service": "обслуживание"}[field], "before": b[field][product], "after": p[field][product], "unit": "т" if field == "demand" else "руб/кг"})
    for route in ROUTES:
        if p["routeCosts"][route] != b["routeCosts"][route]:
            changes.append({"key": "routeCosts." + route, "name": ROUTES[route]["name"] + ": переменные затраты", "before": b["routeCosts"][route], "after": p["routeCosts"][route], "unit": "руб/кг входа"})
    for stage_id, name in {"deboning": "Обвалка", "packing": "Упаковка", "freezing": "Заморозка"}.items():
        if p["stageCapacity"][stage_id] != b["stageCapacity"][stage_id]:
            changes.append({"key": "stageCapacity." + stage_id, "name": name + ": мощность", "before": b["stageCapacity"][stage_id], "after": p["stageCapacity"][stage_id], "unit": "т/неделю"})
    return changes
