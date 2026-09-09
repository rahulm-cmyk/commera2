# Commera2

A local-first multi-store COD commerce platform built from the supplied 2,237-line blueprint.

## Current implementation: Part 1

This is a working vertical slice, not a static dashboard:

- Multiple isolated stores
- Products with price and inventory
- Product pages tied to products and multiple independent projects
- Blank editable page creation
- Safe pre-built HTML page import with active-content sanitization
- Merchant Social Proof selection inside Project/Page creation: `Fake social` or `Real social`
- Merchant urgency creation: none, limited stock, limited time, or high demand with custom copy
- Product quantity bundles with merchant-defined pricing and live checkout selection
- Discount coupon codes with percentage or fixed discounts, minimum orders, usage limits, and optional expiry
- Complete Orders workspace with individual/bulk selection, required status/delivery columns, item summaries, and persistent custom tags
- Three responsive high-quality template systems (Warm Story, Clinical Proof, Premium Night)
- AI page-generation adapter with editable structured output; paid provider remains disabled until explicit authorization
- Draft/publish lifecycle
- Public storefront route
- Debounced progressive checkout persistence
- Abandoned checkout visibility
- Validated COD order placement
- Customer creation/update
- Connected order and order-item records
- Atomic inventory reduction
- Product operations: collections, location-level inventory and movement ledger
- Purchase orders with one-time stock receipt
- Inter-location transfers with tracked send/receive states
- Gift-card issuance, balance persistence, and disabling
- Real sales/order/conversion metrics
- Full Pixel workspace with Meta, Google, TikTok, Snapchat, Pinterest, Microsoft,
  and Custom connections; browser/server routing, mappings, tests, activity, and retry
- SQLite persistence for a zero-setup local run, with PostgreSQL available for production-style deployments

See `IMPLEMENTATION_PARTS.md` for the complete phased roadmap.

## Product Page drafts and blocks

Saving a published Product Page now saves a private draft. Merchant Preview uses that draft; customer pages, checkout and Thank You use the published snapshot. Click Publish to apply the draft, including any URL change. A failed publish keeps the previous live snapshot and the saved draft intact.

In Product Pages → Edit → Add Section, choose **Custom Section (Blocks)**. Add heading, text, image (URL), and button blocks inside it. Select a block in the tree or canvas to edit it, reorder it, or hide/show it. Block edits participate in Undo/Redo. The block markup and supported section styling are shared between the editor and storefront.

Online Store now groups Themes, Pages and Preferences. Themes opens the current design in a sections–preview–settings editor. Homepage and shared branding changes are saved as drafts; the previous published design stays live until Publish Store. Product data (including current price and stock) stays connected rather than being frozen in a design snapshot. A multi-theme library and Shopify theme import are not implemented.

Pages supports separate content-page drafts, preview, publishing and hiding, with public URLs at `/s/:store/pages/:handle` (or `/pages/:handle` on a connected domain). Publish a page and add its URL through Header & menu to make it discoverable. Preferences saves the homepage search title and description and links to existing domain, privacy and tracking controls. Checkout, upsells, downsells and Back-button Exit Offers retain their existing flow.

For isolated browser testing without real merchant data or integrations, run `node scripts/builder-draft-smoke-server.js` (port 4188, in-memory database).

## Run

Requires Node.js 24 or later and installed Node dependencies. SQLite is the
default local database and requires no separate database server.

Copy `.env.example` to `.env` and set a strong `PIXEL_CREDENTIALS_SECRET` before
storing server-side provider credentials. The `.env` file is ignored by Git.

```bash
npm install
npm start
```

Open: http://127.0.0.1:4173

The included local configuration uses `DATABASE_MODE=sqlite`, stores data in
`commera2.sqlite`, and works without PostgreSQL.

To use PostgreSQL, set `DATABASE_MODE=postgres`, provide a valid `DATABASE_URL`,
then migrate the existing SQLite schema and data once:

For a new PostgreSQL database, migrate the existing SQLite schema and data once:

```bash
npm run migrate:postgres
```

The migration refuses to overwrite a non-empty PostgreSQL schema.

`DATABASE_MODE=auto` selects PostgreSQL when `DATABASE_URL` is present and SQLite
otherwise. Tests that explicitly request an in-memory database continue to use SQLite.

## Custom domains

Settings → Domain supports existing-domain connection, per-record DNS and ownership
verification, managed-SSL provider state, primary-domain redirects, custom-host
storefront routes, background rechecks, and an audit trail. Configure the platform
host and routing targets with `DOMAIN_PLATFORM_HOST`, `DOMAIN_CNAME_TARGET`, and,
when required by the hosting provider, `DOMAIN_APEX_TARGET`.

The local `manual` provider truthfully remains at **SSL Pending** after DNS verifies.
A production deployment must supply an authorized `sslProvider` adapter through
`domainOptions`; a domain is never marked Active until that adapter confirms HTTPS.

## Test

```bash
npm test
npm run check
```

Tests exercise service-level rules and the real HTTP merchant-to-public COD flow.

## Paid services

Part 1 makes no paid API calls. Future AI page generation is deliberately deferred behind a provider adapter and will require explicit user permission before each paid or credit-consuming operation.
