const express = require('express');
const db = require('../db');
const config = require('../config');
const S = require('../services');
const V = require('../views');
const sec = require('../security');
const { html, raw } = require('../html');
const { discounted, fmt } = require('../pricing');
const { parseCsv, csvCell } = require('../csv');

const r = express.Router();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const parseMoney = (s) => (/^\d{1,6}(\.\d{1,2})?$/.test(String(s).trim()) ? Math.round(parseFloat(s) * 100) : NaN);
const dt = (d) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const PAGE = 50;

r.use('/admin', (req, res, next) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (!['admin', 'support'].includes(req.user.role)) return res.status(403).type('text').send('Forbidden');
  next();
});

async function adminPage(req, title, inner) {
  const u = req.user;
  const has = async (p) => sec.can(u, p);
  const links = [['/admin', 'Dashboard', true], ['/admin/products', 'Products', await has('products.read')], ['/admin/orders', 'Orders', await has('orders.read')],
    ['/admin/customers', 'Customers', await has('customers.read')], ['/admin/deletions', 'Deletion requests', await has('customers.write')], ['/admin/support', 'Support', await has('support.chat')],
    ['/admin/reviews', 'Reviews', await has('reviews.moderate')], ['/admin/audit', 'Audit log', await has('audit.read')]].filter((l) => l[2]);
  return V.layout(req.ctx, { title: 'Admin: ' + title, bodyClass: 'admin', body: html`<div class="wrap page admin-page"><nav class="admin-nav" aria-label="Admin sections"><ul>${links.map(([h, t]) => html`<li><a href="${h}" ${req.originalUrl.split('?')[0] === h ? raw('aria-current="page"') : ''}>${t}</a></li>`)}</ul></nav><h1>${title}</h1>${inner}</div>` });
}
const notFound = (res) => res.status(404).type('text').send('Not found');

// ---------- dashboard ----------
r.get('/admin', async (req, res) => {
  const u = req.user; const c = req.ctx;
  const q = (s, p = []) => db.one(s, p);
  const sections = [];
  if (await sec.can(u, 'products.read')) {
    const s = await q(`select count(*)::int total, count(*) filter (where is_active)::int active,
      count(*) filter (where is_active and not exists (select 1 from product_variants v where v.product_id=products.id and v.is_active and v.stock>0))::int oos from products`);
    const cats = await q('select count(*)::int n from categories');
    sections.push(html`<section aria-labelledby="d-prod"><h2 id="d-prod">Catalogue</h2><dl class="stats"><div><dt>Total products</dt><dd>${s.total}</dd></div><div><dt>Active products</dt><dd>${s.active}</dd></div><div><dt>Out of stock</dt><dd>${s.oos}</dd></div><div><dt>Categories</dt><dd>${cats.n}</dd></div></dl></section>`);
  }
  if (await sec.can(u, 'orders.read')) {
    const o = await q(`select count(*)::int total, count(*) filter (where status='pending_enquiry')::int pending, count(*) filter (where status='awaiting_payment')::int awaiting from orders`);
    const sales = await db.many('select currency, sum(amount_cents)::int s from payment_records group by currency order by currency');
    const refunds = await db.many('select currency, sum(amount_cents)::int s from refund_records group by currency order by currency');
    const f = (rows) => (rows.length ? rows.map((x) => fmt(x.s, x.currency)).join(' · ') : 'None recorded');
    sections.push(html`<section aria-labelledby="d-ord"><h2 id="d-ord">Orders</h2><dl class="stats"><div><dt>Total orders / enquiries</dt><dd>${o.total}</dd></div><div><dt>Pending enquiries</dt><dd>${o.pending}</dd></div><div><dt>Awaiting payment</dt><dd>${o.awaiting}</dd></div><div><dt>Confirmed sales (recorded payments)</dt><dd class="small-dd">${f(sales)}</dd></div><div><dt>Refund totals</dt><dd class="small-dd">${f(refunds)}</dd></div></dl></section>`);
  }
  if (await sec.can(u, 'customers.read')) {
    const n = await q(`select count(*)::int n from users where role='customer' and status='active'`);
    sections.push(html`<section aria-labelledby="d-cust"><h2 id="d-cust">Customers</h2><dl class="stats"><div><dt>Registered customers</dt><dd>${n.n}</dd></div></dl></section>`);
  }
  if (await sec.can(u, 'support.chat')) {
    const s = await q(`select count(*)::int total, count(*) filter (where status<>'closed')::int open from support_conversations`);
    const ai = await q(`select count(*) filter (where status='ok')::int ok, count(*) filter (where escalated)::int esc from ai_usage_logs where created_at > now() - interval '30 days'`);
    sections.push(html`<section aria-labelledby="d-sup"><h2 id="d-sup">Support</h2><dl class="stats"><div><dt>Support conversations</dt><dd>${s.total}</dd></div><div><dt>Open conversations</dt><dd>${s.open}</dd></div><div><dt>AI answers (30 days)</dt><dd>${ai.ok}</dd></div><div><dt>AI escalations to human (30 days)</dt><dd>${ai.esc}</dd></div></dl></section>`);
  }
  let recent = '';
  if (await sec.can(u, 'audit.read')) {
    const a = await db.many('select * from audit_logs order by id desc limit 10');
    recent = html`<section aria-labelledby="d-aud"><h2 id="d-aud">Recent administrative activity</h2>${a.length ? html`<table class="table"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Entity</th></tr></thead><tbody>${a.map((x) => html`<tr><td>${dt(x.created_at)}</td><td>${x.actor_email || 'system'}</td><td>${x.action}</td><td>${x.entity || ''} ${x.entity_id || ''}</td></tr>`)}</tbody></table>` : html`<p>No activity recorded yet.</p>`}</section>`;
  }
  res.send(await adminPage(req, 'Dashboard', html`<p>Signed in as ${u.email} (${u.role}). All figures come from the live database.</p>${sections}${recent}`));
});

// ---------- products ----------
const prodAccess = [sec.requirePerm('products.read')]; const prodWrite = [sec.requirePerm('products.write')];
r.get('/admin/products', prodAccess, async (req, res) => {
  const q = str(req.query.q, 80); const cat = str(req.query.cat, 60); const status = str(req.query.status, 20);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const params = ['USD']; const w = ['true'];
  if (q) { params.push('%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'); w.push(`(p.name ilike $${params.length} or p.sku ilike $${params.length})`); }
  if (cat) { params.push(cat); w.push(`c.slug = $${params.length}`); }
  if (status === 'active') w.push('p.is_active'); else if (status === 'archived') w.push('not p.is_active');
  else if (status === 'oos') w.push('not exists (select 1 from product_variants v where v.product_id=p.id and v.is_active and v.stock>0)');
  const where = w.join(' and ');
  const total = (await db.one(`select count(*)::int n from products p join categories c on c.id=p.category_id left join product_prices pr on pr.product_id=p.id and pr.currency=$1 where ${where}`, params)).n;
  const rows = await db.many(`select p.id, p.sku, p.name, p.is_active, p.is_featured, c.name sport, pr.original_cents, pr.discounted_cents,
     (select coalesce(sum(stock),0)::int from product_variants v where v.product_id=p.id) stock from products p join categories c on c.id=p.category_id
     left join product_prices pr on pr.product_id=p.id and pr.currency=$1 where ${where} order by p.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`, params);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const url = (n) => '/admin/products?' + new URLSearchParams({ q, cat, status, page: n }).toString();
  const canWrite = await sec.can(req.user, 'products.write');
  res.send(await adminPage(req, 'Products', html`
   <form class="filters inline-filters" method="get" action="/admin/products">${V.field({ id: 'q', label: 'Search name or SKU', value: q })}
    ${V.field({ id: 'cat', label: 'Sport', type: 'select', value: cat, options: [['', 'All'], ...req.ctx.categories.map((c) => [c.slug, c.name])] })}
    ${V.field({ id: 'status', label: 'Status', type: 'select', value: status, options: [['', 'All'], ['active', 'Active'], ['archived', 'Archived'], ['oos', 'Out of stock']] })}<button class="btn" type="submit">Filter</button></form>
   ${canWrite ? html`<p><a class="btn" href="/admin/products/new">Add product</a> <a class="btn btn-secondary" href="/admin/products/export.csv">Export CSV</a> <a class="btn btn-secondary" href="/admin/products/import">Import CSV</a> <a class="btn btn-secondary" href="/admin/products/sku-check">SKU validation</a></p>` : ''}
   <p role="status">${total} products. Page ${Math.min(page, pages)} of ${pages}.</p>
   <form method="post" action="/admin/products/bulk">${V.csrfInput(req.ctx)}<table class="table"><caption class="visually-hidden">Products</caption><thead><tr>${canWrite ? html`<th scope="col"><span class="visually-hidden">Select</span></th>` : ''}<th scope="col">SKU</th><th scope="col">Name</th><th scope="col">Sport</th><th scope="col">USD list / sale</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${rows.map((p) => html`<tr>${canWrite ? html`<td><input type="checkbox" name="ids" value="${p.id}" aria-label="Select ${p.name}"></td>` : ''}<td>${p.sku}</td><th scope="row">${p.name}</th><td>${p.sport}</td><td>${p.original_cents ? fmt(p.original_cents, 'USD') + ' / ' + fmt(p.discounted_cents, 'USD') : '-'}</td><td>${p.stock}</td><td>${p.is_active ? 'Active' : 'Archived'}${p.is_featured ? ' · Featured' : ''}</td><td>${canWrite ? html`<a href="/admin/products/${p.id}/edit">Edit<span class="visually-hidden"> ${p.name}</span></a>` : ''}</td></tr>`)}</tbody></table>
   ${canWrite ? html`<fieldset class="bulk"><legend>Bulk edit selected products</legend>
     ${V.field({ id: 'bulk-action', name: 'action', label: 'Action', type: 'select', options: [['', 'Choose an action'], ['activate', 'Activate'], ['archive', 'Archive'], ['feature', 'Mark featured'], ['unfeature', 'Remove featured'], ['price_pct', 'Change list prices by percent'], ['stock_set', 'Set stock on all variants']] })}
     ${V.field({ id: 'bulk-value', name: 'value', label: 'Value (percent e.g. 5 or -10; or stock quantity)' })}<button class="btn" type="submit">Apply to selected</button></fieldset>` : ''}</form>
   ${V.pagination(Math.min(page, pages), pages, url)}`));
});

function productForm(req, p = {}, brands = [], errors = {}, isNew = true) {
  const c = req.ctx;
  return html`<form method="post" action="${isNew ? '/admin/products' : `/admin/products/${p.id}`}" class="stack narrow" novalidate>${V.csrfInput(c)}${V.errorSummary(errors)}
    ${V.field({ id: 'sku', label: 'SKU (unique, capital letters, digits, hyphens)', required: true, value: p.sku || '', error: errors.sku, maxlength: 40, hint: isNew ? '' : 'SKU cannot be changed after creation.' })}
    ${V.field({ id: 'name', label: 'Product name', required: true, value: p.name || '', error: errors.name, maxlength: 140 })}
    ${V.field({ id: 'sport', label: 'Sport category', type: 'select', required: true, value: p.category_id || '', error: errors.sport, options: [['', 'Select'], ...c.categories.map((x) => [x.id, x.name])] })}
    ${V.field({ id: 'subcategory', label: 'Subcategory / product type', required: true, value: p.subcategory || '', error: errors.subcategory })}
    ${V.field({ id: 'brand', label: 'Brand', required: true, value: p.brand || '', error: errors.brand, hint: 'Use real brand names only for genuine, authorised products.' })}
    ${V.field({ id: 'short_desc', label: 'Short description', required: true, value: p.short_desc || '', error: errors.short_desc, maxlength: 300 })}
    ${V.field({ id: 'full_desc', label: 'Full description', type: 'textarea', required: true, value: p.full_desc || '', error: errors.full_desc, rows: 6 })}
    ${V.field({ id: 'image_alt', label: 'Main image alternative text', value: p.image_alt || '', error: errors.image_alt, maxlength: 200 })}
    <fieldset><legend>List prices (the ${config.discountPct}% discount is applied automatically)</legend>
      ${config.currencies.map((cur) => V.field({ id: 'price_' + cur, label: `${cur} list price`, required: true, value: p['price_' + cur] != null ? (p['price_' + cur] / 100).toFixed(2) : '', error: errors['price_' + cur], hint: p['price_' + cur] > 0 ? `Sale price: ${fmt(discounted(p['price_' + cur], config.discountPct), cur)}` : '' }))}</fieldset>
    ${V.field({ id: 'is_active', label: 'Active (visible in the shop)', type: 'checkbox', checked: isNew ? true : p.is_active })}${V.field({ id: 'is_featured', label: 'Featured on homepage', type: 'checkbox', checked: p.is_featured })}
    ${isNew ? V.field({ id: 'stock', label: 'Initial stock (single default variant; add size/colour variants after saving)', value: '0' }) : ''}
    <button class="btn" type="submit">${isNew ? 'Create product' : 'Save changes'}</button></form>`;
}
async function saveProduct(req, id) {
  const b = req.body; const errors = {};
  const v = { sku: str(b.sku, 40).toUpperCase(), name: str(b.name, 140), category_id: parseInt(b.sport, 10), subcategory: str(b.subcategory, 80), brand: str(b.brand, 80), short_desc: str(b.short_desc, 300), full_desc: str(b.full_desc, 5000), image_alt: str(b.image_alt, 200), is_active: b.is_active === '1', is_featured: b.is_featured === '1' };
  if (!id && !/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(v.sku)) errors.sku = 'SKU must be 3-40 characters: capital letters, digits and hyphens.';
  if (!v.name) errors.name = 'Name is required.';
  if (!req.ctx.categories.some((c) => c.id === v.category_id)) errors.sport = 'Choose a sport.';
  if (!v.subcategory) errors.subcategory = 'Required.'; if (!v.brand) errors.brand = 'Required.';
  if (!v.short_desc) errors.short_desc = 'Required.'; if (!v.full_desc) errors.full_desc = 'Required.';
  for (const cur of config.currencies) { const m = parseMoney(b['price_' + cur] ?? ''); v['price_' + cur] = m; if (!(m > 0)) errors['price_' + cur] = 'Enter a price greater than 0 (e.g. 49.99).'; }
  if (Object.keys(errors).length) return { errors, v };
  try {
    const out = await db.tx(async (t) => {
      const br = (await t.query('insert into brands(name) values ($1) on conflict (name) do update set name=excluded.name returning id', [v.brand])).rows[0];
      let pid = id;
      if (id) {
        await t.query(`update products set name=$2, category_id=$3, subcategory=$4, brand_id=$5, short_desc=$6, full_desc=$7, image_alt=coalesce(nullif($8,''), image_alt), is_active=$9, is_featured=$10, discount_pct=$11, updated_at=now() where id=$1`,
          [id, v.name, v.category_id, v.subcategory, br.id, v.short_desc, v.full_desc, v.image_alt, v.is_active, v.is_featured, config.discountPct]);
      } else {
        let slug = slugify(v.name) || 'product'; if ((await t.query('select 1 from products where slug=$1', [slug])).rows.length) slug += '-' + v.sku.toLowerCase();
        pid = (await t.query(`insert into products(sku, slug, name, category_id, subcategory, brand_id, short_desc, full_desc, discount_pct, image_url, image_alt, is_active, is_featured, is_sample)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) returning id`,
          [v.sku, slug, v.name, v.category_id, v.subcategory, br.id, v.short_desc, v.full_desc, config.discountPct, `/img/${v.sku}.svg`, v.image_alt || `${v.name} product image`, v.is_active, v.is_featured])).rows[0].id;
        await t.query('insert into product_variants(product_id, sku, stock) values ($1,$2,$3)', [pid, v.sku + '-OS', Math.max(0, parseInt(b.stock, 10) || 0)]);
      }
      for (const cur of config.currencies) {
        await t.query(`insert into product_prices(product_id, currency, original_cents, discounted_cents) values ($1,$2,$3,$4)
          on conflict (product_id, currency) do update set original_cents=excluded.original_cents, discounted_cents=excluded.discounted_cents`, [pid, cur, v['price_' + cur], discounted(v['price_' + cur], config.discountPct)]);
      }
      return pid;
    });
    return { id: out, v };
  } catch (e) {
    if (e.code === '23505') return { errors: { sku: 'That SKU or product name/slug already exists. SKUs must be unique.' }, v };
    throw e;
  }
}
r.get('/admin/products/new', prodWrite, async (req, res) => res.send(await adminPage(req, 'Add product', productForm(req))));
r.post('/admin/products', prodWrite, async (req, res) => {
  const out = await saveProduct(req, null);
  if (out.errors) return res.status(400).send(await adminPage(req, 'Add product', productForm(req, { ...out.v, category_id: out.v.category_id }, [], out.errors)));
  await sec.audit(req, 'product.create', 'product', out.id, { sku: out.v.sku });
  res.redirect(`/admin/products/${out.id}/edit`);
});
async function loadProductForEdit(id) {
  const p = await db.one('select p.*, b.name brand from products p join brands b on b.id=p.brand_id where p.id=$1', [id]);
  if (!p) return null;
  for (const x of await db.many('select currency, original_cents from product_prices where product_id=$1', [id])) p['price_' + x.currency] = x.original_cents;
  return p;
}
r.get('/admin/products/:id/edit', prodWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10); const p = await loadProductForEdit(id);
  if (!p) return notFound(res);
  const variants = await db.many('select * from product_variants where product_id=$1 order by id', [id]);
  const images = await db.many('select id, url, alt from product_images where product_id=$1 order by position, id', [id]);
  res.send(await adminPage(req, 'Edit: ' + p.name, html`<div class="admin-cols"><div>${productForm(req, p, [], {}, false)}</div><div>
   <section aria-labelledby="v-h"><h2 id="v-h">Variants and stock</h2><table class="table"><thead><tr><th scope="col">Variant SKU</th><th scope="col">Size</th><th scope="col">Colour</th><th scope="col">Stock</th><th scope="col"><span class="visually-hidden">Save</span></th></tr></thead><tbody>
    ${variants.map((v) => html`<tr><th scope="row">${v.sku}</th><td>${v.size || '-'}</td><td>${v.color || '-'}</td><td colspan="2"><form method="post" action="/admin/products/${id}/variant/${v.id}" class="inline">${V.csrfInput(req.ctx)}<label class="visually-hidden" for="st-${v.id}">Stock for ${v.sku}</label><input id="st-${v.id}" class="qty" type="number" name="stock" min="0" max="100000" value="${v.stock}"><label><input type="checkbox" name="active" value="1" ${v.is_active ? raw('checked') : ''}> Active</label> <button class="btn btn-secondary" type="submit">Save</button></form></td></tr>`)}</tbody></table>
    <form method="post" action="/admin/products/${id}/variant" class="stack">${V.csrfInput(req.ctx)}<h3>Add variant</h3>${V.field({ id: 'v-sku', name: 'sku', label: 'Variant SKU', required: true })}${V.field({ id: 'v-size', name: 'size', label: 'Size (optional)' })}${V.field({ id: 'v-color', name: 'color', label: 'Colour (optional)' })}${V.field({ id: 'v-stock', name: 'stock', label: 'Stock', value: '0' })}<button class="btn" type="submit">Add variant</button></form></section>
   <section aria-labelledby="i-h"><h2 id="i-h">Images</h2><ul>${images.map((i) => html`<li><img src="${i.url}" alt="${i.alt}" width="120" height="90"> ${i.alt}</li>`)}</ul>
    <div class="stack" id="upload-box" data-product="${id}"><div class="field"><label for="img-file">Upload image (PNG, JPEG or WebP, max 1 MB)</label><input id="img-file" type="file" accept="image/png,image/jpeg,image/webp"></div>${V.field({ id: 'img-alt', label: 'Alternative text (describe the image)', required: true })}<button class="btn" type="button" id="img-upload">Upload</button><p role="status" id="img-status"></p></div></section>
   <section aria-labelledby="x-h"><h2 id="x-h">Archive or delete</h2><p><a class="btn btn-secondary" href="/admin/products/${id}/confirm/${p.is_active ? 'archive' : 'restore'}">${p.is_active ? 'Archive product' : 'Restore product'}</a> <a class="btn btn-danger" href="/admin/products/${id}/confirm/delete">Delete permanently</a></p></section></div></div>`));
});
r.post('/admin/products/:id', prodWrite, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next('route');
  const id = parseInt(req.params.id, 10);
  if (!(await db.one('select 1 from products where id=$1', [id]))) return notFound(res);
  const old = await db.one('select name, is_active, is_featured from products where id=$1', [id]);
  const oldPrices = await db.many('select currency, original_cents from product_prices where product_id=$1 order by currency', [id]);
  const out = await saveProduct(req, id);
  if (out.errors) { const p = await loadProductForEdit(id); return res.status(400).send(await adminPage(req, 'Edit: ' + p.name, productForm(req, { ...p, ...out.v, id }, [], out.errors, false))); }
  await sec.audit(req, 'product.update', 'product', id, { before: { ...old, prices: oldPrices }, after: { name: out.v.name, active: out.v.is_active, prices: config.currencies.map((c) => [c, out.v['price_' + c]]) } });
  res.redirect(`/admin/products/${id}/edit`);
});
r.post('/admin/products/:id/variant', prodWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10); const sku = str(req.body.sku, 60).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,59}$/.test(sku)) return res.status(400).type('text').send('Invalid variant SKU');
  try { await db.query('insert into product_variants(product_id, sku, size, color, stock) values ($1,$2,$3,$4,$5)', [id, sku, str(req.body.size, 30) || null, str(req.body.color, 30) || null, Math.max(0, parseInt(req.body.stock, 10) || 0)]); }
  catch (e) { if (e.code === '23505') return res.status(400).type('text').send('Variant SKU already exists'); throw e; }
  await sec.audit(req, 'variant.create', 'product', id, { sku });
  res.redirect(`/admin/products/${id}/edit`);
});
r.post('/admin/products/:id/variant/:vid', prodWrite, async (req, res) => {
  const stock = parseInt(req.body.stock, 10);
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return res.status(400).type('text').send('Invalid stock');
  const old = await db.one('select stock, is_active from product_variants where id=$1 and product_id=$2', [+req.params.vid, +req.params.id]);
  if (!old) return notFound(res);
  await db.query('update product_variants set stock=$3, is_active=$4 where id=$1 and product_id=$2', [+req.params.vid, +req.params.id, stock, req.body.active === '1']);
  await sec.audit(req, 'stock.update', 'variant', req.params.vid, { from: old.stock, to: stock });
  res.redirect(`/admin/products/${req.params.id}/edit`);
});
r.get('/admin/products/:id/confirm/:action', prodWrite, async (req, res) => {
  const p = await db.one('select id, name from products where id=$1', [+req.params.id]);
  const a = req.params.action;
  if (!p || !['archive', 'restore', 'delete'].includes(a)) return notFound(res);
  res.send(await adminPage(req, 'Confirm ' + a, html`<p>Are you sure you want to <strong>${a}</strong> "${p.name}"?${a === 'delete' ? ' Products that appear on orders cannot be deleted; archive them instead. This cannot be undone.' : ''}</p>
    <form method="post" action="/admin/products/${p.id}/${a}">${V.csrfInput(req.ctx)}<button class="btn ${a === 'delete' ? 'btn-danger' : ''}" type="submit">Yes, ${a}</button> <a class="btn btn-secondary" href="/admin/products/${p.id}/edit">Cancel</a></form>`));
});
for (const a of ['archive', 'restore', 'delete']) {
  r.post(`/admin/products/:id/${a}`, prodWrite, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (a === 'delete') {
      if (await db.one('select 1 from order_items where product_id=$1 limit 1', [id])) return res.status(409).send(await adminPage(req, 'Cannot delete', html`<p>This product is on existing orders, so it cannot be deleted. Archive it instead.</p>`));
      await db.query('delete from products where id=$1', [id]);
    } else await db.query('update products set is_active=$2, updated_at=now() where id=$1', [id, a === 'restore']);
    await sec.audit(req, 'product.' + a, 'product', id);
    res.redirect('/admin/products');
  });
}
r.post('/admin/products/bulk', prodWrite, async (req, res) => {
  const ids = [].concat(req.body.ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger).slice(0, 500);
  const action = req.body.action; const val = str(req.body.value, 20);
  if (!ids.length) return res.status(400).type('text').send('Select at least one product.');
  await db.tx(async (t) => {
    if (action === 'activate' || action === 'archive') await t.query('update products set is_active=$2, updated_at=now() where id = any($1::int[])', [ids, action === 'activate']);
    else if (action === 'feature' || action === 'unfeature') await t.query('update products set is_featured=$2, updated_at=now() where id = any($1::int[])', [ids, action === 'feature']);
    else if (action === 'price_pct') {
      const pct = parseFloat(val); if (!Number.isFinite(pct) || pct < -90 || pct > 500) throw Object.assign(new Error('Percent must be between -90 and 500'), { user: true });
      await t.query('update product_prices set original_cents = greatest(1, round(original_cents * (1 + $2::numeric / 100))::int) where product_id = any($1::int[])', [ids, pct]);
      await t.query(`update product_prices pp set discounted_cents = greatest(1, floor((pp.original_cents * (100 - p.discount_pct) + 50) / 100)::int) from products p where p.id = pp.product_id and pp.product_id = any($1::int[])`, [ids]);
    } else if (action === 'stock_set') {
      const n = parseInt(val, 10); if (!Number.isInteger(n) || n < 0 || n > 100000) throw Object.assign(new Error('Stock must be 0-100000'), { user: true });
      await t.query('update product_variants set stock=$2 where product_id = any($1::int[])', [ids, n]);
    } else throw Object.assign(new Error('Choose an action.'), { user: true });
  }).catch((e) => { if (e.user) { res.status(400).type('text').send(e.message); return 'x'; } throw e; });
  if (res.headersSent) return;
  await sec.audit(req, 'product.bulk.' + action, 'product', null, { count: ids.length, value: val });
  res.redirect('/admin/products');
});
r.post('/admin/products/:id/image', prodWrite, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '1mb' }), async (req, res) => {
  const id = parseInt(req.params.id, 10); const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 12) return res.status(415).json({ error: 'Unsupported file type.' });
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : null;
  if (!mime || mime !== req.headers['content-type']) return res.status(415).json({ error: 'File content does not match an allowed image type.' });
  const alt = str(decodeURIComponent(req.headers['x-alt'] || ''), 200);
  if (!alt) return res.status(400).json({ error: 'Alternative text is required.' });
  if (!(await db.one('select 1 from products where id=$1', [id]))) return res.status(404).json({ error: 'Not found' });
  const up = await db.one('insert into uploads(mime, data, created_by) values ($1,$2,$3) returning id', [mime, buf, req.user.id]);
  const url = `/media/${up.id}`;
  await db.query('insert into product_images(product_id, url, alt, position) values ($1,$2,$3,(select coalesce(max(position),0)+1 from product_images where product_id=$1))', [id, url, alt]);
  await db.query(`update products set image_url=$2, image_alt=$3, updated_at=now() where id=$1 and (select count(*) from product_images where product_id=$1) = 1`, [id, url, alt]);
  await sec.audit(req, 'product.image', 'product', id, { upload: up.id, mime });
  res.json({ ok: true, url });
});
r.get('/admin/products/export.csv', prodWrite, async (req, res) => {
  const rows = await db.many(`select p.sku, p.name, c.code sport_code, p.subcategory, b.name brand, p.short_desc, p.full_desc, p.is_active, p.is_featured,
    max(case when pr.currency='USD' then pr.original_cents end) usd, max(case when pr.currency='GBP' then pr.original_cents end) gbp, max(case when pr.currency='CAD' then pr.original_cents end) cad,
    (select coalesce(sum(stock),0)::int from product_variants v where v.product_id=p.id) stock
    from products p join categories c on c.id=p.category_id join brands b on b.id=p.brand_id left join product_prices pr on pr.product_id=p.id group by p.id, c.code, b.name order by p.sku`);
  const head = ['sku', 'name', 'sport_code', 'subcategory', 'brand', 'short_desc', 'full_desc', 'price_usd', 'price_gbp', 'price_cad', 'stock', 'active', 'featured'];
  const lines = [head.join(',')].concat(rows.map((x) => [x.sku, x.name, x.sport_code, x.subcategory, x.brand, x.short_desc, x.full_desc, (x.usd / 100).toFixed(2), (x.gbp / 100).toFixed(2), (x.cad / 100).toFixed(2), x.stock, x.is_active, x.is_featured].map(csvCell).join(',')));
  await sec.audit(req, 'product.export', 'product', null, { rows: rows.length });
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="globalsport-products.csv"').send(lines.join('\r\n'));
});
r.get('/admin/products/import', prodWrite, async (req, res) => res.send(await adminPage(req, 'Import products (CSV)', html`<p>Paste CSV with the header: <code>sku,name,sport_code,subcategory,brand,short_desc,full_desc,price_usd,price_gbp,price_cad,stock</code>. Existing SKUs are updated; new SKUs are created. Discounted prices are calculated by the server. Max 2,000 rows.</p>
  <form method="post" action="/admin/products/import" class="stack">${V.csrfInput(req.ctx)}${V.field({ id: 'csv', label: 'CSV data', type: 'textarea', rows: 14, required: true })}<button class="btn" type="submit">Import</button></form>`)));
r.post('/admin/products/import', prodWrite, async (req, res) => {
  const rows = parseCsv(String(req.body.csv || '').slice(0, 5000000));
  const head = rows.shift() || []; const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const need = ['sku', 'name', 'sport_code', 'subcategory', 'brand', 'short_desc', 'full_desc', 'price_usd', 'price_gbp', 'price_cad'];
  const missing = need.filter((n) => !(n in idx));
  if (missing.length) return res.status(400).send(await adminPage(req, 'Import failed', html`<p class="alert alert-error">Missing columns: ${missing.join(', ')}</p>`));
  const cats = Object.fromEntries((await db.many('select id, code from categories')).map((c) => [c.code, c.id]));
  let ok = 0; const errs = [];
  for (const [n, row] of rows.slice(0, 2000).entries()) {
    const g = (k) => (row[idx[k]] ?? '').trim();
    const prices = config.currencies.map((c) => parseMoney(g('price_' + c.toLowerCase())));
    const sku = g('sku').toUpperCase();
    const e = [];
    if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(sku)) e.push('invalid SKU'); if (!g('name')) e.push('name required'); if (!cats[g('sport_code')]) e.push('unknown sport_code');
    if (!g('subcategory') || !g('brand') || !g('short_desc') || !g('full_desc')) e.push('missing text field'); if (prices.some((p) => !(p > 0))) e.push('invalid price');
    if (e.length) { errs.push(`Row ${n + 2} (${sku || 'no SKU'}): ${e.join(', ')}`); continue; }
    try {
      await db.tx(async (t) => {
        const br = (await t.query('insert into brands(name) values ($1) on conflict (name) do update set name=excluded.name returning id', [g('brand')])).rows[0];
        let slug = slugify(g('name')); if ((await t.query('select 1 from products where slug=$1 and sku<>$2', [slug, sku])).rows.length) slug += '-' + sku.toLowerCase();
        const p = (await t.query(`insert into products(sku, slug, name, category_id, subcategory, brand_id, short_desc, full_desc, discount_pct, image_url, image_alt, is_sample)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false) on conflict (sku) do update set name=excluded.name, category_id=excluded.category_id, subcategory=excluded.subcategory, brand_id=excluded.brand_id, short_desc=excluded.short_desc, full_desc=excluded.full_desc, discount_pct=excluded.discount_pct, updated_at=now() returning id`,
          [sku, slug, g('name'), cats[g('sport_code')], g('subcategory'), br.id, g('short_desc'), g('full_desc'), config.discountPct, `/img/${sku}.svg`, `${g('name')} product image`])).rows[0];
        for (const [i, c] of config.currencies.entries()) await t.query(`insert into product_prices(product_id, currency, original_cents, discounted_cents) values ($1,$2,$3,$4) on conflict (product_id, currency) do update set original_cents=excluded.original_cents, discounted_cents=excluded.discounted_cents`, [p.id, c, prices[i], discounted(prices[i], config.discountPct)]);
        if ('stock' in idx && g('stock') !== '') {
          const st = parseInt(g('stock'), 10); if (!(st >= 0)) throw Object.assign(new Error('invalid stock'), { user: true });
          await t.query(`insert into product_variants(product_id, sku, stock) values ($1,$2,$3) on conflict (sku) do update set stock=excluded.stock`, [p.id, sku + '-OS', st]);
        }
      });
      ok++;
    } catch (e) { errs.push(`Row ${n + 2} (${sku}): ${e.user ? e.message : 'database error (' + (e.code || 'unknown') + ')'}`); }
  }
  await sec.audit(req, 'product.import', 'product', null, { ok, failed: errs.length });
  res.send(await adminPage(req, 'Import result', html`<p class="alert ${errs.length ? 'alert-warning' : 'alert-info'}" role="status">${ok} row(s) imported, ${errs.length} failed.</p>${errs.length ? html`<h2>Errors</h2><ul>${errs.slice(0, 200).map((x) => html`<li>${x}</li>`)}</ul>` : ''}`));
});
r.get('/admin/products/sku-check', prodWrite, async (req, res) => {
  const t = await db.one(`select count(*)::int total, count(distinct sku)::int d from products`);
  const vt = await db.one(`select count(*)::int total, count(distinct sku)::int d from product_variants`);
  const noPrice = await db.one(`select count(*)::int n from products p where (select count(*) from product_prices pp where pp.product_id=p.id) < 3`);
  const wrong = await db.one(`select count(*)::int n from product_prices pp join products p on p.id=pp.product_id where pp.discounted_cents <> floor((pp.original_cents * (100 - p.discount_pct) + 50) / 100)::int`);
  res.send(await adminPage(req, 'SKU and price validation', html`<table class="table"><tbody>
   <tr><th scope="row">Product records</th><td>${t.total} (${t.d} distinct SKUs) - ${t.total === t.d ? 'PASS: all unique' : 'FAIL: duplicates'}</td></tr>
   <tr><th scope="row">Variant records</th><td>${vt.total} (${vt.d} distinct) - ${vt.total === vt.d ? 'PASS' : 'FAIL'}</td></tr>
   <tr><th scope="row">Products missing a USD/GBP/CAD price</th><td>${noPrice.n} - ${noPrice.n === 0 ? 'PASS' : 'FAIL'}</td></tr>
   <tr><th scope="row">Discounted price not equal to list price less discount %</th><td>${wrong.n} - ${wrong.n === 0 ? 'PASS' : 'FAIL'}</td></tr>
   <tr><th scope="row">Minimum 2,000 distinct products</th><td>${t.d >= 2000 ? 'PASS' : 'FAIL'}</td></tr></tbody></table>`));
});

// ---------- orders ----------
const ordRead = [sec.requirePerm('orders.read')]; const ordWrite = [sec.requirePerm('orders.write')];
r.get('/admin/orders', ordRead, async (req, res) => {
  const status = str(req.query.status, 30); const q = str(req.query.q, 60); const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const params = []; const w = ['true'];
  if (S.STATUS_LABELS[status]) { params.push(status); w.push(`status=$${params.length}`); }
  if (q) { params.push('%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'); w.push(`(ref ilike $${params.length} or email ilike $${params.length} or customer_name ilike $${params.length})`); }
  const where = w.join(' and ');
  const total = (await db.one(`select count(*)::int n from orders where ${where}`, params)).n;
  const rows = await db.many(`select id, ref, customer_name, email, status, currency, total_cents, created_at from orders where ${where} order by created_at desc, id desc limit ${PAGE} offset ${(page - 1) * PAGE}`, params);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  res.send(await adminPage(req, 'Orders and enquiries', html`<form class="filters inline-filters" method="get" action="/admin/orders">${V.field({ id: 'q', label: 'Search reference, name or email', value: q })}${V.field({ id: 'status', label: 'Status', type: 'select', value: status, options: [['', 'All'], ...Object.entries(S.STATUS_LABELS)] })}<button class="btn" type="submit">Filter</button></form>
   <p role="status">${total} order(s).</p>${rows.length ? html`<table class="table"><thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Created</th></tr></thead><tbody>${rows.map((o) => html`<tr><th scope="row"><a href="/admin/orders/${o.id}">${o.ref}</a></th><td>${o.customer_name}<br><span class="small">${o.email}</span></td><td>${V.statusBadge(o.status)}</td><td>${fmt(o.total_cents, o.currency)}</td><td>${dt(o.created_at)}</td></tr>`)}</tbody></table>` : html`<div class="empty"><p>No orders or enquiries yet.</p></div>`}
   ${V.pagination(Math.min(page, pages), pages, (n) => '/admin/orders?' + new URLSearchParams({ q, status, page: n }))}`));
});
r.get('/admin/orders/:id', ordRead, async (req, res) => {
  const o = await db.one('select o.*, e.message, e.contact_preference from orders o left join order_enquiries e on e.order_id=o.id where o.id=$1', [+req.params.id]);
  if (!o) return notFound(res);
  const [items, notes, hist, pays, refunds] = await Promise.all([
    db.many('select * from order_items where order_id=$1 order by id', [o.id]),
    db.many('select n.*, u.email from order_notes n left join users u on u.id=n.user_id where order_id=$1 order by n.id desc', [o.id]),
    db.many('select h.*, u.email from order_status_history h left join users u on u.id=h.changed_by where order_id=$1 order by h.id', [o.id]),
    db.many('select * from payment_records where order_id=$1 order by id', [o.id]), db.many('select * from refund_records where order_id=$1 order by id', [o.id])]);
  const canWrite = await sec.can(req.user, 'orders.write'); const canPay = await sec.can(req.user, 'payments.confirm');
  const next = S.TRANSITIONS[o.status].filter((s) => s !== 'payment_confirmed' || canPay);
  res.send(await adminPage(req, 'Order ' + o.ref, html`<p>${V.statusBadge(o.status)} · Created ${dt(o.created_at)} · ${o.currency}</p>
   <section aria-labelledby="oc"><h2 id="oc">Customer</h2><p>${o.customer_name} · ${o.email} · ${o.country} · contact by ${o.contact_preference}${o.user_id ? ' · registered customer' : ' · guest'}</p><p>Message: ${o.message || '(none)'}</p></section>
   <section aria-labelledby="oi"><h2 id="oi">Items</h2><table class="table"><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">List</th><th scope="col">Sale</th></tr></thead><tbody>${items.map((i) => html`<tr><th scope="row">${i.name}<br><span class="small">${i.sku}</span></th><td>${i.qty}</td><td>${fmt(i.unit_original_cents, o.currency)}</td><td>${fmt(i.unit_price_cents, o.currency)}</td></tr>`)}</tbody></table>
   <dl class="dl"><dt>Subtotal</dt><dd>${fmt(o.subtotal_cents, o.currency)}</dd><dt>Discount included</dt><dd>${fmt(o.discount_cents, o.currency)}</dd><dt>Shipping</dt><dd>${fmt(o.shipping_cents, o.currency)}</dd><dt class="total">Total</dt><dd class="total">${fmt(o.total_cents, o.currency)}</dd></dl></section>
   ${canWrite ? html`<section aria-labelledby="os"><h2 id="os">Change status</h2>
     ${next.length ? next.map((s) => s === 'payment_confirmed'
       ? html`<form method="post" action="/admin/orders/${o.id}/status" class="stack narrow card-pad">${V.csrfInput(req.ctx)}<input type="hidden" name="status" value="payment_confirmed"><h3>Confirm payment</h3><p class="small">Only after you have independently verified that the money was received. This deducts stock.</p>
          ${V.field({ id: 'pay-ref', name: 'reference', label: 'Payment reference (bank/transfer/receipt ID)', required: true })}${V.field({ id: 'pay-method', name: 'method', label: 'Method', required: true, value: 'bank transfer' })}${V.field({ id: 'pay-amt', name: 'amount', label: `Amount received (${o.currency})`, required: true, value: (o.total_cents / 100).toFixed(2) })}${V.field({ id: 'pay-ok', name: 'verified', type: 'checkbox', label: 'I have verified this payment outside this website.' })}<button class="btn" type="submit">Confirm payment</button></form>`
       : html`<form method="post" action="/admin/orders/${o.id}/status" class="inline">${V.csrfInput(req.ctx)}<input type="hidden" name="status" value="${s}">${s === 'shipped' ? html`<label class="visually-hidden" for="trk">Tracking information</label><input id="trk" name="tracking" placeholder="Carrier / tracking no." maxlength="200"> ` : ''}<button class="btn ${s === 'cancelled' ? 'btn-danger' : 'btn-secondary'}" type="submit">${S.STATUS_LABELS[s]}</button></form>`) : html`<p>No further status changes are available.</p>`}
     ${o.tracking_info ? html`<p>Tracking: ${o.tracking_info}</p>` : ''}</section>
    <section aria-labelledby="orf"><h2 id="orf">Record a refund</h2><form method="post" action="/admin/orders/${o.id}/refund" class="stack narrow">${V.csrfInput(req.ctx)}${V.field({ id: 'rf-amt', name: 'amount', label: `Refund amount (${o.currency})`, required: true })}${V.field({ id: 'rf-why', name: 'reason', label: 'Reason', required: true })}<button class="btn btn-secondary" type="submit">Record refund</button></form><p class="small">Recording a refund does not move money; issue it through your payment channel first. A full refund of a paid order sets the status to Refunded.</p></section>` : ''}
   <section aria-labelledby="oh"><h2 id="oh">History</h2><ul>${hist.map((h) => html`<li>${dt(h.created_at)} - ${S.STATUS_LABELS[h.status]} ${h.email ? '(' + h.email + ')' : '(customer action)'}</li>`)}</ul>
     ${pays.length ? html`<h3>Payments recorded</h3><ul>${pays.map((p) => html`<li>${fmt(p.amount_cents, p.currency)} via ${p.method}, ref ${p.reference}, ${dt(p.confirmed_at)}</li>`)}</ul>` : ''}
     ${refunds.length ? html`<h3>Refunds recorded</h3><ul>${refunds.map((p) => html`<li>${fmt(p.amount_cents, p.currency)} - ${p.reason}, ${dt(p.created_at)}</li>`)}</ul>` : ''}</section>
   <section aria-labelledby="on"><h2 id="on">Internal notes</h2>${canWrite ? html`<form method="post" action="/admin/orders/${o.id}/note" class="stack narrow">${V.csrfInput(req.ctx)}${V.field({ id: 'note', label: 'Add note', type: 'textarea', required: true, maxlength: 1000 })}<button class="btn" type="submit">Add note</button></form>` : ''}<ul>${notes.map((n) => html`<li>${dt(n.created_at)} ${n.email || ''}: ${n.note}</li>`)}</ul></section>`));
});
r.post('/admin/orders/:id/status', ordWrite, async (req, res) => {
  const id = parseInt(req.params.id, 10); const next = str(req.body.status, 30);
  if (!S.STATUS_LABELS[next]) return res.status(400).type('text').send('Unknown status');
  const extra = {};
  if (next === 'payment_confirmed') {
    if (!(await sec.can(req.user, 'payments.confirm'))) return res.status(403).type('text').send('Forbidden');
    if (req.body.verified !== '1') return res.status(400).type('text').send('You must tick the verification box.');
    extra.payment = { reference: str(req.body.reference, 100), method: str(req.body.method, 50), amount_cents: parseMoney(req.body.amount || '') };
  }
  if (next === 'shipped') extra.tracking = str(req.body.tracking, 200) || null;
  try {
    const out = await S.setOrderStatus(req, id, next, extra);
    await sec.audit(req, 'order.status', 'order', id, { ...out, payment: extra.payment ? { ref: extra.payment.reference, amount: extra.payment.amount_cents } : undefined });
  } catch (e) { if (e.user) return res.status(400).send(await adminPage(req, 'Cannot change status', html`<p class="alert alert-error" role="alert">${e.message}</p><a href="/admin/orders/${id}">Back to order</a>`)); throw e; }
  res.redirect('/admin/orders/' + id);
});
r.post('/admin/orders/:id/note', ordWrite, async (req, res) => {
  const note = str(req.body.note, 1000); if (!note) return res.status(400).type('text').send('Empty note');
  if (!(await db.one('select 1 from orders where id=$1', [+req.params.id]))) return notFound(res);
  await db.query('insert into order_notes(order_id, user_id, note) values ($1,$2,$3)', [+req.params.id, req.user.id, note]);
  await sec.audit(req, 'order.note', 'order', req.params.id);
  res.redirect('/admin/orders/' + req.params.id);
});
r.post('/admin/orders/:id/refund', ordWrite, async (req, res) => {
  const id = +req.params.id; const amt = parseMoney(req.body.amount || ''); const reason = str(req.body.reason, 300);
  const o = await db.one('select * from orders where id=$1', [id]);
  if (!o) return notFound(res);
  const paid = (await db.one('select coalesce(sum(amount_cents),0)::int s from payment_records where order_id=$1', [id])).s;
  const refunded = (await db.one('select coalesce(sum(amount_cents),0)::int s from refund_records where order_id=$1', [id])).s;
  if (!(amt > 0) || !reason || paid === 0 || refunded + amt > paid) return res.status(400).send(await adminPage(req, 'Refund not recorded', html`<p class="alert alert-error" role="alert">A refund needs a reason and an amount that does not exceed the payments recorded (${fmt(paid, o.currency)} paid, ${fmt(refunded, o.currency)} already refunded).</p><a href="/admin/orders/${id}">Back</a>`));
  await db.query('insert into refund_records(order_id, amount_cents, currency, reason, recorded_by) values ($1,$2,$3,$4,$5)', [id, amt, o.currency, reason, req.user.id]);
  if (refunded + amt === paid && S.TRANSITIONS[o.status].includes('refunded')) await S.setOrderStatus(req, id, 'refunded');
  await sec.audit(req, 'order.refund', 'order', id, { amount_cents: amt, reason });
  res.redirect('/admin/orders/' + id);
});

// ---------- customers & deletion ----------
r.get('/admin/customers', sec.requirePerm('customers.read'), async (req, res) => {
  const rows = await db.many(`select u.id, u.name, u.email, u.status, u.created_at, (select count(*)::int from orders o where o.user_id=u.id) orders from users u where u.role='customer' order by u.id desc limit 200`);
  res.send(await adminPage(req, 'Customers', html`<p class="small">Personal data. Access is logged.</p><table class="table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Enquiries</th><th scope="col">Joined</th></tr></thead><tbody>${rows.map((u) => html`<tr><th scope="row">${u.name}</th><td>${u.email}</td><td>${u.status}</td><td>${u.orders}</td><td>${dt(u.created_at)}</td></tr>`)}</tbody></table>${rows.length ? '' : html`<p>No customers have registered yet.</p>`}`));
  await sec.audit(req, 'customers.view', 'user', null);
});
r.get('/admin/deletions', sec.requirePerm('customers.write'), async (req, res) => {
  const rows = await db.many('select * from deletion_requests order by (status=\'open\') desc, id desc limit 100');
  res.send(await adminPage(req, 'Data deletion requests', html`<p class="small">Verify the requester's identity (for example by replying from the account email) before completing a request. Orders that are still active must be cancelled or completed first. Completed requests anonymise personal data; order totals and items are retained for accounting.</p>
   ${rows.length ? html`<table class="table"><thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Received</th><th scope="col">Action</th></tr></thead><tbody>${rows.map((d) => html`<tr><th scope="row">${d.email}<br><span class="small">${d.details}</span></th><td>${d.status}${d.resolution_note ? ' - ' + d.resolution_note : ''}</td><td>${dt(d.created_at)}</td><td>${d.status === 'open' ? html`<form method="post" action="/admin/deletions/${d.id}" class="inline">${V.csrfInput(req.ctx)}<label class="visually-hidden" for="n-${d.id}">Note</label><input id="n-${d.id}" name="note" placeholder="Note" maxlength="300"><button class="btn btn-danger" name="decision" value="complete" type="submit">Delete data</button><button class="btn btn-secondary" name="decision" value="reject" type="submit">Reject</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p>No deletion requests.</p>`}`));
});
async function anonymise(t, email, userId) {
  const active = (await t.query(`select ref from orders where (lower(email)=lower($1) or user_id=$2) and status in ('pending_enquiry','awaiting_payment','payment_confirmed','processing','shipped')`, [email, userId])).rows;
  if (active.length) throw Object.assign(new Error(`Active orders must be completed or cancelled first: ${active.map((a) => a.ref).join(', ')}`), { user: true });
  await t.query(`update orders set customer_name='Deleted customer', email='deleted-order-' || id || '@deleted.invalid', country='Deleted', user_id=null, session_hash=null where lower(email)=lower($1) or user_id=$2`, [email, userId]);
  await t.query(`update order_enquiries set message='' where order_id in (select id from orders where email like 'deleted-order-%')`);
  await t.query('delete from newsletter_subscriptions where lower(email)=lower($1)', [email]);
  await t.query('delete from offline_enquiries where lower(email)=lower($1)', [email]);
  if (userId) {
    await t.query(`update users set email='deleted-user-' || id || '@deleted.invalid', name='Deleted user', password_hash=null, status='deleted', agent_online=false where id=$1 and role='customer'`, [userId]);
    await t.query('delete from sessions where user_id=$1', [userId]);
    await t.query('delete from carts where user_id=$1', [userId]); await t.query('delete from wishlists where user_id=$1', [userId]);
    await t.query('delete from reviews where user_id=$1', [userId]); await t.query('delete from password_resets where user_id=$1', [userId]);
    await t.query('delete from support_conversations where user_id=$1', [userId]);
  }
}
r.post('/admin/deletions/:id', sec.requirePerm('customers.write'), async (req, res) => {
  const d = await db.one('select * from deletion_requests where id=$1 and status=\'open\'', [+req.params.id]);
  if (!d) return notFound(res);
  const note = str(req.body.note, 300);
  try {
    await db.tx(async (t) => {
      if (req.body.decision === 'complete') {
        const u = (await t.query(`select id from users where lower(email)=lower($1) and role='customer'`, [d.email])).rows[0];
        await anonymise(t, d.email, u ? u.id : (d.user_id || 0));
        await t.query(`update deletion_requests set status='completed', processed_by=$2, processed_at=now(), resolution_note=$3, email='removed', details='' where id=$1`, [d.id, req.user.id, note || 'Personal data removed or anonymised; order financial records retained.']);
      } else await t.query(`update deletion_requests set status='rejected', processed_by=$2, processed_at=now(), resolution_note=$3 where id=$1`, [d.id, req.user.id, note || 'Rejected']);
    });
  } catch (e) { if (e.user) return res.status(409).send(await adminPage(req, 'Cannot complete', html`<p class="alert alert-error" role="alert">${e.message}</p><a href="/admin/deletions">Back</a>`)); throw e; }
  await sec.audit(req, 'deletion.' + req.body.decision, 'deletion_request', d.id);
  res.redirect('/admin/deletions');
});

// ---------- support console ----------
r.get('/admin/support', sec.requirePerm('support.chat'), async (req, res) => {
  const me = await db.one('select agent_online from users where id=$1', [req.user.id]);
  const off = await db.many('select * from offline_enquiries order by handled, id desc limit 30');
  const esc = await db.many(`select created_at from ai_usage_logs where escalated order by id desc limit 10`);
  res.send(await adminPage(req, 'Support inbox', html`<p><button class="btn" id="presence" type="button" aria-pressed="${me.agent_online}" data-online="${me.agent_online}">${me.agent_online ? 'You are online - go offline' : 'You are offline - go online'}</button> <span class="small">Customers only see live chat as available while at least one agent is online with this page open.</span></p>
   <div class="support-grid"><section aria-labelledby="cl-h"><h2 id="cl-h">Conversations</h2><p role="status" id="support-live" class="visually-hidden"></p><ul id="conv-list" class="conv-list"></ul></section>
   <section aria-labelledby="th-h"><h2 id="th-h">Conversation</h2><div id="thread" class="thread" tabindex="0" role="log" aria-live="polite"><p>Select a conversation.</p></div>
    <form id="reply-form" class="stack" hidden><label for="reply-body">Reply</label><textarea id="reply-body" rows="3" maxlength="2000" required></textarea><div><button class="btn" type="submit">Send</button> <button class="btn btn-secondary" type="button" id="assign-btn">Assign to me</button> <button class="btn btn-secondary" type="button" id="close-btn">Close</button> <button class="btn btn-danger" type="button" id="block-btn">Block sender</button></div></form></section></div>
   <section aria-labelledby="off-h"><h2 id="off-h">Offline enquiries</h2>${off.length ? html`<ul>${off.map((o) => html`<li><strong>${o.name}</strong> (${o.email}) ${dt(o.created_at)}${o.handled ? ' - handled' : ''}<br>${o.message}${o.handled ? '' : html`<form method="post" action="/admin/support/enquiries/${o.id}/handled" class="inline">${V.csrfInput(req.ctx)}<button class="btn btn-secondary" type="submit">Mark handled</button></form>`}</li>`)}</ul>` : html`<p>No offline enquiries.</p>`}</section>
   <section aria-labelledby="ai-h"><h2 id="ai-h">AI escalation queue</h2><p class="small">Times when a customer asked the AI assistant for a human (message text is not stored).</p>${esc.length ? html`<ul>${esc.map((e) => html`<li>${dt(e.created_at)}</li>`)}</ul>` : html`<p>None.</p>`}</section>`));
});
r.post('/admin/support/enquiries/:id/handled', sec.requirePerm('support.chat'), async (req, res) => { await db.query('update offline_enquiries set handled=true where id=$1', [+req.params.id]); res.redirect('/admin/support'); });

// ---------- reviews & audit ----------
r.get('/admin/reviews', sec.requirePerm('reviews.moderate'), async (req, res) => {
  const rows = await db.many(`select r.id, r.rating, r.body, r.status, p.name pname, u.name uname from reviews r join products p on p.id=r.product_id join users u on u.id=r.user_id order by (r.status='pending') desc, r.id desc limit 100`);
  res.send(await adminPage(req, 'Review moderation', rows.length ? html`<ul>${rows.map((x) => html`<li><strong>${x.pname}</strong> - ${x.rating}/5 by ${x.uname} (${x.status})<br>${x.body}<form method="post" action="/admin/reviews/${x.id}" class="inline">${V.csrfInput(req.ctx)}<button class="btn" name="d" value="approved" type="submit">Approve</button><button class="btn btn-secondary" name="d" value="rejected" type="submit">Reject</button></form></li>`)}</ul>` : html`<p>No reviews submitted. Reviews are only accepted from customers with a delivered order.</p>`));
});
r.post('/admin/reviews/:id', sec.requirePerm('reviews.moderate'), async (req, res) => {
  if (!['approved', 'rejected'].includes(req.body.d)) return res.status(400).end();
  await db.query('update reviews set status=$2 where id=$1', [+req.params.id, req.body.d]);
  await sec.audit(req, 'review.' + req.body.d, 'review', req.params.id);
  res.redirect('/admin/reviews');
});
r.get('/admin/audit', sec.requirePerm('audit.read'), async (req, res) => {
  const rows = await db.many('select * from audit_logs order by id desc limit 200');
  res.send(await adminPage(req, 'Audit log', html`<table class="table"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Detail</th><th scope="col">IP</th></tr></thead><tbody>${rows.map((a) => html`<tr><td>${dt(a.created_at)}</td><td>${a.actor_email || ''}</td><td>${a.action}</td><td>${a.entity || ''} ${a.entity_id || ''}</td><td class="small">${JSON.stringify(a.detail).slice(0, 300)}</td><td>${a.ip || ''}</td></tr>`)}</tbody></table>`));
});
module.exports = r;
