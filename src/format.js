export const n = (v, d = 1) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: d }).replace(/^-/, '−');
export const weekLabel = value => { const count = Math.abs(Math.trunc(Number(value))), last = count % 10, two = count % 100; return last === 1 && two !== 11 ? 'неделя' : last >= 2 && last <= 4 && (two < 12 || two > 14) ? 'недели' : 'недель'; };
export const money = v => n(v / 1e6, 2) + ' млн';
export const delta = v => (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v) / 1000, 1) + ' тыс.';
const TRAINING_SOURCE = 'Учебные данные';
// Подпись источника недели: реальные агрегаты с периодом из ответа недели, иначе учебные данные.
export const weekSourceLabel = week => week?.source === 'aggregates' ? `Реальные агрегаты: ${week.period?.label || 'Требуется подтверждение'}` : TRAINING_SOURCE;
// Неделя загружена из контракта: реальные агрегаты. Иначе показывается плашка «Учебные данные».
export const weekLoaded = week => week?.source === 'aggregates';
// Разбор ввода поля: запятая – десятичный знак, пробелы (в том числе неразрывные) – разряды.
export function parseFieldNumber(text) {
  const s = String(text ?? '').replace(/\s/g, '').replace(',', '.');
  if (s === '') return { kind: 'empty' };
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { kind: 'invalid' };
  return { kind: 'number', value: Number(s) };
}
// Решение при выходе из поля. Значение меняется только при допустимом вводе; любую корректировку до предела подтверждает пользователь.
export function fieldCommit({ text, current = null, min = 0, max = Infinity, unit = '', clearable = false }) {
  const u = unit ? ' ' + unit : '';
  const parsed = parseFieldNumber(text);
  if (parsed.kind === 'empty') return clearable ? { kind: 'clear' } : { kind: 'keep', message: `Введите число. Сохранено прежнее значение: ${n(current)}${u}` };
  if (parsed.kind === 'invalid') return { kind: 'keep', message: `Введите число, например 4,5. Сохранено прежнее значение: ${n(current)}${u}` };
  const value = parsed.value;
  if (current !== null && Math.abs(value - current) < 1e-9) return { kind: 'same', value };
  if (value > max) return { kind: 'confirm', value, apply: max, applyLabel: `Ограничить до ${n(max)}${u}`, message: `Значение ${n(value)}${u} больше допустимого предела ${n(max)}${u}` };
  if (value < min) return { kind: 'confirm', value, apply: min, applyLabel: `Ограничить до ${n(min)}${u}`, message: `Значение ${n(value)}${u} меньше допустимого минимума ${n(min)}${u}` };
  return { kind: 'apply', value };
}
export const clone = o => JSON.parse(JSON.stringify(o));
export const pathGet = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
export function pathSet(obj, path, value) {
  const copy = clone(obj), parts = path.split('.'), last = parts.pop();
  let node = copy;
  for (const p of parts) { node[p] ||= {}; node = node[p]; }
  node[last] = value;
  return copy;
}
export const prodName = (k, M) => M.products[k]?.name || k;
export function soldQty(r, k, S) {
  const a = r.allocations?.[k];
  return typeof a === 'number' ? a : a?.sold ?? a?.soldT ?? a?.allocated ?? Math.min(r.produced?.[k] || 0, S.p.demand?.[k] || 0);
}
export const productRows = r => Object.entries(r.produced || {}).filter(([k, v]) => v > 1e-8 && k !== 'loss').map(([id, qty]) => ({ id, qty }));
// Четыре раздела недели в порядке работы. Раздел «Ввод заказов» открывает данные недели; спрос и обзор – его экраны.
// Раздел «Варианты» сравнивает планы недели; экраны, не вошедшие в меню MVP, в разделах не перечислены.
export const SECTIONS = [
  {id:'orders', title:'Ввод заказов', views:[['files','Ввод заказов']], inner:[['demand','Спрос и цены'],['overview','Обзор']]},
  {id:'plan', title:'План недели', views:[['plan','План недели']]},
  {id:'variants', title:'Варианты', views:[['variants','Варианты']]},
  {id:'fact', title:'Факт и итоги', views:[['actual','Факт и итоги']]},
];
// Все экраны приложения. Вкладки раздела выводятся только при нескольких экранах в разделе.
export const VIEWS = SECTIONS.flatMap(section => [...section.views, ...(section.inner || [])]);
// Раздел экрана. Экраны без своего раздела относятся к плану.
export const sectionOf = view => SECTIONS.find(section => [...section.views, ...(section.inner || [])].some(([id]) => id === view)) || SECTIONS[1];
