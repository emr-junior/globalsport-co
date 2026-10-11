const config = require('./config');
const db = require('./db');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('./app');

(async () => {
  await migrate();
  const n = (await db.one('select count(*)::int n from products')).n;
  if (n === 0) console.log('No products yet. Run "npm run seed" to load the 2,000+ sample products.');
  if (config.prod && !config.supportEmail) console.warn('WARNING: SUPPORT_EMAIL is not set; checkout will not be able to prefill the support email.');
  setInterval(() => db.query('delete from sessions where expires_at < now()').catch(() => {}), 3600000).unref();
  const app = createApp();
  app.listen(config.port, () => console.log(`${config.siteName} listening on ${config.baseUrl} (port ${config.port})`));
})().catch((e) => { console.error(e); process.exit(1); });
