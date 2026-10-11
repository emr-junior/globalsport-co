# Security report - GlobalSport Co.
Scope: this codebase, run locally against an embedded PostgreSQL with test accounts and the seeded sample data. Tests are in `tests/shop-security.test.js` (run `npm test`). Date: 2026-10-10. Result of the last run: **40/40 tests passing** (all three files). `npm audit --omit=dev`: **0 known vulnerabilities** at that date.

**This is not a penetration test and does not show the site cannot be hacked.** Nothing was run against a deployed environment.

| # | Area | Test performed | Result | Severity if failed | Evidence (test) | Remediation / notes | Retest |
|---|---|---|---|---|---|---|---|
| 1 | SQL injection | Hostile `q`, `sort`, `min`, `type` params incl. `DROP TABLE`, `UNION SELECT` | Pass: pages return 200, tables intact | Critical | "SQL injection and XSS probes are harmless" | All queries parameterised; sort is a whitelist | Pass |
| 2 | XSS | `<script>` in search; HTML in checkout message | Pass: output escaped (auto-escaping templates); CSP forbids inline script | High | same + IDOR test | `html` tagged template escapes by default | Pass |
| 3 | Broken access control | Customer and anonymous hitting every admin URL; support user attempting product/audit/bulk/order-status writes | Pass (403 / redirect) | Critical | "customers cannot reach admin..." | Server-side permission checks per route (`requirePerm`) | Pass |
| 4 | IDOR (orders) | Other visitor opening an order by reference; status lookup with wrong email | Pass (404) | High | "IDOR..." | References are random (30^8); owner = session/user; lookup needs ref + email, rate-limited | Pass |
| 5 | Auth | Hashing format, generic failure message, per-email + per-IP rate limit (429), account lock, open-redirect `next`, staff session idle expiry 2h | Pass | High | "auth: hashed passwords..." | scrypt (N=16384); no 2FA | Pass |
| 6 | Session fixation | Old session id after login | Pass: rotated; old id no longer valid | High | same | Sessions stored hashed (sha256) | Pass |
| 7 | CSRF | POST without token; foreign `Origin` | Pass (403) | High | "CSRF: forged..." | Per-session token + Origin check; SameSite=Lax | Pass |
| 8 | Price / discount manipulation | Client-sent `price`, `unit_cents`, `discount_pct` | Pass: ignored; totals from DB; discount forced to configured 20% | High | cart + product tests | Totals recalculated at enquiry and order creation | Pass |
| 9 | Unauthorised stock/price changes | Non-admin writes to product, bulk, variant | Pass (403) | High | access-control test | Audit log records price/stock changes | Pass |
| 10 | Payment integrity | Order `pending -> paid` shortcut; payment without reference/verification; refund above payments | Pass: rejected; stock deducted only on verified confirmation, restored on cancel | High | "admin order workflow", "refund..." | State machine in `services.setOrderStatus` | Pass |
| 11 | Chat privacy | Another visitor reading a conversation; customer calling agent API; message flood | Pass (404/302/429) | High | "live chat..." | Conversation token hashed; agent routes need `support.chat` | Pass |
| 12 | AI abuse/privacy | Ask without consent (403); revoked consent; missing CSRF; rate limit (429); PII not logged | Pass | Medium | AI tests | **Prompt injection against a live model was NOT tested** (no API key). Mitigation by design: model gets only catalogue/policy text, never orders or personal data | Not retested live |
| 13 | File upload | Spoofed content-type / SVG payload; non-admin upload | Pass (415 / denied); valid PNG accepted; served with `nosniff` | High | "image upload..." | Magic-byte check, PNG/JPEG/WebP only, 1 MB cap, no SVG uploads | Pass |
| 14 | Headers | CSP (no `unsafe-inline`), nosniff, frame-ancestors none, HttpOnly/SameSite cookies, no `X-Powered-By` | Pass | Medium | "security headers..." | HSTS + Secure cookies enabled only when `NODE_ENV=production` | Pass |
| 15 | Trackers/consent | No third-party scripts; consent recorded | Pass | Medium | "trackers..." | Optional analytics loads only after opt-in | Pass |
| 16 | CSV injection | Export cells beginning `=`/`+`/`-`/`@` | Pass (prefixed) | Low | import/export test | | Pass |
| 17 | Secrets | `.env` git-ignored; API key read server-side only; no keys in `public/` | Pass by inspection | High | - | | - |
| 18 | CORS | App sets no CORS headers (same-origin only) | Not separately tested | Medium | - | | - |

## Not tested
OWASP ZAP or any dynamic scanner; static analysis (SAST); the live Supabase connection and TLS; production hosting configuration; denial-of-service/load; brute force across multiple server instances; email spoofing; supply-chain review beyond `npm audit`; social engineering; physical security.

## Known weaknesses / residual risk
- Rate limits are in-memory (reset on restart; not shared between instances).
- No two-factor authentication for staff; staff password recovery is CLI-only (customer reset emails are not wired to a mail provider).
- Support agents with `orders.read` can see customer names and emails by design.
- Chat message bodies are stored in plain text; the privacy policy states the intended 12-month retention but **no automatic deletion job is implemented**.
- Product images/uploads live in the database (size limits apply).
