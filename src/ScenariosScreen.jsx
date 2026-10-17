import React, {useEffect, useId, useMemo, useState} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {usePlanner} from './state.jsx';
import {n, money, delta} from './format.js';
import {MoneyBridge} from './charts.jsx';
import {deleteScenario, exportScenarioFile, loadWeek, renameScenario} from './store/weekStore.js';
import {compareVariants, dateText, divergence, importVariants, variantCode, variantFacts, variantSummary} from './scenarios-local.js';
import './scenarios-screen.css';
import './print.css';

const EPS = 1e-6;
function limitation(r,p){
  if(r.violations?.length)return r.violations.slice(0,2).join('. ');
  const active=(r.stages||[]).filter(s=>s.active!==false),binding=active.filter(s=>s.load>EPS&&s.load>=s.capacity-EPS);
  const wholeBinds=r.cut>EPS&&r.whole<=Math.max(p.minWhole||0,p.orders?.whole||0)+EPS;
  if(binding.length){const s=binding[0];return `${s.name}: ${n(s.load)} из ${n(s.capacity)} т / неделя`+(wholeBinds?`. Все ${n(r.whole)} т целой тушки закреплены под заказы`:`. Дополнительный поток требует увеличить ресурс этого передела`);}
  if(wholeBinds)return `${n(r.whole)} т целой тушки закреплены под заказы. Рост разделки требует дополнительного сырья или пересогласования заказов`;
  const cutting=active.find(stage=>stage.id==='cutting');
  if(cutting)return `До мощности разделки остается ${n(Math.max(0,cutting.capacity-cutting.load))} т. Целой тушкой ${n(r.whole)} т при заказах ${n(Math.max(p.minWhole||0,p.orders?.whole||0))} т`;
  const s=[...active].sort((x,y)=>(y.utilization||0)-(x.utilization||0))[0];
  return s?`${s.name}: ${n(s.load)} из ${n(s.capacity)} т / неделя. Свободный ресурс этого передела ${n(Math.max(0,s.capacity-s.load))} т`:'Выберите схему и объем для проверки переделов';
}
// Выбор схемы и объема из набора вариантов расчета: сравнение планов на одинаковых условиях.
function PlanChoice(){
  const {S,M,r,a,base,busy,error,selectRoute,changeField,chooseCandidate,act}=usePlanner();
  const routeId=useId(),cutId=useId(),[cutDraft,setCutDraft]=useState(String(S?.p.cut??0));
  useEffect(()=>setCutDraft(String(S?.p.cut??0)),[S?.p.cut]);
  if(!S||!r||!a||!base)return <div className="scenario-screen">Рассчитываем варианты недели</div>;
  const p=S.p,calculated=r.params||p,comparable=a.comparable&&base.valid!==false;
  const stages=(r.stages||[]).filter(s=>s.active!==false),candidates=a.candidates||[];
  const selected=c=>c.params.route===calculated.route&&Math.abs(c.params.cut-r.cut)<EPS;
  const commitCut=()=>{const value=Number(cutDraft.replace(',','.'));if(cutDraft.trim()===''||!Number.isFinite(value)){setCutDraft(String(p.cut));return;}const cut=Math.max(0,Math.min(p.totalInput,value));setCutDraft(String(cut));if(Math.abs(cut-p.cut)>EPS)changeField('p','cut',cut);};
  const name=c=>c.params.route==='whole'?'Вся партия целой тушкой':Math.abs(c.params.cut-p.totalInput*.3)<EPS?'Больше целой тушки':`Разделка ${n(c.params.cut/p.totalInput*100,0)}%`;
  return <section className="scenario-screen" aria-labelledby="ss-title">
    <div className="ss-main">
    <header className="ss-heading"><div><h2 id="ss-title">Выберите план для {n(p.totalInput)} т сырья</h2></div></header>
    <div className="ss-controls">
      <div className="ss-field ss-route"><label htmlFor={routeId}>Схема разделки</label><select id={routeId} data-param="route" value={p.route} onChange={e=>selectRoute(e.target.value)}>{Object.entries(M.routes).map(([id,route])=><option key={id} value={id}>{route.name}</option>)}</select></div>
      <div className="ss-field ss-cut"><label htmlFor={cutId}>Направить в разделку</label><div><input id={cutId} type="number" min="0" max={p.totalInput} step="0.1" data-param="cut" data-scope="p" value={cutDraft} disabled={p.route==='whole'} onChange={e=>setCutDraft(e.target.value)} onBlur={commitCut} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>т</span></div></div>
      <span className="ss-whole">Целой тушкой <strong>{n(p.totalInput-p.cut)} т</strong></span>
      <div className="ss-control-links"><button type="button" onClick={()=>act('routes')}>Показать состав схемы</button><button type="button" onClick={()=>act('levers-resources')}>Изменить мощности</button></div>
    </div>
      <section className="ss-options" aria-labelledby="ss-options-title" data-updating={busy?'true':'false'}>
        <h2 id="ss-options-title">{candidates.length === 1 ? 'Схема задает один вариант' : 'Сравните планы на одинаковых условиях'}</h2>
        <div className="ss-table-head" aria-hidden="true"><span>Тушка / разделка, т</span><span>Вклад недели / к базе</span><span>Ресурсы</span></div>
        <div className="ss-candidates" id="alternatives">
          {candidates.map((c, i) => <button type="button" key={c.id} className={`ss-candidate ${selected(c) ? 'ss-selected' : ''}`} data-candidate={i} aria-pressed={selected(c)} aria-label={`${name(c)}: ${n(c.result.whole)} т тушки, ${n(c.result.cut)} т разделки, вклад ${n(c.result.contribution)} руб.; ${c.result.feasible ? 'выполним' : 'требует изменения'}${selected(c) ? '; выбран' : '; выбрать этот план'}`} disabled={busy || !!error} onClick={() => {if (!busy && !error) chooseCandidate(i);}}>
            <span className="ss-candidate-plan"><i className="ss-selection" aria-hidden="true"/><span><strong>{n(c.result.whole)} / {n(c.result.cut)}</strong><small>{name(c)}</small></span></span>
            <span className="ss-candidate-money"><strong className={`ss-candidate-value ${c.result.contribution < 0 ? 'ss-risk' : ''}`}>{n(c.result.contribution / 1e6, 3)} млн руб.</strong><small className="ss-candidate-delta">{comparable ? `${delta(c.result.contribution - base.contribution)} руб.` : 'База требует проверки'}</small></span>
            <span className={`ss-candidate-state ${c.result.feasible ? '' : 'ss-risk'}`}>{c.result.feasible ? 'Выполним' : 'Требует изменения'}{selected(c) && <small className="ss-choice-label">Выбран</small>}</span>
          </button>)}
        </div>
        <p className="ss-baseline">База: филе и ножки / {n(base.whole)} т тушки + {n(base.cut)} т разделки</p>
      </section>
      <footer className="ss-footer"><p>{busy?'Обновляем результат выбранных условий':r.feasible?`Выбрано: ${n(r.whole)} т тушки + ${n(r.cut)} т разделки`:'Выберите выполнимый вариант или измените условия'}<small>Учебная модель / нормы и мощности раскрыты в источниках</small></p><button type="button" className="ss-primary" disabled={busy||!!error||!r.feasible} onClick={()=>document.getElementById('decision')?.scrollIntoView()}>Перейти к решению</button></footer>
    </div>
    <div className="ss-side" data-updating={busy?'true':'false'}>
      <section className="ss-explanation" aria-labelledby="ss-money-title">
        <div className="ss-section-top"><h2 id="ss-money-title">Выручка превращается во вклад недели</h2></div>
        <MoneyBridge result={r}/>
        <p className="ss-money-note">Обработка: переделы, обслуживание и заморозка</p>
        {r.inventoryT > EPS && <p className="ss-stock-note">Остаток {n(r.inventoryT)} т / будущая продажа {money(r.inventoryValue)} руб. отдельно</p>}
      </section>
    <section className="ss-capacity" id="bottlenecks" aria-labelledby="ss-capacity-title"><div className="ss-section-top"><h2 id="ss-capacity-title">Мощности выбранного плана</h2><button type="button" onClick={()=>act('capacity')}>Открыть карту мощности</button></div><div className="ss-stage-list">
      {stages.map(s=><div className={`ss-stage ${s.load>s.capacity+EPS?'ss-stage-risk':''}`} key={s.id}><div className="ss-stage-heading"><strong>{s.name}</strong><b>{s.capacity>0?`${n(s.load/s.capacity*100,1)}%`:'Ресурс 0'}</b></div><p>{n(s.load)} из {n(s.capacity)} т / неделя</p><span className="ss-stage-track"><span style={{width:`${s.capacity>0?Math.min(100,Math.max(0,s.load/s.capacity*100)):s.load>0?100:0}%`}}/></span></div>)}
      <div className="ss-storage"><strong title="Емкость единовременного запаса">Хранение</strong><p>{n(r.storage?.load||0)} из {n(r.storage?.capacity||0)} т запаса</p></div>
    </div><p className={`ss-limit ${r.feasible?'':'ss-risk'}`}>{limitation(r,calculated)}</p></section>
    </div>
  </section>;
}

// Числа для таблиц и текста: пустое значение выводится тире, знак разницы показывается явно.
const dash = (value, digits = 1) => (Number.isFinite(value) ? n(value, digits) : '–');
const signed = (value, digits = 1) => (Number.isFinite(value) && value > 0 ? '+' : '') + dash(value, digits);
const mln = value => (Number.isFinite(value) ? value / 1e6 : null);

function Notice({notice}){
  if(!notice)return null;
  const symbol=notice.level==='risk'?<><span className="vs-risk">■</span> Риск: </>:notice.level==='watch'?<><span className="vs-watch">▲</span> </>:<><span className="vs-ok">●</span> </>;
  return <p className={`vs-notice vs-notice-${notice.level}${notice.toast?' vs-notice-toast':''}`} role="status" title={notice.text}>{symbol}{notice.text}</p>;
}

// Документ варианта для печати: выводится только при печати (print.css), на экране не виден.
function VariantPrint({item,M}){
  const f=variantFacts(item,M),printed=dateText(new Date().toISOString());
  return <article className="print-root" aria-label="План недели Северная">
    <header className="print-head"><p className="print-eyebrow">Северная / планировщик недели</p><h1>План недели Северная</h1><p className="print-sub">{f.title}</p></header>
    <table className="print-table"><tbody>
      <tr><th>Товар</th><td>{f.product}</td></tr>
      <tr><th>Схема разделки</th><td>{f.route}</td></tr>
      <tr><th>Вход сырья, т</th><td className="num">{dash(f.volumeT)}</td></tr>
      <tr><th>Целой тушкой, т</th><td className="num">{dash(f.wholeT)}</td></tr>
      <tr><th>Разделка, т</th><td className="num">{dash(f.cutT)}</td></tr>
      <tr><th>Вклад недели, млн руб.</th><td className="num">{dash(mln(f.contributionRub),2)}</td></tr>
      <tr><th>Статус</th><td>{f.feasible?'В норме':'Риск: требует изменения'}</td></tr>
    </tbody></table>
    <section className="print-chart"><h2>Мост вклада недели</h2><MoneyBridge result={item.result}/></section>
    <p className="print-note">Источник: сохраненный вариант недели в локальном хранилище браузера, расчет планировщика</p>
    <footer className="print-foot"><span>Вариант {f.code}</span><span>Сохранен {dateText(f.savedAt)}</span><span>Напечатан {printed}</span></footer>
  </article>;
}

// Сохраненные варианты: список, открытие, переименование, удаление с подтверждением, сравнение двух, файл, сводка и печать.
// Все хранится в локальном хранилище браузера (weekStore); сервер сценариев не вызывается.
function SavedVariants({weekContribution}){
  const {S,M,r,busy,error,act,openVariant,hypothesisBusy,toast}=usePlanner();
  const [version,setVersion]=useState(0),[selectedId,setSelectedId]=useState(null),[compareIds,setCompareIds]=useState([]);
  const [mode,setMode]=useState(null),[draftTitle,setDraftTitle]=useState(''),[notice,setNotice]=useState(null),[summary,setSummary]=useState(null),[printItem,setPrintItem]=useState(null);
  const savedKey=S?.hypothesis?.savedAt??'';
  const week=useMemo(()=>loadWeek(),[version,savedKey]);
  // Полоска уведомления снимается через 4,2 с: после действия она не остается на экране.
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),4200);return()=>clearTimeout(timer);},[notice]);
  if(!M)return null;
  const items=week.scenarios.slice().sort((x,y)=>Date.parse(y.createdAt)-Date.parse(x.createdAt));
  const refresh=()=>setVersion(v=>v+1);
  const selected=items.find(item=>item.id===selectedId)||null;
  const opened=items.find(item=>item.id===S?.opened?.id)||null;
  // Вариант недели сверяется с расчетом недели на экране плана (тот же состав строк); вариант сценария – с пересчетом сервера.
  const weekVariant=opened?.inputs?.source==='week';
  const live=weekVariant?(weekContribution==null?null:{contribution:weekContribution}):(!busy&&!error&&r?r:null);
  const drift=live&&opened?divergence(opened,live):null;
  // Статус открытого варианта живет в полоске уведомления: сверка пересчета с сохраненным вкладом не занимает отдельную строку.
  const openedNotice=opened?(!weekVariant&&busy?{level:'watch',text:'Внимание: пересчет идет, показаны последние значения'}:!live?{level:'watch',text:'Внимание: сверка вклада недоступна: расчет не выполнен'}:drift?{level:'watch',text:`Внимание: вклад сейчас ${dash(mln(drift.liveRub),2)} млн руб., в варианте «${opened.title}» сохранено ${dash(mln(drift.savedRub),2)} млн руб.`}:{level:'ok',text:`В норме: вклад совпадает с вариантом ${variantCode(opened.contentHash)}`}):null;
  const pair=compareIds.map(id=>items.find(item=>item.id===id)).filter(Boolean);
  const canSave=!!S&&!busy&&!error&&!!r&&!hypothesisBusy;
  // Сообщение общего состояния (сохранение, открытие) выводится полоской здесь, а не всплывающей строкой внизу: она не перекрывает выбор схемы.
  const toastNotice=toast?{level:/^(Вариант (сохранен|открыт)|Такой вариант)/.test(toast)?'ok':'risk',text:toast,toast:true}:null;
  const pick=id=>{setSelectedId(id);setMode(null);setSummary(null);};
  const toggleCompare=id=>setCompareIds(list=>list.includes(id)?list.filter(x=>x!==id):[...list.slice(-1),id]);
  const note=(level,text)=>setNotice({level,text});

  function saveRename(event){
    event.preventDefault();
    const res=renameScenario(selected.id,draftTitle);
    if(!res.ok){note('risk',res.errors[0]);return;}
    setMode(null);refresh();note('ok','Название сохранено');
  }
  function removeSelected(){
    const res=deleteScenario(selected.id,{confirmed:true});
    if(!res.ok){note('risk',res.errors[0]);return;}
    setCompareIds(list=>list.filter(x=>x!==selected.id));setSelectedId(null);setMode(null);refresh();note('ok','Вариант удален');
  }
  async function shareFile(){
    const res=await exportScenarioFile(selected);
    if(res.ok)note('ok',`Файл варианта скачан: вариант-${variantCode(selected.contentHash)}.json`);
    else note('risk',res.errors[0]);
  }
  async function copySummary(){
    const text=variantSummary(selected,M);
    setSummary({id:selected.id,text});
    try{await navigator.clipboard.writeText(text);note('ok','Сводка скопирована: в тексте нет клиентов, ФИО и контактов');}
    catch{note('risk','Буфер обмена недоступен: выделите текст сводки вручную');}
  }
  // Печать: документ варианта монтируется в body, заголовок документа задается на время печати.
  function printVariant(item){
    const title=document.title;
    flushSync(()=>setPrintItem(item));
    document.title='План недели Северная';
    const done=()=>{document.title=title;setPrintItem(null);window.removeEventListener('afterprint',done);};
    window.addEventListener('afterprint',done);
    window.print();
  }
  async function onImport(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    const res=await importVariants(file);
    if(!res.ok){note('risk',res.errors.join('; '));return;}
    refresh();
    const skipped=res.rowsSkipped?` Строки заказов в файле (${res.rowsSkipped}) этот экран не применяет.`:'';
    note('ok',`Добавлено вариантов: ${res.added}, уже были в браузере: ${res.known}.${skipped}`);
  }

  return <>
    <section className="vs" aria-labelledby="vs-title">
      <div className="vs-head">
        <div><h3 id="vs-title">Сохраненные варианты</h3><p>Хранятся в браузере. Файл передает варианты коллегам.</p></div>
        <div className="vs-tools">
          <button type="button" className="vs-btn" disabled={!canSave} onClick={()=>act('save-hypothesis')}>{hypothesisBusy?'Сохраняем':'Сохранить текущий вариант'}</button>
          <label className="vs-btn vs-file"><span>Загрузить файл</span><input type="file" accept=".json,application/json" onChange={onImport}/></label>
        </div>
      </div>
      <div className="vs-slot"><Notice notice={notice||toastNotice||openedNotice}/></div>
      {week.storageError&&<p className="vs-line" role="alert"><span className="vs-risk">■</span> Риск: хранилище браузера недоступно. Варианты не сохраняются, проверьте настройки браузера</p>}
      {items.length===0?<p className="vs-empty">Сохраненных вариантов пока нет. Сохраните текущий вариант: он останется в списке после перезагрузки страницы</p>:
      <div className="vs-scroll">
        <table className="vs-table">
          <caption className="vs-sr">Сохраненные варианты недели</caption>
          <thead><tr><th scope="col"><span className="vs-sr">Сравнить</span></th><th scope="col">Вариант</th><th scope="col" className="num">Вклад, млн руб.</th><th scope="col">Статус</th></tr></thead>
          <tbody>{items.map(item=>{const f=variantFacts(item,M);return <tr key={item.id} className={item.id===selectedId?'vs-selected':undefined}>
            <td><input type="checkbox" aria-label={`Сравнить: ${item.title}`} checked={compareIds.includes(item.id)} onChange={()=>toggleCompare(item.id)}/></td>
            <td><button type="button" className="vs-pick" aria-pressed={item.id===selectedId} onClick={()=>pick(item.id)}>{item.title}</button><small>Код {f.code} / вход {dash(f.volumeT)} т{opened?.id===item.id?' / открыт':''}</small></td>
            <td className="num">{dash(mln(f.contributionRub),2)}</td>
            <td>{f.feasible?<><span className="vs-ok">●</span> В норме</>:<><span className="vs-risk">■</span> Риск</>}</td>
          </tr>;})}</tbody>
        </table>
      </div>}
      {selected&&<div className="vs-selected-bar" aria-label="Действия с выбранным вариантом">
        <p className="vs-selected-name"><strong>{selected.title}</strong> <span>Код {variantCode(selected.contentHash)} / сохранен {dateText(selected.createdAt)}</span></p>
        <div className="vs-tools">
          <button type="button" className="vs-btn" onClick={()=>openVariant(selected)}>Открыть</button>
          <button type="button" className="vs-btn" onClick={()=>{setMode({kind:'rename'});setDraftTitle(selected.title);}}>Переименовать</button>
          <button type="button" className="vs-btn" onClick={()=>setMode({kind:'delete'})}>Удалить</button>
          <button type="button" className="vs-btn" onClick={()=>printVariant(selected)}>Печать / PDF</button>
          <button type="button" className="vs-btn" onClick={shareFile}>Скачать файл</button>
          <button type="button" className="vs-btn" onClick={copySummary}>Скопировать сводку</button>
        </div>
        {mode?.kind==='rename'&&<form className="vs-inline" onSubmit={saveRename}>
          <label><span>Новое название</span><input value={draftTitle} maxLength={80} onChange={e=>setDraftTitle(e.target.value)} autoFocus/></label>
          <button type="submit" className="vs-btn">Сохранить название</button>
          <button type="button" className="vs-btn" onClick={()=>setMode(null)}>Отмена</button>
        </form>}
        {mode?.kind==='delete'&&<div className="vs-inline" role="group" aria-label="Подтверждение удаления">
          <p>Удалить вариант «{selected.title}»? Восстановить его нельзя.</p>
          <button type="button" className="vs-btn" onClick={removeSelected}>Удалить вариант</button>
          <button type="button" className="vs-btn" onClick={()=>setMode(null)}>Отмена</button>
        </div>}
        {summary?.id===selected.id&&<pre className="vs-summary">{summary.text}</pre>}
      </div>}
      {pair.length===2&&<section className="vs-compare" aria-label="Сравнение двух вариантов">
        <h4 title={`Сравнение: «${pair[0].title}» и «${pair[1].title}»`}>Сравнение: «{pair[0].title}» и «{pair[1].title}»</h4>
        <div className="vs-scroll"><table className="vs-table">
          <thead><tr><th scope="col">Показатель</th><th scope="col" className="num">{pair[0].title}</th><th scope="col" className="num">{pair[1].title}</th><th scope="col" className="num">Разница</th></tr></thead>
          <tbody>{compareVariants(pair[0],pair[1],M).map(row=>{const numeric=typeof row.a==='number'||row.a===null;return <tr key={row.label}>
            <td>{row.label}</td>
            {numeric?<><td className="num">{dash(row.a,row.digits)}</td><td className="num">{dash(row.b,row.digits)}</td><td className="num">{signed(row.diff,row.digits)}</td></>:<><td>{row.a}</td><td>{row.b}</td><td>{row.diff}</td></>}
          </tr>;})}</tbody>
        </table></div>
      </section>}
      {compareIds.length===1&&<p className="vs-hint">Выберите еще один вариант, чтобы сравнить их</p>}
    </section>
    {printItem&&createPortal(<VariantPrint item={printItem} M={M}/>,document.body)}
  </>;
}

// Экран «Варианты»: сохраненные варианты недели сверху, выбор схемы и объема под ними.
export function ScenariosScreen({weekContribution=null}){
  return <div className="vs-root"><SavedVariants weekContribution={weekContribution}/><PlanChoice/></div>;
}
