import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { createApp } from "../src/server.js";

function setup() {
  const db = createDatabase(":memory:"),
    service = new CommerceService(db),
    store = service.createStore({ name: "Nivkara", slug: "nivkara" }),
    product = service.createProduct(store.id, {
      name: "Hair Oil",
      slug: "hair-oil",
      pricePaise: 100000,
      stock: 20,
    }),
    page = service.createProductPage(store.id, {
      productId: product.id,
      title: "Hair Ritual",
      slug: "ritual",
      body: "Daily ritual",
    });
  service.publishPage(store.id, page.id);
  return { db, service, store, product, page };
}

function createOffer(ctx, overrides = {}) {
  return ctx.service.createExitOffer(ctx.store.id, {
    name: "Stay and save",
    status: "active",
    discountType: "percent",
    discountValue: 15,
    headline: "Wait — save on this order",
    message: "Complete your COD checkout now.",
    buttonText: "Claim 15% off",
    rejectText: "No thanks, continue",
    triggerExitIntent: true,
    triggerBack: true,
    triggerInactivity: true,
    triggerMouseLeave: true,
    inactivitySeconds: 10,
    targetType: "all_products",
    showProductPage: true,
    showCheckout: true,
    maxShowsPerSession: 1,
    combinationRule: "better_discount",
    ...overrides,
  });
}

function draft(ctx, overrides = {}) {
  return ctx.service.saveCheckoutDraft(ctx.store.id, {
    pageId: ctx.page.id,
    productId: ctx.product.id,
    quantity: 1,
    paymentMethod: "cod",
    name: "Riya Sharma",
    phone: "9876543210",
    address: "12 Satellite Main Road",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    pincode: "380015",
    termsAccepted: true,
    ...overrides,
  });
}

test("exit offers validate targets and remain scoped to their store", () => {
  const ctx = setup(),
    offer = createOffer(ctx, {
      targetType: "specific_product",
      targetProductId: ctx.product.id,
    }),
    other = ctx.service.createStore({ name: "Other", slug: "other" });
  assert.equal(ctx.service.listExitOffers(ctx.store.id)[0].name, "Stay and save");
  assert.equal(
    ctx.service.eligibleExitOffer(ctx.store.id, {
      productId: ctx.product.id,
      pageId: ctx.page.id,
      context: "product_page",
    }).id,
    offer.id,
  );
  assert.throws(
    () => ctx.service.getExitOffer(other.id, offer.id),
    /not found/i,
  );
  assert.throws(
    () =>
      createOffer(ctx, {
        discountType: "percent",
        discountValue: 101,
      }),
    /1 to 100/i,
  );
});

test("show, reject, and session frequency are enforced by the server", () => {
  const ctx = setup(),
    offer = createOffer(ctx),
    input = {
      sessionKey: "session-frequency-1",
      visitorSessionId: "visitor-1",
      productId: ctx.product.id,
      pageId: ctx.page.id,
      context: "product_page",
    };
  assert.equal(ctx.service.showExitOffer(ctx.store.id, offer.id, input).eligible, true);
  assert.equal(ctx.service.showExitOffer(ctx.store.id, offer.id, input).eligible, false);
  assert.deepEqual(ctx.service.rejectExitOffer(ctx.store.id, offer.id, input), {
    rejected: true,
  });
  assert.equal(ctx.service.showExitOffer(ctx.store.id, offer.id, input).eligible, false);
  const analytics = ctx.service.exitOfferAnalytics(ctx.store.id, offer.id);
  assert.equal(analytics.shown, 1);
  assert.equal(analytics.rejected, 1);
});

test("claim calculates the discount server-side and converts with the order", () => {
  const ctx = setup(),
    offer = createOffer(ctx),
    checkout = draft(ctx, { quantity: 2 }),
    input = {
      sessionKey: "session-convert-1",
      visitorSessionId: "visitor-2",
      checkoutSessionId: checkout.id,
      productId: ctx.product.id,
      pageId: ctx.page.id,
      context: "checkout",
    };
  ctx.service.showExitOffer(ctx.store.id, offer.id, input);
  const claimed = ctx.service.claimExitOffer(
    ctx.store.id,
    checkout.id,
    offer.id,
    { ...input, discountValue: 99999999 },
  );
  assert.equal(claimed.applied, true);
  assert.equal(claimed.checkout.subtotalPaise, 200000);
  assert.equal(claimed.checkout.exitOfferDiscountPaise, 30000);
  assert.equal(claimed.checkout.totalPaise, 170000);
  const order = ctx.service.placeCodOrder(ctx.store.id, {
    sessionId: checkout.id,
  });
  assert.equal(order.discountPaise, 30000);
  assert.equal(order.totalPaise, 170000);
  const analytics = ctx.service.exitOfferAnalytics(ctx.store.id, offer.id);
  assert.equal(analytics.claimed, 1);
  assert.equal(analytics.recoveredOrders, 1);
  assert.equal(analytics.recoveredRevenuePaise, 170000);
  assert.deepEqual(
    ctx.db
      .prepare(
        "SELECT event_type FROM events WHERE store_id=? AND event_type LIKE 'exit_offer_%' ORDER BY id",
      )
      .all(ctx.store.id)
      .map((event) => event.event_type),
    ["exit_offer_shown", "exit_offer_claimed", "exit_offer_converted"],
  );
});

test("coupon combination rules preserve the better discount and can combine", () => {
  let ctx = setup(),
    coupon = ctx.service.createCoupon(ctx.store.id, {
      code: "SAVE20",
      discountType: "percent",
      value: 20,
    }),
    offer = createOffer(ctx),
    checkout = draft(ctx, { couponCode: coupon.code }),
    input = {
      sessionKey: "session-better-1",
      checkoutSessionId: checkout.id,
      productId: ctx.product.id,
      pageId: ctx.page.id,
      context: "checkout",
    };
  ctx.service.showExitOffer(ctx.store.id, offer.id, input);
  let claimed = ctx.service.claimExitOffer(
    ctx.store.id,
    checkout.id,
    offer.id,
    input,
  );
  assert.equal(claimed.applied, false);
  assert.equal(claimed.checkout.couponCode, "SAVE20");
  assert.equal(claimed.checkout.discountPaise, 20000);

  ctx = setup();
  coupon = ctx.service.createCoupon(ctx.store.id, {
    code: "SAVE10",
    discountType: "percent",
    value: 10,
  });
  offer = createOffer(ctx, { combinationRule: "allow_combination" });
  checkout = draft(ctx, { couponCode: coupon.code });
  input = {
    sessionKey: "session-combine-1",
    checkoutSessionId: checkout.id,
    productId: ctx.product.id,
    pageId: ctx.page.id,
    context: "checkout",
  };
  ctx.service.showExitOffer(ctx.store.id, offer.id, input);
  claimed = ctx.service.claimExitOffer(
    ctx.store.id,
    checkout.id,
    offer.id,
    input,
  );
  assert.equal(claimed.checkout.couponCode, "SAVE10");
  assert.equal(claimed.checkout.couponDiscountPaise, 10000);
  assert.equal(claimed.checkout.exitOfferDiscountPaise, 15000);
  assert.equal(claimed.checkout.totalPaise, 75000);
});

async function request(base, path, method = "GET", value) {
  const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    }),
    type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}

test("merchant API and storefront render a responsive pre-purchase offer", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let result = await request(base, "/api/stores", "POST", {
    name: "Nivkara",
    slug: "nivkara",
  });
  const store = result.body;
  result = await request(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 100000,
    stock: 20,
  });
  const product = result.body;
  result = await request(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Hair Ritual",
    slug: "ritual",
    body: "Daily ritual",
  });
  const page = result.body;
  await request(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  result = await request(base, `/api/stores/${store.id}/exit-offers`, "POST", {
    name: "Stay and save",
    status: "active",
    discountType: "percent",
    discountValue: 15,
    headline: "Wait — save on this order",
    buttonText: "Claim offer",
    rejectText: "No thanks, continue",
    triggerExitIntent: true,
    triggerBack: true,
    triggerInactivity: true,
    triggerMouseLeave: true,
    inactivitySeconds: 5,
    targetType: "all_products",
    showProductPage: true,
    showCheckout: true,
    maxShowsPerSession: 1,
    combinationRule: "better_discount",
  });
  assert.equal(result.response.status, 201);
  const offer = result.body;
  result = await request(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.exitOffers[0].id, offer.id);
  const storefront = await request(base, "/s/nivkara/ritual");
  assert.match(storefront.body, /id="exit-offer-dialog"/);
  assert.match(storefront.body, /id="exit-confirm-dialog"/);
  assert.match(storefront.body, /id="exit-confirm-leave" type="button">Continue exit<\/button>/);
  assert.doesNotMatch(storefront.body, /Continue to exit offer|see a special offer before you go/);
  assert.match(storefront.body, /src="\/exit-offer.js"/);
  const script = await request(base, '/exit-offer.js');
  assert.equal(script.response.status, 200);
  assert.match(script.body, /back_attempt/);
  assert.doesNotMatch(script.body, /addEventListener\('mouseout'/);
  const tokenMatch = storefront.body.match(/VISITOR_TOKEN=("[^"]+")/);
  assert.ok(tokenMatch);
  const visitorToken = JSON.parse(tokenMatch[1]),
    sessionKey = "http-claim-session-1";
  result = await request(
    base,
    `/api/public/stores/${store.id}/exit-offers/${offer.id}/shown`,
    "POST",
    {
      visitorToken,
      pageSlug: page.slug,
      productId: product.id,
      pageId: page.id,
      context: "product_page",
      sessionKey,
    },
  );
  assert.equal(result.body.eligible, true);
  result = await request(
    base,
    "/api/public/nivkara/ritual/checkouts",
    "POST",
    { intent: "open", quantity: 1, checkoutToken: visitorToken },
  );
  const checkout = result.body;
  result = await request(
    base,
    `/api/public/checkouts/${checkout.id}/exit-offers/${offer.id}/claim`,
    "POST",
    {
      visitorToken,
      pageSlug: page.slug,
      productId: product.id,
      pageId: page.id,
      context: "product_page",
      sessionKey,
      checkoutSessionId: checkout.id,
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.checkout.totalPaise, 85000);
  assert.equal(result.body.checkout.exitOfferDiscountPaise, 15000);
  const admin = await request(base, "/app.js");
  assert.match(admin.body, /Exit Offers/);
  assert.match(admin.body, /COD Upsells/);
  assert.match(admin.body, /\["upsells", "Upsells"\]/);
  assert.match(admin.body, /cod-upsells-exit-offers/);
  assert.match(admin.body, /\["downsells", "Downsells"\]/);
});
