const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = {module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(new URL('../model.js', 'file://' + __filename), 'utf8'), context);
const M = context.module.exports;
let checks = 0;
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, label + ': ' + actual + ' / ' + expected);
  checks++;
}
function test(label, fn) { fn(); console.log('Проверено: ' + label); }

test('Учебная корзина закрывает массу и даёт 80 тысяч к базе', () => {
  const p = M.defaults(), r = M.evaluate(p), a = M.alternatives(p);
  assert.ok(r.feasible);
  near(r.massBalance, 0, 'Баланс');
  near(r.contribution, 2600000, 'Вклад');
  near(a.baseline.result.contribution, 2520000, 'База');
  near(r.contribution - a.baseline.result.contribution, 80000, 'Эффект');
  near(r.produced.fillet, 16, 'Филе');
  near(r.loss, 1, 'Потери');
  near(a.candidates[0].result.contribution, 2440000, 'Разделка 30%');
  assert.equal(a.best.params.cut, 50);
});
test('Каждый маршрут закрывает баланс массы', () => {
  for (const route of Object.keys(M.routes)) {
    const r = M.evaluate({ ...M.defaults(), route });
    assert.ok(r.valid, route);
    near(r.massBalance, 0, route);
    if (route !== 'whole') near(Object.values(M.routes[route].yields).reduce((a, b) => a + b, 0) + M.routes[route].loss, 1, route + ' нормы');
  }
});
test('Крупная разделка и обвалка получают собственные переделы', () => {
  const coarse = M.evaluate({ ...M.defaults(), route: 'coarse' });
  const deep = M.evaluate({ ...M.defaults(), route: 'deep' });
  const fillet = M.evaluate(M.defaults());
  near(coarse.stages.find(s => s.id === 'deboning').load, 0, 'Крупная');
  near(deep.stages.find(s => s.id === 'deboning').load, 37.5, 'Глубокая');
  near(coarse.produced.legs, fillet.produced.legs, 'Ножки при обвалке грудки');
  near(coarse.produced.breast, fillet.produced.fillet + fillet.produced.frame - coarse.produced.frame + fillet.loss - coarse.loss, 'Баланс обвалки грудки');
  near(fillet.produced.legs, deep.produced.legMeat + deep.produced.legBone + deep.produced.legSkin + deep.loss - fillet.loss, 'Баланс обвалки ножки');
  near(coarse.contribution, 2225000, 'Крупная разделка: цена грудки 225');
  assert.ok(coarse.feasible && deep.feasible);
  assert.equal(M.alternatives({ ...M.defaults(), route: 'deep' }).baseline.params.route, 'fillet');
});
test('Ограничения часов и оборудования действуют одновременно', () => {
  const p = M.defaults(); p.hours = 64;
  const r = M.evaluate(p);
  near(r.effectiveCapacity, 40, 'Часы');
  assert.equal(r.feasible, false);
  assert.match(r.violations.join(' '), /Разделка/);
  p.cut = 40;
  assert.ok(M.evaluate(p).feasible);
});
test('Каждый передел ограничивает выпуск самостоятельно', () => {
  for (const [key, capacity] of [['deboning', 19], ['packing', 98]]) {
    const p = M.defaults(); p.stageCapacity[key] = capacity;
    assert.equal(M.evaluate(p).feasible, false);
  }
  const p = M.defaults(); p.demand.fillet = 10; p.stageCapacity.freezing = 5;
  assert.equal(M.evaluate(p).feasible, false);
  p.stageCapacity.freezing = 6; p.coldCapacity = 5;
  const r = M.evaluate(p);
  assert.equal(r.feasible, false);
  assert.equal(r.stages.find(s => s.id === 'freezing').load, 6);
  assert.equal(r.storage.load, 6);
});
test('Остаток получает отдельную оценку будущей реализации', () => {
  const p = M.defaults(); p.demand.fillet = 10;
  const r = M.evaluate(p);
  near(r.inventoryT, 6, 'Остаток');
  near(r.contribution, 740000, 'Текущий результат');
  near(r.inventoryValue, 1320000, 'Будущая реализация');
  near(r.expectedContribution, 2060000, 'Вклад партии');
  const early = M.evaluate({ ...p, cut: 31.25 });
  near(early.contribution, 2450000, 'Ранний план');
  near(early.contribution - r.expectedContribution, 390000, 'Сохранённый результат');
  assert.equal(M.roi(p).eligible, false);
});
test('Подтверждённый заказ блокирует схему с другим набором продуктов', () => {
  const p = M.defaults(); p.orders.fillet = 5; p.route = 'coarse';
  const r = M.evaluate(p);
  assert.equal(r.feasible, false);
  near(r.allocations.fillet.shortfall, 5, 'Дефицит филе');
});
test('Минимальный заказ тушки входит в общий спрос', () => {
  const p = M.defaults(); p.demand.whole = 0;
  const r = M.evaluate(p);
  assert.equal(r.valid, false);
  assert.equal(r.feasible, false);
  assert.match(r.errors.join(' '), /Тушка: обязательства/);
});
test('Новая заявка поглощает прогноз и резервируется один раз', () => {
  const p = M.defaults(); p.cut = 40;
  const r = M.checkRequest(p, { requestId: 'А-1', product: 'fillet', quantity: 4, price: 300 });
  assert.ok(r.canApply);
  near(r.forecastConsumed, 4, 'Поглощение');
  near(r.incrementalDemand, 0, 'Общий спрос');
  near(r.params.demand.fillet, 16, 'Спрос');
  near(r.params.orders.fillet, 4, 'Резерв');
  assert.equal(p.orders.fillet, 0);
  const twice = M.checkRequest(r.params, { requestId: 'А-1', product: 'fillet', quantity: 4, price: 300 });
  assert.equal(twice.duplicate, true);
  near(twice.params.orders.fillet, 4, 'Повтор');
});
test('Новая сверхплановая заявка сохраняет существующие обязательства', () => {
  const p = M.defaults(); p.cut = 40; p.orders.fillet = 12.8;
  const r = M.checkRequest(p, { requestId: 'Б-1', product: 'fillet', quantity: 4, price: 300, forecastAbsorption: false });
  assert.equal(r.canApply, false);
  assert.ok(r.result.allocations.fillet.orderSold >= 12.8 - 1e-7);
  near(r.covered, 3.2, 'Частичное покрытие');
  near(r.shortfall, .8, 'Остаток заявки');
  const partial = M.checkRequest(p, { requestId: 'Б-2', product: 'fillet', quantity: 3.2, price: 300, forecastAbsorption: false });
  assert.ok(partial.canApply);
  near(partial.result.cut, 50, 'Вход разделки');
  near(partial.extraCut, 10, 'Дополнительный вход');
});
test('Цена и обслуживание заявки меняют выручку и вклад однократно', () => {
  const p = M.defaults();
  const r = M.checkRequest(p, { requestId: 'В-1', product: 'fillet', quantity: 4, price: 295, service: 3 });
  assert.ok(r.canApply);
  near(r.result.revenue, 18015000 - 4 * 5 * 1000, 'Выручка');
  near(r.result.serviceCost, 12000, 'Обслуживание');
  near(r.deltaContribution, -32000, 'Изменение');
});
test('Утверждённый снимок сохраняется при изменении черновика', () => {
  const p = M.defaults();
  assert.equal(M.snapshot(p, { com: true, prod: true }).approved, false);
  const approved = M.snapshot(p, { com: true, prod: true, fin: true });
  assert.ok(approved.approved);
  assert.ok(M.snapshot(p, { commercial: true, production: true, finance: true }).approved);
  p.cut = 40;
  near(approved.params.cut, 50, 'Снимок');
  const bad = M.defaults(); bad.capacity = 40;
  assert.equal(M.snapshot(bad, { com: true, prod: true, fin: true }).approved, false);
});
test('План–факт пересчитывается для любого входа разделки', () => {
  for (const cut of [30, 40, 50]) {
    const f = M.fact({ ...M.defaults(), cut });
    near(f.priceDelta, -.32 * cut * 5 * 1000, 'Цена ' + cut);
    near(f.costDelta, -cut * .2 * 1000, 'Затраты ' + cut);
    near(f.actual, f.plan + f.priceDelta + f.costDelta, 'Мост ' + cut);
  }
  near(M.fact(M.defaults()).actual, 2510000, 'Учебный факт');
  const lowPrice = M.defaults(); lowPrice.prices.fillet = 3;
  near(M.fact(lowPrice).priceDelta, -48000, 'Цена до нулевой границы');
  const whole = M.fact({ ...M.defaults(), route: 'whole', demand: { ...M.defaults().demand, whole: 100 } });
  near(whole.priceDelta, 0, 'Тушка'); near(whole.costDelta, 0, 'Тушка: разделка');
});
test('Год повторяет ту же базу и исключает сложение разных масштабов', () => {
  const r = M.roi(M.defaults());
  assert.ok(r.eligible);
  near(r.weeklyEffect, 80000, 'Неделя');
  near(r.annualEffect, 4160000, '52 недели');
  assert.equal(r.budgetComplete, false);
  assert.equal(r.firstYearCash, null);
  assert.equal(r.roi, null);
  const adjusted = M.roi(M.defaults(), { execution: .5, investment: 1000000, annualOpex: 80000 });
  near(adjusted.annualEffect, 2080000, 'Исполнение');
  near(adjusted.netEffect, 2000000, 'Эксплуатация');
  near(adjusted.firstYearCash, 1000000, 'Первый год');
  near(adjusted.paybackYears, .5, 'Срок');
  assert.equal(M.roi(M.defaults(), { execution: 1.1 }).eligible, false);
});
test('Границы ввода и нулевая мощность дают объяснимые статусы', () => {
  for (const value of [-1, NaN, Infinity]) {
    const r = M.evaluate({ ...M.defaults(), cut: value });
    assert.equal(r.valid, false);
  }
  assert.equal(M.evaluate({ ...M.defaults(), route: 'unknown' }).valid, false);
  assert.equal(M.evaluate({ ...M.defaults(), route: 'constructor' }).valid, false);
  assert.equal(M.evaluate({ ...M.defaults(), cut: 101 }).valid, false);
  assert.equal(M.evaluate({ ...M.defaults(), capacity: 0 }).feasible, false);
  const p = M.defaults(); p.totalInput = 0; p.cut = 0; p.minWhole = 0;
  const r = M.evaluate(p);
  assert.ok(r.feasible); near(r.contribution, 0, 'Пустой план');
  assert.equal(M.fact(p).execution, null);
});
test('Исходные параметры и справочники сохраняются при расчётах', () => {
  const p = M.defaults(), before = JSON.stringify(p);
  M.evaluate(p); M.alternatives(p); M.fact(p); M.roi(p);
  assert.equal(JSON.stringify(p), before);
  const p2 = M.defaults(); p2.prices.fillet = 1;
  assert.equal(M.defaults().prices.fillet, 300);
  assert.ok(M.changeLevers({ ...p, rawCost: 139 }).some(c => c.key === 'rawCost'));
  p2.routeCosts.fillet = 22;
  assert.ok(M.changeLevers(p2).some(c => c.key === 'routeCosts.fillet'));
});
console.log('Готово: 16 сценариев / числовых проверок: ' + checks);