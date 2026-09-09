# Commera2 Settings Module — Vertical Delivery Map

## Working standard
Every setting follows: merchant action → server validation → store-scoped persistence → live behavior → truthful readback → automated verification.

## Dependency order
1. Store-scoped settings foundation and Settings shell.
2. COD Form and Checkout rendering/draft/protection behavior.
3. Shipping methods, zones, free-shipping threshold, delivery estimate, and order totals.
4. Customer Privacy consent/data gates.
5. Pixel configuration/event readback connected to privacy.
6. Domain and Delivery partner read models moved into Settings and enhanced without fake external states.
7. Sales Channels and product availability/order-source enforcement.
8. Persistent migration, complete suite, live HTTP/UI, restart verification.

## Acceptance slices

### COD Form + Checkout
- Persist general form, field, summary, button, abandoned-draft, autofill, coupon, and protection controls per store.
- Render labels/placeholders/visibility/required state on published pages.
- Core COD delivery fields remain server-required.
- Disabling COD/checkout rejects real checkout requests.
- Progressive drafts and fraud checks follow persisted switches.

### Shipping and Delivery
- Persist methods, zones, free-shipping threshold, and delivery range.
- State-selected shipping affects authoritative checkout/order total and persists shipping charge/method.
- Delivery adapters remain truthful; credentials require a configured secure secret and real adapter test.

### Privacy + Pixel
- Persist cookie banner and data/tracking permissions.
- Consent-required tracking does not load pixels or record events before acceptance.
- Disabled abandoned-data collection prevents progressive drafts.
- Pixel list includes names, last event, event-by-type readback, supported platform validation, and safe custom HTTPS endpoint behavior.

### Domain
- Settings table shows domain, status, DNS, SSL, primary, last checked, records, and errors.
- DNS/SSL states remain provider-verified; no fake Active state.

### Sales Channels
- Persist channels and per-product availability.
- Disabled Online Store product is not publicly purchasable.
- Orders retain the real originating channel shown in Orders.

## External boundaries
No paid API calls. Domain SSL, delivery provider authentication, and external channel connections become Active only through configured adapters and real successful checks. Credentials are never returned to browser payloads.