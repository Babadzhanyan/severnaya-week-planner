// Проверки стакана цены и себестоимости: геометрия, подписи, сверка, клавиатура, CSS и разметка.
// Запуск из каталога platform: node tests/stakan-geometry.test.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {
  layoutFor, costColumns, buildScene, checkTotals, moveIndex, fmtNum, fmtShareRound,
  segmentsIntersect, boxesOverlap, priceY, textWidth,
} from '../src/stakan/geometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stakanDir = new URL('../src/stakan/', import.meta.url);
let checks = 0;
const check = (condition, message) => { checks++; assert.ok(condition, message); };
const near = (actual, expected, tolerance, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${message}: ${actual} / ${expected}`);
// Буква с двумя точками: NFD раскладывает ее на е и U+0308. Саму букву в тесте не пишем.
const noYo = text => !/\u0308/.test(String(text).normalize('NFD'));
const plainSpaces = text => String(text).replace(/\u00A0/g, ' ');

// Данные спецификации: средние цены с четырьмя знаками, себестоимость по статьям, итоги источника.
const STEPS = [
  {from: 375, to: 400, kg: 3210, avgPrice: 390.4052, rows: null},
  {from: 350, to: 375, kg: 15900, avgPrice: 357.7187, rows: null},
  {from: 325, to: 350, kg: 1380, avgPrice: 338.6759, rows: null},
  {from: 300, to: 325, kg: 1380, avgPrice: 304.5454, rows: null},
  {from: 275, to: 300, kg: 484875, avgPrice: 285.8733, rows: null},
];
const COST = [
  {id: 'raw', label: 'Сырье', value: 117.3393655},
  {id: 'plant', label: 'Цех', value: 20.0100687},
  {id: 'pack', label: 'Упаковка', value: 4.1373326},
];
const TOTALS = {kg: 506745, revenue: 146441400.87, avgPrice: 288.98};
const TOL = {revenue: 12};
const TOTAL_KG = 506745;

// 1. Раскладка полей и высоты.
const L720 = layoutFor(720);
check(L720.height === 240 && L720.wide && L720.plot.w === 480 && L720.plot.h === 176, 'Ширина 720: высота 240 px, поле 480 × 176 px');
check(L720.stakan.x === 544 && L720.stakan.w === 168, 'Стакан справа, x 544, ширина 168 px');
check(layoutFor(688).wide && layoutFor(688).plot.w === 448, 'От 688 px стакан справа, поле 448 px');
check(!layoutFor(687).wide, 'Ниже 688 px стакан переносится под график');
check(layoutFor(1000).height === 320 && layoutFor(320).height === 240, 'Высота блока от 240 до 320 px');
check(layoutFor(320).stakan.h + 28 === 160, 'Стакан под графиком: блок 160 px');
check(layoutFor(320).height >= 240 && layoutFor(320).svgHeight > 240, 'При ширине 320 px высота блока не меньше 240 px');

// 2. Ширины ступеней пропорциональны объему; сумма равна полю.
const scene = buildScene(STEPS, COST, TOTALS, 720);
const plotW = scene.layout.plot.w;
scene.rects.forEach((r, i) => near(r.w, STEPS[i].kg / TOTAL_KG * plotW, 1e-9, `Ступень ${i}: ширина пропорциональна объему`));
near(scene.rects[4].w, 484875 / TOTAL_KG * plotW, 0.5, 'Ступень 275–300 руб. / кг: ширина 484 875 / 506 745 × поле, допуск 0,5 px');
near(scene.rects[2].w, 1.31, 0.01, 'Ступень 1 380 кг при поле 480 px: ширина 1,31 px');
near(scene.rects.reduce((sum, r) => sum + r.w, 0), plotW, 1e-6, 'Сумма ширин ступеней равна ширине поля');
check(scene.rects.every((r, i) => i === 0 || Math.abs(r.x - (scene.rects[i - 1].x + scene.rects[i - 1].w)) < 1e-9), 'Ступени стоят встык по накопленному объему');
check(scene.rects.every(r => r.hit.w >= 24), 'Зона нажатия каждой ступени не меньше 24 px');
check(scene.rects.every((r, i) => i === 0 || STEPS[i - 1].avgPrice > STEPS[i].avgPrice), 'Ступени идут по убыванию цены слева направо');

// 3. Площади и сверка выручки.
const area = STEPS.reduce((sum, s) => sum + s.kg * s.avgPrice, 0);
near(area, 146441400.87, 12, 'Сумма площадей ступеней равна выручке 146 441 400,87 руб. в пределах 12 руб.');
near(area - 146441400.87, -11.12, 0.01, 'Разница 11,12 руб. совпадает с расчетом спецификации');
check(Math.abs(area / 146441400.87 - 1) < 1e-4, 'Расхождение меньше 0,01%');
check(!checkTotals(STEPS, TOTALS, {revenue: 11}).ok, 'При допуске 11 руб. разница 11,12 руб. выходит за порог');
check(checkTotals(STEPS, TOTALS, TOL).ok, 'При допуске 12 руб. сверка проходит');
check(checkTotals(STEPS, TOTALS, TOL).kgOk, 'Сумма кг ступеней совпадает с итогом 506 745');

// 4. Стакан себестоимости: накопительные значения от нуля, итог 141,4867668.
const cols = costColumns(COST, scene.layout);
near(cols[0].cum, 117.3393655, 5e-8, 'Сырье: накопленный итог 117,3393655');
near(cols[1].cum, 137.3494342, 5e-8, 'Цех: накопленный итог 137,3494342');
near(cols[2].cum, 141.4867668, 5e-8, 'Упаковка: итог 141,4867668');
near(scene.costTotal, 141.4867668, 5e-8, 'Итог себестоимости 141,4867668');
check(cols.every((c, i) => c.x === scene.layout.stakan.x + i * 64 && c.w === 40), 'Столбцы шириной 40 px с шагом 64 px');
check(cols[0].top > cols[1].top && cols[1].top > cols[2].top, 'Столбцы накопительные: каждый выше предыдущего');
check(cols[2].total && !cols[0].total && !cols[1].total, 'Итоговый столбец отмечен один');
near(cols[0].share, 82.9, 0.1, 'Сырье составляет 83% себестоимости');
near(cols[0].top, priceY(117.3393655, scene.layout.stakan), 1e-9, 'Столбец стоит на общей шкале цены стакана');

// 5. Средняя цена внутри диапазона цен ступеней.
const avg = TOTALS.revenue / TOTALS.kg;
check(Number(avg.toFixed(2)) === 288.98, 'Средняя цена округляется до 288,98');
check(avg >= Math.min(...STEPS.map(s => s.avgPrice)) && avg <= Math.max(...STEPS.map(s => s.avgPrice)), 'Средняя 288,98 внутри диапазона цен ступеней');

// 6. Выноски: четыре малые ступени, без пересечений, внутри поля при 688 px и 720 px.
for (const width of [720, 688]) {
  const sc = buildScene(STEPS, COST, TOTALS, width);
  check(sc.callouts.length === 4, `${width} px: четыре выноски малых ступеней`);
  const leaders = sc.callouts.map(k => k.leader);
  for (let i = 0; i < leaders.length; i++) {
    for (let j = i + 1; j < leaders.length; j++) check(!segmentsIntersect(leaders[i], leaders[j]), `${width} px: выноски ${i} и ${j} не пересекаются`);
  }
  sc.callouts.forEach((k, i) => {
    const w = Math.max(...k.lines.map(l => textWidth(l.text, 12)));
    check(k.x + w <= sc.layout.plot.right, `${width} px: подпись выноски ${i} внутри поля`);
  });
  check(sc.rects.every(r => r.w >= 0), `${width} px: ширины не отрицательные`);
}

// 7. Подписи в одной раскладке не пересекаются, остаются внутри блока.
for (const width of [320, 375, 688, 720, 1024]) {
  const sc = buildScene(STEPS, COST, TOTALS, width);
  const boxes = sc.labels;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) check(!boxesOverlap(boxes[i], boxes[j]), `${width} px: подписи ${i} и ${j} не пересекаются`);
  }
  check(boxes.every(b => b.x >= -0.5 && b.x + b.w <= width + 1 && b.y >= -0.5 && b.y + b.h <= sc.layout.svgHeight + 0.5), `${width} px: подписи внутри блока`);
}

// 8. Крупная подпись: 96% и строка 14 px над линией себестоимости.
const ml = scene.mainLabel;
check(ml.title.text === '96%', 'Главная ступень подписана 96%');
check(ml.lines.length === 1 && plainSpaces(ml.lines[0].text) === '275–300 руб. / кг, 484 875 кг, 285,87 руб. / кг', 'Строка главной ступени в одну линию при 720 px');
check(ml.lines.at(-1).y < scene.costY, 'Строка главной ступени выше линии себестоимости');
const mlNarrow = buildScene(STEPS, COST, TOTALS, 320).mainLabel;
check(mlNarrow.lines.length === 2 && mlNarrow.lines.at(-1).y < buildScene(STEPS, COST, TOTALS, 320).costY, 'При 320 px строка главной ступени делится на две');

// 9. Подписи столбцов.
const colText = scene.colLabels.map(group => group.map(l => plainSpaces(l.text)).join('|'));
check(colText[0] === '117,34', 'Сырье: только накопленное значение');
check(colText[1].includes('137,35') && colText[1].includes('+20,01'), 'Цех: накопленное значение и приращение +20,01');
check(colText[2].includes('Итог') && colText[2].includes('141,49') && colText[2].includes('+4,14'), 'Упаковка: слово «Итог», значение 141,49, приращение +4,14');

// 10. Узкий блок: выноски заменены списком, стакан под графиком; пустые данные.
const narrow = buildScene(STEPS, COST, TOTALS, 320);
check(narrow.callouts.length === 0 && narrow.smalls.length === 4, 'Узкий блок: четыре малые ступени в списке, выносок нет');
check(narrow.costs.every(c => c.bottom === narrow.layout.stakan.bottom), 'Узкий блок: столбцы опираются на нижнюю линию своей полосы');
const empty = buildScene([], [], null, 720);
check(empty.rects.length === 0 && empty.costs.length === 0 && empty.main === null, 'Пустые данные: ступеней и столбцов нет');

// 11. Форматы чисел: разряды неразрывным пробелом, дробь запятой, доли.
check(fmtNum(506745) === '506\u00A0745', 'Разряды отделяются неразрывным пробелом');
check(fmtNum(288.98, 2) === '288,98', 'Дробная часть отделяется запятой');
check(fmtNum(146441400.87) === '146\u00A0441\u00A0401', 'Итог выручки 146 441 401');
check(fmtShareRound(95.6842) === '96%' && fmtShareRound(0.6335) === '0,6%', 'Доли: 96% и 0,6%');
check(fmtNum(95.6842, 1) === '95,7', 'Доля в таблице с одним знаком: 95,7');

// 12. Клавиатура: восемь элементов по порядку, без цикла, Home и End к краям.
check(moveIndex(7, 'ArrowRight', 8) === 7, 'Стрелка вправо на последнем элементе не зацикливается');
check(moveIndex(0, 'ArrowLeft', 8) === 0, 'Стрелка влево на первом элементе не зацикливается');
check(moveIndex(4, 'ArrowRight', 8) === 5 && moveIndex(4, 'ArrowDown', 8) === 5, 'От последней ступени стрелка переходит к первому столбцу');
check(moveIndex(3, 'End', 8) === 7 && moveIndex(6, 'Home', 8) === 0, 'Home и End переходят к краям группы');
check(moveIndex(0, 'ArrowUp', 8) === 0 && moveIndex(0, 'Tab', 8) === 0, 'Прочие клавиши не меняют элемент');

// 13. Стили: анимация только при допустимом движении, печать без анимации, размеры и без переходов.
const css = await readFile(new URL('stakan.css', stakanDir), 'utf8');
check(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?animation:stakan-rise 360ms/.test(css), 'Вход ступеней 360 мс только при допустимом движении');
check(css.includes('calc(var(--i, 0) * 60ms)'), 'Сдвиг старта 60 мс на ступень');
check(/@media print\s*\{[\s\S]*?animation:none!important/.test(css), 'Печать: анимация отключена');
check(/@media print\s*\{[\s\S]*?\.stakan-tables\[hidden\]\{display:grid!important\}/.test(css), 'Печать: таблицы выводятся всегда');
check(!/transition|box-shadow|letter-spacing|text-shadow|gradient/.test(css), 'Стили без переходов, теней, разреженного шрифта и градиентов');
check([...css.matchAll(/font-size:\s*(\d+)px/g)].every(m => Number(m[1]) >= 12), 'Все подписи в стилях не меньше 12 px');
check(css.includes('var(--c-data)') && css.includes('var(--c-secondary)') && css.includes('var(--fs-body)'), 'Цвета и размеры через токены components.css');

// 14. Буква с двумя точками не попадает в исходники стакана и в тест.
const sources = {
  'geometry.js': await readFile(new URL('geometry.js', stakanDir), 'utf8'),
  'StakanChart.jsx': await readFile(new URL('StakanChart.jsx', stakanDir), 'utf8'),
  'stakan.css': css,
  'stakan-geometry.test.mjs': await readFile(fileURLToPath(import.meta.url), 'utf8'),
};
for (const [name, text] of Object.entries(sources)) check(noYo(text), `${name}: нет буквы с двумя точками`);

// 15. Разметка в SSR: группа, подписи, таблицы, состояния. Геометрия и разметка проверяются тем же кодом, что и в приложении.
const server = await createServer({root, server: {middlewareMode: true}, appType: 'custom', logLevel: 'error', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const {StakanChart} = await server.ssrLoadModule('/src/stakan/StakanChart.jsx');
  const render = (props, label) => {
    const warnings = [], previous = console.error;
    let html;
    try {
      console.error = (...args) => warnings.push(args.map(String).join(' '));
      html = renderToStaticMarkup(React.createElement(StakanChart, props));
    } finally { console.error = previous; }
    check(warnings.length === 0, `${label}: предупреждения React ${warnings.join('; ')}`);
    check(!/[\u2014\u00b7|\u2022]/.test(html) && noYo(html) && !html.includes('NaN') && !html.includes('undefined'), `${label}: типографика без запрещенных знаков`);
    return plainSpaces(html);
  };

  const html = render({periodLabel: 'Апрель 2026', steps: STEPS, totals: TOTALS, cost: COST, tolerance: TOL, sourceNote: 'агрегаты продаж филе, апрель 2026', status: 'ready'}, 'Стакан готов');
  check(html.includes('<figure') && html.includes('>Стакан цены и себестоимости филе, апрель 2026</figcaption>'), 'Фигура с подписью-именем группы');
  const capId = /<figcaption id="([^"]+)"/.exec(html)?.[1];
  const descId = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  const tablesId = /aria-controls="([^"]+)"/.exec(html)?.[1];
  check(Boolean(capId) && html.includes(`aria-labelledby="${capId}"`) && html.includes('role="group"'), 'SVG: группа, названная figcaption');
  check(Boolean(descId) && html.includes(`<desc id="${descId}">Продано 506 745 кг филе на 146 441 401 руб.`), 'SVG: описание с объемом и выручкой');
  check(html.includes('Средняя цена 288,98 руб. / кг, себестоимость 141,49 руб. / кг. 96% объема продано по 275–300 руб. / кг.'), 'Описание: средняя цена, себестоимость и доля главной ступени');
  check((html.match(/tabindex="0"/g) || []).length === 1 && (html.match(/tabindex="-1"/g) || []).length === 7, 'Клавиатура: один вход в группу, семь элементов с -1');
  check(html.includes('aria-label="Диапазон 275–300 руб. / кг: 484 875 кг, 96% объема, средняя цена 285,87 руб. / кг, выручка 138 612 816 руб."'), 'Ступень 275–300: полная подпись для чтения с экрана');
  check(html.includes('aria-label="Сырье: накопленный итог 117,34 руб. / кг"') && html.includes('aria-label="Итог себестоимости: 141,49 руб. / кг"'), 'Столбцы: подписи статей и итога');
  check(html.includes('aria-pressed="false"') && html.includes('role="button"'), 'Ступени: кнопки с состоянием выбора');
  check(Boolean(tablesId) && html.includes(`aria-expanded="false"`) && html.includes(`id="${tablesId}"`) && html.includes('hidden=""'), 'Переключатель «Таблица»: aria-expanded и aria-controls, таблица скрыта до открытия');
  check(html.includes('>146 441 401</td>') && html.includes('Сумма строк округлена, итог из исходных данных.'), 'Таблица: итог выручки и сноска о сумме строк');
  check(html.includes('>Итог: 506 745 кг, 288,98 руб. / кг</text>') || html.includes('Итог: 506 745 кг, 288,98 руб. / кг'), 'Итог поля: кг и средняя цена');
  check(html.includes('В норме: сумма ступеней 506 745 кг совпадает с итогом'), 'Сверка: статус «В норме» с символом и словом');
  check(html.includes('Сырье дает 83% себестоимости.'), 'Сырье дает 83% себестоимости');
  check(html.includes('Вне итога себестоимости: логистика, коммерческие расходы, общехозяйственные расходы. Статус: Требуется подтверждение.'), 'Статьи вне итога с состоянием «Требуется подтверждение»');
  check(html.includes('Источник: агрегаты продаж филе, апрель 2026.'), 'Источник под стаканом');
  check(html.includes('Выберите ступень или столбец, чтобы закрепить подробности.'), 'Строка подробностей с подсказкой по действию');

  const emptyHtml = render({periodLabel: 'Апрель 2026', steps: [], status: 'ready'}, 'Стакан без данных');
  check(emptyHtml.includes('Нет данных: агрегаты апреля 2026 не переданы') && !emptyHtml.includes('<svg'), 'Без данных: текст «Нет данных», графика нет');
  check(emptyHtml.includes('disabled=""') && emptyHtml.includes('>Таблица<'), 'Без данных кнопка «Таблица» отключена');

  const errHtml = render({periodLabel: 'Апрель 2026', steps: STEPS, status: 'error', onRetry: () => {}}, 'Стакан с ошибкой');
  check(errHtml.includes('Риск: данные не загружены, ответ сервера содержит ошибку') && errHtml.includes('>Повторить<') && !errHtml.includes('<svg'), 'Ошибка: статус «Риск», кнопка «Повторить», графика нет');

  const noCost = render({periodLabel: 'Апрель 2026', steps: STEPS, totals: TOTALS, cost: [], status: 'ready'}, 'Стакан без себестоимости');
  check(!noCost.includes('stakan-cost-line') && noCost.includes('96%'), 'Без себестоимости ступени выводятся, линии и столбцов нет');
} finally {
  await server.close();
}

console.log(`Проверено: ${checks} проверок`);
console.log('Стакан: геометрия, подписи, сверка 146 441 401 руб., накопительные столбцы 141,4867668, клавиатура, стили и разметка проверены');
