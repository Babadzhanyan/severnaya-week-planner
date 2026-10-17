import React from 'react';
import './money-bridge.css';
import {usePlanner} from './state.jsx';
import {Hint,PlanStatus,PLAN_STATUS} from './ui.jsx';
import {n,money,delta,prodName,productRows,soldQty} from './format.js';
import {priceChartGeometry} from './historical-data.js';
// Цвета диаграмм: значения токенов документа. SVG-атрибуты не читают CSS-переменные, поэтому палитра задана здесь.
const C = {fg:'#1A1A1A', data:'#003C72', ok:'#2E8B57', risk:'#C0392B', steel:'#6E8CA8', muted:'#52677D', line:'#D9E2EA', mist:'#E6EEF5'};

export function Flow(){
 const {S,M,r}=usePlanner(),rows=productRows(r),dy=Math.min(46,254/Math.max(1,rows.length-1)),whole=r.whole??S.p.totalInput-S.p.cut;
 const largest=Math.max(...rows.map(x=>x.qty),1);
 return <div className="chart-area" id="flow"><div className="desktop-flow"><svg viewBox="0 0 950 370" role="img" aria-label={`Баланс массы: вход ${n(S.p.totalInput)} тонн, тушка ${n(whole)} тонн, разделка ${n(S.p.cut)} тонн, потери ${n(r.loss)} тонн`}>
 <text x="18" y="20" className="svg-muted">Вход после охлаждения</text><text x="240" y="20" className="svg-muted">Маршруты</text><text x="490" y="20" className="svg-muted">Совместный выход</text><text x="765" y="20" className="svg-muted">Продажи / остаток</text>
 <path d="M172 170C208 170 196 95 230 95M172 170C208 170 196 239 230 239" className="flow-link"/>
 <rect x="18" y="115" width="154" height="113" rx="5" fill={C.data}/><text x="36" y="146" fill="white" fontSize="15">Охлажденная тушка</text><text x="36" y="187" fill="white" fontSize="34" fontWeight="600">{n(S.p.totalInput)} т</text><text x="36" y="210" fill="white" fontSize="13">{n(S.p.rawCost)} руб. / кг</text>
 <rect x="230" y="57" width="186" height="78" fill={C.mist} rx="4"/><text x="248" y="83" fontSize="16">Целая тушка</text><text x="248" y="112" fontSize="26" fill={C.data}>{n(whole)} т</text>
 <rect x="230" y="191" width="186" height="104" fill={C.mist} rx="4"/><text x="248" y="218" fontSize="16">Вход разделки</text><text x="248" y="251" fontSize="26" fill={C.data}>{n(S.p.cut)} т</text><text x="248" y="275" fontSize="13">{M.routes[S.p.route]?.name}</text>
 {rows.map((row,i)=>{const y=58+i*dy,sourceY=row.id==='whole'?95:239,sold=soldQty(r,row.id,S),left=Math.max(0,row.qty-sold);return <g key={row.id}><path d={`M416 ${sourceY}C450 ${sourceY} 449 ${y+13} 480 ${y+13}`} className="flow-link thin"/><text x="490" y={y+3} fontSize="15">{prodName(row.id,M)}</text><rect x="490" y={y+12} width={210*row.qty/largest} height="7" fill={row.id==='whole'?C.steel:C.data}/><text x="721" y={y+8} textAnchor="end" fontSize="16" fontWeight="600">{n(row.qty)} т</text><text x="765" y={y+8} fontSize="16" fill={left>0?C.risk:C.fg}>{n(sold)} / {n(left)} т</text></g>;})}
 <text x="490" y="340" fontSize="14" fill={C.muted}>Технологические потери</text><text x="721" y="340" textAnchor="end" fontSize="16">{n(r.loss)} т</text><text x="18" y="359" fontSize="13" fill={C.muted}>Баланс: выпуск + потери = {n(S.p.totalInput)} т входа</text>
 </svg></div><div className="mobile-flow"><div className="mobile-flow-head"><span>Вход {n(S.p.totalInput)} т</span><span>Разделка {n(r.cut)} т</span></div>{rows.map(row=><div className="mobile-flow-row" key={row.id}><span>{prodName(row.id,M)}</span><span className="num">{n(row.qty)} т</span><span className="num">{n(soldQty(r,row.id,S))} т продано</span><span className="bar-track"><span style={{width:`${S.p.totalInput?row.qty/S.p.totalInput*100:0}%`}}/></span></div>)}<span className="source-note">Технологические потери {n(r.loss)} т</span></div></div>;
}
export function StageBars({compact=false}){const {r,act}=usePlanner();return <div className={`stage-list ${compact?'compact':''}`}>{(r.stages||[]).filter(s=>s.active!==false).map(s=><Hint key={s.id||s.name} as="button" className="stage-row" data-action="capacity" text={`${s.name}: ${n(s.load)} из ${n(s.capacity)} ${s.unit}. ${s.sourceStatus}`} onClick={()=>act('capacity')}><span className="stage-name">{s.name}</span><span className="stage-bar"><span className={`stage-fill ${s.load>s.capacity?'risk':''}`} style={{width:`${s.utilization===null?100:Math.min(100,s.utilization*100)}%`}}/></span><span className={`stage-value ${s.utilization>1?'negative':''}`}>{s.utilization===null?'0 т':n(s.utilization*100,0)+'%'}</span></Hint>)}</div>;}
export function HorizontalBars({items,max,unit}){return <><div className="desktop-chart"><svg viewBox="0 0 900 280" role="img" aria-label="Сопоставление объемов">{items.map((x,i)=>{const y=24+i*62;return <g key={x.name}><text x="5" y={y+20} fontSize="17">{x.name}</text><rect x="263" y={y} width={Math.max(0,x.value)/max*470} height="32" rx="2" fill={i===2?C.data:C.steel}/><text x="755" y={y+22} fontSize="21" fill={C.data}>{n(x.value)} {unit}</text></g>;})}</svg></div><div className="mobile-bars">{items.map((x,i)=><div className="mobile-bar-row" key={x.name}><div><span>{x.name}</span><strong>{n(x.value)} {unit}</strong></div><span className="bar-track"><span style={{width:`${Math.max(0,x.value)/max*100}%`,background:i===2?C.data:C.steel}}/></span></div>)}</div></>;}
export function Waterfall({items}){const W=900,H=330,step=W/items.length,barWidth=step*.68,mobileMax=Math.max(...items.map(x=>Math.abs(x.value)),1),max=Math.max(...items.filter(x=>x.total).map(x=>x.value),1)*1.12,min=Math.min(0,...items.filter(x=>x.total).map(x=>x.value)),Y=v=>H-55-(v-min)/(max-min)*(H-90);let running=0;return <><div className="desktop-chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Мост вклада по причинам изменения">{items.map((x,i)=>{const start=x.total?0:running,end=x.total?x.value:running+x.value;running=end;const bx=12+i*step,by=Y(Math.max(start,end)),bh=Math.abs(Y(start)-Y(end));return <g key={x.name}><rect x={bx} y={by} width={barWidth} height={bh} fill={x.total?C.data:x.value<0?C.risk:C.steel} rx="3"/><text x={bx} y={by-12} fill={x.value<0?C.risk:C.data} fontSize="23" fontWeight="600">{x.total?money(x.value):delta(x.value)}</text><text x={bx} y={H-23} fontSize="17">{x.name}</text>{i<items.length-1&&<path d={`M${bx+barWidth} ${Y(end)}H${bx+step}`} stroke={C.steel} strokeDasharray="4 4"/>}</g>;})}<text x="20" y="327" fill={C.muted} fontSize="13">руб. / изменение вклада всей корзины</text></svg></div><div className="mobile-bars">{items.map(x=><div className="mobile-bar-row" key={x.name}><div><span>{x.name}</span><strong className={x.value<0?'negative':''}>{x.total?money(x.value):delta(x.value)} руб.</strong></div><span className="bar-track"><span style={{width:`${Math.min(100,Math.abs(x.value)/mobileMax*100)}%`,background:x.value<0?C.risk:C.data}}/></span></div>)}</div></>;}

// Цвета токенов платформы для планных графиков: заказы, прогноз, текст, подписи, линии.
const PLAN_COLOR = {text:C.fg, data:C.data, steel:'#6E8CA8', sub:'#52677D', line:'#D9E2EA'};
const CLASS_NAME = {1:'Подтвержденный заказ', 2:'Прогноз', 3:'Дополнительный спрос'};
const RIGHT = {textAlign:'right'};
const SVG_FIT = {width:'100%', height:'auto', display:'block'};
const FRAME_FIT = {position:'absolute', inset:0, width:'100%', height:'100%', display:'block'};
const hatchId = id => 'hatch-' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
const kt = kg => n(kg / 1000, 1);
const Hatch = ({id}) => <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#FFFFFF"/><line x1="0" y1="0" x2="0" y2="6" stroke={PLAN_COLOR.sub} strokeWidth="2"/></pattern>;
const Swatch = ({fill}) => <svg width="12" height="12" aria-hidden="true" focusable="false"><rect width="12" height="12" fill={fill} stroke={PLAN_COLOR.sub} strokeWidth="0.75"/></svg>;
function PlanChartState({status, reason}) {
  return <><p className="plan-chart-status"><PlanStatus status={status}/></p>{reason && <p className="plan-chart-note">{reason}</p>}</>;
}
// Предупреждение масштаба выводится рядом с графиком: граница и стакан считаются при любом входе недели.
function ScaleNote({text}) {
  return text ? <p className="plan-scale-note"><PlanStatus status={PLAN_STATUS.warn}/> {text}</p> : null;
}

// Область графика измеряется по контейнеру: единица viewBox равна пикселю, подписи читаются при любой высоте экрана.
function useBox(active) {
  const ref = React.useRef(null);
  const [box, setBox] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight);
      if (w > 0 && h > 0) setBox(prev => (prev && prev.w === w && prev.h === h ? prev : {w, h}));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);
  return [ref, box];
}

// Стакан спроса: ширина ступени – объем, высота – цена. Распределенная часть заливается, остаток штрихуется.
// Заморозка – линия по f_j. Горизонтали: f_j и c_j. Вертикаль: выпуск Q_j. Compact убирает пояснения шапки, подписи 14 px.
export function StakanChart({stakan, productName, source, selector, compact = false, scaleWarning = null}) {
  const [showTable, setShowTable] = React.useState(false);
  const hid = hatchId(React.useId());
  const ready = Boolean(stakan && stakan.lines);
  const [boxRef, box] = useBox(ready);
  const head = <figcaption className="plan-chart-head"><h3>Стакан спроса: {productName}</h3>{selector}{!compact && <p className="plan-chart-note">Ширина ступени: объем, т. Высота: цена, руб. / кг. Линии: заморозка и себестоимость, руб. / кг</p>}{!compact && <p className="plan-chart-note">{source}</p>}</figcaption>;
  if (!ready) {
    const reason = stakan?.status?.reason;
    return <figure className="plan-chart plan-stakan">{head}<ScaleNote text={scaleWarning}/><PlanChartState status={stakan?.status} reason={reason}/></figure>;
  }
  const {supplyKg, frozen, lines, steps} = stakan;
  const fPrice = lines.freezePriceRubKg, cost = lines.costRubKg, frozenKg = frozen.volumeKg;
  const xMax = Math.max(1, supplyKg, ...steps.map(s => s.x1));
  const yMax = Math.max(1, fPrice, cost, ...steps.map(s => s.priceRubKg)) * 1.1;
  const W = box?.w ?? 600, H = box?.h ?? 300, L = 64, RM = 150, T = 28, B = 36;
  const PH = Math.max(90, H - T - B), PW = Math.max(160, W - L - RM);
  const X = kg => L + kg / xMax * PW, Y = v => T + PH - v / yMax * PH;
  const frozenFrom = supplyKg - frozenKg;
  const desc = `Стакан спроса, ${productName}: выпуск ${kt(supplyKg)} т, заморозка ${kt(frozenKg)} т по ${n(fPrice, 0)} руб. / кг, себестоимость ${n(cost, 0)} руб. / кг`;
  return <figure className="plan-chart plan-stakan">{head}<ScaleNote text={scaleWarning}/>
    <div className="plan-chart-frame" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} style={FRAME_FIT}><title>{desc}</title>
        <defs><Hatch id={hid}/></defs>
        <line x1={L} x2={L} y1={T} y2={T + PH} stroke={PLAN_COLOR.sub}/>
        <line x1={L} x2={L + PW} y1={T + PH} y2={T + PH} stroke={PLAN_COLOR.sub}/>
        <text x={L - 8} y={T - 10} textAnchor="end" fontSize="14" fill={PLAN_COLOR.sub}>руб. / кг</text>
        <text x={L - 8} y={Y(0) + 4} textAnchor="end" fontSize="14" fill={PLAN_COLOR.sub}>0</text>
        <text x={L - 8} y={Y(yMax / 1.1) + 4} textAnchor="end" fontSize="14" fill={PLAN_COLOR.sub}>{n(yMax / 1.1, 0)}</text>
        <text x={L + PW} y={H - 10} textAnchor="end" fontSize="14" fill={PLAN_COLOR.sub}>{kt(xMax)} т</text>
        {steps.map(s => {
          const mid = s.x0 + s.distributedKg, x0 = X(s.x0), xm = X(mid), x1 = X(s.x1), top = Y(s.priceRubKg), h = Y(0) - top;
          return <g key={`${s.id}-${s.cls}`}><title>{`${CLASS_NAME[s.cls]}, ${n(s.priceRubKg, 0)} руб. / кг: спрос ${kt(s.demandKg)} т, распределено ${kt(s.distributedKg)} т`}</title>
            {xm > x0 && <rect x={x0} y={top} width={xm - x0} height={h} fill={s.cls === 1 ? PLAN_COLOR.data : PLAN_COLOR.steel}/>}
            {x1 > xm && <rect x={xm} y={top} width={x1 - xm} height={h} fill={`url(#${hid})`} stroke={PLAN_COLOR.sub} strokeWidth="0.75"/>}
          </g>;
        })}
        {frozenKg > 0 && <line x1={X(frozenFrom)} x2={X(supplyKg)} y1={Y(fPrice)} y2={Y(fPrice)} stroke={PLAN_COLOR.text} strokeWidth="3"/>}
        <line x1={L} x2={L + PW} y1={Y(fPrice)} y2={Y(fPrice)} stroke={PLAN_COLOR.data} strokeDasharray="6 4"/>
        <text x={L + PW + 6} y={Y(fPrice) + 4} fontSize="14" fill={PLAN_COLOR.data}>Заморозка {n(fPrice, 0)}</text>
        <line x1={L} x2={L + PW} y1={Y(cost)} y2={Y(cost)} stroke={PLAN_COLOR.sub} strokeDasharray="2 3"/>
        <text x={L + PW + 6} y={Y(cost) + 4} fontSize="14" fill={PLAN_COLOR.sub}>Себестоимость {n(cost, 0)}</text>
        <line x1={X(supplyKg)} x2={X(supplyKg)} y1={T} y2={T + PH} stroke={PLAN_COLOR.text} strokeDasharray="4 3"/>
        <text x={X(supplyKg)} y={T - 10} textAnchor="middle" fontSize="14" fill={PLAN_COLOR.text}>Выпуск {kt(supplyKg)} т</text>
      </svg>
    </div>
    <div className="plan-chart-foot">
      <ul className="plan-chart-legend" aria-label="Обозначения">
        <li><Swatch fill={PLAN_COLOR.data}/> Подтвержденные заказы</li>
        <li><Swatch fill={PLAN_COLOR.steel}/> Прогноз и дополнительный спрос</li>
        <li><Swatch fill={`url(#${hid})`}/> Не распределено</li>
        <li>Жирная линия: заморозка по цене заморозки</li>
      </ul>
      <button type="button" className="text-button" aria-expanded={showTable} onClick={() => setShowTable(v => !v)}>{showTable ? 'Скрыть таблицу' : 'Показать таблицу'}</button>
    </div>
    {steps.length === 0 && <p className="plan-chart-note">Заказов нет: {kt(supplyKg)} т уйдут в заморозку по {n(fPrice, 0)} руб. / кг</p>}
    {showTable && <table className="plan-chart-table">
      <caption>Ступени стакана спроса: {productName}</caption>
      <thead><tr><th scope="col">Ступень</th><th scope="col">Класс</th><th scope="col" style={RIGHT}>Цена, руб. / кг</th><th scope="col" style={RIGHT}>Спрос, т</th><th scope="col" style={RIGHT}>Распределено, т</th><th scope="col" style={RIGHT}>Не распределено, т</th></tr></thead>
      <tbody>
        {steps.map((s, i) => <tr key={`${s.id}-${s.cls}`}><td>{i + 1}</td><td>{CLASS_NAME[s.cls]}</td><td style={RIGHT}>{n(s.priceRubKg, 0)}</td><td style={RIGHT}>{kt(s.demandKg)}</td><td style={RIGHT}>{kt(s.distributedKg)}</td><td style={RIGHT}>{kt(s.hatchedKg)}</td></tr>)}
        <tr><td>Заморозка</td><td>По цене заморозки</td><td style={RIGHT}>{n(fPrice, 0)}</td><td style={RIGHT}>–</td><td style={RIGHT}>–</td><td style={RIGHT}>{kt(frozenKg)}</td></tr>
      </tbody>
    </table>}
  </figure>;
}

// Фронтир плана: эффективные точки в осях R (заморозка) и K (контрибуция). Оптимум V* отмечен контуром и подписью.
export function FrontierChart({frontier, freezeStatus, source, scaleWarning = null}) {
  const [showTable, setShowTable] = React.useState(false);
  const head = <figcaption><h3>Фронтир плана</h3><p className="plan-chart-note">Ось X: заморозка R, т за неделю. Ось Y: контрибуция K, млн руб. Точки: объем разделки V, т</p><p className="plan-chart-note">{source}</p></figcaption>;
  const points = frontier?.efficient || [];
  if (!frontier || !points.length) {
    return <figure className="plan-chart plan-frontier">{head}<ScaleNote text={scaleWarning}/><PlanChartState status={frontier?.status} reason={frontier?.status?.reason}/></figure>;
  }
  const opt = frontier.optimum;
  const tt = p => p.R / 1000, km = p => p.K / 1e6;
  const xMax = Math.max(1, ...points.map(tt)) * 1.08;
  const kVals = points.map(km);
  const kMin = Math.min(0, ...kVals), kMax = Math.max(0, ...kVals), pad = (kMax - kMin) * .1 || 1, kLo = kMin - pad, kHi = kMax + pad;
  const W = 600, H = 300, ML = 64, MR = 24, MT = 28, PH = H - MT - 40, PW = W - ML - MR;
  const X = t => ML + t / xMax * PW, Y = k => MT + PH - (k - kLo) / (kHi - kLo) * PH;
  const path = points.map(p => `${X(tt(p))},${Y(km(p))}`).join(' ');
  const ox = opt ? X(tt(opt)) : 0, oy = opt ? Y(km(opt)) : 0, onLeft = ox > ML + PW * .6, lx = onLeft ? ox - 14 : ox + 14;
  const desc = opt ? `Фронтир плана: оптимум V* ${n(opt.V, 0)} т, контрибуция ${n(km(opt), 2)} млн руб., заморозка ${kt(opt.R)} т` : 'Фронтир плана';
  return <figure className="plan-chart plan-frontier">{head}
    <ScaleNote text={scaleWarning}/>
    <p className="plan-chart-status"><PlanStatus status={frontier.status}/></p>
    {frontier.status?.reason && <p className="plan-chart-note">{frontier.status.reason}</p>}
    {freezeStatus && <p className="plan-chart-status"><PlanStatus status={freezeStatus}>Доля заморозки в выпуске</PlanStatus></p>}
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} style={SVG_FIT}><title>{desc}</title>
      <line x1={ML} x2={ML} y1={MT} y2={MT + PH} stroke={PLAN_COLOR.sub}/>
      <line x1={ML} x2={ML + PW} y1={MT + PH} y2={MT + PH} stroke={PLAN_COLOR.sub}/>
      <line x1={ML} x2={ML + PW} y1={Y(0)} y2={Y(0)} stroke={PLAN_COLOR.sub} strokeDasharray="2 3"/>
      <text x={ML} y={MT - 10} fontSize="12" fill={PLAN_COLOR.sub}>K, млн руб.</text>
      <text x={ML - 8} y={Y(0) + 4} textAnchor="end" fontSize="12" fill={PLAN_COLOR.sub}>0</text>
      <text x={ML - 8} y={Y(kMax) + 4} textAnchor="end" fontSize="12" fill={PLAN_COLOR.sub}>{n(kMax, 2)}</text>
      <text x={ML} y={H - 10} fontSize="12" fill={PLAN_COLOR.sub}>R, т</text>
      <text x={ML + PW} y={H - 10} textAnchor="end" fontSize="12" fill={PLAN_COLOR.sub}>{n(xMax / 1.08, 1)}</text>
      <polyline points={path} fill="none" stroke={PLAN_COLOR.data} strokeWidth="2"/>
      {points.map(p => <circle key={p.V} cx={X(tt(p))} cy={Y(km(p))} r="3" fill={PLAN_COLOR.data}><title>{`V ${n(p.V, 0)} т: K ${n(km(p), 2)} млн руб., R ${kt(p.R)} т`}</title></circle>)}
      {opt && <g>
        <circle cx={ox} cy={oy} r="9" fill="none" stroke={PLAN_COLOR.data} strokeWidth="2"/>
        <text textAnchor={onLeft ? 'end' : 'start'} fontSize="13" fill={PLAN_COLOR.text}><tspan x={lx} y={oy - 14}>Оптимум V* {n(opt.V, 0)} т</tspan><tspan x={lx} dy="16">K {n(km(opt), 2)} млн руб.</tspan></text>
      </g>}
    </svg>
    {opt && <p className="plan-chart-note">Оптимум: V* {n(opt.V, 0)} т разделки, контрибуция {n(km(opt), 3)} млн руб., заморозка {kt(opt.R)} т</p>}
    <ul className="plan-chart-notes">
      {frontier.notes.map(t => <li key={t}>{t}</li>)}
      {frontier.gap && <li>{frontier.gap.label}</li>}
      {frontier.cap && <li>{frontier.cap.label}: {n(frontier.cap.V, 0)} т</li>}
      {frontier.unconfirmed.map(t => <li key={t}>{t}</li>)}
    </ul>
    <button type="button" className="text-button" aria-expanded={showTable} onClick={() => setShowTable(v => !v)}>{showTable ? 'Скрыть таблицу' : 'Показать таблицу'}</button>
    {showTable && <table className="plan-chart-table">
      <caption>Эффективные точки фронтира</caption>
      <thead><tr><th scope="col" style={RIGHT}>Объем разделки V, т</th><th scope="col" style={RIGHT}>Заморозка R, т</th><th scope="col" style={RIGHT}>Контрибуция K, млн руб.</th><th scope="col">Отметка</th></tr></thead>
      <tbody>{points.map(p => <tr key={p.V}><td style={RIGHT}>{n(p.V, 0)}</td><td style={RIGHT}>{kt(p.R)}</td><td style={RIGHT}>{n(km(p), 2)}</td><td>{opt && p.V === opt.V ? 'Оптимум V*' : ''}</td></tr>)}</tbody>
    </table>}
  </figure>;
}

const processingCost = r => ['routeCost', 'serviceCost', 'freezeCost'].reduce((sum, key) => sum + (r[key] || 0), 0);
export function MoneyBridge({result,compact=false,items,unit,divisor}) {
  const [active,setActive] = React.useState(null);
  const tooltipId = React.useId();
  React.useEffect(()=>{if(active===null)return;const close=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setActive(null);}};document.addEventListener('keydown',close,true);return()=>document.removeEventListener('keydown',close,true);},[active]);
  const custom = Array.isArray(items);
  const bars = custom ? items : [
    {name:'Выручка', value:result.revenue, total:true},
    {name:'Сырье', value:-result.rawCost},
    {name:'Обработка', value:-processingCost(result)},
    {name:'Вклад недели', value:result.contribution, total:true}
  ];
  const displayDivisor = divisor ?? (custom ? 1 : 1e6);
  const displayUnit = unit ?? (custom ? 'руб. / кг' : 'млн руб.');
  const valid = bars.length > 0 && bars.every(bar => Number.isFinite(bar.value)) && Number.isFinite(displayDivisor) && displayDivisor > 0;
  if (!valid) return <div className="money-bridge money-bridge-empty">Требуется расчет</div>;
  let running = 0;
  const segments = bars.map(bar => {
    const from = bar.total ? 0 : running, to = bar.total ? bar.value : running + bar.value;
    running = to;
    return {...bar, from, to};
  });
  const min = Math.min(0, ...segments.flatMap(bar => [bar.from, bar.to]));
  const max = Math.max(custom ? 0 : 1, ...segments.flatMap(bar => [bar.from, bar.to]));
  const W = custom ? 410 : compact ? 360 : 580;
  const H = custom ? 230 : compact ? 180 : 218;
  const bottom = custom ? 166 : compact ? 146 : 172;
  const chartHeight = custom ? 126 : compact ? 104 : 126;
  const y = value => bottom - (value - min) / (max - min || 1) * chartHeight;
  const label = (value,total) => {
    const magnitude=Math.abs(value)/displayDivisor;
    if(custom&&magnitude>0&&magnitude<.0001)return '≈0';
    const number=custom ? Number(magnitude.toPrecision(3)).toLocaleString('ru-RU',{maximumSignificantDigits:3}) : n(magnitude,3);
    return (value<0?'−':custom&&!total&&value>0?'+':'')+number;
  };
  const plainName = name => String(name).replace(/\n/g,' ');
  const fullLabel = bar => `${plainName(bar.name)}: ${n(bar.value / (custom ? displayDivisor : 1),custom ? 20 : 1)} ${custom ? displayUnit : 'руб.'}`;
  const nameLines = (bar,i) => {
    if (!custom) return [compact && i === bars.length-1 ? 'Вклад' : bar.name];
    const text = String(bar.name);
    if (text.includes('\n')) return text.split('\n');
    const words=text.split(' ');
    if (text.length<=11 || words.length===1) return [text];
    let split=1;
    for (let j=1;j<words.length;j++) if(Math.abs(words.slice(0,j).join(' ').length-words.slice(j).join(' ').length)<Math.abs(words.slice(0,split).join(' ').length-words.slice(split).join(' ').length)) split=j;
    return [words.slice(0,split).join(' '),words.slice(split).join(' ')];
  };
  const step = custom ? 80 : compact ? 90 : 144;
  const spacing = custom ? (W-10) / bars.length : step;
  const width = custom ? spacing*.73 : compact ? 68 : 104;
  const firstX = custom ? 5+(spacing-width)/2 : compact ? 8 : 14;
  const description = custom ? `Расчет результата по указанным статьям. ${bars.map(fullLabel).join('; ')}` : `Выручка ${n(result.revenue)} руб.; сырье ${n(result.rawCost)} руб.; обработка ${n(processingCost(result))} руб.; вклад недели ${n(result.contribution)} руб.`;
  const current = active === null ? null : segments[active];
  return <div className={`money-bridge ${compact && !custom ? 'compact-bridge' : ''} ${custom ? 'source-money-bridge' : ''}`} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setActive(null);}}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
    {custom && <text x="5" y="15" className="money-bridge-scale-unit">{displayUnit}</text>}
    <line x1="4" x2={W-4} y1={y(0)} y2={y(0)} stroke={C.line}/>
    {segments.map((bar, i) => {
      const x = firstX + i * spacing, top = y(Math.max(bar.from, bar.to));
      const last = i === segments.length-1;
      const color = bar.total ? (bar.value < 0 ? C.risk : custom && last ? C.ok : C.data) : custom ? (bar.value < 0 ? (/упаковк/i.test(bar.name) ? C.steel : C.steel) : C.steel) : i === 1 ? C.steel : C.steel;
      const title = fullLabel(bar);
      return <g key={`${bar.name}-${i}`} className={`money-bridge-step ${active===i?'is-active':''}`} tabIndex="0" role="img" aria-label={title} aria-describedby={active===i?tooltipId:undefined} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onMouseEnter={()=>setActive(i)} onKeyDown={event=>{if(event.key==='Escape')setActive(null);}}>
        <title>{title}</title>
        <rect x={x} y={top} width={width} height={Math.abs(y(bar.from) - y(bar.to))} fill={color}/>
        <text x={x + width / 2} y={Math.max(custom ? 31 : 18, top - (custom ? 9 : compact ? 10 : 24))} textAnchor="middle" className={`money-bridge-value ${bar.total && bar.value < 0 ? 'money-bridge-negative' : custom && last && bar.value>0 ? 'money-bridge-positive' : ''}`}>{label(bar.value,bar.total)}</text>
        {!compact && !custom && <text x={x + width / 2} y={Math.max(32, top - 9)} textAnchor="middle" className="money-bridge-unit">{displayUnit}</text>}
        <text x={x + width / 2} y={custom ? 194 : compact ? 174 : 204} textAnchor="middle" className="money-bridge-name">{custom ? nameLines(bar,i).map((line,j)=><tspan key={j} x={x+width/2} dy={j?18:0}>{line}</tspan>) : nameLines(bar,i)[0]}</text>
        {!last && <line x1={x + width} x2={x + spacing} y1={y(bar.to)} y2={y(bar.to)} stroke={C.steel} strokeWidth="1.2" strokeDasharray="3 3"/>}
      </g>;
    })}
  </svg>{current && <div id={tooltipId} role="tooltip" className="money-bridge-tooltip">{fullLabel(current)}</div>}</div>;
}

// ---- Исторические ступени, накопительный стакан и денежные мосты (Д08) ----
const isNum = value => typeof value === 'number' && Number.isFinite(value);
const lowerFirst = text => String(text ?? '').replace(/^./, first => first.toLowerCase());
const exactNumber = value => Number(value).toLocaleString('ru-RU', {maximumFractionDigits: 8}).replace(/^-/, '−');
const niceCeil = (value, step) => Math.max(step, Math.ceil(value / step) * step);
const rangeOf = step => `${n(step.fromRubKg, 0)}–${n(step.toRubKg, 0)}`;
const productPeriod = (productName, periodLabel) => `${productName}${productName ? ', ' : ''}${lowerFirst(periodLabel)}`;
const NoData = () => <span className="chart-nodata"><span aria-hidden="true">○</span> Нет данных</span>;

// Стакан цены и объема с накопительным стаканом себестоимости на одной шкале цены (эталон hero.svg, разделы 6 и 14 дизайн-системы).
// Ширина ступени равна объему, высота равна средневзвешенной цене. Ось цены 0–400 руб./кг: 0,4 px на 1 руб./кг. Ось объема: 404 px на весь объем.
// Ступень с наибольшим объемом окрашена цветом данных и несет долю объема. Остальные ступени получают выноски с ценой и объемом.
const STAKAN = Object.freeze({W: 718, H: 240, X0: 50, XW: 404, BASE: 204, PX_PER_RUB: 0.4, LABEL_X: 132, COST_LEFT: 502, COST_X: 516, COST_STEP: 52, COST_W: 28});
const STAKAN_COLOR = Object.freeze({data: '#003C72', steel: '#6E8CA8', muted: '#52677D', line: '#D9E2EA', text: '#1A1A1A', white: '#FFFFFF'});
// Вход ступеней: только при prefers-reduced-motion: no-preference, 360 мс, сдвиг 60 мс на ступень. Печать без анимации.
const STAKAN_MOTION = '@media (prefers-reduced-motion: no-preference) { .price-stakan .step { transform-box: fill-box; transform-origin: 50% 100%; animation: stakan-rise 360ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; } @keyframes stakan-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } } } @media print { .price-stakan .step { animation: none; } }';
const FIGURE_RESET = {margin: 0};

export function PriceStepChart({steps, cost = [], source = 'агрегаты продаж филе, апрель 2026'}) {
  const ready = Array.isArray(steps) && steps.length > 0 && steps.every(s => isNum(s.volumeKg) && s.volumeKg > 0 && isNum(s.weightedPriceRubKg) && isNum(s.cumFromKg) && isNum(s.cumToKg) && isNum(s.revenueRub) && isNum(s.shareOfVolumePct));
  const [figRef, box] = useBox(ready);
  if (!ready) return <figure className="price-step-chart" style={FIGURE_RESET}><p className="plan-chart-status"><NoData/></p></figure>;
  const {W, H, X0, XW, BASE, PX_PER_RUB, LABEL_X, COST_LEFT, COST_X, COST_STEP, COST_W} = STAKAN;
  // SVG масштабируется по ширине контейнера (масштаб = ширина / 718). Число 96% выводится кеглем 28 px на экране, поэтому размер делится на масштаб.
  const pctSize = box ? (28 * W) / box.w : 28;
  const {data, steel, muted, line, text, white} = STAKAN_COLOR;
  const totalKg = steps[steps.length - 1].cumToKg;
  const totalRevenue = steps.reduce((sum, s) => sum + s.revenueRub, 0);
  const avg = totalRevenue / totalKg;
  const mainIndex = steps.reduce((best, s, i) => (s.volumeKg > steps[best].volumeKg ? i : best), 0);
  const main = steps[mainIndex];
  const callouts = steps.map((s, i) => ({s, i})).filter(({i}) => i !== mainIndex);
  const ticks = [];
  for (let t = 0; t <= totalKg; t += 100000) ticks.push(t);
  const X = kg => X0 + kg * XW / totalKg;
  const Y = v => BASE - v * PX_PER_RUB;
  const mainX = X(main.cumFromKg) + 20.5;
  const showCost = cost.length > 1;
  const costTotal = showCost ? cost[cost.length - 1].toRubKg : 0;
  const desc = `Ступени цены и объема: ${n(totalKg)} кг, средняя цена ${n(avg, 2)} руб./кг` + (showCost ? `. Себестоимость филе ${n(costTotal, 2)} руб./кг` : '');
  return <figure className="price-step-chart" ref={figRef} style={FIGURE_RESET}>
    <style>{STAKAN_MOTION}</style>
    <svg className="price-stakan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} style={SVG_FIT} fontFamily="'Source Sans Pro', 'Source Sans 3', Arial, sans-serif">
      <title>{desc}</title>
      <path d={`M${X0} ${Y(400)} V${BASE}`} stroke={line} fill="none"/>
      <path d={`M${X0} ${BASE} H${X0 + XW}`} stroke={muted} fill="none"/>
      <text x={42} y={14} textAnchor="end" fontSize="12" fill={muted}>руб./кг</text>
      {[0, 100, 200, 300, 400].map(v => <g key={v}>
        <path d={`M46 ${Y(v)} H${X0}`} stroke={muted} fill="none"/>
        <text x={42} y={Y(v) + 4} textAnchor="end" fontSize="12" fill={muted}>{n(v, 0)}</text>
      </g>)}
      {ticks.map(t => <g key={t}>
        <path d={`M${X(t)} ${BASE} V208`} stroke={muted} fill="none"/>
        <text x={X(t)} y={220} textAnchor="middle" fontSize="12" fill={muted}>{n(t, 0)}</text>
      </g>)}
      <text x={X0} y={236} fontSize="12" fill={muted}>{`Объем, кг. Источник: ${source}`}</text>
      {steps.map((s, i) => {
        const x0 = X(s.cumFromKg), top = Y(s.weightedPriceRubKg);
        return <rect key={i} className="step" x={x0} y={top} width={X(s.cumToKg) - x0} height={BASE - top} fill={i === mainIndex ? data : steel} style={{animationDelay: `${i * 60}ms`}}>
          <title>{`${rangeOf(s)} руб./кг: средневзвешенная цена ${n(s.weightedPriceRubKg, 2)} руб./кг, объем ${n(s.volumeKg)} кг, строки ${s.rows}`}</title>
        </rect>;
      })}
      {callouts.map(({s, i}, k) => {
        const cx = (X(s.cumFromKg) + X(s.cumToKg)) / 2, top = Y(s.weightedPriceRubKg), labelY = 26 + 16 * k;
        return <g key={i}>
          <path d={`M${cx} ${top - 3} V${labelY - 4} H${LABEL_X - 4}`} stroke={muted} fill="none"/>
          <text x={LABEL_X} y={labelY} fontSize="12" fill={text}><tspan fontWeight="700">{`${n(s.weightedPriceRubKg, 2)} руб./кг`}</tspan>{`, ${n(s.volumeKg)} кг`}</text>
        </g>;
      })}
      <text x={X0 + XW} y={30} textAnchor="end" fontSize="14" fontWeight="700" fill={data}>{`Итог: ${n(totalKg)} кг`}</text>
      <text x={X0 + XW} y={48} textAnchor="end" fontSize="12" fill={data}>{`Средняя ${n(avg, 2)} руб./кг`}</text>
      <text x={mainX} y={132} style={{fontFamily:'var(--f-head)'}} fontSize={pctSize} fontWeight="700" fill={white}>{`${Math.round(main.shareOfVolumePct)}%`}</text>
      <text x={mainX} y={154} fontSize="14" fill={white}>{`${n(main.volumeKg)} кг по диапазону ${rangeOf(main)} руб./кг`}</text>
      <text x={mainX} y={172} fontSize="14" fill={white}>{`средняя ${n(main.weightedPriceRubKg, 2)} руб./кг`}</text>
      {showCost && <g>
        <text x={COST_LEFT} y={84} fontSize="14" fontWeight="600" fill={text}>{`${cost[0].label} дает ${Math.round(cost[0].deltaRubKg / costTotal * 100)}% себестоимости`}</text>
        <text x={COST_LEFT} y={102} fontSize="12" fill={muted}>{`Себестоимость филе ${n(costTotal, 2)} руб./кг`}</text>
        <path d={`M${COST_LEFT} ${BASE} H${W}`} stroke={muted} fill="none"/>
        {cost.map((s, i) => {
          const x = COST_X + i * COST_STEP, top = Y(Math.max(s.fromRubKg, s.toRubKg)), h = Y(Math.min(s.fromRubKg, s.toRubKg)) - top;
          const value = s.total ? n(s.toRubKg, 2) : i === 0 ? n(s.deltaRubKg, 2) : `+${n(s.deltaRubKg, 2)}`;
          const name = s.total ? 'Итог' : s.label;
          return <g key={s.id}>
            <rect x={x} y={top} width={COST_W} height={h} fill={s.total ? data : steel}>
              <title>{`${name}: ${exactNumber(s.deltaRubKg)} руб./кг`}</title>
            </rect>
            <text x={x + COST_W / 2} y={top - 8} textAnchor="middle" fontSize="14" fontWeight="600" fill={s.total ? data : text}>{value}</text>
            <text x={x + COST_W / 2} y={220} textAnchor="middle" fontSize="12" fill={muted}>{name}</text>
            {i < cost.length - 1 && <path d={`M${x + COST_W} ${Y(s.toRubKg)} H${x + COST_STEP}`} stroke={muted} fill="none" strokeDasharray="2 2"/>}
          </g>;
        })}
      </g>}
    </svg>
  </figure>;
}

// Накопительный стакан себестоимости: статьи идут подряд, итог начинается от нуля и равен сумме статей.
export function CostStackChart({productName = '', periodLabel = '', steps, excluded = [], check = null}) {
  const [showTable, setShowTable] = React.useState(false);
  const tableId = React.useId();
  const ready = Array.isArray(steps) && steps.length > 1 && steps.every(s => isNum(s.fromRubKg) && isNum(s.toRubKg));
  const [boxRef, box] = useBox(ready);
  const head = <figcaption className="chart-head"><h3>Производственная стоимость, руб. / кг выпуска</h3><p className="plan-chart-note">{productPeriod(productName, periodLabel)}</p><p className="plan-chart-note">Историческое распределение затрат по переделам</p></figcaption>;
  if (!ready) return <figure className="plan-chart cost-stack-chart">{head}<p className="plan-chart-status"><NoData/></p></figure>;
  const total = steps[steps.length - 1].toRubKg;
  const geo = priceChartGeometry(box?.w ?? 490, box?.h ?? 240);
  const {left: L, top: T, plotWidth: PW, plotHeight: PH, width: W, height: H, bottom: B} = geo;
  const yMax = niceCeil(total * 1.1, 20);
  const Y = v => T + PH - v / yMax * PH;
  const slot = PW / steps.length, barW = slot * 0.56;
  const xOf = i => L + i * slot + (slot - barW) / 2;
  const yTicks = [0, 1, 2, 3, 4].map(i => yMax * i / 4);
  const desc = `Производственная стоимость, ${productPeriod(productName, periodLabel)}: ${steps.slice(0, -1).map(s => `${s.label} ${n(s.deltaRubKg, 2)}`).join(', ')}, итог ${n(total, 2)} руб. / кг выпуска`;
  return <figure className="plan-chart cost-stack-chart">{head}
    <div className="chart-frame" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
        <title>{desc}</title>
        <line x1={L} x2={L} y1={T} y2={T + PH} stroke={C.muted}/>
        <line x1={L} x2={L + PW} y1={T + PH} y2={T + PH} stroke={C.muted}/>
        {yTicks.map(v => <text key={v} x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill={C.muted}>{n(v, 0)}</text>)}
        <text x={L - 8} y={T - 8} textAnchor="end" fontSize="12" fill={C.muted}>руб. / кг</text>
        {steps.map((s, i) => {
          const x = xOf(i), top = Y(Math.max(s.fromRubKg, s.toRubKg)), h = Y(Math.min(s.fromRubKg, s.toRubKg)) - top;
          const value = s.total ? n(s.toRubKg, 2) : `+${n(s.deltaRubKg, 2)}`;
          const names = s.total ? ['Итог', 'руб. / кг выпуска'] : [s.label];
          return <g key={s.id}>
            <title>{`${s.label}: ${exactNumber(s.deltaRubKg)} руб. / кг`}</title>
            <rect x={x} y={top} width={barW} height={h} fill={s.total ? C.data : C.steel}/>
            <text x={x + barW / 2} y={top - 6} textAnchor="middle" fontSize="13" fontWeight="600" fill={C.text}>{value}</text>
            {names.map((line, j) => <text key={j} x={x + barW / 2} y={H - B + 16 + j * 14} textAnchor="middle" fontSize="12" fill={C.text}>{line}</text>)}
            {i < steps.length - 1 && <line x1={x + barW} x2={xOf(i + 1)} y1={Y(s.toRubKg)} y2={Y(s.toRubKg)} stroke={C.steel} strokeDasharray="3 3"/>}
          </g>;
        })}
      </svg>
    </div>
    {excluded.length > 0 && <p className="plan-chart-note">{`Вне итога: ${excluded.join(', ')}. Статус: Требуется подтверждение`}</p>}
    {check && <p className="plan-chart-note" data-ok={check.ok ? 'true' : 'false'}>{check.ok ? 'Сумма статей совпадает с итогом калькуляции' : 'Требуется подтверждение: сумма статей расходится с итогом калькуляции'}</p>}
    <button type="button" className="text-button" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable(v => !v)}>{showTable ? 'Скрыть таблицу' : 'Показать таблицу'}</button>
    {showTable && <table className="chart-table" id={tableId}>
      <caption>{`Статьи себестоимости: ${productPeriod(productName, periodLabel)}`}</caption>
      <thead><tr><th scope="col">Статья</th><th scope="col" className="num">руб. / кг</th><th scope="col" className="num">Накопленная сумма, руб. / кг</th><th scope="col">Ячейка источника</th></tr></thead>
      <tbody>
        {steps.map(s => <tr key={s.id} className={s.total ? 'chart-total' : undefined}><th scope="row">{s.label}</th><td className="num">{exactNumber(s.deltaRubKg)}</td><td className="num">{exactNumber(s.toRubKg)}</td><td>{s.sourceRef ?? 'Нет данных'}</td></tr>)}
      </tbody>
    </table>}
  </figure>;
}

// Правый накопительный денежный мост: режим меняет вид, товар и период остаются прежними.
const BRIDGE_MODES = [{id: 'cost', label: 'Производственная стоимость'}, {id: 'scenario', label: 'Сценарный результат'}];
export function CumulativeBridge({productName = '', periodLabel = '', costSteps, excluded = [], check = null, scenario = null, initialMode = 'cost'}) {
  const [mode, setMode] = React.useState(initialMode);
  return <section className="cumulative-bridge" aria-label="Денежный мост выбранного режима">
    <div className="bridge-mode" role="group" aria-label="Режим моста">
      {BRIDGE_MODES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}
    </div>
    {mode === 'cost'
      ? <CostStackChart productName={productName} periodLabel={periodLabel} steps={costSteps} excluded={excluded} check={check}/>
      : <figure className="plan-chart scenario-bridge">
          <figcaption className="chart-head"><h3>Мост сценарного вклада</h3><p className="plan-chart-note">{productPeriod(productName, periodLabel)}</p></figcaption>
          {scenario ? <MoneyBridge result={scenario}/> : <p className="plan-chart-status"><NoData/></p>}
        </figure>}
  </section>;
}

// Разбор разницы двух вариантов: базовый итог, шаги фактора и взаимодействий, итог варианта. Сумма шагов проверяется.
export function DecompositionBridge({baseLabel = 'Вариант А', variantLabel = 'Вариант Б', decomposition, unit = 'млн руб.', divisor = 1e6}) {
  if (!decomposition || !Array.isArray(decomposition.steps)) {
    return <figure className="plan-chart decomposition-bridge"><figcaption className="chart-head"><h3>Разбор разницы вариантов</h3></figcaption><p className="plan-chart-status"><NoData/></p></figure>;
  }
  const items = [
    {name: baseLabel, value: decomposition.base, total: true},
    ...decomposition.steps.map(step => ({name: step.label, value: step.delta})),
    {name: variantLabel, value: decomposition.variant, total: true},
  ];
  const sum = decomposition.steps.reduce((acc, step) => acc + step.delta, 0);
  const ok = Math.abs(sum - decomposition.total) <= 1e-7 * Math.max(1, Math.abs(decomposition.total));
  return <figure className="plan-chart decomposition-bridge">
    <figcaption className="chart-head"><h3>{`Разбор разницы вариантов, ${unit}`}</h3></figcaption>
    <MoneyBridge items={items} unit={unit} divisor={divisor}/>
    <p className="decomposition-check" data-ok={ok ? 'true' : 'false'}>{ok ? `Сумма шагов равна разнице: ${n(decomposition.total / divisor, 3)} ${unit}` : 'Требуется подтверждение: сумма шагов расходится с разницей'}</p>
  </figure>;
}

// Загрузка ресурсов на одной шкале: линия 100% мощности, открытое значение получает подпись «Требуется значение».
export function ResourceScale({title = 'Загрузка ресурсов, % мощности', rows = []}) {
  const values = rows.map(row => row.utilization).filter(isNum);
  const max = Math.max(1, ...values) * 1.05;
  return <figure className="plan-chart resource-scale">
    <figcaption className="chart-head"><h3>{title}</h3></figcaption>
    <ol className="resource-scale-list" aria-label="Загрузка ресурсов">
      {rows.map(row => {
        const has = isNum(row.utilization);
        const over = has && row.utilization > 1;
        const before = isNum(row.beforeUtilization) ? row.beforeUtilization : null;
        return <li key={row.id} className={`resource-row ${has ? (over ? 'is-over' : 'is-ok') : 'is-open'}`}>
          <span className="resource-name">{row.name}</span>
          <span className="resource-track">
            {has && <span className="resource-fill" style={{width: `${row.utilization / max * 100}%`}}/>}
            {before !== null && <span className="resource-before" style={{left: `${before / max * 100}%`}} aria-hidden="true"/>}
            <span className="resource-limit" style={{left: `${1 / max * 100}%`}} aria-hidden="true"/>
          </span>
          <span className="resource-value">{has ? `${n(row.utilization * 100, 0)}%${over ? ', перегрузка' : ''}` : 'Требуется значение'}</span>
        </li>;
      })}
    </ol>
    <p className="plan-chart-note">Вертикальная линия отмечает 100% мощности</p>
  </figure>;
}

// Мост вклада в горизонтальном виде: база, шаги и вариант в одной шкале 0–90 млн руб. (раздел 6 дизайн-системы). Вариант равен базе плюс шаги.
export function TeamBridge({title, subtitle, base, steps = [], unit = 'млн руб.', scaleMax = 90}) {
  const variant = base + steps.reduce((sum, step) => sum + step.delta, 0);
  const rows = [{name: 'База', value: base, total: true}, ...steps.map(step => ({name: step.label, value: step.delta, total: false})), {name: 'Вариант', value: variant, total: true}];
  const sign = value => (value > 0 ? '+' : value < 0 ? '−' : '');
  return <figure className="plan-chart team-bridge" style={FIGURE_RESET}>
    <figcaption><h3>{title}</h3><p className="plan-chart-note">{subtitle}</p></figcaption>
    <ol className="team-bridge-rows" aria-label={`Мост вклада, ${unit}`}>
      {rows.map(row => <li key={row.name} className="team-bridge-row">
        <span className="team-bridge-line"><span className="team-bridge-name">{row.name}</span><span className="team-bridge-value">{`${row.total ? '' : sign(row.value)}${n(Math.abs(row.value), 1)}`}</span></span>
        <span className="team-bridge-track" aria-hidden="true"><span className={row.total ? 'is-total' : 'is-step'} style={{width: `${Math.min(100, Math.abs(row.value) / scaleMax * 100)}%`}}/></span>
      </li>)}
    </ol>
  </figure>;
}
