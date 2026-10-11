const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');

// ---------- passwords (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const key = crypto.scryptSync(pw, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, salt, key] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const k = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: Number(N), r: 8, p: 1 });
    const kb = Buffer.from(key, 'base64');
    return kb.length === k.length && crypto.timingSafeEqual(k, kb);
  } catch { return false; }
}
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwertyuiop', 'iloveyou', 'letmein123', 'admin1234', 'welcome123']);
function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && email.split('@')[0].length > 3) return 'Password must not contain your email name.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

// ---------- cookies ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}
function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (config.prod) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
const clearCookie = (res, name) => setCookie(res, name, '', { maxAge: 0 });

// ---------- sessions ----------
const IDLE = { customer: 7 * 24 * 3600, guest: 30 * 24 * 3600, staff: 2 * 3600 };
const idleFor = (role) => (role === 'admin' || role === 'support' ? IDLE.staff : role ? IDLE.customer : IDLE.guest);

async function createSession(res, userId = null, role = null) {
  const tok = token(); const csrf = token(16);
  await db.query(`insert into sessions(token_hash, user_id, csrf, expires_at) values ($1,$2,$3, now() + ($4 || ' seconds')::interval)`,
    [sha(tok), userId, csrf, String(idleFor(role))]);
  setCookie(res, 'gs_sid', tok, { maxAge: idleFor(role) });
  return { token_hash: sha(tok), csrf, user_id: userId, recent: '' };
}
async function sessionMiddleware(req, res, next) {
  const tok = parseCookies(req).gs_sid;
  let s = null;
  if (tok && /^[A-Za-z0-9_-]{20,64}$/.test(tok)) {
    s = await db.one(`select s.token_hash, s.csrf, s.user_id, s.recent, s.expires_at, u.email, u.name, u.role, u.status
                      from sessions s left join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, [sha(tok)]);
    if (s && s.user_id && s.status !== 'active') { await db.query('delete from sessions where token_hash=$1', [s.token_hash]); s = null; }
  }
  if (!s) s = await createSession(res);
  else if (s.expires_at && new Date(s.expires_at).getTime() - Date.now() < (idleFor(s.role) - 60) * 1000) {
    // sliding expiry, refreshed at most once a minute
    await db.query(`update sessions set expires_at = now() + ($2 || ' seconds')::interval where token_hash=$1`, [s.token_hash, String(idleFor(s.role))]);
    setCookie(res, 'gs_sid', tok, { maxAge: idleFor(s.role) });
  }
  req.session = s;
  req.user = s.user_id ? { id: s.user_id, email: s.email, name: s.name, role: s.role } : null;
  next();
}
async function loginSession(req, res, user) {
  // rotate: destroy the old (possibly attacker-known) session id, issue a new one
  await db.query('delete from sessions where token_hash=$1', [req.session.token_hash]);
  const prevRecent = req.session.recent;
  const s = await createSession(res, user.id, user.role);
  if (prevRecent) await db.query('update sessions set recent=$2 where token_hash=$1', [s.token_hash, prevRecent]);
  return s;
}
async function logoutSession(req, res) {
  await db.query('delete from sessions where token_hash=$1', [req.session.token_hash]);
  clearCookie(res, 'gs_sid');
}

// ---------- CSRF ----------
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
    if (!ok) return res.status(403).type('text').send('Forbidden: bad origin');
  }
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  const a = Buffer.from(String(sent || '')); const b = Buffer.from(req.session.csrf);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).type('text').send('Forbidden: invalid or missing CSRF token. Go back, refresh the page and try again.');
  next();
}

// ---------- rate limiting (in-memory, per process) ----------
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return { ok: b.n <= max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
function limiter(name, max, windowMs, keyFn) {
  return (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;
    const r = hit(key, max, windowMs);
    if (!r.ok) { res.setHeader('Retry-After', r.retryAfter); return res.status(429).type('text').send('Too many requests. Please wait and try again.'); }
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k, v] of buckets) if (v.reset < n) buckets.delete(k); }, 60000).unref();
const resetLimits = () => buckets.clear();

// ---------- headers ----------
function securityHeaders(req, res, next) {
  const analytics = config.analyticsSrc ? ' ' + new URL(config.analyticsSrc).origin : '';
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; script-src 'self'${analytics}; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; ` +
    `object-src 'none'; base-uri 'self'; form-action 'self' mailto:; frame-ancestors 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// ---------- RBAC ----------
let permCache = null;
async function loadPerms() {
  const rows = await db.many('select role, permission from role_permissions');
  permCache = {};
  for (const r of rows) (permCache[r.role] ||= new Set()).add(r.permission);
}
async function can(user, perm) {
  if (!user) return false;
  if (!permCache) await loadPerms();
  return !!permCache[user.role]?.has(perm);
}
const resetPermCache = () => { permCache = null; };
function requirePerm(perm) {
  return async (req, res, next) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (!(await can(req.user, perm))) return res.status(403).type('text').send('Forbidden');
    next();
  };
}
function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

async function audit(req, action, entity = null, entityId = null, detail = {}) {
  await db.query('insert into audit_logs(actor_id, actor_email, action, entity, entity_id, detail, ip) values ($1,$2,$3,$4,$5,$6,$7)',
    [req?.user?.id || null, req?.user?.email || null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail), req?.ip || null]);
}
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/');

module.exports = { sha, token, hashPassword, verifyPassword, passwordProblem, parseCookies, setCookie, clearCookie,
  sessionMiddleware, loginSession, logoutSession, createSession, csrfProtect, limiter, hit, resetLimits, securityHeaders,
  can, requirePerm, requireLogin, resetPermCache, audit, safeNext };
