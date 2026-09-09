import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { createApp } from "../src/server.js";

const customer = {
  name: "Meera Sharma",
  phone: "9876543210",
  address: "12 MG Road Bengaluru",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  termsAccepted: true,
};

function setup() {
  const db = createDatabase(":memory:"),
    service = new CommerceService(db),
    store = service.createStore({ name: "Nivkara", slug: "nivkara" }),
    product = service.createProduct(store.id, {
      name: "Hair Oil",
      slug: "hair-oil",
      pricePaise: 79900,
      stock: 10,
    }),
    addOn = service.createProduct(store.id, {
      name: "Wooden Comb",
      slug: "wooden-comb",
      pricePaise: 39900,
      stock: 8,
    }),
    page = service.createProductPage(store.id, {
      productId: product.id,
      title: "Hair Ritual",
      slug: "ritual",
      body: "Daily ritual",
    });
  service.publishPage(store.id, page.id);
  const upsell = service.createUpsell(store.id, {
    productId: product.id,
    upsellProductId: addOn.id,
    name: "Neem comb add-on",
    headline: "Add a neem wooden comb",
    pricePaise: 29900,
    quantity: 1,
    status: "active",
  });
  return { db, service, store, product, addOn, page, upsell };
}

function orderWithOffer(context) {
  const draft = context.service.saveCheckoutDraft(context.store.id, {
      pageId: context.page.id,
      productId: context.product.id,
      quantity: 1,
      upsellId: context.upsell.id,
      ...customer,
    }),
    order = context.service.placeCodOrder(context.store.id, {
      sessionId: draft.id,
    });
  return { draft, order, offer: order.postPurchaseUpsell };
}

async function request(base, path, method = "GET", data) {
  const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}

test("a one-product store can offer another unit as a post-purchase upsell", () => {
  const db = createDatabase(":memory:"),
    service = new CommerceService(db),
    store = service.createStore({ name: "Nivkara", slug: "nivkara" }),
    product = service.createProduct(store.id, {
      name: "Hair Oil",
      slug: "hair-oil",
      pricePaise: 79900,
      stock: 5,
    }),
    page = service.createProductPage(store.id, {
      productId: product.id,
      title: "Hair Ritual",
      slug: "ritual",
      body: "Daily ritual",
    });
  service.publishPage(store.id, page.id);
  const upsell = service.createUpsell(store.id, {
      productId: product.id,
      upsellProductId: product.id,
      triggerType: "any_product",
      allowExistingProduct: true,
      name: "Second bottle offer",
      headline: "Add another bottle",
      pricePaise: 59900,
      quantity: 1,
      status: "active",
    }),
    draft = service.saveCheckoutDraft(store.id, {
      pageId: page.id,
      productId: product.id,
      quantity: 1,
      ...customer,
    }),
    order = service.placeCodOrder(store.id, { sessionId: draft.id });

  assert.equal(order.postPurchaseUpsell?.upsellId, upsell.id);
  service.acceptOrderUpsell(
    store.slug,
    draft.id,
    order.postPurchaseUpsell.id,
    order.postPurchaseUpsell.token,
  );
  assert.equal(service.listOrders(store.id)[0].totalPaise, 139800);
  assert.equal(service.getProduct(store.id, product.id).stock, 3);
});

test("post-purchase accept updates the same confirmed order atomically and once", () => {
  const context = setup(),
    { service, store, product, addOn } = context,
    { draft, order, offer } = orderWithOffer(context);

  assert.equal(draft.upsellId, null);
  assert.equal(draft.totalPaise, 79900);
  assert.equal(order.totalPaise, 79900);
  assert.ok(order.id);
  assert.ok(offer?.token);

  const shown = service.getPublicOrderUpsell(
    store.slug,
    draft.id,
    offer.id,
    offer.token,
  );
  assert.equal(shown.interaction.status, "SHOWN");
  const accepted = service.acceptOrderUpsell(
    store.slug,
    draft.id,
    offer.id,
    offer.token,
  );
  assert.equal(accepted.interaction.status, "ACCEPTED");
  assert.equal(accepted.interaction.orderTotalPaise, 109800);
  assert.equal(service.listOrders(store.id)[0].itemCount, 2);
  assert.match(service.listOrders(store.id)[0].itemSummary, /Wooden Comb/);
  assert.equal(service.getProduct(store.id, product.id).stock, 9);
  assert.equal(service.getProduct(store.id, addOn.id).stock, 7);

  service.acceptOrderUpsell(store.slug, draft.id, offer.id, offer.token);
  assert.equal(service.getProduct(store.id, addOn.id).stock, 7);
  assert.equal(service.listOrders(store.id)[0].itemCount, 2);
  const analytics = service.upsellAnalytics(store.id, context.upsell.id);
  assert.deepEqual(
    {
      shown: analytics.shown,
      accepted: analytics.acceptedCount,
      revenue: analytics.upsellRevenuePaise,
    },
    { shown: 1, accepted: 1, revenue: 29900 },
  );
  const timeline = service.getOrderDetails(store.id, order.id).events;
  assert.ok(timeline.some((item) => item.eventType === "upsell_accepted"));
  assert.ok(timeline.some((item) => item.eventType === "order_total_updated"));
});

test("reject keeps the original order, is refresh-safe, and never cancels it", () => {
  const context = setup(),
    { draft, order, offer } = orderWithOffer(context),
    rejected = context.service.rejectOrderUpsell(
      context.store.slug,
      draft.id,
      offer.id,
      offer.token,
    );
  assert.equal(rejected.interaction.status, "REJECTED");
  assert.equal(rejected.interaction.orderTotalPaise, 79900);
  const refreshed = context.service.getPublicOrderUpsell(
    context.store.slug,
    draft.id,
    offer.id,
    offer.token,
  );
  assert.equal(refreshed.interaction.status, "REJECTED");
  const persisted = context.service.getOrderDetails(context.store.id, order.id);
  assert.equal(persisted.totalPaise, 79900);
  assert.equal(persisted.fulfillmentStatus, "unfulfilled");
  assert.equal(persisted.items.length, 1);
});

test("offer authorization, inventory, and order locks are enforced server-side", () => {
  {
    const context = setup(), { draft, offer } = orderWithOffer(context);
    assert.throws(
      () =>
        context.service.acceptOrderUpsell(
          "wrong-store",
          draft.id,
          offer.id,
          offer.token,
        ),
      /not found/i,
    );
    assert.throws(
      () =>
        context.service.acceptOrderUpsell(
          context.store.slug,
          draft.id,
          offer.id,
          "tampered",
        ),
      /not found/i,
    );
  }
  {
    const context = setup(), { draft, offer } = orderWithOffer(context);
    context.db
      .prepare("UPDATE products SET stock=0 WHERE id=?")
      .run(context.addOn.id);
    assert.throws(
      () =>
        context.service.acceptOrderUpsell(
          context.store.slug,
          draft.id,
          offer.id,
          offer.token,
        ),
      /eligible|stock/i,
    );
    assert.equal(context.service.listOrders(context.store.id)[0].itemCount, 1);
  }
  {
    const context = setup(),
      { draft, order, offer } = orderWithOffer(context);
    context.db
      .prepare("UPDATE orders SET fulfillment_status='fulfilled' WHERE id=?")
      .run(order.id);
    assert.throws(
      () =>
        context.service.acceptOrderUpsell(
          context.store.slug,
          draft.id,
          offer.id,
          offer.token,
        ),
      /no longer be modified/i,
    );
    assert.equal(
      context.service.getProduct(context.store.id, context.addOn.id).stock,
      8,
    );
  }
});

test("HTTP checkout creates the order before the one-click offer and Thank You reflects acceptance", async (t) => {
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
    pricePaise: 79900,
    stock: 10,
  });
  const product = result.body;
  result = await request(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Wooden Comb",
    slug: "comb",
    pricePaise: 39900,
    stock: 8,
  });
  const addOn = result.body;
  result = await request(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Hair Ritual",
    slug: "ritual",
    body: "Daily ritual",
  });
  const page = result.body;
  await request(base, `/api/stores/${store.id}/upsells`, "POST", {
    productId: product.id,
    upsellProductId: addOn.id,
    name: "Comb offer",
    headline: "Add a neem wooden comb",
    pricePaise: 29900,
    status: "active",
  });
  await request(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );

  result = await request(base, "/api/public/nivkara/ritual/checkouts", "POST", {
    quantity: 1,
    ...customer,
  });
  const draft = result.body;
  result = await request(base, `/s/nivkara/checkout/${draft.id}`);
  assert.doesNotMatch(result.body, /name="upsellId"|Add a neem wooden comb/);
  result = await request(
    base,
    `/api/public/checkouts/${draft.id}/order`,
    "POST",
    { storeId: store.id },
  );
  assert.equal(result.response.status, 201);
  assert.equal(result.body.totalPaise, 79900);
  assert.match(result.body.nextUrl, /^\/s\/nivkara\/upsell\//);
  assert.equal(result.body.thankYouUrl, result.body.nextUrl);
  assert.doesNotMatch(JSON.stringify(result.body), /postPurchaseUpsell|"token"/);

  const offerUrl = result.body.nextUrl,
    offerId = new URL(base + offerUrl).searchParams.get("offer"),
    token = new URL(base + offerUrl).searchParams.get("token");
  result = await request(base, offerUrl);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Order .* is confirmed|Add a neem wooden comb/);
  assert.match(result.body, /No details to enter again/);
  assert.doesNotMatch(
    result.body,
    /name="phone"|name="address"|id="cod-form"/,
  );

  result = await request(
    base,
    `/api/public/upsells/${offerId}/accept`,
    "POST",
    {
      storeSlug: store.slug,
      checkoutSessionId: draft.id,
      token,
      pricePaise: 1,
      quantity: 99,
      upsellProductId: product.id,
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.interaction.orderTotalPaise, 109800);
  assert.match(result.body.nextUrl, /^\/s\/nivkara\/thank-you\//);
  const thankYou = await request(base, result.body.nextUrl);
  assert.match(thankYou.body, /Wooden Comb/);
  assert.match(thankYou.body, /₹1,098/);

  const script = await request(base, "/app.js");
  assert.match(script.body, /Create Upsell/);
  assert.match(script.body, /One-product mode/);
  assert.match(script.body, /addUpsellButton\.disabled = false/);
  assert.match(script.body, /Step \$\{step\} of 5/);
  assert.match(script.body, /View analytics/);
  assert.match(script.body, /Existing order → offer → Thank You/);
});

test("COD Upsell admin and wizard keep the mobile responsive contract", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    [script, styles] = await Promise.all([
      request(base, "/app.js"),
      request(base, "/styles.css"),
    ]);

  for (const token of [
    "upsell-mobile-progress",
    "upsell-step-track",
    "upsell-card-details",
    "upsell-card-actions",
    'aria-current="step"',
    'modal.classList.add("upsell-wizard-dialog")',
  ])
    assert.ok(script.body.includes(token), `Missing responsive Upsell UI token: ${token}`);

  assert.match(
    styles.body,
    /dialog\.upsell-wizard-dialog,\s*dialog\.upsell-analytics-dialog\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100dvh;[^}]*max-width:\s*100vw;[^}]*max-height:\s*100dvh;/s,
  );
  assert.match(
    styles.body,
    /\.upsell-wizard\s*>\s*footer\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    styles.body,
    /\.upsell-wizard-body\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    styles.body,
    /\.upsell-wizard-body \.form-columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    styles.body,
    /@media \(min-width:\s*768px\) and \(max-width:\s*1199px\)/,
  );
  assert.match(styles.body, /\.upsell-card-actions[^}]*grid-template-columns/);
});
