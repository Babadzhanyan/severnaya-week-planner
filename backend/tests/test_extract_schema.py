import unittest

from backend.extract_schema import TABLES, check_headers, check_pseudonym


class CheckHeadersTest(unittest.TestCase):
    def test_full_header_passes(self):
        self.assertEqual(check_headers("clients", sorted(TABLES["clients"])), [])

    def test_optional_field_may_be_absent(self):
        headers = sorted(TABLES["orders"] - {"probability"})
        self.assertEqual(check_headers("orders", headers), [])

    def test_missing_required_field_fails(self):
        headers = sorted(TABLES["clients"] - {"channel_code"})
        self.assertIn("нет поля: channel_code", check_headers("clients", headers))

    def test_extra_field_fails(self):
        errors = check_headers("stock", sorted(TABLES["stock"]) + ["extra_col"])
        self.assertIn("лишнее поле: extra_col", errors)

    def test_personal_field_rejected(self):
        for field in ("manager", "client_name", "phone_number", "email", "contact_person", "ИНН"):
            with self.subTest(field=field):
                errors = check_headers("clients", sorted(TABLES["clients"]) + [field])
                self.assertTrue(any(e.startswith("запрещенное поле") for e in errors), errors)

    def test_source_reference_rejected(self):
        for field in ("sourceRefs", "sha256", "file_name", "peerSourceRows"):
            with self.subTest(field=field):
                errors = check_headers("orders", sorted(TABLES["orders"]) + [field])
                self.assertTrue(any(e.startswith("запрещенное поле") for e in errors), errors)

    def test_unknown_table_fails(self):
        self.assertEqual(check_headers("unknown", []), ["неизвестная таблица: unknown"])

    def test_duplicate_field_fails(self):
        errors = check_headers("stock", ["qty_kg", "qty_kg", "product_code", "week_start"])
        self.assertIn("повторяющиеся поля", errors)


class PseudonymTest(unittest.TestCase):
    def test_valid_pseudonym_accepted(self):
        self.assertTrue(check_pseudonym("К-001"))
        self.assertTrue(check_pseudonym("К-1234"))

    def test_latin_prefix_rejected(self):
        self.assertFalse(check_pseudonym("K-001"))

    def test_name_rejected(self):
        self.assertFalse(check_pseudonym("Иванов"))


if __name__ == "__main__":
    unittest.main()
