"""Публичный режим: клиентские маршруты и ответы с клиентскими полями отвечают 404.

Переменная SEVERNAYA_PUBLIC_MODE=1 задана в vercel.json и Dockerfile. В локальной разработке она не задана,
поэтому маршруты работают. Проверка идет на каждом запросе до чтения данных.
"""
import os

from fastapi import HTTPException

ENV_NAME = "SEVERNAYA_PUBLIC_MODE"


def is_public_mode():
    return os.environ.get(ENV_NAME) == "1"


def refuse_in_public_mode():
    """Зависимость маршрута: в публичном режиме отвечает 404 без чтения данных."""
    if is_public_mode():
        detail = [{"loc": ["request"], "msg": "Раздел недоступен в публичном режиме: клиентские данные выводятся только в локальной разработке", "type": "public_mode"}]
        raise HTTPException(status_code=404, detail=detail)
