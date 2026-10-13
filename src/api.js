export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
let demoPromise;
async function demoModel() {
  demoPromise ||= import('../model.js').then(() => window.PlannerModel);
  return demoPromise;
}
function commercial(client) {
  const net = client.price - client.service, share = client.share / 100;
  return { net, change: client.volume * 1000 * (net * share + 135 * (1 - share) - 180), threshold: net > 135 ? 45 / (net - 135) * 100 : null };
}
export async function api(endpoint, body, { signal } = {}) {
  if (DEMO_MODE) {
    const m = await demoModel();
    switch (endpoint) {
      case 'catalog': return { defaults: m.defaults(), routes: m.routes, products: m.products, units: m.units, version: m.version };
      case 'evaluate': return { result: m.evaluate(body.params), alternatives: m.alternatives(body.params) };
      case 'request': return m.checkRequest(body.params, body.request);
      case 'snapshot': return m.snapshot(body.params, body.confirmations);
      case 'fact': return m.fact(body.snapshot?.params || body.params);
      case 'roi': return m.roi(body.params, body.options);
      case 'commercial': return commercial(body.client);
      default: throw new Error('Запрошенный расчёт требует поддержки сервера');
    }
  }
  const response = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер расчётов вернул ответ другого формата'); }
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(Array.isArray(detail) ? detail.map(x => x.msg).join('; ') : detail || 'Сервер расчётов требует повторного запроса');
  }
  return data;
}
