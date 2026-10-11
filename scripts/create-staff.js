/* Create the first administrator (or a support agent).
 * Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node scripts/create-staff.js [admin|support] ["Full Name"]
 * Or run without env vars and answer the prompts (password input is hidden). */
const readline = require('readline');
const db = require('../src/db');
const sec = require('../src/security');
const { migrate } = require('./migrate');

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}
async function createStaff({ email, password, role = 'admin', name = 'Administrator' }) {
  if (!['admin', 'support'].includes(role)) throw new Error('Role must be admin or support');
  const p = sec.passwordProblem(password, email); if (p) throw new Error(p);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  const existing = await db.one('select id from users where lower(email)=lower($1)', [email]);
  if (existing) throw new Error('A user with that email already exists');
  return db.one(`insert into users(email, name, password_hash, role, age_confirmed_13plus) values ($1,$2,$3,$4,true) returning id, email, role`, [email, name, sec.hashPassword(password), role]);
}
module.exports = { createStaff };
if (require.main === module) {
  (async () => {
    await migrate(() => {});
    const role = process.argv[2] || 'admin'; const name = process.argv[3] || (role === 'admin' ? 'Administrator' : 'Support agent');
    const email = process.env.ADMIN_EMAIL || (await ask('Email: '));
    const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 10 chars, hidden): ', true));
    const u = await createStaff({ email, password, role, name });
    console.log(`Created ${u.role} account for ${u.email} (id ${u.id}).`);
    await db.close();
  })().catch((e) => { console.error('Error:', e.message); process.exit(1); });
}
