// Денежный регистр и граница плана (Д05, Д06) на model.js. Запуск из каталога platform: node --test tests/economics-register.test.mjs
// Все входы синтетические. Числа приёмки взяты из План_следующей_итерации.md дословно. Паритет с backend/model.py проверяет pytest.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context = {module: {exports: {}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports;

let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };
const near = (actual, expected, tol, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= tol, `${message}: ${actual} / ${expected}`);

// Неделя с разрешенным маршрутом: сырьё 127,2 руб. / кг, ставка целой тушки 130,5 (содержит сырьё 114,9).
const routeTable = {
  whole: {name: 'Целая тушка', yields: {}, loss: 0, variableCost: 130.5, rawInRate: true, deboneInputShare: 0},
  fillet: {name: 'Филе и ножки', yields: {fillet: .32, legs: .35, wing: .11, frame: .20}, loss: .02, variableCost: 20.3, deboneInputShare: .4}
};
const freezePriceRubKg = {whole: 140, fillet: 220, legs: 145, wing: 135, frame: 20};
const week = (patch = {}) => ({inputKg: 4_000_000, routeCode: 'fillet', capacityWeekT: 4000, costMethod: 'weight', rawCostRubKg: 127.2,
  routeTable, freezePriceRubKg, orders: [
    {id: 'w1', product: 'whole', orderClass: 'confirmed', qtyKg: 2_400_000, priceRubKg: 170, orderDate: '2026-10-18'},
    {id: 'f600', product: 'fillet', orderClass: 'confirmed', qtyKg: 600_000, priceRubKg: 300, orderDate: '2026-10-18'}], ...patch});

// Д05, приёмка 2: признак rawInRate true у ставки 130,5 (состав 114,9 + 10,8 + 4,8): ставка используется как есть, сырье не повторяется.
check(Math.abs(114.9 + 10.8 + 4.8 - 130.5) < 1e-9, 'Состав ставки 130,5: 114,9 + 10,8 + 4,8');
check(Math.abs(127.2 + 10.8 + 4.8 - 142.8) < 1e-9, 'Условный пример 127,2 + 10,8 + 4,8 = 142,8');
near(M.unitCostRegister(week(), 'whole'), 130.5, 1e-9, 'Признак rawInRate: ставка 130,5 руб. / кг как есть');
const noRaw = {...routeTable.whole, rawInRate: false, variableCost: 15.6};
near(M.unitCostRegister(week({routeTable: {...routeTable, whole: noRaw}}), 'whole'), 142.8, 1e-9, 'Ставка без сырья 10,8 + 4,8: сырье 127,2 добавляется один раз, 142,8 руб. / кг');
check(M.unitCostRegister(week(), 'whole') !== 257.7, 'Повтор сырья устранен: не 257,7');
const noFlag = {...routeTable.whole, rawInRate: undefined, variableCost: 8};
near(M.unitCostRegister(week({routeTable: {...routeTable, whole: noFlag}}), 'whole'), 127.2 + 8, 1e-9, 'Без признака rawInRate сырье добавляется один раз: 127,2 + 8');
near(M.unitCostRegister(week(), 'fillet'), (127.2 + 20.3) / 0.98, 1e-9, 'Филе: сырьё один раз');

// Д05, приёмка 1: 117,3393655101 + 20,0100687032 + 4,1373325945 = 141,4867668079; бедро 141,9475847510.
const stack = M.costStack([
  {id: 'raw', label: 'Сырьё', valueRubKg: 117.3393655101}, {id: 'cex', label: 'Цех', valueRubKg: 20.0100687032},
  {id: 'pack', label: 'Упаковка', valueRubKg: 4.1373325945}]);
near(stack.totalRubKg, 141.4867668079, 1e-9, 'Филе: итог стакана');
check(stack.steps.at(-1).fromRubKg === 0, 'Итоговый столбец начинается от нуля');
// Упаковка бедра 4,5981505377 – итог 141,9475847510 минус сырьё и цех; спецификация округляет её до 4,59815054 (даёт ...533, см. pytest).
const bedro = M.costStack([
  {id: 'raw', label: 'Сырьё', valueRubKg: 117.3393655101}, {id: 'cex', label: 'Цех', valueRubKg: 20.0100687032},
  {id: 'pack', label: 'Упаковка', valueRubKg: 4.5981505377}]);
near(bedro.totalRubKg, 141.9475847510, 1e-9, 'Бедро: итог стакана');

// Д05, приёмка 3: мост запаса по партиям.
const movements = [
  {lot: 'A', kind: 'opening', kg: 1000, valueRub: 100000}, {lot: 'A', kind: 'purchase', kg: 200, valueRub: 30000},
  {lot: 'A', kind: 'output', kg: 500, valueRub: 50000}, {lot: 'A', kind: 'transfer', kg: 100, valueRub: 10000},
  {lot: 'A', kind: 'shipment', kg: 300, valueRub: 30000}, {lot: 'A', kind: 'writeoff', kg: 50, valueRub: 5000}];
const bridge = M.stockBridge(movements, {A: 1250});
check(bridge.balanced && bridge.matches.A && bridge.totals.closingKg === 1250 && bridge.totals.closingValueRub === 135000, 'Мост запаса сходится по килограммам и рублям');
check(M.stockBridge([{lot: 'B', kind: 'shipment', kg: 5, valueRub: 50}]).negativeLots.includes('B'), 'Отрицательный остаток отмечен');

// Д05, приёмка 4: сумма статей моста равна серверному итогу; цена применяется к объему однократно.
const base = M.evaluate({cut: 30});
const money = M.moneyBridge(base);
check(money.reconciled === true && Math.abs(money.diffRub) <= 1e-7, 'Сумма статей денежного моста равна серверному итогу');
const raised = M.evaluate({cut: 30, prices: {fillet: 310}});
near(raised.contribution - base.contribution, base.allocations.fillet.sold * 1000 * 10, 1e-6, 'Изменение цены применено к проданному объему однократно');
const split = M.contributionSplit(base);
check(split.managedContributionRub === base.contribution && split.fullCostRub === null && split.fullCostStatus.startsWith('Требуется подтверждение'), 'Полная себестоимость без данных финансов: статус, не число');

// Д05, приёмка 5 и 6: пакет рычагов с отдельным остатком взаимодействий.
const lever = M.leverResidual({cut: 30}, {cut: {cut: 40}, price: {prices: {fillet: 310}}});
near(lever.interactionRub, lever.jointRub - Object.values(lever.individualRub).reduce((s, v) => s + v, 0), 1e-6, 'Остаток взаимодействий равен совместному минус сумма частных');
check(Math.abs(lever.interactionRub) > 1, 'Рычаги зависят друг от друга: остаток не нулевой');

// Д06, приёмка 1: обязательство 600000 кг филе; вариант 0 т исключен; конфликт имеет количественное объяснение.
const zero = M.commitmentBoundary(week({commitmentKg: {fillet: 600000}}), 0);
check(zero.feasible === false && zero.violations[0].kind === 'supply' && zero.violations[0].availableKg === 0, 'Вариант 0 т исключен обязательством');
const at = M.commitmentBoundary(week({commitmentKg: {fillet: 600000}}), 1875);
near(at.minCutT, 1875, 1e-9, 'Минимальный объем разделки для обязательства');
check(at.feasible === true, 'При 1875 т обязательство выполнено');
const tight = week({commitmentKg: {fillet: 600000}, capacityWeekT: 1493.8});
const capacity = M.commitmentBoundary(tight, 1000).violations.find(v => v.kind === 'capacity');
near(capacity.shortfallCutT, 1875 - 1493.8, 1e-9, 'Разрыв мощности в тоннах разделки');
const supply = M.commitmentBoundary(tight, 1493.8).violations.find(v => v.kind === 'supply');
near(supply.shortfallKg, 121984, 1e-6, 'Разрыв выпуска филе в килограммах при полной мощности');

// Д06, приёмка 2: контроль 30 / 31,25 т; сеточный перебор включает 31,25; статус решателя без слова «оптимум».
near(M.evaluate({cut: 30}).contribution, 2_440_000, 1e-6, 'Контроль 30 т: 2,44 млн руб.');
const control = M.evaluate({cut: 31.25});
near(control.contribution, 2_450_000, 1e-6, 'Контроль 31,25 т: 2,45 млн руб.');
check(control.feasible === true, 'Контроль 31,25 т допустим');
const search = M.searchCut({});
check(search.points.some(p => p.cutT === 31.25) && search.area.points === 81, 'Сеточный перебор включает 31,25 т');
check(search.solver.status === 'лучший проверенный вариант' && search.solver.provenOptimum === false, 'Статус решателя: лучший проверенный вариант');
// Требуется подтверждение: пакет называет выбор 30 т, учебные параметры по умолчанию дают 50 т.
check(search.best.cutT === 50, 'Лучший проверенный вариант по учебным параметрам: 50 т (конфликт с пакетом)');

// Граница: выпуск, решатель и статусы в фронтире с обязательством.
const frontier = M.buildFrontier(week({commitmentKg: {fillet: 600000}}), null);
check(frontier.points.length > 0 && Math.min(...frontier.points.map(p => p.V)) >= 1875 - 1e-9, 'Фронтир оставляет только объемы, выполняющие обязательство');
check(frontier.solver.status === 'лучший проверенный вариант', 'Фронтир выводит статус решателя');
const blocked = M.buildFrontier(week({commitmentKg: {fillet: 600000}, capacityWeekT: 1493.8}), null);
check(blocked.points.length === 0 && blocked.status.level === 'risk', 'Обязательство выше мощности: риск, а не ноль как оптимум');

// Ресурсы: неизвестный ресурс дает границу доказанной выполнимости; общий ресурс считается один раз.
const resources = [
  {id: 'люди', name: 'Общие люди', capacityKg: 100, consumers: [{product: 'whole', kg: 60}, {product: 'fillet', kg: 30}]},
  {id: 'линия', name: 'Линия', capacityKg: null, consumers: [{product: 'fillet', kg: 10}]},
  {id: 'холод', name: 'Холод', capacityKg: 80, consumers: [{product: 'fillet', kg: 90}]}];
const limits = M.resourceLimits(resources);
check(limits.provenFeasible === false && limits.violations[0].id === 'холод' && limits.unknownCount === 1, 'Неизвестный ресурс не обнуляет граница');
check(limits.ranking.find(r => r.id === 'люди').loadKg === 90 && limits.next.id === 'люди', 'Общий ресурс учитывается один раз, следующее ограничение названо');

// Смесь маршрутов: баланс выхода и потерь.
const mix = M.mixOutputs(100, {fillet: 30, coarse: 20});
check(mix.valid && mix.balanced && Math.abs(mix.massBalanceKg) <= 1e-6, 'Смесь маршрутов сходится по массе');
check(M.mixOutputs(100, {ghost: 10}).valid === false, 'Неизвестный маршрут не проходит');

// Классификация статей и постановка решателя.
check(M.COST_CLASSES.length === 6 && M.COST_CLASSES.every(c => c.taxBasis.startsWith('Требуется подтверждение')), 'Статьи классифицированы; налоговая основа требует подтверждения');
check(M.FRONTIER_SPEC.integerBatches.startsWith('не заданы') && M.FRONTIER_SPEC.constraints.length === 4, 'Постановка решателя фиксирует переменные, ограничения и целочисленные партии');

console.log(`Денежный регистр и граница: ${checks} проверок пройдены`);
