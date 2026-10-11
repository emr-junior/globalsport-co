const config = require('./config');
let mode, pool, lite, initPromise;

async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      if (config.databaseUrl) {
        const { Pool } = require('pg');
        const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
        pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.dbSsl && !local ? { rejectUnauthorized: false } : undefined,
          max: 5,
          idleTimeoutMillis: 10000, // drop idle connections before serverless databases (e.g. Neon) suspend
          connectionTimeoutMillis: 15000, // allow time for a suspended database to wake up
        });
        pool.on('error', (e) => console.error('[db] idle client error (ignored):', e.message));
        mode = 'pg';
      } else {
        const { PGlite } = require('@electric-sql/pglite');
        lite = new PGlite(config.dataDir === 'memory' ? undefined : config.dataDir);
        await lite.waitReady;
        mode = 'lite';
      }
    })();
  }
  return initPromise;
}
const norm = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rowCount ?? r.rows.length });

async function query(text, params = []) {
  await init();
  return mode === 'pg' ? norm(await pool.query(text, params)) : norm(await lite.query(text, params));
}
async function one(text, params = []) { return (await query(text, params)).rows[0] || null; }
async function many(text, params = []) { return (await query(text, params)).rows; }

async function tx(fn) {
  await init();
  if (mode === 'pg') {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const r = await fn({ query: async (t, p = []) => norm(await c.query(t, p)), exec: async (t) => { await c.query(t); } });
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  return lite.transaction(async (t) => fn({ query: async (s, p = []) => norm(await t.query(s, p)), exec: async (s) => { await t.exec(s); } }));
}
async function exec(sql) { await init(); if (mode === 'pg') await pool.query(sql); else await lite.exec(sql); }
async function close() { if (mode === 'pg') await pool.end(); else if (lite) await lite.close(); initPromise = null; mode = null; }
module.exports = { query, one, many, tx, exec, close, init };
