process.env.DATA_DIR = 'memory';
process.env.SUPPORT_EMAIL = 'support@example.test';
process.env.NODE_ENV = 'test';
const db = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { seed } = require('../scripts/seed');
const { createApp } = require('../src/app');
const { createStaff } = require('../scripts/create-staff');

async function start({ seedCatalog = true } = {}) {
  await migrate(() => {});
  if (seedCatalog) await seed({ log: () => {} });
  const server = await new Promise((r) => { const s = createApp().listen(0, () => r(s)); });
  return { base: 'http://localhost:' + server.address().port, close: async () => { server.close(); await db.close(); } };
}
class Client {
  constructor(base) { this.base = base; this.jar = {}; this.csrf = ''; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(path, { method = 'GET', form, json, raw, headers = {}, csrf = true } = {}) {
    const h = { cookie: this.cookieHeader(), ...headers };
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(csrf ? { _csrf: this.csrf, ...form } : form).toString(); }
    else if (json) { h['content-type'] = 'application/json'; if (csrf) h['x-csrf-token'] = this.csrf; body = JSON.stringify(json); }
    else if (raw) { if (csrf) h['x-csrf-token'] = this.csrf; body = raw; }
    else if (method !== 'GET' && csrf) h['x-csrf-token'] = this.csrf;
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (c.includes('Max-Age=0')) delete this.jar[k]; else this.jar[k] = v; }
    const text = await res.text();
    if (method === 'POST' && !this._refreshing && this.jar.gs_sid !== h.cookie.match(/gs_sid=([^;]*)/)?.[1]) { this._refreshing = true; await this.req('/'); this._refreshing = false; }
    const m = text.match(/<meta name="csrf-token" content="([^"]+)"/); if (m) this.csrf = m[1];
    return { status: res.status, text, headers: res.headers, location: res.headers.get('location') };
  }
  get(p) { return this.req(p); }
  post(p, form, opts = {}) { return this.req(p, { method: 'POST', form, ...opts }); }
  async login(email, password) { await this.get('/login'); return this.post('/login', { email, password }); }
}
module.exports = { start, Client, db, createStaff };
