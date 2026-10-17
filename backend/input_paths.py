"""Пути к входным файлам предприятия. Модуль не читает содержимое и не формирует ответ API.

Корни задаются переменными окружения. Паспорт выпуска и загрузчики берут корни только отсюда:
один и тот же набор не ищется в двух каталогах.
"""
import os
from pathlib import Path

BUNDLED = "bundled"
SOURCE_ENV = "SEVERNAYA_SOURCE_DATA_DIR"
CLIENT_ENV = "SEVERNAYA_CLIENT_DATA_DIR"
BUNDLED_SOURCE = Path(__file__).resolve().parent / "source_data"


def _root(name, bundled):
    value = os.environ.get(name, "").strip()
    if not value:
        return None
    return bundled if value == BUNDLED else Path(value)


def source_root():
    """Корень исходных файлов: None, если переменная не задана; bundled ведет в backend/source_data."""
    return _root(SOURCE_ENV, BUNDLED_SOURCE)


def client_root():
    """Корень клиентских и затратных файлов: None, если переменная не задана; bundled такого набора не содержит."""
    return _root(CLIENT_ENV, None)


def capacity(directory):
    return Path(directory) / "real_data_capacity.json"


def economics(directory):
    return Path(directory) / "real_data_economics.json"


def yields(directory):
    return Path(directory) / "real_data_yields.json"


def clients(directory):
    path = Path(directory) / "real_data_clients.json"
    return path if path.is_file() else Path(directory) / "real_data_clients.json.gz"


def costs(directory):
    return Path(directory) / "next_stage_finance" / "full_costs_ui.json"


def recommendations(directory):
    return Path(directory) / "next_stage_clients" / "recommendations_by_client.json"


def production_catalog(directory):
    return Path(directory) / "next_stage_production" / "route_matrix.json"
