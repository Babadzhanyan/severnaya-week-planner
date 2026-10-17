// Общий сценарий (Д02, Д07, Д11 на фронтенде): ключ, состав сохранения, миграция черновика, отдельная гипотеза и ответ на заявку.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  canonicalJson, fromSavePayload, migrateDraft, paramsVersion, readBrowserHypotheses, saveBrowserHypothesis, scenarioKey, toSavePayload,
} from '../src/scenario-state.js';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const [state, api, ui, views, plan] = await Promise.all(['../src/state.jsx', '../src/api.js', '../src/ui.jsx', '../src/views.jsx', '../src/PlanScreen.jsx'].map(source));

// Ключ сценария: поля отсортированы, разделители «,» и «:», отсутствующее значение – null.
const fields = {product: 'fillet', dataEdition: 'ed-1', day: '2026-04-06', zone: 'Z1', packing: 'valovaya', client: 'К-001', scheme: 'cut_fillet', paramsVersion: 'abc'};
assert.equal(scenarioKey(fields), '{"client":"К-001","dataEdition":"ed-1","day":"2026-04-06","packing":"valovaya","paramsVersion":"abc","product":"fillet","scheme":"cut_fillet","zone":"Z1"}');
assert.equal(scenarioKey({product: 'fillet'}), '{"client":null,"dataEdition":null,"day":null,"packing":null,"paramsVersion":null,"product":"fillet","scheme":null,"zone":null}');
assert.throws(() => scenarioKey({client: 'Иван Петров'}), /псевдонимом К-###/, 'Клиент только псевдонимом');
assert.throws(() => scenarioKey({day: '06.04.2026'}), /ГГГГ-ММ-ДД/, 'День только в формате ГГГГ-ММ-ДД');

// Канонический JSON и версия параметров: ключи отсортированы на всех уровнях; sha256 совпадает с эталоном Node.
assert.equal(canonicalJson({b: 1, a: {d: 2, c: [3, {z: 1, y: 2}]}}), '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
assert.equal(canonicalJson({a: undefined, b: 1}), '{"b":1}');
const params = {route: 'cut_fillet', totalInput: 10, cut: 4};
assert.equal(await paramsVersion(params), createHash('sha256').update(canonicalJson(params)).digest('hex'));

// Состав сохранения: ключ берется из сценария и схемы, содержимое – копия состояния.
const scenarioState = {
  p: {route: 'cut_fillet', totalInput: 10, cut: 4}, product: 'fillet', request: {quantity: 4, price: 300}, roi: {weeks: 52},
  client: {volume: 10}, revision: 2,
  scenario: {dataEdition: 'ed-1', day: '2026-04-06', zone: 'Z1', packing: null, client: 'К-001', paramsVersion: 'abc', name: 'Вариант А'},
};
const payload = toSavePayload(scenarioState);
assert.deepEqual(payload.keyFields, {dataEdition: 'ed-1', product: 'fillet', day: '2026-04-06', zone: 'Z1', packing: null, client: 'К-001', scheme: 'cut_fillet', paramsVersion: 'abc'});
assert.equal(payload.name, 'Вариант А');
assert.deepEqual(Object.keys(payload.content), ['params', 'request', 'roi', 'commercial']);
scenarioState.p.cut = 99;
assert.equal(payload.content.params.cut, 4, 'Содержимое сохранения не связано с состоянием после сохранения');

// Открытие сценария: схема сверяется с ключом; несовпадение не открывает сценарий.
const opened = fromSavePayload(payload);
assert.equal(opened.product, 'fillet');
assert.equal(opened.p.route, 'cut_fillet');
assert.equal(opened.scenario.name, 'Вариант А');
assert.equal(opened.scenario.client, 'К-001');
assert.throws(() => fromSavePayload({...payload, keyFields: {...payload.keyFields, scheme: 'whole'}}), /Схема разделки не совпадает/);

// Миграция черновика: схема 4 сохраняется; схема 3 сбрасывает утверждение и перечисляет основания.
const current = {schema: 4, state: {p: {route: 'whole'}}};
assert.deepEqual(migrateDraft(current), {state: current.state, changedBasis: []});
const legacy = migrateDraft({schema: 3, state: {p: {route: 'whole'}, approved: {x: 1}, confirms: {commercial: true, production: true, finance: true}}});
assert.deepEqual(legacy.changedBasis, ['Утверждение версии', 'Подтверждения участников']);
assert.equal(legacy.state.approved, null);
assert.deepEqual(legacy.state.confirms, {commercial: false, production: false, finance: false});
assert.deepEqual(migrateDraft({schema: 2, state: {p: {}}}), {state: null, changedBasis: []});
assert.deepEqual(migrateDraft(null), {state: null, changedBasis: []});

// Гипотезы в браузере: без хранилища запись не падает; с хранилищем повтор ключа заменяет запись.
assert.equal(saveBrowserHypothesis({key: 'k'}), false, 'Без localStorage запись возвращает false');
assert.deepEqual(readBrowserHypotheses(), []);
const memory = {};
globalThis.localStorage = {getItem: k => memory[k] ?? null, setItem: (k, v) => { memory[k] = String(v); }};
assert.equal(saveBrowserHypothesis({key: 'k1', name: 'А'}), true);
assert.equal(saveBrowserHypothesis({key: 'k2', name: 'Б'}), true);
assert.equal(saveBrowserHypothesis({key: 'k1', name: 'А2'}), true);
assert.deepEqual(readBrowserHypotheses().map(item => [item.key, item.name]), [['k1', 'А2'], ['k2', 'Б']], 'Повтор ключа заменяет запись и ставит ее первой');
delete globalThis.localStorage;

// Гипотеза не связана с утверждением: обработчик сохранения не читает подтверждения и утверждение.
const saveBody = state.slice(state.indexOf('async function saveHypothesis('), state.indexOf('function updateParams('));
assert.ok(saveBody.length > 200, 'Обработчик гипотезы найден');
assert.doesNotMatch(saveBody, /confirms|approve|operationBusy|opGeneration/, 'Гипотеза не ждет утверждения и не зависит от его занятости');
assert.match(saveBody, /hypothesisLock\.current/, 'Повторный щелчок не запускает второе сохранение');
// Сохранение только локальное (требование сбыта): серверная запись сценариев в интерфейсе не вызывается, повтор содержимого не дублирует вариант.
assert.match(saveBody, /addScenario\(await buildVariant\(/, 'Вариант сохраняется через локальное хранилище');
assert.doesNotMatch(state, /api\('scenarios'|api\('passport'/, 'Серверная запись сценариев в интерфейсе не вызывается');
assert.doesNotMatch(saveBody, /e\.status===409|saveBrowserHypothesis\(/, 'Ветка сервера и запасная гипотеза в браузере удалены');
assert.match(state, /if\(action==='save-hypothesis'\)\{saveHypothesis\(\);return;\}/);
assert.match(state, /Вариант сохранен в браузере: код /);
assert.match(state, /Такой вариант уже сохранен: код /, 'Повтор того же содержимого сообщается без второй записи');

// Миграция и единый объект сценария в состоянии.
assert.match(state, /migrateDraft\(saved \|\| old\)/);
assert.match(state, /Черновик перенесен\. Пересчитаны основания: /);
assert.match(state, /scenario:\{dataEdition:null,day:null,zone:null,packing:null,client:null,paramsVersion:null,name:'',baseRevision:null\}/);
assert.doesNotMatch(state, /schema:4,state:S/, 'Черновик пишется текущей схемой через константу');

// Сервер: ошибка сохраняет код ответа; демонстрационный режим сообщает об отсутствии сервера сценариев.
assert.match(api, /error\.status = response\.status/);
assert.match(api, /typeof detail === 'string' \? detail/);
assert.match(api, /endpoint === 'passport' \|\| endpoint\.startsWith\('scenarios'\)/);
assert.match(api, /Сервер сценариев не подключен/);

// Ответ на заявку: доступный объем, остаток, эффект всей корзины и главное ограничение.
assert.match(views, /<span>Доступно, т<\/span>/);
assert.match(views, /<span>Остаток, т<\/span>/);
assert.match(views, /<span>Эффект всей корзины, руб\.<\/span>/);
assert.match(views, /<strong>Главное ограничение:<\/strong>/);

// Четыре действия решения: сохранение гипотезы отдельно от утверждения производства.
assert.match(plan, /function DecisionBlock\(/);
assert.match(plan, /data-decision="approve"/);
assert.match(plan, /onApprove=\{\(\)=>setConfirmOpen\(true\)\}/);

// Поле: единственное место коррекции – подтверждаемая кнопка, без тихого ограничения.
assert.match(ui, /fieldCommit\(\{text:draft/);
assert.match(ui, /type="text" inputMode="decimal"/);
assert.doesNotMatch(ui, /Math\.max\(min,Math\.min\(max,v\)\)/, 'Тихое ограничение удалено');
assert.match(ui, /onMouseDown=\{keepFocus\}/, 'Кнопки исправления не забирают фокус у поля');

// Тексты: без буквы «ё» и тире в пользовательских файлах этой ветки.
for (const [name, text] of [['scenario-state.js', await source('../src/scenario-state.js')], ['state.jsx', state], ['api.js', api], ['ui.jsx', ui], ['views.jsx', views], ['PlanScreen.jsx', plan]]) {
  assert.doesNotMatch(text, /[ёЁ]/, `${name}: нет буквы «ё»`);
  assert.doesNotMatch(text, /—/, `${name}: нет тире (—)`);
}

console.log('Общий сценарий проверен: ключ, сохранение, миграция, отдельная гипотеза, ответ на заявку и поле ввода');
