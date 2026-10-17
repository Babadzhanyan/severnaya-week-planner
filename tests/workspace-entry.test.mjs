// Проверка входа: четыре раздела недели, вкладки разделов, варианты, блоки плана и факта, справка и правила текста.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SECTIONS,VIEWS,sectionOf} from '../src/format.js';
import {HELP_STEPS} from '../src/help-onboarding.js';
const source=async path=>readFile(new URL(path,import.meta.url),'utf8');
const [main,app,views,state,onboarding,plan,format,scenarios,dialogs,overview]=await Promise.all(['../src/main.jsx','../src/App.jsx','../src/views.jsx','../src/state.jsx','../src/help-onboarding.js','../src/PlanScreen.jsx','../src/format.js','../src/ScenariosScreen.jsx','../src/Dialogs.jsx','../src/Overview.jsx'].map(source));

// Навигация: четыре раздела в порядке работы недели: ввод заказов, план, варианты, факт. Эффект остается блоком внутри факта.
assert.deepEqual(SECTIONS.map(section=>section.title),['Ввод заказов','План недели','Варианты','Факт и итоги']);
const tabs=SECTIONS.flatMap(section=>section.views.map(([id])=>id));
assert.deepEqual(tabs,['files','plan','variants','actual']);
assert.equal(SECTIONS[0].views.length,1,'Ввод заказов – один экран; обзор и спрос открываются экранами того же раздела');
assert.deepEqual(VIEWS.map(([id])=>id),['files','demand','overview','plan','variants','actual']);
assert.equal(new Set(VIEWS.map(([id])=>id)).size,VIEWS.length);
for(const id of ['scenarios','approval','effect'])assert.ok(!VIEWS.some(([v])=>v===id),`${id} больше не отдельный экран`);
assert.equal(SECTIONS.filter(section=>[...section.views,...(section.inner||[])].some(([id])=>id==='demand')).length,1,'Спрос один раз в навигации');
assert.equal(sectionOf('demand').id,'orders','Спрос открывается внутри раздела ввода заказов');
assert.equal(sectionOf('overview').id,'orders','Обзор открывается внутри раздела ввода заказов');
assert.equal(sectionOf('variants').id,'variants','Варианты – отдельный раздел меню');
assert.equal(sectionOf('chain').id,'plan');
assert.equal(sectionOf('clients').id,'plan');
assert.equal(sectionOf('actual').id,'fact');
assert.ok(!SECTIONS.some(section=>section.title.includes('Цепочка')),'Цепочка не входит в навигацию');
assert.ok(!tabs.includes('chain')&&!tabs.includes('clients'),'Цепочка и клиенты не выводятся вкладками');

// Оболочка: один вход, навигация по разделам, вкладки только у разделов с несколькими экранами, знакомство.
assert.equal((main.match(/createRoot\(/g)||[]).length,1);
assert.equal((main.match(/<App\s*\/>/g)||[]).length,1);
assert.match(main,/<PlannerProvider><App\s*\/><\/PlannerProvider>/);
assert.doesNotMatch(main,/FileScreen|URLSearchParams|location\.search|searchParams/);
assert.match(app,/SECTIONS\.map\(/);
assert.doesNotMatch(app,/section-tabs/,'Блок вкладок раздела удален: один экран в разделе');
assert.doesNotMatch(app,/section\.views\.map\(/);
assert.match(app,/<FileScreen\s/);
assert.match(app,/<CurrentView\s*\/>/);
assert.match(app,/<SalesDemandScreen\s/);
assert.match(app,/<Onboarding\s+onOpenData=/);
assert.match(app,/onOpenRequest=\{\(\)=>go\('demand','request'\)\}/);
assert.match(app,/e\.target\.closest\('button:not\(\.nav-button\),a,\[role=tablist\]'\)/);
assert.doesNotMatch(app,/URLSearchParams|location\.search|searchParams/);
assert.match(app,/e\.key==='\?'\|\|e\.key==='F1'/);
for(const id of ['files','overview'])assert.ok(app.includes(`'${id}'`),`Экран ${id} подключен к оболочке`);
for(const id of ['plan','demand','actual'])assert.match(views,new RegExp(`\\b${id}:`),`Экран ${id} остается в CurrentView`);
assert.match(views,/overview:OverviewView/,'Обзор выводится первым экраном');
assert.match(views,/import \{Overview\} from '\.\/Overview\.jsx'/,'Обзор подключен из Overview.jsx');
assert.doesNotMatch(views,/ApprovalView|ScenariosView|case 'scenarios'|case 'approval'|case 'effect'/,'Старые экраны удалены из оболочки');
assert.match(views,/export function EffectBlock\(/,'Эффект определен как блок');
assert.match(views,/<EffectBlock\s*\/>/,'Эффект выводится внутри факта');
assert.match(state,/VIEWS\.some\(/);
assert.doesNotMatch(state,/TOUR|startTour|moveTour|endTour/);
assert.match(state,/action==='tour'\)\{[^\n]*openOnboarding\(\)/);
assert.match(state,/action==='scenarios'\)\{go\('plan'\)/,'Сравнение вариантов открывает блок плана');
assert.match(state,/demandMode:view==='demand'\?demandMode:'products'/);

// Блоки плана: строка «Что сделать дальше», сравнение вариантов и решение.
assert.match(plan,/aria-label="Что сделать дальше"/);
assert.doesNotMatch(plan,/Открыть знакомство/,'Вход в знакомство один: кнопка «?» в навигации');
assert.match(app,/aria-label="Открыть справку"/);
assert.match(app,/S\.view==='variants'\?<VariantsView\/>:<CurrentView\/>/,'Экран «Варианты» подключен к оболочке');
assert.match(app,/import \{ScenariosScreen\} from '\.\/ScenariosScreen\.jsx'/,'Варианты: сравнение планов из ScenariosScreen');
assert.match(app,/import \{Onboarding,openOnboarding\} from '\.\/help-onboarding\.js'/,'Справка подключена из help-onboarding.js');
assert.match(plan,/<details className="plan-disclosure" id="alternatives"><summary>Сравнение вариантов<\/summary><ScenariosScreen weekContribution=\{[^}]+\}\/><\/details>/);
assert.match(plan,/<DecisionBlock approved=/);
assert.doesNotMatch(plan,/ApprovalBlock/,'Блок решения один: четыре действия вместо кнопки «Сохранить вариант»');
for(const id of ['hypothesis','compare','commit','approve'])assert.match(plan,new RegExp(`data-decision="${id}"`),`Действие решения «${id}» отдельно`);
assert.match(plan,/onSaveHypothesis=\{\(\)=>act\('save-hypothesis'\)\}/,'Гипотеза сохраняется через отдельное действие');
assert.match(plan,/id="decision"/);
assert.match(plan,/Утвердить версию недели/);
assert.match(plan,/Открыть клиентов/);
assert.match(plan,/sourceLabel=weekSourceLabel\(weekConfig\)/,'Источник недели подписан один раз');
assert.doesNotMatch(plan,/if\(noOrders\)return/,'Контракт без заказов не заменяет весь экран');
assert.doesNotMatch(plan,/waitingData=!!weekConfig/,'Признак ожидания не инвертирован: загрузка контракта не включает ожидание');
assert.match(plan,/trainingWeek=contractReady&&!weekConfig/,'Нет файла недели: учебные данные с пометкой, а не ожидание');
assert.match(plan,/:noOrders\?<section className="plan-blocked" id="orders-wait"/,'Заказов нет: ожидание только в блоке расчета');
assert.match(overview,/<h1>\{title\}<\/h1>/,'Обзор начинается с заголовка-вывода');
assert.match(overview,/<Kpis items=\{facts\.kpi/,'Обзор: четыре KPI на первом экране');
assert.match(overview,/Производственная цепочка/,'Обзор: цепочка на первом экране');
assert.doesNotMatch(overview,/ov-note|Внедрение|Где теряется время|Прайс по позициям|Q1 2026/,'Обзор без повторов и служебных меток');
assert.match(overview,/<ActionButton className="primary" view="files">Ввести заказы недели<\/ActionButton>/,'Обзор: кнопка «Ввести заказы недели» ведет к вводу заказов');

// Справка: не открывается при входе, без отметок в браузере, открывается кнопкой «?» и содержит семь шагов на одном экране.
assert.doesNotMatch(onboarding,/localStorage|STORAGE_KEY|useEffect/,'Справка не открывается сама');
assert.match(app,/className="nav-help"[^>]*onClick=\{openOnboarding\}/,'Кнопка «?» открывает справку');
assert.deepEqual(HELP_STEPS.map(([title])=>title),['Внести заказы','Проверить план','Сохранить вариант','Сравнить варианты','Распечатать','Отправить файл','Как вернуться'],'Справка: семь шагов в порядке работы');
for(const text of ['Как работать с неделей','Закрыть','Перейти к вводу заказов'])assert.ok(onboarding.includes(text),`Справка содержит «${text}»`);
assert.doesNotMatch(HELP_STEPS.flat().join(' '),/\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|[ёЁ]|руб(?!\.)/,'Справка без дат цифрами, без буквы «ё» и с «руб.» через точку');

// Связь с файлом недели: рабочая вкладка плана делегирует переход в продукт через состояние.
assert.match(plan,/setProduct\(id\);go\('demand','request'\)/);

// Тексты раздела: без буквы «ё» и без тире (—).
for(const [name,text] of [['App.jsx',app],['PlanScreen.jsx',plan],['views.jsx',views],['help-onboarding.js',onboarding],['format.js',format],['ScenariosScreen.jsx',scenarios],['Dialogs.jsx',dialogs],['state.jsx',state],['Overview.jsx',overview]]){
  assert.doesNotMatch(text,/[ёЁ]/,`${name}: нет буквы «ё»`);
  assert.doesNotMatch(text,/—/,`${name}: нет тире (—)`);
}
// Решение и строка действия: полномочие открывается подсказкой, кнопка решения 36 px, результат в одной строке, чип шага переносится до 900 px.
const shell=await source('../src/clarity-shell.css');
assert.match(shell,/@media \(max-width:1199px\)\{\s*#root\{height:auto/,'Ниже 1200 px один столбец со страницей прокрутки');
assert.doesNotMatch(plan,/decision-authority/,'Полномочие не выводится отдельной строкой: подсказка у результата');
assert.match(plan,/<Hint as="span" className="decision-result" text="Полномочие: Коммерция">/);
assert.match(plan,/Полномочие: Коммерция, Производство, Финансы\. \$\{hint\}/,'Полномочие утверждения полным списком в подсказке');
assert.match(plan,/className="plan-action-label" text=\{next\.text\}/,'Строка действия с полным текстом в подсказке');
assert.match(shell,/\.plan-screen \.plan-decision \.decision-action>button\{height:36px;min-height:36px/,'Кнопка решения 36 px');
assert.match(shell,/grid-template-rows:36px 14px;row-gap:6px/,'Кнопка 36 px и строка результата 14 px укладываются в 56 px');
assert.match(shell,/\.work-navigation \.nav-chip\{grid-column:1 \/ -1/,'Чип шага на второй строке до 900 px');

console.log('Связь главного входа: три раздела, вкладки, блоки плана и факта, знакомство и правила текста проверены');
