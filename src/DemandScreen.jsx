import React, {useState} from 'react';
import {usePlanner} from './state.jsx';
import {ActionButton, Field, Hint, ProductPicker} from './ui.jsx';
import {delta, n, prodName} from './format.js';
import './demand-screen.css';

function RequestOutcome() {
  const {S, requestResult: result, busy, error} = usePlanner();
  if (!result) return null;
  const covered = result.covered ?? result.acceptedQuantity;
  const requested = result.requested ?? S.request.quantity;
  const reasons = [...new Set([...(result.errors || []), ...(result.violations || []), ...(result.reasons || [])])];
  const change = result.deltaContribution;
  const canConfirm = result.canApply === true;
  return <div className="ds-outcome" id="request-result" aria-live="polite">
    <h3>{canConfirm ? <>Можно подтвердить <span>{n(covered)} т</span></> : result.duplicate ? 'Заявка уже включена в план' : covered != null ? <>Выпуск покрывает <span>{n(covered)} из {n(requested)} т</span></> : 'Уточните параметры заявки'}</h3>
    {typeof change === 'number' && <div className="ds-money"><span>Изменение к текущему плану</span><strong className={change < 0 ? 'negative' : ''}>{delta(change)} руб.</strong></div>}
    <div className="ds-reason">
      {canConfirm && <p>{result.extraCut > 0 ? <>Потребуется дополнительно разделать {n(result.extraCut)} т сырья</> : result.extraCut < 0 ? <>План уменьшает разделку на {n(Math.abs(result.extraCut))} т и увеличивает выпуск целой тушки</> : <>Текущий выпуск покрывает заявку</>}</p>}
      {result.forecastConsumed > 0 && <p>{n(result.forecastConsumed)} т прогноза перейдут в подтверждённый заказ</p>}
      {result.shortfall > 0 && <p className="negative">Ещё {n(result.shortfall)} т требуют другого срока или изменения плана</p>}
      {reasons.slice(0, 2).map(reason => <p key={reason}>{reason}</p>)}
      {reasons.length > 2 && <p>Расчёт содержит ещё {reasons.length - 2} причины; проверьте условия плана</p>}
    </div>
    <div className="ds-result-actions">
      {canConfirm ? <ActionButton className="primary" action="apply-request" disabled={busy || !!error}>Включить заявку в план</ActionButton> : <ActionButton className="primary" action="check-request" disabled={busy || !!error}>Проверить заявку</ActionButton>}
      <div className="ds-secondary-actions">
        {covered != null && <ActionButton action="request-details">Расчёт и связанные продукты</ActionButton>}
        {!canConfirm && <ActionButton action="levers">Условия производства</ActionButton>}
      </div>
    </div>
  </div>;
}

export function DemandScreen() {
  const {S, M, r, requestResult, busy, error} = usePlanner();
  const [mobileTab, setMobileTab] = useState('balance');
  const product = S.product;
  const allocation = r.allocations?.[product];
  const produced = r.produced?.[product] || 0;
  const orders = allocation?.orders ?? S.p.orders?.[product] ?? 0;
  const forecast = allocation?.forecast ?? Math.max(0, (S.p.demand?.[product] || 0) - orders);
  const orderSold = allocation?.orderSold || 0;
  const forecastSold = allocation?.forecastSold || 0;
  const remaining = allocation?.remaining ?? Math.max(0, produced - orderSold - forecastSold);
  const price = allocation?.price ?? S.p.prices?.[product] ?? 0;
  const width = value => produced > 0 ? Math.max(0, Math.min(100, value / produced * 100)) : 0;
  return <section className="demand-screen" data-mobile-tab={mobileTab}>
    <header className="ds-heading">
      <div><div className="ds-eyebrow">Продажи / текущая неделя</div><h1>Проверьте заявку перед обещанием клиенту</h1></div>
      <ActionButton action="commercial">Условия сделки</ActionButton>
    </header>
    <div className="ds-product-line">
      <ProductPicker all={false}/>
      <div className="ds-plan-price"><span>Цена в плане</span><strong>{n(price)} <small>руб. / кг</small></strong></div>
      <ActionButton action="prices">Изменить спрос и цены</ActionButton>
    </div>
    <div className="ds-mobile-tabs" role="tablist" aria-label="Спрос и проверка заявки">
      <button type="button" role="tab" aria-selected={mobileTab === 'balance'} onClick={() => setMobileTab('balance')}>Выпуск и спрос</button>
      <button type="button" role="tab" aria-selected={mobileTab === 'request'} onClick={() => setMobileTab('request')}>Новая заявка</button>
    </div>
    <div className="ds-workspace">
      <section className="ds-balance" id="demand-chart" aria-label="Выпуск и спрос выбранного продукта">
        <h2>Выпуск и спрос на неделю</h2>
        <div className="ds-output"><span>Выпуск: {prodName(product, M).toLocaleLowerCase('ru-RU')}</span><strong>{n(produced)} <small>т</small></strong></div>
        <div className="ds-allocation-bar" role="img" aria-label={`Выпуск ${n(produced)} т: под заказы ${n(orderSold)} т, под прогноз ${n(forecastSold)} т, свободно ${n(remaining)} т`}>
          <span className="ds-orders" style={{width: `${width(orderSold)}%`}}/>
          <span className="ds-forecast" style={{width: `${width(forecastSold)}%`}}/>
          <span className="ds-free" style={{width: `${width(remaining)}%`}}/>
        </div>
        <table className="ds-demand-table">
          <thead><tr><th>Состав спроса</th><th>Нужно, т</th><th>Есть в выпуске, т</th></tr></thead>
          <tbody>
            <tr><td><i className="ds-orders"/>Подтверждённые заказы</td><td>{n(orders)}</td><td className={orderSold + 1e-8 < orders ? 'negative' : ''}>{n(orderSold)}</td></tr>
            <tr><td><i className="ds-forecast"/>Прогноз будущих заказов</td><td>{n(forecast)}</td><td>{n(forecastSold)}</td></tr>
          </tbody>
        </table>
        <div className="ds-free-line"><span>Свободно сверх заказов и прогноза</span><strong>{n(remaining)} т</strong></div>
        <p className="ds-explanation">{S.request.forecastAbsorption ? 'Новая заявка закрепляет объём прогноза за клиентом. Дополнительный объём проверяется по всем продуктам и мощностям' : 'Новая заявка добавляется к текущему спросу. Расчёт проверяет выпуск всех продуктов и доступные мощности'}</p>
        <div className="ds-source"><Hint text="Заказы и прогноз показаны раздельно. Выпуск и размещение приходят из текущего расчёта; числа относятся к выбранному продукту">Учебные данные / заказы входят в общий спрос</Hint></div>
        <button className="primary ds-mobile-start" type="button" onClick={() => setMobileTab('request')}>Проверить новую заявку</button>
      </section>
      <aside className="ds-request-panel" aria-label="Новая заявка выбранного продукта">
        <div className="ds-request-title"><h2>Новая заявка</h2></div>
        <div className="ds-request-fields">
          <Field label="Объём заявки" scope="request" path="quantity" min={0.1} max={1000} step={0.1} unit="т"/>
          <Field label="Цена продажи" scope="request" path="price" max={2000} step={1} unit="руб. / кг"/>
        </div>
        {S.request.service > 0 && <p className="ds-service">Обслуживание {n(S.request.service)} руб. / кг; после обслуживания {n(S.request.price - S.request.service)} руб. / кг</p>}
        {requestResult ? <RequestOutcome/> : <div className="ds-request-form">
          <p className="ds-form-help">Расчёт покажет, сколько можно подтвердить и как заявка изменит результат всей недели</p>
          <ActionButton className="primary" action="check-request" disabled={busy || !!error}>{busy ? 'Обновляем расчёт' : 'Проверить заявку'}</ActionButton>
          <p className="ds-stage-note">Проверка сохраняет текущий план. Включение заявки выполняется следующим действием</p>
        </div>}
      </aside>
    </div>
  </section>;
}
