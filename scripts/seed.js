/* Idempotent catalog seed. Safe to run repeatedly: existing SKUs are skipped (admin edits are preserved). */
const db = require('../src/db');
const config = require('../src/config');
const { discounted } = require('../src/pricing');
const { SPORT_DEFS, SERIES, COLORS, KIND_SIZES } = require('../src/catalog-data');

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const price99 = (dollars) => Math.max(499, Math.round(dollars) * 100 - 1);

function buildCatalog() {
  const items = [];
  SPORT_DEFS.forEach((sp, si) => {
    sp.types.forEach((t, ti) => {
      SERIES.forEach(([series, mult, blurb], ri) => {
        const idx = si * 70 + ti * 7 + ri + 1;
        const sku = `GS-${sp.code}-${String(idx).padStart(5, '0')}`;
        const name = `${series} ${t.name}`;
        const h = hash(sku);
        const usd = t.base * mult * (0.9 + h * 0.2);
        const prices = {
          USD: price99(usd),
          GBP: price99(usd * 0.79 * (0.98 + hash(sku + 'g') * 0.04)),
          CAD: price99(usd * 1.36 * (0.98 + hash(sku + 'c') * 0.04)),
        };
        const sizes = t.kind === 'A' ? KIND_SIZES.A.slice(1, 5) : KIND_SIZES[t.kind];
        const nColors = t.kind === 'N' ? 1 + Math.floor(hash(sku + 'n') * 2) : 2;
        const start = Math.floor(hash(sku + 'col') * COLORS.length);
        const colors = Array.from({ length: nColors }, (_, k) => COLORS[(start + k * 3) % COLORS.length]);
        const out = hash(sku + 'oos') < 0.03;
        const variants = [];
        for (const size of sizes) for (const color of colors) {
          const vsku = `${sku}-${size ? size.replace(/\s+/g, '') : 'OS'}-${slugify(color).toUpperCase()}`;
          variants.push({ sku: vsku, size, color, stock: out ? 0 : Math.floor(hash(vsku) * 60) });
        }
        items.push({
          sku, name, slug: slugify(name), sport: sp, subcategory: t.name, series, blurb, prices, variants, sizes, colors,
          featured: idx % 87 === 0,
        });
      });
    });
  });
  return items;
}

function validate(items) {
  const errors = [];
  const skus = new Set(); const names = new Set(); const slugs = new Set();
  for (const p of items) {
    const e = [];
    if (!p.sku || !p.name || !p.slug) e.push('missing required field');
    if (skus.has(p.sku)) e.push('duplicate SKU'); skus.add(p.sku);
    if (names.has(p.name + '|' + p.sport.code)) e.push('duplicate name'); names.add(p.name + '|' + p.sport.code);
    if (slugs.has(p.slug)) e.push('duplicate slug'); slugs.add(p.slug);
    for (const c of config.currencies) {
      const v = p.prices[c];
      if (!Number.isInteger(v) || v <= 0) e.push(`invalid ${c} price`);
    }
    if (!p.variants.length) e.push('no variants');
    if (e.length) errors.push({ sku: p.sku, errors: e });
  }
  return errors;
}

async function bulk(t, table, cols, rows, tail = '') {
  const CH = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += CH) {
    const part = rows.slice(i, i + CH);
    const params = []; const tuples = part.map((r) => '(' + r.map((v) => { params.push(v); return '$' + params.length; }).join(',') + ')');
    await t.query(`insert into ${table} (${cols.join(',')}) values ${tuples.join(',')} ${tail}`, params);
  }
}

async function seed({ log = console.log } = {}) {
  const started = Date.now();
  const all = buildCatalog();
  const invalid = validate(all);
  const bad = new Set(invalid.map((x) => x.sku));
  const items = all.filter((p) => !bad.has(p.sku));
  const report = { attempted: all.length, failed: invalid.length, failures: invalid.slice(0, 20), inserted: 0, skippedExisting: 0 };

  await db.tx(async (t) => {
    await bulk(t, 'categories', ['code', 'slug', 'name', 'description', 'position'],
      SPORT_DEFS.map((s, i) => [s.code, s.slug, s.name, s.description, i + 1]), 'on conflict (code) do nothing');
    await bulk(t, 'brands', ['name', 'is_house'], SERIES.map(([s]) => [`GlobalSport ${s}`, true]), 'on conflict (name) do nothing');
    const cats = Object.fromEntries((await t.query('select id, code from categories')).rows.map((r) => [r.code, r.id]));
    const brands = Object.fromEntries((await t.query('select id, name from brands')).rows.map((r) => [r.name, r.id]));
    const existing = new Set((await t.query("select sku from products where sku like 'GS-%'")).rows.map((r) => r.sku));
    const fresh = items.filter((p) => !existing.has(p.sku));
    report.skippedExisting = items.length - fresh.length;

    for (let i = 0; i < fresh.length; i += 250) {
      const chunk = fresh.slice(i, i + 250);
      await bulk(t, 'products',
        ['sku', 'slug', 'name', 'category_id', 'subcategory', 'brand_id', 'short_desc', 'full_desc', 'discount_pct', 'image_url', 'image_alt', 'specs', 'is_featured', 'is_sample'],
        chunk.map((p) => [
          p.sku, p.slug, p.name, cats[p.sport.code], p.subcategory, brands[`GlobalSport ${p.series}`],
          `${p.name} - sample listing from the GlobalSport ${p.series} line for ${p.sport.name.toLowerCase()}.`,
          `${p.name} is a sample catalogue listing for ${p.sport.name.toLowerCase()}, part of the GlobalSport ${p.series} line (${p.blurb}). ` +
          `This listing was generated as demonstration data: materials, certifications and performance details are not stated and should be confirmed with the supplier before sale.`,
          config.discountPct, `/img/${p.sku}.svg`, `${p.name} - illustrative sample image (not a photograph)`,
          JSON.stringify({ 'Sport': p.sport.name, 'Product type': p.subcategory, 'Range': p.series, 'Listing status': 'Sample listing',
            'Sizes': p.sizes.filter(Boolean).join(', ') || 'One size', 'Colours': p.colors.join(', '), 'Materials': 'Not specified in this sample listing' }),
          p.featured, true,
        ]), 'on conflict (sku) do nothing');
      const ids = Object.fromEntries((await t.query('select id, sku from products where sku = any($1::text[])', [chunk.map((p) => p.sku)])).rows.map((r) => [r.sku, r.id]));
      const priceRows = []; const variantRows = [];
      for (const p of chunk) {
        for (const c of config.currencies) priceRows.push([ids[p.sku], c, p.prices[c], discounted(p.prices[c], config.discountPct)]);
        for (const v of p.variants) variantRows.push([ids[p.sku], v.sku, v.size, v.color, v.stock]);
      }
      await bulk(t, 'product_prices', ['product_id', 'currency', 'original_cents', 'discounted_cents'], priceRows, 'on conflict (product_id, currency) do nothing');
      await bulk(t, 'product_variants', ['product_id', 'sku', 'size', 'color', 'stock'], variantRows, 'on conflict (sku) do nothing');
      report.inserted += chunk.length;
    }
  });
  const counts = await db.one(`select count(*)::int total, count(distinct sku)::int distinct_skus,
    (select count(*)::int from product_prices) prices, (select count(*)::int from product_variants) variants from products`);
  report.databaseCounts = counts;
  report.seconds = Math.round((Date.now() - started) / 100) / 10;
  log(`Seed report: attempted=${report.attempted} inserted=${report.inserted} skipped_existing=${report.skippedExisting} failed=${report.failed}`);
  log(`Database now holds ${counts.total} products (${counts.distinct_skus} distinct SKUs), ${counts.prices} price rows, ${counts.variants} variants (${report.seconds}s).`);
  if (counts.distinct_skus < 2000) log('WARNING: fewer than 2,000 distinct products exist in the database.');
  return report;
}
module.exports = { seed, buildCatalog, validate };
if (require.main === module) {
  const { migrate } = require('./migrate');
  migrate().then(() => seed()).then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
}
