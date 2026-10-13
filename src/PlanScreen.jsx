import React from 'react';
import {usePlanner} from './state.jsx';
import {ActionButton,Field,RouteSelect,Hint,Status} from './ui.jsx';
import {n,money,delta,prodName} from './format.js';
import {MoneyBridge} from './charts.jsx';
import './plan-screen.css';

export function PlanScreen(){
  const {S,M,r,a,base,changeField,chooseCandidate,setProduct,go,busy,error}=usePlanner();
  const p=S.p, rows=Object.entries(r.allocations).filter(([id,row])=>row.produced>0||row.orders>0);
  const produced=Object.values(r.produced).reduce((sum,value)=>sum+value,0);
  const stages=r.stages.filter(stage=>stage.active);
  const limited=stages.filter(stage=>stage.binding);
  const difference=r.contribution-base.contribution;
  const selectionReady=!busy&&!error;
  const explain=r.violations.length?r.violations[0]:r.inventoryT>.001?`${n(r.inventoryT)} т останутся на складе. Коммерция подтверждает покупателя и срок продажи`:limited.length?`${limited[0].name}: ${n(limited[0].load)} из ${n(limited[0].capacity)} т мощности заняты`:`Разделка: запас мощности ${n(Math.max(0,r.effectiveCapacity-r.cut))} т. Заказы требуют сохранить ${n(r.allocations.whole.orders)} т целой тушки`;
  return <section className="plan-screen">
    <header className="plan-title"><div><p className="eyebrow">План производства и продаж</p><h1>{n(p.totalInput)} т тушки: выбираем план производства и продаж</h1></div><ActionButton className="secondary" action="tour">Показать по шагам</ActionButton></header>
    <div className="plan-workbench">
      <aside className="plan-inputs">
        <div className="plan-section-title"><span>1</span><h2>Условия недели</h2></div>
        <dl className="input-facts" id="week-inputs">
          <div><dt>Доступно тушки</dt><dd>{n(p.totalInput)} <small>т</small></dd></div>
          <div><dt>Цена сырья</dt><dd>{n(p.rawCost)} <small>руб. / кг</small></dd></div>
          <div><dt>Заказано целиком</dt><dd>{n(r.allocations.whole.orders)} <small>т</small></dd></div>
          <div><dt>Можем разделать</dt><dd>{n(r.effectiveCapacity)} <small>т</small></dd></div>
        </dl>
        <p className="plan-caption">Учебные данные после охлаждения</p>
        <ActionButton action="levers">Изменить условия</ActionButton>
        <div className="plan-choice" id="home-levers">
          <RouteSelect/>
          <div className="cut-control"><Field label="Направить в разделку" path="cut" max={p.totalInput} unit="т"/><input type="range" aria-label="Объём разделки, т" min="0" max={p.totalInput} step="1" value={p.cut} disabled={p.route==='whole'} onChange={event=>changeField('p','cut',Number(event.target.value))}/><div className="range-ends"><span>0 т</span><span>{n(p.totalInput)} т</span></div></div>
          <ActionButton action="routes">Состав каждой схемы</ActionButton>
        </div>
        
      </aside>

      <div className="plan-production">
        <div className="plan-section-title"><span>2</span><h2>Выпуск и спрос, т</h2></div>
        <div id="flow" className="plan-split" aria-label={`Целая тушка ${n(r.whole)} т, разделка ${n(r.cut)} т`}>
          <div className="split-labels"><span>Выпускаем целиком <strong>{n(r.whole)} т</strong></span><span>Разделываем <strong>{n(r.cut)} т</strong></span></div>
          <div className="split-track"><span style={{width:`${p.totalInput?r.whole/p.totalInput*100:0}%`}}/><b style={{width:`${p.totalInput?r.cut/p.totalInput*100:0}%`}}/></div>
        </div>
        <div className="basket-table-wrap"><table className="basket-table"><thead><tr><th>Продукт</th><th>Выпуск</th><th>Заказы</th><th><Hint text="Ожидаемый спрос сверх подтверждённых заказов. Коммерция уточняет его до выпуска">Прогноз</Hint></th><th>Продадим</th><th>Остаток</th></tr></thead><tbody>{rows.map(([id,row])=><tr key={id}><td><button className="product-row-link" onClick={()=>{setProduct(id);go('demand');}} aria-label={`Открыть спрос: ${prodName(id,M)}`}>{prodName(id,M)}<span aria-hidden="true">↗</span></button></td><td>{n(row.produced,2)}</td><td className={row.shortfall>0?'negative':''}>{n(row.orders,2)}</td><td>{n(row.forecast,2)}</td><td>{n(row.sold,2)}</td><td className={row.remaining>0?'negative':''}>{n(row.remaining,2)}</td></tr>)}</tbody></table></div>
        <p className="mass-proof">{n(produced)} т продукции + {n(r.loss)} т потерь = {n(p.totalInput)} т сырья</p>
        <div className="quick-comparison" id="alternatives"><div className="section-inline"><h3>Сравните объём разделки</h3><ActionButton view="scenarios">Подробный расчёт</ActionButton></div><div className="quick-options">{a.candidates.map((candidate,index)=>{
          const selected=Math.abs(candidate.params.cut-p.cut)<.001&&candidate.params.route===p.route;
          const isBest=a.best?.id===candidate.id;
          const label=p.route==='whole'?'Вся партия целиком':index===0?'Больше тушки':index===1?(p.route==='fillet'?'Базовый план':'Разделка 40%'):'Больше разделки';
          return <button key={candidate.id} className={`quick-option ${selected?'selected':''}`} aria-pressed={selected} disabled={!selectionReady} data-candidate={index} onClick={()=>chooseCandidate(index)}><span className="option-name">{isBest&&a.candidates.length>1?'Лучший из трёх':label}</span><strong className={candidate.result.contribution<0?'negative':''}>{n(candidate.result.contribution/1e6,3)} млн руб.</strong><span>{n(candidate.result.whole)} т целиком / {n(candidate.params.cut)} т разделка</span><span className={candidate.result.feasible?'option-status':'negative'}>{candidate.result.feasible?'Выполним':candidate.result.violations[0]}</span></button>;
        })}</div></div>
        <div className="plan-capacity"><div className="compact-stages" id="bottlenecks">{stages.map(stage=><Hint key={stage.id} text={`${stage.name}: ${n(stage.load)} из ${n(stage.capacity)} т за неделю`} className="compact-stage"><span>{stage.name}</span><b className={stage.load>stage.capacity?'negative':''}>{stage.utilization===null?'Требуется ресурс':n(stage.utilization*100,1)+'%'}</b><div><i style={{width:`${Math.min(100,(stage.utilization??1)*100)}%`,background:stage.load>stage.capacity?'var(--bad)':undefined}}/></div></Hint>)}</div></div>
      </div>

      <aside className="plan-result" id="week-result">
        <div className="plan-section-title"><span>3</span><h2>Результат недели</h2></div>
        <div className="result-summary">
          <div className="result-total"><span>Вклад недели</span><strong className={r.contribution<0?'negative':''}>{n(r.contribution/1e6,3)} млн <small>руб.</small></strong><p>На постоянные расходы и прибыль</p></div>
          <div className="result-difference"><span>Изменение к базе</span><strong className={`${difference<0?'negative':''} ${a.comparable?'comparable':''}`}>{a.comparable?delta(difference)+' руб.':'База требует проверки'}</strong><Hint text={`База: ${n(base.cut)} т разделки на филе и ножки, ${n(base.whole)} т целой тушки, вклад ${money(base.contribution)} руб.`}><span>{n(base.cut)} т разделки / {money(base.contribution)} руб.</span></Hint></div>
        </div>
        <figure className="plan-money" id="money-bridge"><figcaption><h3>Выручка превращается во вклад</h3><span>млн руб.</span></figcaption><MoneyBridge result={r} compact/><div className="plan-money-detail"><Hint text="Обработка включает затраты переделов, сбыт и заморозку"><span>Переделы, сбыт и заморозка</span></Hint><ActionButton action="economics">Раскрыть расчёт</ActionButton></div>{r.inventoryT>.001&&<p className="plan-stock-note">Остаток {n(r.inventoryT)} т / будущая продажа {money(r.inventoryValue)} руб. отдельно</p>}</figure>
        <div className="plan-next-step"><div className="plan-status-row"><Status level={r.feasible?'ok':'bad'}>{r.feasible?'План выполним':'Требуется изменить план'}</Status><ActionButton action={r.inventoryT>0?'prices':'levers-resources'}>{r.inventoryT>0?'Уточнить спрос':'Проверить мощности'}</ActionButton></div><p>{explain}</p>{limited.length>0&&r.whole<=r.allocations.whole.orders+.001&&r.allocations.whole.orders>0&&<p className="plan-caption">Заказы требуют сохранить {n(r.allocations.whole.orders)} т целой тушки</p>}</div>
        <ActionButton className="primary" view="approval" disabled={!r.feasible||!selectionReady}>Передать на согласование</ActionButton>
      </aside>
    </div>
  </section>;
}
