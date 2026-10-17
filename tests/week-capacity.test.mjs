import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Запуск из каталога platform: node tests/week-capacity.test.mjs
// Мощность разделки недели: блок capacityWeekT контракта главный, подстановки из интерфейса нет.
// Все входы синтетические. Тест читает только model.js.
const context = {module:{exports:{}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports;
let checks = 0;
const check = (condition, message) => {checks++; assert.ok(condition, message);};

const KG = M.planConfig.scaleWeekKg;
const orderRow = (id, product, orderClass, qtyKg, priceRubKg) => ({id, product, orderClass, qtyKg, priceRubKg, orderDate: '2026-10-18'});
const week = (extra = {}) => ({
  inputKg: KG, routeCode: 'fillet', costMethod: 'weight', rawCostRubKg: 140,
  freezePriceRubKg: {whole: 140, fillet: 220, legs: 145, wing: 135, frame: 20},
  orders: [orderRow('f1', 'fillet', 'confirmed', 500000, 300)],
  ...extra
});
const contract = (extra = {}) => ({
  schemaVersion: 1, source: 'aggregates', rawCostRubKg: 140,
  products: {fillet: {listPriceRubKg: 300}},
  routes: {whole: {yields: {}, variableCostRubKg: 8}, fillet: {yields: {fillet: .32, legs: .35, wing: .11, frame: .20}, variableCostRubKg: 20.3}},
  ...extra
});
const NO_CAPACITY = 'Нет данных: мощность разделки не задана';

// 1. Блок capacityWeekT контракта задает предел разделки; мощность интерфейса (4000 или min(capacity, hours × rate)) не используется
const fromBlock = M.buildFrontier(week({capacityWeekT: 4000}), contract({capacityWeekT: {deboning: 300}}));
check(fromBlock.source === 'aggregates', 'Блок мощности: источник расчета aggregates');
check(fromBlock.cap !== null && fromBlock.cap.V === 300, 'Предел разделки равен capacityWeekT.deboning, 300 т');
check(fromBlock.cap.label === 'Предел мощности', 'Подпись предела: Предел мощности');
check(fromBlock.points.length > 0 && fromBlock.points.every(p => p.V <= 300 + 1e-9), 'Ни одна точка фронтира не выше мощности контракта');
check(fromBlock.points.some(p => Math.abs(p.V - 300) < 1e-9), 'Точка фронтира на пределе мощности присутствует');

// 2. Другое значение блока меняет предел: мощность берется из контракта, а не из недели
const narrow = M.buildFrontier(week({capacityWeekT: 4000}), contract({capacityWeekT: {deboning: 200}}));
check(narrow.cap !== null && narrow.cap.V === 200, 'Мощность 200 т задает предел 200 т');

// 3. Пустое значение блока дает статус «Нет данных», подстановки нет
const emptyBlock = M.buildFrontier(week({capacityWeekT: 300}), contract({capacityWeekT: {deboning: null}}));
check(emptyBlock.status.symbol === '○' && emptyBlock.status.word === 'Нет данных', 'Пустая мощность контракта дает статус «Нет данных»');
check(emptyBlock.status.reason === NO_CAPACITY, 'Текст статуса: ' + NO_CAPACITY);
check(emptyBlock.points.length === 0 && emptyBlock.optimum === null, 'Без мощности точек фронтира и оптимума нет');

// 4. Стакан при пустой мощности контракта тоже дает статус «Нет данных»
const stakan = M.buildStakan(week({capacityWeekT: 300}), 100, 'fillet', contract({capacityWeekT: {deboning: null}}));
check(stakan.status.symbol === '○' && stakan.status.reason === NO_CAPACITY, 'Стакан без мощности контракта дает статус «Нет данных»');

// 5. Контракт без блока capacityWeekT сохраняет мощность недели (совместимость с прежними контрактами)
const legacy = M.buildFrontier(week({capacityWeekT: 300}), contract());
check(legacy.cap !== null && legacy.cap.V === 300, 'Контракт без блока оставляет мощность недели');

// 6. Учебный расчет без контракта и без мощности недели: статус «Нет данных», значение не выводится
const training = M.buildFrontier(week());
check(training.status.reason === NO_CAPACITY && training.source === 'training', 'Учебный расчет без мощности дает статус «Нет данных»');

console.log(`Мощность разделки недели: ${checks} проверок пройдены`);
