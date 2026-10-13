import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Запуск из каталога platform: node tests/money-bridge.test.mjs
const root = fileURLToPath(new URL('../', import.meta.url));
const context = {module:{exports:{}}};
vm.runInNewContext(await readFile(new URL('../model.js', import.meta.url), 'utf8'), context);
const M = context.module.exports, defaults = M.defaults();
const zero = object => Object.fromEntries(Object.keys(object).map(key => [key, 0]));
const rub = value => Number(value || 0).toLocaleString('ru-RU', {maximumFractionDigits:1}).replace(/^-/, '−');
let checks = 0;
const check = (condition, message) => {checks++; assert.ok(condition, message);};
const near = (actual, expected, message) => check(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${message}: ${actual} / ${expected}`);
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const tags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(match => ({...attrs(match[1]), text:match[2]}));

// Известные суммы всей корзины независимо фиксируют четыре маршрута.
const cases = [
  ['Филе и ножки', {}, [18_015_000, 14_000_000, 1_415_000, 2_600_000]],
  ['Крупная разделка', {route:'coarse'}, [17_575_000, 14_000_000, 1_350_000, 2_225_000]],
  ['Обвалка грудки и ножки', {route:'deep'}, [18_266_250, 14_000_000, 1_800_000, 2_466_250]],
  ['Целая тушка', {route:'whole', cut:0, demand:{whole:100}}, [17_000_000, 14_000_000, 800_000, 2_200_000]],
  ['Отрицательный вклад', {rawCost:200}, [18_015_000, 20_000_000, 1_415_000, -3_400_000]],
  ['Нулевой вклад', {rawCost:166}, [18_015_000, 16_600_000, 1_415_000, 0]],
  ['Нулевые затраты', {rawCost:0, routeCosts:zero(defaults.routeCosts)}, [18_015_000, 0, 0, 18_015_000]],
  ['Нулевая выручка', {prices:zero(defaults.prices)}, [0, 14_000_000, 1_415_000, -15_415_000]],
  ['Все величины равны нулю', {rawCost:0, routeCosts:zero(defaults.routeCosts), prices:zero(defaults.prices)}, [0, 0, 0, 0]],
  ['Остаток и обслуживание', {demand:{fillet:10}, service:{fillet:5}}, [16_215_000, 14_000_000, 1_525_000, 690_000]],
];

const server = await createServer({root, server:{middlewareMode:true}, appType:'custom', logLevel:'error'});
try {
  const {MoneyBridge} = await server.ssrLoadModule('/src/charts.jsx');
  for (const [name, params, expected] of cases) {
    const r = M.evaluate(params), processing = r.routeCost + r.serviceCost + r.freezeCost;
    [r.revenue, r.rawCost, processing, r.contribution].forEach((value, i) => near(value, expected[i], `${name}: сумма ${i}`));
    near(r.revenue - r.rawCost - processing, r.contribution, `${name}: равенство вклада`);
    if (name === 'Остаток и обслуживание') {
      near(r.inventoryT, 6, 'Остаток продукции');
      near(r.inventoryValue, 1_320_000, 'Будущая продажа учитывается отдельно');
    }
    const ranges = [[0,r.revenue], [r.revenue,r.revenue-r.rawCost], [r.revenue-r.rawCost,r.contribution], [0,r.contribution]];
    const values = [r.revenue, -r.rawCost, -processing, r.contribution];
    const names = ['Выручка','Сырьё','Обработка','Вклад недели'];
    for (const compact of [false, true]) {
      const label = `${name} / ${compact ? 'компактный' : 'обычный'}`;
      const warnings = [], previousError = console.error;
      let html;
      try {
        console.error = (...args) => warnings.push(args.map(String).join(' '));
        html = renderToStaticMarkup(React.createElement(MoneyBridge, {result:r, compact}));
      } finally {console.error = previousError;}
      check(warnings.length === 0, `${label}: предупреждения React ${warnings.join('; ')}`);
      check(!html.includes('NaN') && !html.includes('Infinity'), `${label}: конечные координаты`);
      const svg = tags(html, 'svg')[0], groups = tags(svg.text, 'g');
      const [,,width,height] = svg.viewBox.split(' ').map(Number);
      check(groups.length === 4, `${label}: четыре столбца`);
      check(width === (compact ? 360 : 580) && height === (compact ? 180 : 218), `${label}: размер графика`);
      check(svg['aria-label'].includes(`вклад недели ${rub(r.contribution)} руб.`), `${label}: полная сумма вклада`);
      check(tags(svg.text,'text').filter(item=>item.class === 'money-bridge-unit').length === (compact ? 0 : 4), `${label}: единицы компактного графика вынесены в заголовок`);
      const min = Math.min(0,...ranges.flat()), max = Math.max(1,...ranges.flat());
      const scale = (compact ? 104 : 126) / (max-min), bottom = compact ? 146 : 172;
      const y = value => bottom-(value-min)*scale;
      const baseline = tags(svg.text, 'line')[0];
      near(Number(baseline.y1), y(0), `${label}: общая линия нуля`);
      near(Number(baseline.y2), y(0), `${label}: горизонталь нуля`);
      groups.forEach((group, i) => {
        const rect = tags(group.text,'rect')[0], title = tags(group.text,'title')[0], text = tags(group.text,'text');
        const [from,to] = ranges[i], top = Math.min(y(from),y(to));
        near(Number(rect.y), top, `${label}: начало ${i}`);
        near(Number(rect.height), Math.abs(to-from)*scale, `${label}: общая шкала ${i}`);
        check(Number(rect.x)>=0 && Number(rect.x)+Number(rect.width)<=width && Number(rect.y)>=0 && Number(rect.y)+Number(rect.height)<=height, `${label}: столбец ${i} в графике`);
        check(title.text === `${names[i]}: ${rub(values[i])} руб.`, `${label}: полная подсказка ${i}`);
        check(text.every(item=>Number(item.x)>=0 && Number(item.x)<=width && Number(item.y)>0 && Number(item.y)<height), `${label}: точки подписей ${i} в графике`);
        const displayed = Number(text[0].text.replace('−','-').replace(/\s/g,'').replace(',','.')) * 1e6;
        check(Math.abs(displayed-values[i]) <= 500.001, `${label}: округление подписи ${i} до тысяч рублей`);
        if (from === to) near(Number(rect.height), 0, `${label}: нулевой столбец ${i}`);
        if (i < 3) {
          const connector = tags(group.text,'line')[0];
          near(Number(connector.y1), y(to), `${label}: остаток после шага ${i}`);
          near(Number(connector.y2), y(to), `${label}: горизонтальный переход ${i}`);
        }
        if (i === 3 && r.contribution < 0) {
          check(rect.fill === '#a6372d', `${label}: отрицательный итог выделен`);
          near(Number(rect.y), y(0), `${label}: убыток начинается от нуля`);
          check(text[0].text.startsWith('−'), `${label}: знак убытка`);
        }
      });
    }
    console.log(`Проверено: ${name}`);
  }
  console.log(`Готово: ${cases.length} сценариев, ${cases.length * 2} рендеров, ${checks} проверок`);
} finally {
  await server.close();
}
