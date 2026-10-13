import React from 'react';
import './money-bridge.css';
import {usePlanner} from './state.jsx';
import {Hint} from './ui.jsx';
import {n,money,delta,prodName,productRows,soldQty} from './format.js';

export function Flow(){
 const {S,M,r}=usePlanner(),rows=productRows(r),dy=Math.min(46,254/Math.max(1,rows.length-1)),whole=r.whole??S.p.totalInput-S.p.cut;
 const largest=Math.max(...rows.map(x=>x.qty),1);
 return <div className="chart-area" id="flow"><div className="desktop-flow"><svg viewBox="0 0 950 370" role="img" aria-label={`Баланс массы: вход ${n(S.p.totalInput)} тонн, тушка ${n(whole)} тонн, разделка ${n(S.p.cut)} тонн, потери ${n(r.loss)} тонн`}>
 <text x="18" y="20" className="svg-muted">Вход после охлаждения</text><text x="240" y="20" className="svg-muted">Маршруты</text><text x="490" y="20" className="svg-muted">Совместный выход</text><text x="765" y="20" className="svg-muted">Продажи / остаток</text>
 <path d="M172 170C208 170 196 95 230 95M172 170C208 170 196 239 230 239" className="flow-link"/>
 <rect x="18" y="115" width="154" height="113" rx="5" fill="#003c72"/><text x="36" y="146" fill="white" fontSize="15">Охлаждённая тушка</text><text x="36" y="187" fill="white" fontSize="34" fontWeight="600">{n(S.p.totalInput)} т</text><text x="36" y="210" fill="white" fontSize="13">{n(S.p.rawCost)} руб. / кг</text>
 <rect x="230" y="57" width="186" height="78" fill="#F1F3F5" rx="4"/><text x="248" y="83" fontSize="16">Целая тушка</text><text x="248" y="112" fontSize="26" fill="#003c72">{n(whole)} т</text>
 <rect x="230" y="191" width="186" height="104" fill="#F1F3F5" rx="4"/><text x="248" y="218" fontSize="16">Вход разделки</text><text x="248" y="251" fontSize="26" fill="#003c72">{n(S.p.cut)} т</text><text x="248" y="275" fontSize="13">{M.routes[S.p.route]?.name}</text>
 {rows.map((row,i)=>{const y=58+i*dy,sourceY=row.id==='whole'?95:239,sold=soldQty(r,row.id,S),left=Math.max(0,row.qty-sold);return <g key={row.id}><path d={`M416 ${sourceY}C450 ${sourceY} 449 ${y+13} 480 ${y+13}`} className="flow-link thin"/><text x="490" y={y+3} fontSize="15">{prodName(row.id,M)}</text><rect x="490" y={y+12} width={210*row.qty/largest} height="7" fill={row.id==='whole'?'#9FAAB5':'#003c72'}/><text x="721" y={y+8} textAnchor="end" fontSize="16" fontWeight="600">{n(row.qty)} т</text><text x="765" y={y+8} fontSize="16" fill={left>0?'#B03A2E':'#1A1A1A'}>{n(sold)} / {n(left)} т</text></g>;})}
 <text x="490" y="340" fontSize="14" fill="#666666">Технологические потери</text><text x="721" y="340" textAnchor="end" fontSize="16">{n(r.loss)} т</text><text x="18" y="359" fontSize="13" fill="#666666">Баланс: выпуск + потери = {n(S.p.totalInput)} т входа</text>
 </svg></div><div className="mobile-flow"><div className="mobile-flow-head"><span>Вход {n(S.p.totalInput)} т</span><span>Разделка {n(r.cut)} т</span></div>{rows.map(row=><div className="mobile-flow-row" key={row.id}><span>{prodName(row.id,M)}</span><span className="num">{n(row.qty)} т</span><span className="num">{n(soldQty(r,row.id,S))} т продано</span><span className="bar-track"><span style={{width:`${S.p.totalInput?row.qty/S.p.totalInput*100:0}%`}}/></span></div>)}<span className="source-note">Технологические потери {n(r.loss)} т</span></div></div>;
}
export function StageBars({compact=false}){const {r,act}=usePlanner();return <div className={`stage-list ${compact?'compact':''}`}>{(r.stages||[]).filter(s=>s.active!==false).map(s=><Hint key={s.id||s.name} as="button" className="stage-row" data-action="capacity" text={`${s.name}: ${n(s.load)} из ${n(s.capacity)} ${s.unit}. ${s.sourceStatus}`} onClick={()=>act('capacity')}><span className="stage-name">{s.name}</span><span className="stage-bar"><span className={`stage-fill ${s.load>s.capacity?'risk':''}`} style={{width:`${s.utilization===null?100:Math.min(100,s.utilization*100)}%`}}/></span><span className={`stage-value ${s.utilization>1?'negative':''}`}>{s.utilization===null?'0 т':n(s.utilization*100,0)+'%'}</span></Hint>)}</div>;}
export function HorizontalBars({items,max,unit}){return <><div className="desktop-chart"><svg viewBox="0 0 900 280" role="img" aria-label="Сопоставление объёмов">{items.map((x,i)=>{const y=24+i*62;return <g key={x.name}><text x="5" y={y+20} fontSize="17">{x.name}</text><rect x="263" y={y} width={Math.max(0,x.value)/max*470} height="32" rx="2" fill={i===2?'#003c72':'#A9B4BE'}/><text x="755" y={y+22} fontSize="21" fill="#003c72">{n(x.value)} {unit}</text></g>;})}</svg></div><div className="mobile-bars">{items.map((x,i)=><div className="mobile-bar-row" key={x.name}><div><span>{x.name}</span><strong>{n(x.value)} {unit}</strong></div><span className="bar-track"><span style={{width:`${Math.max(0,x.value)/max*100}%`,background:i===2?'#003c72':'#A9B4BE'}}/></span></div>)}</div></>;}
export function Waterfall({items}){const W=900,H=330,step=W/items.length,barWidth=step*.68,mobileMax=Math.max(...items.map(x=>Math.abs(x.value)),1),max=Math.max(...items.filter(x=>x.total).map(x=>x.value),1)*1.12,min=Math.min(0,...items.filter(x=>x.total).map(x=>x.value)),Y=v=>H-55-(v-min)/(max-min)*(H-90);let running=0;return <><div className="desktop-chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Мост вклада по причинам изменения">{items.map((x,i)=>{const start=x.total?0:running,end=x.total?x.value:running+x.value;running=end;const bx=12+i*step,by=Y(Math.max(start,end)),bh=Math.abs(Y(start)-Y(end));return <g key={x.name}><rect x={bx} y={by} width={barWidth} height={bh} fill={x.total?'#003c72':x.value<0?'#B03A2E':'#849BAD'} rx="3"/><text x={bx} y={by-12} fill={x.value<0?'#B03A2E':'#003c72'} fontSize="23" fontWeight="600">{x.total?money(x.value):delta(x.value)}</text><text x={bx} y={H-23} fontSize="17">{x.name}</text>{i<items.length-1&&<path d={`M${bx+barWidth} ${Y(end)}H${bx+step}`} stroke="#A9B4BE" strokeDasharray="4 4"/>}</g>;})}<text x="20" y="327" fill="#666666" fontSize="13">руб. / изменение вклада всей корзины</text></svg></div><div className="mobile-bars">{items.map(x=><div className="mobile-bar-row" key={x.name}><div><span>{x.name}</span><strong className={x.value<0?'negative':''}>{x.total?money(x.value):delta(x.value)} руб.</strong></div><span className="bar-track"><span style={{width:`${Math.min(100,Math.abs(x.value)/mobileMax*100)}%`,background:x.value<0?'#B03A2E':'#003c72'}}/></span></div>)}</div></>;}

const processingCost = r => ['routeCost', 'serviceCost', 'freezeCost'].reduce((sum, key) => sum + (r[key] || 0), 0);
export function MoneyBridge({result,compact=false,items,unit,divisor}) {
  const [active,setActive] = React.useState(null);
  const tooltipId = React.useId();
  const custom = Array.isArray(items);
  const bars = custom ? items : [
    {name:'Выручка', value:result.revenue, total:true},
    {name:'Сырьё', value:-result.rawCost},
    {name:'Обработка', value:-processingCost(result)},
    {name:'Вклад недели', value:result.contribution, total:true}
  ];
  const displayDivisor = divisor ?? (custom ? 1 : 1e6);
  const displayUnit = unit ?? (custom ? 'руб. / кг' : 'млн руб.');
  const valid = bars.length > 0 && bars.every(bar => Number.isFinite(bar.value)) && Number.isFinite(displayDivisor) && displayDivisor > 0;
  if (!valid) return <div className="money-bridge money-bridge-empty">Требуется расчёт</div>;
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
  const description = custom ? `Изменение результата после упаковки. ${bars.map(fullLabel).join('; ')}` : `Выручка ${n(result.revenue)} руб.; сырьё ${n(result.rawCost)} руб.; обработка ${n(processingCost(result))} руб.; вклад недели ${n(result.contribution)} руб.`;
  const current = active === null ? null : segments[active];
  return <div className={`money-bridge ${compact && !custom ? 'compact-bridge' : ''} ${custom ? 'source-money-bridge' : ''}`} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setActive(null);}}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
    {custom && <text x="5" y="15" className="money-bridge-scale-unit">{displayUnit}</text>}
    <line x1="4" x2={W-4} y1={y(0)} y2={y(0)} stroke="#becbd5"/>
    {segments.map((bar, i) => {
      const x = firstX + i * spacing, top = y(Math.max(bar.from, bar.to));
      const last = i === segments.length-1;
      const color = bar.total ? (bar.value < 0 ? '#a6372d' : custom && last ? '#28704f' : '#003c72') : custom ? (bar.value < 0 ? (/упаковк/i.test(bar.name) ? '#a9bac8' : '#b46961') : '#6f8da5') : i === 1 ? '#a9bac8' : '#6f8da5';
      const title = fullLabel(bar);
      return <g key={`${bar.name}-${i}`} className={`money-bridge-step ${active===i?'is-active':''}`} tabIndex="0" role="img" aria-label={title} aria-describedby={active===i?tooltipId:undefined} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} onMouseEnter={()=>setActive(i)} onKeyDown={event=>{if(event.key==='Escape')setActive(null);}}>
        <title>{title}</title>
        <rect x={x} y={top} width={width} height={Math.abs(y(bar.from) - y(bar.to))} fill={color}/>
        <text x={x + width / 2} y={Math.max(custom ? 31 : 18, top - (custom ? 9 : compact ? 10 : 24))} textAnchor="middle" className={`money-bridge-value ${bar.total && bar.value < 0 ? 'money-bridge-negative' : custom && last && bar.value>0 ? 'money-bridge-positive' : ''}`}>{label(bar.value,bar.total)}</text>
        {!compact && !custom && <text x={x + width / 2} y={Math.max(32, top - 9)} textAnchor="middle" className="money-bridge-unit">{displayUnit}</text>}
        <text x={x + width / 2} y={custom ? 194 : compact ? 174 : 204} textAnchor="middle" className="money-bridge-name">{custom ? nameLines(bar,i).map((line,j)=><tspan key={j} x={x+width/2} dy={j?18:0}>{line}</tspan>) : nameLines(bar,i)[0]}</text>
        {!last && <line x1={x + width} x2={x + spacing} y1={y(bar.to)} y2={y(bar.to)} stroke="#9baeba" strokeWidth="1.2" strokeDasharray="3 3"/>}
      </g>;
    })}
  </svg>{current && <div id={tooltipId} role="tooltip" className="money-bridge-tooltip">{fullLabel(current)}</div>}</div>;
}
