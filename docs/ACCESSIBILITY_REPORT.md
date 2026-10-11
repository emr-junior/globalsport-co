# Accessibility report - GlobalSport Co. (target: WCAG 2.2 AA)
Date 2026-10-10. No accessibility overlay or widget is used; accessibility is implemented in the markup/CSS.

## Automated checks run (tests/accessibility.test.js - all pass)
- Colour contrast computed from the CSS design tokens: body text, muted text, brand/accent/OK/warn colours on white and light-grey backgrounds >= 4.5:1; white-on-brand, white-on-accent and alert colour pairs >= 4.5:1; focus colour >= 3:1.
- On 11 rendered pages: `lang`, exactly one `<h1>`, skip link, `<main>`, footer, sports navigation landmark, every `<img>` has an `alt` attribute (decorative card images use `alt=""` with the linked product name carrying the name), every input/select/textarea has a `<label for>` or `aria-label`, no unnamed buttons.
- Form errors: summary with `role="alert"`, `aria-invalid`, `aria-describedby` linking field errors.
- Focus-visible outline and `prefers-reduced-motion` rules exist in the stylesheet.

## Design measures (by inspection, not machine-verified)
Native controls (`<details>`, `<dialog>`, `<select>`, buttons) for keyboard operation; 44px minimum button height; discount shown as text ("20% OFF") not colour alone; stock status as text; chat/AI widgets are `role="dialog"` with focus moved in, Escape to close, `aria-live` log; pagination uses `aria-current`; tables use `<th scope>`.

## NOT tested - required before you claim conformance
Browser-based audits (axe DevTools / Lighthouse / WAVE); a real keyboard walkthrough of every flow (focus order in the quick-view dialog and chat widget especially); screen-reader testing (NVDA/JAWS/VoiceOver/TalkBack); 200% zoom and 320px reflow; Windows high-contrast mode; touch-target audit on real devices; cognitive/plain-language review. Known gaps to check: the "All sports" `<details>` menu does not close on Escape; the AI/chat widgets are not focus-trapped (non-modal by design).
