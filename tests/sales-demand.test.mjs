import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
let checks=0;
const check=(value,message)=>{checks++;assert.ok(value,message);};
try{
 const {SalesDemandScreen,initialDemandInputs,demandContextKey,readDemandStore,DEMAND_STORAGE,rowStatus}=await server.ssrLoadModule('/src/SalesDemandScreen.jsx');
 const product={id:'p1',costProductKey:'Точное наименование',suggestedDemandKg:700,priceRubKg:150};
 const inputs=initialDemandInputs(product);
 check(inputs.plannedDemandKg===700&&inputs.priceRubKg===150,'Начальный спрос и цена приходят из истории');
 for(const field of ['ordersKg','inventoryKg','safetyKg','discountPct','logisticsRubKg'])check(inputs[field]===null,`${field}: пустое значение сохраняется`);
 const explicitZero=initialDemandInputs(product,{productKey:'Точное наименование',inputs:{ordersKg:0,inventoryKg:0,safetyKg:0,discountPct:0,logisticsRubKg:0}});
 for(const field of ['ordersKg','inventoryKg','safetyKg','discountPct','logisticsRubKg'])check(explicitZero[field]===0,`${field}: явный ноль сохраняется`);
 check(initialDemandInputs(product,{productKey:'Другой продукт',inputs:{ordersKg:50}}).ordersKg===null,'Чужой ключ товара исключён из восстановления');
 check(initialDemandInputs(product,{productKey:'Точное наименование',inputs:{ordersKg:null}}).ordersKg===null,'Очистка поля остаётся явным null');
 check(initialDemandInputs(product,{productKey:'Точное наименование',inputs:{ordersKg:-1}}).ordersKg===null,'Повреждённое отрицательное значение требует нового ввода');
 check(rowStatus(explicitZero,{status:'loading'}).kind==='loading','Ожидание ответа сохраняет статус расчёта');
 check(rowStatus(explicitZero,{status:'ready'}).kind==='ready','Успешный ответ открывает статус готовности');
 check(rowStatus(explicitZero,{status:'error'}).kind==='bad','Ошибка ответа требует проверки');
 const keys=[demandContextKey('clients','2026-03',7),demandContextKey('clients','2026-02',7),demandContextKey('clients','2026-03',14),demandContextKey('deals','2026-03',7)];
 check(new Set(keys).size===4,'Месяц, горизонт и набор образуют отдельные условия');
 check(readDemandStore({getItem:()=>'{'}).version===1,'Повреждённое хранилище открывает новую версию');
 check(Object.keys(readDemandStore({getItem:()=>JSON.stringify({version:2,contexts:{a:1}})}).contexts).length===0,'Версия хранилища проверяется');
 check(readDemandStore({getItem:key=>key===DEMAND_STORAGE?JSON.stringify({version:1,contexts:{a:{b:1}}}):null}).contexts.a.b===1,'Все условия заданной версии восстанавливаются');
 const html=renderToStaticMarkup(React.createElement(SalesDemandScreen));
 check(html.includes('Спрос по продукции'),'Деловое название экрана');
 check(html.includes('Горизонт планирования, дней'),'Горизонт доступен для настройки');
 check(!html.includes('Источник')&&!html.includes('API'),'Главный экран содержит деловые поля');
 console.log(`Экран спроса: ${checks} проверок пройдены`);
}finally{await server.close();}
