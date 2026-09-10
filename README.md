# Commera2

## Account security and recovery

The sidebar shows the signed-in name and email. Account & Security (`/account`)
lets merchants edit their name, change their password, and revoke sessions.
Google-only accounts can set a password within five minutes of Google sign-in;
older sessions must confirm the same linked Google account first. Password changes
rotate the current session and revoke other sessions. Existing passwords require
the current password or a Google sign-in in the last five minutes. Google-linked
merchants can use that confirmation to reset a forgotten password without email.
All account writes require the session CSRF token.

Forgot password uses the Resend HTTPS email API. Set `RESEND_API_KEY`,
`AUTH_EMAIL_FROM` (an address on your verified sending domain), and `APP_BASE_URL`
in the hosting environment. Redeploy to apply them. Until configured, the recovery
screen explains that email is unavailable; Google sign-in continues to work.
The Google OAuth client secret does not grant permission to send email.

Reset links expire in 30 minutes, use hashed single-use tokens, and invalidate
all existing sessions and reset links when used. The token is carried in the URL
fragment and removed from the address bar when the reset form opens.
See [Resend sending setup](https://resend.com/docs/api-reference/emails/send-email).

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

## Google merchant sign-in

Create an OAuth client in Google Cloud Console with application type **Web
application**. Configure these exact authorized redirect URIs for the environments
you use:

```text
http://localhost:4173/api/auth/google/callback
https://commera2.onrender.com/api/auth/google/callback
```

Set the following server environment variables locally and in Render:

```bash
APP_BASE_URL=https://commera2.onrender.com
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
AUTH_OAUTH_STATE_SECRET=a-separate-random-secret-at-least-32-characters-long
```

For local development, use `APP_BASE_URL=http://localhost:4173`. The redirect URI
must match Google Cloud exactly, including scheme, hostname, port, path, and trailing
slash. Secrets belong only in the ignored `.env` file or Render environment settings;
never commit them. Commera requests only identity scopes and does not store Google
access or refresh tokens.

## Render persistence

Do not use SQLite for a real Render deployment. A free Render web service can
restart or redeploy with temporary filesystem state, so stores, products, pages,
orders, and settings can disappear. For testing that must survive refreshes,
restarts, and deploys, create a PostgreSQL database and set these Render
environment variables:

```bash
DATABASE_MODE=postgres
DATABASE_URL=postgresql://...
```

After redeploy, open `/healthz` or `/readyz`. A safe deploy reports:

```json
{"database":{"mode":"postgres","persistent":true}}
```

## Custom domains

Settings → Domain supports existing-domain connection, per-record DNS and ownership
verification, managed-SSL provider state, primary-domain redirects, custom-host
storefront routes, background rechecks, and an audit trail. Configure the platform
host and routing targets with `DOMAIN_PLATFORM_HOST`, `DOMAIN_CNAME_TARGET`, and,
when required by the hosting provider, `DOMAIN_APEX_TARGET`.

The local `manual` provider truthfully remains at **SSL Pending** after DNS verifies.
On Render, Commera automatically checks the public HTTPS endpoint every minute and
marks the domain Active only after Render has issued its certificate. Add the domain
to Render first under **Settings > Custom Domains**; this check does not create a
Render domain association. Render hosts do not need Commera's additional TXT record:
Render's HTTPS certificate proves the domain connection. Other hosts can opt in with
`DOMAIN_SSL_PROVIDER=https`.

## Test

```bash
npm test
npm run check
```

Tests exercise service-level rules and the real HTTP merchant-to-public COD flow.

## Paid services

Part 1 makes no paid API calls. Future AI page generation is deliberately deferred behind a provider adapter and will require explicit user permission before each paid or credit-consuming operation.
