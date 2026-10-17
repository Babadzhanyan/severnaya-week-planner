// Сценарий (Д02, Д11): ключ, состав сохранения, миграция черновика и гипотезы в браузере.
// Ключ совпадает с backend/scenario_key.py: отсортированные ключи, разделители «,» и «:», символы не экранируются.
// Паритет проверяет scenario_key_golden.json (L7).
export const DRAFT_KEY = 'severnaya-planner-react-v4';
export const DRAFT_SCHEMA = 4;
const HYPOTHESES_KEY = 'severnaya-planner-hypotheses';
const KEY_FIELDS = ['client', 'dataEdition', 'day', 'packing', 'paramsVersion', 'product', 'scheme', 'zone'];
const CLIENT_ALIAS = /^К-\d{3,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Ключ сценария: поля в порядке сортировки, отсутствующее значение – null.
export function scenarioKey(fields) {
  const client = fields.client ?? null, day = fields.day ?? null;
  if (client !== null && !CLIENT_ALIAS.test(client)) throw new Error('Клиент указывается псевдонимом К-###');
  if (day !== null && !DAY.test(day)) throw new Error('День указывается датой ГГГГ-ММ-ДД');
  const sorted = {};
  for (const name of KEY_FIELDS) sorted[name] = fields[name] ?? null;
  return JSON.stringify(sorted);
}

// Канонический JSON: ключи отсортированы на всех уровнях, пустые значения не выводятся.
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// Версия параметров: sha256 канонического JSON. Требует защищенного контекста браузера (crypto.subtle).
export async function paramsVersion(params) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(params)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Состав сохранения: ключ, название и четыре раздела содержимого (условия, заявка, ROI, коммерция).
export function toSavePayload(state) {
  const sc = state.scenario || {};
  return {
    keyFields: {
      dataEdition: sc.dataEdition ?? null, product: state.product ?? null, day: sc.day ?? null, zone: sc.zone ?? null,
      packing: sc.packing ?? null, client: sc.client ?? null, scheme: state.p.route, paramsVersion: sc.paramsVersion ?? null,
    },
    name: sc.name ?? '',
    content: {params: structuredClone(state.p), request: structuredClone(state.request), roi: structuredClone(state.roi), commercial: structuredClone(state.client)},
  };
}

// Состояние сценария из сохраненного содержимого. Схема route сверяется с ключом, иначе сценарий не открывается.
export function fromSavePayload(payload) {
  const kf = payload.keyFields || {}, c = payload.content || {};
  if (!c.params || kf.scheme !== c.params.route) throw new Error('Схема разделки не совпадает с ключом сценария');
  return {
    p: c.params, request: c.request, roi: c.roi, client: c.commercial, product: kf.product,
    scenario: {dataEdition: kf.dataEdition ?? null, day: kf.day ?? null, zone: kf.zone ?? null, packing: kf.packing ?? null,
      client: kf.client ?? null, paramsVersion: kf.paramsVersion ?? null, name: payload.name ?? '', baseRevision: null},
  };
}

// Миграция черновика: схема 4 сохраняется как есть; схема 3 переносится с перечнем сброшенных оснований.
export function migrateDraft(draft) {
  const changedBasis = [];
  if (!draft || typeof draft !== 'object' || !draft.state?.p || typeof draft.state.p !== 'object') return {state: null, changedBasis};
  if (draft.schema === DRAFT_SCHEMA) return {state: draft.state, changedBasis};
  if (draft.schema === 3) {
    changedBasis.push('Утверждение версии', 'Подтверждения участников');
    return {state: {...draft.state, approved: null, confirms: {commercial: false, production: false, finance: false}}, changedBasis};
  }
  return {state: null, changedBasis};
}

// Гипотезы в браузере: резервный вариант, когда сервер сценариев не подключен. Записи – только для этого браузера.
export function readBrowserHypotheses() {
  try {
    const list = JSON.parse(localStorage.getItem(HYPOTHESES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
export function saveBrowserHypothesis(entry) {
  const list = [entry, ...readBrowserHypotheses().filter(item => item.key !== entry.key)].slice(0, 50);
  try { localStorage.setItem(HYPOTHESES_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
