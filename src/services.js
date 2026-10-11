const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { discounted, shippingFor } = require('./pricing');
const { parseCookies } = require('./security');

const currencyOf = (req) => {
  const c = parseCookies(req).gs_cur;
  return config.currencies.includes(c) ? c : 'USD';
};

const BASE_SELECT = `
 select p.id, p.sku, p.slug, p.name, p.subcategory, p.image_url, p.image_alt, p.discount_pct, p.is_featured, p.short_desc,
   c.name as sport, c.slug as sport_slug, b.name as brand, pr.original_cents,
   coalesce((select sum(v.stock) from product_variants v where v.product_id = p.id and v.is_active), 0)::int as stock,
   (select count(*)::int from product_variants v where v.product_id = p.id and v.is_active) as nvariants,
   (select v.id from product_variants v where v.product_id = p.id and v.is_active order by v.id limit 1) as first_variant,
   (select round(avg(r.rating), 1)::float from reviews r where r.product_id = p.id and r.status = 'approved') as avg_rating,
   (select count(*)::int from reviews r where r.product_id = p.id and r.status = 'approved') as review_count
 from products p
 join categories c on c.id = p.category_id
 join brands b on b.id = p.brand_id
 join product_prices pr on pr.product_id = p.id and pr.currency = $1`;

function withPrice(p) { return p && { ...p, price_cents: discounted(p.original_cents, p.discount_pct) }; }

const likeEsc = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const SORTS = {
  price_asc: 'pr.discounted_cents asc, p.id',
  price_desc: 'pr.discounted_cents desc, p.id',
  newest: 'p.created_at desc, p.id desc',
  name: 'lower(p.name) asc, p.id',
  popular: `(select coalesce(sum(oi.qty),0) from order_items oi join orders o on o.id = oi.order_id
             where oi.product_id = p.id and o.status in ('payment_confirmed','processing','shipped','delivered')) desc, lower(p.name), p.id`,
};

function buildWhere(f, cur) {
  const params = [cur]; const w = ['p.is_active = true'];
  const add = (v) => { params.push(v); return '$' + params.length; };
  if (f.sport) w.push(`c.slug = ${add(f.sport)}`);
  if (f.type) w.push(`p.subcategory = ${add(f.type)}`);
  if (f.brand) w.push(`b.name = ${add(f.brand)}`);
  if (Number.isFinite(f.min)) w.push(`pr.discounted_cents >= ${add(Math.round(f.min * 100))}`);
  if (Number.isFinite(f.max)) w.push(`pr.discounted_cents <= ${add(Math.round(f.max * 100))}`);
  if (f.size) w.push(`exists (select 1 from product_variants v where v.product_id = p.id and v.is_active and v.size = ${add(f.size)})`);
  if (f.color) w.push(`exists (select 1 from product_variants v where v.product_id = p.id and v.is_active and v.color = ${add(f.color)})`);
  if (f.inStock) w.push('exists (select 1 from product_variants v where v.product_id = p.id and v.is_active and v.stock > 0)');
  if (f.minRating) w.push(`(select avg(r.rating) from reviews r where r.product_id = p.id and r.status = 'approved') >= ${add(f.minRating)}`);
  if (f.featured) w.push('p.is_featured = true');
  if (f.q) {
    for (const term of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
      const n = add('%' + likeEsc(term) + '%');
      w.push(`(p.name ilike ${n} or p.sku ilike ${n} or c.name ilike ${n} or b.name ilike ${n} or p.subcategory ilike ${n})`);
    }
  }
  return { where: w.join(' and '), params };
}

async function listProducts(f, cur, page = 1, pageSize = config.pageSize) {
  const { where, params } = buildWhere(f, cur);
  const order = SORTS[f.sort] || SORTS.newest;
  const total = (await db.one(`select count(*)::int n from products p join categories c on c.id=p.category_id join brands b on b.id=p.brand_id
     join product_prices pr on pr.product_id=p.id and pr.currency=$1 where ${where}`, params)).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pg = Math.min(Math.max(1, page), pages);
  const rows = await db.many(`${BASE_SELECT} where ${where} order by ${order} limit ${pageSize} offset ${(pg - 1) * pageSize}`, params);
  return { rows: rows.map(withPrice), total, page: pg, pages };
}

async function getProduct(slug, cur) {
  const p = await db.one(`${BASE_SELECT} where p.slug = $2 and p.is_active = true`, [cur, slug]);
  if (!p) return null;
  const full = await db.one('select full_desc, specs, weight_g, dimensions, is_sample from products where id=$1', [p.id]);
  const variants = await db.many('select id, sku, size, color, stock from product_variants where product_id=$1 and is_active order by id', [p.id]);
  const images = await db.many('select url, alt from product_images where product_id=$1 order by position, id', [p.id]);
  const reviews = await db.many(`select r.rating, r.body, r.created_at, u.name from reviews r join users u on u.id=r.user_id where r.product_id=$1 and r.status='approved' order by r.created_at desc limit 20`, [p.id]);
  return { ...withPrice(p), ...full, variants, images: images.length ? images : [{ url: p.image_url, alt: p.image_alt }], reviews };
}

async function byIds(ids, cur) {
  if (!ids.length) return [];
  const rows = await db.many(`${BASE_SELECT} where p.id = any($2::int[]) and p.is_active = true`, [cur, ids]);
  const m = new Map(rows.map((r) => [r.id, withPrice(r)]));
  return ids.map((i) => m.get(i)).filter(Boolean);
}

async function facets(sportSlug) {
  const args = sportSlug ? [sportSlug] : [];
  const cat = sportSlug ? 'and c.slug = $1' : '';
  const base = `from products p join categories c on c.id=p.category_id join brands b on b.id=p.brand_id where p.is_active ${cat}`;
  const types = (await db.many(`select distinct p.subcategory v ${base} order by 1`, args)).map((r) => r.v);
  const brands = (await db.many(`select distinct b.name v ${base} order by 1`, args)).map((r) => r.v);
  const vbase = `from product_variants v join products p on p.id=v.product_id join categories c on c.id=p.category_id where p.is_active and v.is_active ${cat}`;
  const sizes = (await db.many(`select distinct v.size s ${vbase} and v.size is not null order by 1`, args)).map((r) => r.s);
  const colors = (await db.many(`select distinct v.color s ${vbase} and v.color is not null order by 1`, args)).map((r) => r.s);
  return { types, brands, sizes, colors };
}

async function suggest(q) {
  if (!q || q.length < 2) return [];
  const n = '%' + likeEsc(q.slice(0, 60)) + '%';
  return db.many(`select p.name, p.slug, p.sku from products p where p.is_active and (p.name ilike $1 or p.sku ilike $1) order by length(p.name), p.name limit 8`, [n]);
}

// ---------- carts & wishlists ----------
async function ownerRow(table, req, create) {
  const col = req.user ? 'user_id' : 'session_hash';
  const val = req.user ? req.user.id : req.session.token_hash;
  let row = await db.one(`select * from ${table} where ${col} = $1`, [val]);
  if (!row && create) {
    row = await db.one(`insert into ${table}(${col}) values ($1) on conflict (${col}) do update set ${col} = excluded.${col} returning *`, [val]);
  }
  return row;
}
async function mergeGuestIntoUser(guestHash, userId) {
  await db.tx(async (t) => {
    for (const [table, items, key] of [['carts', 'cart_items', 'cart_id'], ['wishlists', 'wishlist_items', 'wishlist_id']]) {
      const g = (await t.query(`select id from ${table} where session_hash=$1`, [guestHash])).rows[0];
      if (!g) continue;
      let u = (await t.query(`select id from ${table} where user_id=$1`, [userId])).rows[0];
      if (!u) { await t.query(`update ${table} set user_id=$1, session_hash=null where id=$2`, [userId, g.id]); continue; }
      if (table === 'carts') {
        await t.query(`insert into cart_items(cart_id, variant_id, qty) select $1, variant_id, qty from cart_items where cart_id=$2
                       on conflict (cart_id, variant_id) do update set qty = least(20, cart_items.qty + excluded.qty)`, [u.id, g.id]);
      } else {
        await t.query(`insert into wishlist_items(wishlist_id, product_id) select $1, product_id from wishlist_items where wishlist_id=$2 on conflict do nothing`, [u.id, g.id]);
      }
      await t.query(`delete from ${table} where id=$1`, [g.id]);
    }
  });
}

async function cartLines(cartId, cur) {
  const rows = await db.many(`
    select ci.variant_id, ci.qty, v.sku as variant_sku, v.size, v.color, v.stock, v.is_active as variant_active,
      p.id as product_id, p.sku, p.name, p.slug, p.image_url, p.image_alt, p.discount_pct, p.is_active, pr.original_cents
    from cart_items ci join product_variants v on v.id = ci.variant_id join products p on p.id = v.product_id
    join product_prices pr on pr.product_id = p.id and pr.currency = $2
    where ci.cart_id = $1 order by ci.variant_id`, [cartId, cur]);
  return rows.map((r) => {
    const unit = discounted(r.original_cents, r.discount_pct);
    const problem = !r.is_active || !r.variant_active ? 'No longer available' : r.qty > r.stock ? (r.stock === 0 ? 'Out of stock' : `Only ${r.stock} in stock`) : null;
    return { ...r, unit_cents: unit, line_cents: unit * r.qty, line_original_cents: r.original_cents * r.qty, problem };
  });
}
function totals(lines, cur) {
  const subtotal = lines.reduce((s, l) => s + l.line_cents, 0);
  const original = lines.reduce((s, l) => s + l.line_original_cents, 0);
  const shipping = shippingFor(cur, subtotal);
  return { subtotal, original, discount: original - subtotal, shipping, tax: 0, total: subtotal + shipping, count: lines.reduce((s, l) => s + l.qty, 0) };
}
async function cartFor(req, cur, create = false) {
  const row = await ownerRow('carts', req, create);
  if (!row) return { id: null, lines: [], totals: totals([], cur) };
  const lines = await cartLines(row.id, cur);
  return { id: row.id, lines, totals: totals(lines, cur) };
}
async function cartCount(req) {
  const row = await ownerRow('carts', req, false);
  if (!row) return 0;
  return (await db.one('select coalesce(sum(qty),0)::int n from cart_items where cart_id=$1', [row.id])).n;
}
async function wishlistIds(req) {
  const row = await ownerRow('wishlists', req, false);
  if (!row) return [];
  return (await db.many('select product_id from wishlist_items where wishlist_id=$1 order by added_at desc', [row.id])).map((r) => r.product_id);
}

// ---------- orders ----------
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const orderRef = () => 'GS-' + Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

const STATUS_LABELS = {
  pending_enquiry: 'Pending enquiry', awaiting_payment: 'Awaiting payment', payment_confirmed: 'Payment confirmed',
  processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded',
};
const TRANSITIONS = {
  pending_enquiry: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['payment_confirmed', 'cancelled'],
  payment_confirmed: ['processing', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [], refunded: [],
};

async function createEnquiry(req, cur, form) {
  const cart = await cartFor(req, cur);
  if (!cart.lines.length) throw Object.assign(new Error('Your cart is empty.'), { user: true });
  const bad = cart.lines.find((l) => l.problem);
  if (bad) throw Object.assign(new Error(`${bad.name}: ${bad.problem}. Update your cart and try again.`), { user: true });
  const t = cart.totals;
  return db.tx(async (tx) => {
    const ref = orderRef();
    const o = (await tx.query(`insert into orders(ref, user_id, session_hash, customer_name, email, country, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11) returning id, ref`,
      [ref, req.user?.id || null, req.session.token_hash, form.name, form.email, form.country, cur, t.subtotal, t.discount, t.shipping, t.total])).rows[0];
    for (const l of cart.lines) {
      await tx.query(`insert into order_items(order_id, variant_id, product_id, sku, name, size, color, qty, unit_original_cents, unit_price_cents)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [o.id, l.variant_id, l.product_id, l.variant_sku, l.name, l.size, l.color, l.qty, l.original_cents, l.unit_cents]);
    }
    await tx.query('insert into order_enquiries(order_id, contact_preference, message) values ($1,$2,$3)', [o.id, form.contact, form.message]);
    await tx.query('insert into order_status_history(order_id, status, changed_by) values ($1,$2,$3)', [o.id, 'pending_enquiry', req.user?.id || null]);
    await tx.query('insert into consent_records(session_hash, user_id, purpose, granted, policy_version) values ($1,$2,$3,true,$4)', [req.session.token_hash, req.user?.id || null, 'order_share', config.policyVersion]);
    await tx.query('delete from cart_items where cart_id=$1', [cart.id]);
    return o;
  });
}

async function setOrderStatus(req, orderId, next, extra = {}) {
  return db.tx(async (t) => {
    const o = (await t.query('select * from orders where id=$1 for update', [orderId])).rows[0];
    if (!o) throw Object.assign(new Error('Order not found'), { user: true });
    if (!TRANSITIONS[o.status]?.includes(next)) throw Object.assign(new Error(`Cannot move from ${STATUS_LABELS[o.status]} to ${STATUS_LABELS[next] || next}.`), { user: true });
    let deducted = o.stock_deducted;
    if (next === 'payment_confirmed') {
      const pay = extra.payment;
      if (!pay || !pay.reference || !(pay.amount_cents > 0)) throw Object.assign(new Error('Payment confirmation needs a payment reference and amount recorded after you verified payment.'), { user: true });
      const items = (await t.query('select variant_id, qty, name from order_items where order_id=$1', [o.id])).rows;
      for (const it of items) {
        if (!it.variant_id) throw Object.assign(new Error(`${it.name} is no longer in the catalogue.`), { user: true });
        const r = await t.query('update product_variants set stock = stock - $2 where id=$1 and stock >= $2', [it.variant_id, it.qty]);
        if (r.rowCount !== 1) throw Object.assign(new Error(`Insufficient stock for ${it.name}.`), { user: true });
      }
      deducted = true;
      await t.query('insert into payment_records(order_id, amount_cents, currency, method, reference, confirmed_by) values ($1,$2,$3,$4,$5,$6)',
        [o.id, pay.amount_cents, o.currency, pay.method || 'manual', pay.reference, req.user.id]);
    }
    if ((next === 'cancelled' || next === 'refunded') && o.stock_deducted) {
      const items = (await t.query('select variant_id, qty from order_items where order_id=$1 and variant_id is not null', [o.id])).rows;
      for (const it of items) await t.query('update product_variants set stock = stock + $2 where id=$1', [it.variant_id, it.qty]);
      deducted = false;
    }
    await t.query('update orders set status=$2, stock_deducted=$3, tracking_info=coalesce($4, tracking_info), updated_at=now() where id=$1', [o.id, next, deducted, extra.tracking || null]);
    await t.query('insert into order_status_history(order_id, status, changed_by) values ($1,$2,$3)', [o.id, next, req.user?.id || null]);
    return { from: o.status, to: next };
  });
}

module.exports = { currencyOf, listProducts, getProduct, byIds, facets, suggest, ownerRow, mergeGuestIntoUser, cartFor, cartCount, wishlistIds,
  createEnquiry, setOrderStatus, STATUS_LABELS, TRANSITIONS, withPrice, BASE_SELECT, totals };
