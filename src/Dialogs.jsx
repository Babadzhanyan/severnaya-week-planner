import React from 'react';
import {Field, RouteSelect, Status, ProductPicker, MethodList} from './ui.jsx';
import {Waterfall} from './charts.jsx';
import {n,money,delta,prodName,soldQty} from './format.js';

const Btn=({ctx,action,children,primary=false})=><button className={primary?'primary':'secondary'} data-action={action} onClick={()=>ctx.act(action)}>{children}</button>;
const Note=({children})=><p className="mini-note">{children}</p>;
function PriceForm({ctx}){
 const k=ctx.S.product;
 return <><ProductPicker id="modal-product"/><div className="modal-grid">
 <Field label="Цена реализации" path={'prices.'+k} max={2000} unit="руб / кг"/>
 <Field label="Общий спрос" path={'demand.'+k} max={1000} step={.1} unit="т"/>
 <Field label="Подтверждённые заказы" path={'orders.'+k} max={1000} step={.1} unit="т"/>
 <Field label="Затраты обслуживания" path={'service.'+k} max={1000} unit="руб / кг"/>
 </div><Note>Заказы входят в общий спрос. Изменение цены относится ко всему объёму выбранного продукта; индивидуальная заявка рассчитывается отдельно</Note></>;
}
const CAPACITY={
 'source-primary':[['Приёмка птицы',735.126,888.964,'11','Живой вес'],['Убой',735.126,888.964,'13','Живой вес'],['Потрошение',29.809,32.198,'15','Поток потрохов'],['Водяное охлаждение',735.126,888.964,'16','Живой вес*'],['Холодильник тушки',735.126,888.964,'17','Живой вес*'],['Сортировка',735.126,888.964,'18','Живой вес*']],
 'source-cut':[['Разделка STORK + MEYN',197.6042,213.40616,'24','Продукты разделки'],['Филе грудки',36.291,61.824,'25','Готовое филе'],['Филе бедра',5.786,11.088,'26','Готовое филе']],
 'source':[['Тушка навалом',313.222,337.272,'19','Упакованная тушка'],['Индивидуальная тушка',43.094,69.384,'20','Упакованная тушка'],['Обработка ливера',16.61761,15.174,'21','Ливер'],['Упаковка субпродуктов',11.078,18.144,'22','Субпродукты'],['Упаковка лап',22.15682,17.58,'23','Лапы'],['Упаковка ISHIDA',33.972,49.69,'27','Готовые продукты']]
};
function CapacitySource({group}){
 const rows=CAPACITY[group]||CAPACITY.source;
 return <><div className="source-period">Сохранённый сценарий книги / период требует подтверждения</div>
 <table className="data-table capacity-source"><thead><tr><th>Передел / база массы</th><th className="num">Нагрузка, т / сутки</th><th className="num">Ресурс, т / сутки</th><th className="num">Загрузка</th><th>Строка</th></tr></thead><tbody>{rows.map(([name,load,cap,row,basis])=><tr key={row}><td>{name}<small>{basis}</small></td><td className="num">{n(load,2)}</td><td className="num">{n(cap,2)}</td><td className={'num '+(load>cap?'negative':'')}>{n(load/cap*100,1)}%</td><td>{row}</td></tr>)}</tbody></table>
 <div className="source-takeaway">{group==='source-primary'?<><h3>Первичные операции сохраняют базу исходного расчёта</h3><p>* Книга переносит поток живого веса на охлаждение и холодильник. Ёмкость хранения и поток готовой тушки требуют отдельных норм</p></>:group==='source-cut'?<><h3>Численность ограничивает доступный ресурс разделки</h3><p>Книга задаёт 22 человека на STORK и 34 на MEYN. Совместная мощность людей 15,6 т / ч сопоставляется с номиналом линий 27,8 т / ч</p></>:<><h3>Упаковка лап ограничивает исходный сценарий</h3><p>Превышение мощности: 4,58 т в сутки. Лапы относятся к субпродуктам; ножки тушки проходят собственные операции</p></>}</div>
 <p className="source-note">Карта мощности от 29 сентября, лист 2.2 / D: нагрузка, F: мощность, G: загрузка / базы массы сохранены по книге</p></>;
}
export function getDialogContent(ctx){
 const {S,M,r,modal,requestResult,commercial,actionPane}=ctx;
 const {kind,tab='main'}=modal;
 let title='',eye='',tabs=[],body=null,footer=null;
 if(kind==='parameters'&&window.innerWidth<=768){
  title='Управляйте текущим решением';eye='Параметры текущего экрана';body=actionPane;footer=<><button className="text-button" data-action="tour" onClick={()=>ctx.act("tour")}>Показать платформу</button><Btn ctx={ctx} action="close" primary>К экрану</Btn></>;
 }else if(kind==='levers'||kind==='parameters'){
  title='Рычаги меняют всю экономику сценария';eye='Управляемые условия';tabs=[['main','Сырьё и маршруты'],['resources','Мощности'],['market','Спрос и цена']];
  body=tab==='resources'?<><div className="modal-grid">
   <Field label="Разделка за неделю" path="capacity" max={1000} unit="т"/>
   <Field label="Рабочее время разделки" path="hours" max={168} unit="ч"/>
   <Field label="Скорость разделки" path="rate" max={100} step={.025} unit="т / ч"/>
   <Field label="Обвалка за неделю" path="stageCapacity.deboning" max={1000} unit="т входа"/>
   <Field label="Упаковка за неделю" path="stageCapacity.packing" max={1000} unit="т выпуска"/>
   <Field label="Заморозка за неделю" path="stageCapacity.freezing" max={1000} unit="т"/>
   <Field label="Ёмкость холода" path="coldCapacity" max={1000} unit="т запаса"/>
  </div><Note>Разделка ограничена меньшим из двух значений: тоннаж либо время × скорость</Note></>:tab==='market'?<PriceForm ctx={ctx}/>:<><div className="modal-grid">
   <Field label="Вход охлаждённой тушки" path="totalInput" min={1} max={1000} unit="т"/>
   <Field label="Цена сырья" path="rawCost" max={2000} unit="руб / кг"/>
   <RouteSelect/>
   <Field label="Затраты маршрута" path={'routeCosts.'+S.p.route} max={500} step={.1} unit="руб / кг входа"/>
   <Field label="Вход разделки" path="cut" max={S.p.totalInput} unit="т"/>
   <Field label="Обязательства по тушке" path="minWhole" max={S.p.totalInput} unit="т"/>
  </div><div className="explanation-row"><h3>Поставщики влияют на цену и условия поставки</h3><p>Вход модели задаётся после убоя и охлаждения. Живой вес, выход тушки, сортность и сроки требуют отдельного согласования</p></div></>;
  footer=<><span>Каждое изменение обновляет черновик и его проверки</span><Btn ctx={ctx} action="close" primary>Вернуться к сценарию</Btn></>;
 }else if(kind==='routes'){
  title='Схема разделки задаёт совместный выход';eye='Производственные варианты';tabs=[['main','Схемы'],['tree','Дерево операций'],['rules','Правила модели']];
  body=tab==='tree'?<><div className="operation-tree"><div><h3>Тушка</h3><p>Продажа целиком либо разделка</p></div><div><h3>Грудка</h3><p>Грудка на кости либо филе, грудная кость и кожа</p><h3>Ножка</h3><p>Целая ножка либо бедро и голень; обвалка выделяет мясо, кость и кожу</p></div><div><h3>Прочие выходы</h3><p>Крылья, каркас, обрезь, технологические потери</p><h3>Последующие операции</h3><p>Упаковка, охлаждение, заморозка и хранение</p></div></div><p className="source-note">Основа: калькулятор_годовой.xlsx, лист «Справочник разделки», 169 строк / схема макета агрегирует подробные операции</p></>:tab==='rules'?<MethodList items={[
   ['Материальный баланс закрывает каждую тонну','Выходы и технологические потери суммируются до входа маршрута'],
   ['Заказы задают жёсткие обязательства','Выбор схемы проверяется по требуемым продуктам и мощности; сроки получают детализацию в промышленной модели'],
   ['Совместные продукты оцениваются одной корзиной','Выручка всех частей сопоставляется с сырьём, затратами переделов и альтернативным маршрутом'],
   ['Нормы действуют для конкретного сырья','Весовая категория, сортность, оборудование и дата нормы входят в паспорт промышленной модели']
  ]}/>:<div className="route-grid">{Object.entries(M.routes).map(([id,x])=><button key={id} className={'route-choice '+(S.p.route===id?'active':'')} data-route={id} onClick={()=>ctx.selectRoute(id)}><span className="route-name">{x.name}</span><span className="route-desc">{Object.entries(x.yields||{}).map(([k,v])=>`${prodName(k,M)} ${n(v*100)}%`).join(' / ')}</span><span className="route-cost">{n(x.variableCost)} руб / кг входа</span><span className="source-note">{x.sourceStatus||'Учебные коэффициенты'}</span></button>)}</div>;
  footer=<span>Четыре агрегированные схемы / подробная карта поддерживает дальнейшую детализацию</span>;
 }else if(kind==='capacity'){
  title=tab.startsWith('source')?'Карта показывает ограничения исходного сценария':'Переделы определяют предел выбранного маршрута';eye='Мощности и узкие места';tabs=[['main','Сценарий'],['source-primary','Первичные'],['source-cut','Разделка'],['source','Упаковка'],['actions','Решения']];
  body=tab.startsWith('source')?<CapacitySource group={tab}/>:tab==='actions'?<MethodList items={[
   ['Планирование меняет маршрут и календарь','Перенос объёма, выбор схемы разделки, сменность и последовательность партий меняют загрузку операций'],
   ['Производство увеличивает полезное время','Сокращение простоев и переналадок оценивается в часах ограничивающего передела'],
   ['Коммерция согласует состав и срок заказа','Продажа другой части или перенос даты меняют нагрузку и вклад всей корзины'],
   ['Финансы оценивают цену расширения','Дополнительный вклад сравнивается с оплатой смены, услуг и вложениями; расчёт повторяется после сдвига ограничения']
  ]}/>:<><table className="data-table"><thead><tr><th>Передел</th><th className="num">Нагрузка, т</th><th className="num">Ресурс, т</th><th className="num">Загрузка</th><th>Статус</th></tr></thead><tbody>{(r.stages||[]).filter(x=>x.active!==false).map(x=><tr key={x.id||x.name}><td>{x.name}</td><td className="num">{n(x.load)}</td><td className="num">{n(x.capacity)}</td><td className="num">{x.utilization===null?'Ресурс 0':n(x.utilization*100)+'%'}</td><td><Status level={x.load>x.capacity?'bad':x.utilization>=.95?'watch':'ok'}>{x.load>x.capacity?'Превышение':x.utilization>=.95?'На пределе':'Есть резерв'}</Status></td></tr>)}</tbody></table><div className="storage-line"><h3>Хранение ограничивает запас</h3><p>{n(r.storage?.load??r.inventoryT)} т из {n(r.storage?.capacity??S.p.coldCapacity)} т единовременно</p></div><Note>Учебные мощности модели / тоннаж потока и ёмкость хранения учитываются раздельно</Note></>;
  footer=<Btn ctx={ctx} action="levers-resources">Изменить доступные мощности</Btn>;
 }else if(kind==='prices'){
  title='Цена и спрос определяют размещение корзины';eye='Коммерческие рычаги';body=<PriceForm ctx={ctx}/>;footer=<span>Прогноз включает подтверждённые заказы</span>;
 }else if(kind==='commercial'){
  title='Условия сделки меняют вклад всей корзины';eye='Отдельная проверка коммерческого решения';tabs=[['main','Смена клиента'],['discount','Скидка'],['purchase','Поставщики']];
  body=tab==='discount'?<div className="method-list"><h3>Правило скидки меняет результат заказа</h3><table className="data-table"><thead><tr><th>Учебное условие</th><th className="num">Объём, т</th><th className="num">Вклад, тыс ₽</th></tr></thead><tbody><tr><td>Исходная цена 200 руб / кг</td><td className="num">10</td><td className="num">300</td></tr><tr><td>190 руб / кг на дополнительные 2 т</td><td className="num">12</td><td className="num">340</td></tr><tr><td>190 руб / кг на все 12 т</td><td className="num">12</td><td className="num">240</td></tr></tbody></table><p>Учебная себестоимость 170 руб / кг. Разница правил скидки составляет 100 тыс руб</p><p className="source-note">Паспорт расчётов, раздел «Правило скидки» / самостоятельный пример</p></div>:tab==='purchase'?<><MethodList items={[
   ['Цена поставки переводится в цену пригодного входа','Покупная цена, транспорт, выход годной тушки, сортность и потери задают сопоставимую стоимость сырья'],
   ['Партия проверяется по весу и сроку','Весовая категория влияет на выход частей и скорость оборудования; календарь поставки связывается с заказами'],
   ['Условия оплаты влияют на денежный поток','Отсрочка, минимальная партия и надёжность поставщика оцениваются вместе с оборотным капиталом']
  ]}/><Btn ctx={ctx} action="levers" primary>Изменить цену и объём сырья</Btn></>:<><div className="modal-grid"><Field label="Свободный объём ножек" path="volume" scope="client" max={1000} step={.1} unit="т"/><Field label="Замещение объёма" path="share" scope="client" max={100} unit="%"/><Field label="Цена нового клиента" path="price" scope="client" max={2000} unit="руб / кг"/><Field label="Обслуживание клиента" path="service" scope="client" max={1000} unit="руб / кг"/></div><div className="client-result"><div><span>Изменение вклада</span><strong className={commercial?.change<0?'negative':''}>{commercial?delta(commercial.change)+' ₽':'Расчёт…'}</strong></div><div><span>Порог замещения</span><strong>{commercial?.threshold===null?'Требует более высокой цены':commercial?n(commercial.threshold)+'%':'Расчёт…'}</strong></div></div><Note>База после обслуживания: 180 руб / кг. Реализация остатка после заморозки: 135 руб / кг. Горизонт включает будущую продажу</Note></>;
  footer=<span>Самостоятельная чувствительность / общий эффект требует совместного пересчёта</span>;
 }else if(kind==='data'||kind==='sources'){
  title='Источники отделяют факт от учебных условий';eye='Данные и готовность';tabs=[['main','Потоки данных'],['sources','Источники'],['quality','Контроль качества']];
  body=tab==='sources'?<div className="source-register"><div><strong>Планировщик и концепция</strong><p>planirovshik.html, архив severnaya-week-planner.zip, паспорт расчётов и сценарии от 12 октября 2026</p></div><div><strong>Производство и экономика</strong><p>Карта мощности от 29 сентября, годовой калькулятор, модель маржинальности v5, эффективность разделки, калькуляторы и примеры таблиц</p></div><div><strong>Дизайн и доказательные визуалы</strong><p>Гайд по дизайну v3, презентации планирования и 20261001_EN_RB_V6, четыре приложенные иллюстрации</p></div><div><strong>Метод</strong><p><a href="https://www.accaglobal.com/gb/en/student/exam-support-resources/fundamentals-exams-study-resources/f5/technical-articles/relevant-costs.html" target="_blank" rel="noopener noreferrer">ACCA: изменяемые затраты</a><br/><a href="https://research.tue.nl/en/publications/production-planning-and-control-of-poultry-processing-plants/" target="_blank" rel="noopener noreferrer">Исследование планирования птицепереработки</a></p></div></div>:tab==='quality'?<MethodList items={[
   ['Каждый набор получает паспорт','Владелец, дата среза, единицы, охват и статус сверки сопровождают показатель'],
   ['Нормы проходят проверку суммы','Годовой справочник содержит округлённые нормы 100,0214% и 100,1% в отдельных узлах; учебные нормы отдельно замыкают баланс; производственные коэффициенты подтверждает технолог'],
   ['Формулы требуют контрольного пересчёта','Карта мощности содержит три сохранённые ошибки формул. Показанные мощности взяты из проверенных числовых ячеек расчётного листа'],
   ['Обновление сохраняет историю версии','Каждый расчёт связывает срез данных, параметры, алгоритм и подтверждения владельцев']
  ]}/>:<><table className="data-table source-table"><thead><tr><th>Набор</th><th>Зачем нужен</th><th>Владелец</th><th>Статус макета</th></tr></thead><tbody>{[['Выпуск и убой','Вход, сортность, выход','Производство','Учебный срез'],['Заказы, прогноз и цены','Спрос и обязательства','Коммерция','Учебный срез'],['Остатки и сроки','Запасы и годность','Склад','Учебный срез'],['Затраты и условия','Вклад и денежный поток','Финансы','Учебные условия'],['Нормы разделки','Совместный выход','Технолог','Учебные нормы'],['Переделы и мощности','Предел маршрута','Производство','Исходная карта']].map(row=><tr key={row[0]}>{row.map((x,i)=><td key={i}>{x}</td>)}</tr>)}</tbody></table><Note>Основная часть обмена данными обсуждена в проекте. Промышленное подключение каждого набора подтверждается владельцем и контрольной сверкой</Note></>;
  footer=<span>Расчётный сервис выполняет учебные сценарии / подключения к хранилищу входят в этап внедрения</span>;
 }else if(kind==='request-details'){
  title='Заявка проверяется вместе со связанными продуктами';eye='Расчёт коммерческого решения';const q=requestResult;
  const related=Object.entries(q?.relatedOutputs||{}).filter(([,v])=>Math.abs(v)>.00001);
  body=q?<><div className="client-result"><div><span>Физическое покрытие</span><strong>{n(q.covered??q.acceptedQuantity)} из {n(q.requested??S.request.quantity)} т</strong></div><div><span>Изменение вклада</span><strong>{delta(q.deltaContribution||0)} ₽</strong></div></div><table className="data-table"><thead><tr><th>Совместный выход</th><th className="num">Изменение, т</th></tr></thead><tbody>{related.length?related.map(([k,v])=><tr key={k}><td>{prodName(k,M)}</td><td className="num">{n(v)}</td></tr>):<tr><td>Корзина сохраняет текущий объём</td><td className="num">0</td></tr>}</tbody></table><Note>Поглощение прогноза {n(q.forecastConsumed)} т / дополнительный спрос {n(q.incrementalDemand)} т / изменение входа разделки {n(q.extraCut)} т</Note><Note>Чистая цена заявки {n(S.request.price)} руб / кг. Резерв учитывается однократно</Note></>:<p>Проверьте заявку в состоянии «Спрос»</p>;
  footer=<span>Результат относится к текущему сценарию проверки</span>;
 }else if(kind==='economics'){
  title='Выручка всей корзины покрывает изменяемые затраты';eye='Расчёт вклада текущей недели';
  body=<><div className="cost-chart"><Waterfall items={[{name:'Выручка',value:r.revenue,total:true},{name:'Сырьё',value:-r.rawCost},{name:'Переделы',value:-r.routeCost},{name:'Обслуживание',value:-r.serviceCost},{name:'Заморозка',value:-r.freezeCost},{name:'Вклад',value:r.contribution,total:true}]}/></div><div className="method-list"><p>Переделы: тушка {n(r.whole)} т × {n(S.p.routeCosts.whole)} руб / кг + разделка {n(r.cut)} т × {n(S.p.routeCosts[S.p.route])} руб / кг</p><p>Оценка будущей реализации остатка: {money(r.inventoryValue)} руб. Общие постоянные расходы, налоги и вложения рассматриваются отдельно</p></div></>;
  footer=<Btn ctx={ctx} action="levers">Изменить вводные</Btn>;
 }else if(kind==='fact-details'){
  title='Цена и расходы объясняют отклонение';eye='Проверка план–факт';const p=S.approved?.params||S.p, f=ctx.fact,er=ctx.savedResult||r; const soldFillet=soldQty(er,'fillet',S); const priceChange=soldFillet>0?f?.priceDelta/(soldFillet*1000):0;
  body=f?<><table className="data-table"><thead><tr><th>Причина</th><th>Формула</th><th className="num">Изменение, тыс ₽</th></tr></thead><tbody><tr><td>Цена филе</td><td>{n(soldFillet)} т × 1 000 × {n(priceChange,2)} руб / кг</td><td className="num">{n(f.priceDelta/1000)}</td></tr><tr><td>Затраты разделки</td><td>{n(p.cut)} т × 1 000 × −0,2 руб / кг</td><td className="num">{n(f.costDelta/1000)}</td></tr></tbody></table><div className="method-list"><h3>В промышленной версии мост охватывает все причины</h3><p>Объём → состав корзины → цена → сырьё → выход → переделы → запасы</p><p>Фиксированный порядок подстановки относит каждое взаимодействие факторов к одному шагу</p></div></>:<p>Расчёт причин обновляется</p>;
  footer=<span>План–факт измеряет исполнение / эффект решения измеряется относительно сопоставимой альтернативы</span>;
 }else if(kind==='roi-method'){
  title='Сопоставимая база защищает расчёт эффекта';eye='Финансовая модель';body=<MethodList items={[
   ['Вклад отражает экономику всей корзины','Продажи текущей недели − сырьё − переменные расходы выбранного маршрута − дополнительные расходы остатка'],
   ['Запасы связывают периоды','Будущая выручка и учётная стоимость запасов раскрываются отдельными величинами'],
   ['Эффект сравнивает равные внешние условия','Одинаковые спрос, цены, сырьё и календарь позволяют выделить влияние решения'],
   ['Проект оценивается по денежному потоку','Реализованный эффект − сопровождение − вложения − налоги − прирост оборотного капитала'],
   ['Пилот подтверждает реализованный результат','Финансы сверяют версии, базу, фактические продажи и затраты за согласованный период']
  ]}/>;footer=<span>Окупаемость в макете рассчитывается при явном вводе бюджета</span>;
 }else if(kind==='tasks'||kind==='version'){
  title='Версия связывает параметры с исполнением';eye='Сохранённый снимок';const p=S.approved?.params||S.p,er=ctx.savedResult||r;
  body=<div className="method-list"><h3>{S.approved?(S.approvedLabel||S.approved.label):'Текущий черновик'}</h3><p>{M.routes[p.route]?.name} / вход разделки {n(p.cut)} т / вклад {money(er.contribution)} руб</p><table className="data-table"><thead><tr><th>Функция</th><th>Задание версии</th></tr></thead><tbody><tr><td>Производство</td><td>Подготовить {n(p.cut)} т входа по выбранной схеме</td></tr><tr><td>Коммерция</td><td>Разместить совместную корзину в пределах подтверждённых условий</td></tr><tr><td>Склад</td><td>Зарезервировать {n(er.inventoryT)} т конечного остатка</td></tr><tr><td>Финансы</td><td>Сверить вклад {money(er.contribution)} руб и причины отклонения</td></tr></tbody></table></div>;
  footer=<><span>Демонстрационные задания сохранены в браузере</span><Btn ctx={ctx} action="export">Скачать версию</Btn></>;
 }else{
  title='Рычаги связывают решения с результатом фабрики';eye='Концепция платформы';tabs=[['main','Логика'],['scope','Границы'],['roadmap','Развитие']];
  body=tab==='scope'?<MethodList items={[
   ['Макет исполняет связанные сценарии','Четыре агрегированные схемы разделки, спрос по продуктам, мощности, сравнение вариантов и версия плана работают на учебных данных'],
   ['Промышленная модель раскрывает подробности','Весовые категории, сортность, партии, сроки, маршруты оборудования, клиенты, скидки и многопериодные запасы уточняются по источникам'],
   ['Подключение данных проходит приёмку','Владельцы подтверждают доступность, свежесть, единицы и полноту каждого набора']
  ]}/>:tab==='roadmap'?<MethodList items={[
   ['Владельцы подтверждают модель и источники','Технологи сверяют выходы, производство – мощности, коммерция – спрос, финансы – экономику'],
   ['Пилот проверяет решения на истории','Совместная сверка физического баланса, ограничений и денежных последствий выявляет расхождения'],
   ['Пользователи проверяют рабочий цикл','Новая заявка, смена схемы, перегруз передела, остаток, утверждение и разбор факта проходят приёмку'],
   ['Промышленный контур закрепляет управление','Роли, журнал действий, версии, автоматическое обновление и контроль качества поддерживают регулярное планирование']
  ]}/>:<><div className="concept-map"><div><h3>Что меняем</h3><p>Сырьё и поставки<br/>Маршрут и ресурсы<br/>Спрос и условия сделки</p></div><div><h3>Что проверяем</h3><p>Баланс каждой части<br/>Обязательства и сроки<br/>Мощности и остатки</p></div><div><h3>Что получаем</h3><p>Выполнимый план<br/>Вклад всей корзины<br/>Объяснимое отклонение</p></div></div><Note>План, спрос, варианты, согласование, план–факт и эффект используют единое состояние расчёта</Note></>;
  footer=<Btn ctx={ctx} action="reset">Восстановить учебный пример</Btn>;
 }
 return {title,eye,tabs,body,footer};
}
