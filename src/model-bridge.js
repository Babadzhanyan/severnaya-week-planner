// Связь заказов недели с расчетом модели: спрос, выпуск, вклад и загрузка мощности.
// Строки заказов читаются из хранилища недели (store/weekStore.js). Модель (PlannerModel из model.js) передается аргументом,
// поэтому функции чистые и проверяются в тесте без браузера. Объемы в т, цены в руб./кг, суммы в руб.
import {ORDER_CLASSES, contentHash} from './store/weekStore.js';
import {toSavePayload} from './scenario-state.js';
import {n} from './format.js';

const [CONFIRMED, FORECAST, EXTRA] = ORDER_CLASSES;
const MODEL_CLASS = {[CONFIRMED]: 'confirmed', [FORECAST]: 'forecast', [EXTRA]: 'extra'};
// Подписи для экрана без буквы «ё»: класс в данных хранится по контракту.
export const CLASS_LABEL = {[CONFIRMED]: 'подтвержден', [FORECAST]: 'прогноз', [EXTRA]: 'дополнительно'};
// Статусы по разделу 8 дизайн-системы: символ, слово и цвет передаются через класс chip.
export const STATUS = Object.freeze({
  ok: {level: 'ok', symbol: '●', word: 'В норме'},
  warn: {level: 'warn', symbol: '▲', word: 'Внимание'},
  risk: {level: 'risk', symbol: '■', word: 'Риск'},
  none: {level: 'none', symbol: '○', word: 'Нет данных'},
});
// Порог внимания по загрузке мощности. Значение предложено, требует подтверждения производства.
export const LOAD_WARN = 0.9;
const EPS = 1e-9;
const KG = 1000;
// Ставки и мощности без подтверждения показываются с подписью «Требуется подтверждение».
const CONFIRM_LABELS = [
  ['raw', 'цена сырья'],
  ['routeCost', 'переменные затраты схем'],
  ['freeze', 'стоимость заморозки'],
  ['freezePrice', 'цена заморозки'],
  ['capacity', 'мощность разделки'],
  ['stageCapacity', 'мощность обвалки, упаковки и заморозки'],
  ['storage', 'емкость хранения'],
  ['service', 'стоимость обслуживания заказов'],
  ['costMethod', 'методика себестоимости'],
];

// Предохранитель масштаба выводит предупреждение, расчет недели не блокирует. Вход и масштаб недели, т.
export function scaleWarningText(inputKg, scaleKg) {
  return `Масштаб недели ниже ожидаемого: ${n(inputKg / KG)} т против ${n(scaleKg / KG, 0)} т`;
}

// Кнопка «Сохранить вариант» активна, когда есть строки недели и расчет выполнен.
export function canSaveVariant(rowCount, plan) {
  return rowCount > 0 && plan?.valid === true;
}

export function loadStatus(utilization) {
  if (!Number.isFinite(utilization)) return STATUS.none;
  if (utilization > 1 + EPS) return STATUS.risk;
  return utilization >= LOAD_WARN ? STATUS.warn : STATUS.ok;
}

export function unconfirmedOf(confirmed = {}) {
  return CONFIRM_LABELS.filter(([key]) => confirmed[key] !== true).map(([, label]) => `Требуется подтверждение: ${label}`);
}

// Спрос по товарам из строк недели. Подтвержденные заказы и прогноз с вероятностью входят в расчет;
// дополнительный спрос не входит в расчет вклада и считается отдельно. Цена товара – средняя по объему расчетных строк.
export function demandFromRows(rows, productIds) {
  const cells = Object.fromEntries(productIds.map(id => [id, {confirmedT: 0, forecastT: 0, forecastRawT: 0, extraT: 0, priceQty: 0, priceSum: 0}]));
  const excluded = new Set();
  for (const row of rows) {
    if (!Object.hasOwn(cells, row.product)) { excluded.add(row.product); continue; }
    const cell = cells[row.product], cls = MODEL_CLASS[row.orderClass];
    if (cls === 'confirmed') {
      cell.confirmedT += row.volumeKg / KG;
      cell.priceQty += row.volumeKg;
      cell.priceSum += row.volumeKg * row.priceRubKg;
    } else if (cls === 'forecast') {
      const effective = row.volumeKg * row.probability;
      cell.forecastRawT += row.volumeKg / KG;
      cell.forecastT += effective / KG;
      cell.priceQty += effective;
      cell.priceSum += effective * row.priceRubKg;
    } else if (cls === 'extra') {
      cell.extraT += row.volumeKg / KG;
    }
  }
  const products = Object.fromEntries(productIds.map(id => {
    const c = cells[id];
    return [id, {confirmedT: c.confirmedT, forecastT: c.forecastT, forecastRawT: c.forecastRawT, extraT: c.extraT, priceRubKg: c.priceQty > 0 ? c.priceSum / c.priceQty : 0}];
  }));
  return {products, excluded: [...excluded]};
}

// Ставки недели. Значения берутся из файла недели (контракт), иначе из учебных параметров планировщика.
// Подтверждение: ставка считается подтвержденной только при признаке financeConfirmed в файле недели.
export function ratesFrom({p, week, M}) {
  const finite = value => Number.isFinite(value);
  const cfgRoutes = week?.routes ?? {}, cfgProducts = week?.products ?? {};
  const finance = week?.financeConfirmed === true;
  const codes = Object.keys(M.routes), ids = Object.keys(M.products);
  const routeCostRubKg = Object.fromEntries(codes.map(code => {
    const fromFile = cfgRoutes[code]?.variableCostRubKg;
    return [code, finite(fromFile) ? fromFile : (p.routeCosts?.[code] ?? M.routes[code].variableCost)];
  }));
  const freezePriceRubKg = Object.fromEntries(ids.map(id => {
    const fromFile = cfgProducts[id]?.freezePriceRubKg;
    return [id, finite(fromFile) ? fromFile : (p.frozenPrices?.[id] ?? 0)];
  }));
  const fileCapacity = week?.capacityWeekT?.deboning;
  const rawFromFile = finite(week?.rawCostRubKg);
  const routeFromFile = codes.every(code => finite(cfgRoutes[code]?.variableCostRubKg));
  const freezeFromFile = ids.every(id => finite(cfgProducts[id]?.freezePriceRubKg));
  return {
    inputKg: p.totalInput * KG,
    rawCostRubKg: rawFromFile ? week.rawCostRubKg : p.rawCost,
    routeCostRubKg,
    rawInRate: Object.fromEntries(codes.map(code => [code, cfgRoutes[code]?.rawInRate === true])),
    // Мощность разделки недели: файл недели, иначе эффективная мощность планировщика (учебная).
    capacityCutT: finite(fileCapacity) ? fileCapacity : Math.min(p.capacity, p.hours * p.rate),
    stageCapacity: {deboning: p.stageCapacity.deboning, packing: p.stageCapacity.packing, freezing: p.stageCapacity.freezing},
    coldCapacityT: p.coldCapacity,
    freezeCostRubKg: p.freezeCost,
    freezePriceRubKg,
    confirmed: {
      raw: rawFromFile && finance,
      routeCost: routeFromFile && finance,
      freezePrice: freezeFromFile && finance,
      freeze: false, stageCapacity: false, storage: false, service: false, costMethod: week?.costMethod === 'weight' && finance,
      capacity: finite(fileCapacity),
    },
  };
}

// Строки заказов в формате модели: класс, объем кг, цена, вероятность прогноза. Строки с чужим товаром пропускаются.
export function modelWeek({rows, M, inputKg, routeCode, rates}) {
  const orders = rows.filter(row => Object.hasOwn(M.products, row.product) && MODEL_CLASS[row.orderClass]).map(row => ({
    id: row.key, product: row.product, orderClass: MODEL_CLASS[row.orderClass], qtyKg: row.volumeKg, priceRubKg: row.priceRubKg,
    ...(row.orderClass === FORECAST ? {probability: row.probability} : {}), orderDate: row.day,
  }));
  const minWholeKg = orders.filter(o => o.product === 'whole' && o.orderClass === 'confirmed').reduce((sum, o) => sum + o.qtyKg, 0);
  return {inputKg, routeCode, capacityWeekT: rates.capacityCutT, rawCostRubKg: rates.rawCostRubKg, minWholeKg, freezePriceRubKg: rates.freezePriceRubKg, costMethod: 'weight', orders};
}

// Расчет недели: спрос из строк, выпуск и разделка по модели evaluate, вклад с сырьем один раз и затратами заморозки.
export function planFromRows({rows, M, routeCode, cutT, rates}) {
  const ids = Object.keys(M.products);
  const {products: demand, excluded} = demandFromRows(rows, ids);
  const zero = () => Object.fromEntries(ids.map(id => [id, 0]));
  const orders = zero(), totalDemand = zero(), prices = zero(), service = zero(), frozenPrices = zero();
  for (const id of ids) {
    const d = demand[id];
    orders[id] = d.confirmedT;
    totalDemand[id] = d.confirmedT + d.forecastT;
    prices[id] = d.priceRubKg;
    frozenPrices[id] = rates.freezePriceRubKg[id];
  }
  const routeCosts = Object.fromEntries(Object.keys(M.routes).map(code => [code, rates.routeCostRubKg[code]]));
  const params = {
    totalInput: rates.inputKg / KG, rawCost: rates.rawCostRubKg, capacity: rates.capacityCutT, hours: 1, rate: rates.capacityCutT,
    minWhole: orders.whole, cut: cutT, route: routeCode, coldCapacity: rates.coldCapacityT, stageCapacity: rates.stageCapacity,
    prices, demand: totalDemand, orders, service, routeCosts, frozenPrices, freezeCost: rates.freezeCostRubKg, requests: {},
  };
  const r = M.evaluate(params);
  if (!r.valid) return {valid: false, feasible: false, errors: r.errors, excluded};
  // Сырье считается один раз: при rawInRate ставка схемы уже содержит сырье, отдельно оно не добавляется.
  const raw = code => (rates.rawInRate[code] === true ? 0 : rates.rawCostRubKg);
  const rawRub = (r.whole * raw('whole') + r.cut * raw(routeCode)) * KG;
  const contribution = r.revenue - r.serviceCost - rawRub - r.routeCost - r.freezeCost;
  const costWeek = {
    rawCostRubKg: rates.rawCostRubKg, routeCode, costMethod: 'weight',
    routeTable: Object.fromEntries(Object.keys(M.routes).map(code => [code, {...M.routes[code], variableCost: rates.routeCostRubKg[code], rawInRate: rates.rawInRate[code] === true}])),
  };
  const route = M.routes[routeCode];
  // Тушка есть в любой схеме: остаток после разделки выпускается как целая тушка (productsOf в model.js).
  const routeIds = ['whole', ...Object.keys(route.yields)];
  const products = ids.filter(id => demand[id].confirmedT + demand[id].forecastT + demand[id].extraT > EPS || r.produced[id] > EPS).map(id => {
    const a = r.allocations[id], d = demand[id];
    return {
      id, name: M.products[id].name, confirmedT: d.confirmedT, forecastT: d.forecastT, forecastRawT: d.forecastRawT, extraT: d.extraT, priceRubKg: d.priceRubKg,
      producedT: a.produced, soldT: a.sold, remainingT: a.remaining, shortfallT: a.shortfall, revenueRub: a.revenue,
      costRubKg: routeIds.includes(id) ? M.unitCostRegister(costWeek, id) : null,
    };
  });
  const stages = r.stages.filter(s => s.active).map(s => ({id: s.id, name: s.name, load: s.load, capacity: s.capacity, unit: s.unit, utilization: s.utilization, status: loadStatus(s.utilization)}));
  if (r.storage.load > EPS) stages.push({id: 'storage', name: 'Хранение', load: r.storage.load, capacity: r.storage.capacity, unit: r.storage.unit, utilization: r.storage.utilization, status: loadStatus(r.storage.utilization)});
  const bottleneck = stages.filter(s => Number.isFinite(s.utilization)).reduce((best, s) => (!best || s.utilization > best.utilization ? s : best), null);
  // Себестоимость по статьям на кг выпуска (весовой метод): сырье и переменные затраты схемы делятся на сумму выходов.
  const yieldSum = routeCode === 'whole' ? 1 : Object.values(route.yields).reduce((sum, y) => sum + y, 0);
  const rawPerKg = yieldSum > 0 ? raw(routeCode) / yieldSum : null;
  const routePerKg = yieldSum > 0 ? rates.routeCostRubKg[routeCode] / yieldSum : null;
  const produced = Object.values(r.produced).reduce((sum, v) => sum + v, 0);
  return {
    valid: true, feasible: r.feasible, errors: [], violations: r.violations, excluded,
    routeCode, cutT: r.cut, wholeT: r.whole, inputT: rates.inputKg / KG, producedT: produced,
    products, extraT: products.reduce((sum, p) => sum + p.extraT, 0),
    revenue: r.revenue, serviceCost: r.serviceCost, rawCost: rawRub, routeCost: r.routeCost, freezeCost: r.freezeCost, contribution,
    inventoryT: r.inventoryT, inventoryValue: r.inventoryValue,
    lossT: r.loss, massBalanceT: r.massBalance,
    stages, bottleneck, maxLoadPct: bottleneck ? bottleneck.utilization * 100 : null,
    split: {rawRubKg: rawPerKg, routeRubKg: routePerKg},
    unconfirmed: unconfirmedOf(rates.confirmed),
  };
}

// Показатели варианта для хранения и сравнения: ключи те же, что у результата пересчета сценария (scenarios-local.js, variantFacts).
export function variantResult(plan) {
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  return {
    contribution: round(plan.contribution, 0), revenue: round(plan.revenue, 0),
    whole: round(plan.wholeT, 2), cut: round(plan.cutT, 2), produced: round(plan.producedT, 2),
    maxLoadPct: plan.maxLoadPct === null ? null : round(plan.maxLoadPct, 1),
    bottleneck: plan.bottleneck ? plan.bottleneck.name : 'нет',
    feasible: plan.feasible === true,
  };
}

// Снимок варианта недели: состав сохранения сценария (ключ и содержимое, как у «Сохранить гипотезу») плюс состав недели.
// Открытие читает inputs.keyFields и inputs.content; хеш считается по inputs и result, как при проверке файла (variantHashOk).
// Повтор того же состава и рычагов дает тот же хеш.
export async function variantSnapshot({rows, weekStart, plan, state, routeName, createdAt = new Date().toISOString()}) {
  const {keyFields, content} = toSavePayload(state);
  const inputs = {source: 'week', weekStart, routeCode: plan.routeCode, cutT: Math.round(plan.cutT * 100) / 100, inputT: Math.round(plan.inputT * 100) / 100, rowsHash: await contentHash(rows), keyFields, content};
  const result = variantResult(plan);
  const hash = await contentHash({inputs, result});
  const cut = String(Math.round(plan.cutT * 10) / 10).replace('.', ',');
  return {
    id: 'v-' + hash.slice(0, 16), title: `${routeName}, разделка ${cut} т`.slice(0, 80), createdAt, contentHash: hash,
    inputs, result,
  };
}
