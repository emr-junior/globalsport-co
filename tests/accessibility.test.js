const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { start, Client, db } = require('./helpers');
let app;
test.before(async () => { app = await start(); });
test.after(async () => { await app.close(); });

const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('colour tokens meet WCAG 2.2 AA contrast (4.5:1 text, 3:1 UI/focus)', () => {
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const v = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  const pairs = [['text', 'bg', 4.5], ['muted', 'bg', 4.5], ['muted', 'bg-alt', 4.5], ['brand', 'bg', 4.5], ['accent', 'bg', 4.5], ['ok', 'bg', 4.5], ['warn', 'bg', 4.5], ['text', 'bg-alt', 4.5], ['focus', 'bg', 3]];
  for (const [f, b, min] of pairs) assert.ok(ratio(v[f], v[b]) >= min, `${f} on ${b} = ${ratio(v[f], v[b]).toFixed(2)}`);
  assert.ok(ratio('#FFFFFF', v.brand) >= 4.5 && ratio('#FFFFFF', v.accent) >= 4.5 && ratio('#FFFFFF', v['brand-2']) >= 4.5, 'white on brand/accent/brand-2');
  for (const [fg, bg] of [['#0B4FD6', '#FFFFFF'], ['#A4170F', '#FFFFFF'], ['#0B2A66', '#EAF2FF'], ['#4A2800', '#FFF4DB'], ['#5F0E09', '#FDECEA'], ['#DCE4EF', '#0B2545']]) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg}`);
});
test('rendered pages: lang, one h1, landmarks, skip link, alt on every image, labels on every control', async () => {
  const c = new Client(app.base); await c.get('/');
  const v = await db.one('select id from product_variants where stock > 3 limit 1'); await c.post('/cart/add', { variant: v.id, qty: 1 });
  for (const p of ['/', '/c/golf', '/search?q=shoes', '/p/pro-football-boots', '/cart', '/checkout', '/login', '/register', '/privacy', '/contact', '/wishlist']) {
    const t = (await c.get(p)).text;
    assert.match(t, /<html lang="en"/, p); assert.equal((t.match(/<h1[ >]/g) || []).length, 1, p + ' h1 count');
    assert.match(t, /class="skip-link" href="#main"/, p); assert.match(t, /<main id="main"/, p); assert.match(t, /<footer/, p); assert.match(t, /<nav aria-label="Sports categories"|<nav class="sports-nav" aria-label="Sports categories"/, p);
    for (const m of t.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\balt="/, p + ' img without alt: ' + m[0].slice(0, 80));
    for (const m of t.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const a = m[2]; if (/type="(hidden|submit)"/.test(a)) continue;
      const id = (a.match(/\bid="([^"]+)"/) || [])[1];
      assert.ok(/aria-label=/.test(a) || (id && new RegExp(`<label[^>]*for="${id}"`).test(t)), `${p}: control without label: ${a.slice(0, 80)}`);
    }
    for (const m of t.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) assert.ok(m[1].replace(/<[^>]+>/g, '').trim().length > 0, `${p}: button without name`);
  }
});
test('decorative card images have empty alt; the linked product name carries the accessible name', async () => {
  const t = (await new Client(app.base).get('/c/golf')).text; assert.match(t, /<img src="\/img\/GS-GLF[^>]*alt=""/);
  const p = (await new Client(app.base).get('/p/pro-football-boots')).text; assert.match(p, /alt="Pro Football Boots - illustrative sample image/);
});
test('form errors are announced and associated with fields', async () => {
  const c = new Client(app.base); await c.get('/register');
  const r = await c.post('/register', { name: '', email: 'x', password: '', age: '', terms: '' });
  assert.match(r.text, /role="alert"/); assert.match(r.text, /aria-invalid="true"/); assert.match(r.text, /aria-describedby="[^"]*email-err/);
});
test('no accessibility overlay/widget scripts are used and focus styles exist', () => {
  const css = fs.readFileSync('public/css/style.css', 'utf8'); assert.match(css, /:focus-visible\{outline:3px/); assert.match(css, /prefers-reduced-motion/);
  const all = fs.readdirSync('src', { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync('src/' + f, 'utf8')).join('');
  assert.ok(!/userway|accessibe|audioeye|equalweb/i.test(all));
});
