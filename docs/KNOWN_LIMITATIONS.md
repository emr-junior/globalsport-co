# Known limitations and outstanding tasks
1. **Not deployed or live-tested here.** Follow `docs/DEPLOYMENT.md`, then run the manual checks in the two reports.
2. **Sample data.** 2,100 generated sample listings and illustrative images; no real supplier feed, no photos, no reviews (reviews appear only after a delivered order + moderation).
3. **No online payments** by design. `mailto:` does not send mail; the confirmation page gives a Gmail-compose link and copyable text as fallbacks. Admin records payment manually after verifying it elsewhere.
4. **Tax/duty not calculated** (disclosed in cart/checkout/terms). Shipping is a configurable flat rate per currency, not carrier-calculated. Prices are stored per currency (no live FX).
5. **Email:** no transactional email provider is wired in (no order emails, newsletter sending or customer password-reset emails). Reset links are logged to the server console in non-production only.
6. **AI assistant:** needs `ANTHROPIC_API_KEY`; live behaviour and prompt-injection resistance not tested here. Retrieval is simple keyword search over the catalogue.
7. **Chat** uses 4-second polling (no websockets); no file attachments (deliberately omitted); chat/retention clean-up job not implemented.
8. **Rate limiting** is in-memory per instance. **No 2FA** for staff.
9. **Search** uses `ILIKE`, adequate for ~2k products; add `pg_trgm`/full-text indexes for much larger catalogues.
10. **Images** are stored in the database; large catalogues should use object storage.
11. **Legal text** is a template; business details, governing law and retention periods must be completed and reviewed by a lawyer. Returns window (30 days) is a placeholder.
12. **Performance** was not load-tested; only functional timings (seed ~1-3 s, full test suite ~15 s) were observed.
13. Customer-facing order emails/notifications, order-confirmation PDFs, product import with images, multi-image gallery UI and a review-submission UI beyond the basic form are not included.
