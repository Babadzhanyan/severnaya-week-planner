"""Паспорт выпуска на синтетическом комплекте во временных каталогах. Реальные каталоги данных не открываются."""
import json
from pathlib import Path

import pytest

from backend import input_paths, publication_passport
from backend.publication_passport import APP_VERSION, DATASET_ORDER, build_passport

REPO = Path(__file__).resolve().parents[2]
AVAILABLE = "доступен"
MISSING = "отсутствует"
SOURCE_FILES = {
    "real_data_capacity.json": b'{"rows": []}',
    "real_data_economics.json": b'{"a": 1}',
    "real_data_yields.json": b'{"b": 2}',
    "next_stage_production/route_matrix.json": b'{"d": 4}',
}
CLIENT_FILES = {
    "real_data_clients.json.gz": b"\x1f\x8b-synthetic",
    "next_stage_finance/full_costs_ui.json": b'{"c": 3}',
}
CLIENT_DATASETS = ("clients", "costs", "demand")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (input_paths.SOURCE_ENV, input_paths.CLIENT_ENV, *publication_passport.DEPLOYMENT_ENVS):
        monkeypatch.delenv(name, raising=False)


def make(root, files):
    for rel, body in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    return root


def passport(source, client=None, **kwargs):
    return build_passport(source, "2.0.0", "2.0", 1, client_directory=client, **kwargs)


def by_name(result):
    return {item["name"]: item for item in result["datasets"]}


def test_empty_roots_report_every_dataset_missing(tmp_path):
    source, client = tmp_path / "src", tmp_path / "cli"
    source.mkdir()
    client.mkdir()
    result = passport(source, client)
    assert [item["name"] for item in result["datasets"]] == list(DATASET_ORDER)
    for item in result["datasets"]:
        assert item["status"] == MISSING
        assert item["checksum"] is None
        assert item["count"] == 0
    assert result["deployment"] == "локальная сборка"


def test_complete_roots_report_available_with_counts(tmp_path):
    source = make(tmp_path / "src", SOURCE_FILES)
    client = make(tmp_path / "cli", CLIENT_FILES)
    result = passport(source, client, deployment="сборка-тест")
    data = by_name(result)
    assert all(item["status"] == AVAILABLE for item in data.values())
    assert all(len(item["checksum"]) == 64 for item in data.values())
    assert {name: item["count"] for name, item in data.items()} == {
        "capacity": 1, "economics": 2, "costs": 1, "clients": 1, "demand": 2, "productionCatalog": 1}
    assert result["deployment"] == "сборка-тест"


def test_client_datasets_follow_client_root_only(tmp_path):
    """Клиентские наборы ищутся только в каталоге клиентов: файлы в каталоге источников их не подтверждают."""
    everything = make(tmp_path / "all", {**SOURCE_FILES, **CLIENT_FILES})
    data = by_name(passport(everything, None))
    assert data["capacity"]["status"] == AVAILABLE
    assert {name: data[name]["status"] for name in CLIENT_DATASETS} == {name: MISSING for name in CLIENT_DATASETS}

    empty = tmp_path / "empty"
    empty.mkdir()
    data = by_name(passport(empty, make(tmp_path / "cli", CLIENT_FILES)))
    assert {name: data[name]["status"] for name in CLIENT_DATASETS} == {name: AVAILABLE for name in CLIENT_DATASETS}
    assert data["capacity"]["status"] == MISSING


def test_default_roots_come_from_the_same_environment_as_loaders(tmp_path, monkeypatch):
    source = make(tmp_path / "src", SOURCE_FILES)
    client = make(tmp_path / "cli", CLIENT_FILES)
    monkeypatch.setenv(input_paths.SOURCE_ENV, str(source))
    monkeypatch.setenv(input_paths.CLIENT_ENV, str(client))
    assert input_paths.source_root() == source
    assert input_paths.client_root() == client
    data = by_name(build_passport(None, "2.0.0", "2.0", 1))
    assert all(item["status"] == AVAILABLE for item in data.values())


def test_bundled_roots_resolve_like_loaders(tmp_path, monkeypatch):
    """bundled задает исходный каталог пакета; клиентского набора в пакете нет. Реальные файлы здесь не проверяются."""
    monkeypatch.setenv(input_paths.SOURCE_ENV, "bundled")
    monkeypatch.setenv(input_paths.CLIENT_ENV, "bundled")
    assert input_paths.source_root() == input_paths.BUNDLED_SOURCE
    assert input_paths.client_root() is None
    data = by_name(build_passport(tmp_path, "2.0.0", "2.0", 1))
    assert {name: data[name]["status"] for name in CLIENT_DATASETS} == {name: MISSING for name in CLIENT_DATASETS}


def test_unset_roots_report_every_dataset_missing():
    data = by_name(build_passport(None, "2.0.0", "2.0", 1))
    assert all(item["status"] == MISSING for item in data.values())


def test_output_has_no_paths_or_file_names(tmp_path):
    result = passport(make(tmp_path / "src", SOURCE_FILES), make(tmp_path / "cli", CLIENT_FILES))
    text = json.dumps(result, ensure_ascii=False)
    assert str(tmp_path) not in text
    for name in {**SOURCE_FILES, **CLIENT_FILES}:
        assert Path(name).name not in text
    assert "/" not in text and "\\" not in text


def test_checksum_is_stable_and_follows_size(tmp_path):
    source = make(tmp_path / "src", SOURCE_FILES)
    client = make(tmp_path / "cli", CLIENT_FILES)
    first = passport(source, client)
    assert passport(source, client) == first
    (source / "real_data_capacity.json").write_bytes(b'{"rows": [1]}')
    changed = passport(source, client)
    assert by_name(changed)["capacity"]["checksum"] != by_name(first)["capacity"]["checksum"]
    assert by_name(changed)["economics"]["checksum"] == by_name(first)["economics"]["checksum"]
    assert changed["dataEdition"] != first["dataEdition"]


def test_partial_dataset_is_missing_and_changes_edition(tmp_path):
    full = passport(make(tmp_path / "full", SOURCE_FILES), make(tmp_path / "fullc", CLIENT_FILES))
    partial_source = {k: v for k, v in SOURCE_FILES.items() if k != "real_data_yields.json"}
    partial = passport(make(tmp_path / "partial", partial_source), make(tmp_path / "partialc", CLIENT_FILES))
    economics = by_name(partial)["economics"]
    assert economics["status"] == MISSING and economics["checksum"] is None and economics["count"] == 1
    assert partial["dataEdition"] != full["dataEdition"]
    assert by_name(partial)["capacity"]["status"] == AVAILABLE


def test_demand_depends_on_clients_and_costs(tmp_path):
    client_files = {k: v for k, v in CLIENT_FILES.items() if k != "next_stage_finance/full_costs_ui.json"}
    data = by_name(passport(make(tmp_path / "src", SOURCE_FILES), make(tmp_path / "cli", client_files)))
    assert data["clients"]["status"] == AVAILABLE
    assert data["costs"]["status"] == MISSING
    assert data["demand"]["status"] == MISSING


def test_app_version_matches_package_version():
    package = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    assert APP_VERSION == package["version"]


def test_deployment_comes_from_build_variables(tmp_path, monkeypatch):
    assert publication_passport.deployment_id() is None
    assert passport(tmp_path)["deployment"] == "локальная сборка"
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abc123")
    assert passport(tmp_path)["deployment"] == "abc123"
    monkeypatch.setenv("SEVERNAYA_DEPLOYMENT", "release-7")
    assert passport(tmp_path)["deployment"] == "release-7"


def test_json_round_trip(tmp_path):
    result = passport(make(tmp_path / "src", SOURCE_FILES), make(tmp_path / "cli", CLIENT_FILES))
    assert json.loads(json.dumps(result, ensure_ascii=False)) == result
