import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api} from './api.js';
import {MoneyBridge} from './charts.jsx';
import {CHAIN_NODES,getNodeCapacity} from './chain-nodes.js';
import {n} from './format.js';
import {DEFAULTS,validFileInputs,loadFileInputs,saveFileInputs,COLD_START_RETRY_MS} from './file-inputs.js';
import './file-screen.css';

const signed=(v,d=1)=>{const rounded=Number(v.toFixed(d))||0;return(rounded>0?'+':'')+n(rounded,d);};
const ROUTE_SHORT=['Грудка и четвертина','Филе и окорочок','Филе, бедро со спинкой','Филе, бедро и голень','Филе и мясо бедра'];
const STAGE_SHORT={receiving:'Приемка',hanging:'Навеска',slaughter:'Убой',plucking:'Ощипка',evisceration:'Потрошение',water_cooling:'Охлаждение',carcass_cold_store:'Холодильник',sorting:'Сортировка',bulk_carcass_pack:'Тушка в ящик',individual_carcass_pack:'Тушка в пакет',liver:'Ливер',byproduct_pack:'Субпродукты',feet_pack:'Упаковка лап',cutting:'Разделка',breast_fillet:'Филе грудки',thigh_fillet:'Филе бедра',ishida_pack:'Упаковка ISHIDA'};
// Цвет части назначается по ее смыслу, а не по порядку в списке: потери всегда риск, части – палитра документа.
const PART_COLORS=[[/утил|потер/i,'var(--risk)'],[/филе/i,'#003C72'],[/окорочок|бедр/i,'#6E8CA8'],[/крыл/i,'#8DB8E0'],[/каркас/i,'#F2AA00'],[/потроха|ливер|печен|сердц|желуд/i,'#2E8B57']];
const partColor=name=>PART_COLORS.find(([re])=>re.test(name))?.[1]||'#52677D';
// Загрузка переделов: шкала до 130% с отметкой 100%.
const LOAD_SCALE=1.3;

function Tip({text,children,className='',style}){
 const [position,setPosition]=useState(null),id=useId(),ref=useRef(null);
 const open=e=>{const r=e.currentTarget.getBoundingClientRect();setPosition({left:Math.max(12,Math.min(innerWidth-308,r.left)),top:r.bottom+8,anchor:r.top,host:e.currentTarget.closest('dialog')||document.body});};
 useEffect(()=>{if(!position)return;const close=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setPosition(null);}};document.addEventListener('keydown',close,true);return()=>document.removeEventListener('keydown',close,true);},[!!position]);
 useLayoutEffect(()=>{if(!position||!ref.current)return;const h=ref.current.offsetHeight;if(position.top+h>innerHeight-10)setPosition(p=>({...p,top:Math.max(10,p.anchor-h-8)}));},[position?.anchor]);
 return <span className={`file-tip ${className}`} style={style} tabIndex="0" aria-describedby={position?id:undefined} onMouseEnter={open} onMouseLeave={()=>setPosition(null)} onFocus={open} onBlur={()=>setPosition(null)} onClick={open} onKeyDown={e=>{if(e.key==='Escape'&&position){e.preventDefault();e.stopPropagation();setPosition(null);}}}>{children}{position&&createPortal(<span ref={ref} id={id} role="tooltip" className="file-tooltip" style={{left:position.left,top:position.top}}>{text}</span>,position.host)}</span>;
}
function Input({label,value,onChange,min=0,max=100,step=1,unit,tip,field}){
 const id=useId(),[draft,setDraft]=useState(value);
 useEffect(()=>setDraft(value),[value]);
 const commit=()=>{const v=Number(draft);if(draft===''||!Number.isFinite(v)){setDraft(value);return;}const next=Math.max(min,Math.min(max,v));onChange(next);setDraft(next);};
 return <div className="file-input"><label htmlFor={id}>{label}{tip&&<Tip text={tip}> ⓘ</Tip>}</label><div><input id={id} data-file-field={field} type="number" min={min} max={max} step={step} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>{unit}</span></div></div>;
}
function Details({title,children,onClose}){
 const ref=useRef(null);
 useEffect(()=>{const opener=document.activeElement;ref.current.showModal();return()=>opener?.focus();},[]);
 return <dialog className="file-dialog" ref={ref} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header><h2>{title}</h2><button onClick={onClose} aria-label="Закрыть подробности">Закрыть</button></header><div>{children}</div></dialog>;
}
// Строки переделов: нагрузка относительно мощности, отметка 100% и значения в тоннах за сутки.
function StageRows({rows}){
 return <div className="file-stage-list">{rows.map(r=>{const load=r.load,width=load==null?0:Math.min(LOAD_SCALE,load)/LOAD_SCALE*100;return <div className="file-stage-row" key={r.id}><span><Tip text={r.massBasis}>{r.label}</Tip></span><div className="file-stage-track" aria-hidden="true"><i className={r.headroom<0?'over':''} style={{width:`${width}%`}}/><em style={{left:`${100/LOAD_SCALE}%`}}/></div><b className={r.headroom<0?'file-bad':''}>{load==null?'Требуется мощность':n(load*100,1)+'%'}</b><small>{n(r.demand/1000,2)} / {n(r.capacity/1000,2)} т</small></div>;})}</div>;
}

function ProductionPath({capacity,onOpen,openId}){
 const ids=['slaughter','cooling','cutting','packaging'];
 const card=(id)=>{const node=CHAIN_NODES.find(x=>x.id===id),state=getNodeCapacity(node,capacity),r=state.worst,open=openId===id;return <button key={id} className={`raw-step raw-${id} ${state.tone} ${open?'is-open':''}`} aria-expanded={open} onClick={()=>onOpen(id)} aria-label={`${node.name}: ${open?'скрыть':'раскрыть'} мощности`}><span>{node.name}</span><strong>{state.load===null?'Уточнить':n(state.load*100,0)+'%'}</strong><small>{r?<Tip text={`${STAGE_SHORT[r.id]||r.label}: ${r.massBasis}`}>{`${n(r.demand/1000,1)} / ${n(r.capacity/1000,1)} т`}</Tip>:'Указать условия'}</small></button>;};
 return <div className="raw-path"><svg viewBox="0 0 500 185" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="raw-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M1 1l4 2-4 2" fill="none" stroke="#8299ac"/></marker></defs><path d="M104 40H140M228 40H267M352 40H394" markerEnd="url(#raw-arrow)"/><path d="M187 74V110H437V74" className="raw-alternative" markerEnd="url(#raw-arrow)"/><path d="M437 74V137" markerEnd="url(#raw-arrow)"/><path d="M61 74V137" markerEnd="url(#raw-arrow)"/><path d="M226 161H366" className="raw-alternative" markerEnd="url(#raw-arrow)"/></svg><div className="raw-main">{ids.map(card)}</div><span className="raw-whole">Целая тушка → упаковка</span><div className="raw-branches">{card('byproducts')}<button className={`raw-shipment ${openId==='storage'?'is-open':''}`} aria-expanded={openId==='storage'} onClick={()=>onOpen('storage')}><span>Хранение и отгрузка</span><small>Сроки и остатки</small></button></div></div>;
}

export default function FileScreen({initialInputs,onInputsChange}){
 const [inputs,setInputs]=useState(()=>validFileInputs(initialInputs)?{...initialInputs}:loadFileInputs()),[catalog,setCatalog]=useState(null),[capacity,setCapacity]=useState(null),[economics,setEconomics]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[detail,setDetail]=useState(null),[openNode,setOpenNode]=useState(null);
 useEffect(()=>{saveFileInputs(inputs);onInputsChange?.(inputs);},[inputs,onInputsChange]);
 // Ссылка «Источники» живет в заголовке блока на экране, диалог открывается событием.
 useEffect(()=>{const open=event=>setDetail(event.detail);window.addEventListener('planner:file-detail',open);return()=>window.removeEventListener('planner:file-detail',open);},[]);
 // Первый запрос после холодного запуска повторяется автоматически; состояние загрузки показывается до последней попытки.
 useEffect(()=>{const controller=new AbortController();let timer=0;setError('');
  const load=attempt=>api('files/economics',undefined,{signal:controller.signal}).then(setCatalog).catch(e=>{if(e.name==='AbortError')return;if(attempt<COLD_START_RETRY_MS.length){timer=setTimeout(()=>load(attempt+1),COLD_START_RETRY_MS[attempt]);return;}setError(e.message);});
  load(0);return()=>{controller.abort();clearTimeout(timer);};},[retry]);
 useEffect(()=>{const controller=new AbortController();setBusy(true);setError('');const {routeId,cutInputKg,priceChangePct,packagingChangePct,feetStaffDelta,liverStaffDelta,cuttingNetHoursDelta}=inputs;
  Promise.all([api('files/capacity/evaluate',{feetStaffDelta,liverStaffDelta,cuttingNetHoursDelta},{signal:controller.signal}),api('files/economics/evaluate',{routeId,cutInputKg,priceChangePct,packagingChangePct},{signal:controller.signal})]).then(([c,e])=>{setCapacity(c);setEconomics(e);setBusy(false);}).catch(e=>{if(e.name!=='AbortError'){setError(e.message);setBusy(false);}});return()=>controller.abort();
 },[inputs,retry]);
  const change=(key,value)=>setInputs(p=>({...p,[key]:value}));
 if(!catalog||!capacity||!economics)return <main className="app-loading"><div className="loading-brand">Северная</div><h1>{error?'Подключите данные предприятия':'Открываем расчет по файлам'}</h1><p>{error||'Загружаем выходы разделки, мощности и экономику'}</p>{error&&<button className="primary" onClick={()=>setRetry(x=>x+1)}>Повторить подключение</button>}<a href="#plan">Открыть сценарий недели</a></main>;
 const routes=catalog.yields.routes,products=Object.fromEntries(catalog.yields.products.map(p=>[p.id,p])),route=routes.find(r=>r.id===economics.routeId),displayKg=economics.inputKg,calc=economics.scenario.rubPerKg,base=economics.baseline.rubPerKg;
 const outputs=route.outputs.filter(x=>x.yield_fraction>0).map(x=>({...x,name:products[x.product_id].name,category:products[x.product_id].category}));
 const principal=outputs.filter(x=>x.category==='основной продукт'),secondary=outputs.filter(x=>!['основной продукт','потери'].includes(x.category));
 const secondaryYield=secondary.reduce((sum,x)=>sum+x.yield_fraction,0);
 const basket=[...principal,...(secondaryYield?[{product_id:'secondary',name:'Сопутствующие продукты',yield_fraction:secondaryYield}]:[]),...(route.loss_fraction?[{product_id:'waste_loss',name:'Утиль и потери',yield_fraction:route.loss_fraction}]:[])];
 const c=capacity.scenario,missing=economics.completeness.complete===false,overloaded=capacity.rows.filter(r=>r.headroom<-.000001),deltaCapacity=capacity.combinedEffect.fulfilledPlanDeltaKgDay;
 const requiredStaff=id=>{const row=capacity.rows.find(r=>r.id===id),daily=row.hours*row.kgPerPersonHour;return Math.max(0,(row.requiredStaffTotalRounded??Math.ceil(row.demand/daily-1e-9))-Math.round(row.baseCapacity/daily));};
 const comparisons=economics.comparison.map(x=>x.rubPerKg.incrementalResult),comparisonMin=Math.min(0,...comparisons),comparisonSpan=Math.max(1,Math.max(0,...comparisons)-comparisonMin);
 const nodeRows=openNode&&openNode!=='storage'?capacity.rows.filter(r=>(CHAIN_NODES.find(x=>x.id===openNode)?.stages||[]).includes(r.id)):[];
 const nodeName=openNode?(CHAIN_NODES.find(x=>x.id===openNode)?.name||'Хранение и отгрузка'):'';
 const bars=[{name:'Продажа\nчастей',value:calc.revenue,total:true},{name:'Продажа\nтушки',value:-calc.wholePrice},{name:'Упаковка\nтушки',value:calc.wholePackaging},{name:'Упаковка\nчастей',value:-calc.packaging},{name:'Прирост',value:calc.incrementalResult,total:true}];
 const leverMax=Math.max(1e-9,...economics.leverEffects.map(x=>Math.abs(x.incrementalPerKg)));
 return <div className="file-app file-embedded">
  <header className="file-heading"><div><p>{busy?'Предыдущий расчет / обновляем по новым условиям':error?'Предыдущий расчет / требуется повторный запрос':'Производство и продажи'}</p><h1>{overloaded.length?`${overloaded.length} ${overloaded.length===1?'участок ограничивает':overloaded.length<5?'участка ограничивают':'участков ограничивают'} выпуск`:'Мощности покрывают план выпуска'}</h1></div><div className="file-head-metrics"><Tip text={`Ограничивает участок: ${c.limitingLabel}`}><span>Предел сохраненного плана, т / сут</span><strong className="kpi-value">{n(c.maxFinishedKgDay/1000,1)}</strong></Tip><Tip text="Покрытие сохраненным планом; денежная оценка требует подтвержденных продаж"><span>Покрытие плана</span><strong className={`kpi-value ${c.shortfallKgDay>0?'file-watch':'file-good'}`}>{n(c.fulfilledPlanKgDay/capacity.plan.finishedKgDay*100,1)}%</strong></Tip></div></header>
  {error&&<div className="file-error" role="alert">{error}<button onClick={()=>setRetry(x=>x+1)}>Повторить расчет</button></div>}
  <main className={`file-workbench ${busy||error?'file-pending':''}`} aria-busy={busy}>
   <aside className="file-controls"><h2><span>1</span>Рычаги</h2>
    <section><h3>Разделка и цены</h3><label className="file-select">Схема разделки<select value={inputs.routeId} onChange={e=>change('routeId',e.target.value)}>{routes.map((r,i)=><option key={r.id} value={r.id}>{ROUTE_SHORT[i]}</option>)}</select></label>
     <Input label="Партия тушки" value={inputs.cutInputKg/1000} onChange={v=>change('cutInputKg',v*1000)} max={10000} step={.1} unit="т" tip="Партия входной потрошеной тушки первого сорта для сравнения пяти схем. Суточные загрузки переделов относятся к отдельному сохраненному плану"/>
     <Input label="Цена продуктов" value={inputs.priceChangePct} onChange={v=>change('priceChangePct',v)} min={-100} max={100} step={.5} unit="%" tip="Изменение цены всей корзины разделки относительно марта 2026. Цена целой тушки остается базой сравнения. Спрос требует подтверждения"/>
     <Input label="Цена упаковки" value={inputs.packagingChangePct} onChange={v=>change('packagingChangePct',v)} min={-100} max={100} step={1} unit="%" tip="Изменение затрат на упаковку корзины разделки. Упаковка целой тушки сохраняет исходную стоимость"/>
    </section>
    <section><h3>Добавить ресурсы</h3><Input field="feetStaffDelta" label="Лапы: персонал" value={inputs.feetStaffDelta} onChange={v=>change('feetStaffDelta',Math.round(v))} max={30} unit="чел." tip="Дополнительные штатные единицы за сутки. Модель сохраняет производительность и 12 часов работы сотрудника"/>
     <Input field="liverStaffDelta" label="Ливер: персонал" value={inputs.liverStaffDelta} onChange={v=>change('liverStaffDelta',Math.round(v))} max={20} unit="чел." tip="Дополнительные штатные единицы за сутки. Общий эффект зависит от других узких мест"/>
     <Input field="cuttingNetHoursDelta" label="Часы разделки" value={inputs.cuttingNetHoursDelta} onChange={v=>change('cuttingNetHoursDelta',v)} max={8} step={.5} unit="ч / сут" tip="Дополнительные часы чистой работы STORK и MEYN. Календарные часы, труд и выпуск рассчитываются отдельно"/>
     <button className="file-recommendation" disabled={busy} onClick={()=>setInputs(p=>({...p,feetStaffDelta:requiredStaff('feet_pack'),liverStaffDelta:requiredStaff('liver')}))}>Проверить усиление двух участков</button>
    </section><button className="file-reset" onClick={()=>setInputs({...DEFAULTS})}>Сбросить изменения</button>
   </aside>
   <section className="file-production"><h2><span>2</span>Выпуск и переделы</h2>
    <section className="file-basket"><div className="file-section-line"><h3>Выход разделки / {n(displayKg/1000,1)} т тушки</h3><button onClick={()=>setDetail('yields')}>Выходы ⓘ</button></div><div className="file-mass-track" role="img" aria-label={`Баланс массы ${n(route.total_yield_fraction*100,1)}%, включая утиль и потери`}>{basket.map(x=><Tip key={x.product_id} text={`${x.name}: ${n(x.yield_fraction*100,3)}% / ${n(x.yield_fraction*displayKg,2)} кг`} className="file-mass-piece" style={{width:`${x.yield_fraction*100}%`}}><i style={{background:partColor(x.name)}}/></Tip>)}</div>
     <div className="file-legend" id="file-yields">{basket.map(x=><Tip key={x.product_id} className="chip chip-legend" text={`${n(x.yield_fraction*displayKg,1)} кг`}><i style={{background:partColor(x.name)}} aria-hidden="true"/>{x.name} {n(x.yield_fraction*100,1)}%</Tip>)}</div>
    </section>
    <section className="file-capacity"><div className="file-section-line"><h3>Путь сырья</h3><button onClick={()=>setDetail('capacity')}>Все мощности</button></div><div className="file-period-note">Нагрузка / мощность за сутки</div><ProductionPath capacity={capacity} openId={openNode} onOpen={id=>setOpenNode(openNode===id?null:id)}/>
     {openNode&&<div className="file-node-detail" id="file-node-detail"><h4>{nodeName}</h4>{nodeRows.length?<StageRows rows={nodeRows}/>:<p className="mini-note">Требуются данные: емкость, остатки и сроки отгрузки</p>}</div>}
     <div className="file-capacity-result"><span>{c.shortfallKgDay>0?'Дефицит мощности':'Покрытие выпуска'}</span><strong className={c.shortfallKgDay>0?'file-bad':'file-good'}>{c.shortfallKgDay>0?n(c.shortfallKgDay/1000,1)+' т / сут':'100%'}</strong><button onClick={()=>setDetail('levers')}>Эффект рычагов</button></div>
    </section>
   </section>
   <aside className="file-economy"><h2><span>3</span>Экономика разделки</h2>
    <div className="file-finance-total"><Tip text="Прирост к продаже той же массы целой тушки после упаковки"><span>Результат после упаковки ⓘ</span><strong className={`kpi-value ${calc.incrementalResult<0?'file-bad':''}`}>{signed(calc.incrementalResult,2)} <small>руб. / кг</small></strong></Tip><span>{signed(economics.scenario.incrementalResult/1000,2)} тыс. руб. на партию</span></div>
    <figure className="file-waterfall"><figcaption><h3>Стакан результата</h3><Tip text="Подписи ступеней округлены. Наведение и клавиатурный фокус показывают точное значение каждой статьи">ⓘ</Tip></figcaption><MoneyBridge items={bars} unit="руб. / кг" divisor={1}/></figure>
    <section className="file-schemes"><div className="file-section-line"><h3>Сравнение пяти схем</h3><Tip text="Одинаковые цены марта 2026 и размер партии. Дополнительные затраты переделов и ограничения спроса требуют подтверждения для выбора плана">После упаковки ⓘ</Tip></div>{economics.comparison.map((r,i)=><button key={r.routeId} title={r.completeness.complete?r.name:r.name+': требуется цена и упаковка кожи бедра; сохраненная строка оценена в ноль'} className={r.routeId===economics.routeId?'selected':''} aria-pressed={r.routeId===economics.routeId} onClick={()=>change('routeId',r.routeId)}><span>{ROUTE_SHORT[i]}</span>{!r.completeness.complete&&<span className="chip chip-none file-incomplete">Неполно</span>}<i><em style={{left:`${-comparisonMin/comparisonSpan*100}%`}}/><b style={{left:`${(Math.min(0,r.rubPerKg.incrementalResult)-comparisonMin)/comparisonSpan*100}%`,width:`${Math.abs(r.rubPerKg.incrementalResult)/comparisonSpan*100}%`,background:r.rubPerKg.incrementalResult<0?'var(--risk)':undefined}}/></i><strong className={r.rubPerKg.incrementalResult<0?'file-bad':''}>{signed(r.rubPerKg.incrementalResult,1)}</strong></button>)}</section>
    <ul className="file-gaps" id="file-gaps">{missing&&<li><span className="chip chip-none">Нет</span><span>Цена и упаковка кожи бедра</span></li>}<li><span className="chip chip-warn">Требуется подтверждение</span><span>Труд, спрос, прочие затраты</span></li></ul>
   </aside>
  </main>
  {detail&&<Details title={{sources:'Периоды и источники расчета',yields:route.name,capacity:'Загрузка и мощность переделов',levers:'Каждый рычаг меняет свой показатель'}[detail]} onClose={()=>setDetail(null)}>
   {detail==='sources'&&<><table className="data-table file-sources" id="file-sources"><thead><tr><th>Источник</th><th>Период</th><th>Статус</th></tr></thead><tbody><tr><td>Выходы разделки и экономика, лист «Калькуляция»</td><td>Цены: март 2026</td><td><span className="chip chip-ok">Есть</span></td></tr><tr><td>Мощности переделов</td><td>{capacity.period.volumeLabel}</td><td><span className="chip chip-ok">Есть</span></td></tr><tr><td>Структура выхода</td><td>{capacity.period.yieldStructureLabel}</td><td><span className="chip chip-warn">Частично</span></td></tr>{economics.gaps.map((gap,i)=><tr key={i}><td>{gap}</td><td>Требуется подтверждение</td><td><span className="chip chip-none">Нет</span></td></tr>)}</tbody></table><p className="mini-note">{capacity.assumption}</p></>}
   {detail==='yields'&&<><p>База: {n(displayKg,1)} кг потрошеной тушки первого сорта / баланс {n(route.total_yield_fraction*100,3)}%</p><table><thead><tr><th>Продукт</th><th>Выход</th><th>Масса, кг</th></tr></thead><tbody>{outputs.map(x=><tr key={x.product_id}><td>{x.name}</td><td>{n(x.yield_fraction*100,3)}%</td><td>{n(x.yield_fraction*displayKg,2)}</td></tr>)}</tbody></table></>}
   {detail==='capacity'&&<><p>Нагрузка и мощность каждой операции сопоставлены в одной базе массы</p><StageRows rows={capacity.rows}/></>}
   {detail==='levers'&&<><h3>Цена и упаковка, руб. / кг</h3><div className="file-lever-list" id="file-levers">{economics.leverEffects.map(x=>{const v=x.incrementalPerKg,half=Math.abs(v)/leverMax*50;return <div className="file-lever-row" key={x.id}><span>{x.name}</span><div className="file-zero-track" aria-hidden="true"><i className={v<0?'neg':''} style={v<0?{right:'50%',width:`${half}%`}:{left:'50%',width:`${half}%`}}/><em/></div><b className={v<0?'file-bad':''}>{signed(v,3)}</b></div>;})}</div><div className="file-joint"><span className="chip chip-info">Совместный эффект мощности: {signed(deltaCapacity/1000,3)} т / сут</span><span className="mini-note">{capacity.moneyStatus}. Совместный эффект учитывает переход ограничения между участками</span></div></>}
  </Details>}
 </div>;
}
