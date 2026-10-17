// Логика экрана «Ввод заказов» без DOM: разбор вставки и CSV, строка из полей формы, итоги и перенос объема между днями.
// Значения строки проверяет validateOrderRow из хранилища недели. Здесь проверяется то, что хранилище не видит: товар из каталога и день внутри недели.
import { ORDER_CLASSES, validateOrderRow } from './store/weekStore.js';
import { parseFieldNumber } from './format.js';

export const WEEK_DAYS = 6; // неделя с воскресенья по пятницу (ИД-08)
export const MAX_IMPORT_ROWS = 500;
export const CLASS_OPTIONS = [
  { value: ORDER_CLASSES[0], label: 'подтвержден' },
  { value: ORDER_CLASSES[1], label: 'прогноз' },
  { value: ORDER_CLASSES[2], label: 'дополнительно' },
];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const CLASS_PREFIXES = [['подтверж', ORDER_CLASSES[0]], ['прогноз', ORDER_CLASSES[1]], ['дополнит', ORDER_CLASSES[2]], ['разов', ORDER_CLASSES[2]]];
const HEADER_FIELDS = [['клиент', 'clientCode'], ['товар', 'product'], ['продукт', 'product'], ['день', 'day'], ['дата', 'day'], ['зона', 'zone'], ['канал', 'channel'], ['объем', 'volume'], ['цена', 'price'], ['класс', 'orderClass'], ['вероятность', 'probability'], ['примечание', 'note'], ['ключ', 'key']];
const REQUIRED = [['clientCode', 'Клиент'], ['product', 'Товар'], ['day', 'День'], ['zone', 'Зона'], ['channel', 'Канал'], ['volume', 'Объем'], ['price', 'Цена'], ['orderClass', 'Класс']];
const COLUMN_ORDER = ['clientCode', 'product', 'day', 'zone', 'channel', 'volume', 'price', 'orderClass', 'probability', 'note'];
const PERSONAL = 'personal';
const PERSONAL_HEADER = /имя|фио|телефон|почт|mail|адрес|контакт|менеджер|name|phone|contact|manager|address|fio|\btel/;

const pad = value => String(value).padStart(2, '0');
const isoOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const decimalText = value => String(value).replace('.', ',');
const parseNumber = value => { const parsed = parseFieldNumber(value); return parsed.kind === 'number' ? parsed.value : undefined; };
const roundRub = value => Math.round(value * 100) / 100;

// Текст для сравнения: регистр и точки над буквой «е» не важны, Excel и ручной ввод пишут слова по-разному.
export const normalizeText = value => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/\u0308/g, '').normalize('NFC');

// Дни недели от начала недели. Неделя охватывает WEEK_DAYS дней.
export function weekDays(weekStart) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  return Array.from({ length: WEEK_DAYS }, (_, i) => isoOf(new Date(y, m - 1, d + i)));
}
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS[m - 1]}`;
}
export const weekRange = weekStart => { const days = weekDays(weekStart); return `${dayLabel(days[0])} – ${dayLabel(days.at(-1))}`; };
export const classLabel = value => CLASS_OPTIONS.find(option => option.value === value)?.label ?? '';
// Слово «строка» с правильным окончанием для числа строк.
export function rowsWord(count) {
  const last = count % 10, tens = count % 100;
  if (last === 1 && tens !== 11) return 'строка';
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return 'строки';
  return 'строк';
}
// Код клиента: латинская K в начале приводится к русской К, остальное проверяет хранилище.
export const normalizeClient = value => String(value ?? '').trim().replace(/^[Kk]-/, 'К-');
// Дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ (как в русском Excel). Иной текст возвращается как есть: хранилище его отклонит.
export function parseDay(value) {
  const text = String(value ?? '').trim();
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return ru ? `${ru[3]}-${pad(ru[2])}-${pad(ru[1])}` : text;
}
export function parseClass(value) {
  const text = String(value ?? '').trim();
  if (ORDER_CLASSES.includes(text)) return text;
  const hit = CLASS_PREFIXES.find(([prefix]) => normalizeText(text).startsWith(prefix));
  return hit ? hit[1] : text;
}
// Товар из текста: код каталога или название либо короткое название. Неизвестный текст возвращается как есть, строка получит ошибку.
export function productIdOf(value, products) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  if (Object.hasOwn(products, text)) return text;
  const hit = Object.entries(products).find(([, item]) => [item?.name, item?.short].some(name => normalizeText(name) === normalizeText(text)));
  return hit ? hit[0] : text;
}
// Новый ключ строки: не совпадает с занятыми ключами недели.
export function newRowKey(taken = new Set(), random = Math.random) {
  let key;
  do key = `r-${Date.now().toString(36)}-${Math.floor(random() * 1e9).toString(36)}`;
  while (taken.has(key));
  return key;
}

// Строка заказа из полей формы или таблицы. Ошибки на русском, значения в них не попадают.
export function buildRow(fields, { key, week, products }) {
  const orderClass = parseClass(fields.orderClass);
  const row = {
    key,
    clientCode: normalizeClient(fields.clientCode),
    product: String(fields.product ?? '').trim(),
    day: parseDay(fields.day),
    zone: String(fields.zone ?? '').trim(),
    channel: String(fields.channel ?? '').trim(),
    volumeKg: parseNumber(fields.volume),
    priceRubKg: parseNumber(fields.price),
    orderClass,
    probability: orderClass === ORDER_CLASSES[1] ? parseNumber(fields.probability) : null,
    note: String(fields.note ?? '').trim(),
  };
  const errors = [];
  if (!Object.hasOwn(products, row.product)) errors.push('Товар выбирается из каталога продуктов');
  if (!weekDays(week.weekStart).includes(row.day)) errors.push('День выбирается из дней недели');
  return { row, errors: [...new Set([...errors, ...validateOrderRow(row)])] };
}

// Значения формы: пустая строка для новой записи и поля строки для изменения.
export const emptyForm = (week, products) => ({ clientCode: '', product: Object.keys(products)[0] ?? '', day: weekDays(week.weekStart)[0], zone: '', channel: '', volume: '', price: '', orderClass: ORDER_CLASSES[0], probability: '', note: '' });
export const formFromRow = row => ({
  clientCode: row.clientCode, product: row.product, day: row.day, zone: row.zone, channel: row.channel,
  volume: String(row.volumeKg), price: decimalText(row.priceRubKg), orderClass: row.orderClass,
  probability: row.probability == null ? '' : decimalText(row.probability), note: row.note ?? '',
});

// Делит текст на записи и ячейки. Поддерживаются кавычки в начале ячейки и переносы внутри кавычек.
export function splitRecords(text, delimiter) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let cells = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { cells.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      cells.push(cell); records.push(cells); cells = []; cell = '';
    } else cell += ch;
  }
  cells.push(cell); records.push(cells);
  return records;
}

function headerField(cell) {
  const text = normalizeText(cell);
  if (!text) return null;
  if (PERSONAL_HEADER.test(text)) return PERSONAL;
  return HEADER_FIELDS.find(([prefix]) => text.startsWith(prefix))?.[1] ?? null;
}

export const rejectedImport = message => ({ importable: false, fatal: [message], rows: [], errors: [], total: 0 });

// Разбор вставки из Excel (табуляция) и CSV (точка с запятой). Ошибки привязаны к номеру строки в тексте.
// Импорт возможен только без ошибок: importable = true при хотя бы одной строке и пустом списке ошибок.
export function parseOrderText(text, { week, products = {}, delimiter, taken = new Set(), random } = {}) {
  const sep = delimiter ?? (String(text ?? '').includes('\t') ? '\t' : ';');
  const records = splitRecords(text, sep)
    .map((cells, index) => ({ line: index + 1, cells: cells.map(cell => cell.trim()) }))
    .filter(record => record.cells.some(Boolean));
  if (!records.length) return rejectedImport('Вставьте строки заказов или выберите файл');
  const isHeader = records[0].cells.some(cell => headerField(cell) !== null);
  const columns = isHeader ? records[0].cells.map(headerField) : COLUMN_ORDER;
  const data = isHeader ? records.slice(1) : records;
  const fatal = [];
  if (isHeader) {
    records[0].cells.forEach((label, i) => {
      if (columns[i] === PERSONAL) fatal.push(`Колонка «${label}» относится к персональным данным: импорт отклонен. Клиент передается только кодом вида К-001`);
      else if (label && columns[i] === null) fatal.push(`Колонка «${label}» не входит в шаблон заказа: удалите ее`);
    });
    const present = new Set(columns);
    REQUIRED.forEach(([field, label]) => { if (!present.has(field)) fatal.push(`В таблице нет колонки «${label}»`); });
  }
  if (!fatal.length && !data.length) fatal.push('В таблице нет строк заказов');
  if (!fatal.length && data.length > MAX_IMPORT_ROWS) fatal.push(`За один раз импортируется не больше ${MAX_IMPORT_ROWS} строк`);
  if (fatal.length) return { ...rejectedImport(fatal[0]), fatal };

  const used = new Set(taken);
  const result = { importable: false, fatal: [], rows: [], errors: [], total: data.length };
  for (const record of data) {
    const fields = {};
    record.cells.forEach((cell, i) => {
      const field = columns[i];
      if (field && field !== 'key' && field !== PERSONAL) fields[field] = cell;
    });
    fields.product = productIdOf(fields.product, products);
    const key = newRowKey(used, random);
    const { row, errors } = buildRow(fields, { key, week, products });
    if (errors.length) result.errors.push({ line: record.line, messages: errors });
    else { used.add(key); result.rows.push(row); }
  }
  result.importable = result.rows.length > 0 && result.errors.length === 0;
  return result;
}

// Итоги недели: объем по товарам, дням и классам, сумма в рублях и число строк.
export function weekTotals(rows, products = {}) {
  const sumBy = (list, pick) => list.reduce((sum, row) => sum + pick(row), 0);
  const groupBy = (keyOf, labelOf) => {
    const groups = new Map();
    for (const row of rows) { const key = keyOf(row); groups.set(key, (groups.get(key) ?? 0) + row.volumeKg); }
    return [...groups].map(([key, kg]) => ({ key, label: labelOf(key), kg }));
  };
  return {
    count: rows.length,
    empty: rows.length === 0,
    kg: sumBy(rows, row => row.volumeKg),
    rub: roundRub(sumBy(rows, row => row.volumeKg * row.priceRubKg)),
    byProduct: groupBy(row => row.product, id => products[id]?.name ?? id).sort((a, b) => b.kg - a.kg),
    byDay: groupBy(row => row.day, dayLabel).sort((a, b) => (a.key < b.key ? -1 : 1)),
    byClass: CLASS_OPTIONS.map(({ value, label }) => {
      const list = rows.filter(row => row.orderClass === value);
      return { key: value, label, kg: sumBy(list, row => row.volumeKg), count: list.length };
    }),
  };
}

// Перенос объема. Вся строка меняет день, если переносится весь объем. Часть объема уходит в новую строку на другой день.
// Сумма недели в кг и руб. не меняется: цена и остальные поля копируются без изменений.
export function moveVolume(rows, { key, toDay, kg, week, newKey }) {
  const source = rows.find(row => row.key === key);
  if (!source) return { ok: false, errors: ['Строка для переноса не найдена'] };
  const errors = [];
  if (!Number.isInteger(kg) || kg <= 0) errors.push('Объем переноса указывается целым числом килограммов больше нуля');
  else if (kg > source.volumeKg) errors.push('Объем переноса больше объема строки');
  if (!weekDays(week.weekStart).includes(toDay)) errors.push('День переноса выбирается из дней недели');
  else if (toDay === source.day) errors.push('День переноса совпадает с днем строки');
  if (errors.length) return { ok: false, errors };
  if (kg === source.volumeKg) return { ok: true, rows: rows.map(row => (row.key === key ? { ...row, day: toDay } : row)) };
  const rest = { ...source, volumeKg: source.volumeKg - kg };
  const moved = { ...source, key: newKey, day: toDay, volumeKg: kg };
  return { ok: true, rows: rows.flatMap(row => (row.key === key ? [rest, moved] : [row])) };
}

// Строки для показа: по дню, внутри дня порядок ввода сохраняется.
export const sortRows = rows => rows.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
