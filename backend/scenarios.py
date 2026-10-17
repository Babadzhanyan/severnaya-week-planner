"""Сохраненные сценарии на сервере: ревизии, защита от параллельных правок, экспорт и импорт.

Ключ сценария задает scenario_key(keyFields): один ключ соответствует одному сценарию.
Каждая ревизия хранит набор данных, редакцию модели, содержимое и автора. Содержимое прежних
ревизий не меняется. Автор записывается ролью из AUTHOR_ROLES, свободный текст не сохраняется:
при открытии хранилища прежние значения заменяются на UNKNOWN_AUTHOR. Хранилище: sqlite3, путь
берется из переменной SEVERNAYA_SCENARIO_DB.
Без пути сервис отвечает 503 scenario_storage_unavailable.
"""
import hashlib
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from os import environ

from .model import VERSION as MODEL_VERSION
from .scenario_key import scenario_key

ENV_PATH = "SEVERNAYA_SCENARIO_DB"
FORMAT = "severnaya-scenario"
FORMAT_VERSION = 1
IMPORT_AUTHOR = "импорт файла"
# Роли из перечня подтверждает владелец ПД и ИТ (Требуется подтверждение). Личные ФИО в ярлыке не хранятся.
AUTHOR_ROLES = ("Планирование", "Технолог", "Коммерция", "Склад", "Финансы")
UNKNOWN_AUTHOR = "Роль не указана"
STORED_AUTHORS = (*AUTHOR_ROLES, IMPORT_AUTHOR, UNKNOWN_AUTHOR)
KEY_FIELDS = ("dataEdition", "product", "day", "zone", "packing", "client", "scheme", "paramsVersion")
CONTENT_FIELDS = ("params", "request", "roi", "commercial")
SAVE_FIELDS = ("keyFields", "name", "authorLabel", "baseRevision", "content")
IMPORT_FIELDS = ("format", "formatVersion", "modelVersion", "key", "keyFields", "name", "content", "checksum")
CLIENT_KEYS = ("client", "clientId")
CLIENT_ALIAS = re.compile(r"К-[0-9]{3,}")
SHA256 = re.compile(r"[0-9a-f]{64}")
CLIENT_MSG = "Клиент указывается псевдонимом К-###"
CONFLICT_MSG = "Сценарий изменен параллельно: сравните редакции"
EXTRA_MSG = "Запрос содержит поле за пределами согласованной структуры"

SCHEMA = """
create table if not exists scenarios (
    id text primary key,
    key text not null unique,
    key_fields text not null,
    name text not null
);
create table if not exists revisions (
    scenario_id text not null references scenarios(id),
    revision integer not null,
    data_edition text not null,
    model_version text not null,
    content text not null,
    content_hash text not null,
    author_label text not null,
    saved_at text not null,
    primary key (scenario_id, revision)
);
"""


class ScenarioError(Exception):
    """Ошибка сценария. body() отдает тело ответа в форме detail, как в app.py."""

    def __init__(self, status, kind, message, loc=("body",), **extra):
        super().__init__(message)
        self.status, self.kind, self.message, self.loc, self.extra = status, kind, message, list(loc), extra

    def body(self):
        return {"detail": [{"loc": self.loc, "msg": self.message, "type": self.kind}], **self.extra}


def _fail(kind, message, *loc):
    return ScenarioError(422, kind, message, ["body", *loc])


def _unavailable():
    return ScenarioError(503, "scenario_storage_unavailable", "Хранилище сценариев не подключено")


def _not_found(*loc):
    return ScenarioError(404, "scenario_not_found", "Сценарий не найден", ["path", *loc])


def _canonical(value):
    # Приведение целых float сохраняет контрольную сумму при переходе через JSON, как в fingerprint.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def _dump(value):
    return json.dumps(_canonical(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def content_hash(content):
    return hashlib.sha256(_dump(content).encode("utf-8")).hexdigest()


def _scenario_id(key):
    return "sc_" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(value, limit, *loc, strip=True):
    text = value.strip() if strip and isinstance(value, str) else value
    if not isinstance(text, str) or not 1 <= len(text) <= limit:
        raise _fail("string_invalid", f"Значение требует от 1 до {limit} знаков", *loc)
    return text


def _role(value):
    if not isinstance(value, str) or value not in AUTHOR_ROLES:
        raise _fail("literal_error", "Автор выбирается из списка ролей", "authorLabel")
    return value


def _client_aliases(value, loc):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in CLIENT_KEYS and isinstance(item, str) and not CLIENT_ALIAS.fullmatch(item):
                raise ScenarioError(422, "client_alias_invalid", CLIENT_MSG, [*loc, key])
            _client_aliases(item, [*loc, key])
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _client_aliases(item, [*loc, index])


def _key_fields(value):
    if not isinstance(value, dict):
        raise _fail("dict_type", "Ключ сценария требует объект", "keyFields")
    if set(value) - set(KEY_FIELDS):
        raise _fail("extra_forbidden", EXTRA_MSG, "keyFields")
    fields = {}
    for field in KEY_FIELDS:
        if field not in value:
            raise _fail("missing", "Поле ключа требует значения", "keyFields", field)
        fields[field] = value[field]
    if not isinstance(fields["client"], str) or not CLIENT_ALIAS.fullmatch(fields["client"]):
        raise ScenarioError(422, "client_alias_invalid", CLIENT_MSG, ["body", "keyFields", "client"])
    for field in ("dataEdition", "paramsVersion"):
        if not isinstance(fields[field], str) or not SHA256.fullmatch(fields[field]):
            raise _fail("value_error", "Поле требует sha256 из 64 знаков в нижнем регистре", "keyFields", field)
    for field in ("product", "zone", "packing", "scheme"):
        _text(fields[field], 100, "keyFields", field, strip=False)
    try:
        if not isinstance(fields["day"], str) or len(fields["day"]) != 10:
            raise ValueError
        date.fromisoformat(fields["day"])
    except ValueError:
        raise _fail("value_error", "День требует дату ГГГГ-ММ-ДД", "keyFields", "day")
    return fields


def _content(value):
    if not isinstance(value, dict) or set(value) != set(CONTENT_FIELDS) or not all(isinstance(value[f], dict) for f in CONTENT_FIELDS):
        raise _fail("value_error", "Содержимое требует разделы params, request, roi и commercial как объекты", "content")
    _client_aliases(value, ["body", "content"])
    try:
        _dump(value)
    except ValueError:
        raise _fail("value_error", "Значения сценария требуют конечных чисел", "content")
    return value


def _save_body(body):
    if not isinstance(body, dict):
        raise _fail("dict_type", "Запрос требует объект сценария")
    if set(body) - set(SAVE_FIELDS):
        raise _fail("extra_forbidden", EXTRA_MSG)
    for field in ("keyFields", "name", "authorLabel", "content"):
        if field not in body:
            raise _fail("missing", "Поле запроса требует значения", field)
    base = body.get("baseRevision")
    if base is not None and (isinstance(base, bool) or not isinstance(base, int) or base < 1):
        raise _fail("int_type", "Базовая ревизия требует целое число от 1", "baseRevision")
    return {"keyFields": _key_fields(body["keyFields"]), "name": _text(body["name"], 80, "name"),
            "authorLabel": _role(body["authorLabel"]), "baseRevision": base, "content": _content(body["content"])}


class ScenarioStore:
    """Хранилище sqlite3. Каждая операция идет одной транзакцией с блокировкой записи."""

    def __init__(self, path):
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        # Очистка прежних свободных ярлыков автора: в хранилище остаются только роли из перечня.
        marks = ",".join("?" * len(STORED_AUTHORS))
        self._db.execute(f"update revisions set author_label = ? where author_label not in ({marks})", (UNKNOWN_AUTHOR, *STORED_AUTHORS))

    @contextmanager
    def transaction(self):
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")


_stores = {}
_stores_lock = threading.Lock()


def open_store(env=None):
    path = (environ if env is None else env).get(ENV_PATH, "").strip()
    if not path:
        raise _unavailable()
    with _stores_lock:
        if path not in _stores:
            try:
                _stores[path] = ScenarioStore(path)
            except sqlite3.Error:
                raise _unavailable()
        return _stores[path]


def _by_key(db, key):
    return db.execute("select id from scenarios where key = ?", (key,)).fetchone()


def _scenario(db, scenario_id):
    row = db.execute("select * from scenarios where id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise _not_found("id")
    return row


def _revision(db, scenario_id, revision=None):
    if revision is None:
        return db.execute("select * from revisions where scenario_id = ? order by revision desc limit 1", (scenario_id,)).fetchone()
    return db.execute("select * from revisions where scenario_id = ? and revision = ?", (scenario_id, revision)).fetchone()


def _append(db, scenario_id, number, data, digest, saved_at):
    db.execute("update scenarios set name = ? where id = ?", (data["name"], scenario_id))
    db.execute(
        "insert into revisions (scenario_id, revision, data_edition, model_version, content, content_hash, author_label, saved_at) values (?,?,?,?,?,?,?,?)",
        (scenario_id, number, data["keyFields"]["dataEdition"], MODEL_VERSION, _dump(data["content"]), digest, data["authorLabel"], saved_at))


def _conflict(head, data, digest):
    current = None if head is None else {"revision": head["revision"], "contentHash": head["content_hash"], "savedAt": head["saved_at"],
                                         "authorLabel": head["author_label"], "content": json.loads(head["content"])}
    submitted = {"contentHash": digest, "authorLabel": data["authorLabel"], "content": data["content"]}
    return ScenarioError(409, "scenario_conflict", CONFLICT_MSG, ["body", "baseRevision"], current=current, submitted=submitted)


def list_scenarios(store):
    with store.transaction() as db:
        rows = db.execute(
            "select s.id, s.key, s.name, r.revision, r.content_hash, r.saved_at, r.author_label, r.data_edition, r.model_version "
            "from scenarios s join revisions r on r.scenario_id = s.id "
            "and r.revision = (select max(x.revision) from revisions x where x.scenario_id = s.id) "
            "order by r.saved_at desc, s.id").fetchall()
    return {"items": [{"id": r["id"], "key": r["key"], "name": r["name"], "revision": r["revision"], "contentHash": r["content_hash"],
                       "savedAt": r["saved_at"], "authorLabel": r["author_label"], "dataEdition": r["data_edition"],
                       "modelVersion": r["model_version"]} for r in rows]}


def save_scenario(store, body):
    """Возвращает (201, новая ревизия), (200, повтор без записи) или поднимает 409 с обеими редакциями."""
    data = _save_body(body)
    key = scenario_key(data["keyFields"])
    digest, saved_at = content_hash(data["content"]), _now()
    with store.transaction() as db:
        found = _by_key(db, key)
        if found is None:
            if data["baseRevision"] is not None:
                raise _conflict(None, data, digest)
            scenario_id = _scenario_id(key)
            db.execute("insert into scenarios (id, key, key_fields, name) values (?,?,?,?)", (scenario_id, key, _dump(data["keyFields"]), data["name"]))
            _append(db, scenario_id, 1, data, digest, saved_at)
            return 201, {"id": scenario_id, "key": key, "revision": 1, "created": True, "contentHash": digest, "savedAt": saved_at}
        head = _revision(db, found["id"])
        if head["content_hash"] == digest and head["model_version"] == MODEL_VERSION:
            return 200, {"id": found["id"], "key": key, "revision": head["revision"], "created": False, "contentHash": digest, "savedAt": head["saved_at"]}
        if data["baseRevision"] != head["revision"]:
            raise _conflict(head, data, digest)
        number = head["revision"] + 1
        _append(db, found["id"], number, data, digest, saved_at)
        return 201, {"id": found["id"], "key": key, "revision": number, "created": True, "contentHash": digest, "savedAt": saved_at}


def get_scenario(store, scenario_id, revision=None):
    with store.transaction() as db:
        scenario = _scenario(db, scenario_id)
        row = _revision(db, scenario_id, revision)
        if row is None:
            raise _not_found("revision")
        versions = db.execute("select revision, content_hash, saved_at, author_label from revisions where scenario_id = ? order by revision",
                              (scenario_id,)).fetchall()
    return {"id": scenario_id, "key": scenario["key"], "keyFields": json.loads(scenario["key_fields"]), "name": scenario["name"],
            "revision": row["revision"], "contentHash": row["content_hash"], "savedAt": row["saved_at"], "authorLabel": row["author_label"],
            "modelVersion": row["model_version"], "dataEdition": row["data_edition"], "content": json.loads(row["content"]),
            "versions": [{"revision": v["revision"], "contentHash": v["content_hash"], "savedAt": v["saved_at"], "authorLabel": v["author_label"]}
                         for v in versions]}


def export_scenario(store, scenario_id):
    with store.transaction() as db:
        scenario = _scenario(db, scenario_id)
        row = _revision(db, scenario_id)
    return {"format": FORMAT, "formatVersion": FORMAT_VERSION, "modelVersion": row["model_version"], "key": scenario["key"],
            "keyFields": json.loads(scenario["key_fields"]), "name": scenario["name"], "content": json.loads(row["content"]),
            "checksum": row["content_hash"]}


def import_scenario(store, payload):
    """Возвращает (201, новый ключ), (200, повтор с тем же итогом) или поднимает 409 при другом итоге."""
    if not isinstance(payload, dict) or set(payload) != set(IMPORT_FIELDS) or payload["format"] != FORMAT or payload["formatVersion"] != FORMAT_VERSION:
        raise _fail("scenario_format_unsupported", "Формат файла не поддерживается", "format")
    if payload["modelVersion"] != MODEL_VERSION:
        raise _fail("scenario_model_mismatch", "Файл рассчитан по другой версии модели", "modelVersion")
    keys = _key_fields(payload["keyFields"])
    name = _text(payload["name"], 80, "name")
    content = _content(payload["content"])
    checksum = content_hash(content)
    if payload["checksum"] != checksum:
        raise _fail("scenario_checksum_mismatch", "Контрольный итог файла не совпадает с содержимым", "checksum")
    key = scenario_key(keys)
    if payload["key"] != key:
        raise _fail("scenario_key_mismatch", "Ключ файла не совпадает с полями ключа", "key")
    data = {"keyFields": keys, "name": name, "authorLabel": IMPORT_AUTHOR, "content": content}
    saved_at = _now()
    with store.transaction() as db:
        found = _by_key(db, key)
        if found is None:
            scenario_id = _scenario_id(key)
            db.execute("insert into scenarios (id, key, key_fields, name) values (?,?,?,?)", (scenario_id, key, _dump(keys), name))
            _append(db, scenario_id, 1, data, checksum, saved_at)
            return 201, {"id": scenario_id, "key": key, "revision": 1, "created": True, "checksum": checksum}
        head = _revision(db, found["id"])
        if head["content_hash"] == checksum and head["model_version"] == MODEL_VERSION:
            return 200, {"id": found["id"], "key": key, "revision": head["revision"], "created": False, "checksum": checksum}
        raise _conflict(head, data, checksum)
