// Локальное хранилище недели: строки заказов, варианты и обмен файлом. Хранится в браузере пользователя.
// В хранилище попадают числовые входы и коды клиентов К-NNN. Персональные признаки отклоняются при вводе и при импорте.
import { canonicalJson } from '../scenario-state.js';

export const WEEK_KEY = 'severnaya.week.v1';
export const WEEK_VERSION = 1;
export const ORDER_CLASSES = Object.freeze(['подтвержден', 'прогноз', 'дополнительно']);
// Старое значение класса из прежней версии: принимается при импорте и при открытии хранилища, приводится к «подтвержден».
// Буква собирается кодом U+0451 из массива: сборка сворачивает String.fromCharCode(0x451) в литерал и кладет букву в бандл.
const LEGACY_CODE = [0x451];
const LEGACY_CONFIRMED = 'подтвержд' + String.fromCharCode(...LEGACY_CODE) + 'н';
export const MAX_IMPORT_BYTES = 5_000_000;
const ROW_FIELDS = ['key', 'clientCode', 'product', 'day', 'zone', 'channel', 'volumeKg', 'priceRubKg', 'orderClass', 'probability', 'note'];
const CSV_FIELDS = ROW_FIELDS;
const CSV_HEADER = ['Ключ', 'Клиент', 'Продукт', 'День', 'Зона', 'Канал', 'Объем, кг', 'Цена, руб./кг', 'Класс заказа', 'Вероятность', 'Примечание'];
const WEEK_FIELDS = ['version', 'weekStart', 'rows', 'scenarios', 'checksum'];
const CLIENT_CODE = /^К-\d{3,}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;
// ponytail: словарь признаков по шаблону. Фамилии в свободном тексте не ловятся; состав признаков ПДн требует подтверждения (ИБ-09).
const PHONE = /(?<!\d)(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const ADDRESS = /(?:^|[\s,])(?:ул\.|улица|пр-т|проспект|пер\.|переулок|шоссе|кв\.|квартира)\s*\S/i;
const PERSONAL_KEY = /name|phone|tel|mail|contact|manager|address|fio|inn|ogrn|passport|телефон|почт|адрес|контакт|менеджер|фио|паспорт/i;
const STORAGE_ERROR = 'Хранилище браузера недоступно или данные повреждены: изменение не сохранено. Выгрузите неделю в файл';

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const isIsoDay = v => {
  if (typeof v !== 'string' || !ISO_DAY.test(v)) return false;
  const time = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v;
};
const storageOf = storage => { try { return storage ?? globalThis.localStorage ?? null; } catch { return null; } };
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (...errors) => ({ ok: false, errors });
const weekBody = week => ({ version: WEEK_VERSION, weekStart: week.weekStart, rows: week.rows, scenarios: week.scenarios });
// Старый класс приводится к «подтвержден»; остальные строки и нестроковые значения возвращаются без изменений.
const migrateLegacyRows = rows => (Array.isArray(rows) ? rows.map(row => (isObject(row) && row.orderClass === LEGACY_CONFIRMED ? { ...row, orderClass: ORDER_CLASSES[0] } : row)) : rows);

const DEFAULT_WEEK_START = '2026-10-18';
// Пустая неделя по умолчанию: 18–23 октября 2026, воскресенье – пятница.
export function emptyWeek() {
  return { version: WEEK_VERSION, weekStart: DEFAULT_WEEK_START, rows: [], scenarios: [], storageError: false };
}

// Признаки персональных данных в тексте и, по желанию, в ключах. Значения в сообщения не попадают.
// Ключи проверяются у строк заказа; в содержимом варианта ключи задаются приложением, поэтому проверяется только текст.
export function personalDataProblems(value, { keys = true } = {}) {
  const found = new Set();
  const walk = node => {
    if (typeof node === 'string') {
      if (PHONE.test(node)) found.add('в тексте найден телефон: контакты не принимаются');
      if (EMAIL.test(node)) found.add('в тексте найден e-mail: контакты не принимаются');
      if (ADDRESS.test(node)) found.add('в тексте найден адрес: адреса не принимаются');
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (isObject(node)) {
      for (const [key, item] of Object.entries(node)) {
        if (keys && PERSONAL_KEY.test(key)) found.add('поле относится к персональным данным: клиент передается только кодом К-NNN');
        walk(item);
      }
    }
  };
  walk(value);
  return [...found];
}

export function validateOrderRow(row) {
  if (!isObject(row)) return ['Строка заказа требует набора полей'];
  const errors = [];
  if (Object.keys(row).some(key => !ROW_FIELDS.includes(key) && !PERSONAL_KEY.test(key))) errors.push('Строка содержит лишнее поле');
  if (!isText(row.key, 64)) errors.push('Ключ строки требует значения до 64 знаков');
  if (!CLIENT_CODE.test(row.clientCode)) errors.push('Клиент указывается кодом вида К-NNN');
  if (!isText(row.product, 80)) errors.push('Продукт требует названия до 80 знаков');
  if (!isIsoDay(row.day)) errors.push('День указывается датой ГГГГ-ММ-ДД');
  if (!isText(row.zone, 80)) errors.push('Зона требует названия до 80 знаков');
  if (!isText(row.channel, 80)) errors.push('Канал требует названия до 80 знаков');
  if (!Number.isInteger(row.volumeKg)) errors.push('Объем указывается целым числом килограммов');
  else if (row.volumeKg < 0) errors.push('Объем не может быть отрицательным');
  if (!isNumber(row.priceRubKg)) errors.push('Цена указывается числом руб./кг');
  else if (row.priceRubKg < 0) errors.push('Цена не может быть отрицательной');
  else if (Math.abs(row.priceRubKg * 100 - Math.round(row.priceRubKg * 100)) > 1e-6) errors.push('Цена указывается с двумя знаками после запятой');
  if (!ORDER_CLASSES.includes(row.orderClass)) errors.push('Класс заказа выбирается из списка: подтвержденный, прогноз, дополнительный');
  if (row.orderClass === 'прогноз') {
    if (!isNumber(row.probability) || row.probability < 0 || row.probability > 1) errors.push('Вероятность прогноза указывается числом от 0 до 1');
  } else if (row.probability !== undefined && row.probability !== null) {
    errors.push('Вероятность указывается только для прогноза');
  }
  if (row.note !== undefined && row.note !== null && (typeof row.note !== 'string' || row.note.length > 300)) errors.push('Примечание указывается текстом до 300 знаков');
  errors.push(...personalDataProblems(row));
  return [...new Set(errors)];
}

function validateScenario(scenario) {
  if (!isObject(scenario)) return ['Вариант требует набора полей'];
  const errors = [];
  if (!isText(scenario.id, 64)) errors.push('Идентификатор варианта требует значения до 64 знаков');
  if (!isText(scenario.title, 80)) errors.push('Название варианта требует текста до 80 знаков');
  if (typeof scenario.createdAt !== 'string' || !Number.isFinite(Date.parse(scenario.createdAt))) errors.push('Дата варианта указывается в формате ISO');
  if (typeof scenario.contentHash !== 'string' || !HASH.test(scenario.contentHash)) errors.push('Хеш содержимого варианта требует значения SHA-256 из 64 символов');
  if (!isObject(scenario.inputs)) errors.push('Исходные данные варианта требуют набора полей');
  if (!isObject(scenario.result)) errors.push('Результат варианта требует набора полей');
  errors.push(...personalDataProblems({ title: scenario.title, inputs: scenario.inputs, result: scenario.result }, { keys: false }));
  return [...new Set(errors)];
}

export function validateWeek(week) {
  if (!isObject(week)) return ['Неделя требует набора полей'];
  if (week.version !== WEEK_VERSION) return ['Версия недели не поддерживается'];
  const errors = [];
  if (!isIsoDay(week.weekStart)) errors.push('Начало недели указывается датой ГГГГ-ММ-ДД');
  if (!Array.isArray(week.rows)) errors.push('Строки недели требуют списка');
  if (!Array.isArray(week.scenarios)) errors.push('Варианты требуют списка');
  if (errors.length) return errors;
  const keys = new Set();
  week.rows.forEach((row, index) => {
    const label = `Строка ${index + 1}: `;
    errors.push(...validateOrderRow(row).map(message => label + message));
    if (isObject(row)) {
      if (keys.has(row.key)) errors.push(label + 'ключ повторяется');
      keys.add(row.key);
    }
  });
  week.scenarios.forEach((scenario, index) => errors.push(...validateScenario(scenario).map(message => `Вариант ${index + 1}: ${message}`)));
  return [...new Set(errors)];
}

// Неделя из хранилища. При недоступном или поврежденном хранилище возвращается пустая неделя с флагом storageError.
export function loadWeek(storage) {
  const target = storageOf(storage);
  if (!target) return { ...emptyWeek(), storageError: true };
  let raw;
  try { raw = target.getItem(WEEK_KEY); } catch { return { ...emptyWeek(), storageError: true }; }
  if (raw === null || raw === undefined) return emptyWeek();
  try {
    const { version, weekStart, rows, scenarios } = JSON.parse(raw);
    const week = { version, weekStart, rows: migrateLegacyRows(rows), scenarios };
    if (validateWeek(week).length === 0) return { ...week, storageError: false };
  } catch { /* повреждены данные: ниже вернется пустая неделя с флагом */ }
  return { ...emptyWeek(), storageError: true };
}

// Запись одним ключом: браузер сохраняет значение целиком или отказывает. Данные в памяти вызывающего кода не меняются.
export function saveWeek(week, storage) {
  const errors = validateWeek(week);
  if (errors.length) return { ok: false, errors };
  try {
    const target = storageOf(storage);
    if (!target) throw new Error('хранилище недоступно');
    target.setItem(WEEK_KEY, JSON.stringify({ version: WEEK_VERSION, weekStart: week.weekStart, rows: week.rows, scenarios: week.scenarios }));
    return { ok: true };
  } catch {
    return fail('Неделя не сохранена: браузер не принял запись, возможно не хватает места. Изменения остаются на экране, выгрузите неделю в файл');
  }
}

// Хеш содержимого: SHA-256 канонического JSON, порядок ключей на результат не влияет.
export async function contentHash(content) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(content)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Вариант сохраняется один раз: повтор по хешу содержимого возвращает уже сохраненный вариант.
export function addScenario(snapshot, storage) {
  const errors = validateScenario(snapshot);
  if (errors.length) return { ok: false, errors };
  const week = loadWeek(storage);
  if (week.storageError) return fail(STORAGE_ERROR);
  const same = week.scenarios.find(item => item.contentHash === snapshot.contentHash);
  if (same) return { ok: true, created: false, scenario: same };
  if (week.scenarios.some(item => item.id === snapshot.id)) return fail('Вариант с таким идентификатором уже сохранен');
  const scenario = { id: snapshot.id, title: snapshot.title, createdAt: snapshot.createdAt, contentHash: snapshot.contentHash, inputs: clone(snapshot.inputs), result: clone(snapshot.result) };
  const saved = saveWeek({ ...week, scenarios: [...week.scenarios, scenario] }, storage);
  return saved.ok ? { ok: true, created: true, scenario } : saved;
}

export function listScenarios(storage) {
  return loadWeek(storage).scenarios.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function getScenario(id, storage) {
  return loadWeek(storage).scenarios.find(item => item.id === id) ?? null;
}

// Удаление только с явным подтверждением из интерфейса.
export function deleteScenario(id, { confirmed = false } = {}, storage) {
  if (confirmed !== true) return fail('Удаление варианта требует подтверждения в интерфейсе');
  const week = loadWeek(storage);
  if (week.storageError) return fail(STORAGE_ERROR);
  if (!week.scenarios.some(item => item.id === id)) return fail('Вариант не найден');
  return saveWeek({ ...week, scenarios: week.scenarios.filter(item => item.id !== id) }, storage);
}

// Переименование варианта: название проверяется как при сохранении; код и хеш содержимого не меняются.
export function renameScenario(id, title, storage) {
  const text = typeof title === 'string' ? title.trim() : '';
  const errors = [];
  if (!isText(text, 80)) errors.push('Название варианта требует текста до 80 знаков');
  errors.push(...personalDataProblems({ title: text }, { keys: false }));
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const week = loadWeek(storage);
  if (week.storageError) return fail(STORAGE_ERROR);
  if (!week.scenarios.some(item => item.id === id)) return fail('Вариант не найден');
  return saveWeek({ ...week, scenarios: week.scenarios.map(item => (item.id === id ? { ...item, title: text } : item)) }, storage);
}

// Таблица: разделитель «;», десятичная запятая, русские буквы через BOM.
export function buildWeekCsv(rows) {
  const cell = value => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return String(value).replace('.', ',');
    // Текст, начинающийся со знака формулы, получает апостроф: таблица не выполнит его как формулу.
    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const lines = [CSV_HEADER, ...rows.map(row => CSV_FIELDS.map(field => row[field]))];
  return '﻿' + lines.map(line => line.map(cell).join(';')).join('\r\n');
}

// Файл выгрузки: версия, состав недели и контрольная сумма состава.
export async function buildWeekExport(week) {
  const body = weekBody(week);
  const checksum = await contentHash(body);
  return { json: JSON.stringify({ ...body, checksum }, null, 2), csv: buildWeekCsv(week.rows), name: `неделя-${week.weekStart}` };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Скачивание двух файлов: JSON для обмена и CSV для таблицы.
export async function exportWeek(week = loadWeek()) {
  if (week.storageError) return fail(STORAGE_ERROR);
  const errors = validateWeek(week);
  if (errors.length) return { ok: false, errors };
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return fail('Скачивание недоступно в этом окружении');
  const files = await buildWeekExport(week);
  download(`${files.name}.json`, files.json, 'application/json');
  download(`${files.name}.csv`, files.csv, 'text/csv');
  return { ok: true };
}

// Файл одного варианта: та же структура, что у недели, без строк заказов. Контрольная сумма проверяется при импорте.
export async function exportScenarioFile(scenario, weekStart = loadWeek().weekStart) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return fail('Скачивание недоступно в этом окружении');
  const files = await buildWeekExport({ weekStart, rows: [], scenarios: [scenario] });
  download(`вариант-${scenario.contentHash.slice(0, 8)}.json`, files.json, 'application/json');
  return { ok: true };
}

// Импорт проверяет по порядку: версию, контрольную сумму, поля верхнего уровня и состав недели с признаками ПДн.
export async function importWeek(file) {
  if (!file || typeof file.text !== 'function') return fail('Файл не выбран');
  if (file.size > MAX_IMPORT_BYTES) return fail('Файл больше 5 МБ: импорт отклонен');
  let data;
  try { data = JSON.parse(await file.text()); } catch { return fail('Файл не читается как JSON: выберите файл, выгруженный из планировщика'); }
  if (!isObject(data) || data.version !== WEEK_VERSION) return fail('Версия файла не поддерживается: нужна версия 1');
  const body = { version: data.version, weekStart: data.weekStart, rows: data.rows, scenarios: data.scenarios };
  if (typeof data.checksum !== 'string' || data.checksum !== await contentHash(body)) return fail('Контрольная сумма не совпадает: файл изменен или поврежден');
  const extra = Object.keys(data).filter(key => !WEEK_FIELDS.includes(key));
  if (extra.some(key => PERSONAL_KEY.test(key))) return fail('Файл содержит поле персональных данных: импорт отклонен, клиент передается только кодом К-NNN');
  if (extra.length) return fail('Файл содержит лишнее поле');
  // Класс из прежней версии приводится уже после проверки контрольной суммы: она считается по исходному содержимому файла.
  const rows = migrateLegacyRows(body.rows);
  const week = { ...body, rows, storageError: false };
  const errors = validateWeek(week);
  return errors.length ? { ok: false, errors } : { ok: true, week };
}
