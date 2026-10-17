import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Экспорт только в проверочной сборке: рабочий компонент остаётся закрытым.
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error',plugins:[{
 name:'production-path-test-export',enforce:'pre',
 transform(code,id){if(id.split('?')[0].endsWith('/src/FileScreen.jsx'))return code+'\nexport {ProductionPath};';},
}]});
let checks=0;
const check=(condition,message)=>{checks++;assert.ok(condition,message);};
const expected={
 slaughter:['receiving','hanging','slaughter','plucking','evisceration'],
 cooling:['water_cooling','carcass_cold_store','sorting'],
 cutting:['cutting','breast_fillet','thigh_fillet'],
 packaging:['bulk_carcass_pack','individual_carcass_pack','ishida_pack'],
 byproducts:['liver','byproduct_pack','feet_pack'],
};
try{
 const {CHAIN_NODES,getNodeCapacity}=await server.ssrLoadModule('/src/chain-nodes.js');
 const {ProductionPath}=await server.ssrLoadModule('/src/FileScreen.jsx');
 // Синтетическая структура: реальный набор real_data_capacity.json не публикуется и не читается.
 const source=JSON.parse(await readFile(new URL('./fixtures-v4/production-path-structure.json',import.meta.url),'utf8'));
 const mapped=Object.keys(expected).flatMap(id=>CHAIN_NODES.find(node=>node.id===id).stages);
 check(mapped.length===17&&new Set(mapped).size===17,'Пять групп сохраняют 17 уникальных операций');
 assert.deepEqual([...mapped].sort(),source.rows.map(row=>row.id).sort(),'Все операции опубликованного расчёта доступны в группах');checks++;
 for(const [id,stages] of Object.entries(expected)){
  assert.deepEqual(CHAIN_NODES.find(node=>node.id===id).stages,stages,`${id}: операции соответствуют маршруту`);checks++;
 }
 for(const row of source.rows){
  check(typeof row.massBasis==='string'&&row.massBasis.length>10,`${row.id}: сохраняется база массы`);
  check(row.unit==='кг / сутки',`${row.id}: суточная единица сохраняется до перевода отображения в тонны`);
  check(row.sourceRefs?.length>0,`${row.id}: данные сохраняют аудиторскую ссылку`);
 }
 check(CHAIN_NODES.find(node=>node.id==='storage').stages.length===0,'Склад готовой продукции ожидает собственную мощность');
 check(expected.cooling.includes('carcass_cold_store'),'Холодильник тушек сохраняет положение до разделки');
 const capacity={rows:mapped.map((id,index)=>({id,name:id,demand:index===16?12600:9000,capacity:10000,load:index===16?1.26:.9,headroom:index===16?-2600:1000}))};
 for(const [id,stages] of Object.entries(expected)){
  const state=getNodeCapacity(CHAIN_NODES.find(node=>node.id===id),capacity);
  assert.deepEqual(state.rows.map(row=>row.id),stages);checks++;
  check(state.load===(id==='byproducts'?1.26:.9),`${id}: группа показывает максимум загрузки, массы операций остаются отдельными`);
 }
 const html=renderToStaticMarkup(React.createElement(ProductionPath,{capacity,onOpen:()=>{}}));
 check((html.match(/class="raw-step /g)||[]).length===5,'Основная дорожка и ветка субпродуктов раскрывают пять групп');
 check((html.match(/<button/g)||[]).length===6,'Пять групп и хранение доступны кнопками');
 for(const id of Object.keys(expected))check(html.includes(`raw-${id}`),`${id}: группа присутствует в основной схеме`);
 check(html.includes('Целая тушка → упаковка'),'Ветка целой тушки сохраняется');
 check(html.includes('Хранение и отгрузка'),'Склад и отгрузка доступны отдельно');
 check(html.includes('126%')&&html.includes('12,6 / 10 т'),'Перегрузка выводится в процентах, массы переводятся в тонны');
 check(!/NaN|Infinity/.test(html),'Подписи содержат конечные величины');
 const emptyHtml=renderToStaticMarkup(React.createElement(ProductionPath,{capacity:{rows:[]},onOpen:()=>{}}));
 check((emptyHtml.match(/Уточнить/g)||[]).length===5,'Все пять групп показывают пробел при отсутствии данных');
 check(!emptyHtml.includes('0%'),'Пробелы данных сохраняют собственный статус');
 console.log(`Путь сырья: ${checks} проверок пройдены`);
}finally{await server.close();}
