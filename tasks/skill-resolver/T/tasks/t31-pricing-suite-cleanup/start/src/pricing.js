export function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

export function _clampPercent(pct) {
  return Math.min(100, Math.max(0, pct));
}

export function applyDiscount(price, pct) {
  if (price < 0) throw new RangeError('price must be >= 0');
  const p = Math.min(100, Math.max(0, pct));
  return roundCents(price * (1 - p / 100));
}
