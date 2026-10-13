/* Расчёты продолжают production / allocate / evaluate исходных планировщиков.
   Объёмы API: тонны; цены: руб/кг; результат: рубли. Все параметры учебные. */
(function (root) {
  'use strict';
  const EPS = 1e-7;
  const products = {
    whole: { name: 'Тушка', short: 'Тушка' },
    fillet: { name: 'Филе грудки', short: 'Филе' },
    legs: { name: 'Ножки', short: 'Ножки' },
    wing: { name: 'Крыло', short: 'Крыло' },
    frame: { name: 'Каркас', short: 'Каркас' },
    breast: { name: 'Грудка на кости', short: 'Грудка' },
    legMeat: { name: 'Мякоть ножки', short: 'Мякоть' },
    legBone: { name: 'Кость ножки', short: 'Кость' },
    legSkin: { name: 'Кожа ножки', short: 'Кожа' }
  };
  const routes = {
    whole: { name: 'Целая тушка', description: 'Упаковка целой тушки', yields: {}, loss: 0, variableCost: 8, deboneInputShare: 0, sourceStatus: 'Учебный пример из паспорта расчётов' },
    coarse: { name: 'Крупная разделка', description: 'Грудка на кости, ножки, крыло и каркас', yields: { breast: .40, legs: .35, wing: .11, frame: .13 }, loss: .01, variableCost: 19, deboneInputShare: 0, sourceStatus: 'Учебная схема; нормы и ставки требуют подтверждения' },
    fillet: { name: 'Филе и ножки', description: 'Филе грудки, ножки, крыло и каркас', yields: { fillet: .32, legs: .35, wing: .11, frame: .20 }, loss: .02, variableCost: 20.3, deboneInputShare: .40, sourceStatus: 'Учебный пример из паспорта расчётов; загрузка обвалки условная' },
    deep: { name: 'Обвалка грудки и ножки', description: 'Филе грудки, мякоть ножки, кость, кожа, крыло и каркас', yields: { fillet: .32, legMeat: .24, legBone: .075, legSkin: .025, wing: .11, frame: .20 }, loss: .03, variableCost: 28, deboneInputShare: .75, sourceStatus: 'Учебная схема; нормы и ставки требуют подтверждения' }
  };
  const ids = Object.keys(products);
  const clone = value => JSON.parse(JSON.stringify(value));
  const total = values => values.reduce((sum, value) => sum + value, 0);
  const display = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const zero = () => Object.fromEntries(ids.map(id => [id, 0]));
  const unit = 'Иллюстрация: учебные данные';
  const parameterNames = {
    totalInput: 'Доступное сырьё', rawCost: 'Цена сырья', capacity: 'Мощность разделки',
    hours: 'Рабочее время', rate: 'Скорость разделки', minWhole: 'Минимальный заказ тушки',
    cut: 'Вход разделки', coldCapacity: 'Ёмкость хранения', freezeCost: 'Стоимость заморозки',
    prices: 'цена реализации', demand: 'общий спрос', orders: 'подтверждённый заказ',
    service: 'стоимость обслуживания', frozenPrices: 'цена замороженного продукта',
    weeks: 'Число недель', execution: 'Доля исполнения', investment: 'Объём вложений',
    annualOpex: 'Стоимость сопровождения за год'
  };
  function defaults() {
    return {
      totalInput: 100, rawCost: 140, capacity: 50, hours: 80, rate: .625,
      minWhole: 50, cut: 50, route: 'fillet', coldCapacity: 6,
      stageCapacity: { deboning: 40, packing: 100, freezing: 6 },
      prices: { whole: 170, fillet: 300, legs: 190, wing: 180, frame: 40, breast: 225, legMeat: 285, legBone: 30, legSkin: 35 },
      demand: { whole: 70, fillet: 16, legs: 17.5, wing: 5.5, frame: 10, breast: 20, legMeat: 12, legBone: 3.75, legSkin: 1.25 },
      orders: zero(), service: zero(),
      routeCosts: Object.fromEntries(Object.entries(routes).map(([id, route]) => [id, route.variableCost])),
      frozenPrices: { whole: 140, fillet: 220, legs: 145, wing: 135, frame: 20, breast: 180, legMeat: 210, legBone: 20, legSkin: 20 },
      freezeCost: 10, requests: {}, label: unit
    };
  }
  function normalize(input) {
    const d = defaults();
    const p = { ...d, ...clone(input || {}) };
    for (const key of ['prices', 'demand', 'orders', 'service', 'routeCosts', 'frozenPrices', 'stageCapacity']) {
      p[key] = { ...d[key], ...((input || {})[key] || {}) };
    }
    p.requests = clone((input || {}).requests || {});
    if (p.route === 'whole') p.cut = 0;
    return p;
  }
  function validate(p) {
    const errors = [];
    for (const key of ['totalInput', 'rawCost', 'capacity', 'hours', 'rate', 'minWhole', 'cut', 'coldCapacity', 'freezeCost']) {
      if (!Number.isFinite(p[key]) || p[key] < 0) errors.push(parameterNames[key] + ' требует конечного числа ≥ 0');
    }
    if (!Object.hasOwn(routes, p.route)) errors.push('Схема разделки требует выбора из справочника');
    for (const key of ['prices', 'demand', 'orders', 'service', 'frozenPrices']) {
      for (const id of ids) if (!Number.isFinite(p[key][id]) || p[key][id] < 0) errors.push(products[id].name + ': ' + parameterNames[key] + ' требует числа ≥ 0');
    }
    for (const key of ['routeCosts', 'stageCapacity']) {
      for (const [id, value] of Object.entries(p[key])) if (!Number.isFinite(value) || value < 0) {
        const name = key === 'routeCosts'
          ? (Object.hasOwn(routes, id) ? routes[id].name : 'Выбранный маршрут') + ': стоимость обработки'
          : ({ deboning: 'Мощность обвалки', packing: 'Мощность упаковки', freezing: 'Мощность заморозки' }[id] || 'Мощность передела');
        errors.push(name + ' требует числа ≥ 0');
      }
    }
    if (Number.isFinite(p.totalInput) && Number.isFinite(p.cut) && p.cut > p.totalInput + EPS) errors.push('Вход разделки превышает доступное сырьё');
    for (const [id, request] of Object.entries(p.requests)) {
      if (!request || !Object.hasOwn(products, request.product) || !Number.isFinite(request.quantity) || request.quantity <= 0 || !Number.isFinite(request.price) || request.price < 0 || !Number.isFinite(request.service) || request.service < 0) errors.push('Заявка ' + id + ' требует проверки количества и условий');
    }
    for (const id of ids) {
      const effectiveOrder = id === 'whole' ? Math.max(p.minWhole, p.orders[id]) : p.orders[id];
      if (effectiveOrder > p.demand[id] + EPS) errors.push(products[id].name + ': обязательства превышают общий спрос');
      const reserved = total(Object.values(p.requests).filter(r => r && r.product === id).map(r => r.quantity || 0));
      if (reserved > p.orders[id] + EPS) errors.push(products[id].name + ': резерв заявки превышает подтверждённый объём');
    }
    return errors;
  }
  function stage(id, name, load, capacity, active) {
    return { id, name, load, capacity, unit: 'т за неделю', utilization: capacity > 0 ? load / capacity : (load > EPS ? null : 0), binding: active && load >= capacity - EPS, active, sourceStatus: 'Учебная мощность; действующую норму подтверждает производство' };
  }
  function allocate(id, quantity, p) {
    const order = id === 'whole' ? Math.max(p.minWhole, p.orders[id]) : p.orders[id];
    const reqs = Object.entries(p.requests).filter(([, r]) => r.product === id);
    const reserved = total(reqs.map(([, r]) => r.quantity));
    const existingOrder = Math.max(0, order - reserved);
    let remainder = quantity;
    const oldSold = Math.min(remainder, existingOrder);
    remainder -= oldSold;
    let revenue = oldSold * p.prices[id] * 1000;
    let serviceCost = oldSold * p.service[id] * 1000;
    const requestRows = reqs.map(([requestId, r]) => {
      const sold = Math.min(remainder, r.quantity);
      remainder -= sold;
      revenue += sold * r.price * 1000;
      serviceCost += sold * r.service * 1000;
      return { requestId, ...r, sold, shortfall: r.quantity - sold };
    });
    const orderSold = oldSold + total(requestRows.map(r => r.sold));
    const forecast = Math.max(0, p.demand[id] - order);
    const forecastSold = Math.min(remainder, forecast);
    remainder -= forecastSold;
    revenue += forecastSold * p.prices[id] * 1000;
    serviceCost += forecastSold * p.service[id] * 1000;
    return { product: id, produced: quantity, orders: order, forecast, demand: p.demand[id], orderSold, forecastSold, sold: orderSold + forecastSold, remaining: remainder, shortfall: Math.max(0, order - orderSold), revenue, serviceCost, price: p.prices[id], requestRows };
  }
  function evaluate(input) {
    const p = normalize(input);
    const errors = validate(p);
    if (errors.length) return { valid: false, feasible: false, errors, violations: errors, signals: errors.map(label => ({ level: 'bad', title: label, detail: 'Параметры требуют проверки', action: 'Проверить ввод', owner: 'Планирование' })), params: p, produced: zero(), allocations: {}, stages: [], contribution: null, expectedContribution: null, inventoryT: null };
    const route = routes[p.route];
    const cut = p.cut;
    const whole = p.totalInput - cut;
    const produced = zero();
    produced.whole = whole;
    for (const [id, yieldShare] of Object.entries(route.yields)) produced[id] = cut * yieldShare;
    const loss = cut * route.loss;
    const massBalance = p.totalInput - total(Object.values(produced)) - loss;
    const allocations = Object.fromEntries(ids.map(id => [id, allocate(id, produced[id], p)]));
    const inventoryT = total(ids.map(id => allocations[id].remaining));
    const inventoryValue = total(ids.map(id => allocations[id].remaining * p.frozenPrices[id] * 1000));
    const revenue = total(ids.map(id => allocations[id].revenue));
    const serviceCost = total(ids.map(id => allocations[id].serviceCost));
    const rawCost = p.totalInput * p.rawCost * 1000;
    const routeCost = (whole * p.routeCosts.whole + cut * p.routeCosts[p.route]) * 1000;
    const freezeCost = inventoryT * p.freezeCost * 1000;
    const contribution = revenue - serviceCost - rawCost - routeCost - freezeCost;
    const effectiveCapacity = Math.min(p.capacity, p.hours * p.rate);
    const stages = [
      stage('cutting', 'Разделка', cut, effectiveCapacity, cut > EPS),
      stage('deboning', 'Обвалка', cut * route.deboneInputShare, p.stageCapacity.deboning, route.deboneInputShare > 0 && cut > EPS),
      stage('packing', 'Упаковка', total(Object.values(produced)), p.stageCapacity.packing, p.totalInput > EPS),
      stage('freezing', 'Заморозка', inventoryT, p.stageCapacity.freezing, inventoryT > EPS)
    ];
    const storage = { load: inventoryT, capacity: p.coldCapacity, unit: 'т единовременно', utilization: p.coldCapacity > 0 ? inventoryT / p.coldCapacity : (inventoryT > EPS ? null : 0), binding: inventoryT > EPS && inventoryT >= p.coldCapacity - EPS, sourceStatus: 'Учебная ёмкость хранения' };
    const violations = [];
    if (whole + EPS < p.minWhole) violations.push('Тушка: разрыв обязательства ' + display(p.minWhole - whole) + ' т');
    for (const s of stages) if (s.load > s.capacity + EPS) violations.push(s.name + ': загрузка превышает мощность на ' + display(s.load - s.capacity) + ' т');
    if (inventoryT > p.coldCapacity + EPS) violations.push('Хранение: остаток превышает ёмкость на ' + display(inventoryT - p.coldCapacity) + ' т');
    for (const id of ids) if (allocations[id].shortfall > EPS && !(id === 'whole' && whole < p.minWhole)) violations.push(products[id].name + ': разрыв заказа ' + display(allocations[id].shortfall) + ' т');
    if (Math.abs(massBalance) > EPS) violations.push('Материальный баланс требует сверки выходов');
    const signals = violations.map(label => ({ level: 'bad', title: label, detail: 'Условие ограничивает утверждение', action: 'Изменить план', owner: 'Планирование' }));
    if (inventoryT > EPS) signals.push({ level: 'warn', title: 'Остаток ' + display(inventoryT) + ' т требует будущей реализации', detail: 'Текущая выручка учитывает размещённые продажи; будущая оценка запаса показана отдельно', action: 'Подтвердить спрос и срок', owner: 'Коммерция и склад' });
    for (const s of stages) if (s.active && s.binding && s.load <= s.capacity + EPS) signals.push({ level: 'warn', title: s.name + ': мощность задействована полностью', detail: 'Дополнительный выпуск требует изменения мощности или маршрута', action: 'Проверить доступные часы', owner: 'Производство' });
    if (!violations.length) signals.push({ level: 'ok', title: 'План выполняет заданные ограничения', detail: 'Выходы, обязательства и ресурсы проверены на учебных параметрах', action: 'Сравнить варианты', owner: 'Планирование' });
    return { valid: true, feasible: violations.length === 0, errors: [], violations, signals, params: p, route: p.route, cut, whole, produced, loss, massBalance, allocations, revenue, serviceCost, rawCost, routeCost, freezeCost, contribution, inventoryT, inventoryValue, expectedContribution: contribution + inventoryValue, stages, storage, effectiveCapacity, upstream: { name: 'Охлаждённая тушка после убоя', quantity: p.totalInput, unit: 'т', scope: 'Вход модели; живой вес и убой требуют отдельного пересчёта' }, label: unit };
  }
  function candidate(p, cut, id, name, route) {
    const params = { ...clone(p), cut, route: route || p.route };
    const result = evaluate(params);
    return { id, name, label: name, params: result.params, result };
  }
  function alternatives(input) {
    const p = normalize(input);
    const candidates = p.route === 'whole'
      ? [candidate(p, 0, 'whole', 'Вся партия тушкой')]
      : [.3, .4, .5].map((share, i) => candidate(p, p.totalInput * share, 'option-' + i, ['Разделка 30%', 'Разделка 40%', 'Разделка 50%'][i]));
    const feasible = candidates.filter(c => c.result.feasible);
    const best = feasible.reduce((best, c) => !best || c.result.contribution > best.result.contribution + EPS ? c : best, null);
    const baseline = candidate(p, p.totalInput * .4, 'baseline', 'База: филе и ножки, 40%', 'fillet');
    return { candidates, best, baseline, comparable: baseline.result.feasible, method: 'Лучший из проверенных вариантов по результату размещённых продаж', label: unit };
  }
  function checkRequest(input, request) {
    const p = normalize(input);
    const r = { service: 0, forecastAbsorption: true, ...request };
    const errors = [];
    if (!r.requestId || typeof r.requestId !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(r.requestId)) errors.push('Заявка требует допустимого идентификатора');
    if (!Object.hasOwn(products, r.product)) errors.push('Заявка требует продукта из справочника');
    if (!Number.isFinite(r.quantity) || r.quantity <= 0) errors.push('Количество заявки требует числа > 0');
    if (!Number.isFinite(r.price) || r.price < 0 || !Number.isFinite(r.service) || r.service < 0) errors.push('Цена и обслуживание требуют чисел ≥ 0');
    const before = evaluate(p);
    errors.push(...before.errors);
    if (errors.length) return { valid: false, feasible: false, canApply: false, errors, params: p };
    if (Object.hasOwn(p.requests, r.requestId)) return { valid: true, feasible: false, duplicate: true, canApply: false, errors: [], params: p, result: before, acceptedQuantity: p.requests[r.requestId].quantity, message: 'Заявка уже включена в резерв' };
    const order = r.product === 'whole' ? Math.max(p.minWhole, p.orders.whole) : p.orders[r.product];
    const freeForecast = Math.max(0, p.demand[r.product] - order);
    const forecastConsumed = r.forecastAbsorption ? Math.min(r.quantity, freeForecast) : 0;
    p.orders[r.product] = order + r.quantity;
    p.demand[r.product] += r.quantity - forecastConsumed;
    p.requests[r.requestId] = { product: r.product, quantity: r.quantity, price: r.price, service: r.service };
    const current = evaluate(p);
    const route = routes[p.route];
    const maxCut = Math.max(0, Math.min(p.capacity, p.hours * p.rate, p.totalInput - p.minWhole, route.deboneInputShare > 0 ? p.stageCapacity.deboning / route.deboneInputShare : p.totalInput));
    const target = r.product === 'whole' ? Math.max(0, p.totalInput - p.orders.whole) : (route.yields[r.product] ? p.orders[r.product] / route.yields[r.product] : p.cut);
    const cuts = p.route === 'whole' ? [0] : [...new Set([p.cut, maxCut, Math.min(maxCut, target), p.totalInput * .3, p.totalInput * .4, p.totalInput * .5])];
    const options = cuts.map(cut => evaluate({ ...p, cut }));
    const admissible = options.filter(v => v.feasible);
    const coverage = v => v.allocations[r.product].requestRows.find(row => row.requestId === r.requestId).sold;
    const partial = options.filter(v => v.valid && v.whole + EPS >= v.params.minWhole && v.stages.every(s => s.load <= s.capacity + EPS) && v.storage.load <= v.storage.capacity + EPS && ids.every(id => v.allocations[id].shortfall <= (id === r.product ? r.quantity : 0) + EPS));
    const partialBest = partial.reduce((best, v) => !best || coverage(v) > coverage(best) + EPS || (Math.abs(coverage(v) - coverage(best)) < EPS && v.contribution > best.contribution + EPS) ? v : best, null);
    const result = admissible.reduce((best, v) => !best || v.contribution > best.contribution + EPS ? v : best, null) || partialBest || current;
    const row = result.allocations[r.product].requestRows.find(v => v.requestId === r.requestId);
    const covered = row ? row.sold : 0;
    const relatedOutputs = Object.fromEntries(ids.filter(id => id !== r.product).map(id => [id, result.produced[id] - before.produced[id]]));
    const canApply = result.feasible && covered >= r.quantity - EPS;
    return { valid: true, feasible: canApply, duplicate: false, canApply, errors: [], violations: result.violations, params: result.params, result, requested: r.quantity, covered, acceptedQuantity: covered, shortfall: r.quantity - covered, forecastConsumed, incrementalDemand: r.quantity - forecastConsumed, extraCut: result.cut - before.cut, additionalCut: result.cut - before.cut, relatedOutputs, deltaContribution: result.contribution - before.contribution, currentCoverage: current.allocations[r.product].requestRows.find(v => v.requestId === r.requestId).sold, requiresReplan: Math.abs(result.cut - before.cut) > EPS, message: canApply ? 'Заявка получает полный резерв' : 'Заявка требует изменения плана', explanation: 'Покрытие ' + display(covered) + ' из ' + display(r.quantity) + ' т; перевод прогноза в заказ ' + display(forecastConsumed) + ' т; изменение вклада ' + display((result.contribution - before.contribution) / 1000) + ' тыс руб' };
  }
  function snapshot(input, confirmations) {
    const result = evaluate(input);
    const confirms = confirmations || {};
    const missing = [['com', 'commercial'], ['prod', 'production'], ['fin', 'finance']].filter(keys => !keys.some(key => confirms[key] === true));
    if (!result.feasible || missing.length) return { valid: false, approved: false, errors: [...result.violations, ...(missing.length ? ['Подтверждения коммерции, производства и финансов завершают согласование'] : [])] };
    return { valid: true, approved: true, params: clone(result.params), result: clone(result), confirmations: clone(confirms), label: 'Утверждённый учебный снимок' };
  }
  function fact(input) {
    const source = input && input.params ? input.params : input;
    const planResult = evaluate(source);
    if (!planResult.valid) return { valid: false, errors: planResult.errors };
    const p = clone(planResult.params);
    const priceChange = -Math.min(5, p.prices.fillet);
    p.prices.fillet += priceChange;
    for (const r of Object.values(p.requests)) if (r.product === 'fillet') r.price = Math.max(0, r.price - 5);
    const priceResult = evaluate(p);
    if (p.route !== 'whole') p.routeCosts[p.route] += .2;
    const actualResult = evaluate(p);
    const priceDelta = priceResult.contribution - planResult.contribution;
    const costDelta = actualResult.contribution - priceResult.contribution;
    return { valid: true, plan: planResult.contribution, actual: actualResult.contribution, delta: actualResult.contribution - planResult.contribution, priceDelta, costDelta, execution: planResult.contribution > 0 ? actualResult.contribution / planResult.contribution : null, planResult, actualResult, rows: [{ id: 'plan', name: 'Утверждённый план', value: planResult.contribution, kind: 'total' }, { id: 'price', name: 'Цена филе', value: priceDelta, kind: 'delta', owner: 'Коммерция', formula: 'Объём проданного филе × изменение цены' }, { id: 'cost', name: 'Затраты разделки', value: costDelta, kind: 'delta', owner: 'Производство', formula: 'Вход разделки × −0,2 руб/кг' }, { id: 'actual', name: 'Учебный факт', value: actualResult.contribution, kind: 'total' }], label: 'Иллюстрация: снижение цены филе в пределах 5 руб/кг, затраты разделки +0,2 руб/кг' };
  }
  function roi(input, options) {
    const o = { weeks: 52, execution: 1, investment: null, annualOpex: null, ...options };
    const errors = [];
    for (const key of ['weeks', 'execution', 'investment', 'annualOpex']) if (!(o[key] === null && ['investment', 'annualOpex'].includes(key)) && (!Number.isFinite(o[key]) || o[key] < 0)) errors.push(parameterNames[key] + ' требует числа ≥ 0');
    if (o.execution > 1) errors.push('Доля исполнения располагается от 0 до 1');
    if (!Number.isInteger(o.weeks) || o.weeks > 53) errors.push('Календарь года содержит от 0 до 53 целых недель');
    const result = evaluate(input);
    const baseline = alternatives(input).baseline.result;
    if (!result.feasible || !baseline.feasible) errors.push('Годовое сравнение требует двух выполнимых планов');
    if ((result.inventoryT || 0) > EPS || (baseline.inventoryT || 0) > EPS) errors.push('Годовое сравнение с запасами требует календаря их реализации');
    if (errors.length) return { eligible: false, valid: false, errors, label: unit };
    const weeklyEffect = result.contribution - baseline.contribution;
    const grossEffect = weeklyEffect * o.weeks;
    const annualEffect = grossEffect * o.execution;
    const budgetComplete = o.annualOpex !== null && o.investment !== null;
    const netEffect = o.annualOpex !== null ? annualEffect - o.annualOpex : null;
    const firstYearCash = budgetComplete ? netEffect - o.investment : null;
    return { eligible: true, valid: true, errors: [], ...o, budgetComplete, weeklyEffect, grossEffect, annualEffect, netEffect, firstYearCash, roi: budgetComplete && o.investment > 0 ? firstYearCash / o.investment : null, paybackYears: budgetComplete && o.investment > 0 && netEffect > 0 ? o.investment / netEffect : null, baseline, result, label: 'Учебное повторение одинаковых недель', conditions: ['Одинаковые вход, цены, спрос и мощности во всех неделях', 'Продана вся корзина', 'Налоги и изменение оборотного капитала требуют отдельного расчёта'] };
  }
  function changeLevers(input, comparison) {
    const p = normalize(input), b = normalize(comparison || { ...defaults(), cut: 40 });
    const fields = [['totalInput', 'Доступная тушка', 'т'], ['rawCost', 'Цена сырья', 'руб/кг'], ['capacity', 'Мощность разделки', 'т'], ['hours', 'Доступные часы', 'ч'], ['rate', 'Скорость разделки', 'т/ч'], ['minWhole', 'Заказ тушки', 'т'], ['cut', 'Вход разделки', 'т'], ['coldCapacity', 'Ёмкость хранения', 'т']];
    const changes = fields.filter(([key]) => p[key] !== b[key]).map(([key, name, unit]) => ({ key, name, before: b[key], after: p[key], unit }));
    if (p.route !== b.route) changes.push({ key: 'route', name: 'Схема разделки', before: routes[b.route]?.name, after: routes[p.route]?.name, unit: '' });
    for (const field of ['prices', 'demand', 'service']) for (const id of ids) if (p[field][id] !== b[field][id]) changes.push({ key: field + '.' + id, name: products[id].name + ': ' + ({ prices: 'цена', demand: 'спрос', service: 'обслуживание' })[field], before: b[field][id], after: p[field][id], unit: field === 'demand' ? 'т' : 'руб/кг' });
    for (const id of Object.keys(routes)) if (p.routeCosts[id] !== b.routeCosts[id]) changes.push({ key: 'routeCosts.' + id, name: routes[id].name + ': переменные затраты', before: b.routeCosts[id], after: p.routeCosts[id], unit: 'руб/кг входа' });
    for (const [id, name] of Object.entries({ deboning: 'Обвалка', packing: 'Упаковка', freezing: 'Заморозка' })) if (p.stageCapacity[id] !== b.stageCapacity[id]) changes.push({ key: 'stageCapacity.' + id, name: name + ': мощность', before: b.stageCapacity[id], after: p.stageCapacity[id], unit: 'т/неделю' });
    return changes;
  }
  const api = { defaults, evaluate, alternatives, checkRequest, snapshot, fact, roi, changeLevers, routes, products, version: '2.0', units: { mass: 'т', price: 'руб/кг', money: 'руб' } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlannerModel = api;
})(typeof window === 'object' ? window : null);
