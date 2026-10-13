"""Ввод сервера: конечные значения и явные границы учебного расчёта."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from .model import defaults

ProductId = Literal["whole", "fillet", "legs", "wing", "frame", "breast", "legMeat", "legBone", "legSkin"]
RouteId = Literal["whole", "coarse", "fillet", "deep"]
StageId = Literal["deboning", "packing", "freezing"]
Amount = Annotated[float, Field(strict=True, ge=0, le=1_000_000, allow_inf_nan=False)]
PositiveAmount = Annotated[float, Field(strict=True, gt=0, le=1_000_000, allow_inf_nan=False)]
Budget = Annotated[float, Field(strict=True, ge=0, le=1_000_000_000_000, allow_inf_nan=False)]
RequestId = Annotated[str, Field(min_length=1, max_length=120)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class Reservation(InputModel):
    product: ProductId
    quantity: PositiveAmount
    price: Amount
    service: Amount = 0


class Params(InputModel):
    totalInput: Amount = 100
    rawCost: Amount = 140
    capacity: Amount = 50
    hours: Annotated[float, Field(strict=True, ge=0, le=168, allow_inf_nan=False)] = 80
    rate: Amount = .625
    minWhole: Amount = 50
    cut: Amount = 50
    route: RouteId = "fillet"
    coldCapacity: Amount = 6
    stageCapacity: dict[StageId, Amount] = Field(default_factory=lambda: defaults()["stageCapacity"], max_length=3)
    prices: dict[ProductId, Amount] = Field(default_factory=lambda: defaults()["prices"], max_length=9)
    demand: dict[ProductId, Amount] = Field(default_factory=lambda: defaults()["demand"], max_length=9)
    orders: dict[ProductId, Amount] = Field(default_factory=lambda: defaults()["orders"], max_length=9)
    service: dict[ProductId, Amount] = Field(default_factory=lambda: defaults()["service"], max_length=9)
    routeCosts: dict[RouteId, Amount] = Field(default_factory=lambda: defaults()["routeCosts"], max_length=4)
    frozenPrices: dict[ProductId, Amount] = Field(default_factory=lambda: defaults()["frozenPrices"], max_length=9)
    freezeCost: Amount = 10
    requests: dict[RequestId, Reservation] = Field(default_factory=dict, max_length=100)
    label: Annotated[str, Field(max_length=200)] = "Иллюстрация: учебные данные"

    @field_validator("requests")
    @classmethod
    def safe_reservation_ids(cls, value):
        if any(key in ("__proto__", "constructor", "prototype") or not key.strip() for key in value):
            raise ValueError("Идентификатор заявки требует обычного текстового значения")
        return value


class EvaluationBody(InputModel):
    params: Params = Field(default_factory=Params)


class NewRequest(Reservation):
    requestId: RequestId
    forecastAbsorption: StrictBool = True

    @field_validator("requestId")
    @classmethod
    def safe_request_id(cls, value):
        if value in ("__proto__", "constructor", "prototype"):
            raise ValueError("Идентификатор заявки требует обычного текстового значения")
        return value


class RequestBody(EvaluationBody):
    request: NewRequest


class Confirmations(InputModel):
    com: StrictBool = False
    prod: StrictBool = False
    fin: StrictBool = False
    commercial: StrictBool = False
    production: StrictBool = False
    finance: StrictBool = False


class SnapshotBody(EvaluationBody):
    confirmations: Confirmations = Field(default_factory=Confirmations)


class ApprovedSnapshot(InputModel):
    valid: StrictBool
    approved: StrictBool
    params: Params
    result: dict
    confirmations: Confirmations
    label: str = Field(max_length=200)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    modelVersion: str = Field(max_length=20)


class FactBody(InputModel):
    params: Params | None = None
    snapshot: ApprovedSnapshot | None = None

    @model_validator(mode="after")
    def one_source(self):
        if (self.params is None) == (self.snapshot is None):
            raise ValueError("Выберите один источник: параметры плана или утверждённый снимок")
        return self


class RoiOptions(InputModel):
    weeks: Annotated[int, Field(strict=True, ge=0, le=53)] = 52
    execution: Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)] = 1
    investment: Budget | None = None
    annualOpex: Budget | None = None


class RoiBody(EvaluationBody):
    options: RoiOptions = Field(default_factory=RoiOptions)


class ClientOptions(InputModel):
    volume: Amount
    share: Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
    price: Amount
    service: Amount


class CommercialBody(InputModel):
    client: ClientOptions
