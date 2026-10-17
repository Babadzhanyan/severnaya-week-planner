import assert from 'node:assert/strict';
import {
  STATUS, loadPercent, loadStatus, toT, toKg, dayToWeek, weekToDay, unitPassport, resourceCard,
  workingDaysLabel, workDaysWord, WORKING_DAYS_UNCONFIRMED
} from '../src/capacity-units.js';

// Запуск из каталога platform: node tests/capacity-units.test.mjs
// Все входы синтетические или взяты из эталона пакета. Исходные файлы предприятия не читаются.
let checks = 0;
const check = (condition, message) => {checks++; assert.ok(condition, message);};
const close = (actual, expected, eps = 1e-9) => Math.abs(actual - expected) <= eps;

// 1. Эталон пакета: 313 221,7507 / 337 272 кг в сутки = 92,86918 %, округление в расчете не выполняется
const bulkPct = loadPercent(313221.7507, 337272);
check(Math.round(bulkPct * 1e5) / 1e5 === 92.86918, 'Валовая упаковка: 92,86918 %');
check(Math.round(loadPercent(313221.75, 337272) * 10) / 10 === 92.9, 'Подпись около 92,9 %');
check(loadPercent(313221.7507, 0) === null && loadPercent(null, 337272) === null, 'Пустая мощность или поток дают null');
check(bulkPct !== 92.9, 'Расчет не округляется до подписи');
let thrown = false;
try { loadPercent(Number.NaN, 100); } catch (error) { thrown = error instanceof RangeError; }
check(thrown, 'Нечисловой поток отклоняется');

// 2. Пороги статуса совпадают с backend/units.py
check(loadStatus(313221.7507, 337272) === 'Высокая загрузка', 'Статус 92,9 %: Высокая загрузка');
check(loadStatus(90, 100) === 'Резерв мощности', 'Ровно 90 % остается резервом');
check(loadStatus(101, 100) === 'Превышение мощности', 'Выше мощности: Превышение мощности');
check(loadStatus(0, 0) === 'Резерв мощности', 'Ноль при нулевой мощности: резерв');
check(loadStatus(5, 0) === 'Превышение мощности', 'Поток при нулевой мощности: превышение');
check(loadStatus(null, 100) === 'Нет данных', 'Пустой поток: Нет данных');

// 3. Перевод т <-> кг и сутки <-> неделя сохраняет загрузку при согласованном календаре
check(close(toT(337272), 337.272), 'Перевод 337 272 кг в 337,272 т');
check(close(toKg(337.272), 337272, 1e-6), 'Обратный перевод в кг');
for (const days of [5, 6, 7]) {
  const weekPct = loadPercent(dayToWeek(313221.7507, days), dayToWeek(337272, days));
  check(close(weekPct, bulkPct, 1e-9), `Календарь ${days} дней: загрузка не меняется`);
  check(close(weekToDay(dayToWeek(313221.7507, days), days), 313221.7507, 1e-6), `Сутки -> неделя -> сутки при ${days} днях`);
}
check(loadPercent(dayToWeek(313221.7507, 6), dayToWeek(337272, 7)) !== bulkPct, 'Разные календари меняют загрузку');
for (const bad of [0, -1, null, true, Number.NaN]) {
  let rejected = false;
  try { dayToWeek(337272, bad); } catch { rejected = true; }
  check(rejected, `Рабочие дни ${String(bad)} отклоняются`);
}

// 4. Паспорт ячейки сохраняет поля и не содержит имен файлов
const cell = {sheet: '2.2', cells: 'D19'};
const base = {physicalBase: 'Живой вес в эквиваленте общего потока', weighingPoint: 'Требуется подтверждение: точка взвешивания'};
const passport = unitPassport(cell, 313221.7507, 'кг / сутки', base, 'Учебный период', 'Доступность календаря 0,8', 'кг / смену = кг / сутки / смены');
check(Object.keys(passport).join() === 'sourceCell,value,unit,physicalBase,weighingPoint,period,calendar,conversionRule,status', 'Паспорт содержит все поля в порядке backend/units.py');
check(passport.status === STATUS.source, 'Статус значения: сохранённый расчёт файла');
check(unitPassport(cell, null, 'кг / сутки', base, 'Период', 'Календарь', 'Правило').status === 'Нет данных', 'Пустое значение: Нет данных');
thrown = false;
try { unitPassport(cell, 1, 'кг / сутки', {physicalBase: 'Живой вес'}, 'Период', 'Календарь', 'Правило'); } catch (error) { thrown = error instanceof TypeError; }
check(thrown, 'Паспорт с пустой точкой взвешивания не создается');

// 5. Карточка ресурса: числитель, знаменатель, процент, единица, период, ячейка-источник, статус
const card = resourceCard(313221.7507, 337272, 'кг / сутки', 'Учебный период', [cell]);
check(card.numerator === 313221.7507 && card.denominator === 337272, 'Карточка: числитель и знаменатель');
check(Math.round(card.percent * 1e5) / 1e5 === 92.86918 && card.status === 'Высокая загрузка', 'Карточка: процент и статус');
check(card.sourceCells[0].cells === 'D19' && card.unit === 'кг / сутки' && card.period === 'Учебный период', 'Карточка: ячейка, единица, период');
thrown = false;
try { resourceCard(1, 2, 'кг / сутки', 'Период', []); } catch (error) { thrown = error instanceof TypeError; }
check(thrown, 'Карточка с пустым списком ячеек-источников не создается');

// 6. QA-07: рабочие дни недели не подставляются; гипотеза контракта выводится в подпись (паритет с backend/tests/test_units.py)
thrown = false;
try { dayToWeek(337272); } catch (error) { thrown = error instanceof RangeError; }
check(thrown, 'Перевод сутки → неделя без рабочих дней не выполняется: значения по умолчанию нет');
check(workingDaysLabel(7, 'гипотеза, принята заказчиком') === 'Требуется подтверждение: 7 рабочих дней, гипотеза', 'Подпись гипотезы недели: 7 рабочих дней, гипотеза');
check(workingDaysLabel(7, 'требуется подтверждение') === 'Требуется подтверждение: 7 рабочих дней', 'Статус «Требуется подтверждение» без дублирования');
check(workingDaysLabel(7) === 'Требуется подтверждение: 7 рабочих дней', 'Пустой статус: Требуется подтверждение');
check(workingDaysLabel(5, 'подтверждено заказчиком') === '5 рабочих дней', 'Подтвержденный календарь: без префикса');
check(workingDaysLabel(7.0, 'подтверждено') === '7 рабочих дней', 'Целое 7.0 совпадает с 7');
check(workDaysWord(1) === 'рабочий день' && workDaysWord(2) === 'рабочих дня' && workDaysWord(11) === 'рабочих дней', 'Склонение: 1 день, 2 дня, 11 дней');
check(workDaysWord(21) === 'рабочий день' && workDaysWord(22) === 'рабочих дня' && workDaysWord(14) === 'рабочих дней', 'Склонение: 21 день, 22 дня, 14 дней');
for (const days of [null, undefined, 0, -7, 5.5, true, Number.NaN, Number.POSITIVE_INFINITY, '7']) {
  const label = workingDaysLabel(days, 'гипотеза, принята заказчиком');
  check(label === WORKING_DAYS_UNCONFIRMED && !label.includes('7'), `Недопустимое число дней ${String(days)} не подменяется значением 7`);
}
check(WORKING_DAYS_UNCONFIRMED === 'Требуется подтверждение: число рабочих дней недели не задано', 'Текст пустого календаря совпадает с backend/units.py');

console.log(`Единицы и мощности интерфейса: ${checks} проверок пройдены`);
