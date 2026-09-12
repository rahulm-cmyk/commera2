# Checkout, Security and UI Audit

Date: 2026-09-12
Baseline: 50b55c4

## Scope

Reviewed request parsing, merchant authentication, settings validation, checkout and order submission, privacy headers, browser storage, theme editing and responsive merchant UI. This is a tested engineering audit, not a certification that every possible defect or attack has been eliminated.

Tests used isolated databases and local sample data. No real customer orders, inventory or provider credentials were modified. The existing local store-preview database received read-only integrity checks. SMS was not enabled.

## Findings Fixed

| Finding | Change | Evidence |
| --- | --- | --- |
| Malformed URL parsing could escape the asynchronous HTTP handler | Return a controlled 400 before routing; subsequent requests remain usable | Raw malformed HTTP request followed by health check |
| Invalid JSON shapes, reserved properties, excessive nesting and malformed settings could reach application internals | Validate object bodies and nested properties, restrict settings module names to own properties, reject invalid object replacements | Request and settings regression tests; rejected writes leave settings unchanged |
| Request size was counted as JavaScript characters; split UTF-8 chunks could decode incorrectly | Count bytes, decode after concatenating buffers, return 413 without destroying the response socket | Unicode chunk boundary and oversized real HTTP tests |
| A malformed unrelated cookie could break the entire request | Ignore that cookie's invalid encoded value | HTTP authentication-status request with a malformed cookie |
| Checkout and receipt pages lacked explicit sensitive-page caching/referrer rules | Add private/no-store, no-referrer, and noindex headers | Built-in and custom-domain path header tests |
| Login accepted oversized password input into password hashing | Apply the existing 256-character password limit before verification | Existing and unknown account tests; valid login still succeeds |
| Slow address lookups and overlapping autosaves could display or save outdated information | Cancel/ignore outdated pincode results, serialize save snapshots, suppress superseded errors | Delayed responses in real Chromium; final stored address and name verified |
| Repeated submits and lost confirmation responses produced confusing failures | Add a submission lock and busy state; concurrent/completed order retries return the existing receipt | Triple browser submit, concurrent API requests, lost response after order creation, unchanged stock and one order |
| Blocking browser storage could prevent Buy Now and checkout scripts from initializing | Fall back to page-memory storage; tracking consent defaults to denied when storage cannot be read | Browser with both storage APIs blocked completes an order |
| Multi-quantity checkout showed a single unit in the product subtotal row | Render the selected quantity price and refresh summary amounts from server responses | Three units display and charge the same amount |
| Duplicating a section removed heading formatting and changed visible copy | Preserve the complete section content while assigning a new section ID | Browser reproduction, duplicate, save/reload and rich-text comparison |
| Product-page connections were missing from theme-editor navigation | Restore Products & pages in desktop Store tools and mobile sections | Connection controls exercised at eight widths |
| Saving a product connection rebuilt the editor and lost unsaved home changes | Update the connection in place and preserve the active editor and draft | Save connection with unsaved heading; heading remains unchanged |
| Connection action buttons overflowed narrow editor panels | Use wrapping actions and a full-width primary action in narrow containers | Geometry and screenshots at 320-1440px |

## Checkout Animation

Settings > COD Form > Customer Fields > Checkout animation:

- Off, Fade, or Slide, with a Preview control.
- Existing stores default to Off until a merchant chooses an effect.
- The setting saves per store and is used by page, popup and embedded checkout.
- Reduced-motion preferences cancel or disable the effect.
- Motion never delays saving or submitting an order.
- Submission shows a busy label and indicator; errors retain entered details for retry.

Main checkout behavior is now in `public/checkout.js`, with shared animation behavior in `public/checkout-motion.js`. Server-side prices, validation, stock transactions and store authorization remain authoritative.

## Verification

- `npm run check`: 306 passed, 0 failed, 1 skipped, 307 total.
- `npm audit --json`: zero known dependency advisories at audit time.
- `scripts/qa-checkout-reliability.mjs`: animation persistence/preview/reduced motion; storage denial; price display; stale lookup; serialized saves; repeated submit; failed and lost responses; successful recovery; desktop/mobile layouts.
- `scripts/qa-cod-builder.mjs`: optional extras, custom fields, popup/embedded checkout, shipping, post-purchase offers and mocked Sheets export.
- `scripts/qa-store-theme-editor.mjs`: selection, sections/blocks, reorder, undo/redo, typography, safe links/lists, duplicate content, save/reload and responsive layout.
- `scripts/qa-account-security.mjs`: account identity, AJAX navigation, password validation/change, session revocation and mocked email recovery.
- `scripts/qa-merchant-ui.mjs`: 39 page/viewport combinations, search and account views, with no browser errors or broken visible images.
- `scripts/qa-merchant-regressions.mjs`: orders, connection actions and identity at eight widths; multi-store selection, keyboard navigation and unsaved-edit cancellation. Updated the old navigation assumptions to match the current full-screen editor.
- `scripts/audit-local-data.mjs data/imported-editor-preview.sqlite`: SQLite quick check OK; zero foreign-key violations, negative stock, mismatched order totals or cross-store item/page references. The audit calculation now accounts for gift-card credit.
- `git diff --check`: passed.

Screenshots are in `data/checkout-audit`, `data/store-theme-editor-qa`, `data/cod-builder-qa`, and the ignored `qa-ui-*.png` files.

## Remaining Validation Boundaries

- The skipped database test requires `TEST_POSTGRES_URL`. SQLite and timestamp regression tests passed; a real PostgreSQL integration run is still needed.
- Live Google OAuth, live Sheets delivery, email deliverability and paid provider integrations were not exercised. Their local flows used test adapters. No SMS setup was added.
- Production verification is limited to deployment status, health, publicly served assets and unauthenticated access protection. No live test purchases were created.
- Reverse-proxy client-IP handling, shared rate limiting for multiple server instances, load/soak testing, backup restoration and a staged Content Security Policy rollout remain deployment-hardening work. Forwarded headers were not blindly trusted in this patch.
- Desktop/mobile checks used Chromium. Safari, Firefox, assistive-technology testing and a dedicated external penetration test remain advisable before a broad launch.
- The existing rich-text editing engine still uses browser editing commands. This audit fixes data loss and exercises current behavior; replacing that engine is separate migration work.

## Release Safety

No database migration or dependency upgrade is required. The baseline commit above is the code rollback point. Newly added motion settings are optional and default to Off. Deployment status and the released commit are reported separately after Render verification.
