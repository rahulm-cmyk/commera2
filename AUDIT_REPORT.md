# Commera2 Commercial QA Report

Audit date: 1 September 2026, 15:22 IST  
Application: Commera2 `0.1.0`  
Source revision: unavailable — this workspace has no Git commit baseline  
Environment: Windows 11 Pro 64-bit (`10.0.26200`), Node `v24.18.0`, npm `12.0.1`  
Test database: isolated SQLite file `data/commercial-qa-3.sqlite`  
Test server: `http://127.0.0.1:4203` with merchant authentication enabled  
Live local server: `http://127.0.0.1:4173`, restarted after the fixes and healthy

## Executive result

The local application is working and the core merchant-to-customer COD funnel is green. A completely fresh authenticated merchant account, two new stores, a product, product page, published storefront, checkout, COD order, customer, inventory deduction, and post-purchase upsell were exercised against a dedicated database. The upsell was added to the same order exactly once and client-supplied price/quantity tampering was ignored.

The product is **not ready for an unrestricted production/commercial launch** yet. No application-level P0 defect remains in the tested scope, but production-only dependencies and operating controls have not been proven: real PostgreSQL deployment, backups/restores, monitoring, multi-browser CI, live Twilio/delivery/pixel credentials, and real DNS/SSL lifecycle testing.

## Evidence summary

- `npm run check`: **168 passed, 0 failed**.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Fresh-funnel API harness: **13 passed, 0 failed**.
- Public bundle secret-reference scan: **PASS**.
- Repository credential-pattern scan (excluding ignored `.env` files): **PASS**.
- Real in-app Chromium browser checks: **PASS** for login, store switching, selection persistence after refresh, Orders, View order, order details, storefront Buy Now, dedicated checkout, COD settings, Upsells, Exit Offers, and Downsells.
- Responsive sweep on the Upsells/Exit Offers screen: **320, 360, 375, 390, 430, 768, 1024, 1366, and 1920 px** with no page-level horizontal overflow.
- Mobile Orders and checkout at 390 px: card/single-column layouts rendered without horizontal overflow. The visual order is summary first, then delivery details, then Place COD Order.
- Live local server after restart: `/healthz` returned `200 {"status":"ok"}`.
- Existing live Store 1 settings were read without credentials: OTP master switch is `false`; the public storefront no longer contains the stale “requires OTP, but OTP is not configured” error.

## Fresh-store funnel executed

```text
Register isolated merchant
→ reject logged-out merchant API access
→ reject write without CSRF
→ create Store A and Store B
→ create product and add-on in Store A
→ create and publish product page
→ configure post-purchase upsell
→ keep OTP disabled using string boolean payload
→ prove Store B cannot read Store A product/page IDs
→ prove a second merchant cannot read Store A
→ open published storefront
→ create dedicated COD checkout
→ send manipulated price/discount/shipping/total values
→ server recalculates ₹799.00
→ place exactly one COD order
→ accept post-purchase upsell with manipulated product/price/quantity
→ same order becomes ₹1,098.00
→ repeat accept request
→ order total and inventory remain unchanged
→ reject junk customer/address data at final order creation
```

Final connected state:

- Main orders: `1`.
- Main product stock: `10 → 9`.
- Add-on stock: `8 → 7`.
- Order items: main product plus one add-on.
- Final total: `₹1,098.00`.
- Order timeline: order placed, offer shown, upsell accepted, total updated.
- OTP state: `NOT REQUIRED` because the master switch is disabled.

## Findings and fixes

### QA-001 — P1 — OTP disabled value could be misread

Steps: Save OTP settings using HTML/form-style string values such as `"false"`, then place a COD order.  
Expected: the OTP master switch disables all OTP requirements, including stale checkout and adaptive-risk flags.  
Actual: generic JavaScript truthiness could interpret `"false"` as enabled.  
Root cause: boolean normalization used `Boolean(value)` in settings and exact `=== true` checks at API/provider boundaries.  
Fix: normalize `true/false`, `1/0`, `on/off`, and `yes/no` consistently in settings, server, and OTP service code. Added regression coverage.  
Retest: **PASS** in focused tests, full suite, isolated API funnel, and live-server storefront check.

### QA-002 — P2 — stale Exit Offer UI test contract

Steps: run the full suite.  
Expected: Exit Offers live inside the COD Form → Upsells tab, while Downsells remains available.  
Actual: one test still expected the retired “Post-Order Upsells / offers” naming.  
Root cause: the test was not updated after the UI was consolidated into the Upsells tab.  
Fix: assert the current `Upsells`, `COD Upsells`, embedded Exit Offers container, and adjacent `Downsells` tab. No feature was removed.  
Retest: **PASS**; full suite is 168/168.

### QA-003 — P3 — unclear OTP label in order detail

Steps: open an order created while OTP is disabled.  
Expected: `Phone verification — Not required`.  
Actual: the summary label displayed only `Phone — Not required`.  
Root cause: abbreviated UI copy.  
Fix: changed the label to `Phone verification`.  
Retest: **PASS** in the real browser at desktop and 390 px.

## Severity register

### P0 Critical

No unresolved P0 defect was found in the tested local scope. Authentication boundaries, CSRF, store isolation, server-authoritative pricing, one-order idempotency, and same-order upsell behavior all passed.

### P1 High — production launch blockers

1. Production PostgreSQL was not exercised in this audit. The verified runtime uses SQLite.
2. Real Twilio Verify sending, delivery partner calls, pixel delivery, and managed DNS/SSL were not executed because production credentials/providers were not supplied. Adapter and error-path tests pass, but live operations remain unverified.
3. No backup/restore drill, production deployment promotion, rollback procedure, centralized monitoring, or alerting evidence exists.
4. Browser interaction was verified in the in-app Chromium browser; there is no committed cross-browser E2E pipeline for Chromium, Firefox, and WebKit.
5. There is no Git commit/release baseline, so the tested source cannot be tied to an immutable revision.

### P2 Medium

1. `public/app.js` and `src/server.js` remain large monolithic files, increasing regression and maintenance risk.
2. Product/review media is stored as database payloads instead of production object storage with signed uploads.
3. Merchant page templates saved in browser storage are not synchronized across devices.
4. The production pincode/serviceability provider needs an explicit SLA, timeout policy, and fallback provider.
5. Account recovery, email verification, invitations, and merchant membership management are incomplete.

### P3 Polish

1. Some destructive merchant actions still use browser-native confirmation dialogs.
2. Native select/date/file controls remain visually browser-dependent.

## Module result

| Module | Result | Scope note |
| --- | --- | --- |
| Security | PASS locally | Auth, CSRF, IDOR/store isolation, rate limits, tampering, secret scans; production operations unverified |
| UI | PASS for tested paths | Merchant login, stores, Orders/View order, Settings/offers, storefront and checkout |
| Responsive | PASS for tested paths | 320–1920 px sweep; mobile Orders and checkout manually exercised |
| Multi-store | PASS | UI switch/persistence plus API cross-store and cross-account denial |
| Products | PASS | Fresh create, persistence, price and stock connection |
| Product Pages | PASS | Fresh create, publish and storefront connection |
| Checkout | PASS | Dedicated page, two-line address, validation, server totals |
| OTP | PASS locally | Enabled/disabled and provider adapters; no live SMS sent |
| Bot Protection | PASS locally | Signed tokens, honeypot, velocity and blocked-order tests |
| Orders | PASS | Exactly one order, detail route, item/timeline/status data |
| Inventory | PASS | Main and upsell deductions verified; idempotent accept |
| Customers | PASS | Created/updated from the order and store scoped |
| Reviews | PASS automated | Pending/approval/public rating and bulk/manual flows |
| Upsells | PASS | Post-purchase offer adds to the same order exactly once |
| Downsells | PASS automated/UI presence | Feature remains available; automated behavior passes |
| Abandoned Checkout | PASS automated | Inactivity conversion and no-order guarantees covered |
| Policies | PASS automated | Rules, publication, links and eligibility covered |
| Domain | PASS adapter tests | Real external DNS/SSL provider not tested |
| Pixel | PASS adapter tests | Real provider credentials/events not tested |
| Live Visitors | PASS automated | Session progression, dedupe, heartbeat, SSE and bot exclusion |

Full local core funnel: **PASS**  
Unrestricted commercial readiness: **NOT READY**

## Re-run instructions

The repeatable high-risk funnel is in `scripts/commercial-qa.mjs`. Run it only against a new, isolated authenticated QA server/database because it intentionally creates test merchants, stores, products, checkouts, and an order.

Before production approval, repeat this audit against staging PostgreSQL with real-but-nonproduction provider accounts, add automated browser coverage, perform backup/restore and rollback drills, and attach monitoring evidence.
