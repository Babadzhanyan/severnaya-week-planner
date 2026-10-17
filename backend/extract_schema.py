"""Проверка схемы анонимной выгрузки по именам полей.

Значения полей эта проверка не открывает. Она работает только с заголовками
таблиц и описанием схемы, чтобы проект не получал доступ к персональным данным.
Значения проверяет владелец данных у себя, см. «Запрос_анонимной_выгрузки_v1.md».
"""

import re

TABLES = {
    "clients": {"client_pid", "channel_code", "active_flag"},
    "orders": {"order_pid", "client_pid", "product_code", "week_start", "qty_kg",
               "price_rub_kg", "order_class", "probability"},
    "stock": {"product_code", "week_start", "qty_kg"},
    "prices": {"product_code", "list_price_rub_kg", "freeze_price_rub_kg", "valid_from"},
    "norms": {"product_code", "yield_pct", "scheme_code", "valid_from"},
    "capacity": {"stage_code", "week_start", "capacity_t_day"},
    "costs": {"cost_code", "scope", "rub_per_unit"},
    "route_links": {"from_stage", "to_stage", "confirmed_flag", "hours"},
    "calendar": {"week_start", "working_days"},
}

OPTIONAL = {"orders": {"probability"}}

# Части имен полей, которые признают личные данные или ссылки на источники.
FORBIDDEN_PARTS = (
    "name", "фио", "phone", "телефон", "mail", "manager", "менедж", "contact",
    "контакт", "alias", "sourceref", "sha256", "peersource", "inn", "инн",
    "ogrn", "огрн", "contract", "договор", "address", "адрес", "iban", "bik",
    "табел", "comment", "коммент", "text", "file", "файл",
)

PSEUDONYM = re.compile(r"^К-\d{3,}$")


def check_headers(table, headers):
    """Возвращает список ошибок для таблицы по списку имен полей."""
    if table not in TABLES:
        return [f"неизвестная таблица: {table}"]

    errors = []
    seen = list(headers)
    if len(seen) != len(set(seen)):
        errors.append("повторяющиеся поля")

    for field in seen:
        low = field.lower()
        if any(part in low for part in FORBIDDEN_PARTS):
            errors.append(f"запрещенное поле: {field}")
        elif field not in TABLES[table]:
            errors.append(f"лишнее поле: {field}")

    for field in TABLES[table] - OPTIONAL.get(table, set()):
        if field not in seen:
            errors.append(f"нет поля: {field}")

    return errors


def check_pseudonym(value):
    """Проверяет формат псевдонима клиента К-NNN. Используется при загрузке значений владельца."""
    return bool(PSEUDONYM.match(value))
