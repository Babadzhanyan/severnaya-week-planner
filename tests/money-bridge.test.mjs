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
  const customCases = [
    ['Сохранённый расчёт', [155, -140, 5, -4, 16], [true, false, false, false, true]],
    ['Промежуточный максимум', [5, 7, -4, -2, 6], [true, false, false, false, true]],
    ['Отрицательный результат', [10, -15, 2, -1, -4], [true, false, false, false, true]],
    ['Переход через ноль', [0, -12, 15, -1, 2], [true, false, false, false, true]],
    ['Нулевой результат', [10, -12, 3, -1, 0], [true, false, false, false, true]],
    ['Все ступени нулевые', [0,0,0,0,0], [true, false, false, false, true]],
    ['Доли рубля', [.05,-.04,.005,-.002,.013], [true, false, false, false, true]],
    ['Точная исходная цена', [153.466060,-141.59138833330678,4.622280343936141,-4.608580,11.888372010629366], [true, false, false, false, true]],
    ['Шесть ступеней', [100,-20,-30,5,-10,45], [true, false, false, false, false, true]],
  ];
  for (const [name,values,totals] of customCases) {
    const names = values.length===5 ? ['Разделка','Тушка','Возврат\nупаковки','Упаковка','Результат'] : ['Начало','Затраты 1','Затраты 2','Возврат','Затраты 3','Результат'];
    const items=values.map((value,i)=>({name:names[i],value,total:totals[i]}));
    let running=0;
    const ranges=items.map(item=>{const from=item.total?0:running,to=item.total?item.value:running+item.value;running=to;return [from,to];});
    const min=Math.min(0,...ranges.flat()),max=Math.max(0,...ranges.flat()),scale=126/(max-min||1),y=v=>166-(v-min)*scale;
    const html=renderToStaticMarkup(React.createElement(MoneyBridge,{items,unit:'руб. / кг',divisor:1}));
    const svg=tags(html,'svg')[0],groups=tags(svg.text,'g');
    check(svg.viewBox==='0 0 410 230',`${name}: размер нового графика`);
    check(groups.length===items.length,`${name}: все ступени показаны`);
    check(svg['aria-label'].includes('руб. / кг'),`${name}: единица исходного расчёта`);
    check(!html.includes('NaN')&&!html.includes('Infinity'),`${name}: конечные координаты`);
    groups.forEach((g,i)=>{
      const rect=tags(g.text,'rect')[0],texts=tags(g.text,'text'),connector=tags(g.text,'line')[0];
      const [from,to]=ranges[i];
      near(Number(rect.y),Math.min(y(from),y(to)),`${name}: положение ступени ${i}`);
      near(Number(rect.height),Math.abs(to-from)*scale,`${name}: количественная высота ${i}`);
      check(Number(rect.x)>=0&&Number(rect.x)+Number(rect.width)<=410,`${name}: горизонтальные границы ${i}`);
      check(Number(rect.y)>=40-1e-7&&Number(rect.y)+Number(rect.height)<=166+1e-7,`${name}: границы общей шкалы ${i}`);
      check(g.tabindex==='0'&&g['aria-label'].includes('руб. / кг'),`${name}: подсказка с клавиатуры ${i}`);
      const shown=Number(texts[0].text.replace('−','-').replace(/\s/g,'').replace(',','.'));
      near(shown,Number(values[i].toPrecision(3)),`${name}: три значащих цифры ${i}`);
      if(name==='Точная исходная цена') {
        check(texts[0].text===['153','−142','+4,62','−4,61','11,9'][i],`${name}: короткая подпись ${i}`);
        const exactValue=values[i].toLocaleString('ru-RU',{maximumFractionDigits:20}).replace(/^-/,'−');
        const exactTitle=`${names[i].replace(/\n/g,' ')}: ${exactValue} руб. / кг`;
        check(tags(g.text,'title')[0].text===exactTitle&&g['aria-label']===exactTitle,`${name}: точная сумма в подсказке ${i}`);
      }
      if(!items[i].total&&values[i]>0)check(texts[0].text.startsWith('+'),`${name}: знак положительного изменения ${i}`);
      if(connector){near(Number(connector.y1),y(to),`${name}: переход ${i}`);near(Number(connector.y2),y(to),`${name}: горизонтальный переход ${i}`);}
      if(i===items.length-1&&values[i]<0)check(rect.fill==='#a6372d',`${name}: отрицательный итог`);
      if(i===items.length-1&&values[i]>0)check(rect.fill==='#28704f',`${name}: положительный итог`);
      if(names[i].includes('\n'))check(tags(g.text,'tspan').length===2,`${name}: две строки подписи`);
    });
    console.log(`Проверено: ${name}`);
  }
  const unavailable=renderToStaticMarkup(React.createElement(MoneyBridge,{items:[{name:'Сумма',value:NaN,total:true}],divisor:1}));
  check(unavailable.includes('Требуется расчёт')&&!unavailable.includes('<svg'), 'Пропущенное число получает явный статус');
  console.log(`Готово: ${cases.length+customCases.length} сценариев, ${cases.length*2+customCases.length} рендеров, ${checks} проверок`);
} finally {
  await server.close();
}
