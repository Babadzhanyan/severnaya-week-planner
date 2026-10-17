import React,{useEffect,useId,useRef,useState} from 'react';
import {api} from './api.js';
import {n} from './format.js';
import './cost-details.css';

const money=value=>typeof value==='number'&&Number.isFinite(value)?n(value,2):'Требуются данные';
const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const monthLabel=value=>{const [year,month]=String(value).split('-');return `${MONTHS[Number(month)-1]||month} ${year}`;};

function CostTip({label='Пояснение',children}){
 const [open,setOpen]=useState(false),id=useId();
 return <span className="cost-tip" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)} onFocus={()=>setOpen(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}}}><button type="button" onClick={()=>setOpen(true)} aria-describedby={open?id:undefined}>{label} ⓘ</button>{open&&<span className="cost-tooltip" role="tooltip" id={id} tabIndex="0">{children}</span>}</span>;
}

export function CostDetails({productKey,initialPeriod='',onClose}){
 const dialog=useRef(null),[product,setProduct]=useState(productKey||''),[month,setMonth]=useState(initialPeriod),[tab,setTab]=useState('articles'),[data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const opener=document.activeElement;dialog.current?.showModal();return()=>opener?.focus?.();},[]);
 useEffect(()=>{setProduct(productKey||'');setMonth(initialPeriod);},[productKey,initialPeriod]);
 useEffect(()=>{const controller=new AbortController(),query=new URLSearchParams();if(product)query.set('product',product);if(month)query.set('month',month);setBusy(true);setError('');api('files/costs'+(query.size?'?'+query.toString():''),undefined,{signal:controller.signal}).then(result=>{setData(result);setBusy(false);}).catch(reason=>{if(reason.name!=='AbortError'){setError(reason.message);setBusy(false);}});return()=>controller.abort();},[product,month,retry]);
 const selected=data?.selected,products=data?.products||[],choice=products.find(row=>row.key===product),periods=choice?.periods||data?.periods||[],currentMonth=month||selected?.period||'';
 const partial=selected?.status==='requires_data',catalog=tab==='articles'?data?.articleCatalog:data?.stageCatalog;
 const rows=(tab==='articles'?selected?.articleBreakdown:selected?.stageBreakdown)||[],labels=Object.fromEntries((catalog||[]).map(row=>[row.id,row.label]));
 const max=Math.max(1,...rows.map(row=>Math.abs(row.rubKg||0)));
 const ready=selected&&!busy&&!error;
 return <dialog ref={dialog} className="cost-details" onCancel={event=>{event.preventDefault();onClose?.();}} onClick={event=>{if(event.target===event.currentTarget)onClose?.();}} aria-labelledby="cost-details-title">
  <header className="cost-header"><div><span>Производственные затраты</span><h2 id="cost-details-title">Сырье, цех и упаковка формируют себестоимость</h2></div><button type="button" onClick={onClose} aria-label="Закрыть производственные затраты">Закрыть</button></header>
  <div className="cost-filters"><label>Продукт<select value={choice?product:''} onChange={event=>setProduct(event.target.value)} disabled={!data}><option value="">Выберите продукт</option>{products.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label><label>Месяц<select value={currentMonth} onChange={event=>setMonth(event.target.value)} disabled={!choice||!data}><option value="">Последний доступный</option>{[...periods].sort().reverse().map(value=><option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><CostTip label="Метод расчета">Производственные затраты распределены по переделам на килограмм выпуска выбранного продукта и месяца<br/>Сравнение с клиентским отчетом требует одинакового метода, месяца и базы объема</CostTip></div>
  <div className="cost-body" aria-busy={busy}>
   {busy?<div className="cost-empty" role="status"><h3>Загружаем затраты выбранного продукта</h3><p>Сверяем ставки, детализацию и ссылки на источник</p></div>:error?<div className="cost-empty" role="alert"><h3>Требуется подключение данных</h3><p>{error}</p><button type="button" className="cost-primary" onClick={()=>setRetry(value=>value+1)}>Повторить запрос</button></div>:!selected?<div className="cost-empty"><h3>{data?.selectionStatus==='product_requires_mapping'?'Требуется сопоставление продукта':data?.selectionStatus==='period_requires_data'?'Требуются данные за выбранный месяц':'Выберите продукт и месяц'}</h3><p>{data?.selectionStatus==='product_requires_mapping'?'Выберите точный продукт из списка':data?.selectionStatus==='period_requires_data'?'Выберите месяц с расчетом затрат':'Окно покажет состав себестоимости и затраты цеха по статьям и переделам'}</p>{data&&<span>{n(data.counts.products,0)} продуктов / {n(data.counts.records,0)} записей по месяцам</span>}</div>:<>
    {partial&&<div className="cost-issue" role="status">{selected.issues.map(code=>data.issueLabels[code]||'Требуется подтверждение исходных данных').join('; ')}</div>}
    <div className="cost-main-grid">
     <section className="cost-composition"><div className="cost-total"><span>{partial?'Сумма требует подтверждения':'Производственная себестоимость'}</span><strong>{money(selected.productionCostRubKg)}<small>руб. / кг</small></strong><span>{monthLabel(selected.period)} / выпуск {selected.volumeKg===null?'требует данных':n(selected.volumeKg/1000,2)+' т'}</span></div>
      <table className="cost-components"><thead><tr><th>Состав</th><th>руб. / кг</th></tr></thead><tbody>{[['rawCostRubKg','Сырье'],['processingCostRubKg','Затраты цеха'],['packingRubKg','Упаковочные материалы']].map(([key,label])=><tr key={key} className={key==='processingCostRubKg'?'cost-highlight':''}><th>{key==='packingRubKg'?<CostTip label={label}>Материалы и этикетки. Труд упаковочных операций входит в затраты цеха</CostTip>:label}</th><td>{money(selected[key])}</td></tr>)}</tbody></table>
      <div className="cost-logistics"><span>Распределенная логистика отдельно</span><strong>{money(selected.logisticsRubKg)} <small>руб. / кг</small></strong><CostTip label="Как учитывать">Логистическая ставка показана отдельно от производственной себестоимости. Полнота логистических расходов требует подтверждения</CostTip></div>

     </section>
     <section className="cost-breakdown"><div className="cost-breakdown-header"><div><h3>Как складываются затраты цеха</h3><p>Оба разреза раскрывают {money(selected.processingCostRubKg)} руб. / кг</p></div><div className="cost-tabs" role="group" aria-label="Разрез затрат"><button type="button" aria-pressed={tab==='articles'} onClick={()=>setTab('articles')}>По статьям</button><button type="button" aria-pressed={tab==='stages'} onClick={()=>setTab('stages')}>По переделам</button></div></div>
      <div className={`cost-detail-table ${tab==='stages'?'cost-many-rows':''}`}><table><thead><tr><th>{tab==='articles'?'Статья затрат':'Передел'}</th><th aria-label="Относительная величина"/><th>руб. / кг</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} data-cost-row={row.id} className={row.id==='allocation_adjustment'?'cost-adjustment':''}><th>{row.id==='allocation_adjustment'?<CostTip label={labels[row.id]||row.id}>Корректировка согласует распределение с общей суммой затрат цеха. Знак суммы сохраняется</CostTip>:labels[row.id]||row.id}</th><td><span className="cost-bar-track"><i className={row.rubKg<0?'cost-negative':''} style={{width:`${Math.abs(row.rubKg||0)/max*100}%`}}/></span></td><td>{money(row.rubKg)}</td></tr>)}</tbody><tfoot><tr><th colSpan="2">Итого цех</th><td>{money(selected.processingCostRubKg)}</td></tr></tfoot></table></div>

     </section>
    </div>
   </>}
  </div>
  <footer className="cost-footer"><span>{ready?monthLabel(selected.period):'Выберите продукт и месяц'}</span><CostTip label="Полная себестоимость">Полная себестоимость требует подтверждения логистики, коммерческих и управленческих расходов, а также налоговой основы</CostTip><button type="button" className="cost-footer-close" onClick={onClose} aria-label="Закрыть окно себестоимости">Закрыть</button></footer>
 </dialog>;
}

export default CostDetails;
