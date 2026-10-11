const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./db');
const sec = require('./security');
const V = require('./views');
const S = require('./services');
const { html, Raw } = require('./html');

let catCache = { at: 0, rows: [] };
async function categories() {
  if (Date.now() - catCache.at > 60000) catCache = { at: Date.now(), rows: await db.many('select id, code, slug, name, description from categories order by position') };
  return catCache.rows;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(sec.securityHeaders);
  app.use((req, res, next) => { // render html`` templates as text/html instead of JSON
    const send = res.send.bind(res);
    res.send = (body) => { if (body instanceof Raw) { if (!res.getHeader('Content-Type')) res.type('html'); return send(body.s); } return send(body); };
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));
  app.get('/healthz', async (req, res) => { await db.one('select 1 ok'); res.json({ ok: true }); });
  app.use(sec.sessionMiddleware);
  const small = express.urlencoded({ extended: false, limit: '100kb' });
  const big = express.urlencoded({ extended: false, limit: '5mb' }); // CSV import only, and only for admins
  app.use((req, res, next) => (req.path === '/admin/products/import' && req.user && req.user.role === 'admin' ? big : small)(req, res, next));
  app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
  app.use(sec.csrfProtect);
  app.use(async (req, res, next) => {
    const cats = await categories();
    req.ctx = { csrf: req.session.csrf, user: req.user, cur: S.currencyOf(req), path: req.originalUrl.split('#')[0], categories: cats, cartCount: 0, q: '' };
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/admin/api/')) req.ctx.cartCount = await S.cartCount(req);
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.use(require('./routes/support'));
  app.use(require('./routes/store'));
  app.use(require('./routes/admin'));
  app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.path.includes('/api/')) return res.status(404).json({ error: 'Not found' });
    res.status(404).send(V.layout(req.ctx || { csrf: '', cur: 'USD', path: '/', categories: [], cartCount: 0, q: '' }, { title: 'Page not found', body: html`<div class="wrap page"><h1>Page not found</h1><p>We could not find that page.</p><a class="btn" href="/">Go to the homepage</a></div>` }));
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).type('text').send('Request too large');
    if (err.type === 'entity.parse.failed') return res.status(400).type('text').send('Bad request');
    console.error('[error]', req.method, req.path, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err);
    if (res.headersSent) return;
    if (req.path.includes('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
    res.status(500).send(V.layout(req.ctx || { csrf: '', cur: 'USD', path: '/', categories: [], cartCount: 0, q: '' }, { title: 'Error', body: html`<div class="wrap page"><h1>Something went wrong</h1><p>Please try again. If the problem continues, contact support.</p></div>` }));
  });
  return app;
}
module.exports = { createApp };
