import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  WEEK_KEY, WEEK_VERSION, emptyWeek, loadWeek, saveWeek, validateOrderRow, validateWeek,
  addScenario, listScenarios, getScenario, deleteScenario, contentHash, buildWeekExport, buildWeekCsv,
  importWeek, exportWeek,
} from '../src/store/weekStore.js';

// Все сообщения об ошибках проходят через seen: в конце проверяется, что в них нет буквы «ё».
const seen = [];
const messages = list => (seen.push(...list), list);

function memoryStorage() {
  const data = new Map();
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}
const brokenStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
const row = { key: 'r1', clientCode: 'К-001', product: 'Филе', day: '2026-10-19', zone: 'Центр', channel: 'Опт', volumeKg: 1250, priceRubKg: 288.98, orderClass: 'подтвержден', note: 'Заказ по договору' };
const hashOf = n => n.toString(16).padStart(64, '0');
const scenario = (id, n, extra = {}) => ({ id, title: 'Вариант ' + id, createdAt: '2026-10-17T09:00:00Z', contentHash: hashOf(n), inputs: { volumeKg: 1000 }, result: { marginRub: 5 }, ...extra });

// 1. Пустая неделя по умолчанию: 18–23 октября 2026, воскресенье – пятница.
const empty = emptyWeek();
assert.equal(empty.weekStart, '2026-10-18');
assert.equal(empty.version, WEEK_VERSION);
assert.deepEqual(empty.rows, []);

// 2. Пустое хранилище и сохранение с повторным чтением.
const storage = memoryStorage();
assert.deepEqual([loadWeek(storage).storageError, loadWeek(storage).rows], [false, []]);
assert.deepEqual(saveWeek({ ...empty, rows: [row] }, storage), { ok: true });
assert.deepEqual(loadWeek(storage).rows, [row]);

// 3. Строка с неверным клиентом не записывается, прежние данные остаются.
const rejected = saveWeek({ ...empty, rows: [{ ...row, clientCode: 'client1' }] }, storage);
assert.equal(rejected.ok, false);
assert.ok(messages(rejected.errors).some(m => m.includes('К-NNN')));
assert.deepEqual(loadWeek(storage).rows, [row]);

// 4. Сбой записи: сообщение понятное, данные в памяти не меняются.
const inMemory = { ...empty, rows: [row] };
const failed = saveWeek(inMemory, brokenStorage);
assert.equal(failed.ok, false);
assert.match(messages(failed.errors)[0], /не сохранена/);
assert.deepEqual(inMemory.rows, [row]);

// 5. Сбой чтения и поврежденные данные: пустая неделя с флагом storageError.
assert.equal(loadWeek(brokenStorage).storageError, true);
const corrupt = memoryStorage();
corrupt.setItem(WEEK_KEY, '{broken');
assert.deepEqual([loadWeek(corrupt).storageError, loadWeek(corrupt).rows], [true, []]);

// 6. Проверка строки: верная строка принимается, каждый вид ошибки дает понятное сообщение.
assert.deepEqual(validateOrderRow(row), []);
const cases = [
  [{ clientCode: 'К-1' }, 'К-NNN'],
  [{ clientCode: 'K-001' }, 'К-NNN'],
  [{ volumeKg: 1.5 }, 'целым'],
  [{ volumeKg: -5 }, 'отрицательным'],
  [{ priceRubKg: -1 }, 'отрицательной'],
  [{ priceRubKg: 288.123 }, 'двумя знаками'],
  [{ orderClass: 'черновик' }, 'Класс заказа'],
  [{ orderClass: 'прогноз' }, 'от 0 до 1'],
  [{ orderClass: 'прогноз', probability: 1.2 }, 'от 0 до 1'],
  [{ probability: 0.5 }, 'только для прогноза'],
  [{ day: '2026-02-30' }, 'ГГГГ-ММ-ДД'],
  [{ note: 'Звонить +7 999 000-11-22' }, 'телефон'],
  [{ note: 'ivanov@example.test' }, 'e-mail'],
  [{ note: 'ул. Тестовая, 1' }, 'адрес'],
  [{ name: 'Пример Тестовый' }, 'персональным данным'],
  [{ phone: '' }, 'персональным данным'],
  [{ manager: 'Служебный' }, 'персональным данным'],
  [{ extra: 1 }, 'лишнее поле'],
];
for (const [patch, expected] of cases) {
  const errors = messages(validateOrderRow({ ...row, ...patch }));
  assert.ok(errors.some(m => m.includes(expected)), `${Object.keys(patch)}: ${errors}`);
}

// 7. Таблица: разделитель «;», десятичная запятая, экранирование и защита от формул.
const csv = buildWeekCsv([row, { ...row, key: 'r2', product: '=1+1', priceRubKg: 300, probability: null, orderClass: 'дополнительно', note: 'Сверить "с" заказом' }]);
assert.ok(csv.startsWith('﻿Ключ;Клиент;Продукт;День;Зона;Канал;Объем, кг;Цена, руб./кг;Класс заказа;Вероятность;Примечание\r\n'));
const lines = csv.slice(1).split('\r\n');
assert.equal(lines[1], 'r1;К-001;Филе;2026-10-19;Центр;Опт;1250;288,98;подтвержден;;Заказ по договору');
assert.ok(!/[ёЁ]/.test(csv), 'в таблице выгрузки нет буквы «ё»');
assert.equal(lines[2], 'r2;К-001;\'=1+1;2026-10-19;Центр;Опт;1250;300;дополнительно;;"Сверить ""с"" заказом"');

// 8. Контрольная сумма: совпадает с SHA-256 канонического JSON.
assert.equal(await contentHash({ b: 1, a: 'х' }), createHash('sha256').update('{"a":"х","b":1}', 'utf8').digest('hex'));

// 9. Выгрузка и импорт возвращают тот же состав недели.
const week = { weekStart: '2026-10-19', rows: [row], scenarios: [scenario('s1', 1)] };
const exported = await buildWeekExport(week);
const parsed = JSON.parse(exported.json);
assert.equal(parsed.version, WEEK_VERSION);
assert.equal(parsed.checksum, await contentHash({ version: WEEK_VERSION, weekStart: week.weekStart, rows: week.rows, scenarios: week.scenarios }));
const imported = await importWeek(new Blob([exported.json]));
assert.equal(imported.ok, true);
assert.deepEqual(imported.week.rows, [row]);
assert.deepEqual(imported.week.scenarios, [scenario('s1', 1)]);

// 10. Импорт отклоняет подмену, чужую версию, не JSON и файл с контактами при верной сумме.
const tampered = await importWeek(new Blob([exported.json.replace('"volumeKg": 1250', '"volumeKg": 1251')]));
assert.match(messages(tampered.errors)[0], /Контрольная сумма/);
const oldVersion = await importWeek(new Blob([exported.json.replace('"version": 1', '"version": 2')]));
assert.match(messages(oldVersion.errors)[0], /Версия/);
const notJson = await importWeek(new Blob(['{nope']));
assert.match(messages(notJson.errors)[0], /JSON/);
// Класс из прежней версии файла: импорт принимает его при верной сумме и приводит к «подтвержден». Значение собирается кодом, чтобы не писать букву «ё» в тексте.
const LEGACY_CONFIRMED = 'подтвержд' + String.fromCharCode(0x451) + 'н';
const legacyBody = { version: WEEK_VERSION, weekStart: week.weekStart, rows: [{ ...row, orderClass: LEGACY_CONFIRMED }], scenarios: [] };
const legacy = await importWeek(new Blob([JSON.stringify({ ...legacyBody, checksum: await contentHash(legacyBody) })]));
assert.equal(legacy.ok, true);
assert.deepEqual(legacy.week.rows, [row]);
assert.ok(validateOrderRow({ ...row, orderClass: LEGACY_CONFIRMED }).some(m => m.includes('Класс заказа')), 'в хранилище старый класс не принимается');
// Открытие недели из хранилища со старым классом: класс приводится к «подтвержден», неделя не теряется.
const legacyStorage = memoryStorage();
legacyStorage.setItem(WEEK_KEY, JSON.stringify({ version: WEEK_VERSION, weekStart: week.weekStart, rows: [{ ...row, orderClass: LEGACY_CONFIRMED }], scenarios: [] }));
assert.deepEqual([loadWeek(legacyStorage).storageError, loadWeek(legacyStorage).rows], [false, [row]]);
const withName = { version: WEEK_VERSION, weekStart: week.weekStart, rows: [{ ...row, name: 'Пример Тестовый' }], scenarios: [] };
const nameFile = JSON.stringify({ ...withName, checksum: await contentHash(withName) });
const nameRejected = await importWeek(new Blob([nameFile]));
assert.equal(nameRejected.ok, false);
assert.ok(messages(nameRejected.errors).some(m => m.includes('персональным данным')));
const withContacts = { version: WEEK_VERSION, weekStart: week.weekStart, rows: [], scenarios: [] };
const contactsFile = JSON.stringify({ ...withContacts, contacts: [], checksum: await contentHash(withContacts) });
assert.equal((await importWeek(new Blob([contactsFile]))).ok, false);

// 11. Дубли ключей строк отклоняются.
assert.ok(messages(validateWeek({ version: WEEK_VERSION, weekStart: '2026-10-19', rows: [row, { ...row }], scenarios: [] })).some(m => m.includes('повторяется')));

// 12. Варианты: дубль по хешу не создается, неверные данные отклоняются, при сбое хранилища запись не выполняется.
const store = memoryStorage();
const created = addScenario(scenario('s1', 1), store);
assert.deepEqual([created.ok, created.created], [true, true]);
const duplicate = addScenario(scenario('s2', 1), store);
assert.deepEqual([duplicate.ok, duplicate.created], [true, false]);
assert.equal(listScenarios(store).length, 1);
assert.equal(getScenario('s1', store).id, 's1');
assert.equal(getScenario('missing', store), null);
assert.equal(addScenario({ ...scenario('s3', 3), contentHash: 'xyz' }, store).ok, false);
const phoneTitle = addScenario({ ...scenario('s4', 4), title: 'Звонить +7 999 000-11-22' }, store);
assert.equal(phoneTitle.ok, false);
assert.ok(messages(phoneTitle.errors).some(m => m.includes('телефон')));
assert.equal(addScenario(scenario('s5', 5), brokenStorage).ok, false);
assert.equal(addScenario(scenario('s7', 7, { result: { productName: 'Филе' } }), store).ok, true);
const phoneResult = addScenario(scenario('s8', 8, { result: { note: '+7 999 000-11-22' } }), store);
assert.equal(phoneResult.ok, false);
assert.ok(messages(phoneResult.errors).some(m => m.includes('телефон')));
addScenario(scenario('s6', 6, { createdAt: '2026-10-18T09:00:00Z' }), store);
assert.deepEqual(listScenarios(store).map(item => item.id), ['s6', 's1', 's7']);

// 13. Удаление требует явного подтверждения.
assert.equal(deleteScenario('s1', {}, store).ok, false);
assert.equal(listScenarios(store).length, 3);
assert.deepEqual(deleteScenario('s1', { confirmed: true }, store), { ok: true });
assert.equal(getScenario('s1', store), null);

// 14. Скачивание без браузера отказывает понятным сообщением, а не падает.
const download = await exportWeek({ ...empty, rows: [row] });
assert.equal(download.ok, false);
assert.match(messages(download.errors)[0], /недоступно/);

// 15. Во всех сообщениях нет буквы «ё».
for (const message of seen) assert.ok(!/[ёЁ]/.test(message), message);

console.log('week-store: все проверки пройдены');
