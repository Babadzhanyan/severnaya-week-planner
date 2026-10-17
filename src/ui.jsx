import React,{useEffect,useId,useState} from 'react';
import {usePlanner} from './state.jsx';
import {fieldCommit,n,pathGet,prodName} from './format.js';
const ICONS={fullscreen:'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',chevron:'M9 6l6 6-6 6'};
export function Icon({name}){return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]}/></svg>;}
// Статусы: одна система символ плюс слово плюс цвет. Заливка чипа задается в styles.css.
const STATUS_TONE={ok:['ok','●'],bad:['risk','■'],risk:['risk','■'],watch:['warn','▲'],warn:['warn','▲'],none:['none','○'],info:['info','◇']};
export function Status({level,children}){const [tone,symbol]=STATUS_TONE[level]||STATUS_TONE.none;return <span className={`chip chip-${tone}`} data-level={level}><span aria-hidden="true">{symbol}</span>{children}</span>;}
export function ActionButton({action,view,className='text-button',children,disabled,...props}){const{act,go,busy,error}=usePlanner();const mutation=['approve','check-request','apply-request'].includes(action);return <button {...props} className={className} data-action={action} data-view={view} disabled={disabled||(mutation&&(busy||!!error))} onClick={()=>view?go(view):act(action)}>{children}</button>;}
export function Hint({text,children,className='',as:Tag='span',onClick,...props}){const {showTooltip,hideTooltip,tooltip}=usePlanner();return <Tag {...props} aria-describedby={tooltip?.text===text?'tooltip':undefined} className={className} tabIndex={props.tabIndex??0} data-tip={text} onMouseEnter={e=>showTooltip(text,e.currentTarget)} onMouseLeave={hideTooltip} onFocus={e=>showTooltip(text,e.currentTarget)} onBlur={hideTooltip} onClick={onClick}>{children}</Tag>;}
export function Metric({label,value,note,tip}){const{act}=usePlanner();const clickable=label.includes('Вклад');return <Hint as="div" className="metric" text={tip||note} role={clickable?'button':undefined} data-action={clickable?'economics':undefined} onClick={clickable?()=>act('economics'):undefined} onKeyDown={e=>{if(clickable&&['Enter',' '].includes(e.key)){e.preventDefault();act('economics');}}}><label>{label}</label><strong className={/Требуется|Требует|База требует|Вложения 0/.test(String(value))?'disabled-value':/^[−-]/.test(String(value))?'negative':''}>{value}</strong><small>{note}</small></Hint>;}
// Поле не меняет значение молча: при выходе из поля допустимый ввод сохраняется, пустое, нечисловое, отрицательное значение
// и превышение предела показывают причину; корректировку до предела выбирает пользователь кнопкой «Ограничить до …».
export function Field({label,path,scope='p',min=0,max=100,unit=''}){
 const {S,changeField}=usePlanner(),id=useId(),noteId=useId(),raw=pathGet(S[scope],path);
 const clearable=scope==='roi'&&['investment','annualOpex'].includes(path);
 const [draft,setDraft]=useState(raw??'');const [issue,setIssue]=useState(null);
 useEffect(()=>{setDraft(raw??'');setIssue(null);},[raw]);
 const u=unit?' '+unit:'', outside=raw!==null&&raw!==undefined&&(raw>max||raw<min);
 const stored=outside?`Сохранено ${n(raw)}${u}: вне диапазона ${n(min)}–${n(max)}${u}`:null;
 function commit(){
   const res=fieldCommit({text:draft,current:raw??null,min,max,unit,clearable});
   if(res.kind==='apply'){setIssue(null);if(res.value!==raw)changeField(scope,path,res.value);setDraft(res.value);return;}
   if(res.kind==='same'){setIssue(null);setDraft(raw??'');return;}
   if(res.kind==='clear'){setIssue(null);changeField(scope,path,null);return;}
   if(res.kind==='keep'){setDraft(raw??'');setIssue({text:res.message});return;}
   setIssue({text:res.message,apply:res.apply,applyLabel:res.applyLabel});
 }
 function applyIssue(){changeField(scope,path,issue.apply);setDraft(issue.apply);setIssue(null);}
 function cancelIssue(){setDraft(raw??'');setIssue(null);}
 // Кнопки не забирают фокус у поля: иначе потеря фокуса перестроит блок до нажатия.
 const keepFocus=e=>e.preventDefault();
 return <div className="lever-field"><label htmlFor={id}>{label}</label><div className="field-row"><input id={id} type="text" inputMode="decimal" data-scope={scope} data-param={path} value={draft} aria-invalid={issue?true:undefined} aria-describedby={issue||stored?noteId:undefined} disabled={scope==='p'&&path==='cut'&&S.p.route==='whole'} placeholder={raw===null?'Введите':undefined} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span className="field-unit">{unit}</span></div>{(issue||stored)&&<div className={`field-note${issue?' field-note-alert':''}`} id={noteId} role={issue?'alert':undefined}><span>{issue?issue.text:stored}</span>{issue?.apply!==undefined&&<span className="field-note-actions"><button type="button" className="text-button" onMouseDown={keepFocus} onClick={applyIssue}>{issue.applyLabel}</button><button type="button" className="text-button" onMouseDown={keepFocus} onClick={cancelIssue}>Отменить</button></span>}</div>}</div>;
}
export function RouteSelect(){const {S,M,selectRoute}=usePlanner(),id=useId();return <div className="lever-field"><label htmlFor={id}>Схема разделки</label><select id={id} data-param="route" data-scope="p" value={S.p.route} onChange={e=>selectRoute(e.target.value)}>{Object.entries(M.routes).map(([id,r])=><option key={id} value={id}>{r.name}</option>)}</select></div>;}
export function ProductPicker({all=true}){const {S,M,setProduct}=usePlanner(),id=useId();return <div className="product-picker"><label htmlFor={id}>Продукт</label><select id={id} data-ui="product" value={S.product} onChange={e=>setProduct(e.target.value)}>{Object.keys(M.products).filter(k=>all||k!=='loss').map(k=><option key={k} value={k}>{prodName(k,M)}</option>)}</select></div>;}
export function Heading({eye,title,children}){return <div className="page-heading"><div><div className="eyebrow">{eye}</div><h1>{title}</h1></div><div className="heading-actions"><ActionButton className="secondary mobile-parameters" action="parameters">Параметры</ActionButton>{children}</div></div>;}
export function Panel({title,foot,children}){return <section className="visual-pane"><div className="visual-header"><h2>{title}</h2></div>{children}{foot&&<div className="source-note">{foot}</div>}</section>;}
export function ActionPane({title,children}){return <aside className="action-pane"><div className="eyebrow">Ваше действие</div><h2>{title}</h2>{children}</aside>;}
export function Signal({title,detail,action,level='watch'}){return <ActionButton className="signal-item" action={action}><span className="signal-head"><Status level={level}>{level==='bad'?'Требует решения':level==='ok'?'Проверено':'Проверить'}</Status></span><span className="signal-title">{title}</span><span className="signal-meta">{detail}</span><span className="signal-link" aria-hidden="true"><Icon name="chevron"/></span></ActionButton>;}
// Статусы плана: символ, слово и цвет через чип. Значения совпадают с statusLevels в model.js.
export const PLAN_STATUS={none:{level:'none',symbol:'○',word:'Нет данных'},risk:{level:'risk',symbol:'■',word:'Риск'},warn:{level:'warn',symbol:'▲',word:'Внимание'},ok:{level:'ok',symbol:'●',word:'В норме'}};
export function PlanStatus({status,children}){if(!status)return null;return <span className={`chip chip-${status.level}`} data-level={status.level}><span aria-hidden="true">{status.symbol}</span><span className="plan-status-word">{status.word}</span>{children&&<span className="plan-status-label">{children}</span>}</span>;}
// Метка учебных значений: блоки с учебными числами не выглядят рабочими результатами.
export function TrainingMark(){return <span className="training-mark">Учебный пример</span>;}
export function MethodList({items}){return <div className="method-list">{items.map(([h,p],i)=><React.Fragment key={i}>{h&&<h3>{h}</h3>}<p>{p}</p></React.Fragment>)}</div>;}
// Иконки узлов пути: разметка icons/*.svg дизайн-системы (viewBox 96, обводка currentColor). Разметка хранится здесь, чтобы не добавлять файлы к экрану.
const CHAIN_ICON_MARKUP={
 bird:'<circle cx="66" cy="34" r="8"/><path d="M61 27 Q63 19 67 25 Q69 19 71 26"/><path d="M74 32 L83 35 L74 38 Z"/><circle cx="69" cy="33" r="1"/><path d="M58 42 C70 46 78 58 74 70 C70 80 56 82 44 80 C32 78 22 70 22 58 C22 50 28 44 36 42 Z"/><path d="M32 62 Q46 46 64 58 Q50 66 32 62 Z"/><path d="M22 52 Q12 44 14 30 Q22 38 26 46"/><path d="M22 58 Q10 56 8 46"/><path d="M44 80 V90 M58 80 V90"/><path d="M38 90 H48 M52 90 H64"/>',
 slaughter:'<path d="M4 19 H92"/><rect x="42" y="14" width="16" height="10" rx="2"/><path d="M50 24 V40"/><path d="M44 40 C36 44 34 58 38 70 C41 80 46 84 50 84 C54 84 59 80 62 70 C66 58 64 44 56 40 Z"/>',
 cutting:'<path d="M10 62 C10 46 22 36 38 38 C50 40 58 50 56 62 C54 74 42 82 28 80 C18 78 10 72 10 62 Z"/><path d="M46 60 L12 74" stroke-dasharray="3 4"/><path d="M46 60 L80 26 L86 32 L52 66 Z"/><path d="M80 26 L86 20 L92 26 L86 32"/>',
 packing:'<path d="M48 14 L80 30 L48 46 L16 30 Z"/><path d="M16 30 V66 L48 82 V46"/><path d="M80 30 V66 L48 82"/><path d="M24 44 L38 51 V61 L24 54 Z"/><path d="M58 40 L70 46"/>',
 cold:'<rect x="18" y="16" width="60" height="64" rx="6"/><path d="M18 36 H78"/><path d="M70 24 V30"/><path d="M48 46 V74"/><path d="M35.9 53 L60.1 67"/><path d="M35.9 67 L60.1 53"/>',
 truck:'<rect x="8" y="24" width="52" height="42" rx="2"/><path d="M60 40 H72 L84 52 V66 H60 Z"/><path d="M66 46 H72 L78 52 H66 Z"/><path d="M8 66 H60"/><circle cx="24" cy="74" r="7"/><circle cx="72" cy="74" r="7"/>',
};
export function ChainIcon({name}){return <svg className="chain-icon" width="56" height="56" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{__html:CHAIN_ICON_MARKUP[name]??''}}/>;}
