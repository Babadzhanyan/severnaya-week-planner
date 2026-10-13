"""Локальный запуск и контейнер: API и собранный интерфейс React."""
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from .app import app

dist = Path(__file__).resolve().parents[1] / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="interface")
