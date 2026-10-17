import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api} from './api.js';
import {MoneyBridge} from './charts.jsx';
import {CostDetails} from './CostDetails.jsx';
import {n} from './format.js';
import {clientPriceChain,negotiatePrice,negotiationInputPrice} from './client-economics.js';
import './client-screen.css';

const known=Number.isFinite;
const emptyTerms={price:null,cost:'',logistics:'',deductions:'',margin:''};
const amount=(value,digits=1)=>known(value)?n(value,digits):'Требуются данные';
const perKg=(value,volume)=>known(value)&&known(volume)&&volume>0?value/volume:null;
const sum=(rows,key)=>rows.every(row=>known(row[key]))?rows.reduce((total,row)=>total+row[key],0):null;
const monthsText=months=>Array.isArray(months)&&months.length?`${months.length} мес. с продажами`:'Период требует подтверждения';
const monthLabel=value=>new Date(`${value}-01T00:00:00Z`).toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).replace(' г.','');

export const CLIENT_STORAGE='severnaya-clients-v1';
export function readClientStore(storage){
 const fresh={version:1,dataset:'clients',selectedIds:{},productIds:{},periods:{},drafts:{}};
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value),id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value),pseudonym=value=>typeof value==='string'&&/^К-\d{3,}$/.test(value),clientRef=value=>id(value)||pseudonym(value);
 const period=value=>value===''||typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
 const productKey=value=>{try{const key=JSON.parse(value);return Array.isArray(key)&&key.length===3&&['clients','deals'].includes(key[0])&&clientRef(key[1])&&id(key[2]);}catch{return false;}};
 try{
  const raw=JSON.parse(storage.getItem(CLIENT_STORAGE)||'null');if(!object(raw)||raw.version!==1)return fresh;
  if(['clients','deals'].includes(raw.dataset))fresh.dataset=raw.dataset;
  for(const [key,value] of Object.entries(object(raw.selectedIds)?raw.selectedIds:{}))if(['clients','deals'].includes(key)&&clientRef(value))fresh.selectedIds[key]=value;
  for(const [key,value] of Object.entries(object(raw.productIds)?raw.productIds:{}))if(/^(clients|deals)\/(?:[A-Za-z0-9_-]{1,100}|К-\d{3,})$/.test(key)&&(value===''||id(value)))fresh.productIds[key]=value;
  for(const [key,value] of Object.entries(object(raw.periods)?raw.periods:{}))if(productKey(key)&&period(value))fresh.periods[key]=value;
  for(const [key,value] of Object.entries(object(raw.drafts)?raw.drafts:{})){
   let context;try{context=JSON.parse(key);}catch{continue;}if(!Array.isArray(context)||context.length!==2||!productKey(context[0])||!period(context[1])||!object(value))continue;
   fresh.drafts[key]=Object.fromEntries(Object.keys(emptyTerms).map(field=>{const v=value[field],valid=typeof v==='string'&&(v.trim()===''||Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=(field==='margin'?99.9:1e6));return [field,valid?v:emptyTerms[field]];}));
  }
 }catch{ return fresh; }
 return fresh;
}

function Tip({text,children=' ⓘ'}){
 const id=useId(),anchor=useRef(null),popup=useRef(null),closeTimer=useRef(null),[position,setPosition]=useState(null);
 const keepOpen=()=>clearTimeout(closeTimer.current),closeSoon=()=>{keepOpen();closeTimer.current=setTimeout(()=>{if(document.activeElement!==anchor.current)setPosition(null);},120);};
 const open=()=>{keepOpen();const rect=anchor.current.getBoundingClientRect();setPosition({left:Math.max(12,Math.min(window.innerWidth-342,rect.left)),top:rect.bottom+8,anchorTop:rect.top,host:anchor.current.closest('dialog')||document.body});};
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 useLayoutEffect(()=>{if(position&&popup.current){const height=popup.current.getBoundingClientRect().height;if(position.top+height>window.innerHeight-12){const top=Math.max(12,position.anchorTop-height-8);if(top!==position.top)setPosition(previous=>previous?{...previous,top}:null);}}},[position]);
 useEffect(()=>{if(!position)return;const close=()=>setPosition(null),escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};window.addEventListener('keydown',escape,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('keydown',escape,true);window.removeEventListener('resize',close);};},[position]);
 return <><span ref={anchor} className="client-source" tabIndex="0" aria-label={children===' ⓘ'?'Пояснение':undefined} aria-describedby={position?id:undefined} onMouseEnter={open} onMouseLeave={closeSoon} onFocus={open} onBlur={()=>setPosition(null)}>{children}</span>{position&&createPortal(<span ref={popup} id={id} role="tooltip" className="client-source-text" style={{left:position.left,top:position.top}} onMouseEnter={keepOpen} onMouseLeave={closeSoon}>{text||'Требуется подтверждение условий'}</span>,position.host)}</>;
}

export default function ClientScreen({onBack}){
 const [saved]=useState(()=>readClientStore(typeof localStorage==='undefined'?{getItem:()=>null}:localStorage));
 const [recommendations,setRecommendations]=useState(null),[periods,setPeriods]=useState(saved.periods),[storageWarning,setStorageWarning]=useState(false);
 const detailPanel=useRef(null);
 const [dataset,setDataset]=useState(saved.dataset),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[query,setQuery]=useState(''),[channel,setChannel]=useState('all'),[signal,setSignal]=useState('all'),[selectedIds,setSelectedIds]=useState(saved.selectedIds),[productIds,setProductIds]=useState(saved.productIds),[counts,setCounts]=useState({}),[rightTab,setRightTab]=useState('economics'),[drafts,setDrafts]=useState(saved.drafts),[details,setDetails]=useState(null),[detailRetry,setDetailRetry]=useState(0),[costOpen,setCostOpen]=useState(false);
 useEffect(()=>{try{localStorage.setItem(CLIENT_STORAGE,JSON.stringify({version:1,dataset,selectedIds,productIds,periods,drafts}));setStorageWarning(false);}catch{setStorageWarning(true);}},[dataset,selectedIds,productIds,periods,drafts]);
 useEffect(()=>{
  const controller=new AbortController();setError('');setData(null);
  api(`files/clients?dataset=${dataset}`,undefined,{signal:controller.signal}).then(result=>{
   if(!Array.isArray(result.clients)||!result.summary)throw new Error('Структура клиентского портфеля требует проверки');
   setData(result);setCounts(previous=>({...previous,[dataset]:result.summary.clientCount,...Object.fromEntries((result.datasets||[]).map(item=>[item.id,item.clientCount]))}));
  }).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message);});
  return()=>controller.abort();
 },[dataset,retry]);
 const clients=data?.clients||[];
 const channels=useMemo(()=>[...new Set(clients.flatMap(client=>client.channels||[]))].sort((a,b)=>a.localeCompare(b,'ru')),[clients]);
 const filtered=useMemo(()=>clients.filter(client=>(!query.trim()||client.pseudonym.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))&&(channel==='all'||client.channels?.includes(channel))&&(signal==='all'||signal==='negative'&&known(client.marginRub)&&client.marginRub<0||signal==='cost'&&(!known(client.reportedCostRubKg)||client.reportedCostCoverage?.knownRowCount<client.reportedCostCoverage?.totalRowCount))).sort((a,b)=>(b.revenueRub??0)-(a.revenueRub??0)),[clients,query,channel,signal]);
 const selectedId=selectedIds[dataset],summaryClient=filtered.find(item=>item.pseudonym===selectedId)||filtered[0],detailKey=summaryClient?`${dataset}/${summaryClient.pseudonym}`:null;
 const productId=productIds[detailKey]||'',setProductId=value=>setProductIds(previous=>({...previous,[detailKey]:value}));
 useEffect(()=>{
  if(!summaryClient)return;
  const controller=new AbortController();setDetails({key:detailKey,status:'loading'});
  api(`files/clients/${encodeURIComponent(summaryClient.pseudonym)}?dataset=${dataset}`,undefined,{signal:controller.signal}).then(result=>{
   if(result.datasetId!==dataset||result.client?.pseudonym!==summaryClient.pseudonym||!Array.isArray(result.client.products))throw new Error('Карточка клиента требует проверки');
   setDetails({key:detailKey,status:'ready',client:result.client});
  }).catch(reason=>{if(reason.name!=='AbortError')setDetails({key:detailKey,status:'error',message:reason.message});});
  return()=>controller.abort();
 },[detailKey,detailRetry]);
 useEffect(()=>{
  if(!summaryClient)return;
  const controller=new AbortController();setRecommendations({key:detailKey,status:'loading'});
  api(`files/recommendations?dataset=${dataset}&pseudonym=${encodeURIComponent(summaryClient.pseudonym)}`,undefined,{signal:controller.signal}).then(result=>{
   if(result.datasetId!==dataset||!Array.isArray(result.products))throw new Error('Ценовые сигналы требуют проверки');
   setRecommendations({key:detailKey,status:'ready',data:result});
  }).catch(reason=>{if(reason.name!=='AbortError')setRecommendations({key:detailKey,status:'error',message:reason.message});});
  return()=>controller.abort();
 },[detailKey,detailRetry]);
 const detailState=details?.key===detailKey?details:null,client=detailState?.client||summaryClient,detailPending=!!client&&(!detailState||detailState.status==='loading');
 const products=client?.products||[],product=products.find(item=>item.id===productId);
 const productKey=product?JSON.stringify([dataset,client.pseudonym,product.id]):null,period=product?.months?.includes(periods[productKey])?periods[productKey]:'';
 const monthly=product?.monthly?.find(row=>row.period===period),selected=monthly?{...monthly,reportedCostRubKg:perKg(monthly.reportedCostRub,monthly.volumeKg),months:[period]}:product||client;
 const draftKey=product?JSON.stringify([productKey,period]):null,terms=drafts[draftKey]||emptyTerms;
 const setPeriod=value=>setPeriods(previous=>({...previous,[productKey]:value}));
 const changeTerm=(key,value)=>setDrafts(previous=>({...previous,[draftKey]:{...(previous[draftKey]||emptyTerms),[key]:value}}));
 useEffect(()=>setCostOpen(false),[client?.pseudonym,product?.id,period,dataset]);
 const chooseDataset=value=>{setRightTab('economics');setDataset(value);setQuery('');setChannel('all');setSignal('all');};
 const chooseClient=id=>{setSelectedIds(previous=>({...previous,[dataset]:id}));if(window.matchMedia('(max-width: 760px)').matches)requestAnimationFrame(()=>detailPanel.current?.scrollIntoView({block:'start'}));};
 if(!data)return <main className="client-loading" aria-busy={!error}><span className="client-brand">Северная</span><h1>{error?'Портфель требует подключения':'Открываем портфель клиентов'}</h1><p>{error||'Загружаем объемы, цены и учтенные затраты'}</p><div>{error&&<button onClick={()=>setRetry(value=>value+1)}>Повторить подключение</button>}<button onClick={onBack}>К планированию</button></div></main>;
 const filteredVolume=sum(filtered,'volumeKg'),filteredRevenue=sum(filtered,'revenueRub');
 const chain=clientPriceChain(selected?.reportedCostCoverage?.knownRowCount===0?{...selected,reportedCostRubKg:null}:selected),{price,bars}=chain;
 const inputNumber=value=>value.trim()===''?null:Number(value);
 const negotiation=negotiatePrice({basePrice:selected?.priceRubKg,volumeKg:selected?.volumeKg,price:negotiationInputPrice(terms.price,selected?.priceRubKg),cost:inputNumber(terms.cost),logistics:inputNumber(terms.logistics),deductions:inputNumber(terms.deductions),targetMargin:inputNumber(terms.margin)});
 const signed=value=>known(value)?(value>0?'+':'')+n(value,1):'Требуются данные';
 const coverage=selected?.logisticsCoverage||client?.logisticsCoverage;
 const priceSignals=recommendations?.key===detailKey?recommendations:null,signalData=priceSignals?.data,productSignal=signalData?.products.find(item=>item.productId===product?.id),selectedSignals=(product?productSignal?.signals||[]:signalData?.products.flatMap(item=>item.signals)||[]).filter(item=>!period||!product||item.period===period),bestSignal=selectedSignals[0];
 const reviewRub=priceSignals?.status==='ready'&&dataset==='clients'?selectedSignals.reduce((total,item)=>total+item.scenarioRub,0):null;
 const nextAction=product?(selectedSignals.length?'Проверить цену и условия сопоставимых поставок':'Сверить состав затрат и договорные условия'):signalData?.action;
 const openNegotiation=(followSignal=false)=>{setRightTab('negotiation');if(product&&!followSignal)return;const candidate=product?productSignal:strongestProduct;if(candidate?.bestSignal){setProductId(candidate.productId);setPeriods(previous=>({...previous,[JSON.stringify([dataset,client.pseudonym,candidate.productId])]:candidate.bestSignal.period}));}else if(!productId&&products.length)setProductId(products[0].id);};
 const strongestProduct=signalData?.products.filter(item=>item.bestSignal&&products.some(p=>p.id===item.productId)).sort((a,b)=>b.bestSignal.scenarioRub-a.bestSignal.scenarioRub)[0];
 const signalExplanation=bestSignal?`Гипотеза: средневзвешенная цена других клиентов того же продукта, состояния, канала и месяца. Объем клиента ${amount(bestSignal.focalVolumeKg/1000,2)} т; остальных ${amount(bestSignal.peerVolumeKg/1000,2)} т. Разрыв ${amount(bestSignal.gapShare*100,1)}% от цены группы. Сопоставимость упаковки, договора и спроса требует подтверждения`:'';
 return <div className="client-app">
  <header className="client-topbar"><span className="client-brand">Северная</span><span>Производство и продажи</span><button onClick={onBack}>К планированию</button></header>
  <header className="client-heading"><div><h1>Клиенты и экономика продаж</h1><p>{data.period?.label||'Период требует подтверждения'} <Tip text={'Требуется подтверждение: полная себестоимость, коммерческие расходы, фактическая доставка, договорные скидки, бонусы и отсрочки. Исторические цены относятся к указанным месяцам. Рыночная цена, сопоставимость каналов и причины расхождений отчетной маржи уточняются отдельно'}>Границы расчета</Tip></p></div><div className="client-datasets" role="group" aria-label="Набор исходных данных">{[['clients','Клиентский отчет'],['deals','Отчет сделок']].map(([id,label])=><button key={id} aria-pressed={dataset===id} className={dataset===id?'selected':''} onClick={()=>chooseDataset(id)}>{label}{known(counts[id])&&<span>{n(counts[id],0)}</span>}</button>)}</div></header>
  <section className="client-metrics" aria-label="Показатели выбранных клиентов"><div><span>Клиенты в выборке</span><strong>{n(filtered.length,0)} <small>из {amount(data.summary.clientCount,0)}</small></strong></div><div><span>Объем выборки</span><strong>{amount(known(filteredVolume)?filteredVolume/1000:null,1)} <small>т</small></strong></div><div><span>Выручка выборки</span><strong>{amount(known(filteredRevenue)?filteredRevenue/1e6:null,1)} <small>млн руб.</small></strong></div></section>
  <main className="client-workbench">
   <section className="client-portfolio" aria-label="Клиентский портфель">
    <div className="client-filters"><label>Поиск клиента<input type="search" value={query} placeholder="Псевдоним клиента" onChange={event=>setQuery(event.target.value)}/></label><label>Канал<select value={channel} onChange={event=>setChannel(event.target.value)}><option value="all">Все каналы</option>{channels.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Сигнал<select value={signal} onChange={event=>setSignal(event.target.value)}><option value="all">Все клиенты</option><option value="negative">Маржа ниже нуля</option><option value="cost">Проверить затраты</option></select></label></div>
    <div className="client-table-scroll" tabIndex="0" aria-label="Все клиенты выбранного набора"><table className="client-table"><thead><tr><th scope="col">Клиент / канал</th><th scope="col">Объем<br/>т</th><th scope="col">Цена<br/>руб. / кг</th><th scope="col">Затраты отчета<br/>руб. / кг</th><th scope="col">Маржа отчета<br/>руб. / кг</th></tr></thead><tbody>{filtered.map(row=>{const m=perKg(row.marginRub,row.volumeKg);return <tr key={row.pseudonym} className={row.pseudonym===client?.pseudonym?'selected':''}><td><button onClick={()=>chooseClient(row.pseudonym)} aria-pressed={row.pseudonym===client?.pseudonym}>{row.pseudonym}</button><span title={(row.channels||[]).join(', ')}>{row.channels?.join(', ')||'Канал требует уточнения'}</span></td><td>{amount(known(row.volumeKg)?row.volumeKg/1000:null,1)}</td><td>{amount(row.priceRubKg,1)}</td><td className={!known(row.reportedCostRubKg)?'client-missing':''}>{amount(row.reportedCostCoverage?.knownRowCount===0?null:row.reportedCostRubKg,1)}</td><td className={known(m)&&m<0?'client-negative':!known(m)?'client-missing':''}>{amount(m,1)}</td></tr>;})}</tbody></table>{!filtered.length&&<div className="client-empty">Поиск требует другого имени или канала</div>}</div>
   </section>
   <aside ref={detailPanel} className="client-detail" aria-label="Экономика выбранного клиента" aria-busy={detailPending}>{client?detailPending?<><header><h2>{client.pseudonym}</h2></header><p className="client-missing">Загружаем продукцию и экономику клиента</p></>:detailState?.status==='error'?<><header><h2>{client.pseudonym}</h2></header><p className="client-missing">{detailState.message}</p><button className="client-detail-action" onClick={()=>setDetailRetry(value=>value+1)}>Повторить подключение</button></>:<>
    <header><h2>{client.pseudonym}</h2><p>{client.channels?.join(', ')||'Канал требует уточнения'}</p></header>
    {storageWarning&&<p className="client-missing" role="status">Условия сохранены в текущем сеансе; сохранение в браузере требует свободного места</p>}
    <div className="client-detail-tabs" role="group" aria-label="Действие с клиентом">{[['economics','Экономика'],['negotiation','Переговоры']].map(([id,label])=><button key={id} className={rightTab===id?'selected':''} aria-pressed={rightTab===id} onClick={()=>id==='negotiation'?openNegotiation():setRightTab(id)} aria-label={label}>{id==='negotiation'&&strongestProduct?'Проверить цену':label}</button>)}</div>
    <div className="client-selection"><label className="client-product-select">Продукция клиента<select value={productId} onChange={event=>setProductId(event.target.value)}><option value="">{rightTab==='negotiation'?'Выберите продукт':`Вся продукция / ${n(products.length,0)} позиций`}</option>{products.map(item=><option key={item.id} value={item.id}>{item.label}{item.state?' / '+item.state:''}</option>)}</select></label>
    {product&&<label className="client-period-select">Период расчета<select value={period} onChange={event=>setPeriod(event.target.value)}><option value="">Весь период отчета</option>{[...(product.months||[])].sort().map(value=><option key={value} value={value}>{monthLabel(value)}{productSignal?.signals.some(item=>item.period===value)?' / ценовой сигнал':''}</option>)}</select></label>}</div>
    {rightTab==='economics'?<div className="client-economy-grid"><div className="client-accounting">
    <div className="client-price"><div><span>{product?'Средняя цена позиции':'Средняя цена корзины'}</span><strong>{amount(price,1)} <small>руб. / кг</small></strong></div><p>{amount(known(selected.volumeKg)?selected.volumeKg/1000:null,2)} т<br/>{monthsText(selected.months||client.months)}</p></div>
    <figure className="client-chain"><figcaption><h3>Цена и затраты отчета</h3><Tip text="Сверка – разница между выручкой, учтенными затратами, логистикой и маржой. Полная себестоимость требует подтверждения"/></figcaption>{bars?<MoneyBridge items={bars} unit="руб. / кг" divisor={1}/>:<p className="client-missing">Цепочка расчета требует заполнения статей</p>}</figure>
    <dl className="client-cost-lines"><dt>Полная себестоимость</dt><dd className={!known(selected.fullCostRubKg)?'client-missing':''}>{known(selected.fullCostRubKg)?amount(selected.fullCostRubKg,1)+' руб. / кг':'Требуются данные'}</dd><dt>Скидки и бонусы</dt><dd className={!known(selected.discountRub)?'client-missing':''}>{known(selected.discountRub)?amount(selected.discountRub,0)+' руб.':'Требуются данные'}</dd><dt>Полная логистика</dt><dd className={!known(selected.logisticsRub)?'client-missing':''}>{known(selected.logisticsRub)?amount(selected.logisticsRub,0)+' руб.':'Требуются данные'}</dd></dl>
    {product&&<button className="client-detail-action" onClick={()=>setCostOpen(true)}>Производственная себестоимость / {monthLabel(period||[...(product.months||[])].sort().at(-1))}</button>}
    {product&&<section className="client-range"><h3>Наблюдаемые цены позиции</h3>{known(selected.observedMinPriceRubKg)&&known(selected.observedMaxPriceRubKg)?<><div className="client-range-line"><strong>{amount(selected.observedMinPriceRubKg,1)}</strong><span/><strong>{amount(selected.observedMaxPriceRubKg,1)} <small>руб. / кг</small></strong></div><p>Рыночный потолок требует подтверждения</p></>:<p className="client-missing">Диапазон цен требует сопоставимых наблюдений</p>}</section>}
    </div>
    <section className="client-recommendations" aria-label="Рекомендации клиенту"><header><h3>Ценовой потенциал / гипотеза</h3><Tip text="Сумма разрывов до исторической цены других клиентов того же товара, состояния, месяца и канала при сохранении объема. Сопоставимость договоров и текущий спрос требуют подтверждения"/></header><strong>{known(reviewRub)?amount(reviewRub/1e6,2)+' млн руб.':'Требуется сопоставление'}</strong><p>{known(reviewRub)?`${selectedSignals.length} ценовых сигналов / ${product?(period?monthLabel(period):'продукт за период'):'вся продукция клиента'}`:'Канал и сопоставимые поставки требуют подтверждения'}</p><dl><dt>Цена</dt><dd>{nextAction||'Сверить состав затрат и договорные условия'}</dd><dt>Скидки</dt><dd>Рассчитать предел по полной себестоимости, бонусам и целевой марже</dd><dt>Доставка</dt><dd>{dataset==='deals'?'Сверить распределенную ставку с рейсами и загрузкой транспорта':'Связать стоимость рейсов с поставками клиента и проверить загрузку транспорта'}</dd></dl>{selectedSignals.length>0&&<button className="client-detail-action" onClick={()=>openNegotiation(true)}>Разобрать ценовой сигнал</button>}</section>
    </div>:product?<section className="client-negotiation" aria-label="Условия переговоров">
     {bestSignal&&<section className="client-price-hypothesis"><header><h3>Гипотеза цены</h3><Tip text={signalExplanation}/></header><div><span>{amount(bestSignal.priceRubKg,1)} → {amount(bestSignal.referencePriceRubKg,1)} руб. / кг</span><strong>+{amount(bestSignal.priceGapRubKg,1)}</strong></div><p>{monthLabel(bestSignal.period)} / {bestSignal.peerClients} других клиентов</p><p>{amount(bestSignal.scenarioRub/1e6,2)} млн руб. на {amount(bestSignal.focalVolumeKg/1000,2)} т объема этого месяца</p></section>}
     {priceSignals?.status==='error'&&<p className="client-missing">Ценовые сигналы требуют подключения</p>}
     <div className="client-history"><h3>Цены за период</h3><div>{[['Минимум',selected.observedMinPriceRubKg],['Средняя',selected.priceRubKg],['Максимум',selected.observedMaxPriceRubKg]].map(([label,value])=><div key={label}><span>{label}</span><strong>{amount(value,1)}</strong></div>)}</div><p>руб. / кг. Рыночный потолок требует подтверждения</p></div>
     <div className="client-terms"><h3>Условия сценария / {period?monthLabel(period):'весь период отчета'}</h3><p className="client-negotiation-note">Все суммы вводятся на единой налоговой основе</p>{[['price','Предлагаемая цена','руб. / кг'],['deductions','Бонусы и удержания','руб. / кг'],['cost','Себестоимость до доставки','руб. / кг'],['logistics','Доставка','руб. / кг'],['margin','Целевая маржа','%']].map(([key,label,unit])=><label key={key}><span>{label}{key==='price'&&<Tip text="Начальное предложение равно средней цене отчета. Поле показывает два знака после запятой; расчет сохраняет исходную точность до первого изменения цены"> ⓘ</Tip>}{key==='cost'&&<Tip text="Введите полную себестоимость продукта до доставки. Учтенные затраты отчета служат исторической справкой"> ⓘ</Tip>}{key==='deductions'&&<Tip text="Введите дополнительные удержания после выставления счета на килограмм, включая явный 0. Состав скидок внутри цены отчета требует подтверждения. Целевая маржа считается от цены после удержаний"> ⓘ</Tip>}</span><div><input type="number" value={terms[key]??(known(selected.priceRubKg)?String(Number(selected.priceRubKg.toFixed(2))):'')} min="0" max={key==='margin'?99.9:1e6} step={key==='margin'?.1:.01} placeholder="Введите" onChange={event=>changeTerm(key,event.target.value)}/><small>{unit}</small></div></label>)}</div>
     <div className="client-negotiation-result"><div><span>Порог цены</span><strong>{known(negotiation.thresholdPriceRubKg)?amount(negotiation.thresholdPriceRubKg,1)+' руб. / кг':'Требуются все условия'}</strong></div><div><span>Допустимая скидка по сценарию</span><strong className={negotiation.discountHeadroomPct<0?'client-negative':''}>{known(negotiation.discountHeadroomPct)?amount(Math.max(0,negotiation.discountHeadroomPct),1)+'%':'Требуются условия'}</strong></div></div>
     {known(negotiation.discountHeadroomPct)&&negotiation.discountHeadroomPct<0&&<p className="client-negative">Цена требует повышения на {amount(negotiation.thresholdPriceRubKg-negotiationInputPrice(terms.price,selected.priceRubKg),2)} руб. / кг для целевой маржи</p>}
     <button className="client-detail-action client-reset-terms" onClick={()=>setDrafts(previous=>{const next={...previous};delete next[draftKey];return next;})}>Сбросить условия</button>
     <div className="client-revenue-effect"><span>Изменение выручки / {period?monthLabel(period):'весь период отчета'}</span><strong className={negotiation.revenueChangeRub<0?'client-negative':''}>{known(negotiation.revenueChangeRub)?signed(negotiation.revenueChangeRub/1000)+' тыс. руб.':'Требуется предлагаемая цена'}</strong><p>При сохранении {amount(selected.volumeKg/1000,2)} т исторического объема</p></div>
    </section>:<p className="client-missing">Выберите продукт для условий переговоров</p>}
    {known(coverage?.share)&&<div className="client-detail-notes"><p>Расчет логистики: {n(coverage.share*100,1)}% объема <Tip text="Покрытие показывает наличие расчетной ставки. Фактическая доставка требует подтверждения"/></p></div>}
   </>:<div className="client-empty">Выберите клиента через поиск</div>}</aside>
  </main>
  {costOpen&&<CostDetails productKey={product?.costProductKey||undefined} initialPeriod={period||[...(product?.months||[])].sort().at(-1)} onClose={()=>setCostOpen(false)}/>}
 </div>;
}
