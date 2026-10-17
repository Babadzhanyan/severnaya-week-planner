import React from 'react';
import {usePlanner} from './state.jsx';
import {ActionButton,Field,RouteSelect,Hint,PlanStatus,PLAN_STATUS,TrainingMark,ChainIcon} from './ui.jsx';
import {api,DEMO_MODE} from './api.js';
import {n,weekSourceLabel} from './format.js';
import {MoneyBridge,FrontierChart} from './charts.jsx';
import {StakanChart} from './stakan/StakanChart.jsx';
import {FILLET_HISTORY_APRIL_2026,COST_FACTS_APRIL_2026,buildCostStack} from './historical-data.js';
import {CostDetails} from './CostDetails.jsx';
import {ScenariosScreen} from './ScenariosScreen.jsx';
import {loadWeek,addScenario} from './store/weekStore.js';
import {STATUS,LOAD_WARN,planFromRows,modelWeek,ratesFrom,variantSnapshot,scaleWarningText,canSaveVariant} from './model-bridge.js';
import './plan-waterfall.css';
import './plan-screen.css';
import './approval-confirm.css';

// Масштаб ниже предела (0,5 × масштаб недели) – предупреждение «Внимание», расчет недели не блокируется.
const SCALE_STATUS=PLAN_STATUS.warn;
const HISTORICAL_LABEL='Исторический пример апреля 2026';
// Исторический пример апреля 2026 (агрегаты отгрузок и калькуляция филе): только подпись примера, на расчет недели не влияет.
const FILLET_STAKAN_STEPS=FILLET_HISTORY_APRIL_2026.aggregates.map(item=>({from:item.fromRubKg,to:item.toRubKg,kg:item.volumeKg,avgPrice:item.revenueRub/item.volumeKg,rows:null}));
const TOP_BAND=FILLET_HISTORY_APRIL_2026.aggregates.find(item=>item.fromRubKg===275);
const TOP_SHARE_PCT=Math.round(TOP_BAND.volumeKg/FILLET_HISTORY_APRIL_2026.totals.volumeKg*100);
const FILLET_AVG_PRICE=FILLET_HISTORY_APRIL_2026.totals.revenueRub/FILLET_HISTORY_APRIL_2026.totals.volumeKg;
const FILLET_COST_STEPS=buildCostStack(COST_FACTS_APRIL_2026[0]);
const FILLET_COST_RUB_KG=FILLET_COST_STEPS[FILLET_COST_STEPS.length-1].toRubKg;
const FILLET_STAKAN_TOTALS={kg:FILLET_HISTORY_APRIL_2026.totals.volumeKg,revenue:FILLET_HISTORY_APRIL_2026.totals.revenueRub};
const FILLET_STAKAN_COST=FILLET_COST_STEPS.filter(step=>!step.total).map(step=>({id:step.id,label:step.label,value:step.deltaRubKg}));
// Продукт пути сырья и его узлы (раздел 7 дизайн-системы). Значения берутся из расчета недели.
const PATH_PRODUCT='fillet';
const PATH_NODE_ICONS=[['bird','Птица','bird'],['slaughter','Убой и охлаждение','slaughter'],['cutting','Тушка / разделка','cutting'],['packing','Упаковка','packing'],['cold','Холод','cold'],['shipping','Отгрузка','truck']];
// Участники утверждения: подтверждения выбираются в диалоге утверждения производства.
const APPROVALS=[['commercial','Коммерция','Спрос, цены и обязательства'],['production','Производство','Маршруты, время и мощности'],['finance','Финансы','Цена сырья и изменяемые затраты']];
// Модель расчета загружается по требованию, как в демонстрационном режиме (api.js).
let planModelPromise;
const loadPlanModel=()=>planModelPromise||(planModelPromise=import('../model.js').then(()=>window.PlannerModel));
function usePlanModel(){
  const [model,setModel]=React.useState(null),[failed,setFailed]=React.useState(false);
  React.useEffect(()=>{let alive=true;loadPlanModel().then(m=>{if(alive)setModel(m||null);},()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[]);
  return {model,failed};
}
// Ответ недели (/api/week): только агрегаты по контракту. Нет файла или ошибка загрузки – учебные ставки, реальные числа не выводятся.
let weekPromise;
const loadWeekContract=()=>weekPromise||(weekPromise=(DEMO_MODE?Promise.resolve({week:null,failed:false}):api('week').then(r=>({week:r?.week||null,failed:false}),()=>({week:null,failed:true}))));
export function useWeekContract(){
  const [contract,setContract]=React.useState(null);
  React.useEffect(()=>{let alive=true;loadWeekContract().then(c=>{if(alive)setContract(c);});return()=>{alive=false;};},[]);
  return contract;
}
// Строки заказов недели из локального хранилища: читаются при открытии и при изменении в другой вкладке.
export function useWeekStore(){
  const [store,setStore]=React.useState(()=>loadWeek());
  React.useEffect(()=>{const sync=()=>setStore(loadWeek());window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
  return [store,setStore];
}
// Вход недели из контракта подставляется один раз за загрузку страницы; дальше значение меняет пользователь.
let weekInputApplied=false;

// Пробелы контракта, без которых расчет недели не выполняется. Заказы берутся из хранилища недели, поэтому в контракте не проверяются.
// Каждая позиция: «Нет» – нет значения, «Частично» – заполнена часть.
export function weekGaps(week,M){
  const name=id=>M.products?.[id]?.name||id, route=id=>M.routes?.[id]?.name||id, gap=value=>!Number.isFinite(value);
  const routes=Object.entries(week.routes||{});
  const freeze=Object.entries(week.products||{}).filter(([,product])=>gap(product?.freezePriceRubKg)).map(([id])=>name(id));
  const costs=routes.filter(([,row])=>gap(row?.variableCostRubKg)).map(([id])=>route(id));
  const yields=routes.flatMap(([id,row])=>{const all=Object.entries(row?.yields||{}),missing=all.filter(([,share])=>gap(share));return missing.length?[{text:`Выходы частей, ${route(id)}: ${missing.map(([code])=>name(code)).join(', ')}`,state:missing.length<all.length?'partial':'none'}]:[];});
  return [
    ...(freeze.length?[{text:`Цены заморозки: ${freeze.join(', ')}`,state:'none'}]:[]),
    ...(costs.length?[{text:`Переменные затраты маршрутов: ${costs.join(', ')}`,state:'none'}]:[]),
    ...yields,
  ];
}

// Неделя и сценарий для шапки оболочки: поля выводятся в строке шапки, а не внутри экрана плана.
export function planHeadFields(contract,S,approved){
  const weekConfig=contract?.week?.source==='aggregates'?contract.week:null, trainingWeek=!!contract&&!weekConfig;
  return {
    weekName:trainingWeek?'Учебные данные':(weekConfig?.period?.label||'Требуется подтверждение'),
    scenarioName:approved?`${S.approvedLabel||'В'+S.revision} утверждена`:`В${S.revision}, черновик`,
  };
}

export function planWaterfallItems(result){
  return [
    {name:'Выручка',value:result.revenue,total:true},
    {name:'Сырье',value:-result.rawCost},
    {name:'Переделы',value:-result.routeCost},
    {name:'Коммерция',value:-result.serviceCost},
    {name:'Заморозка',value:-result.freezeCost},
    {name:'Вклад',value:result.contribution,total:true}
  ];
}

export function PlanWaterfall({result,onOpen}){
  return <figure className="plan-money plan-waterfall" id="money-bridge">
    <figcaption><h3><button type="button" className="plan-waterfall-open" aria-label="Открыть подробный расчет вклада недели" aria-haspopup="dialog" onClick={onOpen}><span>Вклад недели по статьям</span><span className="plan-waterfall-link">Открыть расчет ↗</span></button></h3></figcaption>
    <div className="plan-waterfall-chart" onClick={onOpen} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();onOpen?.();}}}><MoneyBridge items={planWaterfallItems(result)} unit="млн руб." divisor={1e6}/></div>
    {result.inventoryT>.001&&<p className="plan-stock-note">Остаток {n(result.inventoryT)} т / будущая продажа {n(result.inventoryValue/1e6,2)} млн руб. отдельно</p>}
  </figure>;
}

// Диалог утверждения производства: подтверждения участников, итоги версии и утверждение. Утверждение выполняется только кнопкой «Утвердить».
function ApprovalConfirm({contribution,volume,feasible,version,ready,hint,warning,busy,error,onCancel,onConfirm}){
  const {S,setConfirm}=usePlanner();
  const ref=React.useRef(null);
  React.useEffect(()=>{ref.current?.focus();},[]);
  const onKeyDown=event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onCancel();return;}
    if(event.key==='Tab'){
      const items=[...ref.current.querySelectorAll('button:not(:disabled)')],first=items[0],last=items.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  };
  return <div className="approval-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel();}}>
    <section ref={ref} className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <h2 id="approval-title">Утвердить версию недели?</h2>
      <p>Версия {version} зафиксируется; дальнейшие изменения пойдут в новую версию.</p>
      <div className="approval-confirm-list" id="confirmations" aria-label="Подтверждения участников">{APPROVALS.map(([id,name,description])=>{const on=!!S.confirms[id];return <Hint as="button" type="button" key={id} text={description} className={`approval-chip chip chip-${on?'ok':'none'}`} data-confirm={id} aria-pressed={on} onClick={()=>setConfirm(id,!on)}><span className="approval-chip-name">{name}</span><span>{on?'Подтверждено':'Ждем'}</span></Hint>;})}</div>
      <dl className="approval-totals">
        <div className="approval-tile"><dt>Вклад недели, млн руб.</dt><dd className="kpi-value">{n(contribution/1e6,3)}</dd></div>
        <div className="approval-tile"><dt>Объем выпуска, т</dt><dd className="kpi-value">{n(volume)}</dd></div>
        <div className="approval-tile"><dt>Выполнимость</dt><dd><span className={`chip chip-${feasible?'ok':'risk'}`}>{feasible?'План выполним':'Требуется изменить план'}</span></dd></div>
      </dl>
      {!ready&&hint&&<p className="mini-note">{hint}</p>}
      {warning&&<p className="mini-note">{`Внимание: ${warning}`}</p>}
      {error&&<p className="approval-error" role="alert">{error}</p>}
      <div className="approval-actions">
        <button type="button" className="secondary" onClick={onCancel}>Вернуться к варианту</button>
        <button type="button" className="primary" disabled={busy||!!error||!ready} onClick={onConfirm}>Утвердить</button>
      </div>
    </section>
  </div>;
}

// Четыре действия решения: у каждого свой результат и полномочие. Полномочие открывается подсказкой у результата (мышь, фокус, клавиатура),
// чтобы строка результата укладывалась в зону 44 px: кнопка и подсказка полномочия – один элемент. Гипотеза сохраняется без подтверждений участников;
// утверждение производства – отдельный этап в диалоге, который не задерживает сохранение гипотезы.
function DecisionBlock({approved,done,total,hint,hypothesis,hypothesisBusy,onSaveHypothesis,onCompare,onCommit,onApprove}){
  const hypothesisText=!hypothesis?'Еще не сохранена':hypothesis.mode==='server'?`Сохранена: ревизия ${hypothesis.revision}`:'Сохранена в браузере';
  return <section className="plan-decision" id="decision" aria-label="Решение по варианту">
    <div className="decision-action" data-decision="hypothesis">
      <Hint as="span" className="decision-result" text={`Полномочие: автор плана. ${hypothesisText}`}><button type="button" className="secondary" data-action="save-hypothesis" disabled={hypothesisBusy} onClick={onSaveHypothesis}>{hypothesisBusy?'Сохраняем':'Сохранить гипотезу'}</button></Hint>
    </div>
    <div className="decision-action" data-decision="compare">
      <Hint as="span" className="decision-result" text="Полномочие: автор плана"><button type="button" className="secondary" onClick={onCompare}>Сравнить варианты</button></Hint>
    </div>
    <div className="decision-action" data-decision="commit">
      <Hint as="span" className="decision-result" text="Полномочие: Коммерция"><button type="button" className="secondary" onClick={onCommit}>Оформить заказ</button></Hint>
    </div>
    <div className="decision-action" data-decision="approve">
      <Hint as="span" className="decision-result approval-progress" text={`Полномочие: Коммерция, Производство, Финансы. ${hint}. ${approved?'Версия утверждена':`${done} из ${total} подтверждений`}`}><button type="button" className="primary" data-action="approve-open" aria-haspopup="dialog" onClick={onApprove}>Утвердить производство</button></Hint>
    </div>
  </section>;
}

const fmtDiff=(value,digits)=>(value>0?'+':value<0?'−':'')+n(Math.abs(value),digits);
const fmtOrDash=(value,digits)=>value===null||value===undefined?'–':n(value,digits);

// Варианты недели: текущий расчет сохраняется в хранилище недели. Тот же состав и рычаги дают тот же хеш и дубль не создают.
function WeekVariants({plan,canSave,store,onChange,state,routeName}){
  const [note,setNote]=React.useState(''),[busy,setBusy]=React.useState(false),[pair,setPair]=React.useState(['','']);
  const scenarios=store.scenarios;
  const a=scenarios.find(item=>item.id===pair[0])??scenarios[0]??null;
  const b=scenarios.find(item=>item.id===pair[1])??scenarios[1]??null;
  async function save(){
    setBusy(true);
    try{
      const snapshot=await variantSnapshot({rows:store.rows,weekStart:store.weekStart,plan,state,routeName});
      const saved=addScenario(snapshot);
      if(!saved.ok){setNote(saved.errors.join('. '));return;}
      setNote(saved.created?`Вариант сохранен: ${saved.scenario.title}`:'Такой вариант уже сохранен: изменений нет');
      onChange(loadWeek());
    }catch{
      setNote('Вариант не сохранен: браузер не подготовил контрольную сумму состава');
    }finally{setBusy(false);}
  }
  const rowsOf=[
    ['Вклад недели, млн руб.',x=>x.contribution/1e6,2],
    ['Объем разделки, т',x=>x.cut,1],
    ['Выпуск, т',x=>x.produced,1],
    ['Загрузка, макс., %',x=>x.maxLoadPct,1],
  ];
  return <section className="plan-variants" id="week-variants" aria-label="Варианты недели">
    <div className="plan-section-title"><h2>{`Варианты недели: сохранено ${scenarios.length}`}</h2><button type="button" className="secondary plan-variant-save" disabled={!canSave||busy} onClick={save}>Сохранить вариант</button></div>
    {note&&<p className="plan-caption" role="status">{note}</p>}
    {scenarios.length<2
      ?<p className="plan-caption">Для сравнения сохраните два варианта: меняйте разделку и сохраняйте расчет</p>
      :<>
        <div className="plan-variant-pick">
          <label>Вариант А<select value={a?.id||''} onChange={event=>setPair([event.target.value,b?.id||''])}>{scenarios.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Вариант Б<select value={b?.id||''} onChange={event=>setPair([a?.id||'',event.target.value])}>{scenarios.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </div>
        <div className="basket-table-wrap"><table className="basket-table" id="variant-compare"><thead><tr><th>Показатель</th><th>Вариант А</th><th>Вариант Б</th><th>Разница Б к А</th></tr></thead><tbody>
          {rowsOf.map(([label,pick,digits])=>{const left=pick(a.result),right=pick(b.result);return <tr key={label}><td>{label}</td><td>{fmtOrDash(left,digits)}</td><td>{fmtOrDash(right,digits)}</td><td>{left===null||right===null?'–':fmtDiff(right-left,digits)}</td></tr>;})}
          <tr><td>Узкое место</td><td>{a.result.bottleneck}</td><td>{b.result.bottleneck}</td><td>–</td></tr>
        </tbody></table></div>
      </>}
  </section>;
}

// Узлы пути сырья: значения из расчета недели. Ставка без подтверждения финансов получает статус «Внимание».
function pathNodesOf(plan,rates){
  const split=plan?.valid?plan.split:null;
  const value={bird:split?.rawRubKg??null,cutting:split?.routeRubKg??null};
  const confirmed={bird:rates?.confirmed.raw===true,cutting:rates?.confirmed.routeCost===true};
  return PATH_NODE_ICONS.map(([id,name,icon])=>({id,name,icon,value:value[id]??null,status:value[id]==null?STATUS.none:confirmed[id]?STATUS.ok:STATUS.warn}));
}

export function PlanScreen(){
  const {S,act,changeField,setProduct,go,busy,error,hypothesisBusy,toast}=usePlanner();
  const p=S.p;
  const {model:pm,failed:modelFailed}=usePlanModel();
  const contract=useWeekContract(), contractReady=contract!==null, weekConfig=contract?.week?.source==='aggregates'?contract.week:null, sourceLabel=weekSourceLabel(weekConfig);
  const trainingWeek=contractReady&&!weekConfig, capacityFromFile=Number.isFinite(weekConfig?.capacityWeekT?.deboning);
  const [store,setStore]=useWeekStore();
  const rows=store.rows, noOrders=rows.length===0;
  const [costOpen,setCostOpen]=React.useState(false);
  const [confirmOpen,setConfirmOpen]=React.useState(false);
  const [detailsOpen,setDetailsOpen]=React.useState(false);
  // Подробности открываются под основной областью: при раскрытии страница прокручивается к блоку.
  React.useEffect(()=>{if(detailsOpen)document.getElementById('plan-details')?.scrollIntoView?.({block:'nearest'});},[detailsOpen]);
  React.useEffect(()=>{if(weekConfig&&!weekInputApplied&&Number.isFinite(weekConfig.scaleWeekKg)){weekInputApplied=true;changeField('p','totalInput',Math.round(weekConfig.scaleWeekKg/1000));}},[weekConfig]);
  const rates=React.useMemo(()=>pm?ratesFrom({p,week:weekConfig,M:pm}):null,[pm,p,weekConfig]);
  const routeCode=p.route, cutT=p.cut;
  const modelInput=React.useMemo(()=>pm&&rates?modelWeek({rows,M:pm,inputKg:rates.inputKg,routeCode,rates}):null,[pm,rates,rows,routeCode]);
  // Расчет недели: строки заказов из хранилища, выпуск и разделка по модели, вклад без учебных значений.
  const plan=React.useMemo(()=>pm&&rates&&!noOrders?planFromRows({rows,M:pm,routeCode,cutT,rates}):null,[pm,rates,rows,routeCode,cutT,noOrders]);
  const guard=React.useMemo(()=>pm&&modelInput?pm.scaleGuard(modelInput):null,[pm,modelInput]);
  // Вход ниже предела масштаба: предупреждение и текст, расчет недели и сохранение варианта остаются доступными.
  const scaleLow=guard?.blocked===true;
  const scaleText=scaleLow?scaleWarningText(guard.inputKg,pm.planConfig.scaleWeekKg):null;
  const frontier=React.useMemo(()=>pm&&contractReady&&modelInput&&!noOrders?pm.buildFrontier(modelInput,weekConfig):null,[pm,contractReady,modelInput,weekConfig,noOrders]);
  const freezeStatus=pm&&frontier?.optimum?.producedKg>0?pm.planStatus('freezeShare',frontier.optimum.R/frontier.optimum.producedKg):null;
  const limitT=pm?pm.planConfig.scaleWeekKg*pm.planConfig.scaleGuardShare/1000:null;
  const approvedNow=!!S.approved&&JSON.stringify(S.approved.params)===JSON.stringify(p);
  const waiting=APPROVALS.filter(([id])=>!S.confirms[id]).map(([,name])=>name.toLowerCase());
  const done=APPROVALS.length-waiting.length;
  // Условия утверждения: кнопка открывает диалог всегда; диалог называет, каких условий не хватает, и не отправляет запрос, пока они не выполнены.
  const approvalGaps=[
    !contractReady&&'данные недели не загружены',
    contractReady&&!pm&&'модель расчета не загружена',
    store.storageError&&'хранилище браузера недоступно',
    !store.storageError&&noOrders&&'заказы недели не загружены',
    plan&&!plan.valid&&'расчет недели не выполнен: исправьте ввод',
    plan?.valid&&!plan.feasible&&'план выходит за мощности',
  ].filter(Boolean);
  const ready=approvalGaps.length===0&&waiting.length===0;
  const decisionHint=[approvalGaps.length&&`Не хватает условий: ${approvalGaps.join(', ')}`,waiting.length&&`Ждем подтверждения: ${waiting.join(', ')}`].filter(Boolean).join('. ')||'Все условия и подтверждения получены';
  const headline=!contractReady?'Загружаем данные недели'
    :noOrders?'Нет данных: заказы недели не загружены'
    :plan?.valid?`Вклад недели ${n(plan.contribution/1e6,2)} млн руб. при разделке ${n(plan.cutT)} т`
    :'Расчет недели не выполнен';
  const constraintView=noOrders?{level:'none',sym:'○',word:'Нет данных',text:'заказы недели не загружены'}
    :!plan?.valid?{level:'none',sym:'○',word:'Нет данных',text:plan?.errors?.[0]||'расчет недели не выполнен'}
    :!plan.feasible?{level:'risk',sym:'■',word:'Риск',text:plan.violations[0]||'план выходит за мощности'}
    :scaleLow?{level:'warn',sym:'▲',word:'Внимание',text:scaleText}
    :plan.bottleneck&&plan.bottleneck.utilization>=LOAD_WARN?{level:'warn',sym:'▲',word:'Внимание',text:`${plan.bottleneck.name}: ${n(plan.bottleneck.utilization*100,0)}% мощности`}
    :{level:'ok',sym:'●',word:'В норме',text:'перегрузки по мощности нет'};
  // Одно следующее действие для верхней строки плана: порядок определяет, что блокирует работу сильнее.
  const next=!contractReady?{text:'Дождитесь загрузки данных недели',label:'Открыть данные недели',view:'files'}
    :noOrders?{text:'Загрузите или внесите заказы недели на экране ввода',label:'Открыть ввод заказов',view:'files'}
    :!plan?.valid?{text:'Исправьте ввод: расчет недели не выполнен',label:'Открыть данные недели',view:'files'}
    :!plan.feasible?{text:'Измените условия: план выходит за мощности',label:'Проверить мощности',action:'levers-resources'}
    :scaleLow?{text:'Проверьте вход недели: масштаб ниже ожидаемого',label:'Изменить условия',action:'levers'}
    :plan.inventoryT>.001?{text:'Уточните спрос: остаток требует покупателя',label:'Открыть спрос и цены',view:'demand'}
    :approvedNow?{text:'Версия утверждена: задания для производства',label:'Открыть задания',action:'tasks'}
    :{text:'План выполним: сохраните вариант или гипотезу',label:'Сохранить гипотезу',hypothesis:true};
  const fillet=plan?.valid?plan.products.find(item=>item.id===PATH_PRODUCT&&item.costRubKg!==null)??null:null;
  const markupRubKg=fillet?fillet.priceRubKg-fillet.costRubKg:null;
  const pathNodes=pathNodesOf(fillet?plan:null,rates), pathCount=pathNodes.filter(node=>node.value!==null).length;
  const wholeConfirmedT=plan?.valid?plan.products.find(item=>item.id==='whole')?.confirmedT??0:0;
  const massTotal=plan?.valid?plan.inputT||1:(p.totalInput||1);
  const training=trainingWeek?<TrainingMark/>:null;
  const routeName=pm?.routes?.[routeCode]?.name||routeCode;
  const canSave=canSaveVariant(rows.length,plan);
  return <section className="plan-screen">
    {/* Уведомление: полоска в строке заголовка, левее статуса пересчета; всплывающая строка на этом экране скрыта (plan-screen.css). */}
    <div className="plan-headline"><h1>{headline}</h1>{toast&&<p className="vs-notice plan-notice" role="status">{toast}</p>}</div>

    <section className="plan-track" aria-label="Путь сырья">
      <div className="plan-section-title"><h2>{fillet?`Себестоимость филе ${n(fillet.costRubKg,2)} руб./кг: данные есть у ${pathCount} из ${pathNodes.length} узлов`:'Себестоимость филе: в расчете недели филе не выпускается'}</h2>{training}<button type="button" className="text-button plan-track-open" aria-expanded={detailsOpen} aria-controls="plan-details" onClick={()=>setDetailsOpen(open=>!open)}>{detailsOpen?'Скрыть подробности':'Подробности'}</button></div>
      <ol className="plan-track-nodes">{pathNodes.map((node,i)=><li key={node.id} className={`plan-node${i===2?' is-selected':''}`}><ChainIcon name={node.icon}/><span className="plan-node-text"><span className="plan-node-name">{node.name}</span><b className="plan-node-value">{node.value===null?'Ожидается':<>{n(node.value,2)}<small> руб./кг</small></>}</b><PlanStatus status={node.status}/></span></li>)}</ol>
    </section>

    <div className="plan-main">
      <aside className="plan-inputs" aria-label="Условия недели">
        <div className="plan-section-title"><h2>{markupRubKg===null?'Наценка филе: нет данных':`Наценка филе ${n(markupRubKg,2)} руб./кг`}</h2></div>
        <dl className="plan-facts" id="week-inputs">
          <div><dt>Доступно тушки, т</dt><dd>{n(plan?.valid?plan.inputT:p.totalInput)}</dd></div>
          <div><dt>Цена сырья, руб. / кг</dt><dd className={rates?.confirmed.raw?undefined:'plan-missing'}>{rates?n(rates.rawCostRubKg,2):'Требуется подтверждение'}{rates&&!rates.confirmed.raw&&<small> Требуется подтверждение</small>}</dd></div>
          <div><dt>Заказано целиком, т</dt><dd>{n(wholeConfirmedT)}</dd></div>
          <div><dt>Можем разделать, т</dt><dd className={capacityFromFile?undefined:'plan-missing'}>{rates?n(rates.capacityCutT):'Требуется подтверждение'}{rates&&!capacityFromFile&&<small> Требуется подтверждение</small>}</dd></div>
        </dl>
        <div className="plan-actions"><ActionButton action="levers">Изменить условия</ActionButton><ActionButton action="routes">Состав схем</ActionButton></div>
        <div className="plan-choice" id="home-levers">
          <RouteSelect/>
          <Field label="Направить в разделку" path="cut" max={p.totalInput} unit="т"/>
        </div>
      </aside>

      <section className="plan-steps" aria-label="Стакан цены и себестоимости недели">
        <div className="plan-section-title"><h2>{markupRubKg===null?'Стакан цены и себестоимости недели':`Филе недели: цена ${n(fillet.priceRubKg,2)} руб./кг при себестоимости ${n(fillet.costRubKg,2)} руб./кг`}</h2></div>
        <p className="plan-caption">Цена – средняя по объему подтвержденных и прогнозных строк; себестоимость – на кг выпуска, весовой метод</p>
        {plan?.valid?<div className="basket-table-wrap"><table className="basket-table" id="week-stakan"><thead><tr><th>Продукт</th><th>Подтвержденные, т</th><th>Прогноз, т</th><th>Цена, руб./кг</th><th>Себестоимость, руб./кг</th></tr></thead><tbody>{plan.products.map(item=><tr key={item.id}><td>{item.name}</td><td>{n(item.confirmedT,2)}</td><td>{n(item.forecastT,2)}</td><td>{n(item.priceRubKg,2)}</td><td>{fmtOrDash(item.costRubKg,2)}</td></tr>)}</tbody></table></div>
          :<p className="plan-caption">Нет данных: стакан появится после расчета недели</p>}
      </section>

      {!pm||!contractReady?<p className="plan-blocked plan-caption">{modelFailed?'Нет данных: модель расчета не загружена':'Загрузка данных'}</p>
      :noOrders?<section className="plan-blocked" id="orders-wait" aria-labelledby="orders-wait-title">
        <div className="plan-section-title"><h2 id="orders-wait-title">Нет данных: заказы недели не загружены</h2></div>
        <div className="gap-grid"><div className="gap-item"><PlanStatus status={STATUS.none}/><span>Загрузите или внесите заказы недели на экране ввода</span></div></div>
        {store.storageError&&<p className="plan-caption">Хранилище браузера недоступно: сохраненные заказы не прочитаны</p>}
        <div className="plan-links"><ActionButton view="files">Открыть ввод заказов</ActionButton><ActionButton view="demand">Открыть спрос и цены</ActionButton></div>
      </section>
      :!plan?.valid?<aside className="plan-blocked" id="week-result" aria-labelledby="invalid-title">
        <div className="plan-section-title"><h2 id="invalid-title">Расчет недели не выполнен</h2></div>
        <p><PlanStatus status={STATUS.risk}/></p>
        {plan?.errors?.map(text=><p key={text} className="plan-caption">{text}</p>)}
      </aside>
      :<div className="plan-money-slot" id="week-money">{training}<p className="plan-caption">Сырье учтено один раз; затраты заморозки включены в вклад</p>{scaleLow&&<p className="plan-scale-note"><PlanStatus status={SCALE_STATUS}/> {scaleText}</p>}<PlanWaterfall result={plan} onOpen={()=>act('economics')}/></div>}
    </div>

    <details className="plan-disclosure plan-details" id="plan-details" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}>
        <summary>Подробности: выпуск по продуктам, загрузка, фронтир и варианты</summary>
        <div className="plan-details-body">
          <p className="plan-explain">{constraintView.text}</p>
          {plan?.valid&&<div className="plan-production">
            <div className="basket-table-wrap"><table className="basket-table"><thead><tr><th>Продукт</th><th>Выпуск, т</th><th>Подтвержденные, т</th><th>Прогноз, т</th><th>Продадим, т</th><th>Остаток, т</th><th>Дополнительно, т</th></tr></thead><tbody>{plan.products.map(({id,name,producedT,confirmedT,forecastT,soldT,remainingT,extraT,shortfallT})=><tr key={id}><td><button className="product-row-link" onClick={()=>{setProduct(id);go('demand','request');}} aria-label={`Открыть спрос: ${name}`}>{name}<span aria-hidden="true">↗</span></button></td><td>{n(producedT,2)}</td><td className={shortfallT>0?'negative':''}>{n(confirmedT,2)}</td><td>{n(forecastT,2)}</td><td>{n(soldT,2)}</td><td className={remainingT>0?'negative':''}>{n(remainingT,2)}</td><td>{n(extraT,2)}</td></tr>)}</tbody></table></div>
            <div className="mass-balance" id="mass-balance" role="img" aria-label={`Вход ${n(plan.inputT)} т: продукция ${n(plan.producedT)} т, потери ${n(plan.lossT)} т`}>
              <div className="mass-track"><span className="mass-product" style={{width:`${plan.producedT/massTotal*100}%`}}/><span className="mass-loss" style={{width:`${plan.lossT/massTotal*100}%`}}/></div>
              <div className="mass-legend"><span><i className="swatch product" aria-hidden="true"/>Продукция {n(plan.producedT)} т</span><span><i className="swatch loss" aria-hidden="true"/>Потери {n(plan.lossT)} т</span></div>
            </div>
            <div className="basket-table-wrap"><table className="basket-table" id="week-load"><thead><tr><th>Этап</th><th>Загрузка, т</th><th>Мощность, т</th><th>Загрузка, %</th><th>Статус</th></tr></thead><tbody>{plan.stages.map(stage=><tr key={stage.id}><td>{stage.name}</td><td>{n(stage.load,2)}</td><td>{n(stage.capacity,2)}</td><td>{fmtOrDash(stage.utilization===null?null:stage.utilization*100,0)}</td><td><PlanStatus status={stage.status}/></td></tr>)}</tbody></table></div>
            <div className="plan-links"><ActionButton view="files">Открыть путь сырья</ActionButton><button type="button" className="text-button" onClick={()=>setCostOpen(true)}>Показать себестоимость</button><ActionButton view="demand">Открыть клиентов</ActionButton></div>
          </div>}
          {plan?.valid&&plan.excluded.length>0&&<p className="plan-caption">{`Строки с товаром вне справочника модели не входят в расчет: ${plan.excluded.join(', ')}`}</p>}
          {plan?.valid&&plan.unconfirmed.length>0&&<ul className="plan-unconfirmed" aria-label="Требуется подтверждение">{plan.unconfirmed.map(text=><li key={text} className="plan-caption">{text}</li>)}</ul>}
          {pm&&contractReady&&frontier&&<p className="plan-caption">Требуется подтверждение: основание вклада. Вклад недели – вариант с текущей разделкой, остаток списан затратами заморозки. Фронтир плана – оптимум по объему разделки, остаток оценен по цене заморозки. Это разные вопросы: значения не сравниваются напрямую</p>}
          {pm&&contractReady&&frontier&&<div className="plan-frontier-wrap"><FrontierChart frontier={frontier} freezeStatus={freezeStatus} source={sourceLabel} scaleWarning={scaleLow?scaleText:null}/></div>}
          <WeekVariants plan={plan} canSave={canSave} store={store} onChange={setStore} state={S} routeName={routeName}/>
          <details className="plan-disclosure" id="alternatives"><summary>Сравнение вариантов</summary><ScenariosScreen weekContribution={plan?.valid?plan.contribution:null}/></details>
          <section className="plan-history" aria-label={HISTORICAL_LABEL}>
            <p className="plan-caption">{`${HISTORICAL_LABEL}: ${TOP_SHARE_PCT}% объема филе приходится на диапазон 275–300 руб./кг; средняя цена ${n(FILLET_AVG_PRICE,2)} руб./кг, себестоимость ${n(FILLET_COST_RUB_KG,2)} руб./кг`}</p>
            <StakanChart periodLabel={FILLET_HISTORY_APRIL_2026.periodLabel} steps={FILLET_STAKAN_STEPS} totals={FILLET_STAKAN_TOTALS} cost={FILLET_STAKAN_COST} tolerance={{revenue:12}} sourceNote="агрегаты продаж филе, апрель 2026" status="ready"/>
          </section>
          {pm&&weekConfig&&weekGaps(weekConfig,pm).length>0&&<div className="gap-grid" id="gap-grid">{weekGaps(weekConfig,pm).map(gap=><div className="gap-item" key={gap.text}><span className={`chip chip-${gap.state==='partial'?'warn':'none'}`}>{gap.state==='partial'?'Частично':'Нет'}</span><span>{gap.text}</span></div>)}</div>}
          {limitT!==null&&<p className="plan-caption">Предел масштаба {n(limitT,0)} т в неделю</p>}
          {trainingWeek&&<p className="plan-caption">Требуется подтверждение: файл недели не загружен, ставки учебные</p>}
        </div>
      </details>

    <section className="plan-result" aria-label="Результат и действия">
      <div className="plan-result-text">
        <p className="plan-constraint" title={constraintView.text}><span className={`plan-sym ${constraintView.level}`} aria-hidden="true">{constraintView.sym}</span> <strong>{constraintView.word}:</strong> {constraintView.text}</p>
        <section className="plan-next-line" aria-label="Что сделать дальше"><p className="plan-action-text"><strong>Что сделать дальше:</strong> <Hint as="span" className="plan-action-label" text={next.text}>{next.text}</Hint>{!next.hypothesis&&<ActionButton className="text-button next-action" action={next.action} view={next.view}>{next.label}</ActionButton>}</p></section>
      </div>
      <DecisionBlock approved={approvedNow} done={done} total={APPROVALS.length} hint={decisionHint} hypothesis={S.hypothesis} hypothesisBusy={hypothesisBusy} onSaveHypothesis={()=>act('save-hypothesis')} onCompare={()=>act('scenarios')} onCommit={()=>go('demand','request')} onApprove={()=>setConfirmOpen(true)}/>
    </section>

    <footer className="plan-foot">
      <ul className="plan-legend" aria-label="Обозначения статусов">
        <li><span className="plan-sym ok" aria-hidden="true">●</span>В норме</li>
        <li><span className="plan-sym warn" aria-hidden="true">▲</span>Внимание</li>
        <li><span className="plan-sym risk" aria-hidden="true">■</span>Риск</li>
        <li><span className="plan-sym none" aria-hidden="true">○</span>Нет данных</li>
      </ul>
      <p className="plan-source">{`Источник: заказы недели из хранилища браузера (${rows.length} строк), ставки: ${sourceLabel}. Неделя с ${store.weekStart}`}</p>
    </footer>
    {confirmOpen&&<ApprovalConfirm contribution={plan?.valid?plan.contribution:0} volume={plan?.valid?plan.producedT:0} feasible={plan?.valid===true&&plan.feasible} version={`В${S.revision}`} ready={ready} hint={decisionHint} warning={scaleLow?scaleText:null} busy={busy} error={error} onCancel={()=>setConfirmOpen(false)} onConfirm={()=>{setConfirmOpen(false);act('approve');}}/>}
    {costOpen&&<CostDetails onClose={()=>setCostOpen(false)}/>}
  </section>;
}
