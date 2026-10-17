// Независимые приемочные тесты итерации v4 (L7, Д12): числа, единицы и пороги пакета Проверка_внедрения_v4 дословно.
// Тесты написаны до реализации: падение означает расхождение кода с пакетом. Владелец указан рядом с каждой проверкой.
// Запуск из каталога platform: node --test --test-reporter=spec tests/v4-acceptance.test.mjs
// Синтетика: tests/fixtures-v4. Реальные каталоги данных этот файл не открывает.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {fieldCommit, n} from '../src/format.js';
import {loadPercent} from '../src/capacity-units.js';
import {buildPriceSteps, historySummary, buildCostStack} from '../src/historical-data.js';

const fixture = name => readFile(new URL(`./fixtures-v4/${name}`, import.meta.url), 'utf8').then(text => JSON.parse(text));
const modelSource = await readFile(new URL('../model.js', import.meta.url), 'utf8');
const sandbox = {module: {exports: {}}};
vm.runInNewContext(modelSource, sandbox);
const M = sandbox.module.exports;

// Сравнение с допуском: абсолютная разность не больше eps.
const near = (actual, expected, eps, message) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps, `${message}: ${actual} при ожидании ${expected} (допуск ${eps})`);
};
const roundTo = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

test('Перевод единиц: 313 221,75 / 337 272 × 100 равно 92,86918 % (допуск 1e-4), владелец L2', () => {
  near(loadPercent(313221.7507, 337272), 92.86918, 1e-4, 'Загрузка валовой упаковки по полной точности');
  near(loadPercent(313221.75, 337272), 92.86918, 1e-4, 'Загрузка валовой упаковки по округленному потоку');
});

test('Поле: 4 010 т при пределе 1 000 т сохраняется при открытии и выходе из поля, владелец L4', () => {
  // Открытие редактора отдает текст 4010 или отформатированное значение; выход из поля не меняет 4 010 т.
  for (const text of ['4010', n(4010, 0)]) {
    const result = fieldCommit({text, current: 4010, min: 1, max: 1000, unit: 'т'});
    assert.equal(result.kind, 'same', `Текст «${text}» сохраняет 4 010 т, значение не меняется`);
  }
  const typed = fieldCommit({text: '4010', current: 4010, min: 1, max: 1000, unit: 'т'});
  assert.ok(typed.kind === 'same' || typed.value === 4010, 'Выход из поля не записывает предел 1 000 т');
});

test('История: 120 строк дают пять диапазонов 3 210 / 15 900 / 1 380 / 1 380 / 484 875 кг, владелец L5', async () => {
  const rows = await fixture('history_fillet_synthetic.json');
  assert.equal(rows.length, 120, 'Выгрузка содержит 120 строк');
  const steps = buildPriceSteps(rows).sort((a, b) => b.fromRubKg - a.fromRubKg);
  assert.deepEqual(steps.map(step => step.fromRubKg), [375, 350, 325, 300, 275], 'Диапазоны шириной 25 руб. / кг');
  assert.deepEqual(steps.map(step => step.volumeKg), [3210, 15900, 1380, 1380, 484875], 'Объемы диапазонов, кг');
  assert.deepEqual(steps.map(step => step.rows), [3, 15, 3, 6, 93], 'Строки диапазонов');
  const prices = [390.4052, 357.7187, 338.6759, 304.5454, 285.8733];
  steps.forEach((step, index) => near(step.weightedPriceRubKg, prices[index], 5e-5, `Средневзвешенная цена диапазона ${step.fromRubKg}`));
  const shares = [0.6335, 3.1377, 0.2723, 0.2723, 95.6842];
  steps.forEach((step, index) => near(step.shareOfVolumePct, shares[index], 5e-5, `Доля объема диапазона ${step.fromRubKg}, %`));
});

// Допуск ±25,34 руб. = 506 745 кг × 0,00005 руб. / кг (половина единицы четвертого знака средних цен пакета).
// Строка 120 фикстуры подогнана под итог (поле fitNote, Требуется подтверждение: сверка с владельцем данных).
// Сверка по средним ценам пакета от подогнанной строки не зависит.
const TOTAL_REVENUE_RUB = 146441400.87;
const HISTORY_TOLERANCE_RUB = 25.34;

test('История: 506 745 кг, 146 441 400,87 руб. и средняя 288,98 руб. / кг, владелец L5', async () => {
  const summary = historySummary(await fixture('history_fillet_synthetic.json'));
  assert.equal(summary.rows, 120, 'Строк истории');
  assert.equal(summary.volumeKg, 506745, 'Объем истории, кг');
  near(summary.revenueRub, TOTAL_REVENUE_RUB, HISTORY_TOLERANCE_RUB, 'Выручка истории по строкам фикстуры (подогнана), руб.');
  const packageRevenue = [[3210, 390.4052], [15900, 357.7187], [1380, 338.6759], [1380, 304.5454], [484875, 285.8733]]
    .reduce((sum, [kg, price]) => sum + kg * price, 0);
  near(packageRevenue, TOTAL_REVENUE_RUB, HISTORY_TOLERANCE_RUB, 'Выручка по средним ценам пакета (четыре знака), руб.');
  assert.equal(roundTo(summary.avgPriceRubKg, 2), 288.98, 'Средняя историческая цена сделки, руб. / кг');
});

test('Стек филе: 117,3393655101 + 20,0100687032 + 4,1373325945 равно 141,4867668079 руб. / кг (допуск 1e-6), владелец L5', async () => {
  // Пакет: 0 → +117,3393655 сырье → +20,0100687 цех → +4,1373326 упаковка → 141,4867668 руб. / кг выпуска.
  const steps = buildCostStack((await fixture('cost_stack_synthetic.json')).fillet);
  const articles = steps.filter(step => !step.total);
  assert.equal(articles.length, 3, 'Три статьи: сырье, цех, упаковка');
  near(articles[0].toRubKg, 117.3393655101, 1e-6, 'Сырье');
  near(articles[1].toRubKg, 137.3494342133, 1e-6, 'Сырье плюс цех');
  const total = steps.at(-1);
  assert.equal(total.total, true, 'Последний шаг является итогом');
  near(total.toRubKg, 141.4867668079, 1e-6, 'Итог филе');
});

test('Стек бескостного бедра: итог 141,9475847510 руб. / кг (допуск 1e-6), владелец L5', async () => {
  const steps = buildCostStack((await fixture('cost_stack_synthetic.json')).boneless_thigh);
  near(steps.at(-1).toRubKg, 141.9475847510, 1e-6, 'Итог бескостного бедра');
});

test('Денежный мост: сумма статей филе равна серверному итогу (допуск 1e-7), владелец L3', async () => {
  const articles = (await fixture('cost_stack_synthetic.json')).fillet.articles;
  const items = articles.map(article => ({name: article.name, valueRub: article.rubKg, kind: 'cost'}));
  items.push({name: 'Итог', valueRub: 141.4867668079, kind: 'total'});
  const result = M.bridgeSum(items);
  assert.equal(result.reconciled, true, 'Сумма статей сходится с серверным итогом');
  assert.ok(Math.abs(result.diffRub) <= 1e-7, `Разность ${result.diffRub} больше допуска`);
});

test('Обязательство 600 000 кг филе: вариант 0 т разделки исключен, владелец L3', async () => {
  const {orders, costFacts, sources, ...contractWeek} = await fixture('week_config.json');
  const boundary = M.commitmentBoundary({...contractWeek, routeCode: 'fillet', commitmentKg: {fillet: 600000}}, 0);
  assert.equal(boundary.feasible, false, 'Нулевая разделка не выпускает 600 000 кг филе');
  assert.ok(boundary.violations.length > 0, 'Нарушение обязательства названо');
});

test('Фронтир: 30 т дают 2,44 млн руб., 31,25 т дают 2,45 млн руб., 31,25 т лучше в области поиска, владелец L3', () => {
  const at30 = M.evaluate({cut: 30});
  const at31 = M.evaluate({cut: 31.25});
  assert.equal(roundTo(at30.contribution / 1e6, 2), 2.44, '30 т');
  assert.equal(roundTo(at31.contribution / 1e6, 2), 2.45, '31,25 т');
  assert.equal(at30.feasible, true, '30 т допустимы');
  assert.equal(at31.feasible, true, '31,25 т допустимы');
  const search = M.searchCut({}, {fromT: 30, toT: 50, stepT: 0.25});
  const point = search.points.find(item => item.cutT === 31.25);
  assert.ok(point, 'Точка 31,25 т входит в область поиска');
  assert.ok(point.contribution > at30.contribution, 'Вклад 31,25 т выше вклада 30 т');
});
