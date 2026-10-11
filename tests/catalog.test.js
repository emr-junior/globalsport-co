const test = require('node:test');
const assert = require('node:assert/strict');
const { start, db } = require('./helpers');
const { seed } = require('../scripts/seed');
const { discounted, fmt } = require('../src/pricing');
let app;
test.before(async () => { app = await start(); });
test.after(async () => { await app.close(); });

test('discount math: 20% off, integer cents, half-up', () => {
  assert.equal(discounted(10000, 20), 8000);
  assert.equal(discounted(4999, 20), 3999);
  assert.equal(discounted(1, 20), 1);
  assert.equal(discounted(2499, 20), 1999);
  assert.throws(() => discounted(0)); assert.throws(() => discounted(10.5)); assert.throws(() => discounted(1000, 95));
});
test('currency formatting uses correct symbols', () => {
  assert.equal(fmt(8000, 'USD'), '$80.00'); assert.equal(fmt(8000, 'GBP'), '£80.00'); assert.equal(fmt(8000, 'CAD'), 'CA$80.00');
});
test('database holds at least 2,000 distinct products with unique SKUs', async () => {
  const r = await db.one('select count(*)::int n, count(distinct sku)::int d, count(distinct name)::int dn from products');
  assert.ok(r.d >= 2000, 'distinct SKUs ' + r.d); assert.equal(r.n, r.d);
});
test('every product has USD, GBP and CAD prices and the stored discount equals 20% off', async () => {
  assert.equal((await db.one(`select count(*)::int n from products p where (select count(*) from product_prices x where x.product_id=p.id) <> 3`)).n, 0);
  assert.equal((await db.one(`select count(*)::int n from product_prices pp join products p on p.id=pp.product_id where p.discount_pct <> 20 or pp.discounted_cents <> floor((pp.original_cents*80+50)/100)::int`)).n, 0);
});
test('all 30 sport categories exist, each with products, and their pages load', async () => {
  const cats = await db.many('select c.slug, count(p.id)::int n from categories c left join products p on p.category_id=c.id group by c.slug');
  assert.equal(cats.length, 30); assert.ok(cats.every((c) => c.n >= 60));
  for (const c of cats) { const r = await fetch(app.base + '/c/' + c.slug); assert.equal(r.status, 200, c.slug); }
});
test('seed is idempotent: second run inserts nothing', async () => {
  const before = (await db.one('select count(*)::int n from products')).n;
  const rep = await seed({ log: () => {} });
  assert.equal(rep.inserted, 0); assert.equal(rep.failed, 0); assert.equal((await db.one('select count(*)::int n from products')).n, before);
});
test('listing paginates (24 per page) and does not return the whole catalogue', async () => {
  const t = await (await fetch(app.base + '/search?q=')).text();
  assert.equal((t.match(/<article class="card"/g) || []).length, 24);
  assert.match(t, /2,100 products found/);
});
test('every product card shows the 20% OFF badge and an SKU', async () => {
  const t = await (await fetch(app.base + '/c/tennis')).text();
  const cards = t.match(/<article class="card"/g).length;
  assert.equal((t.match(/>20% OFF</g) || []).length, cards); assert.equal((t.match(/SKU: GS-TEN/g) || []).length, cards);
});
test('filters and sorting work', async () => {
  const t = await (await fetch(app.base + '/c/running?type=Running%20Shoes&sort=price_asc&stock=1&size=UK%208')).text();
  assert.match(t, /Running Shoes/); const prices = [...t.matchAll(/Sale price <\/span>\$([\d,.]+)/g)].map((m) => parseFloat(m[1].replace(',', '')));
  assert.ok(prices.length > 3); assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const cheap = await (await fetch(app.base + '/search?min=10&max=20')).text();
  for (const m of cheap.matchAll(/Sale price <\/span>\$([\d,.]+)/g)) { const v = parseFloat(m[1]); assert.ok(v >= 10 && v <= 20, String(v)); }
});
test('search by SKU, name and sport; suggestions endpoint', async () => {
  assert.match(await (await fetch(app.base + '/search?q=GS-GLF-005')).text(), /SKU: GS-GLF-005/);
  assert.match(await (await fetch(app.base + '/search?q=yoga+mat')).text(), /Yoga Mat/);
  const s = await (await fetch(app.base + '/api/suggest?q=Kettle')).json(); assert.ok(s.length > 0);
});
test('ratings are not shown without genuine reviews', async () => {
  const t = await (await fetch(app.base + '/c/golf')).text(); assert.ok(!t.includes('out of 5'));
});
