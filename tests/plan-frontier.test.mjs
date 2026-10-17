import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Запуск из каталога platform: node tests/plan-frontier.test.mjs
// Все входы синтетические. Тест читает только model.js.
const context = {module:{exports:{}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports;
const EPS = 1e-6;
let checks = 0;
const check = (condition, message) => {checks++; assert.ok(condition, message);};
const near = (actual, expected, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)), `${message}: ${actual} / ${expected}`);
const nearRub = (actual, expected, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-3, `${message}: ${actual} / ${expected}`);

const KG = M.planConfig.scaleWeekKg; // масштаб недели: 4 009 615 кг = 208,5 млн кг в год (продажа май 2025 – апрель 2026), берется из planConfig
const orderRow = (id, product, orderClass, qtyKg, priceRubKg, extra = {}) => ({id, product, orderClass, qtyKg, priceRubKg, orderDate: '2026-10-18', ...extra});
// Неделя Вс–Пт, 18–23 октября 2026. Цены заморозки совпадают с defaults() из model.js.
const week = (extra = {}) => ({
  inputKg: KG, routeCode: 'fillet', capacityWeekT: 4000, costMethod: 'spec', rawCostRubKg: 140, // сырье задано явно
  freezePriceRubKg: {whole: 140, fillet: 220, legs: 145, wing: 135, frame: 20},
  orders: [
    orderRow('w1', 'whole', 'confirmed', 2400000, 170),
    orderRow('f1', 'fillet', 'confirmed', 500000, 300),
    orderRow('l1', 'legs', 'confirmed', 100000, 190),
    orderRow('g1', 'wing', 'confirmed', 50000, 180),
    orderRow('k1', 'frame', 'confirmed', 20000, 40)
  ],
  ...extra
});

// 1. Сумма ступеней равна выручке по аллокации
for (const id of ['whole', 'fillet', 'legs', 'wing', 'frame']) {
  const s = M.buildStakan(week(), 1600, id);
  nearRub(s.stepsRevenueRub, s.revenueRub, 'Сумма ступеней равна выручке по аллокации, ' + id);
}

// 2. Порядок: класс по возрастанию, затем цена по убыванию (V = 100 т, филе 32 000 кг)
const order = M.buildStakan(week({orders: [
  orderRow('x1', 'fillet', 'extra', 50000, 300),
  orderRow('c1', 'fillet', 'confirmed', 20000, 250),
  orderRow('c2', 'fillet', 'confirmed', 10000, 280),
  orderRow('f2', 'fillet', 'forecast', 30000, 290, {probability: 1})
]}), 100, 'fillet');
const dist = Object.fromEntries(order.steps.map(s => [s.id, s.distributedKg]));
near(dist.c2, 10000, 'Подтвержденный заказ с ценой 280 получает объем первым');
near(dist.c1, 20000, 'Подтвержденный заказ с ценой 250 получает остаток объема');
near(dist.f2, 2000, 'Прогноз получает объем после подтвержденных заказов');
near(dist.x1, 0, 'Дополнительный спрос при исчерпанной разделке получает 0 кг, хотя цена выше');

// 3. Класс 3 не проходит при цене ниже заморозки f_j (f_филе = 220)
const extraRows = M.buildStakan(week({orders: [
  orderRow('lo', 'fillet', 'extra', 50000, 200),
  orderRow('hi', 'fillet', 'extra', 50000, 230)
]}), 1600, 'fillet');
const extraDist = Object.fromEntries(extraRows.steps.map(s => [s.id, s]));
near(extraDist.lo.distributedKg, 0, 'Класс 3 при цене 200 ниже заморозки 220 получает 0 кг распределения');
near(extraDist.lo.hatchedKg, 50000, 'Нераспределенная ступень класса 3 штрихуется полным объемом');
near(extraDist.hi.distributedKg, 50000, 'Класс 3 при цене 230 от заморозки и выше распределяется');

// 4. Остаток уходит в заморозку по f_j (V = 1600 т, филе 512 000 кг, заказ 500 000 кг)
const frozen = M.buildStakan(week(), 1600, 'fillet');
near(frozen.frozen.volumeKg, 12000, 'Остаток равен выпуску минус распределенный объем');
near(frozen.frozen.priceRubKg, 220, 'Остаток оценивается по цене заморозки f_j');
nearRub(frozen.frozen.areaRub, 12000 * 220, 'Площадь заморозки равна остатку, умноженному на f_j');

// 5. Нулевые заказы: весь выпуск в заморозку
const none = week({orders: []});
const noOrders = M.buildStakan(none, 1600, 'fillet');
check(noOrders.steps.length === 0, 'При отсутствии заказов ступеней спроса нет');
near(noOrders.frozen.volumeKg, 512000, 'При отсутствии заказов весь выпуск уходит в заморозку');
nearRub(noOrders.K, 512000 * (220 - (140 + 20.3) / 0.32), 'При отсутствии заказов K равен выпуску, умноженному на f_j минус c_j');
check(M.buildFrontier(none).notes.includes('Нет заказов, весь выпуск в заморозке'), 'Фронтир выводит текст про отсутствие заказов');

// 6. Ничья дает меньший V: при f_j, равном c_j, все K равны нулю
// Признак rawInRate по умолчанию false: сырье 140 добавляется к учебной ставке 8 руб. / кг, c_тушки = 148 руб. / кг.
const tie = week({costMethod: 'spec', orders: [], freezePriceRubKg: {
  whole: 148, fillet: (140 + 20.3) / 0.32, legs: (140 + 20.3) / 0.35, wing: (140 + 20.3) / 0.11, frame: (140 + 20.3) / 0.2
}});
near(M.unitCostRegister(tie, 'whole'), 148, 'Ставка тушки без признака rawInRate равна цене заморозки в ничьей: 140 + 8');
const tieFrontier = M.buildFrontier(tie);
check(tieFrontier.points.length > 1 && tieFrontier.points.every(p => Math.abs(p.K) < EPS), 'При f_j, равном c_j, все K равны нулю');
check(tieFrontier.optimum.V === 0, 'При ничьей оптимум указывает на меньший объем разделки');

// 7. Фильтр доминирования совпадает с полным перебором
const dominates = (q, p) => q.K >= p.K - EPS && q.R <= p.R + EPS
  && (q.K > p.K + EPS || q.R < p.R - EPS || (q.V < p.V && Math.abs(q.K - p.K) <= EPS && Math.abs(q.R - p.R) <= EPS));
const bruteSet = points => points.filter(p => !points.some(q => q !== p && dominates(q, p))).map(p => p.V).sort((a, b) => a - b);
const fastSet = points => M.efficientPoints(points).map(p => p.V).sort((a, b) => a - b);
let seed = 7; // детерминированный генератор: синтетический контрольный набор с ничьими по K и R
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const control = Array.from({length: 300}, (_, i) => ({V: i, K: Math.floor(rnd() * 40), R: Math.floor(rnd() * 40)}));
const controlBrute = bruteSet(control);
check(JSON.stringify(fastSet(control)) === JSON.stringify(controlBrute), 'Фильтр совпадает с полным перебором на синтетическом наборе');
check(controlBrute.length > 0 && controlBrute.length < control.length, 'Синтетический набор содержит и эффективные, и доминируемые точки');
const weekFrontier = M.buildFrontier(week({costMethod: 'weight', capacityWeekT: 300})).points;
check(JSON.stringify(fastSet(weekFrontier)) === JSON.stringify(bruteSet(weekFrontier)), 'Фильтр совпадает с полным перебором на фронтире недели');

// 8. Паритет с model.js (весовая методика) и инвариант K(V*) не меньше вариантов
const T = 4000; // т
const modelOrders = {whole: 4000, fillet: 500, legs: 100, wing: 50, frame: 20, breast: 0, legMeat: 0, legBone: 0, legSkin: 0};
const modelInput = {...M.defaults(), totalInput: T, route: 'fillet', cut: 1600, capacity: 1e9, hours: 1e9, rate: 1, coldCapacity: 1e9, freezeCost: 0, orders: modelOrders, demand: {...modelOrders}};
const alt = M.alternatives(modelInput);
const parity = week({inputKg: T * 1000, costMethod: 'weight', minWholeKg: 50000, orders: [
  orderRow('w', 'whole', 'confirmed', 4000000, 170),
  orderRow('f', 'fillet', 'confirmed', 500000, 300),
  orderRow('l', 'legs', 'confirmed', 100000, 190),
  orderRow('g', 'wing', 'confirmed', 50000, 180),
  orderRow('k', 'frame', 'confirmed', 20000, 40)
]});
const parityFrontier = M.buildFrontier(parity);
const variantNames = ['30%', '40%', '50%'];
alt.candidates.forEach((c, i) => {
  check(c.result.valid, 'Вариант model.js корректен: ' + variantNames[i]);
  nearRub(parityFrontier.variants[variantNames[i]].K, c.result.expectedContribution, 'K совпадает с model.js: ' + variantNames[i]);
});
nearRub(parityFrontier.variants['40%'].K, alt.baseline.result.expectedContribution, 'База model.js (филе, 40 %) совпадает с вариантом 40 % на маршруте филе');
check(parityFrontier.invariant.holds, 'K(V*) не меньше лучшего варианта');
check(parityFrontier.optimum.K >= Math.max(...alt.candidates.map(c => c.result.expectedContribution)) - 1e-3, 'K(V*) не меньше вариантов model.js');

// 9. Предохранитель масштаба: вход ниже предела выводит предупреждение, граница и стакан считаются
const small = M.buildFrontier(week({inputKg: 100000}));
check(small.guard.blocked === true, 'При 100 т в неделю предохранитель масштаба срабатывает');
check(small.status.level === 'warn' && small.status.word === 'Внимание' && small.status.reason === 'Масштаб недели ниже ожидаемого', 'При 100 т граница помечена предупреждением о масштабе');
check(small.points.length > 0 && small.efficient.length > 0 && small.optimum !== null, 'При 100 т граница считается: есть точки, эффективные точки и оптимум');
const smallStakan = M.buildStakan(week({inputKg: 100000}), 10, 'fillet');
check(smallStakan.blocked === true && smallStakan.status.level === 'warn', 'Стакан при 100 т помечен предупреждением о масштабе');
check(smallStakan.lines !== null && smallStakan.steps.length > 0, 'Стакан при 100 т считается: есть ступени и линии себестоимости');
const half = M.planConfig.scaleWeekKg * M.planConfig.scaleGuardShare;
check(!M.scaleGuard(week({inputKg: half})).blocked, 'Вход ровно 0,5 × масштаба проходит без предупреждения');
check(M.scaleGuard(week({inputKg: half - 1})).blocked, 'Вход ниже 0,5 × масштаба помечается предупреждением');
check(M.planConfig.scaleWeekKg === 4009615, 'Масштаб недели 4 009 615 кг (208,5 млн кг в год) по решению заказчика');
check(M.planConfig.minCutT === null, 'Минимальная партия не выдумана: значение пусто до подтверждения');

// 10. Статусы: порядок проверки и граничные значения
check(M.planStatus('execution', .96).symbol === '●', 'Выполнение 96 % – норма');
check(M.planStatus('execution', .95).symbol === '●', 'Граница 95 % относится к норме');
check(M.planStatus('execution', .9).symbol === '▲', 'Выполнение 90 % – внимание');
check(M.planStatus('execution', .8).symbol === '■', 'Выполнение 80 % – риск');
check(M.planStatus('freezeShare', .15).symbol === '●', 'Граница заморозки 15 % относится к норме');
check(M.planStatus('freezeShare', .25).symbol === '▲', 'Граница заморозки 25 % относится к вниманию');
check(M.planStatus('freezeShare', .3).symbol === '■', 'Заморозка выше 25 % – риск');
check(M.planStatus('gapToIdeal', .01).symbol === '●', 'Направление «ниже» для разрыва: 1 % – норма');
for (const value of [null, undefined, NaN]) {
  const s = M.planStatus('execution', value);
  check(s.symbol === '○' && s.word === 'Нет данных' && s.symbol !== '●', 'Пустое значение дает статус «Нет данных», норма исключена');
}
check(M.planStatus('неизвестный порог', .5).symbol === '○', 'Порог вне конфига дает нет данных');

// 11. Пустая цена: статус «Нет данных», не ноль
const noPrice = week({freezePriceRubKg: {whole: 140, legs: 145, wing: 135, frame: 20}});
const noPriceFrontier = M.buildFrontier(noPrice);
check(noPriceFrontier.status.symbol === '○' && noPriceFrontier.status.word === 'Нет данных', 'Пустая цена заморозки дает статус «Нет данных»');
check(noPriceFrontier.points.length === 0 && noPriceFrontier.optimum === null, 'При пустой цене K не считается и оптимума нет');
check(M.buildStakan(noPrice, 1600, 'fillet').status.symbol === '○', 'Стакан при пустой цене заморозки показывает нет данных');
const noOrderPrice = week({orders: [...week().orders, orderRow('bad', 'fillet', 'confirmed', 10000, null)]});
check(M.buildFrontier(noOrderPrice).status.symbol === '○', 'Заказ с пустой ценой дает статус «Нет данных»');

// 12. Граничные случаи фронтира
const gapped = M.buildFrontier(week({minCutT: 100}));
check(gapped.points.every(p => p.V === 0 || p.V >= 100 - EPS), 'Разрыв: точки между 0 и V_min исключены, интерполяции нет');
check(gapped.gap && gapped.gap.toT === 100, 'Разрыв выводится меткой с верхней границей 100 т');
const capped = M.buildFrontier(week({capacityWeekT: 300}));
near(capped.cap.V, 300, 'Предел мощности совпадает с верхней точкой фронтира');
near(Math.max(...capped.points.map(p => p.V)), 300, 'Фронтир обрывается на пределе мощности');
check(capped.cap.label === 'Предел мощности', 'Обрыв фронтира подписан меткой «Предел мощности»');
const flagged = M.buildFrontier(week({capacityWeekT: 60, costMethod: 'weight'}));
check(flagged.points.every(p => p.flag === (p.V > 40)), 'Флаг регламента стоит у точек выше 40 т');
check(flagged.optimum.V === 60 && flagged.optimum.flag, 'Оптимум выше 40 т получает флаг');
check(flagged.notes.includes('Нужно решение о разделке') && flagged.status.level === 'risk', 'Оптимум выше 40 т выводит «Нужно решение о разделке» со статусом риск');
const negative = M.buildFrontier(week({rawCostRubKg: 400}));
check(negative.status.level === 'risk' && negative.status.reason.includes('Все K < 0'), 'Все K < 0 дают статус «Риск»');
check(M.buildFrontier(week({costMethod: 'weight'})).unconfirmed.every(s => s.startsWith('Требуется подтверждение')), 'Открытые параметры помечены «Требуется подтверждение»');

// 13. Себестоимость: спецформула и весовая методика
const cutCost = 1600000 * (140 + 20.3);
const wholeCost = (KG - 1600000) * 148;
const sumCost = method => ['whole', 'fillet', 'legs', 'wing', 'frame'].reduce((sum, id) => {
  const s = M.buildStakan(week({costMethod: method}), 1600, id);
  return sum + s.supplyKg * s.lines.costRubKg;
}, 0);
nearRub(sumCost('weight'), cutCost + wholeCost, 'Весовая методика сохраняет затраты разделки');
nearRub(sumCost(undefined), cutCost + wholeCost, 'Без поля costMethod действует весовая методика по умолчанию');
check(M.planConfig.costMethod === 'weight', 'Значение по умолчанию costMethod: весовая методика');
nearRub(sumCost('spec'), 4 * cutCost + wholeCost, 'Спецформула начисляет затраты разделки по каждому из четырех продуктов маршрута');
near(M.buildStakan(week(), 1600, 'fillet').lines.costRubKg, (140 + 20.3) / 0.32, 'Спецформула: c_j = (140 + h_j) / y_j');


// 14. Контракт недели: источник расчета, подстановка и статус «Нет данных» для пустых значений
const contract = {schemaVersion: 1, source: 'aggregates', rawCostRubKg: 140,
  products: {fillet: {listPriceRubKg: 300}},
  routes: {whole: {yields: {}, variableCostRubKg: 8}, fillet: {yields: {fillet: .32, legs: .35, wing: .11, frame: .20}, variableCostRubKg: 20.3}}};
const training = M.buildFrontier(week());
check(training.source === 'training' && M.buildStakan(week(), 1600, 'fillet').source === 'training', 'Источник расчета: training, если контракт не передан');
const fromContract = M.buildFrontier(week(), contract);
check(fromContract.source === 'aggregates', 'С контрактом источник расчета: aggregates');
near(fromContract.optimum.V, training.optimum.V, 'Контракт с теми же значениями дает тот же оптимум');
nearRub(fromContract.optimum.K, training.optimum.K, 'Контракт с теми же значениями дает тот же K(V*)');
const withRoute = (route, patch) => ({...contract, routes: {...contract.routes, [route]: {...contract.routes[route], ...patch}}});
const noVariable = M.buildFrontier(week(), withRoute('fillet', {variableCostRubKg: null}));
check(noVariable.status.symbol === '○' && noVariable.status.reason === 'Нет данных: переменные затраты маршрута «Филе и ножки»', 'Пустые переменные затраты маршрута дают статус «Нет данных»');
check(noVariable.points.length === 0 && noVariable.optimum === null, 'При пустых затратах фронтир пуст');
const badShare = M.buildFrontier(week(), withRoute('fillet', {yields: {fillet: 32, legs: .35, wing: .11, frame: .20}}));
check(badShare.status.reason === 'Нет данных: выход «Филе грудки» по маршруту «Филе и ножки»', 'Выход 32 при норме 0,32 дает статус «Нет данных»');
check(M.buildFrontier(week(), {...contract, rawCostRubKg: null}).status.reason === 'Нет данных: цена сырья', 'Пустое сырье в контракте дает статус «Нет данных»');
check(M.buildFrontier(week({rawCostRubKg: undefined})).status.reason === 'Нет данных: цена сырья', 'Неделя с пустым сырьем дает статус «Нет данных»');
check(M.buildFrontier(week(), {...contract, schemaVersion: 2}).status.symbol === '○', 'Версия контракта 2 дает статус «Нет данных»');
const priceless = week({orders: [...week().orders, orderRow('np', 'fillet', 'extra', 10000, undefined)]});
const filled = M.buildStakan(priceless, 1600, 'fillet', contract);
check(filled.source === 'aggregates' && filled.steps.some(s => s.id === 'np' && s.priceRubKg === 300), 'Цена списка подставляется в строку заказа с пустой ценой');
check(M.buildStakan(priceless, 1600, 'fillet').status.symbol === '○', 'Строка заказа с пустой ценой дает статус «Нет данных» в учебном расчете');
check(M.planConfig.scaleWeekKg === 4009615, 'Масштаб недели в planConfig: 4 009 615 кг');

// Экспорты
for (const name of ['evaluate', 'alternatives', 'buildFrontier', 'buildStakan', 'planStatus', 'scaleGuard', 'efficientPoints']) {
  check(typeof M[name] === 'function', 'Экспорт доступен: ' + name);
}

console.log(`Фронтир плана: ${checks} проверок пройдены`);
