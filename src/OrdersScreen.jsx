import {Fragment,useRef,useState} from 'react';
import {loadWeek,saveWeek,exportWeek,importWeek,MAX_IMPORT_BYTES,ORDER_CLASSES} from './store/weekStore.js';
import {n,parseFieldNumber} from './format.js';
import {CLASS_OPTIONS,buildRow,classLabel,dayLabel,emptyForm,formFromRow,moveVolume,newRowKey,parseOrderText,rejectedImport,rowsWord,sortRows,weekDays,weekRange,weekTotals} from './order-import.js';
import './orders-screen.css';

const clock=()=>{const now=new Date();return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;};
const kg=value=>n(value,0);
const rubMln=value=>n(value/1e6,2);
const rubPrice=value=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const decimal=value=>String(value).replace('.',',');
const STORAGE_RISK='Хранилище браузера недоступно или данные повреждены: изменения сохраняются только на этом экране. Выгрузите неделю в файл';
const NO_ROWS='○ Нет данных: строк заказов нет';

function Field({label,children}){return <label className="orders-field"><span>{label}</span>{children}</label>;}
function TotalsList({title,head,items}){return <div><h4 className="orders-totals-title">{title}</h4><table className="orders-table"><thead><tr><th>{head}</th><th className="num">Объем, кг</th></tr></thead><tbody>{items.map(item=><tr key={item.key}><td>{item.label}</td><td className="num">{kg(item.kg)}</td></tr>)}</tbody></table></div>;}

// Ввод заказов недели: строки, вставка из Excel и CSV, итоги, выгрузка и загрузка файла недели.
// Каждое изменение сохраняется в браузере через saveWeek. Клиент передается только кодом К-NNN.
// Импорт, файл недели и разбивка итогов раскрываются кнопками и по умолчанию не занимают высоту. Открыта только одна из них: так таблица сохраняет место.
export default function OrdersScreen({products={}}){
  const [week,setWeek]=useState(()=>loadWeek());
  const [form,setForm]=useState(()=>emptyForm(week,products));
  const [editingKey,setEditingKey]=useState(null);
  const [formErrors,setFormErrors]=useState([]);
  const [notice,setNotice]=useState(null);
  const [confirmKey,setConfirmKey]=useState(null);
  const [moveDraft,setMoveDraft]=useState(null);
  const [moveErrors,setMoveErrors]=useState([]);
  const [paste,setPaste]=useState('');
  const [importResult,setImportResult]=useState(null);
  const [fileWeek,setFileWeek]=useState(null);
  const [open,setOpen]=useState({import:false,file:false,totals:false});
  const formRef=useRef(null);
  const toggle=key=>setOpen(prev=>({import:false,file:false,totals:false,[key]:!prev[key]}));

  const days=weekDays(week.weekStart);
  const rows=sortRows(week.rows);
  const totals=weekTotals(week.rows,products);
  const productList=Object.entries(products);
  const taken=()=>new Set(week.rows.map(row=>row.key));
  const uniq=field=>[...new Set(week.rows.map(row=>row[field]))].sort();

  // Сохранение недели и сообщение о результате. Изменение остается на экране даже при сбое записи.
  function persist(next,prefix){
    const saved=saveWeek(next);
    setWeek({...next,storageError:!saved.ok});
    setNotice(saved.ok?{tone:'ok',text:`${prefix?prefix+'. ':''}Сохранено в браузере в ${clock()}`}:{tone:'risk',text:saved.errors[0]});
  }

  const setField=name=>event=>{const value=event.target.value;setForm(prev=>({...prev,[name]:value}));};

  function submitRow(event){
    event.preventDefault();
    const key=editingKey??newRowKey(taken());
    const {row,errors}=buildRow(form,{key,week,products});
    if(errors.length){setFormErrors(errors);return;}
    setFormErrors([]);
    const nextRows=editingKey?week.rows.map(item=>(item.key===editingKey?row:item)):[...week.rows,row];
    persist({...week,rows:nextRows},editingKey?'Строка изменена':'Строка добавлена');
    if(editingKey){setEditingKey(null);setForm(emptyForm(week,products));}
    else{setForm(prev=>({...prev,clientCode:'',volume:'',price:'',probability:'',note:''}));formRef.current?.querySelector('input')?.focus();}
  }

  function startEdit(row){
    setEditingKey(row.key);setForm(formFromRow(row));setFormErrors([]);setConfirmKey(null);setMoveDraft(null);
    formRef.current?.querySelector('input')?.focus();
  }
  function cancelEdit(){setEditingKey(null);setForm(emptyForm(week,products));setFormErrors([]);}

  function removeRow(key){
    setConfirmKey(null);
    if(editingKey===key)cancelEdit();
    persist({...week,rows:week.rows.filter(row=>row.key!==key)},'Строка удалена');
  }

  function openMove(row){setMoveDraft({key:row.key,toDay:days.find(day=>day!==row.day)??'',kg:String(row.volumeKg)});setMoveErrors([]);setConfirmKey(null);}
  function confirmMove(){
    const parsed=parseFieldNumber(moveDraft.kg);
    const result=moveVolume(week.rows,{key:moveDraft.key,toDay:moveDraft.toDay,kg:parsed.kind==='number'?parsed.value:NaN,week,newKey:newRowKey(taken())});
    if(!result.ok){setMoveErrors(result.errors);return;}
    setMoveDraft(null);setMoveErrors([]);
    persist({...week,rows:result.rows},`Объем перенесен на ${dayLabel(moveDraft.toDay)}`);
  }

  function checkPaste(){setImportResult(parseOrderText(paste,{week,products,taken:taken()}));}
  async function readCsv(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(file.size>MAX_IMPORT_BYTES){setImportResult(rejectedImport('Файл больше 5 Мбайт: импорт отклонен'));return;}
    try{setImportResult(parseOrderText(await file.text(),{week,products,delimiter:';',taken:taken()}));}
    catch{setImportResult(rejectedImport('Файл не удалось прочитать'));}
  }
  function commitImport(){
    const added=importResult.rows;
    persist({...week,rows:[...week.rows,...added]},`Импортировано ${added.length} ${rowsWord(added.length)}`);
    setImportResult(null);setPaste('');
  }

  async function readWeekFile(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    const result=await importWeek(file);
    setFileWeek(result.ok?{week:result.week}:{errors:result.errors});
  }
  function replaceWeek(){const incoming=fileWeek.week;setFileWeek(null);persist(incoming,'Неделя заменена файлом');}
  async function exportFiles(){
    const result=await exportWeek({...week,storageError:false});
    setNotice(result.ok?{tone:'ok',text:'Файлы недели выгружены: JSON для обмена и CSV для таблицы'}:{tone:'risk',text:result.errors[0]});
  }

  const status=week.storageError?{tone:'risk',sym:'■',text:'Риск: хранилище браузера недоступно'}
    :rows.length?{tone:'ok',sym:'●',text:`В норме: ${rows.length} ${rowsWord(rows.length)}`}
    :{tone:'none',sym:'○',text:'Нет данных: строк заказов нет'};
  const title=rows.length?`Неделя: ${rows.length} ${rowsWord(rows.length)}, ${kg(totals.kg)} кг, сумма ${rubMln(totals.rub)} млн руб.`:'Заказов на неделю пока нет';
  const importable=importResult?.importable===true;
  const importCount=importResult?.rows.length??0;
  const fileRows=fileWeek?.week?.rows.length??0;

  return <div className="orders-screen" id="orders-screen">
    <header className="orders-head">
      <div className="orders-head-main">
        <h2 className="orders-title">{title}</h2>
        <p className="orders-sub">Неделя {weekRange(week.weekStart)}. Объем в кг, цена в руб./кг</p>
      </div>
      <p className={`orders-status tone-${status.tone}`}><span className="sym" aria-hidden="true">{status.sym}</span> {status.text}</p>
    </header>

    {week.storageError&&<p className="orders-notice tone-risk" role="alert"><span className="sym" aria-hidden="true">■</span> {STORAGE_RISK}</p>}
    {notice&&<p className={`orders-notice tone-${notice.tone}`} role="status"><span className="sym" aria-hidden="true">{notice.tone==='ok'?'●':'■'}</span> {notice.text}</p>}

    <section className="orders-block" aria-labelledby="orders-form-title">
      <div className="orders-block-head">
        <h3 id="orders-form-title" className="orders-block-title">{editingKey?'Изменить строку заказа':'Внести строку заказа'}</h3>
        <p className="orders-hint">Служебная пометка: телефон, e-mail и адрес отклоняются при сохранении</p>
      </div>
      <form ref={formRef} className="orders-form" onSubmit={submitRow} noValidate>
        <div className="orders-form-grid">
          <Field label="Клиент"><input value={form.clientCode} onChange={setField('clientCode')} list="orders-clients" placeholder="К-001" autoComplete="off" title="Код вида К и три цифры, например К-001"/></Field>
          <Field label="Товар"><select value={form.product} onChange={setField('product')}>{productList.map(([id,item])=><option key={id} value={id}>{item.name??id}</option>)}</select></Field>
          <Field label="День"><select value={form.day} onChange={setField('day')}>{days.map(day=><option key={day} value={day}>{dayLabel(day)}</option>)}</select></Field>
          <Field label="Зона"><input value={form.zone} onChange={setField('zone')} list="orders-zones" autoComplete="off"/></Field>
          <Field label="Канал"><input value={form.channel} onChange={setField('channel')} list="orders-channels" autoComplete="off"/></Field>
          <Field label="Объем, кг"><input value={form.volume} onChange={setField('volume')} inputMode="numeric" placeholder="1250"/></Field>
          <Field label="Цена, руб./кг"><input value={form.price} onChange={setField('price')} inputMode="decimal" placeholder="288,98" title="Два знака после запятой"/></Field>
          <Field label="Класс"><select value={form.orderClass} onChange={setField('orderClass')}>{CLASS_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          <Field label="Вероятность"><input value={form.probability} onChange={setField('probability')} inputMode="decimal" placeholder="0,8" disabled={form.orderClass!==ORDER_CLASSES[1]} title="От 0 до 1, только для прогноза"/></Field>
          <Field label="Примечание"><input value={form.note} onChange={setField('note')} maxLength={300}/></Field>
          <div className="orders-form-actions">
            <button type="submit" className="primary">{editingKey?'Сохранить строку':'Добавить строку'}</button>
            {editingKey&&<button type="button" className="secondary" onClick={cancelEdit}>Отмена</button>}
          </div>
        </div>
        <datalist id="orders-clients">{uniq('clientCode').map(code=><option key={code} value={code}/>)}</datalist>
        <datalist id="orders-zones">{uniq('zone').map(zone=><option key={zone} value={zone}/>)}</datalist>
        <datalist id="orders-channels">{uniq('channel').map(channel=><option key={channel} value={channel}/>)}</datalist>
        {formErrors.length>0&&<div className="orders-errors" role="alert"><p><span className="sym" aria-hidden="true">■</span> Риск: строка не сохранена</p><ul>{formErrors.map(message=><li key={message}>{message}</li>)}</ul></div>}
      </form>
    </section>

    <section className="orders-block orders-table-block" aria-labelledby="orders-table-title">
      <div className="orders-block-head">
        <h3 id="orders-table-title" className="orders-block-title">Строки недели</h3>
        <span className="orders-sub">{rows.length} {rowsWord(rows.length)}</span>
        <div className="orders-toggles">
          <button type="button" className="text" aria-expanded={open.import} aria-controls={open.import?'orders-import-panel':undefined} onClick={()=>toggle('import')}>{open.import?'Свернуть импорт':'Импорт из Excel и CSV'}</button>
          <button type="button" className="text" aria-expanded={open.file} aria-controls={open.file?'orders-file-panel':undefined} onClick={()=>toggle('file')}>{open.file?'Свернуть файл недели':'Файл недели'}</button>
        </div>
      </div>

      {open.import&&<div id="orders-import-panel" className="orders-panel" aria-labelledby="orders-import-title">
        <h3 id="orders-import-title" className="orders-block-title">Вставка из Excel и импорт CSV</h3>
        <p className="orders-sub">Вставьте строки из Excel в порядке: Клиент, Товар, День, Зона, Канал, Объем, Цена, Класс, Вероятность, Примечание. Строка заголовков по выгрузке CSV тоже подходит. CSV читается с разделителем точка с запятой и десятичной запятой.</p>
        <Field label="Строки из Excel"><textarea value={paste} onChange={event=>setPaste(event.target.value)} rows={5} spellCheck={false}/></Field>
        <div className="orders-buttons">
          <button type="button" className="secondary" onClick={checkPaste} disabled={!paste.trim()}>Проверить вставку</button>
          <label className="orders-file-button">Выбрать CSV-файл<input className="visually-hidden" type="file" accept=".csv,text/csv" onChange={readCsv}/></label>
        </div>
        {importResult&&<div className="orders-preview" aria-live="polite">
          {importResult.fatal.map(message=><p key={message} className="orders-error" role="alert"><span className="sym" aria-hidden="true">■</span> Риск: {message}</p>)}
          {!importResult.fatal.length&&(importable
            ?<p className="orders-notice tone-ok"><span className="sym" aria-hidden="true">●</span> В норме: к импорту {importCount} {rowsWord(importCount)}</p>
            :<p className="orders-error"><span className="sym" aria-hidden="true">■</span> Риск: импорт отклонен, строк с ошибками {importResult.errors.length}</p>)}
          {importResult.errors.length>0&&<ul className="orders-line-errors">{importResult.errors.map(item=><li key={item.line}>Строка {item.line}: {item.messages.join('; ')}</li>)}</ul>}
          {importable&&<div className="orders-table-wrap"><table className="orders-table">
            <thead><tr><th>День</th><th>Клиент</th><th>Товар</th><th>Зона</th><th>Канал</th><th className="num">Объем, кг</th><th className="num">Цена, руб./кг</th><th>Класс</th></tr></thead>
            <tbody>{importResult.rows.map(row=><tr key={row.key}><td>{dayLabel(row.day)}</td><td>{row.clientCode}</td><td>{products[row.product]?.name??row.product}</td><td>{row.zone}</td><td>{row.channel}</td><td className="num">{kg(row.volumeKg)}</td><td className="num">{rubPrice(row.priceRubKg)}</td><td>{classLabel(row.orderClass)}</td></tr>)}</tbody>
          </table></div>}
          <div className="orders-buttons">
            <button type="button" className="primary" disabled={!importable} onClick={commitImport}>{importable?`Импортировать ${importCount} ${rowsWord(importCount)}`:'Импортировать'}</button>
            <button type="button" className="secondary" onClick={()=>setImportResult(null)}>Очистить</button>
          </div>
        </div>}
      </div>}

      {open.file&&<div id="orders-file-panel" className="orders-panel" aria-labelledby="orders-file-title">
        <h3 id="orders-file-title" className="orders-block-title">Файл недели</h3>
        <p className="orders-sub">Выгрузка создает два файла: JSON для обмена и CSV для таблицы. Загрузка JSON заменяет всю неделю содержимым файла.</p>
        <div className="orders-buttons">
          <button type="button" className="secondary" onClick={exportFiles}>Выгрузить неделю</button>
          <label className="orders-file-button">Загрузить файл недели<input className="visually-hidden" type="file" accept=".json,application/json" onChange={readWeekFile}/></label>
        </div>
        {fileWeek&&(fileWeek.week
          ?<div className="orders-preview">
            <p className="orders-notice tone-ok"><span className="sym" aria-hidden="true">●</span> Неделя {weekRange(fileWeek.week.weekStart)}: {fileRows} {rowsWord(fileRows)}, вариантов: {fileWeek.week.scenarios.length}</p>
            <p className="orders-sub">Сейчас в неделе {week.rows.length} {rowsWord(week.rows.length)}: они будут заменены содержимым файла.</p>
            <div className="orders-buttons"><button type="button" className="primary" onClick={replaceWeek}>Заменить неделю</button><button type="button" className="secondary" onClick={()=>setFileWeek(null)}>Отмена</button></div>
          </div>
          :<p className="orders-error" role="alert"><span className="sym" aria-hidden="true">■</span> Риск: {fileWeek.errors.join('; ')}</p>)}
      </div>}

      {rows.length===0?<p className="orders-empty">{NO_ROWS}</p>:
      <div className="orders-table-wrap"><table className="orders-table">
        <thead><tr><th>День</th><th>Клиент</th><th>Товар</th><th>Зона</th><th>Канал</th><th className="num">Объем, кг</th><th className="num">Цена, руб./кг</th><th>Класс</th><th className="num">Вероятность</th><th>Примечание</th><th><span className="visually-hidden">Действия</span></th></tr></thead>
        <tbody>{rows.map(row=>{
          const deleting=confirmKey===row.key, moving=moveDraft?.key===row.key;
          return <Fragment key={row.key}>
            <tr className={editingKey===row.key?'is-selected':undefined}>
              <td>{dayLabel(row.day)}</td><td>{row.clientCode}</td><td>{products[row.product]?.name??row.product}</td><td>{row.zone}</td><td>{row.channel}</td>
              <td className="num">{kg(row.volumeKg)}</td><td className="num">{rubPrice(row.priceRubKg)}</td>
              <td>{classLabel(row.orderClass)}</td><td className="num">{row.probability==null?'–':decimal(row.probability)}</td><td>{row.note}</td>
              <td className="orders-actions">
                {deleting?<><span>Удалить строку?</span> <button type="button" className="danger" onClick={()=>removeRow(row.key)}>Удалить</button> <button type="button" className="text" onClick={()=>setConfirmKey(null)}>Отмена</button></>
                :<><button type="button" className="text" onClick={()=>startEdit(row)}>Изменить</button> <button type="button" className="text" onClick={()=>openMove(row)}>Перенести на день</button> <button type="button" className="text" onClick={()=>{setConfirmKey(row.key);setMoveDraft(null);}}>Удалить</button></>}
              </td>
            </tr>
            {moving&&<tr className="orders-move"><td colSpan={12}>
              <div className="orders-move-panel">
                <Field label="День переноса"><select value={moveDraft.toDay} onChange={event=>setMoveDraft({...moveDraft,toDay:event.target.value})}>{days.filter(day=>day!==row.day).map(day=><option key={day} value={day}>{dayLabel(day)}</option>)}</select></Field>
                <Field label="Объем переноса, кг"><input value={moveDraft.kg} onChange={event=>setMoveDraft({...moveDraft,kg:event.target.value})} inputMode="numeric"/></Field>
                <div className="orders-buttons"><button type="button" className="secondary" onClick={confirmMove}>Перенести</button><button type="button" className="text" onClick={()=>setMoveDraft(null)}>Отмена</button></div>
                {moveErrors.length>0&&<p className="orders-error" role="alert"><span className="sym" aria-hidden="true">■</span> Риск: перенос не выполнен. {moveErrors.join('; ')}</p>}
              </div>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </section>

    <section className="orders-totals" aria-labelledby="orders-totals-title">
      <div className="orders-totals-row">
        <h3 id="orders-totals-title" className="orders-block-title">Итоги недели</h3>
        {totals.empty?<p className="orders-empty">{NO_ROWS}</p>:<>
          <dl className="orders-summary">
            <div><dt>Строк</dt><dd>{totals.count}</dd></div>
            <div><dt>Объем, кг</dt><dd>{kg(totals.kg)}</dd></div>
            <div><dt>Сумма, млн руб.</dt><dd>{rubMln(totals.rub)}</dd></div>
          </dl>
          <button type="button" className="text" aria-expanded={open.totals} aria-controls={open.totals?'orders-totals-detail':undefined} onClick={()=>toggle('totals')}>{open.totals?'Свернуть разбивку':'Разбивка по товарам, дням и классам'}</button>
        </>}
      </div>
      {open.totals&&!totals.empty&&<div id="orders-totals-detail" className="orders-totals-detail">
        <TotalsList title="По товарам" head="Товар" items={totals.byProduct}/>
        <TotalsList title="По дням" head="День" items={totals.byDay}/>
        <TotalsList title="По классам" head="Класс" items={totals.byClass}/>
      </div>}
    </section>
  </div>;
}
