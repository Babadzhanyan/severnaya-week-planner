// Геометрия стакана цены и себестоимости филе: чистые функции без DOM.
// Все величины в CSS px. Ширина ступени равна объему, высота равна средней цене, площадь равна выручке.
// Шкала цены 0–400 руб. / кг, шкала объема в тоннах. Числа: разряды неразрывным пробелом, дробная часть запятой.

export const PRICE_MAX = 400;
export const PRICE_TICKS = Object.freeze([0, 100, 200, 300, 400]);
export const VOLUME_TICKS_T = Object.freeze([0, 100, 200, 300, 400]);
export const MIN_WIDTH = 280;
export const WIDE_MIN = 688;
export const SIZES = Object.freeze({
  axis: 40, gap: 24, stakan: 168, colW: 40, colStep: 64, fieldRight: 8,
  bandTop: 36, bandBottom: 28, narrowGap: 12, narrowStakanH: 160,
  calloutMaxW: 96, calloutPitch: 112, calloutH: 31, calloutLeaderY: 33, hitMin: 24,
});
export const HEAD_TEXT = 'Себестоимость, руб. / кг';

const clampPrice = value => Math.min(PRICE_MAX, Math.max(0, Number(value) || 0));

// Число с разрядами неразрывным пробелом и запятой. Не зависит от локали браузера.
export function fmtNum(value, digits = 0) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 'нет данных';
  const fixed = Math.abs(v).toFixed(digits);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const sign = v < 0 && Number(fixed) !== 0 ? '\u2212' : '';
  return `${sign}${grouped}${frac ? `,${frac}` : ''}`;
}

// Доля объема в подписях: до 10% с одним знаком, выше целым числом. Пример: 0,6%, 96%.
export function fmtShareRound(share) {
  const v = Number(share);
  return v >= 10 ? `${fmtNum(Math.round(v))}%` : `${fmtNum(v, 1)}%`;
}

// Оценка ширины текста без DOM: цифры, пробелы, знаки и буквы с запасом 8%.
const glyphEm = ch => {
  if (/\d/.test(ch)) return 0.56;
  if (/\s/.test(ch)) return 0.25;
  if (/[.,:]/.test(ch)) return 0.28;
  if (ch === '/') return 0.4;
  if (ch === '%') return 0.8;
  if (ch === '–' || ch === '-') return 0.5;
  return 0.55;
};
export const textWidth = (text, size) => [...String(text)].reduce((sum, ch) => sum + glyphEm(ch), 0) * size * 1.08;

// Прямоугольник подписи по базовой линии. anchor: start, middle или end.
export function labelBox(text, x, y, size, anchor = 'start') {
  const w = textWidth(text, size);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return {x: left, y: y - size * 0.74, w, h: size * 0.78};
}

export const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
// Пересечение отрезков {x1, y1, x2, y2}. Касание концами не считается пересечением.
export function segmentsIntersect(s1, s2) {
  const p1 = {x: s1.x1, y: s1.y1}, p2 = {x: s1.x2, y: s1.y2};
  const p3 = {x: s2.x1, y: s2.y1}, p4 = {x: s2.x2, y: s2.y2};
  return orient(p1, p2, p3) * orient(p1, p2, p4) < 0 && orient(p3, p4, p1) * orient(p3, p4, p2) < 0;
}

// Раскладка полос: поле, стакан справа (от 688 px) или под графиком (меньше 688 px).
export function layoutFor(width) {
  const W = Math.max(MIN_WIDTH, Math.round(Number(width) || 0));
  const H = Math.max(240, Math.min(320, Math.round(0.334 * W)));
  const wide = W >= WIDE_MIN;
  const plotH = H - SIZES.bandTop - SIZES.bandBottom;
  const plotW = wide
    ? W - SIZES.axis - SIZES.gap - SIZES.stakan - SIZES.fieldRight
    : W - SIZES.axis - SIZES.fieldRight;
  const plot = {x: SIZES.axis, y: SIZES.bandTop, w: plotW, h: plotH, bottom: SIZES.bandTop + plotH, right: SIZES.axis + plotW};
  let stakan;
  if (wide) {
    stakan = {x: plot.right + SIZES.gap, y: plot.y, w: SIZES.stakan, h: plotH, bottom: plot.bottom, headY: 14};
  } else {
    const top = H + SIZES.narrowGap;
    const h = SIZES.narrowStakanH - SIZES.bandBottom;
    stakan = {x: SIZES.axis, y: top, w: SIZES.stakan, h, bottom: top + h, headY: top + 12};
  }
  const svgHeight = wide ? H : H + SIZES.narrowGap + SIZES.narrowStakanH;
  return {width: W, height: H, svgHeight, wide, plot, stakan};
}

// Y координата цены в полосе (y – верх полосы, h – высота). Ноль внизу, 400 руб. / кг вверху.
export const priceY = (price, band) => band.y + band.h * (1 - clampPrice(price) / PRICE_MAX);

export function totalKg(steps) {
  return (steps ?? []).reduce((sum, step) => sum + step.kg, 0);
}

// Ступени: x и w пропорциональны накопленному объему, высота равна средней цене, hit – зона нажатия не меньше 24 px.
export function stepRects(steps, layout) {
  const list = steps ?? [];
  const total = totalKg(list);
  if (!(total > 0)) return [];
  const {plot} = layout;
  let mainIdx = 0;
  list.forEach((step, index) => { if (step.kg > list[mainIdx].kg) mainIdx = index; });
  let cum = 0;
  return list.map((step, index) => {
    const x = plot.x + (cum / total) * plot.w;
    const w = (step.kg / total) * plot.w;
    cum += step.kg;
    const top = priceY(step.avgPrice, plot);
    const cx = x + w / 2;
    const hitW = Math.max(SIZES.hitMin, w);
    return {
      index, from: step.from, to: step.to, kg: step.kg, price: step.avgPrice,
      revenue: step.kg * step.avgPrice, share: (step.kg / total) * 100, rows: step.rows ?? null,
      x, w, top, h: plot.bottom - top, cx, hit: {x: cx - hitW / 2, w: hitW}, main: index === mainIdx,
    };
  });
}

// Столбцы себестоимости: накопительные от нуля, шаг 64 px, ширина 40 px. Последний столбец – итог.
export function costColumns(cost, layout) {
  const list = cost ?? [];
  const band = layout.stakan;
  const sum = list.reduce((acc, item) => acc + item.value, 0);
  let run = 0;
  return list.map((item, index) => {
    run += item.value;
    const x = band.x + index * SIZES.colStep;
    return {
      index, id: item.id, label: item.label, delta: item.value, cum: run,
      share: sum > 0 ? (item.value / sum) * 100 : 0,
      total: index === list.length - 1,
      x, w: SIZES.colW, top: priceY(run, band), bottom: band.bottom, cx: x + SIZES.colW / 2,
    };
  });
}

// Выноски малых ступеней (ширина меньше 96 px) в полосе над полем. Подписи идут с шагом 112 px в порядке ступеней.
export function placeCallouts(steps, layout) {
  const small = stepRects(steps, layout).filter(r => r.w < SIZES.calloutMaxW);
  const pitch = small.length ? Math.min(SIZES.calloutPitch, layout.plot.w / small.length) : 0;
  return small.map((r, k) => {
    const x = layout.plot.x + k * pitch;
    const lines = [
      {text: `${fmtNum(r.price, 2)} руб. / кг`, x, y: 12, size: 12, cls: 'stakan-callout-value'},
      {text: `${fmtNum(r.kg)} кг`, x, y: 27, size: 12, cls: 'stakan-callout-sub'},
    ];
    return {
      index: r.index, x, y: 0, h: SIZES.calloutH, lines,
      leader: {x1: r.cx, y1: r.top, x2: x, y2: SIZES.calloutLeaderY},
    };
  });
}

// Подписи крупной ступени: «96%» в 28 px и строка 14 px над линией себестоимости. Строка делится, если не помещается.
export function mainLabelPlan(rect, costY) {
  const x = rect.x + 16;
  const range = `${rect.from}–${rect.to} руб. / кг`;
  const kgPrice = `${fmtNum(rect.kg)} кг, ${fmtNum(rect.price, 2)} руб. / кг`;
  const one = `${range}, ${kgPrice}`;
  const lines = textWidth(one, 14) <= rect.w - 32 ? [one] : [range, kgPrice];
  const lastBaseline = costY - 10;
  return {
    title: {text: fmtShareRound(rect.share), x, y: rect.top + 24, size: 28, cls: 'stakan-main-pct'},
    lines: lines.map((text, k) => ({
      text, x, y: lastBaseline - (lines.length - 1 - k) * 17, size: 14, cls: 'stakan-main-text',
    })),
  };
}

// Подписи столбца снизу вверх: приращение, накопленное значение, слово «Итог» у итогового столбца.
export function columnLabelPlan(col) {
  const out = [];
  let y = col.top - 6;
  if (col.index > 0) {
    out.push({text: `+${fmtNum(col.delta, 2)}`, x: col.cx, y, size: 12, cls: 'stakan-col-delta', anchor: 'middle'});
    y -= 16;
  }
  out.push({text: fmtNum(col.cum, 2), x: col.cx, y, size: 14, cls: 'stakan-col-value', anchor: 'middle'});
  y -= 17;
  if (col.total) out.push({text: 'Итог', x: col.cx, y, size: 12, cls: 'stakan-col-word', anchor: 'middle'});
  return out;
}

// Метки делений. Цена – по вертикали, объем в тоннах – по горизонтали.
export function bandTicks(band) {
  return PRICE_TICKS.map(value => ({value, y: priceY(value, band), text: fmtNum(value)}));
}

export function axisTicks(layout, kg) {
  const {plot} = layout;
  return {
    price: bandTicks(plot),
    volume: VOLUME_TICKS_T.map((t, k, all) => ({
      value: t,
      x: plot.x + ((t * 1000) / kg) * plot.w,
      text: k === all.length - 1 ? `${fmtNum(t)} т` : fmtNum(t),
    })),
  };
}

// Сверка: объем ступеней с итогом и выручка ступеней с итогом в пределах допуска. Итог без поля берется из ступеней.
export function checkTotals(steps, totals = {}, tolerance = {}) {
  const kg = totalKg(steps);
  const revenue = (steps ?? []).reduce((sum, s) => sum + s.kg * s.avgPrice, 0);
  const refKg = Number.isFinite(totals?.kg) ? totals.kg : kg;
  const refRevenue = Number.isFinite(totals?.revenue) ? totals.revenue : revenue;
  const tol = Number.isFinite(tolerance?.revenue) ? tolerance.revenue : 0;
  const kgDiff = kg - refKg;
  const revenueDiff = revenue - refRevenue;
  const kgOk = Math.abs(kgDiff) < 0.5;
  const revenueOk = Math.abs(revenueDiff) <= tol;
  return {kg, revenue, refKg, refRevenue, kgDiff, revenueDiff, tolerance: tol, kgOk, revenueOk, ok: kgOk && revenueOk};
}

// Клавиатура: стрелки проходят по порядку без цикла, Home и End – к краям.
export function moveIndex(current, key, count) {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return Math.min(last, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp': return Math.max(0, current - 1);
    case 'Home': return 0;
    case 'End': return last;
    default: return current;
  }
}

// Вся раскладка одним объектом: компонент рисует его, тесты проверяют подписи на пересечения.
export function buildScene(steps, cost, totals, width) {
  const layout = layoutFor(width);
  const {plot, stakan} = layout;
  const list = steps ?? [];
  const kg = totalKg(list);
  const rects = stepRects(list, layout);
  const costs = costColumns(cost ?? [], layout);
  const revenueSum = rects.reduce((sum, r) => sum + r.revenue, 0);
  const kgRef = Number.isFinite(totals?.kg) ? totals.kg : kg;
  const revenueRef = Number.isFinite(totals?.revenue) ? totals.revenue : revenueSum;
  const avg = kgRef > 0 ? revenueRef / kgRef : 0;
  const costTotal = costs.length ? costs[costs.length - 1].cum : 0;
  const costY = costs.length ? priceY(costTotal, plot) : null;
  const main = rects.find(r => r.main) ?? null;
  const callouts = layout.wide ? placeCallouts(list, layout) : [];
  const mainLabel = main ? mainLabelPlan(main, costY ?? plot.bottom) : null;
  const colLabels = costs.map(columnLabelPlan);
  const ticks = axisTicks(layout, kg || 1);
  const stakanTicks = layout.wide ? [] : bandTicks(stakan);
  const totalText = `Итог: ${fmtNum(kgRef)} кг, ${fmtNum(avg, 2)} руб. / кг`;
  const desc = [
    `Продано ${fmtNum(kgRef)} кг филе на ${fmtNum(revenueRef)} руб. Средняя цена ${fmtNum(avg, 2)} руб. / кг`,
    costs.length ? `, себестоимость ${fmtNum(costTotal, 2)} руб. / кг` : '',
    '.',
    main ? ` ${fmtShareRound(main.share)} объема продано по ${main.from}–${main.to} руб. / кг.` : '',
  ].join('');

  const labels = [];
  const add = (text, x, y, size, anchor = 'start') => labels.push(labelBox(text, x, y, size, anchor));
  add(totalText, plot.right, plot.y + 16, 12, 'end');
  ticks.price.forEach(t => add(t.text, plot.x - 6, t.y + 4, 12, 'end'));
  add('руб.', plot.x - 6, 12, 12, 'end');
  add('/ кг', plot.x - 6, 25, 12, 'end');
  ticks.volume.forEach(t => add(t.text, t.x, plot.bottom + 16, 12, 'middle'));
  stakanTicks.forEach(t => add(t.text, stakan.x - 6, t.y + 4, 12, 'end'));
  callouts.forEach(k => k.lines.forEach(l => add(l.text, l.x, l.y, l.size)));
  if (mainLabel) {
    add(mainLabel.title.text, mainLabel.title.x, mainLabel.title.y, 28);
    mainLabel.lines.forEach(l => add(l.text, l.x, l.y, l.size));
  }
  colLabels.forEach(group => group.forEach(l => add(l.text, l.x, l.y, l.size, 'middle')));
  if (costs.length) {
    costs.forEach(c => add(c.label, c.cx, stakan.bottom + 16, 12, 'middle'));
    add(HEAD_TEXT, stakan.x, stakan.headY, 12);
  }

  return {
    layout, kg, kgRef, revenueRef, avg, rects, costs, costTotal, costY, main, callouts,
    smalls: rects.filter(r => r.w < SIZES.calloutMaxW), mainLabel, colLabels, ticks, stakanTicks,
    totalText, desc, labels,
  };
}
