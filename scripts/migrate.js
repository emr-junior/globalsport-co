const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function migrate(log = console.log) {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.many('select name from schema_migrations')).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    log('Applying ' + f);
    await db.tx(async (t) => {
      await t.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      await t.query('insert into schema_migrations(name) values ($1)', [f]);
    });
  }
  log('Migrations up to date.');
}
module.exports = { migrate };
if (require.main === module) migrate().then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
