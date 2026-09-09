# Commera2 implementation roadmap

Source: `C:/Users/ADMIN/Downloads/multi_store_cod_commerce_full_plan_and_master_prompt.md`

The product will be delivered as tested vertical slices, not decorative dashboard pages.

## Part 1 — Foundation commerce slice (current)

Acceptance flow:

1. Create multiple stores under one local merchant account.
2. Switch stores and preserve strict store-scoped data.
3. Create a product with price and real inventory.
4. Create and publish a product page tied to that product.
5. Open the public product page.
6. Progressively persist checkout name, phone, and address as a draft.
7. Submit a COD order.
8. Create/update the customer, create the order and item, reduce inventory, complete the checkout session, and update store metrics.
9. Refresh/restart without losing persisted state.

## Part 2 — Commerce controls

Collections, bundles, coupons, inventory ledger, purchase orders, transfers, and gift-card foundations. Bundles/coupons must change checkout, orders, and inventory.

## Part 3 — Projects and page builder

Connected product pages, editable templates, imported pre-built pages, CTA direct-checkout/redirect, announcement bar, approved-review social proof, and real-stock urgency.

## Part 4 — COD funnel and risk

Configurable COD forms, stronger abandoned-checkout lifecycle, duplicate/blacklist/repeated-source/bot protection, upsell, downsell, and thank-you pages.

## Part 5 — Operations

Order/customer workflows, review submission/moderation, fulfillment, delivery-adapter interface, tags, and bulk actions.

## Part 6 — Tracking and analytics

Visitor sessions, unified journey events, drop-off, live activity, conversion metrics, and pixel adapters on published pages.

## Part 7 — Store setup and publishing

Domain validation/DNS verification/SSL lifecycle, policies, production publishing, and integration status verification.

## Part 8 — AI and extensibility

In-platform AI page generation behind an explicit provider adapter, editable output, MCP-ready integration boundaries, and additional payment providers. Paid AI calls will never run without the user's explicit per-operation permission.

## Definition of done

Every implemented capability has functional UI, backend logic, SQLite persistence, validation, store isolation, error handling, connected business behavior, and automated flow tests. Unimplemented parts are not exposed as fake working controls.
