export const n = (v, d = 1) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
export const weekLabel = value => { const count = Math.abs(Math.trunc(Number(value))), last = count % 10, two = count % 100; return last === 1 && two !== 11 ? 'неделя' : last >= 2 && last <= 4 && (two < 12 || two > 14) ? 'недели' : 'недель'; };
export const money = v => n(v / 1e6, 2) + ' млн';
export const delta = v => (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v) / 1000, 1) + ' тыс';
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
export const VIEWS = [['plan','План недели'],['demand','Спрос и сделки'],['scenarios','Рычаги и варианты'],['approval','Согласование'],['actual','План–факт'],['effect','Эффект решения']];
export const SHORT_VIEWS = ['План', 'Спрос', 'Варианты', 'Версия', 'План–факт', 'Эффект'];
export const TOUR = [
 ['plan','#flow','Начните с результата всей корзины','Одна тушка даёт несколько связанных продуктов. План показывает массу каждого выхода и вклад всей недели'],
 ['plan','#home-levers','Выберите способ разделки','Маршрут меняет выход продуктов, затраты и потребность в оборудовании'],
 ['demand','#demand-chart','Проверьте обязательства и спрос','Заказы входят в общий спрос. Заявка получает собственный резерв и проверку доступного выпуска'],
 ['scenarios','#bottlenecks','Найдите ограничивающий передел','Загрузка показывает, где дополнительная тонна требует изменения маршрута, времени или мощности'],
 ['scenarios','#alternatives','Выберите выполнимый вариант','Сравнение использует одинаковые внешние условия и результат всех совместных продуктов'],
 ['approval','#confirmations','Закрепите условия одной версией','Коммерция, производство и финансы подтверждают текущие параметры перед утверждением'],
 ['actual','#variance-chart','Свяжите отклонение с причиной','План–факт раскрывает влияние цены и затрат, ответственного и следующее действие'],
 ['effect','#effect-equation','Переведите решение в проверяемый эффект','Календарь, исполнение и затраты проекта связывают улучшение недели с денежным результатом']
];
