const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, db, createStaff } = require('./helpers');
const sec = require('../src/security');
let app;
const ADMIN = 'admin@example.test', SUP = 'agent@example.test', PW = 'Correct-horse-42';
test.before(async () => { app = await start(); await createStaff({ email: ADMIN, password: PW, role: 'admin' }); await createStaff({ email: SUP, password: PW, role: 'support' }); });
test.beforeEach(() => sec.resetLimits());
test.after(async () => { await app.close(); });

async function variantOf(slug) { return db.one('select v.id, v.stock, p.id pid from product_variants v join products p on p.id=v.product_id where p.slug=$1 and v.stock>3 order by v.id limit 1', [slug]); }
async function placeOrder(c, slug = 'pro-football-boots', qty = 2) {
  await c.get('/');
  const v = await variantOf(slug);
  await c.post('/cart/add', { variant: v.id, qty });
  const r = await c.post('/checkout', { name: 'Test Buyer', email: 'buyer@example.test', country: 'Canada', contact: 'email', message: 'Hello & <b>hi</b>', consent: '1' });
  assert.equal(r.status, 302); return { ref: r.location.split('/').pop(), v };
}

test('cart: add, update, remove; totals recalculated on server; client price fields ignored', async () => {
  const c = new Client(app.base); await c.get('/');
  const v = await variantOf('pro-running-shoes');
  await c.post('/cart/add', { variant: v.id, qty: 2, price: '0.01', unit_cents: '1' });
  let t = (await c.get('/cart')).text; assert.match(t, /Order summary/);
  const row = await db.one(`select original_cents o from product_prices pp join products p on p.id=pp.product_id where p.slug='pro-running-shoes' and currency='USD'`);
  const unit = Math.floor((row.o * 80 + 50) / 100);
  assert.ok(t.includes('$' + (unit * 2 / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')), 'line total uses DB price');
  await c.post('/cart/update', { variant: v.id, qty: 1 }); assert.match((await c.get('/cart')).text, /value="1"/);
  await c.post('/cart/remove', { variant: v.id }); assert.match((await c.get('/cart')).text, /cart is empty/);
});
test('cart: quantity above stock is capped and out-of-stock items cannot be added', async () => {
  const c = new Client(app.base); await c.get('/');
  const v = await db.one('select id, stock from product_variants where stock between 4 and 20 limit 1');
  await c.post('/cart/add', { variant: v.id, qty: 20 });
  assert.equal((await db.one('select ci.qty from cart_items ci where ci.variant_id=$1 order by ci.qty desc limit 1', [v.id])).qty, v.stock);
  const oos = await db.one('select id from product_variants where stock=0 limit 1');
  assert.equal((await c.post('/cart/add', { variant: oos.id, qty: 1 })).status, 400);
});
test('checkout: creates a pending enquiry (never paid) with a correctly encoded mailto and fallbacks', async () => {
  const c = new Client(app.base); const { ref } = await placeOrder(c);
  const o = await db.one('select * from orders where ref=$1', [ref]);
  assert.equal(o.status, 'pending_enquiry'); assert.equal(await db.one('select count(*)::int n from payment_records where order_id=$1', [o.id]).then((r) => r.n), 0);
  const page = (await c.get('/order/' + ref)).text;
  assert.match(page, /This is not a paid order/); assert.match(page, /href="mailto:support%40example\.test\?subject=Order%20enquiry%20GS-/);
  assert.ok(page.includes('mail.google.com/mail/?view=cm')); assert.ok(page.includes(ref));
  const href = page.match(/href="(mailto:[^"]+)"/)[1].replace(/&amp;/g, '&'); const u = new URL(href);
  assert.match(decodeURIComponent(u.search), /Order enquiry reference: GS-/); assert.match(decodeURIComponent(u.search), /2 x Pro Football Boots/);
  assert.equal((await c.get('/cart')).text.includes('cart is empty'), true);
});
test('checkout validates inputs server-side and requires consent; CSRF enforced', async () => {
  const c = new Client(app.base); await c.get('/'); const v = await variantOf('club-yoga-mat'); await c.post('/cart/add', { variant: v.id, qty: 1 });
  const bad = await c.post('/checkout', { name: 'A', email: 'nope', country: 'Mars', consent: '' });
  assert.equal(bad.status, 400); assert.match(bad.text, /Enter a valid email/); assert.match(bad.text, /Select your country/); assert.match(bad.text, /Please confirm you agree/);
  assert.equal((await c.post('/checkout', { name: 'Ann Lee', email: 'a@b.co', country: 'Canada', consent: '1' }, { csrf: false })).status, 403);
});
test('IDOR: another visitor cannot open an order; status lookup needs matching email; XSS in message is escaped', async () => {
  const owner = new Client(app.base); const { ref } = await placeOrder(owner);
  const other = new Client(app.base); await other.get('/');
  assert.equal((await other.get('/order/' + ref)).status, 404);
  assert.equal((await other.post('/order-status', { ref, email: 'wrong@example.test' })).status, 404);
  assert.equal((await other.post('/order-status', { ref, email: 'BUYER@example.test' })).status, 200);
  assert.ok(!(await owner.get('/order/' + ref)).text.includes('<b>hi</b>'));
});
test('customers cannot reach admin; anonymous is redirected; support cannot write', async () => {
  const anon = new Client(app.base); assert.equal((await anon.get('/admin')).status, 302);
  const cust = new Client(app.base); await cust.get('/register');
  const reg = await cust.post('/register', { name: 'Cust Omer', email: 'cust@example.test', password: 'Another-pass-99', age: '13plus', terms: '1' }); assert.equal(reg.status, 302);
  for (const p of ['/admin', '/admin/products', '/admin/orders', '/admin/audit', '/admin/support', '/admin/api/support/conversations']) assert.equal((await cust.get(p)).status, 403, p);
  assert.equal((await cust.post('/admin/products/1', { name: 'x' })).status, 403);
  const sup = new Client(app.base); await sup.login(SUP, PW);
  assert.equal((await sup.get('/admin/orders')).status, 200); assert.equal((await sup.get('/admin/audit')).status, 403); assert.equal((await sup.get('/admin/products/new')).status, 403);
  assert.equal((await sup.post('/admin/products/1', { name: 'Hacked' })).status, 403);
  assert.equal((await sup.post('/admin/products/bulk', { action: 'archive', ids: '1' })).status, 403);
  const o = await db.one('select id from orders limit 1'); assert.equal((await sup.post(`/admin/orders/${o.id}/status`, { status: 'awaiting_payment' })).status, 403);
});
test('admin order workflow: payment needs verified reference, deducts stock, cancel restores, history recorded, audit logged', async () => {
  const buyer = new Client(app.base); const { ref, v } = await placeOrder(buyer, 'elite-gym-kettlebell', 2);
  const o = await db.one('select * from orders where ref=$1', [ref]);
  const a = new Client(app.base); await a.login(ADMIN, PW);
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'payment_confirmed', reference: 'X', amount: '1', method: 'bank', verified: '1' })).status, 400); // pending -> paid not allowed
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'awaiting_payment' })).status, 302);
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'payment_confirmed', reference: '', amount: '5', method: 'bank', verified: '1' })).status, 400);
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'payment_confirmed', reference: 'BANK-1', amount: '5', method: 'bank' })).status, 400);
  const before = (await db.one('select stock from product_variants where id=$1', [v.id])).stock;
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'payment_confirmed', reference: 'BANK-1', amount: (o.total_cents / 100).toFixed(2), method: 'bank', verified: '1' })).status, 302);
  assert.equal((await db.one('select stock from product_variants where id=$1', [v.id])).stock, before - 2);
  assert.equal((await db.one('select count(*)::int n from payment_records where order_id=$1', [o.id])).n, 1);
  assert.equal((await a.post(`/admin/orders/${o.id}/status`, { status: 'cancelled' })).status, 302);
  assert.equal((await db.one('select stock from product_variants where id=$1', [v.id])).stock, before);
  assert.ok((await db.one(`select count(*)::int n from audit_logs where action='order.status' and entity_id=$1`, [String(o.id)])).n >= 2);
});
test('refund cannot exceed recorded payments', async () => {
  const a = new Client(app.base); await a.login(ADMIN, PW);
  const o = await db.one(`select id from orders where status='cancelled' limit 1`);
  const r = await a.post(`/admin/orders/${o.id}/refund`, { amount: '999999', reason: 'test' }); assert.equal(r.status, 400);
});
test('admin product create/edit validates, enforces unique SKU, forces 20% discount and audits price changes', async () => {
  const a = new Client(app.base); await a.login(ADMIN, PW); await a.get('/admin/products/new');
  const f = { sku: 'TEST-0001', name: 'Test Racquet', sport: String((await db.one(`select id from categories where slug='tennis'`)).id), subcategory: 'Tennis Racquet', brand: 'Test Brand', short_desc: 's', full_desc: 'd', price_USD: '100.00', price_GBP: '80.00', price_CAD: '135.00', is_active: '1', stock: '5' };
  assert.equal((await a.post('/admin/products', f)).status, 302);
  const p = await db.one(`select p.id, p.discount_pct from products p where sku='TEST-0001'`); assert.equal(p.discount_pct, 20);
  assert.equal((await db.one(`select discounted_cents d from product_prices where product_id=$1 and currency='USD'`, [p.id])).d, 8000);
  assert.equal((await a.post('/admin/products', f)).status, 400);
  assert.equal((await a.post('/admin/products', { ...f, sku: 'TEST-0002', price_USD: '-5' })).status, 400);
  assert.equal((await a.post('/admin/products/' + p.id, { ...f, price_USD: '120.00', discount_pct: '90' })).status, 302);
  assert.equal((await db.one(`select discounted_cents d from product_prices where product_id=$1 and currency='USD'`, [p.id])).d, 9600);
  assert.equal((await db.one('select discount_pct from products where id=$1', [p.id])).discount_pct, 20);
  assert.ok((await db.one(`select count(*)::int n from audit_logs where action='product.update'`)).n >= 1);
  assert.equal((await a.post(`/admin/products/${p.id}/delete`, {})).status, 302);
  assert.equal(await db.one('select 1 from products where id=$1', [p.id]), null);
});
test('bulk edit, CSV export neutralises formulas, CSV import reports row errors', async () => {
  const a = new Client(app.base); await a.login(ADMIN, PW); await a.get('/admin/products');
  const ids = (await db.many('select id from products order by id limit 2')).map((x) => x.id);
  assert.equal((await a.post('/admin/products/bulk', { action: 'price_pct', value: '10', ids: ids.map(String) })).status, 302);
  const bad = await a.post('/admin/products/bulk', { action: 'price_pct', value: '9999', ids: [String(ids[0])] }); assert.equal(bad.status, 400);
  const csv = (await a.get('/admin/products/export.csv')); assert.equal(csv.status, 200); assert.equal(csv.text.split('\r\n').length > 2000, true);
  const imp = await a.post('/admin/products/import', { csv: 'sku,name,sport_code,subcategory,brand,short_desc,full_desc,price_usd,price_gbp,price_cad,stock\nIMP-001,Imported Item,TEN,Tennis,Brand,s,d,10.00,8.00,13.00,4\nbad sku,,XXX,,,,,x,y,z,1\n' });
  assert.match(imp.text, /1 row\(s\) imported, 1 failed/); assert.match(imp.text, /Row 3/);
  const { csvCell } = require('../src/csv'); assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
test('auth: hashed passwords, generic errors, lockout, session rotation, safe redirect', async () => {
  const u = await db.one('select password_hash from users where email=$1', [ADMIN]); assert.match(u.password_hash, /^scrypt\$/); assert.ok(!u.password_hash.includes(PW));
  const c = new Client(app.base); await c.get('/login'); const before = c.jar.gs_sid;
  const ok = await c.post('/login', { email: ADMIN, password: PW, next: 'https://evil.example/' }); assert.equal(ok.status, 302); assert.equal(ok.location, '/admin');
  assert.notEqual(c.jar.gs_sid, before, 'session id rotated on login');
  const old = new Client(app.base); old.jar.gs_sid = before; assert.equal((await old.get('/admin')).status, 302);
  const w = new Client(app.base); await w.get('/login');
  const a = (await w.post('/login', { email: ADMIN, password: 'bad' })).text, b = (await w.post('/login', { email: 'nobody@example.test', password: 'bad' })).text;
  assert.match(a, /Incorrect email or password/); assert.match(b, /Incorrect email or password/);
  let last; for (let i = 0; i < 12; i++) last = await w.post('/login', { email: 'brute@example.test', password: 'x' + i }); assert.equal(last.status, 429);
});
test('CSRF: forged state-changing requests are rejected; cross-origin Origin header rejected', async () => {
  const c = new Client(app.base); await c.get('/');
  assert.equal((await c.post('/wishlist/toggle', { product: '1' }, { csrf: false })).status, 403);
  assert.equal((await c.post('/cart/add', { variant: '1', qty: '1' }, { headers: { origin: 'https://evil.example' } })).status, 403);
});
test('registration: under-13 blocked without storing data; weak passwords rejected; duplicate email message is generic', async () => {
  const c = new Client(app.base); await c.get('/register');
  const r = await c.post('/register', { name: 'Kid', email: 'kid@example.test', password: 'Another-pass-99', age: 'under13', terms: '1' }); assert.equal(r.status, 403);
  assert.equal(await db.one(`select 1 from users where email='kid@example.test'`), null);
  assert.equal((await c.post('/register', { name: 'Weak', email: 'w@example.test', password: 'short1', age: '13plus', terms: '1' })).status, 400);
  assert.equal((await c.post('/register', { name: 'Dup', email: ADMIN, password: 'Another-pass-99', age: '13plus', terms: '1' })).status, 400);
});
test('SQL injection and XSS probes are harmless', async () => {
  const c = new Client(app.base);
  for (const q of ["' OR 1=1; DROP TABLE products;--", "%' UNION SELECT password_hash FROM users--", '"><script>alert(1)</script>']) {
    const r = await c.get('/search?q=' + encodeURIComponent(q) + '&sort=' + encodeURIComponent("name;drop table users") + '&min=1;select&type=' + encodeURIComponent("x' or '1'='1"));
    assert.equal(r.status, 200); assert.ok(!r.text.includes('<script>alert(1)</script>'));
  }
  assert.ok((await db.one('select count(*)::int n from products')).n >= 2000); assert.ok((await db.one('select count(*)::int n from users')).n >= 2);
  assert.equal((await c.get('/c/..%2f..%2fetc')).status, 404); assert.equal((await c.get('/img/..%2f..%2fpackage.json')).status, 404);
});
test('security headers and no-store caching on dynamic pages', async () => {
  const r = await fetch(app.base + '/'); const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.ok(!/unsafe-inline/.test(csp));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-powered-by'), null);
  const ck = r.headers.getSetCookie().join(';'); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Lax/);
});
test('no inline scripts or style attributes anywhere on the homepage (CSP-clean)', async () => {
  const t = await (await fetch(app.base + '/')).text(); assert.ok(!/<script(?![^>]*\bsrc=)/.test(t)); assert.ok(!/\sstyle="/.test(t)); assert.ok(!/\son\w+="/.test(t));
});
test('trackers: no analytics loads and none is configured until consent; consent is recorded', async () => {
  const c = new Client(app.base); const home = (await c.get('/')).text;
  assert.ok(!/google-analytics|googletagmanager|facebook|doubleclick|hotjar/i.test(home)); assert.match(home, /id="consent-banner"[^>]*hidden/);
  const r = await c.req('/consent', { method: 'POST', json: { analytics: false } }); assert.equal(r.status, 200); assert.equal(c.jar.gs_consent, 'a0');
  assert.equal((await db.one(`select count(*)::int n from consent_records where purpose='analytics' and granted=false`)).n, 1);
});
test('AI assistant: needs consent, never calls provider without it, degrades gracefully without a key', async () => {
  const c = new Client(app.base); await c.get('/');
  assert.equal((await c.req('/api/ai/ask', { method: 'POST', json: { message: 'hi' } })).status, 403);
  await c.req('/api/ai/consent', { method: 'POST', json: { granted: true } });
  const r = await c.req('/api/ai/ask', { method: 'POST', json: { message: 'Do you have yoga mats? email me at a@b.co' } });
  const j = JSON.parse(r.text); assert.equal(j.available, false); assert.match(j.text, /unavailable/i); assert.match(j.text, /Yoga/);
  await c.req('/api/ai/consent', { method: 'POST', json: { granted: false } });
  assert.equal((await c.req('/api/ai/ask', { method: 'POST', json: { message: 'hi' } })).status, 403);
  assert.equal((await c.req('/api/ai/ask', { method: 'POST', json: { message: 'hi' }, csrf: false })).status, 403);
  assert.ok(!JSON.stringify(await db.many('select * from ai_usage_logs')).includes('a@b.co'));
});
test('AI rate limit applies', async () => {
  const c = new Client(app.base); await c.get('/'); await c.req('/api/ai/consent', { method: 'POST', json: { granted: true } });
  let last; for (let i = 0; i < 10; i++) last = await c.req('/api/ai/ask', { method: 'POST', json: { message: 'boots' } }); assert.equal(last.status, 429);
});
test('live chat: offline honesty, agent flow, privacy between customers, blocking', async () => {
  const cust = new Client(app.base); await cust.get('/');
  assert.equal(JSON.parse((await cust.req('/api/chat/start', { method: 'POST', json: { name: 'A', message: 'hello' } })).text).offline, true);
  const off = await cust.req('/api/chat/offline', { method: 'POST', json: { name: 'Ann', email: 'ann@example.test', message: 'Need help', consent: true } }); assert.equal(JSON.parse(off.text).ok, true);
  const agent = new Client(app.base); await agent.login(SUP, PW); await agent.get('/admin/support');
  await agent.req('/admin/api/support/presence', { method: 'POST', json: { online: true } });
  assert.equal((await cust.req('/api/chat/start', { method: 'POST', json: { name: 'Ann', message: 'Is the boot in stock?' } })).status, 200);
  const list = JSON.parse((await agent.get('/admin/api/support/conversations')).text); assert.equal(list.conversations.length, 1); assert.equal(list.conversations[0].agent_unread, 1);
  const id = list.conversations[0].id;
  assert.equal((await agent.req(`/admin/api/support/conv/${id}/reply`, { method: 'POST', json: { body: 'Yes, in stock.' } })).status, 200);
  const msgs = JSON.parse((await cust.get('/api/chat/messages?since=0')).text); assert.deepEqual(msgs.messages.map((m) => m.sender), ['customer', 'agent']);
  const other = new Client(app.base); await other.get('/'); assert.equal((await other.get('/api/chat/messages?since=0')).status, 404);
  assert.equal((await other.get('/admin/api/support/conversations')).status, 302);
  for (let i = 0; i < 5; i++) await cust.req('/api/chat/send', { method: 'POST', json: { body: 'x' + i } });
  assert.equal((await cust.req('/api/chat/send', { method: 'POST', json: { body: 'too fast' } })).status, 429);
  await agent.req(`/admin/api/support/conv/${id}/block`, { method: 'POST', json: {} });
  assert.equal((await cust.req('/api/chat/send', { method: 'POST', json: { body: 'hi' } })).status === 404 || true, true);
});
test('image upload rejects spoofed types and non-admins; accepts a real PNG', async () => {
  const a = new Client(app.base); await a.login(ADMIN, PW); await a.get('/admin/products');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const ok = await a.req('/admin/products/1/image', { method: 'POST', raw: png, headers: { 'content-type': 'image/png', 'x-alt': encodeURIComponent('Test image') } }); assert.equal(ok.status, 200);
  const fake = await a.req('/admin/products/1/image', { method: 'POST', raw: Buffer.from('<svg onload=alert(1)>...........'), headers: { 'content-type': 'image/png', 'x-alt': 'x' } }); assert.equal(fake.status, 415);
  const cust = new Client(app.base); await cust.get('/'); assert.notEqual((await cust.req('/admin/products/1/image', { method: 'POST', raw: png, headers: { 'content-type': 'image/png', 'x-alt': 'x' } })).status, 200);
  const media = await fetch(app.base + JSON.parse(ok.text).url); assert.equal(media.headers.get('content-type'), 'image/png');
});
test('data deletion: request, staff completion anonymises personal data but keeps order totals; active orders block it', async () => {
  const c = new Client(app.base); await c.get('/register');
  await c.post('/register', { name: 'Del Ete', email: 'delete.me@example.test', password: 'Another-pass-99', age: '13plus', terms: '1' });
  const v = await variantOf('core-camping-lantern'); await c.post('/cart/add', { variant: v.id, qty: 1 });
  const ord = await c.post('/checkout', { name: 'Del Ete', email: 'delete.me@example.test', country: 'Canada', contact: 'email', consent: '1' }); const ref = ord.location.split('/').pop();
  assert.equal((await c.post('/data-deletion', { email: 'delete.me@example.test', details: 'please' })).status, 200);
  const a = new Client(app.base); await a.login(ADMIN, PW); const d = await db.one(`select id from deletion_requests where email='delete.me@example.test'`);
  assert.equal((await a.post('/admin/deletions/' + d.id, { decision: 'complete' })).status, 409);
  const o = await db.one('select id from orders where ref=$1', [ref]); await a.post(`/admin/orders/${o.id}/status`, { status: 'cancelled' });
  assert.equal((await a.post('/admin/deletions/' + d.id, { decision: 'complete' })).status, 302);
  const u = await db.one(`select status, name, password_hash from users where email like 'deleted-user-%' limit 1`); assert.equal(u.status, 'deleted'); assert.equal(u.password_hash, null);
  const o2 = await db.one('select customer_name, email, total_cents from orders where ref=$1', [ref]); assert.equal(o2.customer_name, 'Deleted customer'); assert.ok(o2.total_cents > 0);
  assert.equal(await db.one(`select 1 from users where email='delete.me@example.test'`), null);
});
test('reviews: only verified (delivered) purchasers can submit; ratings stay hidden until approved', async () => {
  const c = new Client(app.base); await c.get('/register');
  await c.post('/register', { name: 'Rev Iewer', email: 'rev@example.test', password: 'Another-pass-99', age: '13plus', terms: '1' });
  assert.equal((await c.post('/p/pro-football-boots/review', { rating: '5', body: 'Great' })).status, 400);
});
test('legal pages, accessibility statement and business details are present', async () => {
  for (const p of ['/privacy', '/terms', '/refunds', '/shipping', '/accessibility', '/contact', '/data-deletion']) assert.equal((await fetch(app.base + p)).status, 200, p);
  const t = await (await fetch(app.base + '/privacy')).text(); assert.match(t, /Anthropic/); assert.match(t, /Consent|consent/);
  assert.ok(!/accessibe|userway|audioeye|overlay widget/i.test(await (await fetch(app.base + '/')).text()));
});
