"""Ввод сервера: конечные значения и явные границы учебного расчета."""
from typing import Annotated, Any, Literal
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
            raise ValueError("Выберите один источник: параметры плана или утвержденный снимок")
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


# Ответы файловых маршрутов: закрытый перечень полей.
# Поля вне перечня отбрасываются при отдаче (response_model_exclude_unset).
# Значения принимаются как есть. Контролируется перечень ключей: типы реальных данных
# при разработке недоступны, поэтому жесткая типизация значений отложена.
class OutputModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Period(OutputModel):
    start: Any = None
    end: Any = None
    label: Any = None


class Units(OutputModel):
    quantity: Any = None
    money: Any = None
    price: Any = None
    vat: Any = None


class Money(OutputModel):
    volumeKg: Any = None
    revenueRub: Any = None
    reportedCostRub: Any = None
    reportedLogisticsRub: Any = None
    reconciliationRub: Any = None
    marginRub: Any = None
    fullCostRubKg: Any = None
    discountRub: Any = None
    logisticsRub: Any = None
    marketCeilingRubKg: Any = None


class Financial(Money):
    rowCount: Any = None
    priceRubKg: Any = None
    reportedCostRubKg: Any = None
    reportedTotalCostRub: Any = None
    marginRubKg: Any = None
    fullCostRub: Any = None
    logisticsCoverage: Any = None
    reportedCostCoverage: Any = None
    allocationCoverage: Any = None
    quantityAdjustmentKg: Any = None
    revenueAdjustmentRub: Any = None
    reportedRawCostRub: Any = None
    reportedProcessingCostRub: Any = None
    reportedPackagingCostRub: Any = None
    knownAllocatedProductionCostRub: Any = None
    allocatedProductionCostRub: Any = None
    observedMinPriceRubKg: Any = None
    observedMaxPriceRubKg: Any = None
    observedPriceBasis: Any = None
    priceObservationCount: Any = None
    priceExcludedRowCount: Any = None
    months: Any = None
    status: Any = None


class Gap(OutputModel):
    id: Any = None
    message: Any = None


class Quality(OutputModel):
    zeroVolumeRows: Any = None
    negativeVolumeRows: Any = None
    missingReportedCostRows: Any = None
    missingLogisticsRows: Any = None
    missingMappedProductRows: Any = None
    missingAllocatedCostRows: Any = None
    sourceCostStatuses: Any = None
    cachedFormulaErrorCount: Any = None
    scopeNote: Any = None


class SourceInfo(OutputModel):
    role: Any = None
    period: Any = None
    vat: Any = None


class DatasetInfo(OutputModel):
    id: Any = None
    label: Any = None
    clientCount: Any = None
    sourceNameCount: Any = None
    rowCount: Any = None
    volumeKg: Any = None
    revenueRub: Any = None


class ClientSummary(Financial):
    clientCount: Any = None
    sourceNameCount: Any = None
    productCount: Any = None
    channelCount: Any = None
    deliveryZoneCount: Any = None


class ClientRow(Financial):
    pseudonym: Any = None
    channels: Any = None
    deliveryZones: Any = None
    retailChains: Any = None
    marginBasis: Any = None
    productCount: Any = None


class ClientsCatalog(OutputModel):
    datasetId: Any = None
    period: Period | None = None
    units: Units | None = None
    datasets: list[DatasetInfo] | None = None
    summary: ClientSummary | None = None
    clients: list[ClientRow] | None = None
    quality: Quality | None = None
    gaps: list[Gap] | None = None
    sources: list[SourceInfo] | None = None
    scopeNote: Any = None
    detailsPath: Any = None


class ClientMonthly(Money):
    period: Any = None
    productKey: Any = None
    costProductKey: Any = None
    rowCount: Any = None
    priceRubKg: Any = None
    marginRubKg: Any = None
    reportedTotalCostRub: Any = None
    reportedRawCostRub: Any = None
    reportedProcessingCostRub: Any = None
    reportedPackagingCostRub: Any = None
    allocatedProductionCostRub: Any = None
    knownAllocatedProductionCostRub: Any = None
    allocationCoverage: Any = None
    logisticsCoverage: Any = None
    reportedCostCoverage: Any = None
    observedMinPriceRubKg: Any = None
    observedMaxPriceRubKg: Any = None
    priceObservationCount: Any = None
    priceExcludedRowCount: Any = None


class ClientProduct(Financial):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")
    period: Period | None = None
    productKey: Any = None
    costProductKey: Any = None
    state: Any = None
    marginBasis: Any = None
    monthly: list[ClientMonthly] | None = None


class ClientDetail(Financial):
    pseudonym: Any = None
    channels: Any = None
    deliveryZones: Any = None
    retailChains: Any = None
    marginBasis: Any = None
    products: list[ClientProduct] | None = None


class ClientDetails(OutputModel):
    datasetId: Any = None
    period: Period | None = None
    client: ClientDetail | None = None
    gaps: list[Gap] | None = None


class Thresholds(OutputModel):
    focalMinKg: Any = None
    peerMinKg: Any = None
    peerMinClients: Any = None
    gapMinShare: Any = None


class Signal(OutputModel):
    period: Any = None
    channel: Any = None
    priceRubKg: Any = None
    referencePriceRubKg: Any = None
    observedPeerMinRubKg: Any = None
    observedPeerMaxRubKg: Any = None
    peerClients: Any = None
    peerVolumeKg: Any = None
    focalVolumeKg: Any = None
    scenarioRub: Any = None
    status: Any = None
    priceGapRubKg: Any = None
    gapShare: Any = None


class RecommendationProduct(OutputModel):
    productId: Any = None
    costProductKey: Any = None
    signalCount: Any = None
    bestSignal: Signal | None = None
    signals: list[Signal] | None = None
    requirements: Any = None


class Recommendations(OutputModel):
    datasetId: Any = None
    productId: Any = None
    label: Any = None
    action: Any = None
    priorityGroup: Any = None
    historicalReviewRub: Any = None
    historicalReviewBasis: Any = None
    requirements: Any = None
    signalCount: Any = None
    products: list[RecommendationProduct] | None = None
    thresholds: Thresholds | None = None
    priceMethod: Any = None
    boundsBasis: Any = None
    scopeNote: Any = None
    marketCeilingRubKg: Any = None
    confirmedProfitRub: Any = None


class LabeledItem(OutputModel):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")


class BreakdownItem(OutputModel):
    id: Any = None
    rubKg: Any = None


class SelectedRow(OutputModel):
    period: Any = None
    product_key: Any = None
    label: Any = Field(default=None, validation_alias="name")
    volumeKg: Any = None
    rawCostRubKg: Any = None
    processingCostRubKg: Any = None
    packingRubKg: Any = None
    productionCostRubKg: Any = None
    logisticsRubKg: Any = None
    logisticsIncluded: Any = None
    fullCostRubKg: Any = None
    fullCostConfirmed: Any = None
    coverage: Any = None
    status: Any = None
    issues: Any = None
    fieldStatus: Any = None
    stageBreakdown: list[BreakdownItem] | None = None
    articleBreakdown: list[BreakdownItem] | None = None


class CostProduct(OutputModel):
    key: Any = None
    label: Any = Field(default=None, validation_alias="name")
    periods: Any = None


class CostCounts(OutputModel):
    products: Any = None
    records: Any = None
    partialRecords: Any = None


class Costs(OutputModel):
    schemaVersion: Any = None
    method: Any = None
    periods: Any = None
    costBasis: Any = None
    costBasisLabel: Any = None
    taxBasis: Any = None
    taxBasisStatus: Any = None
    fullCostStatus: Any = None
    logisticsStatus: Any = None
    breakdownStatus: Any = None
    stageCatalog: list[LabeledItem] | None = None
    articleCatalog: list[LabeledItem] | None = None
    issueLabels: Any = None
    statusLabels: Any = None
    products: list[CostProduct] | None = None
    counts: CostCounts | None = None
    selectionStatus: Any = None
    selected: SelectedRow | None = None


class DemandTotals(OutputModel):
    volumeKg: Any = None
    revenueRub: Any = None
    reportedCostRub: Any = None
    reportedMarginRub: Any = None
    priceRubKg: Any = None
    reportedCostRubKg: Any = None
    reportedMarginRubKg: Any = None
    reportedCostStatus: Any = None
    clientCount: Any = None
    rowCount: Any = None


class DemandProduct(DemandTotals):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")
    costProductKey: Any = None
    identityBasis: Any = None
    month: Any = None
    historyDays: Any = None
    days: Any = None
    suggestedDemandKg: Any = None
    ordersKg: Any = None
    costProductionRubKg: Any = None
    costStatus: Any = None
    status: Any = None


class DemandCost(OutputModel):
    status: Any = None
    productionCostRubKg: Any = None
    fullCostRubKg: Any = None
    method: Any = None
    costBasis: Any = None
    taxBasis: Any = None
    month: Any = None
    period: Any = None
    rawCostRubKg: Any = None
    processingCostRubKg: Any = None
    packingRubKg: Any = None
    fieldStatus: Any = None
    issues: Any = None
    costProductKey: Any = None


class DatasetRef(OutputModel):
    id: Any = None
    label: Any = None


class DemandSummary(OutputModel):
    productCount: Any = None
    volumeKg: Any = None
    revenueRub: Any = None


class DemandCatalog(OutputModel):
    datasetId: Any = None
    month: Any = None
    days: Any = None
    months: Any = None
    historyDays: Any = None
    referenceMethod: Any = None
    products: list[DemandProduct] | None = None
    summary: DemandSummary | None = None
    datasets: list[DatasetRef] | None = None
    scopeNote: Any = None
    gaps: Any = None


class DemandClient(DemandTotals):
    pseudonym: Any = None


class DemandHistory(DemandTotals):
    month: Any = None
    historyDays: Any = None
    observed: Any = None


class DemandDetails(OutputModel):
    datasetId: Any = None
    month: Any = None
    days: Any = None
    referenceMethod: Any = None
    product: DemandProduct | None = None
    clients: list[DemandClient] | None = None
    history: list[DemandHistory] | None = None
    cost: DemandCost | None = None
    gaps: Any = None


class DemandInputs(OutputModel):
    dataset: Any = None
    productId: Any = None
    month: Any = None
    days: Any = None
    plannedDemandKg: Any = None
    ordersKg: Any = None
    inventoryKg: Any = None
    safetyKg: Any = None
    priceRubKg: Any = None
    discountPct: Any = None
    logisticsRubKg: Any = None


class DemandReference(OutputModel):
    method: Any = None
    priceRubKg: Any = None
    sameQuantityKg: Any = None
    sameQuantityRevenueRub: Any = None
    suggestedDemandKg: Any = None


class DemandScenario(OutputModel):
    productionNeedKg: Any = None
    grossRevenueRub: Any = None
    revenueRub: Any = None
    netPriceRubKg: Any = None
    priceChangeRubKg: Any = None
    deltaRevenueRub: Any = None
    purePriceEffectRub: Any = None
    discountEffectRub: Any = None
    additionalLogisticsRub: Any = None
    revenueAfterAdditionalLogisticsRub: Any = None
    fullMarginRub: Any = None
    capacityFeasible: Any = None


class WaterfallStep(OutputModel):
    label: Any = Field(default=None, validation_alias="name")
    value: Any = None
    total: Any = None


class DemandCompleteness(OutputModel):
    ordersKnown: Any = None
    stockKnown: Any = None
    safetyKnown: Any = None
    priceKnown: Any = None
    discountKnown: Any = None
    logisticsKnown: Any = None
    inputsComplete: Any = None
    missing: Any = None


class DemandEvaluation(OutputModel):
    datasetId: Any = None
    product: DemandProduct | None = None
    inputs: DemandInputs | None = None
    reference: DemandReference | None = None
    scenario: DemandScenario | None = None
    cost: DemandCost | None = None
    waterfall: list[WaterfallStep] | None = None
    completeness: DemandCompleteness | None = None
    gaps: Any = None


# Ответы мощностей, экономики и производственной цепочки из файлов: закрытый перечень полей.
# Поля file, sha256, sourceRefs и пути в ответ не попадают; имена записей отдаются как label.
class CapacitySource(OutputModel):
    status: Any = None
    capturedAt: Any = None
    liveData: Any = None


class CapacityPeriod(OutputModel):
    volumeLabel: Any = None
    yieldStructureLabel: Any = None
    displayUnit: Any = None


class CapacityCalendarAvailability(OutputModel):
    value: Any = None


class CapacityCalendars(OutputModel):
    availability: CapacityCalendarAvailability | None = None


class CapacityPlan(OutputModel):
    finishedKgDay: Any = None
    wholeKgDay: Any = None
    cutKgDay: Any = None
    liveKgDay: Any = None
    headsDay: Any = None


class CapacityRow(OutputModel):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")
    unit: Any = None
    massBasis: Any = None
    formula: Any = None
    assumption: Any = None
    resourceGroup: Any = None
    demand: Any = None
    capacity: Any = None
    baseCapacity: Any = None
    staffTotal: Any = None
    staffPerShift: Any = None
    requiredStaffTotalRounded: Any = None
    shifts: Any = None
    hours: Any = None
    kgPerPersonHour: Any = None
    extraPersonHoursDay: Any = None
    extraNetPersonHoursDay: Any = None
    extraGrossHoursDay: Any = None
    sourceStatus: Any = None
    load: Any = None
    headroom: Any = None
    status: Any = None
    # Паспорт единиц ресурса (backend/units.py): ячейки книги, период, календарь, правило перевода, карточка загрузки.
    sourceCells: Any = None
    period: Any = None
    calendarAvailability: Any = None
    conversionRule: Any = None
    weighingPointStatus: Any = None
    loadPct: Any = None
    card: Any = None
    kgPerDay: Any = None
    kgPerShift: Any = None
    kgPerHour: Any = None
    headsPerHour: Any = None
    headsPerHourStatus: Any = None
    netHoursDay: Any = None
    grossHoursDay: Any = None
    parallelLines: Any = None
    parallelLinesStatus: Any = None
    lossPct: Any = None
    lossStatus: Any = None
    packKind: Any = None
    operationsStatus: Any = None


class CapacityNetwork(OutputModel):
    maxFinishedKgDay: Any = None
    fulfilledPlanKgDay: Any = None
    shortfallKgDay: Any = None
    limitingId: Any = None
    limitingLabel: Any = Field(default=None, validation_alias="limitingName")
    moneyEffect: Any = None


class CapacityEffect(OutputModel):
    maxFinishedDeltaKgDay: Any = None
    fulfilledPlanDeltaKgDay: Any = None
    shortfallReductionKgDay: Any = None
    moneyEffect: Any = None


class CapacityLever(CapacityEffect):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")
    stageId: Any = None
    inputDelta: Any = None
    stageCapacityDeltaKgDay: Any = None
    extraPersonHoursDay: Any = None
    scenario: CapacityNetwork | None = None


class CapacityEvaluation(OutputModel):
    inputs: Any = None
    source: CapacitySource | None = None
    period: CapacityPeriod | None = None
    calendars: CapacityCalendars | None = None
    plan: CapacityPlan | None = None
    gaps: Any = None
    flowSplit: Any = None
    referenceCheck: Any = None
    unitPassports: Any = None
    rows: list[CapacityRow] | None = None
    baseline: CapacityNetwork | None = None
    scenario: CapacityNetwork | None = None
    leverEffects: list[CapacityLever] | None = None
    combinedEffect: CapacityEffect | None = None
    moneyEffect: Any = None
    assumption: Any = None
    moneyStatus: Any = None
    staffingAssumption: Any = None
    timeAssumption: Any = None


class CapacityCatalog(CapacityEvaluation):
    defaults: Any = None


class EconomicsPayload(OutputModel):
    version: Any = None
    purpose: Any = None
    whole_baseline: Any = None
    products: Any = None
    routes: Any = None
    integration_contract: Any = None


class YieldsPayload(OutputModel):
    schema_version: Any = None
    audited_at: Any = None
    products: Any = None
    routes: Any = None
    gaps: Any = None


class EconomicsCatalog(OutputModel):
    economics: EconomicsPayload | None = None
    yields: YieldsPayload | None = None


class ProductionRoute(OutputModel):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")


class ProductionRow(OutputModel):
    id: Any = None
    label: Any = Field(default=None, validation_alias="name")
    demandKgDay: Any = None
    capacityKgDay: Any = None
    coefficient: Any = None
    calculation: Any = None
    massBasis: Any = None
    unit: Any = None
    gapIds: Any = None
    utilization: Any = None
    status: Any = None


class ProductionCatalog(OutputModel):
    routes: list[ProductionRoute] | None = None
    chainNodes: Any = None
    stageNodeLinks: Any = None
    uiNodeAliases: Any = None
    gaps: Any = None
    counts: Any = None
    sourceStatus: Any = None
    period: Any = None


class ProductionEvaluation(OutputModel):
    routeId: Any = None
    inputKgDay: Any = None
    rows: list[ProductionRow] | None = None
    knownCount: Any = None
    requiredCount: Any = None
    complete: Any = None
    feasible: Any = None
    fullChainFeasible: Any = None
    sourceStatus: Any = None
    period: Any = None
    counts: Any = None
