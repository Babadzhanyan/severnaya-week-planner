import React from 'react';
import {api} from './api.js';
import {ActionButton} from './ui.jsx';
import './overview.css';

// Обзор недели: агрегаты из файла фактов, строки клиентов и сотрудников не выводятся.
// Первый экран: итоги, цепочка и три графика. Подробности открываются экранами недели по ссылкам.
let factsPromise;
const loadFacts = () => factsPromise || (factsPromise = api('facts').then(facts => ({facts, failed: false}), () => ({facts: null, failed: true})));

function useFacts() {
  const [state, setState] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    loadFacts().then(next => { if (alive) setState(next); });
    return () => { alive = false; };
  }, []);
  return state;
}

const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '–');
const pct = (value, digits = 1) => (Number.isFinite(value) ? `${fmt(value, digits)}%` : '–');
const STATUS = {ok: ['Есть', 'ok'], part: ['Частично', 'part'], gap: ['Нет', 'gap']};
const decisionClass = status => (/принят/i.test(status) ? 'ok' : /гипотез/i.test(status) ? 'hyp' : 'gap');

function Kpis({items}) {
  return <div className="ov-kpis">{items.map(item => <div className="ov-kpi" key={item.label}><b>{item.value}</b><span>{item.label}</span></div>)}</div>;
}

function Chain({steps}) {
  return <ol className="ov-chain" aria-label="Производственная цепочка">
    {steps.map(step => <li key={step.key}><span className="ov-lane">{step.lane}</span><strong>{step.label}</strong></li>)}
  </ol>;
}

function Quarters({items}) {
  const max = Math.max(...items.map(item => item.volumeMln), 1);
  return <div className="ov-qbars" role="img" aria-label="Объем по кварталам, млн кг">
    {items.map(item => <div className="ov-q" key={item.label}>
      <div className="ov-q-bar" style={{height: `${Math.round(item.volumeMln / max * 130)}px`}}/>
      <b>{fmt(item.volumeMln)}</b><span>{item.label}</span><em>маржа {pct(item.marginShare)}</em>
    </div>)}
  </div>;
}

// Доли в шкале от 0 до 100%: каналы сбыта и доля крупнейших клиентов.
function Shares({items, labelKey = 'label', digits = 0}) {
  return <div className="ov-bars">
    {items.map(item => <div className="ov-bar-row" key={item[labelKey]}>
      <span>{item[labelKey]}</span>
      <div className="ov-bar-track"><i style={{width: `${Math.min(item.sharePct, 100)}%`}}/></div>
      <b>{pct(item.sharePct, digits)}</b>
    </div>)}
  </div>;
}

export function Overview() {
  const state = useFacts();
  const loading = state === null;
  const facts = state?.facts || null;
  const failed = state?.failed === true;
  const tiles = facts?.dataStatus || [];
  const ready = tiles.filter(tile => tile.status === 'ok').length;
  const title = tiles.length ? `Данные для расчета готовы: ${ready} из ${tiles.length}` : 'Обзор недели';
  return <div className="overview ov-root" id="overview">
    <header className="ov-head">
      <p className="ov-eyebrow">Производство и продажи</p>
      <h1>{title}</h1>
      <p className="ov-sub">Период: {facts?.period?.year || 'май 2025 – апрель 2026'}</p>
      <div className="ov-actions"><ActionButton className="primary" view="files">Ввести заказы недели</ActionButton></div>
    </header>
    {loading && <p className="ov-status" role="status">Загружаем данные</p>}
    {failed && <p className="ov-status ov-error" role="alert">Файл фактов не загружен. Показатели скрыты до подтверждения источника.</p>}
    {facts && <>
      <Kpis items={facts.kpi.slice(0, 4).map(item => ({value: item.value, label: item.label}))}/>
      <section className="ov-block" aria-labelledby="ov-chain-title"><h3 id="ov-chain-title">Производственная цепочка</h3><Chain steps={facts.chain}/></section>
      <div className="ov-grid">
        <section className="ov-block" aria-labelledby="ov-q-title"><h3 id="ov-q-title">Объем по кварталам, млн кг</h3><Quarters items={facts.quarters}/></section>
        <section className="ov-block" aria-labelledby="ov-ch-title"><h3 id="ov-ch-title">Каналы по объему</h3><Shares items={facts.channels}/></section>
        <section className="ov-block ov-wide" aria-labelledby="ov-conc-title"><h3 id="ov-conc-title">Доля крупнейших клиентов в выручке</h3><Shares items={facts.concentration} labelKey="top" digits={1}/></section>
      </div>
      <div className="ov-grid">
        <section className="ov-block ov-wide" aria-labelledby="ov-data-title"><h3 id="ov-data-title">Данные для расчета недели</h3>
          <div className="ov-tiles">{tiles.map(tile => <div className="ov-tile" key={tile.label}><span>{tile.label}</span><em className={`ov-chip ${STATUS[tile.status]?.[1] || 'gap'}`}>{STATUS[tile.status]?.[0] || 'Нет'}</em></div>)}</div>
        </section>
        <section className="ov-block ov-wide" aria-labelledby="ov-dec-title"><h3 id="ov-dec-title">Решения для утверждения</h3>
          <div className="ov-decisions">{facts.decisions.map(item => <div className="ov-decision" key={item.title}><em className={`ov-chip ${decisionClass(item.status)}`}>{item.status}</em><b>{item.title}</b><small>{item.note}</small></div>)}</div>
        </section>
        <section className="ov-block ov-wide" aria-labelledby="ov-more-title"><h3 id="ov-more-title">Подробнее на экранах недели</h3>
          <div className="ov-links">
            <ActionButton className="ov-link" view="files">Выход частей тушки</ActionButton>
            <ActionButton className="ov-link" view="plan">Загрузка стадий</ActionButton>
            <ActionButton className="ov-link" view="demand">Цены по позициям</ActionButton>
          </div>
        </section>
      </div>
      <footer className="ov-foot">Источники: {facts.sources.join('; ')}. Показатели агрегированы: строки клиентов и сотрудников на экране не выводятся.</footer>
    </>}
  </div>;
}
