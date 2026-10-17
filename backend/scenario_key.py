"""Ключ сценария: одинаковые входы дают одну строку. Паритет с src/scenario-state.js проверяет golden-файл."""
import hashlib
import json
import re

KEY_FIELDS = ("dataEdition", "product", "day", "zone", "packing", "client", "scheme", "paramsVersion")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Псевдоним клиента: кириллическая К и три цифры или больше, как в контракте v4.
CLIENT = re.compile(r"^К-\d{3,}$")


def params_version(params):
    """sha256 канонического JSON параметров: ключи отсортированы, разделители без пробелов."""
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def scenario_key(fields):
    if not isinstance(fields, dict) or set(fields) != set(KEY_FIELDS):
        raise ValueError("состав полей ключа сценария требует согласования")
    for name in KEY_FIELDS:
        if not isinstance(fields[name], str) or not fields[name].strip():
            raise ValueError("поле ключа сценария «" + name + "» требует текст")
    if not DAY.match(fields["day"]):
        raise ValueError("день ключа требует формата ГГГГ-ММ-ДД")
    if not CLIENT.match(fields["client"]):
        raise ValueError("клиент ключа указывается псевдонимом К-###")
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
