"""Маршрут фактов отдает все разделы контракта, в ответе персональных признаков нет."""
import json
import re

from fastapi.testclient import TestClient

from backend import facts
from backend.app import app

client = TestClient(app)
# Признаки: адрес почты, телефон, ИНН (10 или 12 цифр), отчество.
PERSONAL = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.]+"
    r"|(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)"
    r"|(?<!\d)\d{10}(?!\d)|(?<!\d)\d{12}(?!\d)"
    r"|\b[^\W\d_]+(?:ович|евич|овна|евна|ична)\b"
)


def test_facts_route_returns_all_sections():
    response = client.get("/api/facts")
    assert response.status_code == 200
    assert set(facts.REQUIRED_KEYS) <= set(response.json())


def test_facts_payload_has_no_personal_markers():
    text = json.dumps(client.get("/api/facts").json(), ensure_ascii=False)
    assert PERSONAL.search(text) is None


def test_missing_section_is_reported(tmp_path, monkeypatch):
    path = tmp_path / "facts.json"
    path.write_text(json.dumps({key: 1 for key in facts.REQUIRED_KEYS if key != "kpi"}), encoding="utf-8")
    monkeypatch.setattr(facts, "FILE_PATH", path)
    response = client.get("/api/facts")
    assert response.status_code == 503
    assert response.json()["detail"][0]["type"] == "facts_invalid"
    assert "kpi" in response.json()["detail"][0]["msg"]
