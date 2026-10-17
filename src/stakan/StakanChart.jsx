import React, {useEffect, useId, useRef, useState} from 'react';
import {buildScene, checkTotals, fmtNum, fmtShareRound, moveIndex} from './geometry.js';
import './stakan.css';

// Стакан цены и себестоимости филе. Геометрия и подписи – в geometry.js; здесь только вывод, фокус и состояния.
const DEFAULT_WIDTH = 720;
const TIP_W = 232;
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const MONTHS_GEN = {
  январь: 'января', февраль: 'февраля', март: 'марта', апрель: 'апреля', май: 'мая', июнь: 'июня',
  июль: 'июля', август: 'августа', сентябрь: 'сентября', октябрь: 'октября', ноябрь: 'ноября', декабрь: 'декабря',
};
const DEFAULT_EXCLUDED = ['логистика', 'коммерческие расходы', 'общехозяйственные расходы'];

const lower = text => {
  const s = String(text ?? '');
  return s.charAt(0).toLowerCase() + s.slice(1);
};
const genitive = period => {
  const [month, ...rest] = lower(period).split(' ');
  return [MONTHS_GEN[month] ?? month, ...rest].join(' ');
};
const rangeText = r => `${r.from}–${r.to} руб. / кг`;
const validSteps = steps => Array.isArray(steps) && steps.length > 0
  && steps.every(s => Number.isFinite(s?.kg) && s.kg > 0 && Number.isFinite(s?.avgPrice) && s.avgPrice >= 0);
const validCost = cost => (Array.isArray(cost) ? cost.filter(c => Number.isFinite(c?.value) && c.value >= 0) : []);

const stepAria = r => `Диапазон ${rangeText(r)}: ${fmtNum(r.kg)} кг, ${fmtShareRound(r.share)} объема, средняя цена ${fmtNum(r.price, 2)} руб. / кг, выручка ${fmtNum(r.revenue)} руб.`;
const colAria = c => (c.total
  ? `Итог себестоимости: ${fmtNum(c.cum, 2)} руб. / кг`
  : `${c.label}: накопленный итог ${fmtNum(c.cum, 2)} руб. / кг`);

// Подробности элемента для подсказки: заголовок и строки «подпись – значение».
function describe(item, isStep, period) {
  if (isStep) {
    return {
      title: `Диапазон ${rangeText(item)}`,
      rows: [
        ['Период', period],
        ['Средняя цена, руб. / кг', fmtNum(item.price, 2)],
        ['Объем, кг', fmtNum(item.kg)],
        ['Выручка, руб.', fmtNum(item.revenue)],
        ['Доля объема', fmtShareRound(item.share)],
        ['Строки источника', item.rows == null ? 'нет данных' : fmtNum(item.rows)],
      ],
    };
  }
  if (item.total) {
    return {title: 'Итог себестоимости', rows: [['Накопленный итог, руб. / кг', fmtNum(item.cum, 2)], ['Период', period]]};
  }
  return {
    title: item.label,
    rows: [
      ['Накопленный итог, руб. / кг', fmtNum(item.cum, 2)],
      [item.index === 0 ? 'Статья, руб. / кг' : 'Приращение, руб. / кг', `${item.index === 0 ? '' : '+'}${fmtNum(item.delta, 2)}`],
      ['Доля в себестоимости', `${fmtNum(item.share)}%`],
      ['Период', period],
    ],
  };
}

function detailText(selected, count, items, isStep) {
  if (selected === null || selected >= count) return 'Выберите ступень или столбец, чтобы закрепить подробности.';
  const item = items[selected];
  if (isStep(selected)) {
    return `Выбрано: диапазон ${rangeText(item)}, ${fmtNum(item.kg)} кг, средняя цена ${fmtNum(item.price, 2)} руб. / кг, выручка ${fmtNum(item.revenue)} руб., доля ${fmtShareRound(item.share)}.`;
  }
  return item.total
    ? `Выбрано: итог себестоимости ${fmtNum(item.cum, 2)} руб. / кг.`
    : `Выбрано: ${item.label}, накопленный итог ${fmtNum(item.cum, 2)} руб. / кг.`;
}

export function StakanChart({
  periodLabel = 'Апрель 2026',
  steps = [],
  totals = null,
  cost = [],
  tolerance = {},
  sourceNote = 'агрегаты продаж филе',
  excluded = DEFAULT_EXCLUDED,
  status = 'ready',
  onRetry,
}) {
  const uid = useId();
  const figRef = useRef(null);
  const itemRefs = useRef([]);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [roving, setRoving] = useState(null);
  const [focusIdx, setFocusIdx] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tablesOpen, setTablesOpen] = useState(false);

  // Ширина фигуры: при нулевой ширине (скрытый блок) размер не меняется.
  useEffect(() => {
    const el = figRef.current;
    if (!el) return undefined;
    const apply = w => { if (w >= 200) setWidth(Math.floor(w)); };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => apply(el.getBoundingClientRect().width);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const observer = new ResizeObserver(entries => apply(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ready = status === 'ready' && validSteps(steps);
  const scene = buildScene(ready ? steps : [], ready ? validCost(cost) : [], totals, width);
  const {layout, rects, costs} = scene;
  const {plot, stakan} = layout;
  const count = rects.length + costs.length;
  const isStep = i => i < rects.length;
  const items = [...rects, ...costs];
  const mainIdx = scene.main ? scene.main.index : 0;
  const rovingIdx = roving !== null && roving < count ? roving : mainIdx;
  const tipIdx = hoverIdx ?? focusIdx ?? selected;
  const tipItem = tipIdx !== null && tipIdx < count ? items[tipIdx] : null;
  const tipView = tipItem ? describe(tipItem, isStep(tipIdx), periodLabel) : null;
  const tipLeft = tipItem ? Math.max(0, Math.min(layout.width - TIP_W, tipItem.cx - TIP_W / 2)) : 0;
  const check = ready ? checkTotals(steps, {kg: scene.kgRef, revenue: scene.revenueRef}, tolerance) : null;

  const captionId = `${uid}-cap`;
  const descId = `${uid}-desc`;
  const tablesId = `${uid}-tables`;
  const excludedText = excluded.length ? `${excluded.join(', ')}` : '';

  const focusItem = i => { if (i >= 0 && itemRefs.current[i]) itemRefs.current[i].focus(); };
  const toggle = i => setSelected(s => (s === i ? null : i));
  const onKey = i => event => {
    const {key} = event;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') { event.preventDefault(); toggle(i); return; }
    if (key === 'Escape') { event.preventDefault(); setSelected(null); return; }
    if (!MOVE_KEYS.has(key)) return;
    event.preventDefault();
    const next = moveIndex(i, key, count);
    if (next !== i) focusItem(next);
  };
  const itemProps = i => ({
    ref: el => { itemRefs.current[i] = el; },
    role: 'button',
    tabIndex: rovingIdx === i ? 0 : -1,
    'aria-pressed': selected === i,
    className: 'stakan-item',
    onClick: () => toggle(i),
    onKeyDown: onKey(i),
    onFocus: () => { setRoving(i); setFocusIdx(i); },
    onBlur: () => setFocusIdx(f => (f === i ? null : f)),
    onMouseEnter: () => setHoverIdx(i),
    onMouseLeave: () => setHoverIdx(h => (h === i ? null : h)),
  });

  const caption = `Стакан цены и себестоимости филе, ${lower(periodLabel)}`;

  let body;
  if (status === 'error') {
    body = (
      <>
        <p className="stakan-status"><span className="stakan-sym risk" aria-hidden="true">■</span> <span>Риск: данные не загружены, ответ сервера содержит ошибку</span></p>
        <div className="stakan-actions"><button type="button" className="secondary stakan-retry" onClick={() => onRetry?.()}>Повторить</button></div>
      </>
    );
  } else if (!ready) {
    body = (
      <>
        <p className="stakan-status"><span className="stakan-sym none" aria-hidden="true">○</span> <span>{`Нет данных: агрегаты ${genitive(periodLabel)} не переданы`}</span></p>
        <div className="stakan-actions"><button type="button" className="secondary stakan-toggle" disabled>Таблица</button></div>
      </>
    );
  } else {
    const shareSum = rects.reduce((sum, r) => sum + r.share, 0);
    body = (
      <>
        <div className="stakan-frame">
          <svg
            className="stakan-svg"
            role="group"
            aria-labelledby={captionId}
            aria-describedby={descId}
            width={layout.width}
            height={layout.svgHeight}
            viewBox={`0 0 ${layout.width} ${layout.svgHeight}`}
          >
            <desc id={descId}>{scene.desc}</desc>
            <g aria-hidden="true">
              <line className="stakan-baseline" x1={plot.x} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
              {scene.ticks.price.map(t => (
                <text key={`py${t.value}`} className="stakan-tick" x={plot.x - 6} y={t.y + 4} textAnchor="end">{t.text}</text>
              ))}
              <text className="stakan-unit" x={plot.x - 6} y={12} textAnchor="end">руб.</text>
              <text className="stakan-unit" x={plot.x - 6} y={25} textAnchor="end">/ кг</text>
              {scene.ticks.volume.map(t => (
                <text key={`vx${t.value}`} className="stakan-tick" x={t.x} y={plot.bottom + 16} textAnchor="middle">{t.text}</text>
              ))}
            </g>
            {rects.map(r => (
              <g key={`s${r.index}`} {...itemProps(r.index)} aria-label={stepAria(r)}>
                <rect className="stakan-hit" x={r.hit.x} y={r.top} width={r.hit.w} height={r.h} />
                <rect
                  className={r.main ? 'stakan-step is-main' : 'stakan-step'}
                  style={{'--i': r.index}}
                  x={r.x}
                  y={r.top}
                  width={r.w}
                  height={r.h}
                />
                <rect className="stakan-outline" x={r.x - 3} y={r.top - 3} width={r.w + 6} height={r.h + 6} />
                {r.main && scene.mainLabel && (
                  <g aria-hidden="true">
                    <text className={scene.mainLabel.title.cls} x={scene.mainLabel.title.x} y={scene.mainLabel.title.y}>{scene.mainLabel.title.text}</text>
                    {scene.mainLabel.lines.map((l, k) => (
                      <text key={`ml${k}`} className={l.cls} x={l.x} y={l.y}>{l.text}</text>
                    ))}
                  </g>
                )}
              </g>
            ))}
            {costs.length > 0 && (
              <line className="stakan-cost-line" x1={plot.x} x2={plot.right} y1={scene.costY} y2={scene.costY} aria-hidden="true" />
            )}
            {scene.main && scene.costY !== null && (
              <line
                className="stakan-cost-main"
                x1={scene.main.x}
                x2={scene.main.x + scene.main.w}
                y1={scene.costY}
                y2={scene.costY}
                aria-hidden="true"
              />
            )}
            {scene.callouts.map(k => (
              <g key={`k${k.index}`} aria-hidden="true">
                <line className="stakan-leader" x1={k.leader.x1} y1={k.leader.y1} x2={k.leader.x2} y2={k.leader.y2} />
                {k.lines.map((l, n) => <text key={`kl${n}`} className={l.cls} x={l.x} y={l.y}>{l.text}</text>)}
              </g>
            ))}
            <text className="stakan-total" x={plot.right} y={plot.y + 16} textAnchor="end" aria-hidden="true">{scene.totalText}</text>
            {costs.map(c => (
              <g key={`c${c.index}`} {...itemProps(rects.length + c.index)} aria-label={colAria(c)}>
                <rect className="stakan-hit" x={c.x - 4} y={c.top} width={c.w + 8} height={c.bottom - c.top} />
                <rect
                  className={c.total ? 'stakan-col is-total' : 'stakan-col'}
                  x={c.x}
                  y={c.top}
                  width={c.w}
                  height={c.bottom - c.top}
                />
                <rect className="stakan-outline" x={c.x - 3} y={c.top - 3} width={c.w + 6} height={c.bottom - c.top + 3} />
                <g aria-hidden="true">
                  {scene.colLabels[c.index].map((l, n) => (
                    <text key={`cl${n}`} className={l.cls} x={l.x} y={l.y} textAnchor={l.anchor}>{l.text}</text>
                  ))}
                </g>
              </g>
            ))}
            {costs.length > 0 && (
              <g aria-hidden="true">
                <text className="stakan-head" x={stakan.x} y={stakan.headY}>{'Себестоимость, руб. / кг'}</text>
                {costs.map(c => (
                  <text key={`cn${c.index}`} className="stakan-col-name" x={c.cx} y={stakan.bottom + 16} textAnchor="middle">{c.label}</text>
                ))}
                {scene.stakanTicks.map(t => (
                  <text key={`sy${t.value}`} className="stakan-tick" x={stakan.x - 6} y={t.y + 4} textAnchor="end">{t.text}</text>
                ))}
              </g>
            )}
          </svg>
          {tipView && (
            <div className="stakan-tip" aria-hidden="true" style={{left: tipLeft}}>
              {tipIdx === selected && <p className="stakan-tip-flag">Выбрано</p>}
              <p className="stakan-tip-title">{tipView.title}</p>
              <dl>
                {tipView.rows.map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
          )}
        </div>
        {!layout.wide && scene.smalls.length > 0 && (
          <ul className="stakan-small" aria-label="Малые ступени">
            {scene.smalls.map(r => <li key={`sm${r.index}`}>{`${fmtNum(r.price, 2)} руб. / кг: ${fmtNum(r.kg)} кг`}</li>)}
          </ul>
        )}
        <p className="stakan-detail" aria-live="polite">{detailText(selected, count, items, isStep)}</p>
        <div className="stakan-actions">
          <button
            type="button"
            className="secondary stakan-toggle"
            aria-expanded={tablesOpen}
            aria-controls={tablesId}
            onClick={() => setTablesOpen(open => !open)}
          >
            Таблица
          </button>
        </div>
        <div id={tablesId} className="stakan-tables" hidden={!tablesOpen}>
          <div className="stakan-table-wrap">
            <table className="stakan-table">
              <caption>{`Ступени цены, ${lower(periodLabel)}`}</caption>
              <thead>
                <tr>
                  <th scope="col">Диапазон, руб. / кг</th>
                  <th scope="col" className="num">Объем, кг</th>
                  <th scope="col" className="num">Средняя цена, руб. / кг</th>
                  <th scope="col" className="num">Выручка, руб.</th>
                  <th scope="col" className="num">Доля объема</th>
                </tr>
              </thead>
              <tbody>
                {rects.map(r => (
                  <tr key={`tr${r.index}`}>
                    <td>{`${r.from}–${r.to}`}</td>
                    <td className="num">{fmtNum(r.kg)}</td>
                    <td className="num">{fmtNum(r.price, 2)}</td>
                    <td className="num">{fmtNum(r.revenue)}</td>
                    <td className="num">{`${fmtNum(r.share, 1)}%`}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Итог</td>
                  <td className="num">{fmtNum(scene.kgRef)}</td>
                  <td className="num">{fmtNum(scene.avg, 2)}</td>
                  <td className="num">{fmtNum(Math.round(scene.revenueRef))}</td>
                  <td className="num">{`${fmtNum(shareSum, 1)}%`}</td>
                </tr>
              </tbody>
            </table>
            <p className="stakan-foot">Сумма строк округлена, итог из исходных данных.</p>
          </div>
          {costs.length > 0 && (
            <div className="stakan-table-wrap">
              <table className="stakan-table">
                <caption>Себестоимость филе, руб. / кг</caption>
                <thead>
                  <tr>
                    <th scope="col">Статья</th>
                    <th scope="col" className="num">Приращение, руб. / кг</th>
                    <th scope="col" className="num">Накопленный итог, руб. / кг</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map(c => (
                    <tr key={`ct${c.index}`}>
                      <td>{c.label}</td>
                      <td className="num">{c.index === 0 ? fmtNum(c.delta, 2) : `+${fmtNum(c.delta, 2)}`}</td>
                      <td className="num">{fmtNum(c.cum, 2)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Итог себестоимости</td>
                    <td className="num" />
                    <td className="num">{fmtNum(scene.costTotal, 2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
        {costs.length > 0 && (
          <p className="stakan-note">{`${costs[0].label} дает ${fmtNum(costs[0].share)}% себестоимости. Себестоимость филе ${fmtNum(scene.costTotal, 2)} руб. / кг.`}</p>
        )}
        {excludedText && (
          <p className="stakan-note">{`Вне итога себестоимости: ${excludedText}. Статус: Требуется подтверждение.`}</p>
        )}
        <p className="stakan-check">
          {check.ok ? (
            <>
              <span className="stakan-sym ok" aria-hidden="true">●</span> <span>{`В норме: сумма ступеней ${fmtNum(check.kg)} кг совпадает с итогом, выручка в пределах ${fmtNum(check.tolerance)} руб.`}</span>
            </>
          ) : (
            <>
              <span className="stakan-sym warn" aria-hidden="true">▲</span> <span>{check.kgOk
                ? `Внимание: сумма по диапазонам отличается от итога на ${fmtNum(Math.abs(check.revenueDiff), 2)} руб., допуск ${fmtNum(check.tolerance)} руб.`
                : `Внимание: сумма кг по диапазонам отличается от итога на ${fmtNum(Math.abs(check.kgDiff))} кг`}</span>
            </>
          )}
        </p>
        <p className="stakan-source">{`Источник: ${sourceNote}.`}</p>
      </>
    );
  }

  return (
    <figure className="stakan" ref={figRef}>
      <figcaption id={captionId} className="stakan-caption">{caption}</figcaption>
      {body}
    </figure>
  );
}

export default StakanChart;
