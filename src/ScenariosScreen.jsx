import React, {useEffect, useId, useState} from 'react';
import {usePlanner} from './state.jsx';
import {n, money, delta} from './format.js';
import './scenarios-screen.css';

const EPS = 1e-6;
const costs = r => ['rawCost', 'routeCost', 'serviceCost', 'freezeCost'].reduce((sum, key) => sum + (r[key] || 0), 0);
function MoneyBridge({result, baseline}) {
  const bars = [{name:'База 40%',value:baseline.contribution,total:true},{name:'Продажи',value:result.revenue-baseline.revenue},{name:'Затраты',value:costs(baseline)-costs(result)},{name:'Выбранный план',value:result.contribution,total:true}];
  let running=0;
  const segments=bars.map(bar=>{const from=bar.total?0:running,to=bar.total?bar.value:running+bar.value;running=to;return{...bar,from,to};});
  const min=Math.min(0,...segments.flatMap(b=>[b.from,b.to])),max=Math.max(1,...segments.flatMap(b=>[b.from,b.to]));
  const y=v=>150-(v-min)/Math.max(max-min,1)*110;
  return <div className="ss-bridge"><svg viewBox="0 0 500 187" role="img" aria-label={`База ${n(baseline.contribution)} рублей; изменение продаж ${n(bars[1].value)}; влияние затрат ${n(bars[2].value)}; выбранный план ${n(result.contribution)} рублей`}>
    <line x1="8" x2="492" y1={y(0)} y2={y(0)} stroke="#d7dde3"/>
    {segments.map((bar,i)=>{const x=12+i*126,top=y(Math.max(bar.from,bar.to));return <g key={bar.name}><rect x={x} y={top} width="96" height={Math.abs(y(bar.from)-y(bar.to))} rx="2" fill={bar.total?'#003c72':bar.value<0?'#a7b5c2':'#5f85a7'}/><text x={x+48} y={Math.max(18,top-10)} textAnchor="middle" className="ss-bridge-value">{bar.total?money(bar.value):delta(bar.value)}</text><text x={x+48} y="175" textAnchor="middle" className="ss-bridge-name">{bar.name}</text>{i<3&&<path d={`M${x+96} ${y(bar.to)}H${x+126}`} stroke="#91a1b1" strokeDasharray="3 3"/>}</g>;})}
  </svg><p className="ss-bridge-unit">Рубли / разница продаж и всех переменных расходов к базе</p></div>;
}
function limitation(r,p){
  if(r.violations?.length)return r.violations.slice(0,2).join('. ');
  const active=(r.stages||[]).filter(s=>s.active!==false),binding=active.filter(s=>s.load>EPS&&s.load>=s.capacity-EPS);
  const wholeBinds=r.cut>EPS&&r.whole<=Math.max(p.minWhole||0,p.orders?.whole||0)+EPS;
  if(binding.length){const s=binding[0];return `${s.name}: ${n(s.load)} из ${n(s.capacity)} т / неделя`+(wholeBinds?`. Все ${n(r.whole)} т целой тушки закреплены под заказы`:`. Дополнительный поток требует увеличить ресурс этого передела`);}
  if(wholeBinds)return `${n(r.whole)} т целой тушки закреплены под заказы. Рост разделки требует дополнительного сырья или пересогласования заказов`;
  const cutting=active.find(stage=>stage.id==='cutting');
  if(cutting)return `До мощности разделки остаётся ${n(Math.max(0,cutting.capacity-cutting.load))} т. Целой тушкой ${n(r.whole)} т при заказах ${n(Math.max(p.minWhole||0,p.orders?.whole||0))} т`;
  const s=[...active].sort((x,y)=>(y.utilization||0)-(x.utilization||0))[0];
  return s?`${s.name}: ${n(s.load)} из ${n(s.capacity)} т / неделя. Свободный ресурс этого передела ${n(Math.max(0,s.capacity-s.load))} т`:'Выберите схему и объём для проверки переделов';
}
export function ScenariosScreen(){
  const {S,M,r,a,base,busy,error,selectRoute,changeField,chooseCandidate,act,go}=usePlanner();
  const routeId=useId(),cutId=useId(),[cutDraft,setCutDraft]=useState(String(S?.p.cut??0));
  useEffect(()=>setCutDraft(String(S?.p.cut??0)),[S?.p.cut]);
  if(!S||!r||!a||!base)return <div className="scenario-screen">Рассчитываем варианты недели</div>;
  const p=S.p,calculated=r.params||p,comparable=a.comparable&&base.valid!==false,change=r.contribution-base.contribution;
  const stages=(r.stages||[]).filter(s=>s.active!==false),candidates=a.candidates||[];
  const selected=c=>c.params.route===calculated.route&&Math.abs(c.params.cut-r.cut)<EPS;
  const commitCut=()=>{const value=Number(cutDraft.replace(',','.'));if(cutDraft.trim()===''||!Number.isFinite(value)){setCutDraft(String(p.cut));return;}const cut=Math.max(0,Math.min(p.totalInput,value));setCutDraft(String(cut));if(Math.abs(cut-p.cut)>EPS)changeField('p','cut',cut);};
  const name=c=>c.params.route==='whole'?'Вся партия целой тушкой':Math.abs(c.params.cut-p.totalInput*.3)<EPS?'Больше целой тушки':`Разделка ${n(c.params.cut/p.totalInput*100,0)}%`;
  return <section className="scenario-screen" aria-labelledby="ss-title">
    <header className="ss-heading"><div><h1 id="ss-title">Выберите план для {n(p.totalInput)} т сырья</h1></div><span className="ss-step-label">Планирование</span></header>
    <div className="ss-controls">
      <div className="ss-field ss-route"><label htmlFor={routeId}>Схема разделки</label><select id={routeId} data-param="route" value={p.route} onChange={e=>selectRoute(e.target.value)}>{Object.entries(M.routes).map(([id,route])=><option key={id} value={id}>{route.name}</option>)}</select></div>
      <div className="ss-field ss-cut"><label htmlFor={cutId}>Направить в разделку</label><div><input id={cutId} type="number" min="0" max={p.totalInput} step="0.1" data-param="cut" data-scope="p" value={cutDraft} disabled={p.route==='whole'} onChange={e=>setCutDraft(e.target.value)} onBlur={commitCut} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>т</span></div></div>
      <span className="ss-whole">Целой тушкой <strong>{n(p.totalInput-p.cut)} т</strong></span>
      <div className="ss-control-links"><button type="button" onClick={()=>act('routes')}>Состав схемы</button><button type="button" onClick={()=>act('levers-resources')}>Изменить мощности</button></div>
    </div>
    <div className="ss-results" data-updating={busy?'true':'false'}>
      <section className="ss-options" aria-labelledby="ss-options-title"><h2 id="ss-options-title">{candidates.length===1?'Схема задаёт один вариант':'Три варианта на одинаковых условиях'}</h2><div className="ss-candidates" id="alternatives">
        {candidates.map((c,i)=><button type="button" key={c.id} className={`ss-candidate ${selected(c)?'ss-selected':''}`} data-candidate={i} aria-pressed={selected(c)} disabled={busy||!!error} onClick={()=>{if(!busy&&!error)chooseCandidate(i);}}>
          <span className="ss-candidate-title">{name(c)}</span><span className="ss-candidate-mass"><span>Тушка <b>{n(c.result.whole)} т</b></span><span>Разделка <b>{n(c.result.cut)} т</b></span></span><strong className="ss-candidate-value">{money(c.result.contribution)} ₽</strong><span className="ss-candidate-delta">{comparable?`${delta(c.result.contribution-base.contribution)} ₽ к базе`:'База требует проверки'}</span><span className={`ss-candidate-state ${c.result.feasible?'':'ss-risk'}`}>{c.result.feasible?'Выполним':'Требует изменения'}</span><span className="ss-choice-label">{selected(c)?'Выбран':'Выбрать этот план'}</span>
        </button>)}
      </div><p className="ss-baseline">База: филе и ножки / {n(base.whole)} т тушки + {n(base.cut)} т разделки</p></section>
      <section className="ss-explanation" aria-labelledby="ss-money-title"><div className="ss-section-top"><h2 id="ss-money-title">Откуда берётся разница в деньгах</h2><strong className={change<0?'ss-risk':''}>{comparable?`${delta(change)} ₽`:'Проверить базу'}</strong></div><MoneyBridge result={r} baseline={base}/><p className="ss-money-note">Продажи текущей недели − сырьё − переделы − обслуживание − заморозка</p>{r.inventoryT>EPS&&<p className="ss-stock-note">Остаток {n(r.inventoryT)} т / будущая реализация {money(r.inventoryValue)} ₽ раскрывается отдельно</p>}</section>
    </div>
    <section className="ss-capacity" id="bottlenecks" aria-labelledby="ss-capacity-title"><div className="ss-section-top"><h2 id="ss-capacity-title">Переделы показывают предел выбранного плана</h2><button type="button" onClick={()=>act('capacity')}>Карта мощности</button></div><div className="ss-stage-list">
      {stages.map(s=><div className={`ss-stage ${s.load>s.capacity+EPS?'ss-stage-risk':''}`} key={s.id}><div className="ss-stage-heading"><strong>{s.name}</strong><b>{s.capacity>0?`${n(s.load/s.capacity*100,0)}%`:'Ресурс 0'}</b></div><p>{n(s.load)} из {n(s.capacity)} т / неделя</p><span className="ss-stage-track"><span style={{width:`${s.capacity>0?Math.min(100,Math.max(0,s.load/s.capacity*100)):s.load>0?100:0}%`}}/></span></div>)}
      <div className="ss-storage"><strong>Хранение</strong><p>{n(r.storage?.load||0)} из {n(r.storage?.capacity||0)} т запаса</p><span>Ёмкость единовременно</span></div>
    </div><p className={`ss-limit ${r.feasible?'':'ss-risk'}`}>{limitation(r,calculated)}</p></section>
    <footer className="ss-footer"><p>{busy?'Обновляем результат выбранных условий':r.feasible?`Выбрано: ${n(r.whole)} т тушки + ${n(r.cut)} т разделки`:'Выберите выполнимый вариант или измените условия'}<small>Учебная модель / нормы и мощности раскрыты в источниках</small></p><button type="button" className="ss-primary" disabled={busy||!!error||!r.feasible} onClick={()=>go('approval')}>Согласовать выбранный план</button></footer>
  </section>;
}
