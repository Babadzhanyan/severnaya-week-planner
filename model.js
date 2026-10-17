/* Расчеты продолжают production / allocate / evaluate исходных планировщиков.
   Объемы API: тонны; цены: руб/кг; результат: рубли. Все параметры учебные. */
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
    whole: { name: 'Целая тушка', description: 'Упаковка целой тушки', yields: {}, loss: 0, variableCost: 8, deboneInputShare: 0, sourceStatus: 'Учебный пример из паспорта расчетов' },
    coarse: { name: 'Крупная разделка', description: 'Грудка на кости, ножки, крыло и каркас', yields: { breast: .40, legs: .35, wing: .11, frame: .13 }, loss: .01, variableCost: 19, deboneInputShare: 0, sourceStatus: 'Учебная схема; нормы и ставки требуют подтверждения' },
    fillet: { name: 'Филе и ножки', description: 'Филе грудки, ножки, крыло и каркас', yields: { fillet: .32, legs: .35, wing: .11, frame: .20 }, loss: .02, variableCost: 20.3, deboneInputShare: .40, sourceStatus: 'Учебный пример из паспорта расчетов; загрузка обвалки условная' },
    deep: { name: 'Обвалка грудки и ножки', description: 'Филе грудки, мякоть ножки, кость, кожа, крыло и каркас', yields: { fillet: .32, legMeat: .24, legBone: .075, legSkin: .025, wing: .11, frame: .20 }, loss: .03, variableCost: 28, deboneInputShare: .75, sourceStatus: 'Учебная схема; нормы и ставки требуют подтверждения' }
  };
  const ids = Object.keys(products);
  const clone = value => JSON.parse(JSON.stringify(value));
  const total = values => values.reduce((sum, value) => sum + value, 0);
  const display = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const zero = () => Object.fromEntries(ids.map(id => [id, 0]));
  const unit = 'Иллюстрация: учебные данные';
  const parameterNames = {
    totalInput: 'Доступное сырье', rawCost: 'Цена сырья', capacity: 'Мощность разделки',
    hours: 'Рабочее время', rate: 'Скорость разделки', minWhole: 'Минимальный заказ тушки',
    cut: 'Вход разделки', coldCapacity: 'Емкость хранения', freezeCost: 'Стоимость заморозки',
    prices: 'цена реализации', demand: 'общий спрос', orders: 'подтвержденный заказ',
    service: 'стоимость обслуживания', frozenPrices: 'цена замороженного продукта',
    weeks: 'Число недель', execution: 'Доля исполнения', investment: 'Объем вложений',
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
    if (Number.isFinite(p.totalInput) && Number.isFinite(p.cut) && p.cut > p.totalInput + EPS) errors.push('Вход разделки превышает доступное сырье');
    for (const [id, request] of Object.entries(p.requests)) {
      if (!request || !Object.hasOwn(products, request.product) || !Number.isFinite(request.quantity) || request.quantity <= 0 || !Number.isFinite(request.price) || request.price < 0 || !Number.isFinite(request.service) || request.service < 0) errors.push('Заявка ' + id + ' требует проверки количества и условий');
    }
    for (const id of ids) {
      const effectiveOrder = id === 'whole' ? Math.max(p.minWhole, p.orders[id]) : p.orders[id];
      if (effectiveOrder > p.demand[id] + EPS) errors.push(products[id].name + ': обязательства превышают общий спрос');
      const reserved = total(Object.values(p.requests).filter(r => r && r.product === id).map(r => r.quantity || 0));
      if (reserved > p.orders[id] + EPS) errors.push(products[id].name + ': резерв заявки превышает подтвержденный объем');
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
    const storage = { load: inventoryT, capacity: p.coldCapacity, unit: 'т единовременно', utilization: p.coldCapacity > 0 ? inventoryT / p.coldCapacity : (inventoryT > EPS ? null : 0), binding: inventoryT > EPS && inventoryT >= p.coldCapacity - EPS, sourceStatus: 'Учебная емкость хранения' };
    const violations = [];
    if (whole + EPS < p.minWhole) violations.push('Тушка: разрыв обязательства ' + display(p.minWhole - whole) + ' т');
    for (const s of stages) if (s.load > s.capacity + EPS) violations.push(s.name + ': загрузка превышает мощность на ' + display(s.load - s.capacity) + ' т');
    if (inventoryT > p.coldCapacity + EPS) violations.push('Хранение: остаток превышает емкость на ' + display(inventoryT - p.coldCapacity) + ' т');
    for (const id of ids) if (allocations[id].shortfall > EPS && !(id === 'whole' && whole < p.minWhole)) violations.push(products[id].name + ': разрыв заказа ' + display(allocations[id].shortfall) + ' т');
    if (Math.abs(massBalance) > EPS) violations.push('Материальный баланс требует сверки выходов');
    const signals = violations.map(label => ({ level: 'bad', title: label, detail: 'Условие ограничивает утверждение', action: 'Изменить план', owner: 'Планирование' }));
    if (inventoryT > EPS) signals.push({ level: 'warn', title: 'Остаток ' + display(inventoryT) + ' т требует будущей реализации', detail: 'Текущая выручка учитывает размещенные продажи; будущая оценка запаса показана отдельно', action: 'Подтвердить спрос и срок', owner: 'Коммерция и склад' });
    for (const s of stages) if (s.active && s.binding && s.load <= s.capacity + EPS) signals.push({ level: 'warn', title: s.name + ': мощность задействована полностью', detail: 'Дополнительный выпуск требует изменения мощности или маршрута', action: 'Проверить доступные часы', owner: 'Производство' });
    if (!violations.length) signals.push({ level: 'ok', title: 'План выполняет заданные ограничения', detail: 'Выходы, обязательства и ресурсы проверены на учебных параметрах', action: 'Сравнить варианты', owner: 'Планирование' });
    return { valid: true, feasible: violations.length === 0, errors: [], violations, signals, params: p, route: p.route, cut, whole, produced, loss, massBalance, allocations, revenue, serviceCost, rawCost, routeCost, freezeCost, contribution, inventoryT, inventoryValue, expectedContribution: contribution + inventoryValue, stages, storage, effectiveCapacity, upstream: { name: 'Охлажденная тушка после убоя', quantity: p.totalInput, unit: 'т', scope: 'Вход модели; живой вес и убой требуют отдельного пересчета' }, label: unit };
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
    return { candidates, best, baseline, comparable: baseline.result.feasible, method: 'Лучший из проверенных вариантов по результату размещенных продаж', label: unit };
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
    return { valid: true, feasible: canApply, duplicate: false, canApply, errors: [], violations: result.violations, params: result.params, result, requested: r.quantity, covered, acceptedQuantity: covered, shortfall: r.quantity - covered, forecastConsumed, incrementalDemand: r.quantity - forecastConsumed, extraCut: result.cut - before.cut, additionalCut: result.cut - before.cut, relatedOutputs, deltaContribution: result.contribution - before.contribution, currentCoverage: current.allocations[r.product].requestRows.find(v => v.requestId === r.requestId).sold, requiresReplan: Math.abs(result.cut - before.cut) > EPS, message: canApply ? 'Заявка получает полный резерв' : 'Заявка требует изменения плана', explanation: 'Покрытие ' + display(covered) + ' из ' + display(r.quantity) + ' т; перевод прогноза в заказ ' + display(forecastConsumed) + ' т; изменение вклада ' + display((result.contribution - before.contribution) / 1000) + ' тыс. руб.' };
  }
  function snapshot(input, confirmations) {
    const result = evaluate(input);
    const confirms = confirmations || {};
    const missing = [['com', 'commercial'], ['prod', 'production'], ['fin', 'finance']].filter(keys => !keys.some(key => confirms[key] === true));
    if (!result.feasible || missing.length) return { valid: false, approved: false, errors: [...result.violations, ...(missing.length ? ['Подтверждения коммерции, производства и финансов завершают согласование'] : [])] };
    return { valid: true, approved: true, params: clone(result.params), result: clone(result), confirmations: clone(confirms), label: 'Утвержденный учебный снимок' };
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
    return { valid: true, plan: planResult.contribution, actual: actualResult.contribution, delta: actualResult.contribution - planResult.contribution, priceDelta, costDelta, execution: planResult.contribution > 0 ? actualResult.contribution / planResult.contribution : null, planResult, actualResult, rows: [{ id: 'plan', name: 'Утвержденный план', value: planResult.contribution, kind: 'total' }, { id: 'price', name: 'Цена филе', value: priceDelta, kind: 'delta', owner: 'Коммерция', formula: 'Объем проданного филе × изменение цены' }, { id: 'cost', name: 'Затраты разделки', value: costDelta, kind: 'delta', owner: 'Производство', formula: 'Вход разделки × −0,2 руб. / кг' }, { id: 'actual', name: 'Учебный факт', value: actualResult.contribution, kind: 'total' }], label: 'Иллюстрация: снижение цены филе в пределах 5 руб. / кг, затраты разделки +0,2 руб. / кг' };
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
    return { eligible: true, valid: true, errors: [], ...o, budgetComplete, weeklyEffect, grossEffect, annualEffect, netEffect, firstYearCash, roi: budgetComplete && o.investment > 0 ? firstYearCash / o.investment : null, paybackYears: budgetComplete && o.investment > 0 && netEffect > 0 ? o.investment / netEffect : null, baseline, result, label: 'Учебное повторение одинаковых недель', conditions: ['Одинаковые вход, цены, спрос и мощности во всех неделях', 'Продана вся корзина', 'Налоги и изменение оборотного капитала требуют отдельного расчета'] };
  }
  function changeLevers(input, comparison) {
    const p = normalize(input), b = normalize(comparison || { ...defaults(), cut: 40 });
    const fields = [['totalInput', 'Доступная тушка', 'т'], ['rawCost', 'Цена сырья', 'руб. / кг'], ['capacity', 'Мощность разделки', 'т'], ['hours', 'Доступные часы', 'ч'], ['rate', 'Скорость разделки', 'т/ч'], ['minWhole', 'Заказ тушки', 'т'], ['cut', 'Вход разделки', 'т'], ['coldCapacity', 'Емкость хранения', 'т']];
    const changes = fields.filter(([key]) => p[key] !== b[key]).map(([key, name, unit]) => ({ key, name, before: b[key], after: p[key], unit }));
    if (p.route !== b.route) changes.push({ key: 'route', name: 'Схема разделки', before: routes[b.route]?.name, after: routes[p.route]?.name, unit: '' });
    for (const field of ['prices', 'demand', 'service']) for (const id of ids) if (p[field][id] !== b[field][id]) changes.push({ key: field + '.' + id, name: products[id].name + ': ' + ({ prices: 'цена', demand: 'спрос', service: 'обслуживание' })[field], before: b[field][id], after: p[field][id], unit: field === 'demand' ? 'т' : 'руб. / кг' });
    for (const id of Object.keys(routes)) if (p.routeCosts[id] !== b.routeCosts[id]) changes.push({ key: 'routeCosts.' + id, name: routes[id].name + ': переменные затраты', before: b.routeCosts[id], after: p.routeCosts[id], unit: 'руб. / кг входа' });
    for (const [id, name] of Object.entries({ deboning: 'Обвалка', packing: 'Упаковка', freezing: 'Заморозка' })) if (p.stageCapacity[id] !== b.stageCapacity[id]) changes.push({ key: 'stageCapacity.' + id, name: name + ': мощность', before: b.stageCapacity[id], after: p.stageCapacity[id], unit: 'т/неделю' });
    return changes;
  }
  // Недельный план: фронтир, стакан спроса, статусы и предохранитель масштаба.
  // Единицы: вход и выпуск в кг, цены в руб / кг, объем разделки V в т, суммы в рублях.
  const RUB_EPS = 1e-6;
  const planConfig = {
    scaleWeekKg: 4009615, // масштаб недели: 4 009 615 кг = 208,5 млн кг в год (продажа май 2025 – апрель 2026), решение заказчика
    scaleGuardShare: .5, // предохранитель: вход недели ниже 0,5 × масштаба выводит предупреждение, расчет не блокируется
    scaleNote: 'Решение заказчика: 208,5 млн кг в год (продажа май 2025 – апрель 2026)',
    regulationCutT: 40, // регламент разделки, т
    regulationNote: 'Требуется подтверждение: единица регламента 40 т (в неделю или в сутки), блокер P1',
    minCutT: null, // минимальная партия разделки, т: значение не задано
    minCutNote: 'Требуется подтверждение: минимальная партия разделки, блокер P2',
    // По умолчанию весовая методика, решение финансов: требуется подтверждение.
    // spec: спецформула (140 + h_j) / y_j; любое значение кроме weight считается спецформулой.
    // weight: затраты маршрута делятся на сумму выходов, сумма затрат разделки сохраняется.
    costMethod: 'weight',
    costNote: 'Требуется подтверждение: методика себестоимости, блокер P1. По спецификации затраты разделки учитываются по каждому продукту маршрута',
    gridStepT: 1, // сетка фронтира V_k = k × 1 т
    thresholds: { // пороги светофоров: предложение, требует подтверждения
      execution: {direction: 'higher', ok: .95, warn: .85}, // выполнение разделки, факт / план
      gapToIdeal: {direction: 'lower', ok: .02, warn: .05}, // разрыв до идеального плана
      freezeShare: {direction: 'lower', ok: .15, warn: .25}, // доля заморозки в выпуске
      avgPrice: {direction: 'higher', ok: .98, warn: .95}, // средняя цена, факт / план
      yieldDeviation: {direction: 'lower', ok: .5, warn: 1.5}, // отклонение выхода, п.п.
      confirmedOrders: {direction: 'higher', ok: .7, warn: .5}, // подтвержденные заказы в плане
      routeLinks: {direction: 'higher', ok: .9, warn: .6} // полнота связей маршрута
    }
  };
  const statusLevels = {
    none: {level: 'none', symbol: '○', word: 'Нет данных', color: '#52677D'},
    risk: {level: 'risk', symbol: '■', word: 'Риск', color: '#C0392B'},
    warn: {level: 'warn', symbol: '▲', word: 'Внимание', color: '#F2AA00'},
    ok: {level: 'ok', symbol: '●', word: 'В норме', color: '#2E8B57'}
  };
  const noData = reason => ({...statusLevels.none, reason});
  // Порядок проверки: сначала нет данных, затем риск, внимание и норма. Пустое значение получает только нет данных.
  function planStatus(key, value) {
    const t = planConfig.thresholds[key];
    if (!t || !Number.isFinite(t.ok) || !Number.isFinite(t.warn)) return noData('Требуется подтверждение: порог «' + key + '» не задан');
    if (!Number.isFinite(value)) return noData('Нет данных');
    const good = t.direction === 'higher' ? value >= t.ok : value <= t.ok;
    const fine = t.direction === 'higher' ? value >= t.warn : value <= t.warn;
    return {...(good ? statusLevels.ok : fine ? statusLevels.warn : statusLevels.risk)};
  }
  // Предохранитель масштаба: вход недели ниже 0,5 × масштаб недели (planConfig.scaleWeekKg) выводит предупреждение; граница и стакан считаются.
  function scaleGuard(week) {
    const limitKg = planConfig.scaleWeekKg * planConfig.scaleGuardShare;
    const inputKg = week ? week.inputKg : NaN;
    const blocked = !(Number.isFinite(inputKg) && inputKg >= limitKg);
    return {blocked, inputKg, limitKg, note: planConfig.scaleNote, status: blocked ? {...statusLevels.warn, reason: 'Масштаб недели ниже ожидаемого'} : null};
  }
  const classRank = {confirmed: 1, forecast: 2, extra: 3};
  // Таблица маршрутов недели: учебная routes, если контракта нет; с контрактом – routeTable из resolveWeek.
  const routeTableOf = week => (week && week.routeTable) || routes;
  const routeOf = week => (week && Object.hasOwn(routeTableOf(week), week.routeCode) ? routeTableOf(week)[week.routeCode] : null);
  // Контракт недели (aggregates_local/week_config.json, версия 1). Если контракта нет, действуют учебные значения: source 'training'.
  // С контрактом подставляются сырье, выходы и переменные затраты маршрутов, цена списка для строк заказа с пустой ценой: source 'aggregates'.
  // Пустое значение контракта остается null и дает статус «Нет данных».
  const finiteOrNull = value => (Number.isFinite(value) ? value : null);
  const shareOrNull = value => (Number.isFinite(value) && value >= 0 && value <= 1 ? value : null);
  // Мощность разделки недели, т/неделю. Если контракт содержит блок capacityWeekT, его deboning главный: пустое значение дает «Нет данных», значение интерфейса не подставляется. Без блока действует мощность недели.
  const capacityOf = (base, cfg) => (Object.hasOwn(cfg, 'capacityWeekT') ? finiteOrNull(cfg.capacityWeekT?.deboning) : base.capacityWeekT);
  function resolveWeek(week, config) {
    if (!config) return {week, source: 'training', gap: null};
    if (config.schemaVersion !== 1) return {week, source: 'aggregates', gap: 'Требуется подтверждение: поддерживается только версия контракта недели 1'};
    const base = week || {}, cfgRoutes = config.routes || {}, cfgProducts = config.products || {};
    const routeTable = Object.fromEntries(Object.entries(routes).map(([code, route]) => {
      const cfg = cfgRoutes[code] || {};
      const yields = Object.fromEntries(Object.keys(route.yields).map(id => [id, shareOrNull((cfg.yields || {})[id])]));
      return [code, {...route, yields, variableCost: finiteOrNull(cfg.variableCostRubKg), rawInRate: cfg.rawInRate === true}];
    }));
    const orders = (base.orders || []).map(o => {
      const list = finiteOrNull((cfgProducts[o.product] || {}).listPriceRubKg);
      return (o.priceRubKg === undefined || o.priceRubKg === null) && list !== null ? {...o, priceRubKg: list} : o;
    });
    return {week: {...base, capacityWeekT: capacityOf(base, config), rawCostRubKg: finiteOrNull(config.rawCostRubKg), routeTable, orders}, source: 'aggregates', gap: null};
  }
  const productsOf = week => (routeOf(week) ? ['whole', ...Object.keys(routeOf(week).yields)] : []);
  const outputKg = (week, id, cutT) => (id === 'whole' ? week.inputKg - cutT * 1000 : cutT * 1000 * routeOf(week).yields[id]);
  // Постановка решателя границы (Д06, работа 4). Python: FRONTIER_SPEC.
  const FRONTIER_SPEC = {
    variables: 'V, т: объем разделки; непрерывный, опрашивается сеткой шагом gridStepT',
    objective: 'максимум K(V), руб.: сумма вкладов продуктов маршрута и тушки',
    constraints: ['0 ≤ V ≤ min(мощность недели, вход недели)', 'вход − V × 1000 ≥ минимальный заказ тушки',
      'V ≥ минимальная партия разделки, если задана', 'выпуск и отгрузка не меньше обязательства (commitmentKg)'],
    integerBatches: 'не заданы: минимальная партия разделки не подтверждена (блокер P2)'
  };
  // Единичная себестоимость из регистра, руб / кг выпуска; сырье учитывается один раз. Python: unit_cost_register.
  // Признак маршрута rawInRate: true – ставка уже включает сырье, используется как есть; false или без признака – сырье добавляется один раз.
  // Продукты с выходом: (сырье + затраты маршрута) / сумма выходов (weight) или спецформула. Пустое сырье дает статус «Нет данных» в dataGap.
  function unitCostRegister(week, id) {
    const route = routeOf(week);
    const rate = id === 'whole' ? routeTableOf(week).whole : route;
    const raw = rate.rawInRate === true ? 0 : week.rawCostRubKg;
    if (id === 'whole') return raw + rate.variableCost;
    const method = week.costMethod || planConfig.costMethod;
    const yieldBase = method === 'weight' ? total(Object.values(route.yields)) : route.yields[id];
    return (raw + route.variableCost) / yieldBase;
  }
  // Причина, по которой расчет нельзя выполнить. Отсутствующая цена дает статус «Нет данных», значение ноль исключено.
  function dataGap(week) {
    const route = routeOf(week);
    if (!route) return 'Схема разделки не найдена в справочнике';
    if (!Number.isFinite(week.capacityWeekT)) return 'Нет данных: мощность разделки не задана';
    if (!Number.isFinite(week.rawCostRubKg)) return 'Нет данных: цена сырья';
    if (!Number.isFinite(routeTableOf(week).whole.variableCost)) return 'Нет данных: переменные затраты целой тушки';
    if (!Number.isFinite(route.variableCost)) return 'Нет данных: переменные затраты маршрута «' + route.name + '»';
    for (const [id, share] of Object.entries(route.yields)) if (!Number.isFinite(share)) return 'Нет данных: выход «' + products[id].name + '» по маршруту «' + route.name + '»';
    const ids = productsOf(week);
    for (const id of ids) if (!Number.isFinite((week.freezePriceRubKg || {})[id])) return 'Нет цены заморозки: ' + products[id].name;
    for (const o of week.orders || []) {
      if (!ids.includes(o.product)) continue;
      const priced = Number.isFinite(o.priceRubKg) && o.priceRubKg >= 0 && Number.isFinite(o.qtyKg) && o.qtyKg >= 0 && Object.hasOwn(classRank, o.orderClass);
      const probable = o.orderClass !== 'forecast' || (Number.isFinite(o.probability) && o.probability >= 0 && o.probability <= 1);
      if (!priced || !probable) return 'Нет цены или условий заказа в строке ' + (o.id || '?');
    }
    return null;
  }
  // Аллокация продукта: класс по возрастанию, цена по убыванию, дата по возрастанию.
  // Класс 3 допускается только при цене от заморозки f_j и выше. Остаток уходит в заморозку по f_j.
  function allocateProduct(week, cutT, id) {
    const freezePrice = week.freezePriceRubKg[id];
    const cost = unitCostRegister(week, id);
    const supply = outputKg(week, id, cutT);
    const rows = (week.orders || []).filter(o => o.product === id).map(o => ({
      id: o.id, cls: classRank[o.orderClass], priceRubKg: o.priceRubKg, date: o.orderDate || '', a: 0,
      q: o.orderClass === 'forecast' ? o.probability * o.qtyKg : o.qtyKg
    })).sort((u, v) => u.cls - v.cls || v.priceRubKg - u.priceRubKg || (u.date < v.date ? -1 : u.date > v.date ? 1 : 0));
    let used = 0;
    for (const r of rows) {
      r.a = r.cls === 3 && r.priceRubKg < freezePrice ? 0 : Math.min(r.q, Math.max(0, supply - used));
      used += r.a;
    }
    const frozenKg = Math.max(0, supply - used);
    return {
      id, supplyKg: supply, unitCostRubKg: cost, freezePriceRubKg: freezePrice, rows, frozenKg,
      revenueRub: total(rows.map(r => r.a * r.priceRubKg)) + frozenKg * freezePrice,
      K: total(rows.map(r => r.a * (r.priceRubKg - cost))) + frozenKg * (freezePrice - cost)
    };
  }
  // Точка фронтира при объеме разделки V, т: суммы по всем продуктам маршрута и тушке.
  function cutPoint(week, cutT) {
    const parts = productsOf(week).map(id => allocateProduct(week, cutT, id));
    return {
      V: cutT, K: total(parts.map(p => p.K)), R: total(parts.map(p => p.frozenKg)),
      producedKg: total(parts.map(p => p.supplyKg)), flag: cutT > planConfig.regulationCutT
    };
  }
  // Граница обязательств (week.commitmentKg, кг по продукту) при объеме разделки cutT, т. Python: commitment_boundary.
  // Выпуск и отгрузка продукта не меньше обязательства. minCutT – наименьший объем разделки для выпуска; maxCutT – наибольший для тушки.
  function commitmentBoundary(week, cutT) {
    const ids = productsOf(week);
    const violations = [];
    let minCut = 0, maxCut = null;
    const active = [];
    for (const [productId, need] of Object.entries(week.commitmentKg || {})) {
      if (!ids.includes(productId) || !Number.isFinite(need) || need < 0) {
        violations.push({kind: 'product', product: productId, label: 'Обязательство требует продукта маршрута и числа не меньше нуля'});
        continue;
      }
      if (need <= EPS) continue;
      active.push([productId, need]);
      if (productId === 'whole') {
        const limit = (week.inputKg - need) / 1000;
        maxCut = maxCut === null ? limit : Math.min(maxCut, limit);
      } else if (routeOf(week).yields[productId] > 0) {
        minCut = Math.max(minCut, need / (1000 * routeOf(week).yields[productId]));
      } else {
        violations.push({kind: 'yield', product: productId, label: 'Выход продукта равен нулю: обязательство недостижимо'});
      }
    }
    const cap = week.capacityWeekT;
    if (Number.isFinite(cap) && minCut > cap + EPS) {
      violations.push({kind: 'capacity', label: 'Объем разделки для обязательства выше мощности недели', requiredCutT: minCut, capacityCutT: cap, shortfallCutT: minCut - cap});
    }
    for (const [productId, need] of active) {
      const supply = outputKg(week, productId, cutT);
      const name = products[productId].name;
      if (supply < need - EPS) {
        violations.push({kind: 'supply', product: productId, label: 'Выпуск «' + name + '» ниже обязательства', requiredKg: need, availableKg: supply, shortfallKg: need - supply});
        continue;
      }
      const shipped = total(allocateProduct(week, cutT, productId).rows.map(r => r.a));
      if (shipped < need - EPS) {
        violations.push({kind: 'shipment', product: productId, label: 'Отгрузка «' + name + '» ниже обязательства', requiredKg: need, shippedKg: shipped, shortfallKg: need - shipped});
      }
    }
    return {cutT, feasible: violations.length === 0, minCutT: minCut, maxCutT: maxCut, violations};
  }
  // Ресурсы недели: [{id, name, capacityKg, consumers: [{product, kg}]}]. Нагрузка – сумма потребителей; общий ресурс учитывается один раз.
  // Ресурс без мощности не дает нуля: граница доказанной выполнимости по известным ресурсам, неизвестные перечисляются. Python: resource_limits.
  function resourceLimits(resources) {
    const known = [], unknown = [], violations = [];
    for (const r of resources) {
      const load = total((r.consumers || []).map(c => c.kg));
      const cap = r.capacityKg;
      if (!Number.isFinite(cap) || cap < 0) {
        unknown.push({id: r.id, name: r.name});
        continue;
      }
      const util = cap > EPS ? load / cap : (load <= EPS ? 0 : null);
      const rec = {id: r.id, name: r.name, loadKg: load, capacityKg: cap, utilization: util};
      known.push(rec);
      if (load > cap + EPS) violations.push({...rec, shortfallKg: load - cap});
    }
    const ranked = [...known].sort((x, y) => (x.utilization === null) - (y.utilization === null) || (y.utilization ?? 0) - (x.utilization ?? 0));
    return {provenFeasible: violations.length === 0, violations, unknown, unknownCount: unknown.length, ranking: ranked, binding: ranked[0] || null, next: ranked[1] || null};
  }
  // Эффективные точки: нет другой точки с K не меньше и R не больше при строгом неравенстве.
  // При полном совпадении (K и R) остается точка с меньшим V.
  function efficientPoints(points) {
    const sorted = [...points].sort((u, v) => u.R - v.R || v.K - u.K || u.V - v.V);
    const out = [];
    let best = -Infinity;
    for (const p of sorted) if (p.K > best + RUB_EPS) { out.push(p); best = p.K; }
    return out;
  }
  // Оптимум: максимум K; при равенстве (в пределах RUB_EPS) меньший V.
  function optimumOf(points) {
    let best = null;
    for (const p of points) if (!best || p.K > best.K + RUB_EPS || (Math.abs(p.K - best.K) <= RUB_EPS && p.V < best.V)) best = p;
    return best;
  }
  // Фронтир: для каждого объема разделки V считаются K(V) и R(V). Допустимы V = 0 и V из [V_min, V_max].
  function buildFrontier(input, config) {
    const started = Date.now();
    const resolved = resolveWeek(input, config), week = resolved.week;
    const guard = scaleGuard(week);
    const empty = {guard, status: guard.status, points: [], efficient: [], optimum: null, variants: {}, invariant: null, gap: null, cap: null, notes: [], unconfirmed: [], source: resolved.source, solver: null, commitment: null};
    const missing = resolved.gap || dataGap(week);
    if (missing) return {...empty, status: noData(missing)};
    const inputT = week.inputKg / 1000;
    const minCut = Number.isFinite(week.minCutT) ? week.minCutT : planConfig.minCutT;
    const wholeMinKg = Number.isFinite(week.minWholeKg) ? week.minWholeKg : 0;
    const maxCut = week.routeCode === 'whole' ? 0 : Math.max(0, Math.min(week.capacityWeekT, inputT));
    const grid = [];
    for (let k = 0; k <= Math.floor(maxCut); k++) grid.push(k * planConfig.gridStepT);
    grid.push(maxCut, ...[.3, .4, .5].map(share => share * inputT));
    const cuts = [...new Set(grid.filter(v => v <= maxCut + EPS).map(v => Math.round(v * 1e6) / 1e6))];
    // Обязательства (commitmentKg) отсекают объемы, при которых выпуск или отгрузка ниже заявленного кг.
    const commitments = Boolean(week.commitmentKg && Object.keys(week.commitmentKg).length);
    const feasible = v => (v <= EPS || minCut === null || v >= minCut - EPS) && week.inputKg - v * 1000 >= wholeMinKg - EPS
      && (!commitments || commitmentBoundary(week, v).feasible);
    const points = cuts.filter(feasible).sort((u, v) => u - v).map(v => cutPoint(week, v));
    const variants = {};
    [['30%', .3], ['40%', .4], ['50%', .5]].forEach(([name, share]) => {
      const point = points.find(p => Math.abs(p.V - share * inputT) < 1e-6);
      if (point) variants[name] = point;
    });
    const wholeVariant = points.find(p => p.V === 0);
    if (wholeVariant) variants.whole = wholeVariant;
    const optimum = optimumOf(points);
    const bestVariantK = Object.keys(variants).length ? Math.max(...Object.values(variants).map(p => p.K)) : null;
    const invariant = optimum ? {holds: bestVariantK === null || optimum.K >= bestVariantK - RUB_EPS, optimumK: optimum.K, bestVariantK} : null;
    const risks = [], warns = [], notes = [], unconfirmed = [];
    if (guard.blocked) warns.push(guard.status.reason);
    if (!points.length) risks.push('Нет допустимых точек на фронтире');
    if (commitments && !points.length) risks.push('Обязательство не выполняется ни при одном допустимом объеме разделки');
    const boundaryAtZero = commitments ? commitmentBoundary(week, 0) : null;
    if (points.length && points.every(p => p.K < 0)) risks.push('Все K < 0');
    if (!(week.orders || []).some(o => productsOf(week).includes(o.product))) notes.push('Нет заказов, весь выпуск в заморозке');
    if (optimum && optimum.flag) {
      risks.push('Нужно решение о разделке');
      notes.push('Нужно решение о разделке');
    }
    if (optimum && optimum.producedKg > 0) {
      const level = planStatus('freezeShare', optimum.R / optimum.producedKg).level;
      if (level === 'risk') risks.push('Доля заморозки выше порога');
      if (level === 'warn') warns.push('Доля заморозки в зоне внимания');
    }
    if (minCut === null) unconfirmed.push(planConfig.minCutNote);
    if ((week.costMethod || planConfig.costMethod) !== 'weight') unconfirmed.push(planConfig.costNote);
    unconfirmed.push(planConfig.regulationNote);
    const status = risks.length ? {...statusLevels.risk, reason: risks.join('; ')} : warns.length ? {...statusLevels.warn, reason: warns.join('; ')} : {...statusLevels.ok};
    return {
      guard, status, points, efficient: efficientPoints(points), optimum, variants, invariant,
      gap: minCut > 0 ? {fromT: 0, toT: minCut, label: 'Разрыв: объем от 0 до ' + minCut + ' т, промежуточные точки исключены'} : null,
      cap: week.routeCode === 'whole' ? null : {V: maxCut, label: week.capacityWeekT < inputT ? 'Предел мощности' : 'Предел доступного карказа'},
      notes, unconfirmed, source: resolved.source,
      solver: {name: 'сеточный перебор', reason: 'Одна переменная: объем разделки. SciPy HiGHS в окружении не подключен',
        status: optimum !== null ? 'лучший проверенный вариант' : 'Нет допустимого варианта', provenOptimum: false,
        toleranceT: planConfig.gridStepT, points: points.length, gap: null, gapNote: 'Оптимум не доказан: разрыв не вычислен',
        timeMs: Date.now() - started, spec: {...FRONTIER_SPEC, constraints: [...FRONTIER_SPEC.constraints]}},
      commitment: commitments ? {minCutT: boundaryAtZero.minCutT, maxCutT: boundaryAtZero.maxCutT, capacityCutT: maxCut,
        feasiblePoints: points.length, violationsAtZero: boundaryAtZero.violations} : null
    };
  }
  // Стакан спроса по продукту: ступени по убыванию цены, ширина – объем, высота – цена.
  // Распределенная часть ступени заливается, остаток штрихуется. Заморозка – отдельная ступень по f_j.
  function buildStakan(input, cutT, id, config) {
    const resolved = resolveWeek(input, config), week = resolved.week;
    const guard = scaleGuard(week);
    const empty = {blocked: guard.blocked, status: guard.status, productId: id, steps: [], frozen: null, lines: null, supplyKg: null, revenueRub: null, stepsRevenueRub: null, source: resolved.source};
    const missing = resolved.gap || dataGap(week) || (productsOf(week).includes(id) ? null : 'Продукт вне маршрута');
    if (missing) return {...empty, status: noData(missing)};
    const a = allocateProduct(week, cutT, id);
    let x = 0;
    const steps = a.rows.filter(r => r.q > 0).sort((u, v) => v.priceRubKg - u.priceRubKg || u.cls - v.cls).map(r => {
      const x0 = x;
      x += r.q;
      return {id: r.id, cls: r.cls, priceRubKg: r.priceRubKg, x0, x1: x, demandKg: r.q, distributedKg: r.a, hatchedKg: r.q - r.a, distribution: r.a >= r.q - RUB_EPS ? 'полностью' : r.a > RUB_EPS ? 'частично' : 'нет'};
    });
    const frozen = {priceRubKg: a.freezePriceRubKg, volumeKg: a.frozenKg, areaRub: a.frozenKg * a.freezePriceRubKg};
    return {
      blocked: guard.blocked, status: guard.status, productId: id, steps, frozen,
      lines: {freezePriceRubKg: a.freezePriceRubKg, costRubKg: a.unitCostRubKg},
      supplyKg: a.supplyKg, revenueRub: a.revenueRub, K: a.K,
      stepsRevenueRub: total(steps.map(s => s.distributedKg * s.priceRubKg)) + frozen.areaRub, source: resolved.source
    };
  }
  // Денежный регистр и граница: мост вклада, сверка сумм, мост запаса, стакан себестоимости, пакет рычагов,
  // сеточный перебор объема разделки и смесь маршрутов. Выход evaluate не меняется; паритет с backend/model.py. Python: одноименные функции.
  const STOCK_SIGN = {opening: 1, purchase: 1, output: 1, transfer: -1, shipment: -1, writeoff: -1};
  // Классификация статей регистра (Д05, работа 1). Предложение L3; налоговая основа – требуется подтверждение. Python: COST_CLASSES.
  const COST_CLASSES = [
    {id: 'raw', name: 'Сырье', kgBase: 'кг входа тушки', operation: 'сырье', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'неделя', recognition: 'при списании в разделку'},
    {id: 'processing', name: 'Операции маршрута', kgBase: 'кг входа разделки', operation: 'убой, разделка, обвалка', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'неделя', recognition: 'при выпуске'},
    {id: 'packing', name: 'Упаковка', kgBase: 'кг выпуска', operation: 'упаковка', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'неделя', recognition: 'при выпуске'},
    {id: 'freeze', name: 'Заморозка', kgBase: 'кг запаса', operation: 'заморозка и хранение', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'неделя', recognition: 'при заморозке'},
    {id: 'service', name: 'Обслуживание заказов', kgBase: 'кг отгрузки', operation: 'отгрузка', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'неделя', recognition: 'при отгрузке'},
    {id: 'discount', name: 'Скидки и бонусы', kgBase: 'руб. выручки', operation: 'коммерческие условия', variability: 'переменная', taxBasis: 'Требуется подтверждение', period: 'период договора', recognition: 'при отгрузке'}
  ];
  const isPresent = value => value !== null && value !== undefined;
  // JS: bridgeSum. Статья kind total – серверный итог: сверка с допуском EPS.
  function bridgeSum(items) {
    const summary = total(items.filter(i => i.kind !== 'total').map(i => i.valueRub));
    const server = items.filter(i => i.kind === 'total');
    if (!server.length) return {sumRub: summary, serverTotalRub: null, diffRub: null, reconciled: null};
    const serverTotal = server[server.length - 1].valueRub;
    const diff = summary - serverTotal;
    return {sumRub: summary, serverTotalRub: serverTotal, diffRub: diff, reconciled: Math.abs(diff) <= EPS};
  }
  // JS: moneyBridge. Мост вклада варианта: выручка корзины, сырье один раз, операции, обслуживание, заморозка, вклад (итог сервера).
  function moneyBridge(result) {
    if (!isPresent(result.contribution)) return {items: [], sumRub: null, serverTotalRub: null, diffRub: null, reconciled: null, reason: 'Нет допустимого расчета'};
    const items = [
      {id: 'revenue', label: 'Выручка всей корзины', valueRub: result.revenue},
      {id: 'raw', label: 'Сырье один раз', valueRub: -result.rawCost},
      {id: 'route', label: 'Изменяемые операции', valueRub: -result.routeCost},
      {id: 'service', label: 'Стоимость обслуживания заказов', valueRub: -result.serviceCost},
      {id: 'freeze', label: 'Расход заморозки', valueRub: -result.freezeCost},
      {id: 'contribution', label: 'Вклад варианта', valueRub: result.contribution, kind: 'total'}
    ];
    return {items, ...bridgeSum(items), reason: null};
  }
  // JS: contributionSplit. Вклад решения, распределенная производственная себестоимость; полная себестоимость, прибыль и денежный поток без данных финансов.
  function contributionSplit(result) {
    if (!isPresent(result.contribution)) return null;
    return {
      managedContributionRub: result.contribution,
      distributedProductionCostRub: result.rawCost + result.routeCost,
      fullCostRub: null, fullCostStatus: 'Требуется подтверждение: состав полной себестоимости (владелец: финансы)',
      periodProfitRub: null, periodProfitStatus: 'Требуется подтверждение: налоговая основа (владелец: финансы)',
      cashFlowRub: null, cashFlowStatus: 'Требуется подтверждение: сроки оплаты и оборотный капитал (владелец: финансы)'
    };
  }
  // JS: stockBridge. Мост запаса по партиям: начальный запас + закупка + выпуск − передача − отгрузка − списание = конечный запас.
  function stockBridge(movements, closing) {
    const lots = {}, errors = [];
    for (const m of movements) {
      if (!Object.hasOwn(STOCK_SIGN, m.kind) || !Number.isFinite(m.kg) || m.kg < 0 || !Number.isFinite(m.valueRub)) {
        errors.push('Движение партии ' + String(m.lot) + ' требует известного вида и неотрицательного объема');
        continue;
      }
      if (!Object.hasOwn(lots, m.lot)) lots[m.lot] = {flows: Object.fromEntries(Object.keys(STOCK_SIGN).map(k => [k, 0])), closingKg: 0, closingValueRub: 0};
      const lot = lots[m.lot];
      lot.flows[m.kind] += m.kg;
      lot.closingKg += STOCK_SIGN[m.kind] * m.kg;
      lot.closingValueRub += STOCK_SIGN[m.kind] * m.valueRub;
    }
    const names = Object.keys(lots);
    const negative = names.filter(n => lots[n].closingKg < -EPS);
    const matches = isPresent(closing)
      ? Object.fromEntries(Object.entries(closing).map(([name, kg]) => [name, Math.abs((Object.hasOwn(lots, name) ? lots[name].closingKg : 0) - kg) <= EPS]))
      : null;
    const totals = {
      closingKg: total(names.map(n => lots[n].closingKg)), closingValueRub: total(names.map(n => lots[n].closingValueRub)),
      flows: Object.fromEntries(Object.keys(STOCK_SIGN).map(k => [k, total(names.map(n => lots[n].flows[k]))]))
    };
    const balanced = !errors.length && !negative.length && (matches === null || Object.values(matches).every(Boolean));
    return {lots, totals, negativeLots: negative, matches, errors, balanced};
  }
  // JS: costStack. Накопительный стакан себестоимости, руб / кг выпуска; итог начинается от нуля.
  function costStack(parts) {
    const steps = [];
    let running = 0;
    for (const part of parts) {
      steps.push({id: part.id, label: part.label, valueRubKg: part.valueRubKg, fromRubKg: running, toRubKg: running + part.valueRubKg});
      running += part.valueRubKg;
    }
    steps.push({id: 'total', label: 'Итог, руб. / кг выпуска', valueRubKg: running, fromRubKg: 0, toRubKg: running, kind: 'total'});
    return {steps, totalRubKg: running};
  }
  // JS: mergePatch. Вложенные словари объединяются, прочие значения заменяются.
  function mergePatch(base, patch) {
    const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const out = clone(base);
    for (const [key, value] of Object.entries(patch)) out[key] = plain(value) && plain(out[key]) ? mergePatch(out[key], value) : clone(value);
    return out;
  }
  // JS: leverResidual. Пакет рычагов: levers = {имя: патч входа}. Частный эффект – от базы; остаток взаимодействий = совместный − сумма частных.
  function leverResidual(input, levers) {
    const base = evaluate(input || {}).contribution;
    if (!isPresent(base)) return null;
    const individual = {};
    let jointPatch = {};
    for (const [name, patch] of Object.entries(levers)) {
      individual[name] = evaluate(mergePatch(input || {}, patch)).contribution - base;
      jointPatch = mergePatch(jointPatch, patch);
    }
    const joint = evaluate(mergePatch(input || {}, jointPatch)).contribution - base;
    return {baseRub: base, individualRub: individual, jointRub: joint, interactionRub: joint - total(Object.values(individual))};
  }
  // JS: searchCut. Сеточный перебор объема разделки на области {fromT, toT, stepT}; по умолчанию 30–50 т с шагом 0,25 т.
  // Лучший проверенный вариант: максимум вклада среди допустимых, при равенстве меньший объем. Оптимум не доказан.
  function searchCut(input, area) {
    const started = Date.now();
    const a = {fromT: 30, toT: 50, stepT: .25, ...(area || {})};
    const p = normalize(input);
    const steps = Math.floor((a.toT - a.fromT) / a.stepT + .5);
    const points = [];
    for (let k = 0; k <= steps; k++) {
      const cutT = a.fromT + k * a.stepT;
      const result = evaluate({...p, cut: cutT});
      points.push({cutT, contribution: result.contribution, feasible: result.feasible});
    }
    const feasible = points.filter(pt => pt.feasible);
    let best = null;
    for (const pt of feasible) if (!best || pt.contribution > best.contribution + EPS) best = pt;
    return {
      area: {fromT: a.fromT, toT: a.toT, stepT: a.stepT, points: points.length}, points, feasibleCount: feasible.length, best,
      solver: {name: 'сеточный перебор', status: best ? 'лучший проверенный вариант' : 'Нет допустимого варианта', provenOptimum: false,
        toleranceT: a.stepT, gap: null, gapNote: 'Оптимум не доказан: разрыв не вычислен', timeMs: Date.now() - started},
      label: unit
    };
  }
  // JS: mixOutputs. Смесь маршрутов недели: mix = {код маршрута: объем разделки, т}; тушка – остаток входа.
  // Совместный выход делится по выходам маршрута, потери отдельно. Баланс: выход плюс потери равны входу.
  function mixOutputs(totalInputT, mix) {
    const errors = Object.keys(mix).filter(code => !Object.hasOwn(routes, code) || !Number.isFinite(mix[code]) || mix[code] < 0);
    if (errors.length || !Number.isFinite(totalInputT) || totalInputT < 0) {
      return {valid: false, errors: errors.length ? errors : ['Вход и объемы разделки требуют чисел не меньше нуля']};
    }
    const produced = zero();
    let loss = 0;
    const cutTotal = total(Object.values(mix));
    for (const [code, cutT] of Object.entries(mix)) {
      const route = routes[code];
      for (const [product, share] of Object.entries(route.yields)) produced[product] += cutT * 1000 * share;
      loss += cutT * 1000 * route.loss;
    }
    produced.whole = (totalInputT - cutTotal) * 1000;
    const balance = totalInputT * 1000 - total(Object.values(produced)) - loss;
    return {valid: true, errors: [], produced, lossKg: loss, cutT: cutTotal, massBalanceKg: balance, balanced: Math.abs(balance) <= 1e-6};
  }
  const api = { defaults, evaluate, alternatives, checkRequest, snapshot, fact, roi, changeLevers, routes, products, version: '2.0', units: { mass: 'т', price: 'руб. / кг', money: 'руб.' } };
  Object.assign(api, {planConfig, buildFrontier, buildStakan, planStatus, scaleGuard, efficientPoints,
    unitCostRegister, commitmentBoundary, resourceLimits, bridgeSum, moneyBridge, contributionSplit,
    stockBridge, costStack, mergePatch, leverResidual, searchCut, mixOutputs, COST_CLASSES, FRONTIER_SPEC});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PlannerModel = api;
})(typeof window === 'object' ? window : null);
