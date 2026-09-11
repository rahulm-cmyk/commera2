# Campaigns and UTM links

Open `/campaigns` in the merchant workspace. Data belongs to the selected store
and persists in the configured SQLite or PostgreSQL database.

## Included

- Manual campaign URL builder with Facebook, Instagram, Google Search, YouTube,
  and affiliate source/medium presets.
- Campaign registry, status, editing, deletion, search, link copying, CSV export.
- Text campaign/ad IDs; existing landing-page queries and fragments are retained.
- Atomic external-order CSV import with exact campaign-ID matching. Required
  headers: `date,order_id,revenue,utm_id`. Dates use `YYYY-MM-DD`; revenue is in the
  selected store's currency. Maximum 1,000 rows and 1 MB per UI upload.
- Reimporting an external Order ID replaces that report entry. External imports
  never create commerce orders or modify inventory.
- Store-order attribution captures URL tags from the referring page when checkout
  opens, only when existing analytics consent settings permit it. Same-store links
  carry current tags forward without cookies or local storage.

## Boundaries

- No advertising-account connection, ad spend sync, automatic macro substitution,
  cross-device attribution, cookie attribution window, or currency conversion.
- One registry entry per Campaign ID per store. Imported reports match this exact
  ID. Deleting a campaign retains orders and leaves them unmatched.
- Store-order attribution is checkout-opening attribution, not first-touch or
  multi-touch attribution. Missing/redacted referrers or rejected analytics consent
  produce no attribution. Existing orders cannot be retrospectively attributed.
- Gross attributed order values include unpaid/cancelled orders; this is not a
  net-revenue or ROAS report. Imported and native orders remain separate.
- CSV files do not carry spreadsheet cell types. When opening exported CSVs in
  Excel, import ID columns as Text to retain leading zeros and long IDs.

## Verification

`node --test test/campaigns.test.js` covers URL handling, long IDs, CSV parsing,
store-scoped CRUD, atomic/repeated imports, consent, and checkout-to-order joins.
The PostgreSQL schema path is included but needs a live PostgreSQL test before
production rollout.
