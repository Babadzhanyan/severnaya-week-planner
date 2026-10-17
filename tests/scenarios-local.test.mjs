import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {
  WEEK_KEY, addScenario, buildWeekExport, contentHash, deleteScenario, getScenario, listScenarios, loadWeek, renameScenario,
} from '../src/store/weekStore.js';
import {
  buildVariant, compareVariants, divergence, importVariants, restoreInputs, variantCode, variantContent, variantHashOk, variantSummary,
} from '../src/scenarios-local.js';

// Расчет берется из настоящей модели: сохраненный вклад должен совпасть с пересчетом после открытия варианта.
const context = {module: {exports: {}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports;
const clone = value => JSON.parse(JSON.stringify(value));
const memoryStorage = () => {
  const data = new Map();
  return {getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data};
};
const brokenStorage = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }};
const when = new Date('2026-10-17T09:00:00Z');
const weekStart = '2026-10-19';

const state = {
  p: clone(M.defaults()),
  request: {quantity: 4, price: 300, service: 0, requestId: 'demo-order-1', forecastAbsorption: true},
  roi: {weeks: 52, execution: 0.7, investment: null, annualOpex: null},
  client: {volume: 10, share: 75, price: 205, service: 15},
  product: 'fillet',
  scenario: {dataEdition: null, day: null, zone: null, packing: null, client: null, paramsVersion: null, name: 'Филе, разделка', baseRevision: null},
  revision: 3,
};
const live = M.evaluate(state.p);

// 1. Вариант: код, хеш и состав без названия.
const first = await buildVariant(state, live, {title: 'Филе, разделка', now: when});
assert.match(first.contentHash, /^[0-9a-f]{64}$/);
assert.equal(variantCode(first.contentHash), first.contentHash.slice(0, 8));
assert.equal(first.title, 'Филе, разделка');
assert.equal('name' in variantContent(state, live).inputs, false, 'Название не входит в содержимое варианта');

// 2. Хеш зависит только от содержимого: название, время и порядок ключей на него не влияют, цена влияет.
const renamed = await buildVariant({...state, scenario: {...state.scenario, name: 'Другое'}}, live, {title: 'Другое', now: new Date(0)});
assert.equal(renamed.contentHash, first.contentHash, 'Название и время не меняют хеш');
const reordered = {...state, p: Object.fromEntries(Object.entries(state.p).reverse())};
assert.equal((await buildVariant(reordered, live, {title: 'Филе', now: when})).contentHash, first.contentHash, 'Порядок ключей не меняет хеш');
const repriced = await buildVariant({...state, client: {...state.client, price: 210}}, live, {title: 'Филе', now: when});
assert.notEqual(repriced.contentHash, first.contentHash, 'Другая цена дает другой вариант');

// 3. Сохранение: повтор того же содержимого не создает второй объект; сбой записи понятен.
const store = memoryStorage();
const created = addScenario(first, store);
assert.deepEqual([created.ok, created.created], [true, true]);
const again = addScenario({...first, id: 'copy', title: 'Копия'}, store);
assert.deepEqual([again.ok, again.created], [true, false], 'Повтор по хешу не создает запись');
assert.equal(listScenarios(store).length, 1);
const second = await buildVariant({...state, client: {...state.client, price: 210}}, M.evaluate({...state.p}), {title: 'Цена 210', now: new Date('2026-10-17T10:00:00Z')});
assert.equal(addScenario(second, store).ok, true);
assert.equal(addScenario(first, brokenStorage).ok, false, 'Сбой записи не создает вариант');
assert.match(addScenario(first, brokenStorage).errors[0], /не сохранена|не сохранен/);

// 4. Закрыть вкладку и открыть снова: оба варианта на месте, результат совпадает побайтно.
const reopened = memoryStorage();
reopened.setItem(WEEK_KEY, store.data.get(WEEK_KEY));
const saved = getScenario(first.id, reopened);
assert.ok(saved, 'Первый вариант остался после перезапуска');
assert.equal(listScenarios(reopened).length, 2, 'Оба варианта на месте');
assert.equal(saved.contentHash, first.contentHash);
assert.deepEqual(saved.result, clone(live), 'Результат сохраняется без изменений');

// 5. Открытие: входы возвращаются, пересчет совпадает с сохраненным вкладом; изменение входа дает расхождение.
const restored = restoreInputs(saved);
assert.deepEqual(restored.p, clone(state.p), 'Параметры восстанавливаются целиком');
assert.equal(restored.product, 'fillet');
assert.equal(divergence(saved, M.evaluate(restored.p)), null, 'Пересчет после открытия не расходится с сохраненным вариантом');
const changed = clone(restored.p);
changed.totalInput += 10;
assert.ok(divergence(saved, M.evaluate(changed)), 'Изменение входа показывает расхождение');
assert.equal(divergence(saved, null), null, 'Без пересчета расхождение не выводится');
const mismatch = clone(saved);
mismatch.inputs.keyFields.scheme = 'whole';
assert.throws(() => restoreInputs(mismatch), /Схема разделки не совпадает/);
assert.throws(() => restoreInputs({title: 'Прежний формат', inputs: {routeCode: 'fillet'}}), /прежнем формате/, 'Вариант без ключа открывается с понятным текстом, а не с ошибкой схемы');

// 6. Файл варианта: экспорт и импорт восстанавливают тот же contentHash; повторный импорт не дублирует.
const exported = await buildWeekExport({weekStart, rows: [], scenarios: [saved]});
const target = memoryStorage();
const imported = await importVariants(new Blob([exported.json]), target);
assert.deepEqual([imported.ok, imported.added, imported.known], [true, 1, 0]);
assert.equal(listScenarios(target)[0].contentHash, first.contentHash, 'Хеш после импорта тот же');
assert.deepEqual(listScenarios(target)[0].result, clone(live));
const repeat = await importVariants(new Blob([exported.json]), target);
assert.deepEqual([repeat.added, repeat.known], [0, 1], 'Повторный импорт не создает второй объект');

// 7. Подмена: изменение без пересчета суммы отклоняется; подмена с пересчетом суммы отклоняется проверкой хеша варианта.
const tamperedFile = exported.json.replace('"contribution": 2600000', '"contribution": 2600001');
assert.notEqual(tamperedFile, exported.json, 'Подмена применена к файлу');
const rejectedFile = await importVariants(new Blob([tamperedFile]), memoryStorage());
assert.equal(rejectedFile.ok, false);
assert.match(rejectedFile.errors[0], /Контрольная сумма/);
const forged = {...saved, result: {...saved.result, contribution: 2600001}};
const forgedFile = await buildWeekExport({weekStart, rows: [], scenarios: [forged]});
const forgedRejected = await importVariants(new Blob([forgedFile.json]), memoryStorage());
assert.equal(forgedRejected.ok, false, 'Файл с пересчитанной суммой, но старым хешем варианта, отклоняется');
assert.match(forgedRejected.errors[0], /не совпадает с контрольной суммой/);
assert.equal(await variantHashOk(forged), false);
assert.equal(await variantHashOk(saved), true);

// 8. Файл с контактами отклоняется: поле персональных данных на верхнем уровне и в тексте варианта.
const withContact = {version: 1, weekStart, rows: [], scenarios: [], phone: '+7 999 000-11-22'};
const contactFile = JSON.stringify({...withContact, checksum: await contentHash({version: 1, weekStart, rows: [], scenarios: []})});
assert.equal((await importVariants(new Blob([contactFile]), memoryStorage())).ok, false);
const noteScenario = {...saved, title: 'Звонить +7 999 000-11-22', contentHash: (await buildVariant(state, live, {title: 'Ок', now: when})).contentHash};
const noteFile = await buildWeekExport({weekStart, rows: [], scenarios: [noteScenario]});
const noteRejected = await importVariants(new Blob([noteFile.json]), memoryStorage());
assert.equal(noteRejected.ok, false, 'Телефон в названии варианта отклоняется');
assert.match(noteRejected.errors.join(' '), /телефон/);

// 9. Переименование: название проверяется, код и хеш не меняются; контакты в названии отклоняются.
const target2 = memoryStorage();
addScenario(first, target2);
assert.deepEqual(renameScenario(first.id, '  Филе, вариант А  ', target2), {ok: true});
const afterRename = getScenario(first.id, target2);
assert.equal(afterRename.title, 'Филе, вариант А');
assert.equal(afterRename.contentHash, first.contentHash);
const phoneName = renameScenario(first.id, 'Звонить +7 999 000-11-22', target2);
assert.equal(phoneName.ok, false);
assert.match(phoneName.errors[0], /телефон/);
assert.equal(renameScenario(first.id, 'Ш'.repeat(81), target2).ok, false, 'Название длиннее 80 знаков отклоняется');
assert.deepEqual(renameScenario('missing', 'Имя', target2), {ok: false, errors: ['Вариант не найден']});

// 10. Удаление только с подтверждением.
assert.equal(deleteScenario(first.id, {}, target2).ok, false, 'Без подтверждения удаления нет');
assert.equal(listScenarios(target2).length, 1);
assert.deepEqual(deleteScenario(first.id, {confirmed: true}, target2), {ok: true});
assert.equal(getScenario(first.id, target2), null);

// 11. Сравнение двух вариантов: разница вклада в млн руб., совпадение схемы.
const rows = compareVariants(saved, second, M);
const contribution = rows.find(row => row.label === 'Вклад недели, млн руб.');
assert.equal(contribution.diff, (second.result.contribution - saved.result.contribution) / 1e6);
assert.equal(rows.find(row => row.label === 'Схема разделки').diff, 'совпадает');
assert.equal(rows.find(row => row.label === 'Статус').diff, 'совпадает');

// 12. Сводка для коллег: название, код, товар и вклад без клиентов и контактов.
const summary = variantSummary(saved, M);
assert.match(summary, new RegExp(`Код варианта: ${first.contentHash.slice(0, 8)}`));
assert.ok(summary.includes(`Товар: ${M.products.fillet.name}`));
assert.ok(summary.includes(`Схема разделки: ${M.routes.fillet.name}`));
assert.doesNotMatch(summary, /К-\d|@|\+7|ул\.|ФИО/, 'В сводке нет клиентов, ФИО и контактов');

// 13. Нет буквы «ё», тире и служебных знаков в файлах этой ветки (видимый текст и комментарии).
for (const file of ['../src/scenarios-local.js', '../src/print.css', '../src/ScenariosScreen.jsx', '../src/state.jsx']) {
  const text = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(text, /[ёЁ]/, `${file}: нет буквы «ё»`);
  assert.doesNotMatch(text, /—/, `${file}: нет тире (—)`);
  assert.doesNotMatch(text, /[·•]/, `${file}: нет средней точки и маркера`);
}

// 14. Печать и поделиться: кнопки вызывают window.print и выгрузку файла варианта; печать скрывает интерфейс.
const screen = await readFile(new URL('../src/ScenariosScreen.jsx', import.meta.url), 'utf8');
assert.match(screen, /window\.print\(\)/);
assert.match(screen, /Печать \/ PDF/);
assert.match(screen, /План недели Северная/);
assert.match(screen, /exportScenarioFile\(/);
assert.match(screen, /Скопировать сводку/);
const printCss = await readFile(new URL('../src/print.css', import.meta.url), 'utf8');
assert.match(printCss, /@media print/);
assert.match(printCss, /body>\*:not\(\.print-root\)\{display:none!important\}/);
assert.match(printCss, /\.print-foot\{position:fixed/, 'Подвал с датой и номером варианта повторяется на каждой странице');

console.log('Варианты в локальном хранилище: код, хеш, повтор, перезапуск, восстановление, файл, подмена, переименование, удаление, сравнение, сводка и печать проверены');
