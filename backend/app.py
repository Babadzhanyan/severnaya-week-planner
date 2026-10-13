"""FastAPI для учебного планировщика. Состояние плана хранит клиент."""
from copy import deepcopy
import hashlib
import json
import math
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import ValidationError
from . import model
from .schemas import CommercialBody, EvaluationBody, FactBody, Params, RequestBody, RoiBody, SnapshotBody

app = FastAPI(title="Учебный планировщик «Северная»", version=model.VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


class BodyLimitMiddleware:
    """Ограничивает тело до разбора JSON, включая потоковые запросы."""
    def __init__(self, app, max_bytes=1_048_576):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return
            size += len(message.get("body", b""))
            if size > self.max_bytes:
                response = JSONResponse(status_code=413, content={"detail": [{"loc": ["body"], "msg": "Размер запроса превышает 1 МБ", "type": "body_too_large"}]})
                return await response(scope, receive, send)
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()
        return await self.app(scope, replay, send)


app.add_middleware(BodyLimitMiddleware)


@app.exception_handler(StarletteHTTPException)
async def russian_http_errors(request, exc):
    detail = exc.detail
    if isinstance(detail, str):
        detail = [{"loc": ["request"], "msg": {404: "Адрес требует выбора доступного метода расчёта", 405: "Способ запроса требует проверки"}.get(exc.status_code, "Запрос требует проверки"), "type": "http_error"}]
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)

ERROR_NAMES = {**model.NAMES, "params": "Параметры плана", "route": "Схема разделки", "request": "Заявка", "requests": "Резерв заявок", "requestId": "Идентификатор заявки", "product": "Продукт", "quantity": "Количество", "price": "Цена", "stageCapacity": "Мощности переделов", "routeCosts": "Затраты маршрутов", "snapshot": "Утверждённый снимок", "confirmations": "Подтверждения", "forecastAbsorption": "Поглощение прогноза", "volume": "Объём", "share": "Доля", "label": "Подпись", "body": "Запрос", "deboning": "Обвалка", "packing": "Упаковка", "freezing": "Заморозка"}


@app.exception_handler(RequestValidationError)
async def russian_validation_errors(request, exc):
    detail = []
    for error in exc.errors():
        loc = list(error["loc"])
        field = next((ERROR_NAMES[key] for key in reversed(loc) if key in ERROR_NAMES), "Поле запроса")
        kind, context = error["type"], error.get("ctx", {})
        if kind == "missing":
            message = field + ": укажите значение"
        elif kind in ("float_type", "float_parsing", "int_type", "int_parsing", "finite_number"):
            message = field + ": требуется конечное число"
        elif kind in ("greater_than_equal", "less_than_equal", "greater_than", "less_than"):
            symbol, bound = {"greater_than_equal": ("≥", "ge"), "less_than_equal": ("≤", "le"), "greater_than": (">", "gt"), "less_than": ("<", "lt")}[kind]
            message = field + ": требуется значение " + symbol + " " + model.display(context[bound])
        elif kind in ("bool_type", "bool_parsing"):
            message = field + ": требуется значение подтверждения"
        elif kind == "literal_error":
            message = field + ": выберите значение из справочника"
        elif kind == "extra_forbidden":
            message = "Запрос содержит поле за пределами согласованной структуры"
        elif kind in ("too_long", "string_too_long"):
            message = field + ": сократите объём до установленного предела"
        elif kind in ("too_short", "string_too_short"):
            message = field + ": заполните значение"
        elif kind == "value_error":
            message = str(context.get("error", "Значение требует проверки"))
        elif kind == "json_invalid":
            message = "Запрос требует корректного формата JSON"
        else:
            message = field + ": проверьте формат значения"
        detail.append({"loc": loc, "msg": message, "type": kind})
    return JSONResponse(status_code=422, content={"detail": detail})


def fingerprint(params, confirmations):
    # Приведение чисел сохраняет контрольную сумму при JSON-переходе 100.0 → 100.
    def canonical(value):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {key: canonical(item) for key, item in value.items()}
        if isinstance(value, list):
            return [canonical(item) for item in value]
        return value
    body = {"modelVersion": model.VERSION, "params": params, "confirmations": confirmations}
    serialized = json.dumps(canonical(body), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def same_result(left, right):
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(same_result(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same_result(a, b) for a, b in zip(left, right))
    if isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool):
        return math.isclose(left, right, rel_tol=1e-12, abs_tol=1e-8)
    return type(left) is type(right) and left == right


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "Учебная демонстрация"}


@app.get("/api/catalog")
def catalog():
    return deepcopy(model.CATALOG)


@app.post("/api/evaluate")
def evaluate(body: EvaluationBody):
    params = body.params.model_dump()
    return {"result": model.evaluate(params), "alternatives": model.alternatives(params)}


@app.post("/api/request")
def request_check(body: RequestBody):
    result = model.check_request(body.params.model_dump(), body.request.model_dump())
    if result.get("canApply"):
        # Каждый принимаемый резерв остаётся допустимым вводом следующего запроса.
        try:
            Params.model_validate(result["params"])
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc
    return result


@app.post("/api/snapshot")
def snapshot(body: SnapshotBody):
    confirmations = body.confirmations.model_dump(exclude_unset=True)
    result = model.snapshot(body.params.model_dump(), confirmations)
    if result["approved"]:
        result.update(modelVersion=model.VERSION, fingerprint=fingerprint(result["params"], confirmations))
    return result


@app.post("/api/fact")
def fact(body: FactBody):
    if body.snapshot is None:
        return model.fact(body.params.model_dump())
    saved = body.snapshot.model_dump(exclude_unset=True)
    confirms = saved["confirmations"]
    params = model.normalize(saved["params"])
    checked = model.snapshot(params, confirms)
    matches = saved["approved"] is True and saved["valid"] is True and saved["modelVersion"] == model.VERSION and checked["approved"] and saved["fingerprint"] == fingerprint(params, confirms) and same_result(saved["result"], checked["result"]) and saved["label"] == checked["label"]
    if not matches:
        raise HTTPException(status_code=409, detail=[{"loc": ["body", "snapshot"], "msg": "Снимок требует повторного утверждения: параметры, расчёт и подтверждения должны совпадать", "type": "snapshot_mismatch"}])
    return model.fact(params)


@app.post("/api/roi")
def roi(body: RoiBody):
    return model.roi(body.params.model_dump(), body.options.model_dump())


@app.post("/api/commercial")
def commercial(body: CommercialBody):
    return model.commercial(body.client.model_dump())
