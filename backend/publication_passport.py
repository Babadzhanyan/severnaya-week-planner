"""Паспорт выпуска: версии, состав наборов и контрольные суммы.

Паспорт читает только имена и размеры файлов (stat). Содержимое файлов не открывается,
поэтому паспорт не раскрывает значения полей. В ответе нет абсолютных путей и имен файлов:
наборы называются по ролям, а файлы попадают в контрольную сумму внутри функции.
Корни наборов берутся из input_paths, тем же путем, что и у загрузчиков.
"""
import hashlib
import json
import os
from pathlib import Path

from . import input_paths

# ponytail: дублирует версию в package.json, потому что образ Docker package.json не содержит; тест сверяет значения.
APP_VERSION = "2.0.0"
AVAILABLE = "доступен"
MISSING = "отсутствует"
LOCAL_DEPLOYMENT = "локальная сборка"
DEPLOYMENT_ENVS = ("SEVERNAYA_DEPLOYMENT", "VERCEL_GIT_COMMIT_SHA")
DATASET_ORDER = ("capacity", "economics", "costs", "clients", "demand", "productionCatalog")


def deployment_id():
    """Идентификатор сборки из переменной окружения; None для локальной копии."""
    for name in DEPLOYMENT_ENVS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def _dataset_files(source, client):
    """Файлы наборов как пары (корень, функция пути). Корень None означает, что каталог не подключен."""
    return {
        "capacity": [(source, input_paths.capacity)],
        "economics": [(source, input_paths.economics), (source, input_paths.yields)],
        "costs": [(client, input_paths.costs)],
        "clients": [(client, input_paths.clients)],
        "demand": [(client, input_paths.clients), (client, input_paths.costs)],
        "productionCatalog": [(source, input_paths.production_catalog)],
    }


def _dataset(name, entries):
    present = []
    for root, locate in entries:
        path = locate(root) if root is not None else None
        if path is not None and path.is_file():
            present.append((root, path))
    complete = len(present) == len(entries)
    checksum = None
    if complete:
        # Контрольная сумма по относительным именам и размерам файлов; содержимое не читается.
        digest = hashlib.sha256()
        for root, path in sorted(present, key=lambda item: item[1].relative_to(item[0]).as_posix()):
            digest.update(f"{path.relative_to(root).as_posix()}\t{path.stat().st_size}\n".encode("utf-8"))
        checksum = digest.hexdigest()
    return {"name": name, "status": AVAILABLE if complete else MISSING, "checksum": checksum, "count": len(present)}


def build_passport(directory, app_version, model_version, contract_schema_version, deployment=None, client_directory=None):
    """Возвращает паспорт выпуска.

    directory: корень исходных файлов; None берет input_paths.source_root().
    client_directory: корень клиентских и затратных файлов; None берет input_paths.client_root().
    """
    source = Path(directory) if directory is not None else input_paths.source_root()
    client = Path(client_directory) if client_directory is not None else input_paths.client_root()
    files = _dataset_files(source, client)
    datasets = [_dataset(name, files[name]) for name in DATASET_ORDER]
    # Сводная сумма: отсортированные пары «имя набора, контрольная сумма»; отсутствующий набор дает null.
    pairs = sorted([item["name"], item["checksum"]] for item in datasets)
    edition = hashlib.sha256(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {
        "appVersion": app_version,
        "modelVersion": model_version,
        "contractSchemaVersion": contract_schema_version,
        "deployment": deployment or deployment_id() or LOCAL_DEPLOYMENT,
        "dataEdition": edition,
        "datasets": datasets,
    }
