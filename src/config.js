require('./env');
const e = process.env;
const money = (v, d) => Math.round(parseFloat(v ?? d) * 100);
const prod = e.NODE_ENV === 'production';
const cfg = {
  prod,
  port: parseInt(e.PORT || '3000', 10),
  baseUrl: e.BASE_URL || 'http://localhost:3000',
  databaseUrl: e.DATABASE_URL || '',
  dbSsl: (e.DATABASE_SSL ?? 'true') !== 'false',
  dataDir: e.DATA_DIR || './.data/pgdata',
  trustProxy: e.TRUST_PROXY === '1',
  siteName: 'GlobalSport Co.',
  businessName: e.BUSINESS_NAME || 'GlobalSport Co.',
  supportEmail: e.SUPPORT_EMAIL || '',
  privacyEmail: e.PRIVACY_CONTACT_EMAIL || e.SUPPORT_EMAIL || '',
  address: e.BUSINESS_ADDRESS || '',
  phone: e.BUSINESS_PHONE || '',
  regNumber: e.BUSINESS_REG_NUMBER || '',
  discountPct: parseInt(e.DISCOUNT_PCT || '20', 10),
  currencies: ['USD', 'GBP', 'CAD'],
  shipping: {
    USD: { flat: money(e.SHIPPING_FLAT_USD, '9.99'), freeOver: money(e.FREE_SHIPPING_OVER_USD, '150') },
    GBP: { flat: money(e.SHIPPING_FLAT_GBP, '7.99'), freeOver: money(e.FREE_SHIPPING_OVER_GBP, '120') },
    CAD: { flat: money(e.SHIPPING_FLAT_CAD, '12.99'), freeOver: money(e.FREE_SHIPPING_OVER_CAD, '200') },
  },
  anthropicKey: e.ANTHROPIC_API_KEY || '',
  aiModel: e.AI_MODEL || 'claude-haiku-5-5',
  aiDailyLimit: parseInt(e.AI_DAILY_LIMIT || '300', 10),
  analyticsSrc: e.ANALYTICS_SCRIPT_URL || '',
  policyVersion: '2026-10-09',
  pageSize: 24,
};
module.exports = cfg;
