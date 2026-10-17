import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const context={module:{exports:{}}};
vm.runInNewContext(await readFile(new URL('../model.js',import.meta.url),'utf8'),context);
const M=context.module.exports;
const server=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
let checks=0;
const check=(condition,message)=>{checks++;assert.ok(condition,message);};
const near=(actual,expected,message)=>check(Math.abs(actual-expected)<1e-7*Math.max(1,Math.abs(expected)),message);
const names=['Выручка','Сырье','Переделы','Коммерция','Заморозка','Вклад'];
const cases=[
  ['Филе и ножки',{},2_600_000],
  ['Крупная разделка',{route:'coarse'},2_225_000],
  ['Глубокая разделка',{route:'deep'},2_466_250],
  ['Отрицательный вклад',{rawCost:200},-3_400_000],
  ['Нулевой вклад',{rawCost:166},0],
  ['Коммерция и заморозка',{demand:{fillet:10},service:{fillet:5}},690_000],
  ['Целая тушка и остаток',{route:'whole',cut:0},-3_200_000],
];
try{
  const {planWaterfallItems,PlanWaterfall}=await server.ssrLoadModule('/src/PlanScreen.jsx');
  for(const [name,params,expected] of cases){
    const result=M.evaluate(params),items=planWaterfallItems(result);
    assert.deepEqual(items.map(item=>item.name),names);checks++;
    near(result.contribution,expected,`${name}: известный итог`);
    near(items.slice(0,-1).reduce((sum,item)=>sum+item.value,0),items.at(-1).value,`${name}: шесть ступеней сохраняют денежный баланс`);
    near(items[2].value,-result.routeCost,`${name}: переделы отдельно`);
    near(items[3].value,-result.serviceCost,`${name}: коммерция отдельно`);
    near(items[4].value,-result.freezeCost,`${name}: заморозка отдельно`);
    check(items.filter(item=>item.total).length===2,`${name}: начальный и конечный итоги`);
    const html=renderToStaticMarkup(React.createElement(PlanWaterfall,{result}));
    check((html.match(/class="money-bridge-step /g)||[]).length===6,`${name}: шесть видимых групп`);
    check((html.match(/stroke-dasharray="3 3"/g)||[]).length===5,`${name}: пять переходов`);
    check(html.includes('млн руб.'),`${name}: единицы указаны`);
    check(!html.includes('NaN')&&!html.includes('Infinity'),`${name}: конечные координаты`);
    check(html.includes('aria-haspopup="dialog"'),`${name}: доступ к подробному расчёту`);
    if(result.contribution<0)check(html.includes('money-bridge-negative'),`${name}: отрицательный итог выделен`);
    if(result.inventoryT>0){
      check(html.includes('будущая продажа')&&html.includes('отдельно'),`${name}: будущая продажа вынесена из выручки`);
      near(items[0].value,result.revenue,`${name}: остаток сохраняет отдельную стоимость`);
    }
    if(name==='Коммерция и заморозка'){
      near(items[3].value,-50_000,'Коммерческие затраты: 10 т × 5 руб. / кг');
      near(items[4].value,-60_000,'Заморозка: 6 т × 10 руб. / кг');
    }
  }
  console.log(`Шестиступенчатый график: ${checks} проверок, ${cases.length} сценариев пройдены`);
}finally{await server.close();}
