import React,{useEffect,useId,useMemo,useState} from 'react';
import {api} from './api.js';
import {n} from './format.js';
import {discountDecision,freezingDecision,stockScenarios} from './commercial-decisions.js';
import './commercial-decisions.css';

const value=raw=>raw===''?null:Number(raw);
const signed=number=>(number>0?'+':'')+n(number,1);
function Input({label,number,onChange,unit,max=1e6,step=.1}){
 const id=useId();return <label className="commercial-input" htmlFor={id}><span>{label}</span><div><input id={id} type="number" min="0" max={max} step={step} value={number} onChange={event=>onChange(event.target.value)} placeholder="Введите"/><small>{unit}</small></div></label>;
}

export function DiscountDecision(){
 const [terms,setTerms]=useState({volume:'10',additional:'2',price:'200',newPrice:'190',variableCost:'170'});
 const result=discountDecision(Object.fromEntries(Object.entries(terms).map(([key,raw])=>[key,value(raw)])));
 const rows=[['Объем, т','quantity',1],['Выручка, тыс. руб.','revenue',1000],['Изменяемые затраты, тыс. руб.','cost',1000],['Вклад, тыс. руб.','contribution',1000],['Изменение вклада, тыс. руб.','delta',1000]];
 return <section className="commercial-decision"><header><span>Самостоятельный учебный расчет</span><h3>Правило скидки меняет вклад заказа</h3></header><div className="commercial-discount-layout"><div className="commercial-inputs">{[['volume','Исходный объем','т',1000],['additional','Добавочный объем','т',1000],['price','Исходная цена','руб. / кг',1e6],['newPrice','Предлагаемая цена','руб. / кг',1e6],['variableCost','Изменяемые затраты','руб. / кг',1e6]].map(([key,label,unit,max])=><Input key={key} label={label} number={terms[key]} unit={unit} max={max} onChange={raw=>setTerms(previous=>({...previous,[key]:raw}))}/>)}</div><div className="commercial-discount-output">{result?<><div className="commercial-table-scroll"><table><thead><tr><th>Расчет</th><th>Исходный заказ</th><th>Цена на добавочный объем</th><th>Цена на весь объем</th></tr></thead><tbody>{rows.map(([label,key,scale])=><tr key={key} className={key==='contribution'||key==='delta'?'commercial-total':''}><th>{label}</th>{['base','incremental','all'].map(mode=><td key={mode} className={result[mode][key]<0?'commercial-negative':''}>{key==='delta'?signed(result[mode][key]/scale):n(result[mode][key]/scale,1)}</td>)}</tr>)}</tbody></table></div><p className="commercial-result">Разница правил: <strong>{signed(result.ruleDifferenceRub/1000)} тыс. руб.</strong></p></>:<p role="status" className="commercial-note">Заполните все условия: объемы от 0 до 1 000 т, цены и затраты от 0 до 1 000 000 руб. / кг</p>}<p className="commercial-note">Вклад = выручка − изменяемые затраты. Задавайте цены и затраты на единой налоговой основе, включая доставку и бонусы</p></div></div></section>;
}

function FreezingDecision(){
 const [terms,setTerms]=useState({priceNow:'175',futurePrice:'225',freezeCost:'15',probabilityPct:'85'});
 const result=freezingDecision(Object.fromEntries(Object.entries(terms).map(([key,raw])=>[key,value(raw)])));
 return <section className="commercial-freezing"><header><span>Уже выпущенный остаток / самостоятельный расчет</span><h3>Вероятность продажи определяет смысл заморозки</h3></header><div className="commercial-freezing-inputs">{[['priceNow','Продажа сейчас','руб. / кг',1e6],['futurePrice','Будущая цена','руб. / кг',1e6],['freezeCost','Заморозка и хранение','руб. / кг',1e6],['probabilityPct','Вероятность продажи','%',100]].map(([key,label,unit,max])=><Input key={key} label={label} number={terms[key]} unit={unit} max={max} onChange={raw=>setTerms(previous=>({...previous,[key]:raw}))}/>)}</div>{result?<><div className="commercial-probability-result"><div><span>Порог вероятности продажи</span><strong>{result.thresholdProbability===null?'Требуется положительная будущая цена':n(result.thresholdProbability*100,1)+'%'}</strong>{!result.attainable&&<small>Порог выходит за допустимые 0–100%</small>}</div><div><span>Ожидаемый результат после хранения</span><strong>{n(result.expectedNetRubKg,2)} <small>руб. / кг</small></strong></div><div><span>К продаже сейчас</span><strong className={result.deltaRubKg<0?'commercial-negative':''}>{signed(result.deltaRubKg)} <small>руб. / кг</small></strong></div></div><p className="commercial-note">Порог = (цена сейчас + заморозка и хранение) / будущая цена. Ожидаемая выручка = будущая цена × вероятность продажи</p></>:<p role="status" className="commercial-note">Заполните все условия, включая явные нули. Вероятность задается от 0 до 100%</p>}<p className="commercial-note">Стоимость выпуска уже понесена. Сценарий задает нулевую выручку при отсутствии будущей продажи; утилизация, сроки оплаты и стоимость денег требуют отдельных условий</p></section>;
}

export function StockDecision({params,routes}){
 const [demand,setDemand]=useState('10'),[calculation,setCalculation]=useState(null);
 const filletYield=routes?.[params?.route]?.yields?.fillet;
 const scenarios=useMemo(()=>stockScenarios(params,filletYield,value(demand)),[params,filletYield,demand]);
 const key=scenarios?JSON.stringify(scenarios):null;
 useEffect(()=>{
  if(!scenarios)return;
  const controller=new AbortController();setCalculation({key,status:'loading'});
  Promise.all([api('evaluate',{params:scenarios.early},{signal:controller.signal}),api('evaluate',{params:scenarios.late},{signal:controller.signal})]).then(([early,late])=>{
   if(controller.signal.aborted)return;
   if(![early.result,late.result].every(result=>result?.valid&&Number.isFinite(result.expectedContribution)))throw new Error('Условия сценария требуют проверки');
   setCalculation({key,status:'ready',early:early.result,late:late.result});
  }).catch(error=>{if(error.name!=='AbortError')setCalculation({key,status:'error',message:error.message});});
  return()=>controller.abort();
 },[key]);
 const state=calculation?.key===key?calculation:null,ready=state?.status==='ready',feasible=ready&&state.early.feasible&&state.late.feasible;
 return <div className="commercial-stock"><section className="commercial-decision"><header><span>Сравнение текущих учебных условий недели</span><h3>Решение до выпуска меняет излишек филе</h3></header><div className="commercial-stock-controls"><Input label="Спрос на филе после изменения" number={demand} onChange={setDemand} unit="т" max={1000}/><p className="commercial-note">Вход, цены, схема и мощности берутся из текущего сценария. Спрос и объем разделки меняются только в этом сравнении</p></div>{!scenarios?<p role="status" className="commercial-note">Сравнение требует схемы с выходом филе и спроса от 0 до 1 000 т</p>:state?.status==='error'?<p role="status" className="commercial-note">{state.message}</p>:!ready?<p role="status" className="commercial-note">Пересчитываем оба решения и ограничения</p>:<><div className="commercial-stock-options">{[['early','Решить до выпуска'],['late','Заморозить после выпуска']].map(([mode,label])=><section key={mode}><h4>{label}</h4><strong className="commercial-stock-money">{n(state[mode].expectedContribution/1e6,2)} <small>млн руб.</small></strong><p>Вклад после продажи всего остатка</p><dl><dt>В разделку / целиком</dt><dd>{n(state[mode].cut,2)} / {n(state[mode].whole,2)} т</dd><dt>Остаток филе</dt><dd>{n(state[mode].allocations.fillet.remaining,2)} т</dd><dt>Всего в холод</dt><dd>{n(state[mode].inventoryT,2)} т</dd></dl><p className={!state[mode].feasible?'commercial-negative':'commercial-note'}>{state[mode].feasible?'Заданные ограничения соблюдены':state[mode].violations.join('; ')}</p></section>)}</div><p className="commercial-result">{feasible?<>Разница раннего решения: <strong>{signed((state.early.expectedContribution-state.late.expectedContribution)/1000)} тыс. руб.</strong></>:<>Сравнение требует выполнимых условий обоих решений</>}</p><details className="commercial-method"><summary>Горизонт расчета</summary><p>Оба варианта включают текущие продажи и будущую продажу всего замороженного остатка по заданным ценам. Вероятность реализации в этом сравнении принята равной 100%</p><p>Вклад текущей недели: {n(state.early.contribution/1e6,2)} / {n(state.late.contribution/1e6,2)} млн руб. Оценка будущей выручки остатка: {n(state.early.inventoryValue/1e6,2)} / {n(state.late.inventoryValue/1e6,2)} млн руб.</p><p>Заморозка: {n(params.freezeCost,2)} руб. / кг. Хранение: {n(params.coldCapacity,2)} т. Самостоятельный расчет при заданных условиях</p></details></>}</section><FreezingDecision/></div>;
}
