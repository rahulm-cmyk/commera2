# Merchant UI Redesign

## Restore Point

The pre-redesign revision is `2b3ee217a55e84db949a881ae4127c23ff5b23f0`.
Backup folder: `C:\Users\ADMIN\Documents\Commera2_backups\2026-09-10-pre-ui-2b3ee21`.
It contains a source archive, verified Git bundle, consistent local SQLite
backup, and private local environment files. SQLite integrity check passed.
It does not contain a snapshot of the hosted PostgreSQL database.

## Local Preview

Run `npm run preview:ui`, then open http://127.0.0.1:4188/overview.
This loopback-only preview uses separate sample data in
`data/merchant-ui-preview.sqlite`, never the production database. It runs without
merchant login for design review; account security is tested separately with an
authenticated, in-memory test instance. Do not deploy this preview launcher.

The redesign is on `codex/merchant-ui-redesign`. The existing Render deployment
has not been replaced with this redesign.

## Changes

- Light navigation, consistent typography, responsive forms and tables.
- Home overview with real metrics, customer journey and store setup status.
- Searchable page navigation with keyboard controls and focus restoration.
- Clear live-store and saved-draft actions retain their existing behavior.
- Direct product-name editing and product-search count/empty results.
- Mobile order search and readable mobile recent-order cards.
- Short transitions with reduced-motion support.
- Local Lucide SVG assets and license; regenerate with `npm run ui:icons`.

Business logic and existing account, order, checkout, domain and publication
contracts are preserved. Server changes only expose the new static UI assets.

## Verification

- `npm run check`: 255 passed, 1 optional PostgreSQL test skipped.
- Browser QA: 39 route/viewport combinations plus the login screen, in Chrome.
  Desktop/tablet widths: 1440, 1024. Mobile widths: 390, 320.
- Checked page search, keyboard navigation, product search/edit/save, mobile
  navigation, order search, account screens, hidden dialogs and asset loading.
- No browser JavaScript errors or page-level horizontal overflow in those checks.
- Screenshots: `qa-ui-*.png` (ignored by Git).
- `scripts/qa-merchant-ui.mjs` uses Playwright. Set `PLAYWRIGHT_MODULE` to the
  installed Playwright module URL when using the bundled desktop runtime.

This is not certification that every workflow is bug-free. Cross-browser testing
and a complete production release audit remain separate work.
