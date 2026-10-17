// Зеркало backend/commercial_offer.py: net_price. Порядок статей и сложения совпадает с Python.
const CONFIRMED = 'Подтверждено';
const OPEN = 'Требуется подтверждение';
const isNum = value => typeof value === 'number' && Number.isFinite(value);

function item(key, label, value) {
  const ok = isNum(value);
  return { key, label, rubKg: ok ? value : null, status: ok ? 'confirmed' : 'requires_confirmation', statusLabel: ok ? CONFIRMED : OPEN };
}

function confirmedTax(tax) {
  return !!tax && isNum(tax.deductionRubKg) && typeof tax.confirmedBy === 'string' && tax.confirmedBy.trim() !== '';
}

export function netPrice(offer) {
  const price = offer?.priceRubKg ?? null, discount = offer?.discountPct ?? null;
  const bonus = offer?.bonusRubKg ?? null, logistics = offer?.logisticsRubKg ?? null, returns = offer?.returnsPct ?? null;
  const days = offer?.deferralDays ?? null, tax = offer?.taxBasis ?? null;
  const priced = isNum(price) && isNum(discount);
  const afterDiscount = priced ? price * (1 - discount / 100) : null;
  const components = [
    item('price', 'Предлагаемая цена', isNum(price) ? price : null),
    item('discount', 'Скидка', priced ? -price * discount / 100 : null),
    item('bonus', 'Бонус', isNum(bonus) ? -bonus : null),
    item('logistics', 'Логистика', isNum(logistics) ? -logistics : null),
    item('returns', 'Возвраты', isNum(afterDiscount) && isNum(returns) ? -afterDiscount * returns / 100 : null),
    item('deferral', 'Отсрочка', days === 0 ? 0 : null),
    item('tax', 'Налоговая основа', confirmedTax(tax) ? -tax.deductionRubKg : null),
  ];
  const complete = components.every(c => c.rubKg !== null);
  const confirmedRubKg = components.reduce((sum, c) => (c.rubKg === null ? sum : sum + c.rubKg), 0);
  const netRubKg = complete ? components.reduce((sum, c) => sum + c.rubKg, 0) : null;
  return { netRubKg, confirmedRubKg, complete, components };
}
