# GlobalSport Co. - sporting goods ecommerce platform

Node.js + Express + PostgreSQL storefront, admin dashboard, live support chat and an optional AI assistant.
**Read "What is and is not done" below before relying on anything.**

## Quick start (local, no external services needed)
Requires Node.js 20+.

```bash
npm install
cp .env.example .env            # Windows: copy .env.example .env  - then set SUPPORT_EMAIL etc.
npm run setup                   # creates the schema and loads the 2,100 sample products (safe to re-run)
npm run create-admin            # prompts for the first administrator's email + password (hidden)
npm start                       # http://localhost:3000   admin: http://localhost:3000/admin
npm test                        # 40 automated tests (catalogue, pricing, cart, checkout, auth, RBAC, CSRF, chat, AI, a11y)
```
With `DATABASE_URL` empty the app uses an embedded PostgreSQL (PGlite) stored in `.data/`. Set `DATABASE_URL` to use Supabase/Neon/any PostgreSQL; the same SQL runs on both.
Support agents: `ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/create-staff.js support "Agent Name"`.
Staff password recovery: `npm run reset-password -- user@example.com`.

## Project layout
```
src/            server (app.js, routes/store|admin|support, services, security, views, legal text)
migrations/     SQL schema (001_init.sql) - applied automatically on start and by `npm run migrate`
scripts/        migrate, seed (2,100 products), create-staff, reset-password
public/         css, js (no inline scripts/styles - strict CSP), favicon
tests/          catalog, shop-security, accessibility
docs/           DEPLOYMENT, SECURITY_REPORT, ACCESSIBILITY_REPORT, LICENSES, KNOWN_LIMITATIONS
config/         campaigns.json (homepage campaign tiles)
```

## What is and is not done (honest status)
Implemented and covered by automated tests: 2,100 distinct seeded products (30 sports, USD/GBP/CAD prices, variants, stock); 20% discount computed on the server (integer cents) and shown on every card/page; search, suggestions, filters, sorting, pagination (24/page); cart, wishlist, recently viewed; enquiry checkout with prefilled `mailto:` + Gmail-compose fallback + on-screen reference (no payment is taken, nothing is "paid" until an admin records a verified payment); order status workflow with stock deduction only at payment confirmation; accounts with scrypt hashing, lockout, rate limits, CSRF, session rotation, RBAC (admin/support/customer), audit log; admin product CRUD/archive/delete-with-confirmation, bulk edit, CSV import/export, image upload, stock/variants, orders, notes, refunds, deletion requests, review moderation, support inbox; DB-backed polling live chat with agent presence, offline enquiry, rate limits, report/block; AI assistant (Anthropic, server-side, opt-in consent, PII redaction, rate limits, graceful fallback); privacy/terms/refund/shipping/accessibility pages; consent banner (no trackers exist or load before consent); 13+ age gate; data-deletion workflow.

**Not verified / not done:** deployment to a live host (no hosting accounts in this environment); the `pg` driver against a real Supabase instance (tests ran on PGlite, same SQL); a live AI call (no API key here; only the no-key fallback path is tested); OWASP ZAP / SAST scans; browser-based accessibility tools and screen-reader testing; load testing; sending email. See `docs/SECURITY_REPORT.md`, `docs/ACCESSIBILITY_REPORT.md`, `docs/KNOWN_LIMITATIONS.md`.

**Catalogue:** all 2,100 products are generated *sample listings* under the house lines "GlobalSport Essential/Club/Core/Training/Junior/Pro/Elite". Images are generated SVG illustrations, not photographs. No real third-party brands, specifications, reviews or ratings are invented. Replace with supplier data (CSV import in the admin) before trading.

**Legal pages are templates, not legal advice.** Fill in real business details in `.env` and have a lawyer review them.
