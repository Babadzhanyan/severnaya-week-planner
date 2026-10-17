import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {
  buildPriceSteps, historySummary, stepsFromAggregates, priceChartGeometry,
  FILLET_HISTORY_APRIL_2026, COST_FACTS_APRIL_2026, COST_EXCLUDED_FROM_TOTAL,
  buildCostStack, checkCostStack, decomposeDifference,
} from '../src/historical-data.js';
import {CHAIN_NODES, CHAIN_MACRO, CHAIN_DETAIL, CHAIN_DETAIL_PENDING_OPERATIONS} from '../src/chain-nodes.js';

// Запуск из каталога platform: node tests/historical-chart.test.mjs
// Проверяются только агрегаты и производственные статьи. Строки клиентов не читаются.
const root = fileURLToPath(new URL('../', import.meta.url));
let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };
const near = (actual, expected, tolerance, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${message}: ${actual} / ${expected}`);
const plainSpaces = text => text.replace(/[  ]/g, ' ');

// Независимые значения из Визуальной спецификации: 120 строк, 506 745 кг, 146 441 400,87 руб.
const SPEC = {
  rows: [3, 15, 3, 6, 93],
  volumeKg: [3210, 15900, 1380, 1380, 484875],
  priceRubKg: [390.4052, 357.7187, 338.6759, 304.5454, 285.8733],
  shareOfVolumePct: [0.6335, 3.1377, 0.2723, 0.2723, 95.6842],
  bounds: [[375, 400], [350, 375], [325, 350], [300, 325], [275, 300]],
  totalRows: 120,
  totalKg: 506745,
  totalRevenueRub: 146441400.87,
  avgRubKg: 288.98,
};

// Синтетические строки: объем и выручка каждого диапазона совпадают с агрегатами, но строк меньше не делается.
const agg = FILLET_HISTORY_APRIL_2026.aggregates;
check(agg.map(a => a.rows).join() === SPEC.rows.join(), 'Агрегаты: количество строк по диапазонам');
check(agg.map(a => a.volumeKg).join() === SPEC.volumeKg.join(), 'Агрегаты: объемы диапазонов');
check(agg.map(a => [a.fromRubKg, a.toRubKg]).every(([from, to], i) => from === SPEC.bounds[i][0] && to === SPEC.bounds[i][1]), 'Агрегаты: границы диапазонов по 25 руб. / кг');
const rows = agg.flatMap(item => {
  const qtyKg = item.volumeKg / item.rows, priceRubKg = item.revenueRub / item.volumeKg;
  return Array.from({length: item.rows}, () => ({productId: 'fillet', period: '2026-04', priceRubKg, qtyKg}));
});
check(rows.length === SPEC.totalRows, 'Синтетическая история: 120 строк');

const steps = buildPriceSteps(rows);
check(steps.length === 5, 'Пять ступеней цены');
check(steps.map(s => [s.fromRubKg, s.toRubKg]).every(([from, to], i) => from === SPEC.bounds[i][0] && to === SPEC.bounds[i][1]), 'Ступени идут от высокой цены к низкой');
steps.forEach((s, i) => {
  check(s.rows === SPEC.rows[i], `Ступень ${i}: строки`);
  near(s.volumeKg, SPEC.volumeKg[i], 1e-6, `Ступень ${i}: объем`);
  near(s.weightedPriceRubKg, SPEC.priceRubKg[i], 5e-5, `Ступень ${i}: средневзвешенная цена`);
  near(s.shareOfVolumePct, SPEC.shareOfVolumePct[i], 5e-5, `Ступень ${i}: доля объема`);
});
const totalKg = steps.reduce((sum, s) => sum + s.volumeKg, 0);
const totalRevenue = steps.reduce((sum, s) => sum + s.revenueRub, 0);
near(totalKg, SPEC.totalKg, 1e-6, 'Итог: объем 506 745 кг');
near(totalRevenue, SPEC.totalRevenueRub, 0.005, 'Итог: выручка 146 441 400,87 руб.');
near(steps.at(-1).cumToKg, SPEC.totalKg, 1e-6, 'Накопленный объем заканчивается итогом');
check(steps.every((s, i) => i === 0 || Math.abs(s.cumFromKg - steps[i - 1].cumToKg) <= 1e-9), 'Накопленная позиция продолжает предыдущую ступень');

const summary = historySummary(rows);
check(summary.rows === SPEC.totalRows, 'Сводка: 120 строк');
near(summary.avgPriceRubKg, SPEC.avgRubKg, 0.005, 'Средняя историческая цена сделки');
check(Number(summary.avgPriceRubKg.toFixed(2)) === SPEC.avgRubKg, 'Средняя цена округляется до 288,98');
const dirty = historySummary([...rows, {productId: 'fillet', priceRubKg: 0, qtyKg: 10}, {productId: 'fillet', priceRubKg: 300, qtyKg: 0}, {productId: 'fillet', priceRubKg: -5, qtyKg: 3}]);
check(dirty.rows === SPEC.totalRows, 'Строки с нулевым объемом, ценой или выручкой не входят в расчет');
check(buildPriceSteps([{priceRubKg: 400, qtyKg: 10}])[0].fromRubKg === 400, 'Цена на границе относится к верхнему диапазону');

const fromAggregates = stepsFromAggregates(agg);
check(fromAggregates.length === steps.length, 'Агрегаты дают ту же длину ступеней');
fromAggregates.forEach((s, i) => {
  near(s.revenueRub, steps[i].revenueRub, 1e-6, `Агрегаты ${i}: выручка совпадает со строками`);
  near(s.cumFromKg, steps[i].cumFromKg, 1e-6, `Агрегаты ${i}: накопленная позиция начала совпадает`);
  near(s.cumToKg, steps[i].cumToKg, 1e-6, `Агрегаты ${i}: накопленная позиция конца совпадает`);
});

// Геометрия: поле 490 px дает 410 × 180; 533 px дает 453 × 298; ширина ступени равна объему в масштабе поля.
const g490 = priceChartGeometry(490, 240);
check(g490.plotWidth === 410 && g490.plotHeight === 180, 'Поле 490 px: область 410 × 180');
const g533 = priceChartGeometry(533, 358);
check(g533.plotWidth === 453 && g533.plotHeight === 298, 'Поле 533 px: область 453 × 298');
check(g490.left === 64 && g490.right === 16 && g490.top === 24 && g490.bottom === 36, 'Отступы поля: 64, 16, 24, 36');
const widths = steps.map(s => (s.cumToKg - s.cumFromKg) / SPEC.totalKg * g490.plotWidth);
near(Number(widths[0].toFixed(2)), 2.60, 1e-9, 'Узкая ступень 375–400: 2,60 px');
near(Number(widths[2].toFixed(2)), 1.12, 1e-9, 'Узкая ступень 325–350: 1,12 px');
near(widths.reduce((sum, w) => sum + w, 0), g490.plotWidth, 1e-6, 'Ширины ступеней заполняют область построения');

// Накопительный стакан: статьи подряд от нуля, итог начинается от нуля и совпадает с калькуляцией.
const filletFacts = COST_FACTS_APRIL_2026[0];
const stack = buildCostStack(filletFacts);
check(stack.map(s => s.label).join('|') === 'Сырье|Цех|Упаковка|Итог, руб. / кг выпуска', 'Стакан: подписи статей и итога');
near(stack[0].toRubKg, 117.3393655, 5e-8, 'Сырье: 117,3393655 руб. / кг');
near(stack[1].toRubKg, 137.3494342, 5e-8, 'Сырье и цех: накопление 137,3494342');
near(stack[2].toRubKg, 141.4867668, 5e-8, 'Накопление до упаковки: 141,4867668');
check(stack[3].total === true && stack[3].fromRubKg === 0, 'Итоговый столбец начинается от нуля');
near(stack[3].toRubKg, 141.4867668, 5e-8, 'Итог филе: 141,4867668 руб. / кг выпуска');
check(checkCostStack(filletFacts, stack).ok, 'Сумма статей совпадает с итогом калькуляции (филе)');
const bedroStack = buildCostStack(COST_FACTS_APRIL_2026[1]);
near(bedroStack[2].deltaRubKg, 4.59815054, 5e-8, 'Бедро: упаковка 4,59815054');
near(bedroStack[3].toRubKg, 141.9475848, 5e-8, 'Итог бедра: 141,9475848 руб. / кг');
check(checkCostStack(COST_FACTS_APRIL_2026[1], bedroStack).ok, 'Сумма статей совпадает с итогом калькуляции (бедро)');
check(!checkCostStack({...filletFacts, productionCostRubKg: 141.5}, stack).ok, 'Расхождение с итогом отмечается');
check(buildCostStack({articles: []}).length === 0, 'Пустые статьи дают пустой стакан');
// Приватность (PRIV-05): исторические данные не несут ссылок на лист, ячейку и хеш исходной книги.
const historicalJson = JSON.stringify({FILLET_HISTORY_APRIL_2026, COST_FACTS_APRIL_2026, stack, bedroStack});
check(!/sourceRef|totalSourceRef|sha256|sourceRefs/.test(historicalJson), 'Исторические данные: нет ключей ссылок на лист, ячейку и хеш книги');
check(!/![A-ZА-Яа-я]{1,3}\d+/.test(historicalJson), 'Исторические данные: нет адресов ячеек вида лист!A1');
check(typeof filletFacts.sourceLabel === 'string' && filletFacts.sourceLabel.length > 0 && stack.every(s => s.sourceLabel === filletFacts.sourceLabel), 'Ступени стакана несут текстовую метку источника');
check(COST_EXCLUDED_FROM_TOTAL.length === 3, 'Логистика и расходы вне итога перечислены');

// Разложение разницы фиксированным методом: сумма шагов равна разнице вариантов.
const model = s => s.volume * (s.price - s.cost) * s.yield - s.terms * s.volume;
const base = {volume: 100, price: 10, cost: 6, yield: 0.8, terms: 0.5};
const variant = {volume: 120, price: 11, cost: 6.5, yield: 0.85, terms: 0.4};
const factors = [
  {key: 'volume', label: 'Объем'}, {key: 'price', label: 'Цена'}, {key: 'cost', label: 'Затраты'},
  {key: 'yield', label: 'Выход'}, {key: 'terms', label: 'Коммерческие условия'},
];
const decomposed = decomposeDifference(base, variant, factors, model);
const stepSum = decomposed.steps.reduce((sum, step) => sum + step.delta, 0);
near(stepSum, decomposed.total, 1e-9, 'Сумма шагов равна разнице вариантов');
near(decomposed.total, model(variant) - model(base), 1e-9, 'Разница равна расчету варианта минус базы');
check(decomposed.steps.at(-1).label === 'Взаимодействия', 'Взаимодействия выделены отдельным шагом');
check(Math.abs(decomposed.steps.at(-1).delta) > 1e-6, 'Нелинейная модель дает ненулевые взаимодействия');
check(decomposed.steps.map(s => s.label).join() === 'Объем,Цена,Затраты,Выход,Коммерческие условия,Взаимодействия', 'Порядок факторов фиксирован');
check(decomposeDifference(base, base, factors, model).total === 0, 'Одинаковые варианты дают нулевую разницу');
let duplicateRejected = false;
try { decomposeDifference(base, variant, [{key: 'price', label: 'Цена'}, {key: 'price', label: 'Цена'}], model); } catch { duplicateRejected = true; }
check(duplicateRejected, 'Повторяющиеся ключи факторов отклоняются');

// Узлы цепочки: 13 узлов иллюстрации, 6 укрупненных, 17 переделов в операциях и 10 операций на подтверждение.
const expectedNames = ['Закупка сырья', 'Комбикормовый завод', 'Родительское стадо', 'Инкубатор', 'Выращивание бройлера', 'Убой и потрошение', 'Охлаждение и сортировка', 'Разделка и обвалка', 'Упаковка и маркировка', 'Глубокая переработка', 'Заморозка и склад', 'Продажи и отгрузка', 'Субпродукты и механическая обвалка'];
check(CHAIN_NODES.length === 13 && CHAIN_NODES.map(node => node.id).sort().join() === CHAIN_DETAIL.map(node => node.id).sort().join(), 'Текущие 13 узлов сохраняют идентификаторы');
check(CHAIN_DETAIL.length === 13 && CHAIN_DETAIL.map(node => node.name).join('|') === expectedNames.join('|'), 'Полная цепочка: 13 узлов с названиями иллюстрации');
check(CHAIN_MACRO.map(node => node.name).join('|') === 'Птица|Убой и охлаждение|Тушка / разделка|Упаковка|Холод|Отгрузка', 'Укрупненные узлы: шесть названий');
check(CHAIN_MACRO.map(node => node.icon).join() === 'bird,slaughter,cutting,packing,cold,truck', 'Укрупненные узлы: иконки дизайн-системы');
const covered = CHAIN_MACRO.flatMap(node => node.nodeIds).sort();
check(covered.join() === CHAIN_NODES.map(node => node.id).sort().join(), 'Каждый из 13 узлов входит в один укрупненный узел');
check(new Set(covered).size === covered.length, 'Узел не повторяется между укрупненными узлами');
check(CHAIN_DETAIL.every(node => CHAIN_MACRO.find(macro => macro.id === node.macroId)?.nodeIds.includes(node.id)), 'Подробность указывает на свой укрупненный узел');
const stageOps = CHAIN_DETAIL.flatMap(node => node.operations);
check(stageOps.length === 17, 'Переделы карты мощности: 17 операций');
check(stageOps.length + CHAIN_DETAIL_PENDING_OPERATIONS.count === 27, 'Всего 27 операций: 17 известных и 10 на подтверждение');
check(CHAIN_DETAIL_PENDING_OPERATIONS.status === 'Требуется подтверждение', 'Десять операций имеют статус «Требуется подтверждение»');
CHAIN_NODES.forEach(node => {
  const detail = CHAIN_DETAIL.find(item => item.id === node.id);
  check(detail.operations.map(op => op.id).join() === node.stages.join(), `${node.id}: операции совпадают с CHAIN_NODES`);
});
CHAIN_DETAIL.forEach(node => node.links.forEach(other => {
  const counterpart = CHAIN_DETAIL.find(item => item.id === other);
  check(counterpart?.links.includes(node.id), `Связь ${node.id} – ${other} симметрична`);
}));
check(stageOps.some(op => op.name === 'Упаковка ног') && !JSON.stringify(CHAIN_DETAIL).includes('Упаковка лап'), 'Подпись «Упаковка ног» сохраняется');

// Отрисовка компонентов в SSR: координаты, подписи, состояния и типографика.
// Буква с двумя точками находится через NFD: при разложении она дает U+0308, саму букву в тексте теста не пишем.
const typographyOk = html => !/[—·|•]/.test(html) && !/\u0308/.test(html.normalize('NFD')) && !html.includes('NaN') && !html.includes('undefined');
const server = await createServer({root, server: {middlewareMode: true}, appType: 'custom', logLevel: 'error', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const charts = await server.ssrLoadModule('/src/charts.jsx');
  const render = (element, label) => {
    const warnings = [], previous = console.error;
    let html;
    try {
      console.error = (...args) => warnings.push(args.map(String).join(' '));
      html = renderToStaticMarkup(element);
    } finally { console.error = previous; }
    check(warnings.length === 0, `${label}: предупреждения React ${warnings.join('; ')}`);
    check(typographyOk(html), `${label}: типографика без запрещенных знаков и без буквы с двумя точками`);
    return plainSpaces(html);
  };

  const cost = buildCostStack(filletFacts);
  const priceHtml = render(React.createElement(charts.PriceStepChart, {steps, cost}), 'Стакан цены и себестоимости');
  check(priceHtml.includes('viewBox="0 0 718 240"'), 'Стакан: эталон hero.svg 718 × 240');
  check(priceHtml.includes('Объем, кг. Источник: агрегаты продаж филе, апрель 2026'), 'Стакан: подпись оси объема как в hero.svg');
  check(priceHtml.includes('@media (prefers-reduced-motion: no-preference)') && priceHtml.includes('360ms cubic-bezier(0.2, 0.7, 0.2, 1)') && priceHtml.includes('@media print'), 'Стакан: вход 360 мс только при допустимом движении, печать без анимации');
  check(priceHtml.includes('animation-delay:60ms') && priceHtml.includes('animation-delay:240ms'), 'Стакан: сдвиг 60 мс на ступень');
  // Эталон hero.svg: x, y, ширина и высота каждой ступени и каждого столбца себестоимости (две десятичные, допуск 0,011 px).
  const heroSteps = [[50, 47.84, 2.56, 156.16], [52.56, 60.91, 12.68, 143.09], [65.24, 68.53, 1.10, 135.47], [66.34, 82.18, 1.10, 121.82], [67.44, 89.65, 386.56, 114.35]];
  const stepRects = [...priceHtml.matchAll(/<rect class="step" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9A-F]{6})"/g)].map(m => ({x: +m[1], y: +m[2], width: +m[3], height: +m[4], fill: m[5]}));
  check(stepRects.length === 5, 'Стакан: пять ступеней');
  heroSteps.forEach(([x, y, w, h], i) => {
    near(stepRects[i].x, x, 0.011, `Ступень ${i + 1}: x по hero.svg`);
    near(stepRects[i].y, y, 0.011, `Ступень ${i + 1}: y по hero.svg`);
    near(stepRects[i].width, w, 0.011, `Ступень ${i + 1}: ширина по hero.svg`);
    near(stepRects[i].height, h, 0.011, `Ступень ${i + 1}: высота по hero.svg`);
  });
  near(stepRects.reduce((sum, r) => sum + r.width, 0), 404, 0.011, 'Стакан: ступени заполняют ось объема 404 px');
  check(stepRects.map(r => r.fill).join() === '#6E8CA8,#6E8CA8,#6E8CA8,#6E8CA8,#003C72', 'Стакан: ступень 275–300 руб./кг окрашена #003C72, остальные #6E8CA8');
  const costRects = [...priceHtml.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="28" height="([\d.]+)" fill="(#[0-9A-F]{6})"/g)].map(m => ({x: +m[1], y: +m[2], height: +m[3], fill: m[4]}));
  const heroCost = [[516, 157.06, 46.94], [568, 149.06, 8.00], [620, 147.40, 1.66], [672, 147.40, 56.60]];
  check(costRects.length === 4, 'Стакан себестоимости: четыре столбца');
  heroCost.forEach(([x, y, h], i) => {
    near(costRects[i].x, x, 0.011, `Столбец ${i + 1}: x по hero.svg`);
    near(costRects[i].y, y, 0.011, `Столбец ${i + 1}: y по hero.svg`);
    near(costRects[i].height, h, 0.011, `Столбец ${i + 1}: высота по hero.svg`);
  });
  check(costRects[3].fill === '#003C72' && costRects.slice(0, 3).every(r => r.fill === '#6E8CA8'), 'Стакан себестоимости: итог #003C72, статьи #6E8CA8');
  check(['117,34', '+20,01', '+4,14', '141,49'].every(v => priceHtml.includes(`>${v}</text>`)), 'Стакан себестоимости: подписи 117,34, +20,01, +4,14, итог 141,49');
  check(priceHtml.includes('Сырье дает 83% себестоимости') && priceHtml.includes('Себестоимость филе 141,49 руб./кг'), 'Стакан себестоимости: доля сырья 83% и итог');
  check((priceHtml.match(/<tspan font-weight="700">/g) || []).length === 4, 'Выноски: четыре малые ступени');
  check(['390,41 руб./кг', '357,72 руб./кг', '338,68 руб./кг', '304,55 руб./кг', '3 210 кг', '15 900 кг', '1 380 кг'].every(t => priceHtml.includes(t)), 'Выноски: цена с двумя знаками и объем в кг');
  check(['Итог: 506 745 кг', 'Средняя 288,98 руб./кг', '>96%</text>', '484 875 кг по диапазону 275–300 руб./кг', 'средняя 285,87 руб./кг'].every(t => priceHtml.includes(t)), 'Стакан: итоги, число 96% и подпись главной ступени');
  check(['0', '100 000', '200 000', '300 000', '400 000', '500 000'].every(t => priceHtml.includes(`>${t}</text>`)) && priceHtml.includes('>руб./кг</text>'), 'Стакан: оси объема и цены с подписями');
  check(!/font-size="(8|9|10|11)"/.test(priceHtml), 'Подписи стакана не меньше 12 px');
  const emptyPrice = render(React.createElement(charts.PriceStepChart, {productName: 'Филе', periodLabel: 'Апрель 2026', steps: []}), 'Ступени без данных');
  check(emptyPrice.includes('Нет данных') && !emptyPrice.includes('<svg'), 'Без данных ступени показывают «Нет данных»');

  const costHtml = render(React.createElement(charts.CostStackChart, {productName: 'Филе грудки без кожи ц/б', periodLabel: 'Апрель 2026', steps: stack, excluded: COST_EXCLUDED_FROM_TOTAL, check: checkCostStack(filletFacts, stack)}), 'Стакан себестоимости');
  check(costHtml.includes('>+117,34<') && costHtml.includes('>+20,01<') && costHtml.includes('>+4,14<') && costHtml.includes('>141,49<'), 'Стакан: подписи с двумя знаками после запятой');
  check(costHtml.includes('Сумма статей совпадает с итогом калькуляции'), 'Стакан: сверка с итогом калькуляции');
  check(costHtml.includes('Вне итога: Логистика, Коммерческие расходы, Общехозяйственные расходы. Статус: Требуется подтверждение'), 'Стакан: статьи вне итога с состоянием');
  check(costHtml.includes('Историческое распределение затрат по переделам'), 'Стакан: подпись распределения затрат');

  const bridgeHtml = render(React.createElement(charts.CumulativeBridge, {productName: 'Филе грудки без кожи ц/б', periodLabel: 'Апрель 2026', costSteps: stack, excluded: COST_EXCLUDED_FROM_TOTAL}), 'Денежный мост: режим по умолчанию');
  check(/aria-pressed="true"[^>]*>Производственная стоимость/.test(bridgeHtml) || />Производственная стоимость<\/button>/.test(bridgeHtml), 'Режим «Производственная стоимость» выбран по умолчанию');
  check(bridgeHtml.includes('Производственная стоимость, руб. / кг выпуска'), 'Режим производственной стоимости показывает свой заголовок');
  const scenarioHtml = render(React.createElement(charts.CumulativeBridge, {productName: 'Филе грудки без кожи ц/б', periodLabel: 'Апрель 2026', costSteps: stack, initialMode: 'scenario', scenario: null}), 'Денежный мост: сценарий без данных');
  check(scenarioHtml.includes('Мост сценарного вклада') && scenarioHtml.includes('Нет данных'), 'Сценарный мост без данных показывает статус');

  const decompositionHtml = render(React.createElement(charts.DecompositionBridge, {baseLabel: 'Вариант А', variantLabel: 'Вариант Б', decomposition: {...decomposed, base: 1000000, variant: 1000000 + decomposed.total}}), 'Разбор разницы');
  check(decompositionHtml.includes('Сумма шагов равна разнице'), 'Разбор разницы: сумма шагов проверяется');
  check(decompositionHtml.includes('Взаимодействия'), 'Разбор разницы: взаимодействия показаны отдельно');
  const brokenHtml = render(React.createElement(charts.DecompositionBridge, {decomposition: {base: 1, variant: 5, total: 4, steps: [{label: 'Цена', delta: 1}]}}), 'Разбор разницы с расхождением');
  check(brokenHtml.includes('Требуется подтверждение: сумма шагов расходится с разницей'), 'Расхождение суммы шагов отмечается');

  const resourceRows = Array.from({length: 17}, (_, i) => ({id: `r${i}`, name: `Ресурс ${i + 1}`, utilization: i === 16 ? null : 0.5 + i * 0.05, beforeUtilization: 0.4 + i * 0.03}));
  const resourceHtml = render(React.createElement(charts.ResourceScale, {rows: resourceRows}), 'Загрузка ресурсов');
  check((resourceHtml.match(/class="resource-row/g) || []).length === 17, 'Шкала: 17 ресурсов на одной шкале');
  check(resourceHtml.includes('Требуется значение') && resourceHtml.includes('Вертикальная линия отмечает 100% мощности'), 'Шкала: открытое значение и линия 100%');
  check(resourceHtml.includes('перегрузка') === resourceRows.some(r => r.utilization > 1), 'Шкала: перегрузка отмечена текстом');
  const flowHtml = render(React.createElement(charts.MoneyBridge, {result: {revenue: 1000, rawCost: 400, routeCost: 100, serviceCost: 0, freezeCost: 0, contribution: 500}}), 'Существующий мост вклада');
  check(flowHtml.includes('Вклад недели'), 'Существующий экспорт MoneyBridge сохраняет подписи');
  const icons = await server.ssrLoadModule('/src/icons/index.jsx');
  check(Object.keys(icons.NODE_ICON_SVG).join() === 'bird,slaughter,cutting,packing,cold,truck' && Object.values(icons.NODE_ICON_SVG).every(svg => svg.startsWith('<svg')), 'Иконки: шесть SVG импортированы через ?raw');
  const iconHtml = render(React.createElement(icons.NodeIcon, {name: 'cold', size: 56}), 'Иконка узла');
  check(iconHtml.includes('width="56" height="56"') && !iconHtml.includes('width="96"') && iconHtml.includes('stroke="currentColor"') && iconHtml.includes('aria-hidden="true"'), 'Иконка узла: 56 px, обводка currentColor, исходные размеры 96 убраны');
  console.log(`Проверено: ${checks} проверок`);
} finally {
  await server.close();
}
console.log(`Готово: ${checks} проверок, история 120 строк, стакан 2 статьи, цепочка 13 узлов, 6 укрупненных, 17 + 10 операций`);
