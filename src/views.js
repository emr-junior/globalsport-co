const { html, raw, esc } = require('./html');
const config = require('./config');
const { fmt } = require('./pricing');
const { STATUS_LABELS } = require('./services');

const ICON = {
  search: raw('<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'),
  cart: raw('<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/></svg>'),
  heart: raw('<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.5 3 5 6.4 5c2 0 3.3 1.1 4 2.3h3.2c.7-1.2 2-2.3 4-2.3 3.400 0 5.200 3.500 3.900 6.800C19.500 16.400 12 21 12 21z"/></svg>'),
  logo: raw('<svg aria-hidden="true" focusable="false" width="34" height="34" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="3"/><path d="M4 20h32M20 2c8 6 8 30 0 36M20 2c-8 6-8 30 0 36" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>'),
};

function field({ id, label, type = 'text', value = '', error, required, hint, autocomplete, rows, maxlength, options, checked, name }) {
  const n = name || id;
  const desc = [hint ? id + '-hint' : '', error ? id + '-err' : ''].filter(Boolean).join(' ');
  const attrs = html`id="${id}" name="${n}" ${required ? raw('required') : ''} ${error ? raw('aria-invalid="true"') : ''} ${desc ? raw(`aria-describedby="${desc}"`) : ''} ${autocomplete ? raw(`autocomplete="${esc(autocomplete)}"`) : ''} ${maxlength ? raw(`maxlength="${+maxlength}"`) : ''}`;
  let control;
  if (type === 'textarea') control = html`<textarea ${attrs} rows="${rows || 4}">${value}</textarea>`;
  else if (type === 'select') control = html`<select ${attrs}>${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${l}</option>`)}</select>`;
  else if (type === 'checkbox') return html`<div class="field field-check"><input type="checkbox" ${attrs} value="1" ${checked ? raw('checked') : ''}><label for="${id}">${label}</label>${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}${error ? html`<p class="error" id="${id}-err">${error}</p>` : ''}</div>`;
  else control = html`<input type="${type}" ${attrs} value="${value}">`;
  return html`<div class="field"><label for="${id}">${label}${required ? html` <span class="req">(required)</span>` : ''}</label>${control}${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}${error ? html`<p class="error" id="${id}-err">Error: ${error}</p>` : ''}</div>`;
}
const csrfInput = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
const errorSummary = (errors) => Object.keys(errors || {}).length
  ? html`<div class="alert alert-error" role="alert" tabindex="-1" id="form-errors"><p><strong>Please fix the following:</strong></p><ul>${Object.entries(errors).map(([k, v]) => html`<li><a href="#${k}">${v}</a></li>`)}</ul></div>` : '';

function priceBlock(cur, p, big = false) {
  return html`<p class="price ${big ? 'price-big' : ''}">
    <span class="price-now"><span class="visually-hidden">Sale price </span>${fmt(p.price_cents, cur)}</span>
    <s class="price-was"><span class="visually-hidden">Original price </span>${fmt(p.original_cents, cur)}</s>
    <span class="badge-off">${p.discount_pct}% OFF</span></p>`;
}
const stockLabel = (n) => (n <= 0 ? html`<span class="stock stock-out">Out of stock</span>` : n <= 5 ? html`<span class="stock stock-low">In stock (${n} left)</span>` : html`<span class="stock stock-in">In stock</span>`);

function productCard(ctx, p, wished = false) {
  const single = p.nvariants === 1;
  return html`<article class="card" aria-labelledby="pn-${p.id}">
    <a class="card-img" href="/p/${p.slug}" tabindex="-1" aria-hidden="true"><img src="${p.image_url}" alt="" width="400" height="300" loading="lazy" decoding="async"></a>
    <div class="card-body">
      <p class="card-meta">${p.sport} · ${p.brand}</p>
      <h3 id="pn-${p.id}"><a href="/p/${p.slug}">${p.name}</a></h3>
      <p class="sku">SKU: ${p.sku}</p>
      ${priceBlock(ctx.cur, p)}
      ${p.review_count ? html`<p class="rating"><span aria-hidden="true">★</span> ${p.avg_rating} out of 5 (${p.review_count} review${p.review_count === 1 ? '' : 's'})</p>` : ''}
      <p>${stockLabel(p.stock)}</p>
      <div class="card-actions">
        ${p.stock <= 0 ? html`<a class="btn btn-secondary" href="/p/${p.slug}">View details</a>`
          : single ? html`<form method="post" action="/cart/add">${csrfInput(ctx)}<input type="hidden" name="variant" value="${p.first_variant}"><input type="hidden" name="qty" value="1"><button class="btn" type="submit">Add to cart<span class="visually-hidden">: ${p.name}</span></button></form>`
          : html`<a class="btn" href="/p/${p.slug}">Choose options<span class="visually-hidden"> for ${p.name}</span></a>`}
        <form method="post" action="/wishlist/toggle">${csrfInput(ctx)}<input type="hidden" name="product" value="${p.id}"><input type="hidden" name="next" value="${ctx.path}">
          <button class="btn btn-icon" type="submit" aria-pressed="${wished ? 'true' : 'false'}">${ICON.heart}<span class="visually-hidden">${wished ? 'Remove from wishlist' : 'Add to wishlist'}: ${p.name}</span></button></form>
        <button class="btn btn-secondary quick-view" type="button" data-slug="${p.slug}">Quick view<span class="visually-hidden">: ${p.name}</span></button>
      </div></div></article>`;
}

function pagination(page, pages, makeUrl) {
  if (pages <= 1) return '';
  const nums = []; for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return html`<nav class="pagination" aria-label="Pagination">
    ${page > 1 ? html`<a href="${makeUrl(page - 1)}" rel="prev">Previous</a>` : ''}
    ${nums.map((i) => (i === page ? html`<span aria-current="page" class="current">Page ${i}</span>` : html`<a href="${makeUrl(i)}"><span class="visually-hidden">Page </span>${i}</a>`))}
    ${page < pages ? html`<a href="${makeUrl(page + 1)}" rel="next">Next</a>` : ''}
    <span class="pg-info">of ${pages}</span></nav>`;
}

function layout(ctx, { title, description = '', body, bodyClass = '' }) {
  const t = title ? `${title} | ${config.siteName}` : `${config.siteName} - Sporting goods for every sport`;
  const supportMail = config.supportEmail;
  return html`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>${description ? html`<meta name="description" content="${description}">` : ''}
<meta name="csrf-token" content="${ctx.csrf}">${config.analyticsSrc ? html`<meta name="analytics-src" content="${config.analyticsSrc}">` : ''}
<link rel="stylesheet" href="/css/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/js/app.js" defer></script>
</head><body class="${bodyClass}">
<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="${config.siteName} home">${ICON.logo}<span>GlobalSport <small>Co.</small></span></a>
    <form class="search" role="search" action="/search" method="get">
      <label for="q" class="visually-hidden">Search products by name, SKU, sport or brand</label>
      <input id="q" name="q" type="search" placeholder="Search products, SKU, sport or brand" value="${ctx.q || ''}" autocomplete="off" list="suggestions" maxlength="80">
      <datalist id="suggestions"></datalist>
      <button class="btn" type="submit">${ICON.search}<span class="visually-hidden">Search</span></button>
    </form>
    <div class="header-links">
      <nav aria-label="Currency" class="currency">${config.currencies.map((c) => (c === ctx.cur ? html`<span aria-current="true" class="cur-on">${c}<span class="visually-hidden"> (selected currency)</span></span>` : html`<a href="/currency?c=${c}&amp;next=${encodeURIComponent(ctx.path)}">${c}</a>`))}</nav>
      <a href="/wishlist">Wishlist</a>
      ${ctx.user ? html`<a href="/account">Account</a>` : html`<a href="/login">Sign in</a>`}
      ${ctx.user && (ctx.user.role === 'admin' || ctx.user.role === 'support') ? html`<a href="/admin">Admin</a>` : ''}
      <a class="cart-link" href="/cart">${ICON.cart}<span class="visually-hidden">Cart, </span><span class="cart-count">${ctx.cartCount}</span><span class="visually-hidden"> item${ctx.cartCount === 1 ? '' : 's'}</span></a>
    </div>
  </div>
  <nav class="sports-nav" aria-label="Sports categories"><div class="wrap">
    <details class="sports-menu"><summary>All sports</summary>
      <ul class="sports-list">${ctx.categories.map((c) => html`<li><a href="/c/${c.slug}">${c.name}</a></li>`)}</ul></details>
    <ul class="top-sports">${ctx.categories.slice(0, 8).map((c) => html`<li><a href="/c/${c.slug}">${c.name}</a></li>`)}</ul>
  </div></nav>
</header>
<main id="main" tabindex="-1">${body}</main>
<footer class="site-footer"><div class="wrap footer-grid">
  <section aria-labelledby="f-about"><h2 id="f-about">${config.businessName}</h2>
    <p>Sporting goods for every sport.</p>
    <p class="small">The product catalogue currently contains <strong>sample listings</strong> used for demonstration. Images are illustrations, not photographs.</p>
    ${config.address ? html`<p class="small">${config.address}</p>` : ''}
    ${config.regNumber ? html`<p class="small">Registration no. ${config.regNumber}</p>` : ''}</section>
  <section aria-labelledby="f-help"><h2 id="f-help">Help</h2><ul>
    <li><a href="/contact">Contact &amp; support</a></li><li><a href="/shipping">Shipping &amp; delivery</a></li><li><a href="/refunds">Refund policy</a></li>
    <li><a href="/order-status">Check an order enquiry</a></li><li><a href="/accessibility">Accessibility statement</a></li></ul></section>
  <section aria-labelledby="f-legal"><h2 id="f-legal">Legal</h2><ul>
    <li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms of service</a></li><li><a href="/privacy#choices">Privacy choices</a></li><li><a href="/data-deletion">Request data deletion</a></li></ul></section>
  <section aria-labelledby="f-news"><h2 id="f-news">Newsletter</h2>
    <form method="post" action="/newsletter" class="stack">${csrfInput(ctx)}
      ${field({ id: 'nl-email', name: 'email', label: 'Email address', type: 'email', autocomplete: 'email', required: true })}
      ${field({ id: 'nl-consent', name: 'consent', type: 'checkbox', label: 'I agree to receive marketing emails from GlobalSport Co. I can unsubscribe at any time.' })}
      <button class="btn" type="submit">Subscribe</button></form></section>
</div><p class="wrap small copyright">&copy; ${new Date().getFullYear()} ${config.businessName}. ${supportMail ? html`Support: <a href="mailto:${supportMail}">${supportMail}</a>` : ''}</p></footer>

<section id="consent-banner" class="consent" aria-label="Privacy choices" hidden>
  <p><strong>Your privacy choices.</strong> We use only essential cookies (session, cart, currency) by default. Optional analytics load only if you accept. <a href="/privacy">Privacy policy</a></p>
  <div class="consent-actions"><button class="btn" type="button" data-consent="accept">Accept analytics</button><button class="btn" type="button" data-consent="reject">Reject non-essential</button></div>
</section>
<div class="float-btns"><button class="btn btn-float" type="button" id="open-ai" aria-haspopup="dialog">AI assistant</button><button class="btn btn-float" type="button" id="open-chat" aria-haspopup="dialog">Live chat</button></div>
<dialog id="quick-dialog" aria-label="Quick view"></dialog>
<noscript><p class="wrap small">JavaScript is off: browsing and checkout still work. For live help use <a href="/contact">Contact &amp; support</a>.</p></noscript>
</body></html>`;
}

const statusBadge = (s) => html`<span class="status status-${s}">${STATUS_LABELS[s] || s}</span>`;
module.exports = { layout, field, csrfInput, errorSummary, priceBlock, stockLabel, productCard, pagination, statusBadge, ICON };
