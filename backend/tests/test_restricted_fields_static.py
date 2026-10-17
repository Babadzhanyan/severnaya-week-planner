"""Статическая проверка: ключи и имена файлов реальных данных не попадают в исходники приложения."""
import os
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ("sourceRefs", "sha256", "confirmedAliases", "peerSourceRows")
QUOTED_KEY = re.compile(r"""(['"])(?:%s)\1""" % "|".join(KEYS))
JS_KEY = re.compile(r"(?<![\w.])(?:%s)\s*:" % "|".join(KEYS))
REAL_NAME = "real_data_"
SOURCES = {"backend": (".py",), "src": (".js", ".jsx")}
SKIP_DIRS = {"tests", "__pycache__", "node_modules"}
# Модули, которые читают или проверяют входные файлы. Ключи источника в них нужны для сверки,
# поэтому тест их не проверяет; ответ API таких модулей ограничен response_model и test_api_allowlist.
# Одна строка причины на файл. Пустая причина и путь к отсутствующему файлу валят тест.
READER_EXCEPTIONS = {
    "backend/extract_schema.py": "Проверяет заголовки таблиц выгрузки, значения не открывает, к API не подключен",
    "backend/input_paths.py": "Задает имена входных файлов предприятия; содержимое не читает, в ответ API не попадает",
    "backend/files_costs.py": "Проверяет входной регистр затрат по ключам источника; ответ API ограничен моделью Costs",
    "backend/files_economics.py": "Сверяет контрольные суммы входных выгрузок; ответ API ограничен моделью EconomicsCatalog",
    "backend/files_production.py": "Сверяет контрольные суммы и ссылки входной матрицы; ответ API ограничен моделями каталога и расчета",
    "backend/files_recommendations.py": "Сверяет сигналы с исходными строками входного каталога; ответ API ограничен моделью Recommendations",
}


def skipped_dir(path, base):
    return path.name in SKIP_DIRS or path.relative_to(base).parts == ("backend", "client_data")


def skipped_file(path, base):
    return "source_data" in path.relative_to(base).parts and path.name.startswith(REAL_NAME)


def find_violations(base):
    found = []
    for folder_name, suffixes in SOURCES.items():
        for folder, dirs, files in os.walk(base / folder_name):
            folder = Path(folder)
            dirs[:] = [d for d in dirs if not skipped_dir(folder / d, base)]
            for name in files:
                path = folder / name
                if path.suffix not in suffixes or skipped_file(path, base):
                    continue
                text = path.read_text(encoding="utf-8", errors="replace")
                js_hit = path.suffix in {".js", ".jsx"} and JS_KEY.search(text)
                if QUOTED_KEY.search(text) or js_hit or REAL_NAME in text:
                    found.append(path.relative_to(base).as_posix())
    return found


def unexcepted(violations):
    return [path for path in violations if path not in READER_EXCEPTIONS]


class RestrictedFieldsStaticTests(unittest.TestCase):
    def test_sources_contain_no_restricted_literals(self):
        found = unexcepted(find_violations(ROOT))
        self.assertEqual(found, [], "Ключ или имя файла реальных данных найден в модуле ответа API или в UI: " + ", ".join(found))

    def test_reader_exceptions_have_reasons_and_existing_files(self):
        for rel, reason in READER_EXCEPTIONS.items():
            self.assertTrue(reason.strip() and "\n" not in reason, f"Исключение {rel} требует причины в одну строку")
            self.assertTrue((ROOT / rel).is_file(), f"Исключение {rel} указывает на отсутствующий файл")

    def test_exceptions_cover_only_listed_paths(self):
        self.assertEqual(unexcepted(["backend/extract_schema.py", "backend/module.py"]), ["backend/module.py"])

    def test_detector_flags_literals_and_skips_excluded_paths(self):
        literal = f'row = {{"{KEYS[0]}": []}}\n'
        files = {
            "backend/module.py": literal,
            "src/view.jsx": f"const row = {{ {KEYS[0]}: 1 }};\n",
            "backend/tests/case.py": literal,
            "backend/client_data/data.py": literal,
            "backend/source_data/real_data_x.py": f'name = "{REAL_NAME}x"\n',
            "backend/fresh_route.py": f'row = {{"{KEYS[3]}": []}}\n',
        }
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            for rel, text in files.items():
                path = base / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            self.assertEqual(sorted(find_violations(base)), ["backend/fresh_route.py", "backend/module.py", "src/view.jsx"])
