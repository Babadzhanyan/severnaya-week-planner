"""Д11: ревизии сценария, конфликт параллельных правок, экспорт и импорт с контрольным итогом, хранилище и псевдонимы."""
import copy
import tempfile
import unittest

from backend.model import VERSION as MODEL_VERSION
from backend.scenarios import ENV_PATH, UNKNOWN_AUTHOR, ScenarioError, ScenarioStore, content_hash, export_scenario, get_scenario, import_scenario, list_scenarios, open_store, save_scenario

KEY = {"dataEdition": "a" * 64, "product": "fillet", "day": "2026-03-02", "zone": "central", "packing": "tray",
       "client": "К-001", "scheme": "main", "paramsVersion": "b" * 64}
CONTENT = {"params": {"cut": 50}, "request": {"quantity": 4}, "roi": {"value": 1.5}, "commercial": {"net": 269.15}}


def body(content=CONTENT, base=None, author="Коммерция", key=KEY, name="Базовый"):
    return {"keyFields": key, "name": name, "authorLabel": author, "baseRevision": base, "content": content}


class ScenarioTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.store = open_store({ENV_PATH: self._dir.name + "/first.sqlite3"})

    def tearDown(self):
        self._dir.cleanup()

    def test_first_save_creates_revision_one_and_repeat_creates_nothing(self):
        status, created = save_scenario(self.store, body())
        self.assertEqual((status, created["revision"], created["created"]), (201, 1, True))
        status, repeat = save_scenario(self.store, body())
        self.assertEqual((status, repeat["created"], repeat["id"]), (200, False, created["id"]))
        items = list_scenarios(self.store)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["dataEdition"], KEY["dataEdition"])
        self.assertEqual(items[0]["modelVersion"], MODEL_VERSION)

    def test_parallel_edit_returns_both_versions_and_writes_nothing(self):
        _, first = save_scenario(self.store, body())
        other = copy.deepcopy(CONTENT)
        other["params"]["cut"] = 60
        status, _ = save_scenario(self.store, body(content=other, base=1, author="Планирование"))
        self.assertEqual(status, 201)
        mine = copy.deepcopy(CONTENT)
        mine["params"]["cut"] = 40
        with self.assertRaises(ScenarioError) as caught:
            save_scenario(self.store, body(content=mine, base=1, author="Коммерция"))
        error = caught.exception
        self.assertEqual((error.status, error.kind), (409, "scenario_conflict"))
        self.assertEqual(error.extra["current"]["revision"], 2)
        self.assertEqual(error.extra["current"]["content"]["params"]["cut"], 60)
        self.assertEqual(error.extra["submitted"]["content"]["params"]["cut"], 40)
        self.assertEqual(error.extra["submitted"]["authorLabel"], "Коммерция")
        self.assertEqual(error.body()["detail"][0]["type"], "scenario_conflict")
        self.assertEqual(len(get_scenario(self.store, first["id"])["versions"]), 2)

    def test_previous_revision_keeps_its_content_and_dataset_after_update(self):
        _, first = save_scenario(self.store, body())
        changed = copy.deepcopy(CONTENT)
        changed["params"]["cut"] = 70
        save_scenario(self.store, body(content=changed, base=1))
        revision_one = get_scenario(self.store, first["id"], revision=1)
        self.assertEqual(revision_one["content"], CONTENT)
        self.assertEqual(revision_one["dataEdition"], KEY["dataEdition"])
        self.assertEqual(get_scenario(self.store, first["id"])["content"]["params"]["cut"], 70)

    def test_new_dataset_creates_separate_scenario_and_old_one_keeps_its_data(self):
        _, old = save_scenario(self.store, body())
        new_key = {**KEY, "dataEdition": "c" * 64}
        _, new = save_scenario(self.store, body(key=new_key))
        self.assertNotEqual(old["id"], new["id"])
        self.assertEqual(get_scenario(self.store, old["id"])["keyFields"]["dataEdition"], "a" * 64)

    def test_export_import_restores_same_scenario_and_checksum(self):
        _, saved = save_scenario(self.store, body())
        exported = export_scenario(self.store, saved["id"])
        self.assertEqual((exported["format"], exported["formatVersion"]), ("severnaya-scenario", 1))
        self.assertEqual(exported["checksum"], content_hash(CONTENT))
        other = open_store({ENV_PATH: self._dir.name + "/second.sqlite3"})
        status, restored = import_scenario(other, exported)
        self.assertEqual((status, restored["created"], restored["checksum"]), (201, True, exported["checksum"]))
        self.assertEqual(restored["id"], saved["id"])
        self.assertEqual(get_scenario(other, restored["id"])["content"], CONTENT)
        status, repeat = import_scenario(other, exported)
        self.assertEqual((status, repeat["created"]), (200, False))
        self.assertEqual(len(list_scenarios(other)["items"]), 1)

    def test_tampered_or_foreign_files_are_rejected(self):
        _, saved = save_scenario(self.store, body())
        exported = export_scenario(self.store, saved["id"])
        tampered = copy.deepcopy(exported)
        tampered["content"]["params"]["cut"] = 99
        cases = [
            (tampered, "scenario_checksum_mismatch"),
            ({**exported, "formatVersion": 2}, "scenario_format_unsupported"),
            ({**exported, "modelVersion": "0.0.0"}, "scenario_model_mismatch"),
        ]
        for payload, kind in cases:
            with self.subTest(kind=kind), self.assertRaises(ScenarioError) as caught:
                import_scenario(self.store, payload)
            self.assertEqual((caught.exception.status, caught.exception.kind), (422, kind))

    def test_import_with_other_content_for_existing_key_conflicts(self):
        _, saved = save_scenario(self.store, body())
        exported = export_scenario(self.store, saved["id"])
        changed = copy.deepcopy(CONTENT)
        changed["roi"] = {"value": 9}
        other_file = {**exported, "content": changed, "checksum": content_hash(changed)}
        with self.assertRaises(ScenarioError) as caught:
            import_scenario(self.store, other_file)
        self.assertEqual((caught.exception.status, caught.exception.kind), (409, "scenario_conflict"))
        self.assertEqual(len(get_scenario(self.store, saved["id"])["versions"]), 1)

    def test_base_revision_for_missing_scenario_is_a_conflict(self):
        with self.assertRaises(ScenarioError) as caught:
            save_scenario(self.store, body(base=3))
        self.assertIsNone(caught.exception.extra["current"])

    def test_client_outside_alias_pattern_is_rejected_in_key_and_content(self):
        with self.assertRaises(ScenarioError) as caught:
            save_scenario(self.store, body(key={**KEY, "client": "Иван Петров"}))
        self.assertEqual(caught.exception.kind, "client_alias_invalid")
        leaking = {**CONTENT, "commercial": {"client": "ООО Ромашка"}}
        with self.assertRaises(ScenarioError) as caught:
            save_scenario(self.store, body(content=leaking))
        self.assertEqual(caught.exception.kind, "client_alias_invalid")

    def test_author_label_must_be_a_role_from_the_list(self):
        for author in ("", "Произвольный текст", "Аналитик"):
            with self.subTest(author=author), self.assertRaises(ScenarioError) as caught:
                save_scenario(self.store, body(author=author))
            self.assertEqual((caught.exception.status, caught.exception.kind), (422, "literal_error"))
            self.assertEqual(caught.exception.body()["detail"][0]["loc"], ["body", "authorLabel"])

    def test_free_text_author_label_from_older_storage_is_cleared_on_open(self):
        path = self._dir.name + "/legacy.sqlite3"
        store = open_store({ENV_PATH: path})
        _, saved = save_scenario(store, body())
        store._db.execute("update revisions set author_label = ?", ("Свободный текст",))
        reopened = ScenarioStore(path)
        self.assertEqual(get_scenario(reopened, saved["id"])["authorLabel"], UNKNOWN_AUTHOR)
        self.assertEqual(list_scenarios(reopened)["items"][0]["authorLabel"], UNKNOWN_AUTHOR)

    def test_commercial_only_variant_saves_without_production_approval(self):
        commercial_only = {"params": {}, "request": {}, "roi": {}, "commercial": {"net": 269.15}}
        status, saved = save_scenario(self.store, body(content=commercial_only))
        self.assertEqual(status, 201)
        self.assertEqual(get_scenario(self.store, saved["id"])["content"]["commercial"], {"net": 269.15})

    def test_unknown_scenario_is_not_found(self):
        with self.assertRaises(ScenarioError) as caught:
            get_scenario(self.store, "sc_missing")
        self.assertEqual((caught.exception.status, caught.exception.kind), (404, "scenario_not_found"))

    def test_storage_without_path_is_unavailable(self):
        with self.assertRaises(ScenarioError) as caught:
            open_store({})
        self.assertEqual((caught.exception.status, caught.exception.kind), (503, "scenario_storage_unavailable"))
        self.assertEqual(caught.exception.message, "Хранилище сценариев не подключено")


if __name__ == "__main__":
    unittest.main()
