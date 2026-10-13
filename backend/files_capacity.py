"""Расчёт мощностей из отдельного локального набора предприятия."""
from copy import deepcopy
import json
import math
import os
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

router = APIRouter(prefix="/api/files/capacity", tags=["Мощности из файлов"])
Number = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
Positive = Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)]
STAGE_MASS_BASES = {'receiving': 'Живой вес в эквиваленте общего потока',
 'hanging': 'Живой вес в эквиваленте общего потока',
 'slaughter': 'Живой вес в эквиваленте общего потока',
 'plucking': 'Живой вес в эквиваленте общего потока',
 'evisceration': 'Масса потрохов, выход от расчётного поголовья',
 'water_cooling': 'Живой вес в эквиваленте общего потока',
 'carcass_cold_store': 'Живой вес в эквиваленте общего потока',
 'sorting': 'Живой вес в эквиваленте общего потока',
 'bulk_carcass_pack': 'Готовая тушка с признаком валовой упаковки',
 'individual_carcass_pack': 'Готовая тушка с признаком индивидуальной упаковки',
 'liver': 'Ливер, 3% от готового потока тушки и разделки',
 'byproduct_pack': 'Индивидуальные субпродукты, 2% от готового потока',
 'feet_pack': 'Лапы, 4% от готового потока тушки и разделки',
 'cutting': 'Готовые позиции с признаком разделки STORK / MEYN',
 'breast_fillet': 'Готовые позиции филе грудки',
 'thigh_fillet': 'Готовые позиции филе бедра',
 'ishida_pack': 'Готовые позиции с признаком упаковки ISHIDA'}
PRIMARY_IDS = frozenset(("receiving", "hanging", "slaughter", "plucking", "water_cooling", "carcass_cold_store", "sorting"))


class CapacityInputs(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    feetStaffDelta: Annotated[int, Field(strict=True, ge=0, le=30)] = 0
    liverStaffDelta: Annotated[int, Field(strict=True, ge=0, le=20)] = 0
    cuttingNetHoursDelta: Annotated[float, Field(strict=True, ge=0, le=8, allow_inf_nan=False)] = 0


class SourcePassport(BaseModel):
    file: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["Сохранённый расчёт файла"]
    capturedAt: str = Field(min_length=1)
    liveData: Literal[False]


class SourcePeriod(BaseModel):
    volumeLabel: str = Field(min_length=1)
    yieldStructureLabel: str = Field(min_length=1)
    displayUnit: Literal["т / сутки"]


class SourceRef(BaseModel):
    file: str
    sheet: str
    cells: str


class SourceStage(BaseModel):
    id: str
    name: str
    demand: Number
    capacity: Number
    unit: Literal["кг / сутки"]
    massBasis: str
    sourceRefs: list[SourceRef] = Field(min_length=1)
    formula: str = Field(min_length=1)
    assumption: str | None = None
    requiredStaffTotalRounded: Number | None = None
    resourceGroup: str = ""
    staffTotal: Number = 0
    shifts: Positive = 1
    hours: Number = 0
    kgPerPersonHour: Number | None = None


class CuttingLine(BaseModel):
    staffTotal: Number
    shifts: Positive
    kgPerPersonHour: Number
    equipmentKgPerHour: Number
    netHours: Number


class Availability(BaseModel):
    value: Annotated[float, Field(strict=True, gt=0, le=1, allow_inf_nan=False)]


class Calendar(BaseModel):
    availability: Availability


class SourcePlan(BaseModel):
    finishedKgDay: Positive
    wholeKgDay: Number
    cutKgDay: Number
    liveKgDay: Positive
    headsDay: Positive


class SourceData(BaseModel):
    schemaVersion: Annotated[int, Field(strict=True, ge=1, le=1)]
    source: SourcePassport
    period: SourcePeriod
    rows: list[SourceStage] = Field(min_length=17, max_length=17)
    cuttingLines: list[CuttingLine] = Field(min_length=1, max_length=20)
    plan: SourcePlan
    calendars: Calendar


def fail(status, message, kind):
    raise HTTPException(status_code=status, detail=[{"loc": ["source"], "msg": message, "type": kind}])


def clean_metadata(value):
    # Исходный набор содержит локальные пути и альтернативные копии файла.
    if isinstance(value, dict):
        return {key: (str(item).replace("\\", "/").rsplit("/", 1)[-1] if key == "file" else clean_metadata(item))
                for key, item in value.items() if key not in ("path", "versions")}
    if isinstance(value, list):
        return [clean_metadata(item) for item in value]
    return value


def load_source():
    directory = os.environ.get("SEVERNAYA_SOURCE_DATA_DIR")
    if not directory:
        fail(404, "Данные предприятия требуют подключения локальной папки источников", "source_missing")
    source_dir = Path(__file__).resolve().parent / "source_data" if directory == "bundled" else Path(directory)
    try:
        raw = json.loads((source_dir / "real_data_capacity.json").read_text(encoding="utf-8"))
        json.dumps(raw, allow_nan=False)
        data = SourceData.model_validate(raw)
        rows = {row.id: row for row in data.rows}
        if set(rows) != set(STAGE_MASS_BASES):
            raise ValueError("stage_ids")
        if any(row.massBasis != STAGE_MASS_BASES[row.id] for row in data.rows):
            raise ValueError("mass_basis")
        if not math.isclose(data.plan.finishedKgDay, data.plan.wholeKgDay + data.plan.cutKgDay, rel_tol=1e-8, abs_tol=1e-6):
            raise ValueError("plan_balance")
        if not math.isclose(rows["cutting"].demand, data.plan.cutKgDay, rel_tol=1e-8, abs_tol=1e-6) or not math.isclose(
            rows["bulk_carcass_pack"].demand + rows["individual_carcass_pack"].demand,
            data.plan.wholeKgDay, rel_tol=1e-8, abs_tol=1e-6,
        ):
            raise ValueError("plan_routes")
        if any(not math.isclose(rows[id].demand, data.plan.liveKgDay, rel_tol=1e-8, abs_tol=1e-6) for id in PRIMARY_IDS):
            raise ValueError("primary_mass")
        if any(row.shifts * row.hours > 24 for row in data.rows):
            raise ValueError("stage_daily_hours")
        for stage_id in set(rows) - PRIMARY_IDS - {"cutting"}:
            stage = rows[stage_id]
            if stage.kgPerPersonHour is None or stage.hours > 24 or not math.isclose(
                stage.capacity, stage.staffTotal * stage.hours * stage.kgPerPersonHour,
                rel_tol=1e-8, abs_tol=1e-6,
            ):
                raise ValueError("staff_capacity")
        cutting = sum(min(line.staffTotal / line.shifts * line.kgPerPersonHour, line.equipmentKgPerHour)
                      * line.shifts * line.netHours for line in data.cuttingLines)
        if any(line.shifts * line.netHours / data.calendars.availability.value > 24 for line in data.cuttingLines) or not math.isclose(
            rows["cutting"].capacity, cutting, rel_tol=1e-8, abs_tol=1e-6,
        ):
            raise ValueError("cutting_capacity")
    except FileNotFoundError:
        fail(404, "Файл real_data_capacity.json требует размещения в подключённой папке источников", "source_missing")
    except (OSError, ValueError, TypeError, ValidationError):
        fail(503, "Набор мощностей требует проверки структуры, единиц и формул источника", "source_invalid")
    return raw, data


def stage_rows(data, inputs):
    result = []
    for original in data.rows:
        row = original.model_dump()
        row["baseCapacity"] = original.capacity
        row["sourceStatus"] = data.source.status
        if original.id in ("feet_pack", "liver"):
            delta = inputs.feetStaffDelta if original.id == "feet_pack" else inputs.liverStaffDelta
            row["staffTotal"] += delta
            row["capacity"] = row["staffTotal"] * original.hours * original.kgPerPersonHour
            row["extraPersonHoursDay"] = delta * original.hours
        elif original.id == "cutting":
            row["capacity"] = sum(
                min(line.staffTotal / line.shifts * line.kgPerPersonHour, line.equipmentKgPerHour)
                * (line.shifts * line.netHours + inputs.cuttingNetHoursDelta)
                for line in data.cuttingLines
            )
            row["hours"] += inputs.cuttingNetHoursDelta
            row["extraNetPersonHoursDay"] = inputs.cuttingNetHoursDelta * sum(line.staffTotal / line.shifts for line in data.cuttingLines)
            availability = data.calendars.availability
            row["extraGrossHoursDay"] = inputs.cuttingNetHoursDelta / availability.value
            row["extraPersonHoursDay"] = row["extraNetPersonHoursDay"] / availability.value
        row["staffPerShift"] = row["staffTotal"] / row["shifts"]
        row["load"] = row["demand"] / row["capacity"] if row["capacity"] else (None if row["demand"] else 0)
        row["headroom"] = row["capacity"] - row["demand"]
        row["status"] = "Превышение мощности" if row["headroom"] < -1e-6 else "Высокая загрузка" if (row["load"] or 0) > .9 else "Резерв мощности"
        result.append(clean_metadata(row))
    return result


def network(rows, plan):
    limiting = min((row for row in rows if row["demand"] > 0), key=lambda row: row["capacity"] / row["demand"])
    maximum = plan * limiting["capacity"] / limiting["demand"]
    fulfilled = min(plan, maximum)
    return {"maxFinishedKgDay": maximum, "fulfilledPlanKgDay": fulfilled,
            "shortfallKgDay": max(0, plan - fulfilled), "limitingId": limiting["id"],
            "limitingName": limiting["name"], "moneyEffect": None}


def effect(before, after):
    return {"maxFinishedDeltaKgDay": after["maxFinishedKgDay"] - before["maxFinishedKgDay"],
            "fulfilledPlanDeltaKgDay": after["fulfilledPlanKgDay"] - before["fulfilledPlanKgDay"],
            "shortfallReductionKgDay": before["shortfallKgDay"] - after["shortfallKgDay"],
            "moneyEffect": None}


def evaluate_source(raw, data, inputs):
    plan = data.plan.finishedKgDay
    baseline_rows = stage_rows(data, CapacityInputs())
    baseline = network(baseline_rows, plan)
    rows = stage_rows(data, inputs)
    scenario = network(rows, plan)
    isolated = []
    for field, stage_id, name in (("feetStaffDelta", "feet_pack", "Персонал на упаковке лап"),
                                  ("liverStaffDelta", "liver", "Персонал на участке ливера"),
                                  ("cuttingNetHoursDelta", "cutting", "Чистое время работы разделки")):
        selected = getattr(inputs, field)
        separate = stage_rows(data, CapacityInputs(**{field: selected}))
        separate_network = network(separate, plan)
        changed = next(row for row in separate if row["id"] == stage_id)
        isolated.append({"id": field, "name": name, "stageId": stage_id, "inputDelta": selected,
                         "stageCapacityDeltaKgDay": changed["capacity"] - changed["baseCapacity"],
                         "extraPersonHoursDay": changed["extraPersonHoursDay"],
                         "scenario": separate_network, **effect(baseline, separate_network)})
    return {"inputs": inputs.model_dump(), "source": clean_metadata(raw.get("source", {})),
            "period": clean_metadata(raw.get("period", {})), "calendars": clean_metadata(raw.get("calendars", {})),
            "plan": clean_metadata(raw.get("plan", {})), "gaps": deepcopy(raw.get("gaps", [])),
            "rows": rows, "baseline": baseline, "scenario": scenario, "leverEffects": isolated,
            "combinedEffect": effect(baseline, scenario), "moneyEffect": None,
            "assumption": "Расчёт сохраняет состав продукции, нормы выхода и маршруты сохранённого плана",
            "moneyStatus": "Денежный эффект требует подтверждённых заказов и стоимости дополнительных ресурсов",
            "staffingAssumption": "Добавка изменяет общий фонд персонала; распределение между сменами подтверждает производство",
            "timeAssumption": "Добавка времени относится к чистой работе линии за сутки; график учитывает доступность"}


@router.get("")
def capacity_catalog():
    raw, data = load_source()
    return {**evaluate_source(raw, data, CapacityInputs()), "defaults": CapacityInputs().model_dump()}


@router.post("/evaluate")
def capacity_evaluate(inputs: CapacityInputs):
    raw, data = load_source()
    if any((line.shifts * line.netHours + inputs.cuttingNetHoursDelta) / data.calendars.availability.value > 24 for line in data.cuttingLines):
        fail(422, "Время по графику каждой линии с учётом доступности требует значения до 24 часов в сутки", "daily_hours_limit")
    return evaluate_source(raw, data, inputs)
