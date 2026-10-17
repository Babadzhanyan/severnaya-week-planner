import assert from 'node:assert/strict';
import { ORDER_CLASSES, buildWeekCsv } from '../src/store/weekStore.js';
import {
  CLASS_OPTIONS, MAX_IMPORT_ROWS, buildRow, dayLabel, emptyForm, formFromRow, moveVolume, normalizeClient,
  parseClass, parseDay, parseOrderText, productIdOf, rowsWord, sortRows, splitRecords, weekDays, weekRange, weekTotals,
} from '../src/order-import.js';

// Все сообщения и подписи проходят через seen: в конце проверяется, что в них нет буквы «ё».
const seen = [];
const say = list => (seen.push(...list), list);

const CONFIRMED = ORDER_CLASSES[0], FORECAST = ORDER_CLASSES[1], EXTRA = ORDER_CLASSES[2];
const week = { weekStart: '2026-10-18', rows: [], scenarios: [] }; // неделя с воскресенья 18 октября 2026
const products = { fillet: { name: 'Филе грудки', short: 'Филе' }, legs: { name: 'Ножки', short: 'Ножки' } };
const base = { clientCode: 'К-001', product: 'fillet', day: '2026-10-19', zone: 'Центр', channel: 'Опт', volume: '1 250', price: '288,98', orderClass: 'подтвержден', probability: '', note: 'По договору' };

// 1. Календарь недели: воскресенье – пятница, подписи дней и диапазон.
assert.deepEqual(weekDays('2026-10-18'), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
assert.equal(dayLabel('2026-10-18'), 'вс, 18 окт');
assert.equal(weekRange('2026-10-18'), 'вс, 18 окт – пт, 23 окт');
assert.equal(emptyForm(week, products).day, '2026-10-18');
assert.equal(emptyForm(week, products).product, 'fillet');
assert.equal(emptyForm(week, products).orderClass, CONFIRMED);

// 2. Разбор полей: код клиента, дата, класс и товар.
assert.equal(normalizeClient(' k-001 '), 'К-001');
assert.equal(normalizeClient('К-042'), 'К-042');
assert.equal(parseDay('20.10.2026'), '2026-10-20');
assert.equal(parseDay('2026-10-20'), '2026-10-20');
assert.equal(parseClass('Подтвержден'), CONFIRMED);
assert.equal(parseClass('подтвержд' + String.fromCharCode(0x451) + 'н'), CONFIRMED, 'старое значение класса приводится к новому');
assert.equal(parseClass(CONFIRMED), CONFIRMED);
assert.equal(parseClass('Прогноз'), FORECAST);
assert.equal(parseClass('дополнительный'), EXTRA);
assert.equal(parseClass('черновик'), 'черновик', 'неизвестный класс остается текстом: хранилище его отклонит');
assert.equal(productIdOf('Филе грудки', products), 'fillet');
assert.equal(productIdOf('филе', products), 'fillet');
assert.equal(productIdOf('legs', products), 'legs');
assert.equal(productIdOf('Крыло', products), 'Крыло', 'товар вне каталога остается текстом и получает ошибку строки');

// 3. Строка из полей: верная строка принимается, вероятность хранится только у прогноза.
const ok = buildRow(base, { key: 'k1', week, products });
assert.deepEqual(ok.errors, []);
assert.deepEqual([ok.row.volumeKg, ok.row.priceRubKg, ok.row.probability, ok.row.orderClass], [1250, 288.98, null, CONFIRMED]);
assert.equal(buildRow({ ...base, probability: '0,5' }, { key: 'k2', week, products }).row.probability, null);
const forecast = buildRow({ ...base, orderClass: 'прогноз', probability: '0,8' }, { key: 'k3', week, products });
assert.deepEqual([forecast.errors, forecast.row.probability], [[], 0.8]);

// 4. Каждый вид ошибки строки дает понятное сообщение.
const cases = [
  [{ clientCode: 'К-1' }, 'кодом вида'],
  [{ clientCode: 'K1' }, 'кодом вида'],
  [{ volume: '1,5' }, 'целым'],
  [{ volume: '-5' }, 'отрицательным'],
  [{ price: '288,123' }, 'двумя знаками'],
  [{ price: '-1' }, 'отрицательной'],
  [{ orderClass: 'черновик' }, 'Класс заказа'],
  [{ orderClass: 'прогноз', probability: '1,2' }, 'от 0 до 1'],
  [{ orderClass: 'прогноз', probability: '' }, 'от 0 до 1'],
  [{ product: 'Крыло' }, 'каталога'],
  [{ day: '2026-10-25' }, 'дней недели'],
  [{ day: '2026-10-17' }, 'дней недели'],
  [{ zone: '' }, 'Зона требует'],
  [{ note: 'Звонить +7 999 000-11-22' }, 'телефон'],
  [{ note: 'ivanov@example.test' }, 'e-mail'],
  [{ note: 'ул. Тестовая, 1' }, 'адрес'],
];
for (const [patch, expected] of cases) {
  const { errors } = buildRow({ ...base, ...patch }, { key: 'k', week, products });
  say(errors);
  assert.ok(errors.some(message => message.includes(expected)), `${Object.keys(patch)}: ${errors}`);
}

// 5. Вставка из Excel с заголовками: строка с ошибкой отмечается номером, импорт при ошибке не разрешен.
const pasted = [
  'Клиент\tТовар\tДень\tЗона\tКанал\tОбъем\tЦена\tКласс\tВероятность\tПримечание',
  'К-001\tФиле грудки\t19.10.2026\tЦентр\tОпт\t1 250\t288,98\tподтвержден\t\tПо договору',
  'К-002\tНожки\t2026-10-20\tЮг\tРозница\t800\t210\tпрогноз\t0,8\t',
  'К-003\tНожки\t2026-10-20\tЮг\tРозница\t800,5\t210\tпрогноз\t0,8\t',
].join('\n');
const withError = parseOrderText(pasted, { week, products });
say(withError.errors.flatMap(item => item.messages));
assert.equal(withError.importable, false);
assert.deepEqual(withError.errors.map(item => item.line), [4]);
assert.equal(withError.rows.length, 2);
assert.equal(withError.rows[0].product, 'fillet');
assert.equal(withError.rows[0].day, '2026-10-19');
assert.equal(withError.rows[0].volumeKg, 1250);
assert.equal(withError.rows[1].probability, 0.8);

const fixed = parseOrderText(pasted.split('\n').slice(0, 3).join('\n'), { week, products });
assert.equal(fixed.importable, true);
assert.equal(fixed.rows.length, 2);
assert.equal(new Set(fixed.rows.map(row => row.key)).size, 2, 'каждая строка получает свой ключ');

// 6. Без заголовков порядок колонок фиксирован: клиент, товар, день, зона, канал, объем, цена, класс, вероятность, примечание.
const noHeader = parseOrderText('К-010\tfillet\t2026-10-21\tЦентр\tОпт\t500\t300\tдополнительно\t\tразовая', { week, products });
assert.equal(noHeader.importable, true);
assert.equal(noHeader.rows[0].orderClass, EXTRA);
assert.equal(noHeader.rows[0].note, 'разовая');

// 7. Персональные данные: колонки ФИО, телефон и e-mail останавливают импорт целиком, значения не выводятся.
const personal = parseOrderText('ФИО;Клиент;Товар;День;Зона;Канал;Объем;Цена;Класс\nИванов Иван;К-001;fillet;2026-10-19;Центр;Опт;100;200;подтвержден', { week, products, delimiter: ';' });
say(personal.fatal);
assert.equal(personal.importable, false);
assert.equal(personal.rows.length, 0);
assert.ok(personal.fatal.some(message => message.includes('персональным данным')));
assert.ok(!JSON.stringify(personal).includes('Иванов'), 'значения персональных данных не попадают в результат');
for (const header of ['Телефон', 'E-mail', 'Контакт', 'Менеджер', 'Адрес клиента']) {
  const result = parseOrderText(`${header};Клиент;Товар;День;Зона;Канал;Объем;Цена;Класс\n-;К-001;fillet;2026-10-19;Центр;Опт;100;200;подтвержден`, { week, products, delimiter: ';' });
  assert.ok(result.fatal.some(message => message.includes('персональным данным')), header);
}

// 8. Заголовки: нет обязательной колонки или лишняя колонка останавливают импорт.
const missing = parseOrderText('Клиент;Товар;День;Зона;Канал;Объем;Класс\nК-001;fillet;2026-10-19;Центр;Опт;100;подтвержден', { week, products, delimiter: ';' });
say(missing.fatal);
assert.ok(missing.fatal.some(message => message.includes('«Цена»')));
const extra = parseOrderText('Клиент;Товар;День;Зона;Канал;Объем;Цена;Класс;Сумма\nК-001;fillet;2026-10-19;Центр;Опт;100;200;подтвержден;5', { week, products, delimiter: ';' });
say(extra.fatal);
assert.ok(extra.fatal.some(message => message.includes('не входит в шаблон')));

// 9. Пустой ввод и слишком длинный файл.
assert.equal(parseOrderText('   \n  ', { week, products }).importable, false);
assert.ok(parseOrderText('', { week, products }).fatal[0].includes('Вставьте'));
const long = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => 'К-001\tfillet\t2026-10-19\tЦентр\tОпт\t1\t1\tподтвержден').join('\n');
assert.ok(parseOrderText(long, { week, products }).fatal[0].includes(String(MAX_IMPORT_ROWS)));

// 10. CSV с разделителем точка с запятой: кавычки, перенос внутри кавычек, BOM и CRLF.
assert.deepEqual(splitRecords('﻿a;"b;c";"d""e"\r\nf;g', ';'), [['a', 'b;c', 'd"e'], ['f', 'g']]);
assert.deepEqual(splitRecords('x;"перенос\nстроки"', ';'), [['x', 'перенос\nстроки']]);

// 11. Выгрузка CSV и импорт возвращают те же строки (ключи создаются заново).
const rowA = buildRow(base, { key: 'a', week, products }).row;
const rowB = buildRow({ ...base, clientCode: 'К-002', product: 'legs', orderClass: 'прогноз', probability: '0,8', note: 'Сверить "с" заказом', volume: '400', price: '210' }, { key: 'b', week, products }).row;
const csv = buildWeekCsv([rowA, rowB]);
const roundTrip = parseOrderText(csv, { week, products, delimiter: ';' });
say(roundTrip.errors.flatMap(item => item.messages));
assert.equal(roundTrip.importable, true);
assert.deepEqual(roundTrip.rows.map(({ key, ...rest }) => rest), [rowA, rowB].map(({ key, ...rest }) => rest));

// 12. Итоги: объем по товарам, дням и классам, сумма в рублях, число строк и пустая неделя.
const sample = [
  { product: 'fillet', day: '2026-10-19', orderClass: CONFIRMED, volumeKg: 1000, priceRubKg: 300 },
  { product: 'legs', day: '2026-10-19', orderClass: FORECAST, volumeKg: 500, priceRubKg: 200 },
  { product: 'fillet', day: '2026-10-21', orderClass: EXTRA, volumeKg: 250, priceRubKg: 100.5 },
];
const totals = weekTotals(sample, products);
assert.equal(totals.count, 3);
assert.equal(totals.empty, false);
assert.equal(totals.kg, 1750);
assert.equal(totals.rub, 425125);
assert.deepEqual(totals.byProduct.map(item => [item.label, item.kg]), [['Филе грудки', 1250], ['Ножки', 500]]);
assert.deepEqual(totals.byDay.map(item => [item.label, item.kg]), [['пн, 19 окт', 1500], ['ср, 21 окт', 250]]);
assert.deepEqual(totals.byClass.map(item => item.kg), [1000, 500, 250]);
assert.deepEqual(weekTotals([], products).empty, true);
assert.equal(weekTotals([], products).rub, 0);
for (const option of CLASS_OPTIONS) say([option.label]);

// 13. Перенос объема: вся строка меняет день, часть объема уходит в новую строку. Сумма недели кг и руб. сохраняется.
const seed = [
  { key: 'a', clientCode: 'К-001', product: 'fillet', day: '2026-10-19', zone: 'Центр', channel: 'Опт', volumeKg: 1000, priceRubKg: 300, orderClass: CONFIRMED, probability: null, note: '' },
  { key: 'b', clientCode: 'К-002', product: 'legs', day: '2026-10-20', zone: 'Юг', channel: 'Розница', volumeKg: 400, priceRubKg: 210, orderClass: FORECAST, probability: 0.6, note: '' },
];
const sumKg = rows => rows.reduce((sum, row) => sum + row.volumeKg, 0);
const sumRub = rows => rows.reduce((sum, row) => sum + row.volumeKg * row.priceRubKg, 0);
const whole = moveVolume(seed, { key: 'a', toDay: '2026-10-21', kg: 1000, week, newKey: 'c' });
assert.equal(whole.ok, true);
assert.equal(whole.rows.length, 2);
assert.equal(whole.rows.find(row => row.key === 'a').day, '2026-10-21');
const part = moveVolume(seed, { key: 'a', toDay: '2026-10-21', kg: 300, week, newKey: 'c' });
assert.equal(part.ok, true);
assert.equal(part.rows.length, 3);
assert.equal(part.rows.find(row => row.key === 'a').volumeKg, 700);
assert.equal(part.rows.find(row => row.key === 'c').day, '2026-10-21');
assert.equal(part.rows.find(row => row.key === 'c').priceRubKg, 300);
assert.equal(sumKg(part.rows), sumKg(seed));
assert.equal(sumRub(part.rows), sumRub(seed));
const forecastMove = moveVolume(seed, { key: 'b', toDay: '2026-10-22', kg: 150, week, newKey: 'd' });
assert.equal(forecastMove.rows.find(row => row.key === 'd').probability, 0.6, 'прогноз переносится с вероятностью');
for (const [args, message] of [
  [{ key: 'a', toDay: '2026-10-21', kg: 1500 }, 'больше объема'],
  [{ key: 'a', toDay: '2026-10-19', kg: 100 }, 'совпадает'],
  [{ key: 'a', toDay: '2026-10-25', kg: 100 }, 'дней недели'],
  [{ key: 'a', toDay: '2026-10-21', kg: 0 }, 'больше нуля'],
  [{ key: 'a', toDay: '2026-10-21', kg: 12.5 }, 'целым'],
  [{ key: 'zz', toDay: '2026-10-21', kg: 1 }, 'не найдена'],
]) {
  const result = moveVolume(seed, { week, newKey: 'c', ...args });
  say(result.errors);
  assert.equal(result.ok, false, message);
  assert.ok(result.errors.some(text => text.includes(message)), `${message}: ${result.errors}`);
}

// 14. Форма: строка для изменения собирается обратно без потерь.
const form = formFromRow(rowB);
assert.equal(form.price, '210');
assert.equal(form.probability, '0,8');
const again = buildRow(form, { key: rowB.key, week, products }).row;
assert.deepEqual(again, rowB);

// 15. Окончания слова «строка» и порядок строк для показа.
assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(rowsWord), ['строка', 'строки', 'строк', 'строк', 'строка', 'строки', 'строк']);
const ordered = sortRows([{ key: 'x', day: '2026-10-21' }, { key: 'y', day: '2026-10-19' }, { key: 'z', day: '2026-10-19' }]);
assert.deepEqual(ordered.map(row => row.key), ['y', 'z', 'x']);

// 16. В видимых сообщениях нет буквы «ё» и знаков «—», «·», «|», «•».
for (const message of seen) {
  assert.ok(!/[ёЁ]/.test(message), message);
  assert.ok(!/[—·|•]/.test(message), message);
}

console.log('orders-screen: все проверки пройдены');
