export const n = (v, d = 1) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: d }).replace(/^-/, '−');
export const weekLabel = value => { const count = Math.abs(Math.trunc(Number(value))), last = count % 10, two = count % 100; return last === 1 && two !== 11 ? 'неделя' : last >= 2 && last <= 4 && (two < 12 || two > 14) ? 'недели' : 'недель'; };
export const money = v => n(v / 1e6, 2) + ' млн';
export const delta = v => (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v) / 1000, 1) + ' тыс.';
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
export const VIEWS = [['plan','План недели'],['demand','Заявки клиентов'],['scenarios','Сравнение планов'],['approval','Утверждение'],['actual','План–факт'],['effect','Годовой эффект']];
export const SHORT_VIEWS = ['План', 'Спрос', 'Варианты', 'Версия', 'План–факт', 'Эффект'];
export const TOUR = [
 ['plan','#week-inputs','Условия задают рамки недели','Здесь видны доступный объём охлаждённой тушки, цена сырья, заказы на целую тушку и мощность разделки'],
 ['plan','#home-levers','Вы решаете, сколько и как разделать','Выберите схему и измените тоннаж. Остальная тушка остаётся целой. Выпуск частей и денежный результат пересчитываются рядом'],
 ['plan','#alternatives','Три объёма показывают цену выбора','Нажмите на вариант 40% или 50%. Сравните обе массы и результат. Система проверяет спрос на каждую часть и загрузку производства'],
 ['plan','#week-result','Стакан объясняет вклад недели','Стакан показывает выручку, сырьё, обработку и итог на одной шкале. Изменение сравнивается с базой: 40% сырья в разделку по схеме филе и ножек'],
 ['demand','#demand-chart','Заявка проверяется вместе с выпуском','Выберите продукт, объём и цену. Проверка покажет доступное количество, изменение плана и денежный результат'],
 ['scenarios','#bottlenecks','Загрузка показывает, что ограничивает выпуск','Сравните потребность и доступный ресурс каждого передела. Мощности и заказы проверяются одновременно'],
 ['approval','#confirmations','Три функции подтверждают выбранный план','Коммерция проверяет спрос, производство проверяет выпуск, финансы проверяют затраты. Утверждение сохраняет эту версию'],
 ['actual','#variance-chart','План–факт объясняет изменение денег','В учебном факте изменены цена филе и затраты разделки. График показывает вклад каждой причины'],
 ['effect','#effect-equation','Годовой эффект учитывает повторяемость решения','Количество недель, доля реализации и расходы проекта переводят улучшение недели в годовой расчёт']
];
