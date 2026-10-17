import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ORDER_CLASSES, WEEK_KEY, addScenario, getScenario, loadWeek, validateOrderRow} from '../src/store/weekStore.js';
import {
  canSaveVariant, demandFromRows, loadStatus, modelWeek, planFromRows, ratesFrom, scaleWarningText, unconfirmedOf, variantResult, variantSnapshot,
} from '../src/model-bridge.js';
import {restoreInputs, variantHashOk} from '../src/scenarios-local.js';

// Запуск из каталога platform: node tests/plan-from-orders.test.mjs
// Все строки синтетические: клиенты указаны только кодами К-NNN, фамилий, телефонов и адресов нет. Модель читается из model.js.
const context = {module: {exports: {}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports;
const [CONFIRMED, FORECAST, EXTRA] = ORDER_CLASSES;
const ids = Object.keys(M.products);
const WEEK_START = '2026-10-19';
let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };
const near = (actual, expected, message, eps = 1e-6) => {
  checks++;
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${message}: получено ${actual}, ожидалось ${expected}`);
};

let seq = 0;
const row = over => ({
  key: `r-${++seq}`, clientCode: 'К-001', product: 'fillet', day: WEEK_START, zone: 'Север', channel: 'Опт',
  volumeKg: 1000, priceRubKg: 300, orderClass: CONFIRMED, probability: undefined, note: 'Синтетическая строка', ...over,
});
// Подтвержденное филе 20 т по 300, прогноз 10 т с вероятностью 0,5 по 280, дополнительно 8 т по 260 (вне расчета),
// подтвержденные ножки 5 т по 190, подтвержденная тушка 3 т по 170.
const ROWS = [
  row({clientCode: 'К-001', product: 'fillet', volumeKg: 20000, priceRubKg: 300, orderClass: CONFIRMED}),
  row({clientCode: 'К-002', product: 'fillet', volumeKg: 10000, priceRubKg: 280, orderClass: FORECAST, probability: 0.5}),
  row({clientCode: 'К-003', product: 'fillet', volumeKg: 8000, priceRubKg: 260, orderClass: EXTRA}),
  row({clientCode: 'К-001', product: 'legs', volumeKg: 5000, priceRubKg: 190, orderClass: CONFIRMED}),
  row({clientCode: 'К-004', product: 'whole', volumeKg: 3000, priceRubKg: 170, orderClass: CONFIRMED}),
];
const memoryStorage = () => {
  const data = new Map();
  return {getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value))};
};

const p = {...M.defaults(), totalInput: 100};
const rates = ratesFrom({p, week: null, M});

// Спрос: подтвержденные, прогноз с вероятностью и дополнительный спрос раздельно.
const demand = demandFromRows(ROWS, ids);
near(demand.products.fillet.confirmedT, 20, 'Подтвержденный спрос филе, т');
near(demand.products.fillet.forecastT, 5, 'Прогноз филе с вероятностью 0,5, т');
near(demand.products.fillet.forecastRawT, 10, 'Прогноз филе без вероятности, т');
near(demand.products.fillet.extraT, 8, 'Дополнительный спрос филе отдельно, т');
near(demand.products.fillet.priceRubKg, 296, 'Средняя цена филе по расчетным строкам, руб./кг');
check(demandFromRows([], ids).excluded.length === 0, 'Без строк спрос пустой и ошибок нет');
check(Object.values(demandFromRows([], ids).products).every(item => item.confirmedT === 0 && item.forecastT === 0), 'Без строк все товары с нулевым спросом');

// Расчет по модели: выручка продажи, сырье один раз, переделы, заморозка и вклад.
const plan = planFromRows({rows: ROWS, M, routeCode: 'fillet', cutT: 40, rates});
check(plan.valid === true, 'Расчет недели выполняется по строкам');
const fillet = plan.products.find(item => item.id === 'fillet');
near(fillet.revenueRub, 12.8 * 296 * 1000, 'Выручка филе: продано 12,8 т по средней цене 296 руб./кг');
near(plan.products.find(item => item.id === 'legs').revenueRub, 5 * 190 * 1000, 'Выручка ножек: подтвержденные 5 т по 190 руб./кг');
near(plan.products.find(item => item.id === 'whole').revenueRub, 3 * 170 * 1000, 'Выручка тушки: подтвержденные 3 т по 170 руб./кг');
near(plan.revenue, 12.8 * 296 * 1000 + 5 * 190 * 1000 + 3 * 170 * 1000, 'Выручка недели по трем товарам');
near(plan.rawCost, 100 * 140 * 1000, 'Сырье учтено один раз на весь вход 100 т по 140 руб./кг');
near(plan.routeCost, (60 * 8 + 40 * 20.3) * 1000, 'Переделы: тушка 60 т по 8 руб./кг и разделка 40 т по 20,3 руб./кг');
check(plan.freezeCost > 0, 'Затраты заморозки есть при остатке на складе');
near(plan.freezeCost, plan.inventoryT * 10 * 1000, 'Затраты заморозки равны остатку по ставке заморозки');
near(plan.contribution, plan.revenue - plan.serviceCost - plan.rawCost - plan.routeCost - plan.freezeCost, 'Вклад равен выручке без обслуживания, сырья, переделов и заморозки');
near(fillet.costRubKg, (140 + 20.3) / 0.98, 'Себестоимость филе на кг выпуска, весовой метод', 1e-9);
near(plan.products.find(item => item.id === 'whole').costRubKg, 140 + 8, 'Себестоимость тушки в схеме филе: сырье и затраты целой тушки');

// Сырье при rawInRate схемы: ставка уже содержит сырье, отдельно оно не добавляется.
const ratesRaw = {...rates, rawInRate: {...rates.rawInRate, fillet: true}};
const planRaw = planFromRows({rows: ROWS, M, routeCode: 'fillet', cutT: 40, rates: ratesRaw});
near(planRaw.contribution - plan.contribution, 40 * 140 * 1000, 'При rawInRate сырье разделки не учитывается повторно');

// Перенос объема: 40 т в 50 т сохраняет сумму тушки и разделки, баланс сходится.
const plan50 = planFromRows({rows: ROWS, M, routeCode: 'fillet', cutT: 50, rates});
near(plan.cutT + plan.wholeT, 100, 'Разделка и тушка в сумме дают вход при 40 т');
near(plan50.cutT + plan50.wholeT, 100, 'Разделка и тушка в сумме дают вход при 50 т');
near(plan.wholeT - plan50.wholeT, 10, 'Перенос 10 т из тушки в разделку сохраняет сумму');
near(plan50.massBalanceT, 0, 'Материальный баланс при 50 т сходится');

// Загрузка мощности: символ, слово и порог внимания из раздела 8 дизайн-системы.
check(loadStatus(1.2).word === 'Риск', 'Загрузка выше 100% дает риск');
check(loadStatus(0.95).word === 'Внимание', 'Загрузка от 90% до 100% дает внимание');
check(loadStatus(0.5).word === 'В норме', 'Загрузка ниже 90% в норме');
check(loadStatus(null).word === 'Нет данных', 'Пустая загрузка дает нет данных');
check(plan.stages.find(stage => stage.id === 'packing').status.word === 'Внимание', 'Упаковка 99% мощности выделяется вниманием');
check(plan.stages.find(stage => stage.id === 'freezing').status.word === 'Риск', 'Заморозка выше мощности выделяется риском');
check(plan.bottleneck.name === 'Заморозка', 'Узкое место плана: заморозка');
check(plan.feasible === false, 'План с разрывом заказа и перегрузкой заморозки невыполним');
check(plan.stages.find(stage => stage.id === 'cutting').status.word === 'В норме', 'Разделка 40 т из 50 т в норме');

// Строки вне справочника модели не входят в расчет и названы явно.
const withUnknown = [...ROWS, row({product: 'sausage', volumeKg: 1000, priceRubKg: 100})];
const planUnknown = planFromRows({rows: withUnknown, M, routeCode: 'fillet', cutT: 40, rates});
check(planUnknown.excluded.includes('sausage'), 'Строка с чужим товаром названа в списке исключенных');
near(planUnknown.revenue, plan.revenue, 'Строка с чужим товаром не меняет вклад');

// Ставки: без файла недели и подтверждения финансов каждая ставка помечается.
check(rates.confirmed.raw === false, 'Без файла недели цена сырья не подтверждена');
check(plan.unconfirmed.includes('Требуется подтверждение: цена сырья'), 'Цена сырья помечена: требуется подтверждение');
check(plan.unconfirmed.includes('Требуется подтверждение: методика себестоимости'), 'Методика себестоимости помечена');
const confirmedRates = ratesFrom({p, week: {rawCostRubKg: 150, financeConfirmed: true}, M});
near(confirmedRates.rawCostRubKg, 150, 'Цена сырья из файла недели');
check(confirmedRates.confirmed.raw === true, 'Цена сырья из файла с подтверждением финансов принята');
check(!unconfirmedOf(confirmedRates.confirmed).includes('Требуется подтверждение: цена сырья'), 'Подтвержденная цена сырья без подписи');

// Блок входа недели: 100 т ниже предела масштаба. Экран плана выводит предупреждение и не блокирует расчет, границу, стакан и сохранение варианта.
// Модель помечает вход (scaleGuard.blocked) и считает границу с предупреждением: проверка в tests/plan-frontier.test.mjs, раздел 9.
const weekInput = modelWeek({rows: ROWS, M, inputKg: rates.inputKg, routeCode: 'fillet', rates});
near(weekInput.minWholeKg, 3000, 'Минимум тушки равен подтвержденным заказам целой тушки, кг');
check(weekInput.orders.every(order => ['confirmed', 'forecast', 'extra'].includes(order.orderClass)), 'Классы строк переведены в классы модели');
check(M.scaleGuard(weekInput).blocked === true, 'Вход 100 т ниже предела масштаба помечен предохранителем модели');
check(plan.valid === true, 'Вход 100 т ниже предела: расчет недели выполняется, блокировки нет');
// Предупреждение масштаба: текст с разрядами (неразрывный пробел) и масштабом 4 010 т.
check(scaleWarningText(44000, M.planConfig.scaleWeekKg) === 'Масштаб недели ниже ожидаемого: 44 т против 4 010 т', 'Предупреждение: 44 т против 4 010 т');
// Кнопка «Сохранить вариант»: активна при строках недели и выполненном расчете, в том числе ниже предела масштаба.
check(canSaveVariant(ROWS.length, plan) === true, 'Сохранение варианта активно при строках и расчете, ниже предела масштаба тоже');
check(canSaveVariant(0, plan) === false, 'Без строк недели сохранение варианта неактивно');
check(canSaveVariant(ROWS.length, planFromRows({rows: ROWS, M, routeCode: 'fillet', cutT: 200, rates})) === false, 'Расчет с ошибкой ввода сохранение не открывает');

// Состав сохранения варианта недели: параметры плана и рычаги, как на экране плана. Разделка задается для каждого варианта отдельно.
const stateAt = cut => ({
  p: {...p, route: 'fillet', cut}, request: {quantity: 4, price: 300, service: 0, requestId: 'demo-order-1', forecastAbsorption: true},
  roi: {weeks: 52, execution: 0.7, investment: null, annualOpex: null}, client: {volume: 10, share: 75, price: 205, service: 15},
  product: 'fillet', scenario: {dataEdition: null, day: null, zone: null, packing: null, client: null, paramsVersion: null, name: 'Филе и ножки', baseRevision: null}, revision: 1,
});

// Варианты: сохранение через хранилище, повтор состава не создает дубль, главная цифра равна результату сравнения.
const storage = memoryStorage();
const snapshot = await variantSnapshot({rows: ROWS, weekStart: WEEK_START, plan, state: stateAt(40), routeName: 'Филе и ножки', createdAt: '2026-10-19T10:00:00.000Z'});
const first = addScenario(snapshot, storage);
check(first.ok === true && first.created === true, 'Первый вариант сохраняется');
const sameSnapshot = await variantSnapshot({rows: ROWS, weekStart: WEEK_START, plan, state: stateAt(40), routeName: 'Филе и ножки', createdAt: '2026-10-19T11:00:00.000Z'});
check(sameSnapshot.contentHash === snapshot.contentHash, 'Тот же состав дает тот же хеш');
const again = addScenario(sameSnapshot, storage);
check(again.ok === true && again.created === false, 'Повтор варианта не создает дубль');
check(loadWeek(storage).scenarios.length === 1, 'В хранилище один вариант после повтора');
const stored = getScenario(snapshot.id, storage);
near(stored.result.contribution, Math.round(plan.contribution), 'Главная цифра варианта равна вкладу расчета');
check(variantResult(plan).feasible === false, 'Результат варианта показывает невыполнимость');

const snapshot50 = await variantSnapshot({rows: ROWS, weekStart: WEEK_START, plan: plan50, state: stateAt(50), routeName: 'Филе и ножки'});
check(snapshot50.contentHash !== snapshot.contentHash, 'Другая разделка дает другой хеш');
check(addScenario(snapshot50, storage).created === true, 'Второй вариант сохраняется отдельно');
check(loadWeek(storage).scenarios.length === 2, 'Два варианта для сравнения');
check(!JSON.stringify(loadWeek(storage).scenarios).includes('К-'), 'Сохраненные варианты не содержат кодов клиентов');

// Открытие варианта недели после перезагрузки: входы возвращаются без ошибки схемы, пересчет недели дает значения, сохраненные в варианте.
const reloaded = memoryStorage();
reloaded.setItem(WEEK_KEY, storage.getItem(WEEK_KEY)); // строка из хранилища: так браузер отдает данные после перезагрузки
const savedWeek = getScenario(snapshot.id, reloaded);
check(savedWeek !== null && savedWeek.inputs.source === 'week', 'Вариант недели остался после перезагрузки');
check(await variantHashOk(savedWeek), 'Хеш варианта недели сходится с содержимым: файл варианта пройдет проверку');
let restored = null;
assert.doesNotThrow(() => { restored = restoreInputs(savedWeek); }, 'Открытие варианта недели проходит без ошибки схемы');
checks++;
// Сравнение с копией через JSON: параметры модели созданы в vm-контексте, а восстановленные – в основном контексте.
assert.deepEqual(restored.p, JSON.parse(JSON.stringify(stateAt(40).p)), 'Параметры варианта возвращаются целиком');
check(restored.product === 'fillet', 'Товар варианта возвращается');
const replan = planFromRows({rows: ROWS, M, routeCode: restored.p.route, cutT: restored.p.cut, rates: ratesFrom({p: restored.p, week: null, M})});
assert.deepEqual(variantResult(replan), savedWeek.result, 'Значения моста после открытия совпадают с сохраненным вариантом');
checks++;

// Персональные данные: клиент только кодом, поля контактов отклоняются.
check(validateOrderRow({...ROWS[0], clientCode: 'Иванов'}).length > 0, 'Клиент фамилией отклоняется');
check(validateOrderRow({...ROWS[0], phone: '+7 900 123-45-67'}).length > 0, 'Поле телефона отклоняется');
check(validateOrderRow(ROWS[0]).length === 0, 'Корректная строка без ошибок');

console.log(`План недели по заказам: ${checks} проверок пройдены`);
