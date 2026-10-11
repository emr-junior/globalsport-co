const config = require('./config');

/** Discounted price in minor units, computed with integer math (half-up). */
function discounted(originalCents, pct = config.discountPct) {
  if (!Number.isInteger(originalCents) || originalCents <= 0) throw new Error('Invalid original price');
  if (!Number.isInteger(pct) || pct < 0 || pct > 90) throw new Error('Invalid discount');
  return Math.floor((originalCents * (100 - pct) + 50) / 100);
}
const SYMBOL_LOCALE = { USD: 'en-US', GBP: 'en-GB', CAD: 'en-CA' };
function fmt(cents, cur = 'USD') {
  const c = config.currencies.includes(cur) ? cur : 'USD';
  const s = new Intl.NumberFormat('en-US', { style: 'currency', currency: c, currencyDisplay: 'symbol' }).format(cents / 100);
  return s; // USD "$", GBP "£", CAD "CA$"
}
function shippingFor(cur, subtotalCents) {
  const s = config.shipping[cur] || config.shipping.USD;
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= s.freeOver ? 0 : s.flat;
}
module.exports = { discounted, fmt, shippingFor, SYMBOL_LOCALE };
