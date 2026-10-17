"""Проверка баланса массы и загрузки переделов отдельной производственной матрицы."""
import json
import math
from pathlib import Path
import sys


TOLERANCE = 1e-10
UNIT = "кг / сутки"
CARCASS_BASIS = "кг потрошеной тушки"


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _number(value, label):
    try:
        valid = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    _require(valid, f"{label}: требуется конечное число от нуля")
    return value


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _index(value, count, label):
    _require(isinstance(value, list) and len(value) == count, f"{label}: требуется {count} записей")
    result = {}
    for row in value:
        _require(isinstance(row, dict) and _text(row.get("id")), f"{label}: требуется идентификатор записи")
        _require(row["id"] not in result, f"{label}: идентификатор {row['id']} повторяется")
        result[row["id"]] = row
    return result


def _references(value, label):
    _require(isinstance(value, list) and bool(value), f"{label}: требуется ссылка на источник")
    for ref in value:
        _require(isinstance(ref, dict), f"{label}: ссылка требует объект")
        for field in ("source_id", "sheet", "cell"):
            _require(_text(ref.get(field)), f"{label}: ссылка требует поле {field}")
        _require("formula" in ref and (ref["formula"] is None or isinstance(ref["formula"], str)), f"{label}: ссылка требует формулу либо null")
        _require("saved_value" in ref, f"{label}: ссылка требует сохраненное значение")
        saved = ref["saved_value"]
        _require(saved is None or isinstance(saved, (str, bool, int, float)), f"{label}: сохраненное значение требует скаляр")
        if isinstance(saved, (int, float)) and not isinstance(saved, bool):
            try:
                finite = math.isfinite(saved)
            except OverflowError:
                finite = False
            _require(finite, f"{label}: сохраненное число требует конечное значение")


def _ids(value, known, label):
    _require(isinstance(value, list) and all(isinstance(x, str) and x in known for x in value), f"{label}: требуется список известных идентификаторов")
    _require(len(value) == len(set(value)), f"{label}: идентификаторы повторяются")
    return value


def validate_chain(matrix):
    """Проверяет принадлежность операций и единицы полного производственного графа."""
    _require(isinstance(matrix, dict), "Производственная цепочка требует объект")
    records = {}
    for key, label, count in (("chain_nodes", "Узлы цепочки", 13), ("sections", "Разделы", None), ("operations", "Операции", 27), ("equipment", "Оборудование", None), ("chain_links", "Связи цепочки", None), ("stages", "Переделы", 17), ("gaps", "Пробелы исходных данных", None)):
        value = matrix.get(key)
        _require(isinstance(value, list), f"{label}: требуется список")
        records[key] = _index(value, len(value) if count is None else count, label)
    nodes, sections, operations, equipment, links, stages, gaps = (records[key] for key in ("chain_nodes", "sections", "operations", "equipment", "chain_links", "stages", "gaps"))
    owned_sections, owned_operations = set(), set()
    for node_id, node in nodes.items():
        _require(_text(node.get("name")), f"Узел {node_id}: требуется название")
        section_ids = _ids(node.get("section_ids"), sections, f"Узел {node_id}")
        _require(bool(section_ids), f"Узел {node_id}: требуется раздел с операцией")
        for section_id in section_ids:
            _require(section_id not in owned_sections and sections[section_id].get("node_id") == node_id, f"Раздел {section_id}: требуется принадлежность одному узлу")
            owned_sections.add(section_id)
    _require(owned_sections == set(sections), "Каждый раздел требует включения в узел цепочки")
    for section_id, section in sections.items():
        _require(_text(section.get("name")), f"Раздел {section_id}: требуется название")
        operation_ids = _ids(section.get("operation_ids"), operations, f"Раздел {section_id}")
        _require(bool(operation_ids), f"Раздел {section_id}: требуется операция")
        for operation_id in operation_ids:
            _require(operation_id not in owned_operations and operations[operation_id].get("section_id") == section_id, f"Операция {operation_id}: требуется принадлежность одному разделу")
            owned_operations.add(operation_id)
    _require(owned_operations == set(operations), "Каждая операция требует включения в раздел")
    for equipment_id, item in equipment.items():
        for field in ("name", "model", "inventory_number"):
            _require(field in item and (item[field] is None or _text(item[field])), f"Оборудование {equipment_id}: поле {field} требует текст либо null")
        _require(_text(item.get("status")), f"Оборудование {equipment_id}: требуется статус")
    operation_stages = {}
    for operation_id, operation in operations.items():
        if "name" in operation:
            _require(_text(operation["name"]), f"Операция {operation_id}: название требует текст")
        _require(_text(operation.get("status")) and _text(operation.get("mass_basis")), f"Операция {operation_id}: требуются статус и база массы")
        equipment_ids = _ids(operation.get("equipment_ids"), equipment, f"Оборудование операции {operation_id}")
        gap_ids = _ids(operation.get("gap_ids"), gaps, f"Пробелы операции {operation_id}")
        kind, unit = operation.get("capacity_kind"), operation.get("capacity_unit")
        _require(kind in ("throughput", "inventory", "cycle_output", "demand"), f"Операция {operation_id}: требуется известный вид мощности")
        valid_units = ("кг", "голов") if kind in ("inventory", "cycle_output") else (UNIT, "яиц / сутки", "голов / сутки")
        _require(unit in valid_units, f"Операция {operation_id}: единица требует соответствия виду мощности {kind}")
        _require("capacity_value" in operation and "stage_id" in operation, f"Операция {operation_id}: требуются мощность и передел либо null")
        capacity, stage_id = operation["capacity_value"], operation["stage_id"]
        if capacity is not None:
            _number(capacity, f"Мощность операции {operation_id}")
        if stage_id is not None:
            _require(isinstance(stage_id, str) and stage_id in stages and stage_id not in operation_stages, f"Операция {operation_id}: требуется отдельный известный передел")
            operation_stages[stage_id] = sections[operation["section_id"]]["node_id"]
            stage = stages[stage_id]
            _require(kind == "throughput" and unit == stage.get("unit") and operation["mass_basis"] == stage.get("mass_basis"), f"Операция {operation_id}: база и единица требуют совпадения с переделом")
            if capacity is not None:
                expected = _number(stage.get("capacity_kg_day"), f"Мощность передела {stage_id}")
                _require(math.isclose(capacity, expected, rel_tol=0, abs_tol=TOLERANCE), f"Операция {operation_id}: мощность требует совпадения с переделом")
        missing_equipment = not equipment_ids or any(any(equipment[x][field] is None for field in ("name", "model", "inventory_number")) for x in equipment_ids)
        if capacity is None or stage_id is None or missing_equipment:
            _require(bool(gap_ids), f"Операция {operation_id}: пропуски паспорта требуют ссылки на пробелы данных")
    _require(set(operation_stages) == set(stages), "Операции требуют покрытия всех 17 переделов ровно по одному разу")
    stage_links = matrix.get("stage_node_links")
    _require(isinstance(stage_links, list) and len(stage_links) == 17, "Связи переделов с узлами требуют 17 записей")
    linked_stages = set()
    for link in stage_links:
        _require(isinstance(link, dict), "Связь передела с узлом требует объект")
        stage_id, node_id = link.get("stage_id"), link.get("chain_node_id")
        _require(isinstance(stage_id, str) and stage_id in stages and stage_id not in linked_stages, "Связь передела с узлом требует отдельный известный передел")
        _require(isinstance(node_id, str) and node_id in nodes and node_id == operation_stages[stage_id], f"Передел {stage_id}: узел связи требует совпадения с операцией")
        linked_stages.add(stage_id)
    neighbours = {node_id: set() for node_id in nodes}
    for link_id, link in links.items():
        _require(all(isinstance(link.get(key), str) and link[key] in nodes for key in ("from_node_id", "to_node_id")), f"Связь {link_id}: требуются известные узлы")
        _require(link["from_node_id"] != link["to_node_id"], f"Связь {link_id}: требуются разные узлы")
        neighbours[link["from_node_id"]].add(link["to_node_id"])
        neighbours[link["to_node_id"]].add(link["from_node_id"])
        _require(all(_text(link.get(key)) for key in ("flow_name", "coefficient_unit", "status")), f"Связь {link_id}: требуются название потока, единица коэффициента и статус")
        gap_ids = _ids(link.get("gap_ids"), gaps, f"Пробелы связи {link_id}")
        for key in ("coefficient", "time_lag_days"):
            _require(key in link, f"Связь {link_id}: требуется поле {key}")
            if link[key] is None:
                _require(bool(gap_ids), f"Связь {link_id}: пропуски коэффициента и срока требуют ссылки на пробелы данных")
            else:
                _number(link[key], f"Связь {link_id} / {key}")
    reached, pending = set(), [next(iter(nodes))]
    while pending:
        node_id = pending.pop()
        if node_id not in reached:
            reached.add(node_id)
            pending.extend(neighbours[node_id] - reached)
    _require(reached == set(nodes), "Все 13 узлов требуют общей связной производственной цепочки")
    return {"chain_nodes": len(nodes), "sections": len(sections), "operations": len(operations), "equipment": len(equipment), "chain_links": len(links), "mapped_stages": len(linked_stages)}


def validate_matrix(matrix):
    """Проверяет полный контракт; ошибка содержит русское пояснение."""
    _require(isinstance(matrix, dict), "Матрица требует объект")
    _require(type(matrix.get("schema_version")) is int and matrix["schema_version"] == 1, "Версия структуры требует значение 1")
    products = _index(matrix.get("products"), 22, "Продукты")
    routes = _index(matrix.get("routes"), 5, "Схемы")
    stages = _index(matrix.get("stages"), 17, "Переделы")
    for label, records in (("Продукт", products), ("Схема", routes), ("Передел", stages)):
        for row in records.values():
            _require(_text(row.get("name")), f"{label} {row['id']}: требуется название")
    for product in products.values():
        _require(_text(product.get("category")), f"Продукт {product['id']}: требуется категория")
    gaps = matrix.get("gaps")
    _require(isinstance(gaps, list), "Пробелы исходных данных требуют список")
    gap_ids = set(_index(gaps, len(gaps), "Пробелы исходных данных"))
    route_outputs = {}
    for route_id, route in routes.items():
        _require(str(route.get("basis", "")).replace("\u0451", "е") == CARCASS_BASIS, f"Схема {route_id}: база требует {CARCASS_BASIS}")
        _require(route.get("loss_product_id") == "waste_loss", f"Схема {route_id}: потери требуют идентификатор waste_loss")
        outputs = route.get("outputs")
        _require(isinstance(outputs, list) and len(outputs) == 22, f"Схема {route_id}: требуется 22 выхода")
        coefficients = {}
        for output in outputs:
            _require(isinstance(output, dict), f"Схема {route_id}: выход требует объект")
            product_id = output.get("product_id")
            _require(isinstance(product_id, str) and product_id in products, f"Схема {route_id}: выход требует известный продукт")
            _require(product_id not in coefficients, f"Схема {route_id}: продукт {product_id} повторяется")
            coefficients[product_id] = _number(output.get("coefficient_kg_per_kg"), f"Выход {route_id} / {product_id}")
            _require(coefficients[product_id] <= 1 + TOLERANCE, f"Выход {route_id} / {product_id}: доля требует значения до единицы")
            _references(output.get("source_refs"), f"Выход {route_id} / {product_id}")
        _require(set(coefficients) == set(products) and "waste_loss" in coefficients, f"Схема {route_id}: требуется полный состав продуктов с одной строкой потерь")
        _require(math.isclose(math.fsum(coefficients.values()), 1, rel_tol=0, abs_tol=TOLERANCE), f"Схема {route_id}: сумма выходов вместе с потерями требует единицу")
        route_outputs[route_id] = coefficients
    for stage_id, stage in stages.items():
        _require(stage.get("unit") == UNIT, f"Передел {stage_id}: единица требует {UNIT}")
        _require(_text(stage.get("mass_basis")), f"Передел {stage_id}: требуется база массы")
        if "shared_flow_id" in stage:
            _require(_text(stage["shared_flow_id"]), f"Передел {stage_id}: общий поток требует идентификатор")
        _number(stage.get("capacity_kg_day"), f"Мощность {stage_id}")
        _references(stage.get("source_refs"), f"Передел {stage_id}")
    rows = matrix.get("route_stage_matrix")
    _require(isinstance(rows, list) and len(rows) == 85, "Матрица схем и переделов требует 85 строк")
    pairs = set()
    for row in rows:
        _require(isinstance(row, dict), "Строка матрицы требует объект")
        route_id, stage_id = row.get("route_id"), row.get("stage_id")
        _require(isinstance(route_id, str) and route_id in routes, "Строка матрицы требует известную схему")
        _require(isinstance(stage_id, str) and stage_id in stages, "Строка матрицы требует известный передел")
        pair = (route_id, stage_id)
        _require(pair not in pairs, f"Матрица: пара {route_id} / {stage_id} повторяется")
        pairs.add(pair)
        label = f"Матрица {route_id} / {stage_id}"
        _require(row.get("demand_basis") == stages[stage_id]["mass_basis"], f"{label}: база потребности требует совпадения с базой мощности")
        calculation = row.get("calculation")
        _require(calculation in ("route_outputs", "weighted_route_outputs", "explicit_flow_required", "mapping_required"), f"{label}: требуется известный способ расчета")
        ids = row.get("product_ids")
        _require(isinstance(ids, list) and all(isinstance(x, str) and x in products for x in ids), f"{label}: требуется список известных продуктов")
        _require(len(ids) == len(set(ids)), f"{label}: продукты повторяются")
        row_gaps = row.get("gap_ids")
        _require(isinstance(row_gaps, list) and all(isinstance(x, str) and x in gap_ids for x in row_gaps), f"{label}: требуется список известных пробелов данных")
        _require(len(row_gaps) == len(set(row_gaps)), f"{label}: пробелы данных повторяются")
        _references(row.get("source_refs"), label)
        _require("coefficient_kg_per_kg_carcass" in row, f"{label}: требуется коэффициент либо null")
        coefficient = row["coefficient_kg_per_kg_carcass"]
        if calculation in ("route_outputs", "weighted_route_outputs"):
            _require(bool(ids), f"{label}: расчет по выходам требует выбранные продукты")
            _number(coefficient, label)
            weights = dict.fromkeys(ids, 1)
            if calculation == "weighted_route_outputs":
                product_coefficients = row.get("product_coefficients")
                _require(isinstance(product_coefficients, list) and len(product_coefficients) == len(ids), f"{label}: признаки прохождения требуют всех выбранных продуктов")
                weights = {}
                for item in product_coefficients:
                    _require(isinstance(item, dict), f"{label}: признак прохождения требует объект")
                    product_id = item.get("product_id")
                    _require(isinstance(product_id, str) and product_id in ids and product_id not in weights, f"{label}: признак прохождения требует отдельный выбранный продукт")
                    weight = _number(item.get("coefficient"), f"{label} / {product_id}")
                    _require(weight in (0, 1), f"{label} / {product_id}: признак прохождения требует 0 либо 1")
                    _references(item.get("source_refs"), f"{label} / {product_id}")
                    weights[product_id] = weight
            expected = math.fsum(route_outputs[route_id][product_id] * weights[product_id] for product_id in ids)
            _require(math.isclose(coefficient, expected, rel_tol=0, abs_tol=TOLERANCE), f"{label}: коэффициент требует суммы выбранных выходов")
        else:
            _require(coefficient is None, f"{label}: исходный поток требует коэффициент null")
    _require(pairs == {(route_id, stage_id) for route_id in routes for stage_id in stages}, "Матрица требует каждую пару схемы и передела")
    if "chain_nodes" in matrix:
        validate_chain(matrix)
    return {"routes": len(routes), "products": len(products), "stages": len(stages), "route_stage_rows": len(rows), "balanced_routes": len(routes)}


def evaluate_route(matrix, route_id, carcass_kg_day, provided_flows=None):
    """Рассчитывает отдельные нагрузки, сохраняя неизвестные значения как null."""
    validate_matrix(matrix)
    carcass_kg_day = _number(carcass_kg_day, "Вход тушки")
    routes = {route["id"]: route for route in matrix["routes"]}
    _require(isinstance(route_id, str) and route_id in routes, "Расчет требует известную схему")
    rows = {row["stage_id"]: row for row in matrix["route_stage_matrix"] if row["route_id"] == route_id}
    flows = {} if provided_flows is None else provided_flows
    _require(isinstance(flows, dict), "Явные потоки требуют объект")
    stages = {stage["id"]: stage for stage in matrix["stages"]}
    shared_flows = {}
    for stage_id, flow in flows.items():
        _require(stage_id in stages, "Явный поток требует известный передел")
        _require(rows[stage_id]["calculation"] not in ("route_outputs", "weighted_route_outputs"), f"Передел {stage_id}: нагрузку определяют выходы схемы")
        _require(isinstance(flow, dict), f"Поток {stage_id}: требуется объект")
        _number(flow.get("quantity"), f"Поток {stage_id}")
        _require(flow.get("unit") == UNIT, f"Поток {stage_id}: единица требует {UNIT}")
        _require(flow.get("mass_basis") == stages[stage_id]["mass_basis"], f"Поток {stage_id}: база требует совпадения с мощностью")
        shared = stages[stage_id].get("shared_flow_id")
        if shared:
            _require(shared not in shared_flows or math.isclose(flow["quantity"], shared_flows[shared], rel_tol=0, abs_tol=TOLERANCE), f"Общий поток {shared}: последовательные операции требуют одинакового количества")
            shared_flows[shared] = flow["quantity"]
    output_masses = {out["product_id"]: carcass_kg_day * out["coefficient_kg_per_kg"] for out in routes[route_id]["outputs"]}
    output_total = math.fsum(output_masses.values())
    stage_loads = []
    exceeded = False
    for stage_id, stage in stages.items():
        row = rows[stage_id]
        calculation = row["calculation"]
        load = None
        status = "Требуется соответствие продуктов переделу" if calculation == "mapping_required" else "Требуется явный поток"
        if calculation == "route_outputs":
            load = math.fsum(output_masses[product_id] for product_id in row["product_ids"])
        elif calculation == "weighted_route_outputs":
            load = carcass_kg_day * row["coefficient_kg_per_kg_carcass"]
        elif calculation == "explicit_flow_required" and stage_id in flows:
            load = flows[stage_id]["quantity"]
        capacity = stage["capacity_kg_day"]
        utilization = None
        if load is not None:
            utilization = load / capacity if capacity else (0 if load == 0 else None)
            if utilization is not None and not math.isfinite(utilization):
                utilization = None
            above = load > capacity + TOLERANCE
            exceeded = exceeded or above
            status = "Превышение мощности" if above else "Мощность достаточна"
        stage_loads.append({"stage_id": stage_id, "name": stage["name"], "unit": UNIT, "mass_basis": stage["mass_basis"], "load": load, "capacity": capacity, "utilization": utilization, "status": status})
    complete = all(stage["load"] is not None for stage in stage_loads)
    result = {"route_id": route_id, "output_masses": output_masses,
            "balance": {"input_kg_day": carcass_kg_day, "output_kg_day": output_total, "difference_kg_day": carcass_kg_day - output_total, "balanced": math.isclose(output_total, carcass_kg_day, rel_tol=TOLERANCE, abs_tol=TOLERANCE)},
            "stage_loads": stage_loads, "complete": complete, "feasible": False if exceeded else True if complete else None}
    if "chain_nodes" in matrix:
        result.update(calculation_scope="17 переделов исторической карты", full_chain_feasible=None)
    return result


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Запуск: python validate_routes.py путь_к_матрице.json", file=sys.stderr)
        return 2
    try:
        matrix = json.loads(Path(args[0]).read_text(encoding="utf-8"))
        result = validate_matrix(matrix)
    except (OSError, UnicodeError):
        print("Файл матрицы требует доступного пути и кодировки UTF-8", file=sys.stderr)
        return 1
    except json.JSONDecodeError as error:
        print(f"Структура JSON требует проверки: строка {error.lineno}, столбец {error.colno}", file=sys.stderr)
        return 1
    except (ValueError, TypeError) as error:
        print(f"Проверка выявила ошибку: {error}", file=sys.stderr)
        return 1
    print(f"Проверка пройдена: {result['routes']} схем, {result['products']} продукта, {result['stages']} переделов, {result['route_stage_rows']} строк матрицы")
    print("Пять балансов массы, единицы, базы потребности и ссылки на источники согласованы")
    if "chain_nodes" in matrix:
        print("Граф из 13 узлов и 27 операций согласован с 17 переделами исторической карты")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
