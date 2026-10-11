/* Reset any user's password (use this for staff account recovery).
 * Usage: node scripts/reset-password.js user@example.com   (password prompted, hidden) */
const readline = require('readline');
const db = require('../src/db');
const sec = require('../src/security');
(async () => {
  const email = process.argv[2]; if (!email) throw new Error('Usage: node scripts/reset-password.js <email>');
  const pw = process.env.NEW_PASSWORD || await new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); const q = 'New password (hidden): '; rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); }); });
  const p = sec.passwordProblem(pw, email); if (p) throw new Error(p);
  const u = await db.one('select id from users where lower(email)=lower($1)', [email]); if (!u) throw new Error('No such user');
  await db.query('update users set password_hash=$2, failed_logins=0, locked_until=null where id=$1', [u.id, sec.hashPassword(pw)]);
  await db.query('delete from sessions where user_id=$1', [u.id]);
  await db.query(`insert into audit_logs(action, entity, entity_id, detail) values ('password.reset.cli','user',$1,'{}')`, [String(u.id)]);
  console.log('Password updated and all sessions for that user were signed out.');
  await db.close();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
