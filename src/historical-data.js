// Исторические ступени цены, накопительные расчеты и разбор разницы вариантов для графиков Д08.
// Агрегаты апреля 2026 взяты из исторического комплекта графиков (разделы ступеней и себестоимости).
// Строки клиентов в файле не читались и не сохранены: здесь только суммы по диапазонам и производственные статьи.
// Функции чистые: без DOM и без обращения к серверу.

export const PRICE_BIN_RUB_KG = 25;

// Отступы поля ценового графика (Визуальная спецификация): слева 64, справа 16, сверху 24, снизу 36.
export const PRICE_CHART_MARGIN = Object.freeze({left: 64, right: 16, top: 24, bottom: 36});

const finite = value => typeof value === 'number' && Number.isFinite(value);

// Геометрия поля графика. При ширине 490 область построения равна 410 × 180; при 533 × 358 равна 453 × 298.
export function priceChartGeometry(width = 490, height = 240) {
  const m = PRICE_CHART_MARGIN;
  return {
    width,
    height,
    left: m.left,
    right: m.right,
    top: m.top,
    bottom: m.bottom,
    plotWidth: Math.max(160, width - m.left - m.right),
    plotHeight: Math.max(90, height - m.top - m.bottom),
  };
}

// Строка истории: объем и цена попадают в расчет, только если объем и выручка положительны (как в источнике).
const usableRow = row => Boolean(row) && finite(row.priceRubKg) && finite(row.qtyKg) && row.priceRubKg > 0 && row.qtyKg > 0;

// Ступени упорядочены от высокой цены к низкой. Ширина ступени равна объему, накопленная позиция продолжает предыдущую.
const finalizeSteps = bins => {
  const ordered = [...bins].sort((a, b) => b.fromRubKg - a.fromRubKg);
  const totalKg = ordered.reduce((sum, bin) => sum + bin.volumeKg, 0);
  let cumKg = 0;
  return ordered.map(bin => {
    const step = {
      fromRubKg: bin.fromRubKg,
      toRubKg: bin.toRubKg,
      rows: bin.rows,
      volumeKg: bin.volumeKg,
      revenueRub: bin.revenueRub,
      weightedPriceRubKg: bin.revenueRub / bin.volumeKg,
      shareOfVolumePct: totalKg > 0 ? (bin.volumeKg / totalKg) * 100 : 0,
      cumFromKg: cumKg,
      cumToKg: cumKg + bin.volumeKg,
    };
    cumKg += bin.volumeKg;
    return step;
  });
};

// Ступени из строк истории: {productId, period, priceRubKg, qtyKg}.
export function buildPriceSteps(rows, binRubKg = PRICE_BIN_RUB_KG) {
  if (!finite(binRubKg) || binRubKg <= 0) throw new RangeError('Ширина диапазона цены должна быть положительным числом');
  const bins = new Map();
  for (const row of rows ?? []) {
    if (!usableRow(row)) continue;
    const fromRubKg = Math.floor(row.priceRubKg / binRubKg) * binRubKg;
    const bin = bins.get(fromRubKg) ?? {fromRubKg, toRubKg: fromRubKg + binRubKg, rows: 0, volumeKg: 0, revenueRub: 0};
    bin.rows += 1;
    bin.volumeKg += row.qtyKg;
    bin.revenueRub += row.priceRubKg * row.qtyKg;
    bins.set(fromRubKg, bin);
  }
  return finalizeSteps(bins.values());
}

// Итог истории: средняя цена сделки равна выручке, деленной на объем.
export function historySummary(rows) {
  let count = 0;
  let volumeKg = 0;
  let revenueRub = 0;
  for (const row of rows ?? []) {
    if (!usableRow(row)) continue;
    count += 1;
    volumeKg += row.qtyKg;
    revenueRub += row.priceRubKg * row.qtyKg;
  }
  return {rows: count, volumeKg, revenueRub, avgPriceRubKg: volumeKg > 0 ? revenueRub / volumeKg : null};
}

// Агрегаты диапазонов: {fromRubKg, toRubKg, rows, volumeKg, revenueRub}. Та же форма ступеней, что у buildPriceSteps.
export function stepsFromAggregates(aggregates) {
  return finalizeSteps((aggregates ?? []).map(item => ({...item})));
}

// Факт апреля 2026: филе грудки без кожи, 120 строк, пять диапазонов по 25 руб. / кг.
export const FILLET_HISTORY_APRIL_2026 = Object.freeze({
  productName: 'Филе грудки без кожи ц/б',
  periodLabel: 'Апрель 2026',
  source: 'сводка отгрузок апреля 2026, строки клиентов не выводятся',
  aggregates: Object.freeze([
    Object.freeze({fromRubKg: 375, toRubKg: 400, rows: 3, volumeKg: 3210, revenueRub: 1253200.75}),
    Object.freeze({fromRubKg: 350, toRubKg: 375, rows: 15, volumeKg: 15900, revenueRub: 5687727.23}),
    Object.freeze({fromRubKg: 325, toRubKg: 350, rows: 3, volumeKg: 1380, revenueRub: 467372.72}),
    Object.freeze({fromRubKg: 300, toRubKg: 325, rows: 6, volumeKg: 1380, revenueRub: 420272.7}),
    Object.freeze({fromRubKg: 275, toRubKg: 300, rows: 93, volumeKg: 484875, revenueRub: 138612827.47}),
  ]),
  totals: Object.freeze({rows: 120, volumeKg: 506745, revenueRub: 146441400.87}),
});

// Производственные статьи из калькуляции апреля 2026 (руб. / кг выпуска). Названия статей даны в написании интерфейса.
export const COST_FACTS_APRIL_2026 = Object.freeze([
  Object.freeze({
    productName: 'Филе грудки без кожи ц/б',
    productionCostRubKg: 141.4867668078673,
    articles: Object.freeze([
      Object.freeze({name: 'Сырье', rubKg: 117.33936551009384}),
      Object.freeze({name: 'Цех', rubKg: 20.01006870324499}),
      Object.freeze({name: 'Упаковка', rubKg: 4.137332594528458}),
    ]),
    sourceLabel: 'Калькуляция себестоимости продукции, апрель 2026',
  }),
  Object.freeze({
    productName: 'Бескостное бедро без кожи ц/б',
    productionCostRubKg: 141.9475847509732,
    articles: Object.freeze([
      Object.freeze({name: 'Сырье', rubKg: 117.33936551009381}),
      Object.freeze({name: 'Цех', rubKg: 20.010068703244983}),
      Object.freeze({name: 'Упаковка', rubKg: 4.5981505376344085}),
    ]),
    sourceLabel: 'Калькуляция себестоимости продукции, апрель 2026',
  }),
]);

// Статьи вне итога: состояние «Требуется подтверждение» до решения владельца (финансы).
export const COST_EXCLUDED_FROM_TOTAL = Object.freeze(['Логистика', 'Коммерческие расходы', 'Общехозяйственные расходы']);

const plain = text => String(text ?? '').normalize('NFD').replace(/\u0308/g, '').normalize('NFC');
const ARTICLE_IDS = Object.freeze({'Сырье': 'raw', 'Цех': 'shop', 'Упаковка': 'pack'});

// Накопительный стакан себестоимости: статьи идут подряд от нуля, итог начинается от нуля и равен сумме статей.
export function buildCostStack(facts) {
  const articles = Array.isArray(facts?.articles) ? facts.articles : [];
  if (articles.length === 0) return [];
  let running = 0;
  const steps = articles.map((article, index) => {
    if (!finite(article.rubKg)) throw new TypeError(`Статья ${plain(article.name)}: нужно число руб. / кг`);
    const label = plain(article.name);
    const fromRubKg = running;
    running += article.rubKg;
    return {
      id: ARTICLE_IDS[label] ?? `article-${index + 1}`,
      label,
      fromRubKg,
      toRubKg: running,
      deltaRubKg: article.rubKg,
      total: false,
      sourceLabel: facts.sourceLabel ?? null,
    };
  });
  steps.push({
    id: 'total',
    label: 'Итог, руб. / кг выпуска',
    fromRubKg: 0,
    toRubKg: running,
    deltaRubKg: running,
    total: true,
    sourceLabel: facts.sourceLabel ?? null,
  });
  return steps;
}

// Сверка стакана с сохраненным итогом калькуляции: допуск 1e-7 относительно величины.
export function checkCostStack(facts, steps) {
  const sumRubKg = steps.length ? steps[steps.length - 1].toRubKg : 0;
  const sourceRubKg = facts?.productionCostRubKg;
  const diff = sumRubKg - sourceRubKg;
  return {
    sumRubKg,
    sourceRubKg,
    diff,
    ok: finite(sourceRubKg) && Math.abs(diff) <= 1e-7 * Math.max(1, Math.abs(sourceRubKg)),
  };
}

// Разложение разницы двух вариантов фиксированным методом: каждый фактор меняется от базы к варианту по одному,
// взаимодействия равны остатку. Сумма шагов совпадает с разницей вариантов.
export function decomposeDifference(base, variant, factors, evaluate) {
  if (typeof evaluate !== 'function') throw new TypeError('Нужна функция расчета результата');
  const keys = (factors ?? []).map(factor => factor.key);
  if (new Set(keys).size !== keys.length || keys.includes('interaction')) throw new TypeError('Ключи факторов должны быть уникальными');
  const start = evaluate({...base});
  const end = evaluate({...variant});
  if (!finite(start) || !finite(end)) throw new TypeError('Расчет результата должен возвращать число');
  const total = end - start;
  const effects = factors.map(({key, label}) => {
    const value = evaluate({...base, [key]: variant[key]});
    if (!finite(value)) throw new TypeError(`Фактор ${label}: расчет не вернул число`);
    return {key, label, delta: value - start};
  });
  const interaction = total - effects.reduce((sum, effect) => sum + effect.delta, 0);
  return {
    base: start,
    variant: end,
    total,
    steps: [...effects, {key: 'interaction', label: 'Взаимодействия', delta: interaction}],
  };
}
