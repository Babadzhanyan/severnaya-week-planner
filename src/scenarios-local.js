// Варианты недели в локальном хранилище: состав варианта, код, восстановление входов, сравнение, сводка для коллег и импорт файла.
// Чистые функции без React: проверяются в tests/scenarios-local.test.mjs.
import {addScenario, contentHash, importWeek, listScenarios} from './store/weekStore.js';
import {fromSavePayload, toSavePayload} from './scenario-state.js';
import {n} from './format.js';

const finite = value => (Number.isFinite(value) ? value : null);
const num = (value, digits = 1) => (Number.isFinite(value) ? n(value, digits) : '–');
const plainCopy = value => JSON.parse(JSON.stringify(value));

// Дата и время для текста: месяц словами.
export const dateText = iso => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'});
};

// Код варианта: первые восемь знаков хеша содержимого. Код не меняется при переименовании.
export const variantCode = hash => String(hash || '').slice(0, 8);

// Содержимое варианта: состав сохранения без названия (название меняется отдельно) и результат расчета в том виде, в каком он сохранен.
export function variantContent(state, result) {
  const {name, ...payload} = toSavePayload(state);
  return plainCopy({inputs: payload, result});
}

// Вариант к сохранению. Хеш считается по содержимому, поэтому повтор того же содержимого не создает новый объект.
export async function buildVariant(state, result, {title, now = new Date()}) {
  const {inputs, result: stored} = variantContent(state, result);
  const hash = await contentHash({inputs, result: stored});
  return {
    id: `${hash.slice(0, 12)}-${now.getTime().toString(36)}`,
    title: String(title ?? '').trim().slice(0, 80),
    createdAt: now.toISOString(),
    contentHash: hash,
    inputs,
    result: stored,
  };
}

// Проверка варианта из файла: хеш заново считается по содержимому и сверяется с записанным.
export async function variantHashOk(scenario) {
  return scenario?.contentHash === await contentHash({inputs: scenario.inputs, result: scenario.result});
}

// Входы варианта возвращаются в черновик. Схема разделки сверяется с ключом; при несовпадении функция бросает ошибку.
// Вариант, сохраненный до состава сохранения (без ключа), открыть нельзя: функция сообщает, что его нужно сохранить заново.
export function restoreInputs(scenario) {
  if (!scenario.inputs?.keyFields) throw new Error('Вариант сохранен в прежнем формате: сохраните его заново');
  return fromSavePayload({keyFields: scenario.inputs.keyFields, content: scenario.inputs.content, name: scenario.title});
}

// Расхождение пересчета: вклад недели после восстановления сравнивается с сохраненным с точностью до рубля.
export function divergence(scenario, live) {
  const saved = scenario?.result?.contribution, now = live?.contribution;
  if (!Number.isFinite(saved) || !Number.isFinite(now)) return null;
  return Math.abs(saved - now) < 1 ? null : {savedRub: saved, liveRub: now};
}

// Показатели варианта для списка, сравнения, печати и сводки.
export function variantFacts(scenario, M) {
  const result = scenario.result || {}, params = scenario.inputs?.content?.params || {}, keys = scenario.inputs?.keyFields || {};
  return {
    code: variantCode(scenario.contentHash),
    title: scenario.title,
    savedAt: scenario.createdAt,
    product: M?.products?.[keys.product]?.name || keys.product || '',
    route: M?.routes?.[params.route]?.name || params.route || '',
    volumeT: finite(params.totalInput),
    wholeT: finite(result.whole),
    cutT: finite(result.cut),
    contributionRub: finite(result.contribution),
    feasible: result.feasible === true,
  };
}

// Сравнение двух вариантов: числа с разницей (второй минус первый) и совпадение текстовых показателей.
export function compareVariants(first, second, M) {
  const a = variantFacts(first, M), b = variantFacts(second, M);
  const numeric = (label, key, scale, digits) => {
    const x = a[key] == null ? null : a[key] / scale, y = b[key] == null ? null : b[key] / scale;
    return {label, a: x, b: y, diff: x == null || y == null ? null : y - x, digits};
  };
  return [
    numeric('Вклад недели, млн руб.', 'contributionRub', 1e6, 2),
    numeric('Вход сырья, т', 'volumeT', 1, 1),
    numeric('Целой тушкой, т', 'wholeT', 1, 1),
    numeric('Разделка, т', 'cutT', 1, 1),
    {label: 'Схема разделки', a: a.route, b: b.route, diff: a.route === b.route ? 'совпадает' : 'отличается'},
    {label: 'Статус', a: a.feasible ? 'В норме' : 'Риск', b: b.feasible ? 'В норме' : 'Риск', diff: a.feasible === b.feasible ? 'совпадает' : 'отличается'},
  ];
}

// Текст для коллег: показатели варианта без клиентов, ФИО, телефонов и адресов. Клиенты в сводку не попадают.
export function variantSummary(scenario, M) {
  const f = variantFacts(scenario, M);
  return [
    'План недели Северная',
    `Вариант: ${f.title}`,
    `Код варианта: ${f.code}`,
    `Сохранен: ${dateText(f.savedAt)}`,
    `Товар: ${f.product}`,
    `Схема разделки: ${f.route}`,
    `Вход сырья: ${num(f.volumeT)} т`,
    `Целой тушкой: ${num(f.wholeT)} т, разделка: ${num(f.cutT)} т`,
    `Вклад недели: ${num(f.contributionRub == null ? null : f.contributionRub / 1e6, 2)} млн руб.`,
    `Статус: ${f.feasible ? 'В норме' : 'Риск: требует изменения'}`,
  ].join('\n');
}

// Импорт файла варианта или недели. Проверяются контрольная сумма файла и хеш каждого варианта; строки заказов этот экран не применяет.
// Вариант с занятым идентификатором и другим содержимым получает новый идентификатор; повтор того же содержимого не создает запись.
export async function importVariants(file, storage) {
  const imported = await importWeek(file);
  if (!imported.ok) return imported;
  const items = imported.week.scenarios;
  for (const item of items) {
    if (!(await variantHashOk(item))) return {ok: false, errors: [`Вариант «${item.title}»: содержимое не совпадает с контрольной суммой`]};
  }
  let added = 0, known = 0;
  for (const item of items) {
    const taken = listScenarios(storage).some(saved => saved.id === item.id && saved.contentHash !== item.contentHash);
    const saved = addScenario(taken ? {...item, id: `${item.contentHash.slice(0, 12)}-${Date.now().toString(36)}`} : item, storage);
    if (!saved.ok) return {...saved, added, known};
    if (saved.created) added += 1; else known += 1;
  }
  return {ok: true, added, known, rowsSkipped: imported.week.rows.length};
}
