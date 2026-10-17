import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api} from './api.js';
import {MoneyBridge} from './charts.jsx';
import {CostDetails} from './CostDetails.jsx';
import {n} from './format.js';
import './sales-demand.css';

export const DEMAND_STORAGE='severnaya-sales-demand-v1';
const FIELDS=['plannedDemandKg','ordersKg','inventoryKg','safetyKg','priceRubKg','discountPct','logisticsRubKg'];
const known=value=>typeof value==='number'&&Number.isFinite(value);
const monthName=value=>/^\d{4}-\d{2}$/.test(value||'')?new Date(`${value}-01T00:00:00Z`).toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).replace(' г.',''):'';
const tonnes=value=>known(value)?n(value/1000,3):'Указать';
const amount=value=>known(value)?n(value,2):'Требуется ввод';
const revenue=value=>known(value)?n(value/1000,1):'Указать';
export const demandContextKey=(dataset,month,days)=>JSON.stringify([dataset,month,days]);
export function initialDemandInputs(product,saved){
 const defaults={plannedDemandKg:known(product.suggestedDemandKg)&&product.suggestedDemandKg>=0?product.suggestedDemandKg:null,ordersKg:null,inventoryKg:null,safetyKg:null,priceRubKg:known(product.priceRubKg)&&product.priceRubKg>=0?product.priceRubKg:null,discountPct:null,logisticsRubKg:null};
 if(!saved||saved.productKey!==(product.costProductKey||product.id))return defaults;
 return Object.fromEntries(FIELDS.map(key=>[key,Object.hasOwn(saved.inputs||{},key)?(known(saved.inputs[key])&&saved.inputs[key]>=0?saved.inputs[key]:null):defaults[key]]));
}
export function readDemandStore(storage){
 try{const value=JSON.parse(storage.getItem(DEMAND_STORAGE)||'null');if(value?.version===1&&value.contexts&&typeof value.contexts==='object'&&!Array.isArray(value.contexts))return value;}catch{}
 return {version:1,contexts:{}};
}
const signature=inputs=>JSON.stringify(FIELDS.map(key=>inputs[key]));
const stateKey=(context,product,inputs)=>JSON.stringify([context,product.id,signature(inputs)]);
const invalidOrders=inputs=>known(inputs.ordersKg)&&known(inputs.plannedDemandKg)&&inputs.ordersKg>inputs.plannedDemandKg;
export function rowStatus(inputs,result){
 if(invalidOrders(inputs))return {kind:'bad',text:'Заказы выше спроса'};
 if(result?.status==='error')return {kind:'bad',text:'Проверить ввод'};
 if(!known(inputs.plannedDemandKg)||!known(inputs.ordersKg)||!known(inputs.inventoryKg)||!known(inputs.safetyKg))return {kind:'empty',text:'Указать объемы'};
 if(!known(inputs.priceRubKg)||!known(inputs.discountPct)||!known(inputs.logisticsRubKg))return {kind:'empty',text:'Указать цену'};
 if(result?.status!=='ready')return {kind:'loading',text:'Пересчитываем'};
 return {kind:'ready',text:'Рассчитано'};
}

function DemandTip({children,text}){
 const id=useId(),ref=useRef(null),popup=useRef(null),[position,setPosition]=useState(null);
 const open=()=>{const r=ref.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(innerWidth-328,r.left)),top:r.bottom+6,anchorTop:r.top});};
 useLayoutEffect(()=>{if(position&&popup.current){const h=popup.current.offsetHeight;if(position.top+h>innerHeight-10){const top=Math.max(10,position.anchorTop-h-6);if(top!==position.top)setPosition(p=>p?{...p,top}:p);}}},[position]);
 useEffect(()=>{if(!position)return;const close=()=>setPosition(null),key=e=>{if(e.key==='Escape'){e.stopPropagation();close();}};window.addEventListener('resize',close);window.addEventListener('scroll',close,true);window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);window.removeEventListener('keydown',key,true);};},[position]);
 return <><span ref={ref} className="sales-tip" tabIndex="0" aria-describedby={position?id:undefined} onFocus={open} onBlur={()=>setPosition(null)} onMouseEnter={open} onMouseLeave={()=>setPosition(null)}>{children}</span>{position&&createPortal(<span id={id} ref={popup} role="tooltip" className="sales-tooltip" style={{left:position.left,top:position.top}}>{text}</span>,document.body)}</>;
}
function DemandNumber({label,field,value,onCommit,unit,scale=1,max=1e9,hint}){
 const id=useId(),dirty=useRef(false),[draft,setDraft]=useState(''),[invalid,setInvalid]=useState(false);
 useEffect(()=>{setDraft(known(value)?String(Number((value/scale).toFixed(scale===1000?3:4))):'');dirty.current=false;setInvalid(false);},[value,scale]);
 const commit=()=>{if(!dirty.current)return;const v=draft.trim()===''?null:Number(draft)*scale;if(v!==null&&(!known(v)||v<0||v>max)){setInvalid(true);return;}dirty.current=false;setInvalid(false);onCommit(field,v);};
 return <label className={`sales-field ${invalid?'sales-field-invalid':''}`} htmlFor={id}><span>{hint?<DemandTip text={hint}>{label}</DemandTip>:label}</span><div><input id={id} data-demand-field={field} type="number" min="0" max={max/scale} step={scale===1000?'.001':'.01'} value={draft} placeholder="Указать" aria-invalid={invalid||undefined} onChange={e=>{dirty.current=true;setDraft(e.target.value);}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span>{unit}</span></div>{invalid&&<small>Введите число от 0 до {n(max/scale)}</small>}</label>;
}

export function SalesDemandScreen({onOpenRequest,dataset='clients'}){
 const [store,setStore]=useState(()=>readDemandStore(typeof localStorage==='undefined'?{getItem:()=>null}:localStorage));
 const initialMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(store.view?.month||'')?store.view.month:'2026-03',initialDays=Number.isInteger(store.view?.days)&&store.view.days>=1&&store.view.days<=366?store.view.days:7;
 const [month,setMonth]=useState(initialMonth),[days,setDays]=useState(initialDays),[daysDraft,setDaysDraft]=useState(String(initialDays)),[catalog,setCatalog]=useState(null),[catalogRetry,setCatalogRetry]=useState(0),[query,setQuery]=useState(''),[signal,setSignal]=useState('all'),[selectedId,setSelectedId]=useState(typeof store.view?.selectedId==='string'?store.view.selectedId:''),[tab,setTab]=useState('demand'),[detail,setDetail]=useState(null),[detailRetry,setDetailRetry]=useState(0),[results,setResults]=useState({}),[retry,setRetry]=useState(0),[costOpen,setCostOpen]=useState(false),[storageWarning,setStorageWarning]=useState(false);
 const panel=useRef(null),context=demandContextKey(dataset,month,days),catalogCurrent=catalog?.key===context?catalog:null,data=catalogCurrent?.data,products=data?.products||[];
 useEffect(()=>{try{localStorage.setItem(DEMAND_STORAGE,JSON.stringify(store));setStorageWarning(false);}catch{setStorageWarning(true);}},[store]);
 useEffect(()=>setStore(previous=>previous.view?.month===month&&previous.view?.days===days&&previous.view?.selectedId===selectedId?previous:{...previous,view:{month,days,selectedId}}),[month,days,selectedId]);
 useEffect(()=>{
  const controller=new AbortController();let current=true;setCatalog({key:context,status:'loading'});
  api(`files/demand?${new URLSearchParams({dataset,month,days:String(days)})}`,undefined,{signal:controller.signal}).then(value=>{if(!current)return;if(!Array.isArray(value.products)||value.month!==month||value.days!==days)throw new Error('Период расчета требует повторного выбора');setCatalog({key:context,status:'ready',data:value});setSelectedId(id=>value.products.some(p=>p.id===id)?id:value.products[0]?.id||'');}).catch(reason=>{if(current&&reason.name!=='AbortError')setCatalog({key:context,status:'error'});});
  return()=>{current=false;controller.abort();};
 },[context,catalogRetry]);
 const saved=store.contexts[context]||{},inputsFor=product=>initialDemandInputs(product,saved[product.id]);
 const filtered=useMemo(()=>products.filter(product=>{
  if(query.trim()&&!product.label.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))return false;
  const inputs=inputsFor(product),status=rowStatus(inputs,results[stateKey(context,product,inputs)]);
  return signal==='all'||signal==='empty'&&status.kind==='empty'||signal==='bad'&&status.kind==='bad'||signal==='ready'&&status.kind==='ready';
 }),[products,query,signal,store,results,context]);
 const product=products.find(p=>p.id===selectedId)||products[0],inputs=product?inputsFor(product):null,calcKey=product?stateKey(context,product,inputs):'',evaluation=results[calcKey],result=evaluation?.status==='ready'?evaluation.data:null,scenario=result?.scenario;
 const detailKey=product?JSON.stringify([context,product.id]):'',detailCurrent=detail?.key===detailKey?detail:null,details=detailCurrent?.data;
 useEffect(()=>{
  setCostOpen(false);if(!product)return;
  const controller=new AbortController();let current=true;setDetail({key:detailKey,status:'loading'});
  api(`files/demand/${encodeURIComponent(product.id)}?${new URLSearchParams({dataset,month,days:String(days)})}`,undefined,{signal:controller.signal}).then(value=>{if(!current)return;if(value.product?.id!==product.id||value.month!==month)throw new Error('Товар и период требуют повторного выбора');setDetail({key:detailKey,status:'ready',data:value});}).catch(reason=>{if(current&&reason.name!=='AbortError')setDetail({key:detailKey,status:'error'});});
  return()=>{current=false;controller.abort();};
 },[detailKey,detailRetry]);
 useEffect(()=>{
  if(!product||!known(inputs.plannedDemandKg)||invalidOrders(inputs))return;
  const controller=new AbortController();let current=true;setResults(previous=>({...previous,[calcKey]:{status:'loading'}}));
  api('files/demand/evaluate',{dataset,productId:product.id,month,days,...inputs},{signal:controller.signal}).then(value=>{if(current)setResults(previous=>({...previous,[calcKey]:{status:'ready',data:value}}));}).catch(reason=>{if(current&&reason.name!=='AbortError')setResults(previous=>({...previous,[calcKey]:{status:'error'}}));});
  return()=>{current=false;controller.abort();};
 },[calcKey,retry]);
 // Восстановление таблицы пересчитывает только уже настроенные товары выбранного периода.
 useEffect(()=>{
  if(!data)return;const controller=new AbortController();let active=true,index=0;
  const queue=products.filter(p=>p.id!==product?.id&&saved[p.id]).map(p=>({p,inputs:inputsFor(p)})).filter(item=>known(item.inputs.plannedDemandKg)&&!invalidOrders(item.inputs));
  const worker=async()=>{while(active&&index<queue.length){const item=queue[index++],key=stateKey(context,item.p,item.inputs);try{const value=await api('files/demand/evaluate',{dataset,productId:item.p.id,month,days,...item.inputs},{signal:controller.signal});if(active)setResults(previous=>({...previous,[key]:{status:'ready',data:value}}));}catch(reason){if(active&&reason.name!=='AbortError')setResults(previous=>({...previous,[key]:{status:'error'}}));}}};
  Promise.all([worker(),worker(),worker()]);return()=>{active=false;controller.abort();};
 },[data]);
 const update=(field,value)=>{if(!product)return;const next={...inputs,[field]:value};setStore(previous=>({...previous,contexts:{...previous.contexts,[context]:{...previous.contexts[context],[product.id]:{productKey:product.costProductKey||product.id,inputs:next}}}}));};
 const choose=id=>{setSelectedId(id);if(window.matchMedia('(max-width: 760px)').matches)requestAnimationFrame(()=>panel.current?.scrollIntoView({block:'start'}));};
 const commitDays=()=>{const value=Number(daysDraft);if(Number.isInteger(value)&&value>=1&&value<=366)setDays(value);else setDaysDraft(String(days));};
 const cost=details?.cost||result?.cost,clients=details?.clients||[],ordersInvalid=inputs&&invalidOrders(inputs),pending=evaluation?.status==='loading';
 const missingVolumes=inputs&&['plannedDemandKg','ordersKg','inventoryKg','safetyKg'].filter(key=>!known(inputs[key]));
 const displayMonths=data?.months||catalog?.data?.months||[month];
 return <section className="sales-demand-screen">
  <header className="sales-demand-header"><h1>Спрос по продукции</h1><div className="sales-demand-period"><label>История продаж<select value={month} onChange={e=>setMonth(e.target.value)} aria-label="Месяц истории продаж">{[...displayMonths].sort().reverse().map(value=><option key={value} value={value}>{monthName(value)}</option>)}</select></label><label>Горизонт<div><input aria-label="Горизонт планирования, дней" type="number" min="1" max="366" step="1" value={daysDraft} onChange={e=>setDaysDraft(e.target.value)} onBlur={commitDays} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span>дней</span></div></label>{onOpenRequest&&<button type="button" className="sales-request-link" onClick={onOpenRequest}>Проверка заявки</button>}</div></header>
  <div className="sales-demand-workbench">
   <section className="sales-products"><div className="sales-products-tools"><input type="search" placeholder="Найти продукт" aria-label="Поиск продукции" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Сигнал по продукции" value={signal} onChange={e=>setSignal(e.target.value)}><option value="all">Все товары</option><option value="empty">Требуется ввод</option><option value="bad">Проверить спрос</option><option value="ready">Рассчитано</option></select></div>
    {!catalogCurrent||catalogCurrent.status==='loading'?<div className="sales-empty" role="status"><h2>Открываем продукцию</h2><p>Готовим объемы и цены выбранного месяца</p></div>:catalogCurrent.status==='error'?<div className="sales-empty" role="alert"><h2>Требуется подключение данных</h2><p>Повторите загрузку продукции</p><button onClick={()=>setCatalogRetry(v=>v+1)}>Повторить</button></div>:<><div className="sales-products-table" id="demand-chart"><table><thead><tr><th>Продукт</th><th><DemandTip text={`Продано за ${monthName(month)}. Объем выбранного месяца`}>История<small>т / месяц</small></DemandTip></th><th><DemandTip text="План спроса включает подтвержденные заказы. Начальное значение – равномерный ориентир по истории продаж">План спроса<small>т</small></DemandTip></th><th>Заказы<small>т</small></th><th>К выпуску<small>т</small></th><th>Выручка<small>тыс. руб.</small></th><th aria-label="Состояние ввода"/></tr></thead><tbody>{filtered.map(row=>{const values=inputsFor(row),entry=results[stateKey(context,row,values)],out=entry?.status==='ready'?entry.data.scenario:null,status=rowStatus(values,entry);return <tr key={row.id} className={row.id===product?.id?'selected':''} data-demand-product={row.id}><th><button onClick={()=>choose(row.id)} aria-pressed={row.id===product?.id}>{row.label}</button></th><td>{tonnes(row.volumeKg)}</td><td>{tonnes(values.plannedDemandKg)}</td><td className={!known(values.ordersKg)?'sales-missing':''}>{known(values.ordersKg)?tonnes(values.ordersKg):'Указать'}</td><td className={!known(out?.productionNeedKg)?'sales-missing':''}>{known(out?.productionNeedKg)?tonnes(out.productionNeedKg):'Указать'}</td><td className={!known(out?.revenueRub)?'sales-missing':''}>{known(out?.revenueRub)?revenue(out.revenueRub):'Указать'}</td><td><DemandTip text={status.text}><span className={`sales-row-status ${status.kind}`} aria-label={status.text}>{status.kind==='ready'?'✓':status.kind==='bad'?'!':status.kind==='loading'?'…':'○'}</span></DemandTip></td></tr>;})}</tbody></table>{filtered.length===0&&<p className="sales-empty-list">Уточните поиск или выберите другой сигнал</p>}</div><footer className="sales-products-footer"><span>{filtered.length} из {products.length} товаров</span><DemandTip text={`Равномерный ориентир: продажи за ${monthName(month)} / ${data.historyDays} календарных дней × ${days} дней. Отдел продаж уточняет спрос и подтверждает заказы`}>Равномерный ориентир ⓘ</DemandTip></footer></>}
   </section>
   <aside ref={panel} className="sales-product-detail" aria-busy={pending}>
    {!product?<div className="sales-empty"><h2>Выберите продукт</h2><p>Настройте спрос, цену и потребность в выпуске</p></div>:<>
     <header className="sales-product-title"><h2>{product.label}</h2><span>Продано {tonnes(product.volumeKg)} т / {monthName(month)}</span></header>
     <div className="sales-detail-tabs" role="tablist" aria-label="Параметры продукта" onKeyDown={event=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();event.stopPropagation();const buttons=[...event.currentTarget.querySelectorAll('button')],at=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;setTab(['demand','price','cost'][next]);buttons[next].focus();}}>{[['demand','Спрос и выпуск'],['price','Цена'],['cost','Себестоимость']].map(([value,label])=><button key={value} role="tab" id={`sales-tab-${value}`} aria-controls="sales-product-panel" aria-selected={tab===value} tabIndex={tab===value?0:-1} onClick={()=>setTab(value)}>{label}</button>)}</div>
     <div key={`${detailKey}/${tab}`} className="sales-detail-body" id="sales-product-panel" role="tabpanel" aria-labelledby={`sales-tab-${tab}`}>
      {tab==='demand'&&<><div className="sales-input-grid"><DemandNumber label="План спроса, всего" field="plannedDemandKg" value={inputs.plannedDemandKg} onCommit={update} unit="т" scale={1000} hint="План спроса включает заказы. Стартовый объем – равномерный ориентир; его можно уточнить вручную"/><DemandNumber label="Подтвержденные заказы" field="ordersKg" value={inputs.ordersKg} onCommit={update} unit="т" scale={1000} hint="Введите объем текущих заказов. Значение 0 означает, что отдел продаж подтвердил отсутствие заказов"/><DemandNumber label="Готово на складе" field="inventoryKg" value={inputs.inventoryKg} onCommit={update} unit="т" scale={1000} hint="Объем готового продукта, доступный для продаж в выбранном горизонте"/><DemandNumber label="Страховой запас" field="safetyKg" value={inputs.safetyKg} onCommit={update} unit="т" scale={1000} hint="Целевой остаток продукта на конец горизонта. Введите 0 для плана с нулевым целевым остатком"/></div><div className="sales-production-result"><span><DemandTip text="К выпуску = максимум из 0 и суммы: план спроса + страховой запас − доступный готовый продукт">К выпуску</DemandTip></span><strong>{known(scenario?.productionNeedKg)?tonnes(scenario.productionNeedKg)+' т':pending?'Считаем…':'Укажите остатки'}</strong></div><section className="sales-product-clients"><div><h3>Клиенты продукта</h3><span>{known(product.clientCount)?product.clientCount+' клиентов':''}</span></div>{detailCurrent?.status==='loading'?<p role="status">Открываем клиентов</p>:detailCurrent?.status==='error'?<p>Список клиентов требует загрузки <button onClick={()=>setDetailRetry(v=>v+1)}>Повторить</button></p>:<div><table><thead><tr><th>Клиент</th><th>Продано, т</th><th>руб. / кг</th></tr></thead><tbody>{clients.map(client=><tr key={client.pseudonym}><th>{client.pseudonym}</th><td>{tonnes(client.volumeKg)}</td><td>{amount(client.priceRubKg)}</td></tr>)}</tbody></table>{clients.length===0&&<p>Клиенты за выбранный месяц требуют уточнения</p>}</div>}</section></>}
      {tab==='price'&&<><div className="sales-input-grid sales-price-inputs"><DemandNumber label="Цена продажи" field="priceRubKg" value={inputs.priceRubKg} onCommit={update} unit="руб. / кг" max={1e6} hint={`Средняя цена за ${monthName(month)}: ${amount(product.priceRubKg)} руб. / кг. Цена сценария применяется ко всему плану спроса выбранного продукта`}/><DemandNumber label="Дополнительная скидка" field="discountPct" value={inputs.discountPct} onCommit={update} unit="%" max={100} hint="Дополнительная скидка применяется к цене сценария. Историческая цена уже отражает фактическую выручку. Введите 0 для продажи по цене сценария"/><DemandNumber label="Дополнительная доставка" field="logisticsRubKg" value={inputs.logisticsRubKg} onCommit={update} unit="руб. / кг" max={1e6} hint="Дополнительные расходы доставки для этого сценария. Полнота логистических расходов требует подтверждения"/></div><div className="sales-price-result"><div><span>Цена после доп. скидки</span><strong>{known(scenario?.netPriceRubKg)?amount(scenario.netPriceRubKg)+' руб. / кг':'Укажите доп. скидку'}</strong></div><div><span>Выручка</span><strong>{known(scenario?.revenueRub)?revenue(scenario.revenueRub)+' тыс. руб.':pending?'Считаем…':'Требуется ввод'}</strong></div></div>{result?.waterfall?.length>0?<figure className="sales-price-waterfall"><MoneyBridge items={result.waterfall} divisor={Math.max(...result.waterfall.map(x=>Math.abs(x.value)))>=1e6?1e6:1000} unit={Math.max(...result.waterfall.map(x=>Math.abs(x.value)))>=1e6?'млн руб.':'тыс. руб.'}/></figure>:<p className="sales-price-prompt">Цена и дополнительная скидка определяют выручку</p>}<div className="sales-price-adjustments"><span>Доставка по сценарию</span><strong>{known(scenario?.additionalLogisticsRub)?revenue(scenario.additionalLogisticsRub)+' тыс. руб.':'Укажите ставку'}</strong></div></>}
      {tab==='cost'&&<><div className="sales-cost-total"><span>{cost?.status==='partial'?'Себестоимость требует подтверждения':'Производственная себестоимость'}</span><strong>{known(cost?.productionCostRubKg)?amount(cost.productionCostRubKg)+' руб. / кг':detailCurrent?.status==='loading'?'Открываем расчет…':'Требуются данные'}</strong><span>{monthName(month)}</span></div><table className="sales-cost-components"><thead><tr><th>Статья</th><th>руб. / кг</th></tr></thead><tbody>{[['rawCostRubKg','Сырье'],['processingCostRubKg','Переделы'],['packingRubKg','Упаковка']].map(([key,label])=><tr key={key}><th>{label}</th><td>{amount(cost?.[key])}</td></tr>)}</tbody></table><button className="sales-cost-open" type="button" onClick={()=>setCostOpen(true)}>Раскрыть статьи затрат</button><DemandTip text="Производственная себестоимость рассчитана на килограмм выпуска выбранного месяца. Полный состав логистических, коммерческих и управленческих расходов, а также налоговая сопоставимость требуют подтверждения">Состав полной себестоимости требует уточнения ⓘ</DemandTip>{!product.costProductKey&&<p className="sales-cost-warning">Требуется выбор точного продукта в расчете затрат</p>}</>}
     </div>
     <footer className="sales-detail-footer">{ordersInvalid?<p className="sales-validation" role="alert">Заказы превышают план спроса. Увеличьте план или уточните заказы</p>:!known(inputs.plannedDemandKg)?<p>Укажите общий спрос</p>:evaluation?.status==='error'?<p role="alert">Расчет требует повторного запроса <button onClick={()=>setRetry(v=>v+1)}>Повторить</button></p>:pending?<p role="status">Пересчитываем условия</p>:<DemandTip text="Потребность выбранного продукта проверяется вместе с выходом сопутствующей продукции, сырьем и мощностями всех переделов">{missingVolumes.length?'Заполните объемы для проверки плана':'Проверьте общий выпуск и мощности'} ⓘ</DemandTip>}{storageWarning&&<p className="sales-validation">Изменения действуют в текущем сеансе</p>}</footer>
    </>}
   </aside>
  </div>
  {costOpen&&<CostDetails productKey={product?.costProductKey||undefined} initialPeriod={month} onClose={()=>setCostOpen(false)}/>}
 </section>;
}

export default SalesDemandScreen;
