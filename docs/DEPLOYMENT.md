# Free-tier deployment (verified against public docs in October 2026 - re-check before relying on them)

## Chosen architecture
| Part | Choice | Why / limits (as published, check current pages) |
|---|---|---|
| App server | **Render** free *Web Service* (Node) | Spins down after 15 min idle (first request then takes ~1 min); 750 free instance hours/month per workspace; ephemeral filesystem; may be restarted at any time (docs.render.com/free). |
| Database | **Supabase** free Postgres | ~500 MB database, 2 free projects, projects auto-pause after ~1 week of inactivity (reported by several 2026 pricing guides - confirm at supabase.com/pricing). 2,100 products use only a few MB. |
| Images | Admin uploads are stored in the database (`uploads` table, max 1 MB each) | Fine for a few hundred images; for more, move to Supabase Storage / Cloudflare R2 (not implemented). |
| DNS/CDN (optional) | Cloudflare free | Custom domain + caching. |
Do **not** assume any of this stays free; free tiers change. Using Render's free *Postgres* is not recommended (free databases expire after 30 days).
Alternatives: any Node host (Koyeb, Railway trial, a VPS) + any Postgres (Neon, Supabase). Vercel/Netlify serverless would need an adapter (not provided) because this is a long-running Express app.

## Not using Supabase? Use Neon (or any PostgreSQL)
The app only needs a standard PostgreSQL `DATABASE_URL`, so no code changes are required. Neon's free plan (checked October 2026: 0.5 GB storage per project, 100 compute-hours/month, no credit card, compute suspends after 5 idle minutes so the first request after idle is slower) is a good fit. Create a project at neon.com, copy the connection string (the "pooled" one), remove `&channel_binding=require` if present, and use it as `DATABASE_URL` in the steps below instead of the Supabase string. Same backup advice applies (`pg_dump`).

## Steps
1. **Database:** create a Supabase project -> Project Settings -> Database -> copy the *connection pooling* URI (port 6543 or 5432) -> this is `DATABASE_URL`.
2. **Push the code** to a private GitHub repo (`.env` and `.data` are git-ignored; never commit secrets).
3. **Render:** New -> Web Service -> connect the repo. Build `npm install`, start `npm start`. Add environment variables from `.env.example`: `NODE_ENV=production`, `DATABASE_URL`, `BASE_URL` (your https URL), `TRUST_PROXY=1`, `SUPPORT_EMAIL`, business details, shipping values, optionally `ANTHROPIC_API_KEY`.
4. **Schema:** applied automatically at start (`migrations/001_init.sql`). Or run `npm run migrate` locally with `DATABASE_URL` set.
5. **Seed the 2,100 sample products:** locally run `DATABASE_URL=... npm run seed` (idempotent). Check `/admin/products/sku-check` after logging in.
6. **First admin:** locally run `DATABASE_URL=... ADMIN_EMAIL=you@x.com ADMIN_PASSWORD='...' npm run create-admin`. There is no default password. Support agents: `node scripts/create-staff.js support "Name"`.
7. **Custom domain:** Render -> Settings -> Custom Domains; set `BASE_URL` to it. HTTPS is provided by Render; cookies are `Secure` in production.
8. **Verify** `/healthz`, browse, place a test enquiry, log in to `/admin`.

## Backups / export
- Supabase free projects have no guaranteed backups: schedule `pg_dump "$DATABASE_URL" > backup.sql` (e.g. weekly) and keep it off-platform.
- Catalogue export: Admin -> Products -> Export CSV. Restore: `psql "$DATABASE_URL" < backup.sql`.

## Free-tier limitations / upgrade triggers
Cold starts (~1 min) after idle; Supabase pause after inactivity (restore from dashboard); in-memory rate limiting resets on restart and is per-instance; chat is polling (4 s) so it uses requests continuously while open; free instance hours run out if you run several free services. Upgrade the Render instance (paid, no spin-down) and Supabase Pro when you need always-on service, backups or more storage.

## AI provider setup
Create an Anthropic API key, set `ANTHROPIC_API_KEY` (server-side only; never in the repo). Choose `AI_MODEL` and `AI_DAILY_LIMIT`. Without a key the assistant shows its fallback and the shop is unaffected. Calls are billed by the provider - not free.
