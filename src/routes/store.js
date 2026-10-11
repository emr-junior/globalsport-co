const express = require('express');
const db = require('../db');
const config = require('../config');
const S = require('../services');
const V = require('../views');
const { html, raw, esc } = require('../html');
const sec = require('../security');
const { fmt } = require('../pricing');
const legal = require('../legal');

const r = express.Router();
const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const page = (ctx, title, inner, description) => V.layout(ctx, { title, description, body: html`<div class="wrap page">${inner}</div>` });

// ---------- images (generated illustrations; clearly not photographs) ----------
const PALETTE = ['#0B2545', '#13315C', '#134074', '#1B4332', '#7A1F1F', '#3D2C8D', '#5C3D2E', '#264653'];
r.get('/img/:sku.svg', async (req, res) => {
  const sku = req.params.sku;
  if (!/^GS-[A-Z]{3}-\d{5}$/.test(sku)) return res.status(404).end();
  const p = await db.one('select p.name, p.subcategory, c.name sport from products p join categories c on c.id=p.category_id where p.sku=$1', [sku]);
  if (!p) return res.status(404).end();
  let h = 0; for (const ch of sku) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c1 = PALETTE[h % PALETTE.length]; const c2 = PALETTE[(h >> 3) % PALETTE.length];
  const shape = h % 3 === 0 ? `<circle cx="200" cy="130" r="62" fill="rgba(255,255,255,.18)"/>` : h % 3 === 1 ? `<rect x="140" y="70" width="120" height="120" rx="18" fill="rgba(255,255,255,.18)" transform="rotate(12 200 130)"/>` : `<polygon points="200,60 265,190 135,190" fill="rgba(255,255,255,.18)"/>`;
  const words = p.name.split(' '); const mid = Math.ceil(words.length / 2);
  const l1 = esc(words.slice(0, mid).join(' ')); const l2 = esc(words.slice(mid).join(' '));
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" role="img"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/>${shape}<text x="200" y="225" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#fff">${l1}</text><text x="200" y="250" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#fff">${l2}</text>
<text x="12" y="22" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#fff">${esc(p.sport)}</text><text x="388" y="290" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#fff">Illustrative sample image</text></svg>`);
});
r.get('/media/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).end();
  const u = await db.one('select mime, data from uploads where id=$1', [+req.params.id]);
  if (!u) return res.status(404).end();
  res.type(u.mime).set('Cache-Control', 'public, max-age=86400').set('Content-Disposition', 'inline').send(Buffer.from(u.data));
});

// ---------- home ----------
r.get('/', async (req, res) => {
  const { ctx } = req; const cur = ctx.cur;
  const wished = new Set(await S.wishlistIds(req));
  const [featured, newest, hasSales] = await Promise.all([
    S.listProducts({ featured: true, sort: 'newest' }, cur, 1, 8),
    S.listProducts({ sort: 'newest' }, cur, 1, 8),
    db.one(`select count(*)::int n from orders where status in ('payment_confirmed','processing','shipped','delivered')`),
  ]);
  const best = hasSales.n > 0 ? await S.listProducts({ sort: 'popular' }, cur, 1, 8) : null;
  const recent = (req.session.recent || '').split(',').map(Number).filter(Boolean).slice(0, 6);
  const recentProducts = await S.byIds(recent, cur);
  const counts = await db.many(`select c.slug, c.name, count(p.id)::int n from categories c left join products p on p.category_id=c.id and p.is_active group by c.id order by c.position`);
  const recs = recentProducts.length ? (await S.listProducts({ sport: recentProducts[0].sport_slug, sort: 'name' }, cur, 1, 8)).rows.filter((p) => !recent.includes(p.id)).slice(0, 4) : [];
  const campaigns = require('../../config/campaigns.json');
  const grid = (rows) => html`<ul class="grid" role="list">${rows.map((p) => html`<li>${V.productCard(ctx, p, wished.has(p.id))}</li>`)}</ul>`;
  res.send(V.layout(ctx, { description: 'GlobalSport Co. - sporting goods for football, basketball, tennis, running and 26 more sports.', body: html`
  <section class="hero" aria-labelledby="hero-h"><div class="wrap hero-grid"><div>
    <h1 id="hero-h">Gear up for every sport.</h1>
    <p class="lead">Browse sporting goods across 30 sport categories. Every listed product is priced <strong>20% off</strong> its list price.</p>
    <p><a class="btn btn-lg" href="/c/running">Shop running</a> <a class="btn btn-lg btn-secondary" href="/search?q=">Browse all products</a></p>
    <p class="small hero-note">Orders are placed as an enquiry; our team contacts you to arrange payment. <a href="/shipping">How ordering works</a></p></div>
    <img class="hero-art" src="/img/GS-RUN-00001.svg" alt="" width="400" height="300"></div></section>
  <div class="wrap">
  <section aria-labelledby="sports-h" class="section"><h2 id="sports-h">Popular sports</h2>
    <ul class="chips" role="list">${counts.map((c) => html`<li><a href="/c/${c.slug}">${c.name} <span class="count">(${c.n})</span></a></li>`)}</ul></section>
  <section aria-labelledby="camp-h" class="section"><h2 id="camp-h">Campaigns</h2>
    <ul class="campaigns" role="list">${campaigns.map((c) => html`<li><h3>${c.title}</h3><p>${c.text}</p><a class="btn btn-secondary" href="${c.href}">${c.cta}</a></li>`)}</ul></section>
  <section aria-labelledby="feat-h" class="section"><h2 id="feat-h">Featured products</h2>${grid(featured.rows)}</section>
  ${best ? html`<section aria-labelledby="best-h" class="section"><h2 id="best-h">Best sellers</h2>${grid(best.rows)}</section>` : ''}
  <section aria-labelledby="new-h" class="section"><h2 id="new-h">Recently added</h2>${grid(newest.rows)}</section>
  <section aria-labelledby="sale-h" class="section"><h2 id="sale-h">Products on sale</h2><p>All products currently carry 20% off. <a href="/search?sort=price_asc">Browse lowest prices first</a>.</p></section>
  ${recs.length ? html`<section aria-labelledby="rec-h" class="section"><h2 id="rec-h">Recommended for you</h2><p class="small">Based on products you recently viewed in this browser session.</p>${grid(recs)}</section>` : ''}
  ${recentProducts.length ? html`<section aria-labelledby="rv-h" class="section"><h2 id="rv-h">Recently viewed</h2>${grid(recentProducts)}</section>` : ''}
  <section class="section support-cta" aria-labelledby="sup-h"><h2 id="sup-h">Need help choosing?</h2><p>Ask our AI assistant (AI-generated answers; it may make mistakes) or chat with our support team when an agent is online.</p></section>
  </div>`}));
});

// ---------- listings ----------
function listingQuery(req) {
  const q = req.query;
  const sort = Object.keys({ price_asc: 1, price_desc: 1, popular: 1, newest: 1, name: 1 }).includes(q.sort) ? q.sort : 'newest';
  return {
    q: str(q.q, 80), sport: str(q.sport, 60) || undefined, type: str(q.type) || undefined, brand: str(q.brand) || undefined,
    min: num(q.min), max: num(q.max), size: str(q.size, 20) || undefined, color: str(q.color, 30) || undefined,
    inStock: q.stock === '1', minRating: num(q.rating) >= 1 ? Math.min(5, num(q.rating)) : undefined, sort,
    page: Math.max(1, parseInt(q.page, 10) || 1),
  };
}
function filterPanel(ctx, f, facets, action, hasSportFilter) {
  return html`<form class="filters" method="get" action="${action}" aria-label="Filter and sort products">
    ${f.q ? html`<input type="hidden" name="q" value="${f.q}">` : ''}
    ${hasSportFilter ? V.field({ id: 'f-sport', name: 'sport', label: 'Sport', type: 'select', value: f.sport || '', options: [['', 'All sports'], ...ctx.categories.map((c) => [c.slug, c.name])] }) : ''}
    ${V.field({ id: 'f-type', name: 'type', label: 'Product type', type: 'select', value: f.type || '', options: [['', 'Any'], ...facets.types.map((v) => [v, v])] })}
    ${V.field({ id: 'f-brand', name: 'brand', label: 'Brand', type: 'select', value: f.brand || '', options: [['', 'Any'], ...facets.brands.map((v) => [v, v])] })}
    <div class="two"><div>${V.field({ id: 'f-min', name: 'min', label: `Min price (${ctx.cur})`, type: 'number', value: Number.isFinite(f.min) ? f.min : '' })}</div><div>${V.field({ id: 'f-max', name: 'max', label: `Max price (${ctx.cur})`, type: 'number', value: Number.isFinite(f.max) ? f.max : '' })}</div></div>
    ${V.field({ id: 'f-size', name: 'size', label: 'Size', type: 'select', value: f.size || '', options: [['', 'Any'], ...facets.sizes.map((v) => [v, v])] })}
    ${V.field({ id: 'f-color', name: 'color', label: 'Colour', type: 'select', value: f.color || '', options: [['', 'Any'], ...facets.colors.map((v) => [v, v])] })}
    ${V.field({ id: 'f-stock', name: 'stock', label: 'In stock only', type: 'checkbox', checked: f.inStock })}
    ${V.field({ id: 'f-rating', name: 'rating', label: 'Minimum customer rating', type: 'select', value: f.minRating || '', hint: 'Only products with genuine approved reviews have ratings.', options: [['', 'Any'], ['4', '4 stars and up'], ['3', '3 stars and up']] })}
    ${V.field({ id: 'f-sort', name: 'sort', label: 'Sort by', type: 'select', value: f.sort, options: [['newest', 'Newest arrivals'], ['popular', 'Popularity (confirmed sales)'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name A-Z']] })}
    <button class="btn" type="submit">Apply</button> <a class="btn btn-secondary" href="${action}${f.q ? '?q=' + encodeURIComponent(f.q) : ''}">Reset</a></form>`;
}
async function renderListing(req, res, { title, intro, action, sportSlug, searching }) {
  const { ctx } = req; const f = listingQuery(req);
  if (sportSlug) f.sport = sportSlug;
  const [data, facets, wished] = await Promise.all([S.listProducts(f, ctx.cur, f.page), S.facets(f.sport), S.wishlistIds(req)]);
  const w = new Set(wished);
  const keep = { ...req.query }; delete keep.page;
  const url = (n) => action + '?' + new URLSearchParams({ ...keep, page: n }).toString();
  ctx.q = f.q;
  res.send(V.layout(ctx, { title, body: html`<div class="wrap page"><nav aria-label="Breadcrumb" class="crumbs"><a href="/">Home</a> / <span aria-current="page">${title}</span></nav>
    <h1>${title}</h1>${intro ? html`<p class="lead">${intro}</p>` : ''}
    <div class="listing"><aside aria-label="Filters"><details class="filter-toggle" open><summary>Filters &amp; sorting</summary>${filterPanel(ctx, f, facets, action, searching)}</details></aside>
    <section aria-label="Products"><p role="status" class="result-count">${data.total.toLocaleString('en-US')} product${data.total === 1 ? '' : 's'} found. Page ${data.page} of ${data.pages}.</p>
      ${data.rows.length ? html`<ul class="grid" role="list">${data.rows.map((p) => html`<li>${V.productCard(ctx, p, w.has(p.id))}</li>`)}</ul>` : html`<div class="empty"><h2>No products match</h2><p>Try removing a filter or searching for something else.</p></div>`}
      ${V.pagination(data.page, data.pages, url)}</section></div></div>` }));
}
r.get('/c/:slug', async (req, res, next) => {
  const c = req.ctx.categories.find((x) => x.slug === req.params.slug);
  if (!c) return next();
  await renderListing(req, res, { title: c.name, intro: c.description, action: '/c/' + c.slug, sportSlug: c.slug });
});
r.get('/search', sec.limiter('search', 120, 60000), (req, res) => renderListing(req, res, { title: req.query.q ? `Search results for "${str(req.query.q, 80)}"` : 'All products', action: '/search', searching: true }));
r.get('/api/suggest', sec.limiter('suggest', 120, 60000), async (req, res) => res.json((await S.suggest(str(req.query.q, 60))).map((x) => ({ name: x.name, slug: x.slug, sku: x.sku }))));

// ---------- product ----------
r.get('/p/:slug', async (req, res, next) => {
  const { ctx } = req;
  const p = await S.getProduct(req.params.slug, ctx.cur);
  if (!p) return next();
  const rec = (req.session.recent || '').split(',').filter(Boolean);
  const nr = [String(p.id), ...rec.filter((x) => x !== String(p.id))].slice(0, 8).join(',');
  await db.query('update sessions set recent=$2 where token_hash=$1', [req.session.token_hash, nr]);
  const related = (await S.listProducts({ sport: p.sport_slug, type: p.subcategory, sort: 'name' }, ctx.cur, 1, 5)).rows.filter((x) => x.id !== p.id).slice(0, 4);
  const wished = new Set(await S.wishlistIds(req));
  const sizes = [...new Set(p.variants.map((v) => v.size).filter(Boolean))];
  const colors = [...new Set(p.variants.map((v) => v.color).filter(Boolean))];
  const canReview = ctx.user ? !!(await db.one(`select 1 from order_items oi join orders o on o.id=oi.order_id where o.user_id=$1 and oi.product_id=$2 and o.status='delivered' limit 1`, [ctx.user.id, p.id])) : false;
  ctx.recentRaw = nr;
  res.send(V.layout(ctx, { title: p.name, description: p.short_desc, body: html`<div class="wrap page">
   <nav aria-label="Breadcrumb" class="crumbs"><a href="/">Home</a> / <a href="/c/${p.sport_slug}">${p.sport}</a> / <span aria-current="page">${p.name}</span></nav>
   <div class="pdp"><div class="pdp-gallery">${p.images.map((im, i) => html`<img src="${im.url}" alt="${im.alt}" width="400" height="300" ${i ? raw('loading="lazy"') : ''}>`)}</div>
    <div class="pdp-info"><h1>${p.name}</h1><p class="sku">SKU: ${p.sku} · Brand: ${p.brand}</p>
      ${V.priceBlock(ctx.cur, p, true)}
      <p class="small">The ${p.discount_pct}% OFF is a promotional discount from the list price shown. It is not a claim about a previous selling price.</p>
      ${p.review_count ? html`<p class="rating"><span aria-hidden="true">★</span> ${p.avg_rating} out of 5 from ${p.review_count} verified-purchase review${p.review_count === 1 ? '' : 's'}</p>` : ''}
      <p>${V.stockLabel(p.stock)}</p><p>${p.short_desc}</p>
      <form method="post" action="/cart/add" class="stack">${V.csrfInput(ctx)}
        ${sizes.length || colors.length ? html`<div class="field"><label for="variant">Choose size and colour</label><select id="variant" name="variant" required>
           ${p.variants.map((v) => html`<option value="${v.id}" ${v.stock <= 0 ? raw('disabled') : ''}>${[v.size, v.color].filter(Boolean).join(' / ')}${v.stock <= 0 ? ' - out of stock' : ''}</option>`)}</select></div>`
          : html`<input type="hidden" name="variant" value="${p.variants[0]?.id}">`}
        ${V.field({ id: 'qty', label: 'Quantity', type: 'number', value: 1 })}
        <div class="card-actions"><button class="btn btn-lg" type="submit" ${p.stock <= 0 ? raw('disabled aria-disabled="true"') : ''}>Add to cart</button></div></form>
      <form method="post" action="/wishlist/toggle" class="inline">${V.csrfInput(ctx)}<input type="hidden" name="product" value="${p.id}"><input type="hidden" name="next" value="${ctx.path}"><button class="btn btn-secondary" type="submit" aria-pressed="${wished.has(p.id)}">${wished.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'}</button></form>
      <h2>Delivery &amp; returns</h2><p>Delivery cost and timing are confirmed by our support team when they contact you about your order enquiry. See <a href="/shipping">shipping</a> and the <a href="/refunds">refund policy</a>.</p></div></div>
   <section class="section" aria-labelledby="desc-h"><h2 id="desc-h">Description</h2><p>${p.full_desc}</p>${p.is_sample ? html`<p class="alert alert-info">This is a <strong>sample listing</strong> used for demonstration. Specifications are limited to the details below.</p>` : ''}</section>
   <section class="section" aria-labelledby="spec-h"><h2 id="spec-h">Specifications</h2><table class="table"><caption class="visually-hidden">Specifications for ${p.name}</caption><tbody>
     ${Object.entries(p.specs || {}).map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}${p.weight_g ? html`<tr><th scope="row">Weight</th><td>${p.weight_g} g</td></tr>` : ''}${p.dimensions ? html`<tr><th scope="row">Dimensions</th><td>${p.dimensions}</td></tr>` : ''}</tbody></table></section>
   <section class="section" aria-labelledby="rev-h"><h2 id="rev-h">Customer reviews</h2>
     ${p.reviews.length ? html`<ul class="reviews" role="list">${p.reviews.map((rv) => html`<li><p><strong>${rv.rating} out of 5</strong> · ${rv.name.split(' ')[0]}</p><p>${rv.body}</p></li>`)}</ul>` : html`<p>No reviews yet. Only customers with a delivered order can leave a review.</p>`}
     ${canReview ? html`<form method="post" action="/p/${p.slug}/review" class="stack narrow"><h3>Write a review</h3>${V.csrfInput(ctx)}${V.field({ id: 'rating', label: 'Rating', type: 'select', value: '5', options: [['5', '5 - Excellent'], ['4', '4'], ['3', '3'], ['2', '2'], ['1', '1 - Poor']] })}${V.field({ id: 'body', label: 'Your review', type: 'textarea', required: true, maxlength: 1000 })}<button class="btn" type="submit">Submit for moderation</button></form>` : ''}</section>
   ${related.length ? html`<section class="section" aria-labelledby="rel-h"><h2 id="rel-h">Related products</h2><ul class="grid" role="list">${related.map((x) => html`<li>${V.productCard(ctx, x, wished.has(x.id))}</li>`)}</ul></section>` : ''}</div>` }));
});
r.post('/p/:slug/review', sec.requireLogin, async (req, res) => {
  const p = await db.one('select id from products where slug=$1', [req.params.slug]);
  if (!p) return res.status(404).end();
  const ok = await db.one(`select 1 from order_items oi join orders o on o.id=oi.order_id where o.user_id=$1 and oi.product_id=$2 and o.status='delivered' limit 1`, [req.user.id, p.id]);
  const rating = parseInt(req.body.rating, 10); const body = str(req.body.body, 1000);
  if (!ok || !(rating >= 1 && rating <= 5) || !body) return res.status(400).type('text').send('Only customers with a delivered order can review, with a rating and text.');
  await db.query(`insert into reviews(product_id,user_id,rating,body) values ($1,$2,$3,$4) on conflict (product_id,user_id) do update set rating=$3, body=$4, status='pending'`, [p.id, req.user.id, rating, body]);
  res.redirect(`/p/${req.params.slug}?review=submitted`);
});
r.get('/quick/:slug', async (req, res, next) => {
  const p = await S.getProduct(req.params.slug, req.ctx.cur);
  if (!p) return next();
  res.send(String(html`<div class="quick"><button class="btn btn-secondary close-dialog" type="button">Close</button><h2>${p.name}</h2><img src="${p.image_url}" alt="${p.image_alt}" width="400" height="300">
    <p class="sku">SKU: ${p.sku}</p>${V.priceBlock(req.ctx.cur, p, true)}<p>${V.stockLabel(p.stock)}</p><p>${p.short_desc}</p><a class="btn" href="/p/${p.slug}">View full details and options</a></div>`));
});

// ---------- cart ----------
r.get('/cart', async (req, res) => {
  const { ctx } = req; const cart = await S.cartFor(req, ctx.cur);
  const t = cart.totals;
  res.send(page(ctx, 'Your cart', html`<h1>Your cart</h1>
   ${cart.lines.length ? html`<div class="cart-grid"><div><table class="table cart-table"><caption class="visually-hidden">Items in your cart</caption><thead><tr><th scope="col">Product</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Total</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead><tbody>
    ${cart.lines.map((l) => html`<tr><th scope="row"><a href="/p/${l.slug}">${l.name}</a><br><span class="small">SKU ${l.variant_sku}${l.size || l.color ? ' · ' + [l.size, l.color].filter(Boolean).join(' / ') : ''}</span>${l.problem ? html`<br><strong class="error">${l.problem}</strong>` : ''}</th>
     <td>${fmt(l.unit_cents, ctx.cur)} <s class="price-was">${fmt(l.original_cents, ctx.cur)}</s></td>
     <td><form method="post" action="/cart/update" class="inline">${V.csrfInput(ctx)}<input type="hidden" name="variant" value="${l.variant_id}"><label class="visually-hidden" for="q-${l.variant_id}">Quantity for ${l.name}</label><input id="q-${l.variant_id}" class="qty" type="number" name="qty" min="0" max="20" value="${l.qty}"><button class="btn btn-secondary" type="submit">Update</button></form></td>
     <td>${fmt(l.line_cents, ctx.cur)}</td>
     <td><form method="post" action="/cart/remove">${V.csrfInput(ctx)}<input type="hidden" name="variant" value="${l.variant_id}"><button class="btn btn-secondary" type="submit">Remove<span class="visually-hidden"> ${l.name}</span></button></form></td></tr>`)}</tbody></table></div>
    <aside class="summary" aria-labelledby="sum-h"><h2 id="sum-h">Order summary</h2><dl class="dl">
      <dt>List price total</dt><dd>${fmt(t.original, ctx.cur)}</dd><dt>20% discount</dt><dd>-${fmt(t.discount, ctx.cur)}</dd><dt>Subtotal</dt><dd>${fmt(t.subtotal, ctx.cur)}</dd>
      <dt>Shipping (estimate)</dt><dd>${t.shipping ? fmt(t.shipping, ctx.cur) : 'Free'}</dd><dt>Taxes</dt><dd>Not calculated</dd><dt class="total">Estimated total</dt><dd class="total">${fmt(t.total, ctx.cur)}</dd></dl>
      <p class="small">Taxes and import duties are not calculated on this site. Support will confirm shipping, any taxes and the final amount with you <strong>before</strong> asking for payment.</p>
      <a class="btn btn-lg" href="/checkout">Checkout (send order enquiry)</a></aside></div>`
    : html`<div class="empty"><p>Your cart is empty.</p><a class="btn" href="/search">Browse products</a></div>`}`));
});
async function cartMutate(req, fn) { const row = await S.ownerRow('carts', req, true); await fn(row); await db.query('update carts set updated_at=now() where id=$1', [row.id]); }
r.post('/cart/add', sec.limiter('cart', 120, 60000), async (req, res) => {
  const vid = parseInt(req.body.variant, 10); const qty = Math.min(20, Math.max(1, parseInt(req.body.qty, 10) || 1));
  const v = await db.one('select v.id, v.stock, p.is_active from product_variants v join products p on p.id=v.product_id where v.id=$1 and v.is_active', [vid]);
  if (!v || !v.is_active || v.stock <= 0) return res.status(400).type('text').send('That item is not available.');
  await cartMutate(req, (row) => db.query(`insert into cart_items(cart_id, variant_id, qty) values ($1,$2,$3) on conflict (cart_id, variant_id) do update set qty = least(20, least($4, cart_items.qty + $3))`, [row.id, vid, Math.min(qty, v.stock), v.stock]));
  res.redirect('/cart');
});
r.post('/cart/update', async (req, res) => {
  const vid = parseInt(req.body.variant, 10); const qty = parseInt(req.body.qty, 10);
  if (!Number.isInteger(qty) || qty < 0 || qty > 20) return res.status(400).type('text').send('Invalid quantity (0-20).');
  await cartMutate(req, async (row) => {
    if (qty === 0) return db.query('delete from cart_items where cart_id=$1 and variant_id=$2', [row.id, vid]);
    const v = await db.one('select stock from product_variants where id=$1', [vid]);
    await db.query('update cart_items set qty=$3 where cart_id=$1 and variant_id=$2', [row.id, vid, Math.min(qty, Math.max(1, v ? v.stock : 1))]);
  });
  res.redirect('/cart');
});
r.post('/cart/remove', async (req, res) => { await cartMutate(req, (row) => db.query('delete from cart_items where cart_id=$1 and variant_id=$2', [row.id, parseInt(req.body.variant, 10)])); res.redirect('/cart'); });

// ---------- wishlist ----------
r.get('/wishlist', async (req, res) => {
  const { ctx } = req; const ids = await S.wishlistIds(req); const rows = await S.byIds(ids, ctx.cur);
  res.send(page(ctx, 'Wishlist', html`<h1>Your wishlist</h1>${rows.length ? html`<ul class="grid" role="list">${rows.map((p) => html`<li>${V.productCard(ctx, p, true)}</li>`)}</ul>` : html`<div class="empty"><p>No saved products yet.</p></div>`}${ctx.user ? '' : html`<p class="small">Sign in to keep your wishlist across devices.</p>`}`));
});
r.post('/wishlist/toggle', async (req, res) => {
  const pid = parseInt(req.body.product, 10);
  if (!(await db.one('select 1 from products where id=$1', [pid]))) return res.status(404).end();
  const w = await S.ownerRow('wishlists', req, true);
  const del = await db.query('delete from wishlist_items where wishlist_id=$1 and product_id=$2', [w.id, pid]);
  if (!del.rowCount) await db.query('insert into wishlist_items(wishlist_id, product_id) values ($1,$2) on conflict do nothing', [w.id, pid]);
  res.redirect(sec.safeNext(req.body.next));
});

// ---------- checkout (enquiry) ----------
const COUNTRIES = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Ireland', 'Germany', 'France', 'Cameroon', 'Nigeria', 'South Africa', 'India', 'Other'];
function checkoutForm(ctx, cart, v = {}, errors = {}) {
  const t = cart.totals;
  return page(ctx, 'Checkout - order enquiry', html`<h1>Checkout: send an order enquiry</h1>
  <p class="alert alert-info"><strong>No payment is taken on this website.</strong> Submitting this form creates an order enquiry. Our support team will review it and contact you to arrange payment. Your order is only marked as paid after staff independently confirm payment.</p>
  <div class="cart-grid"><form method="post" action="/checkout" class="stack" novalidate>${V.csrfInput(ctx)}${V.errorSummary(errors)}
    ${V.field({ id: 'name', label: 'Full name', required: true, value: v.name || ctx.user?.name || '', error: errors.name, autocomplete: 'name', maxlength: 100 })}
    ${V.field({ id: 'email', label: 'Email address', type: 'email', required: true, value: v.email || ctx.user?.email || '', error: errors.email, autocomplete: 'email', maxlength: 200 })}
    ${V.field({ id: 'country', label: 'Country', type: 'select', required: true, value: v.country || '', error: errors.country, options: [['', 'Select a country'], ...COUNTRIES.map((c) => [c, c])] })}
    ${V.field({ id: 'contact', label: 'Preferred contact method', type: 'select', value: v.contact || 'email', options: [['email', 'Email'], ['either', 'Either']] })}
    ${V.field({ id: 'message', label: 'Message for support (optional)', type: 'textarea', value: v.message || '', maxlength: 1000, error: errors.message })}
    ${V.field({ id: 'consent', label: 'I agree that GlobalSport Co. may use the details above and my cart contents to respond to this enquiry (see the privacy policy).', type: 'checkbox', checked: v.consent, error: errors.consent })}
    <button class="btn btn-lg" type="submit">Create enquiry</button></form>
  <aside class="summary"><h2>Order summary</h2><ul class="plain">${cart.lines.map((l) => html`<li>${l.qty} × ${l.name}${l.size || l.color ? ' (' + [l.size, l.color].filter(Boolean).join(' / ') + ')' : ''} - ${fmt(l.line_cents, ctx.cur)}</li>`)}</ul>
   <dl class="dl"><dt>Subtotal (after 20% discount)</dt><dd>${fmt(t.subtotal, ctx.cur)}</dd><dt>Shipping (estimate)</dt><dd>${t.shipping ? fmt(t.shipping, ctx.cur) : 'Free'}</dd><dt>Taxes</dt><dd>Not calculated; confirmed before payment</dd><dt class="total">Estimated total (${ctx.cur})</dt><dd class="total">${fmt(t.total, ctx.cur)}</dd></dl>
   <p class="small">Final prices and any shipping/tax are re-checked by the server and confirmed by support. Currency: ${ctx.cur}.</p></aside></div>`);
}
r.get('/checkout', async (req, res) => {
  const cart = await S.cartFor(req, req.ctx.cur);
  if (!cart.lines.length) return res.redirect('/cart');
  res.send(checkoutForm(req.ctx, cart));
});
r.post('/checkout', sec.limiter('checkout', 10, 3600000), async (req, res) => {
  const { ctx } = req; const b = req.body;
  const v = { name: str(b.name, 100), email: str(b.email, 200), country: str(b.country, 60), contact: ['email', 'either'].includes(b.contact) ? b.contact : 'email', message: str(b.message, 1000), consent: b.consent === '1' };
  const errors = {};
  if (v.name.length < 2) errors.name = 'Enter your full name.';
  if (!EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
  if (!COUNTRIES.includes(v.country)) errors.country = 'Select your country.';
  if (!v.consent) errors.consent = 'Please confirm you agree to us using these details to respond to your enquiry.';
  const cart = await S.cartFor(req, ctx.cur);
  if (Object.keys(errors).length) return res.status(400).send(checkoutForm(ctx, cart, v, errors));
  try {
    const o = await S.createEnquiry(req, ctx.cur, v);
    res.redirect(`/order/${o.ref}`);
  } catch (e) {
    if (!e.user) throw e;
    res.status(400).send(checkoutForm(ctx, cart, v, { name: e.message }));
  }
});
async function canViewOrder(req, o) {
  return (req.user && o.user_id === req.user.id) || o.session_hash === req.session.token_hash || (req.user && await sec.can(req.user, 'orders.read'));
}
async function loadOrder(ref) {
  const o = await db.one('select o.*, e.message, e.contact_preference from orders o left join order_enquiries e on e.order_id=o.id where o.ref=$1', [ref]);
  if (!o) return null;
  o.items = await db.many('select * from order_items where order_id=$1 order by id', [o.id]);
  return o;
}
function mailtoFor(o) {
  const lines = o.items.map((i) => `- ${i.qty} x ${i.name} (SKU ${i.sku}${i.size || i.color ? ', ' + [i.size, i.color].filter(Boolean).join('/') : ''}) @ ${fmt(i.unit_price_cents, o.currency)} each`);
  const bodyFull = `Order enquiry reference: ${o.ref}\nName: ${o.customer_name}\nEmail: ${o.email}\nCountry: ${o.country}\nCurrency: ${o.currency}\n\nItems:\n${lines.join('\n')}\n\nSubtotal (20% discount applied): ${fmt(o.subtotal_cents, o.currency)}\nEstimated shipping: ${fmt(o.shipping_cents, o.currency)}\nEstimated total: ${fmt(o.total_cents, o.currency)}\n\nMessage: ${o.message || '(none)'}\n\nPlease contact me to arrange payment. (Totals are subject to confirmation by support.)`;
  const body = bodyFull.length > 1500 ? bodyFull.slice(0, 1450) + `\n...\n(Full order details are stored under reference ${o.ref}.)` : bodyFull;
  const subject = `Order enquiry ${o.ref} - ${config.siteName}`;
  const to = config.supportEmail;
  return {
    subject, body, to,
    mailto: to ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '',
    gmail: to ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '',
  };
}
r.get('/order/:ref', async (req, res, next) => {
  const { ctx } = req;
  const o = await loadOrder(req.params.ref);
  if (!o || !(await canViewOrder(req, o))) return next();
  const m = mailtoFor(o);
  res.send(page(ctx, `Order enquiry ${o.ref}`, html`<h1>Enquiry received</h1>
   <div class="alert alert-info" role="status"><p>Your enquiry reference is <strong class="ref">${o.ref}</strong>. Status: ${V.statusBadge(o.status)}</p>
   <p><strong>This is not a paid order.</strong> We have not received any payment. The next step is to email our support team so they can contact you to arrange payment.</p></div>
   <section class="section" aria-labelledby="next-h"><h2 id="next-h">Send your enquiry by email</h2>
   ${m.to ? html`<ol><li><a class="btn btn-lg" href="${m.mailto}">Open my email app with the message prefilled</a></li>
     <li>Or <a href="${m.gmail}" target="_blank" rel="noopener noreferrer">compose it in Gmail (opens a new tab)</a>.</li>
     <li>If neither works, email <strong>${m.to}</strong> yourself and quote reference <strong>${o.ref}</strong>.</li></ol>
     <p class="small">Opening your email app does not send anything automatically; you must press send in your email program. We cannot confirm delivery until you do.</p>
     <details><summary>Show the email text</summary><pre class="pre">${'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.body}</pre></details>`
    : html`<p class="alert alert-warning">The support email address has not been configured on this site yet. Your enquiry is saved under reference <strong>${o.ref}</strong>; please use the <a href="/contact">contact page</a> or live chat and quote it.</p>`}</section>
   <section class="section" aria-labelledby="sum-h"><h2 id="sum-h">Enquiry details</h2><table class="table"><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit price</th></tr></thead><tbody>
    ${o.items.map((i) => html`<tr><th scope="row">${i.name}<br><span class="small">SKU ${i.sku}</span></th><td>${i.qty}</td><td>${fmt(i.unit_price_cents, o.currency)}</td></tr>`)}</tbody></table>
    <dl class="dl"><dt>Subtotal</dt><dd>${fmt(o.subtotal_cents, o.currency)}</dd><dt>Estimated shipping</dt><dd>${fmt(o.shipping_cents, o.currency)}</dd><dt class="total">Estimated total</dt><dd class="total">${fmt(o.total_cents, o.currency)}</dd></dl></section>`));
});
r.get('/order-status', (req, res) => res.send(page(req.ctx, 'Check an order enquiry', html`<h1>Check an order enquiry</h1><form method="post" action="/order-status" class="stack narrow">${V.csrfInput(req.ctx)}
  ${V.field({ id: 'ref', label: 'Enquiry reference (e.g. GS-ABCD2345)', required: true, maxlength: 20 })}${V.field({ id: 'email', label: 'Email used for the enquiry', type: 'email', required: true })}<button class="btn" type="submit">Check status</button></form>`)));
r.post('/order-status', sec.limiter('ostatus', 10, 600000), async (req, res) => {
  const o = await loadOrder(str(req.body.ref, 20).toUpperCase());
  const ok = o && o.email.toLowerCase() === str(req.body.email, 200).toLowerCase();
  res.status(ok ? 200 : 404).send(page(req.ctx, 'Order enquiry status', ok ? html`<h1>Enquiry ${o.ref}</h1><p>Status: ${V.statusBadge(o.status)}</p>${o.tracking_info ? html`<p>Tracking: ${o.tracking_info}</p>` : ''}<p class="small">Statuses are updated by our team after they take the action shown.</p>` : html`<h1>Not found</h1><p>We could not find an enquiry with that reference and email.</p><a href="/order-status">Try again</a>`));
});

// ---------- preferences, consent, newsletter ----------
r.get('/currency', (req, res) => {
  if (config.currencies.includes(req.query.c)) sec.setCookie(res, 'gs_cur', req.query.c, { maxAge: 31536000, httpOnly: false });
  res.redirect(sec.safeNext(req.query.next));
});
r.post('/consent', express.json({ limit: '1kb' }), async (req, res) => {
  const granted = req.body.analytics === true || req.body.analytics === '1' || req.body.analytics === 'accept';
  sec.setCookie(res, 'gs_consent', granted ? 'a1' : 'a0', { maxAge: 15552000, httpOnly: false });
  await db.query('insert into consent_records(session_hash, user_id, purpose, granted, policy_version) values ($1,$2,$3,$4,$5)', [req.session.token_hash, req.user?.id || null, 'analytics', granted, config.policyVersion]);
  if (req.is('json')) return res.json({ ok: true, analytics: granted });
  res.redirect(sec.safeNext(req.body.next || '/privacy'));
});
r.post('/newsletter', sec.limiter('news', 5, 3600000), async (req, res) => {
  const email = str(req.body.email, 200);
  if (req.body.consent !== '1' || !EMAIL_RE.test(email)) return res.status(400).send(page(req.ctx, 'Newsletter', html`<h1>Subscription not saved</h1><p>Enter a valid email address and tick the consent box to subscribe.</p><a href="/">Back</a>`));
  await db.query('insert into newsletter_subscriptions(email) values ($1) on conflict do nothing', [email]);
  await db.query('insert into consent_records(session_hash, purpose, granted, policy_version) values ($1,$2,true,$3)', [req.session.token_hash, 'newsletter', config.policyVersion]);
  res.send(page(req.ctx, 'Newsletter', html`<h1>Thank you</h1><p>You are subscribed. Every email will include an unsubscribe option, and you can also write to ${config.privacyEmail || 'us'} at any time.</p>`));
});

// ---------- auth ----------
const AUTH_ERR = 'Incorrect email or password.';
r.get('/login', (req, res) => res.send(page(req.ctx, 'Sign in', html`<h1>Sign in</h1><form method="post" action="/login" class="stack narrow">${V.csrfInput(req.ctx)}<input type="hidden" name="next" value="${req.query.next || ''}">
  ${V.field({ id: 'email', label: 'Email address', type: 'email', required: true, autocomplete: 'username' })}${V.field({ id: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' })}
  <button class="btn" type="submit">Sign in</button></form><p><a href="/register">Create an account</a> · <a href="/forgot">Forgot password?</a></p>`)));
r.post('/login', sec.limiter('login-ip', 20, 900000), async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase(); const pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const lim = sec.hit('login-email:' + email, 8, 900000);
  const fail = (code = 401, msg = AUTH_ERR) => res.status(code).send(page(req.ctx, 'Sign in', html`<h1>Sign in</h1><div class="alert alert-error" role="alert">${msg}</div><p><a href="/login">Try again</a></p>`));
  if (!lim.ok) return fail(429, 'Too many attempts. Try again in a few minutes.');
  const u = await db.one(`select * from users where lower(email)=$1 and status='active'`, [email]);
  if (!u || !u.password_hash) { sec.verifyPassword(pw, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); return fail(); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return fail(429, 'This account is temporarily locked. Try again later.');
  if (!sec.verifyPassword(pw, u.password_hash)) {
    const n = u.failed_logins + 1;
    await db.query('update users set failed_logins=$2, locked_until = case when $2 >= 10 then now() + interval \'15 minutes\' else null end where id=$1', [u.id, n >= 10 ? 0 : n]);
    return fail();
  }
  await db.query('update users set failed_logins=0, locked_until=null, last_login=now() where id=$1', [u.id]);
  const guest = req.session.token_hash;
  await sec.loginSession(req, res, u);
  await S.mergeGuestIntoUser(guest, u.id);
  req.user = { id: u.id, email: u.email, role: u.role };
  if (u.role !== 'customer') await sec.audit(req, 'staff.login', 'user', u.id);
  res.redirect(sec.safeNext(req.body.next) === '/' && u.role !== 'customer' ? '/admin' : sec.safeNext(req.body.next));
});
r.post('/logout', async (req, res) => { await sec.logoutSession(req, res); res.redirect('/'); });
r.get('/register', (req, res) => res.send(registerPage(req.ctx)));
function registerPage(ctx, v = {}, errors = {}) {
  return page(ctx, 'Create account', html`<h1>Create an account</h1><form method="post" action="/register" class="stack narrow" novalidate>${V.csrfInput(ctx)}${V.errorSummary(errors)}
  ${V.field({ id: 'name', label: 'Name', required: true, value: v.name, error: errors.name, autocomplete: 'name', maxlength: 100 })}
  ${V.field({ id: 'email', label: 'Email address', type: 'email', required: true, value: v.email, error: errors.email, autocomplete: 'email' })}
  ${V.field({ id: 'password', label: 'Password', type: 'password', required: true, error: errors.password, hint: 'At least 10 characters with letters and a number.', autocomplete: 'new-password' })}
  <fieldset class="field"><legend>Age check <span class="req">(required)</span></legend><p class="hint">We only ask whether you are old enough, not your date of birth. Accounts are for people aged 13 or over. Under-13s can still browse, and a parent or guardian can place an enquiry for them.</p>
    <div class="radio"><input type="radio" id="age13" name="age" value="13plus" ${v.age === '13plus' ? raw('checked') : ''}><label for="age13">I am 13 or older</label></div>
    <div class="radio"><input type="radio" id="ageU13" name="age" value="under13" ${v.age === 'under13' ? raw('checked') : ''}><label for="ageU13">I am under 13</label></div>${errors.age ? html`<p class="error">Error: ${errors.age}</p>` : ''}</fieldset>
  ${V.field({ id: 'terms', label: html`I accept the <a href="/terms">terms of service</a> and have read the <a href="/privacy">privacy policy</a>.`, type: 'checkbox', checked: v.terms, error: errors.terms })}
  <button class="btn" type="submit">Create account</button></form>`);
}
r.post('/register', sec.limiter('register', 10, 3600000), async (req, res) => {
  const b = req.body; const v = { name: str(b.name, 100), email: str(b.email, 200), age: b.age, terms: b.terms === '1' }; const errors = {};
  if (v.name.length < 2) errors.name = 'Enter your name.';
  if (!EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
  const pp = sec.passwordProblem(b.password, v.email); if (pp) errors.password = pp;
  if (v.age === 'under13') return res.status(403).send(page(req.ctx, 'Age check', html`<h1>We cannot create this account</h1><p>Accounts on GlobalSport Co. are for people aged 13 and over. We have not stored any of the details you entered. A parent or guardian is welcome to browse and place an order enquiry on your behalf.</p><a class="btn" href="/">Back to shop</a>`));
  if (v.age !== '13plus') errors.age = 'Please confirm your age group.';
  if (!v.terms) errors.terms = 'You must accept the terms to create an account.';
  if (!errors.email && await db.one('select 1 from users where lower(email)=lower($1)', [v.email])) errors.email = 'We could not create an account with these details. If you already registered, sign in or reset your password.';
  if (Object.keys(errors).length) return res.status(400).send(registerPage(req.ctx, { ...v, age: v.age }, errors));
  const u = await db.one(`insert into users(email, name, password_hash, age_confirmed_13plus) values ($1,$2,$3,true) returning id, role`, [v.email, v.name, sec.hashPassword(b.password)]);
  const guest = req.session.token_hash;
  await sec.loginSession(req, res, u);
  await S.mergeGuestIntoUser(guest, u.id);
  res.redirect('/account');
});
r.get('/forgot', (req, res) => res.send(page(req.ctx, 'Reset password', html`<h1>Reset your password</h1><form method="post" action="/forgot" class="stack narrow">${V.csrfInput(req.ctx)}${V.field({ id: 'email', label: 'Email address', type: 'email', required: true })}<button class="btn" type="submit">Request reset</button></form>`)));
r.post('/forgot', sec.limiter('forgot', 5, 3600000), async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const u = await db.one(`select id, role from users where lower(email)=$1 and status='active'`, [email]);
  if (u && u.role === 'customer') {
    const tok = sec.token();
    await db.query(`insert into password_resets(token_hash, user_id, expires_at) values ($1,$2, now() + interval '1 hour')`, [sec.sha(tok), u.id]);
    // Email delivery is not configured in this build. In development the link is printed to the server log.
    if (!config.prod) console.log(`[dev] password reset link for ${email}: ${config.baseUrl}/reset/${tok}`);
  }
  res.send(page(req.ctx, 'Reset password', html`<h1>Check your email</h1><p>If an account exists for that address, a reset link will be sent. Staff accounts are reset by an administrator.</p><p class="small">Note for site owners: sending reset emails requires an email provider; see the README (known limitations).</p>`));
});
r.get('/reset/:tok', (req, res) => res.send(page(req.ctx, 'Choose a new password', html`<h1>Choose a new password</h1><form method="post" action="/reset/${req.params.tok}" class="stack narrow">${V.csrfInput(req.ctx)}${V.field({ id: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 10 characters with letters and a number.' })}<button class="btn" type="submit">Save password</button></form>`)));
r.post('/reset/:tok', sec.limiter('reset', 10, 3600000), async (req, res) => {
  const rr = await db.one('select user_id from password_resets where token_hash=$1 and not used and expires_at > now()', [sec.sha(req.params.tok)]);
  const pp = sec.passwordProblem(req.body.password);
  if (!rr || pp) return res.status(400).send(page(req.ctx, 'Reset password', html`<h1>Could not reset</h1><p>${rr ? pp : 'This link is invalid or has expired.'}</p>`));
  await db.tx(async (t) => {
    await t.query('update users set password_hash=$2, failed_logins=0, locked_until=null where id=$1', [rr.user_id, sec.hashPassword(req.body.password)]);
    await t.query('update password_resets set used=true where token_hash=$1', [sec.sha(req.params.tok)]);
    await t.query('delete from sessions where user_id=$1', [rr.user_id]);
  });
  res.redirect('/login');
});

// ---------- account & data deletion ----------
r.get('/account', sec.requireLogin, async (req, res) => {
  const orders = await db.many('select ref, status, currency, total_cents, created_at from orders where user_id=$1 order by created_at desc limit 50', [req.user.id]);
  const del = await db.one(`select status from deletion_requests where user_id=$1 and status='open'`, [req.user.id]);
  res.send(page(req.ctx, 'Your account', html`<h1>Your account</h1><p>Signed in as ${req.user.email}.</p>
   <h2>Your order enquiries</h2>${orders.length ? html`<table class="table"><thead><tr><th scope="col">Reference</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Date</th></tr></thead><tbody>${orders.map((o) => html`<tr><th scope="row"><a href="/order/${o.ref}">${o.ref}</a></th><td>${V.statusBadge(o.status)}</td><td>${fmt(o.total_cents, o.currency)}</td><td>${new Date(o.created_at).toLocaleDateString('en-GB')}</td></tr>`)}</tbody></table>` : html`<p>No enquiries yet.</p>`}
   <h2>Your data</h2><p>${del ? 'Your deletion request is open and being processed.' : html`<a href="/data-deletion">Request deletion of your account and personal data</a>`}</p>
   <form method="post" action="/logout">${V.csrfInput(req.ctx)}<button class="btn btn-secondary" type="submit">Sign out</button></form>`));
});
r.get('/data-deletion', (req, res) => res.send(page(req.ctx, 'Request data deletion', html`<h1>Request data deletion</h1><p>You can ask us to delete your account and personal data. We will review the request and confirm the outcome. Some records (for example order and payment records) may have to be kept for tax and accounting law, but we will remove or anonymise the personal details wherever we lawfully can. See the <a href="/privacy#deletion">privacy policy</a>.</p>
  <form method="post" action="/data-deletion" class="stack narrow">${V.csrfInput(req.ctx)}${V.field({ id: 'email', label: 'Email address on the account or orders', type: 'email', required: true, value: req.user?.email || '' })}${V.field({ id: 'details', label: 'Anything we should know (optional)', type: 'textarea', maxlength: 1000 })}<button class="btn" type="submit">Submit request</button></form>`)));
r.post('/data-deletion', sec.limiter('deletion', 5, 3600000), async (req, res) => {
  const email = str(req.body.email, 200);
  if (!EMAIL_RE.test(email)) return res.status(400).send(page(req.ctx, 'Request data deletion', html`<h1>Enter a valid email</h1><a href="/data-deletion">Back</a>`));
  const u = req.user && req.user.email.toLowerCase() === email.toLowerCase() ? req.user : await db.one('select id from users where lower(email)=lower($1)', [email]);
  // Requests for an account are only attributed to the account when signed in as it; staff verify identity before acting.
  await db.query('insert into deletion_requests(user_id, email, details) values ($1,$2,$3)', [req.user && req.user.email.toLowerCase() === email.toLowerCase() ? req.user.id : null, email, str(req.body.details, 1000)]);
  res.send(page(req.ctx, 'Request received', html`<h1>Request received</h1><p>We have recorded your request. Our team will verify your identity (we may email you) and then process it. ${u ? '' : ''}</p>`));
});

// ---------- legal & info ----------
for (const [slug, title] of [['privacy', 'Privacy policy'], ['terms', 'Terms of service'], ['refunds', 'Refund policy'], ['shipping', 'Shipping & delivery'], ['accessibility', 'Accessibility statement'], ['contact', 'Contact & support'], ['about', 'About us']]) {
  r.get('/' + slug, (req, res) => res.send(page(req.ctx, title, html`<article class="prose">${legal[slug](req.ctx)}</article>`)));
}
module.exports = r;
