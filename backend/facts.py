"""Факты для страницы «Факты»: отдает файл contract/facts.json, проверив состав разделов.

В файле только агрегаты: строк клиентов и людей в нем нет. Модуль проверяет наличие разделов и отдает значения как есть.
"""
import json
from pathlib import Path

FILE_PATH = Path(__file__).resolve().parent / "contract" / "facts.json"
REQUIRED_KEYS = ("schemaVersion", "period", "kpi", "quarters", "chain", "yields", "capacity", "channels", "prices", "concentration", "pain", "dataStatus", "decisions", "roadmap", "sources")


class FactsError(Exception):
    """Ошибка загрузки фактов: HTTP-статус, тип ошибки и текст для пользователя."""

    def __init__(self, status, kind, message):
        super().__init__(message)
        self.status, self.kind, self.message = status, kind, message


def _reject_constant(name):
    raise ValueError("недопустимая константа JSON: " + name)


def load_facts():
    if not FILE_PATH.is_file():
        raise FactsError(404, "facts_missing", "Файл фактов не найден: backend/contract/facts.json")
    try:
        # ponytail: файл около 8 КБ читается на каждый запрос; кэш добавить, когда файл заметно вырастет.
        data = json.loads(FILE_PATH.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except (OSError, ValueError) as exc:
        raise FactsError(503, "facts_invalid", "Файл фактов требует проверки формата JSON") from exc
    if not isinstance(data, dict):
        raise FactsError(503, "facts_invalid", "Файл фактов требует проверки: корень должен быть объектом")
    missing = [key for key in REQUIRED_KEYS if key not in data]
    if missing:
        raise FactsError(503, "facts_invalid", "Файл фактов требует проверки: нет разделов " + ", ".join(missing))
    return data
