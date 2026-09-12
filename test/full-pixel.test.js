import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function call(base, path, method = "GET", data) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}

async function publishedStore(base, suffix = "") {
  let result = await call(base, "/api/stores", "POST", {
    name: `Pixel Store ${suffix}`,
    slug: `pixel-store${suffix}`,
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Tracked Product",
    slug: "tracked-product",
    pricePaise: 129900,
    stock: 20,
  });
  const product = result.body;
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Tracked Offer",
    slug: "tracked-offer",
    body: "Tracked product offer",
  });
  const page = result.body;
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  const publicPage = await call(base, `/s/${store.slug}/${page.slug}`),
    token = publicPage.body.match(/VISITOR_TOKEN=("[^"]+")/)?.[1];
  assert.ok(token, "published page should contain its signed event token");
  return { store, product, page, token: JSON.parse(token), publicPage: publicPage.body };
}

test("one internal commerce event routes to multiple providers once and never exposes server credentials", async (t) => {
  const deliveries = [];
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    pixelCredentialSecret: "test-pixel-secret",
    pixelAdapters: {
      custom: {
        async verify() {
          return { connected: true };
        },
        async send(context) {
          deliveries.push(context);
          return { accepted: true };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, product, page, token } = await publishedStore(base);

  let result = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Secure Server Feed",
    platform: "custom",
    trackingId: "https://events.example.test/collect",
    browserEnabled: true,
    serverEnabled: true,
    enabled: false,
    credentials: { authorizationHeader: "Bearer never-render-this-secret" },
  });
  const custom = result.body;
  await call(base, `/api/stores/${store.id}/pixels/${custom.id}/verify`, "POST", {});
  await call(base, `/api/stores/${store.id}/pixels/${custom.id}/enable`, "POST", {});

  result = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Meta Browser",
    platform: "meta",
    trackingId: "123456789012345",
    browserEnabled: true,
    serverEnabled: false,
    enabled: false,
  });
  const meta = result.body;
  await call(base, `/api/stores/${store.id}/pixels/${meta.id}/verify`, "POST", {});
  await call(base, `/api/stores/${store.id}/pixels/${meta.id}/enable`, "POST", {});

  const payload = {
    eventName: "product_view",
    eventId: "VIEW-ONE-123",
    source: "browser",
    sessionId: "visitor-session-123",
    pageSlug: page.slug,
    visitorToken: token,
    pageId: page.id,
    productId: product.id,
    currency: "INR",
    productPrice: 1299,
    consentGranted: true,
  };
  result = await call(
    base,
    `/api/public/stores/${store.id}/tracking-events`,
    "POST",
    payload,
  );
  assert.equal(result.response.status, 201);
  assert.equal(result.body.deduplicated, false);
  assert.equal(result.body.delivered, 3);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].event.eventId, "VIEW-ONE-123");

  result = await call(
    base,
    `/api/public/stores/${store.id}/tracking-events`,
    "POST",
    payload,
  );
  assert.equal(result.body.deduplicated, true);
  assert.equal(result.body.delivered, 0);
  assert.equal(deliveries.length, 1);

  const events = (await call(base, `/api/stores/${store.id}/tracking-events`)).body,
    activity = (await call(base, `/api/stores/${store.id}/pixel-deliveries`)).body,
    dashboard = (await call(base, `/api/stores/${store.id}/dashboard`)).body,
    livePage = (await call(base, `/s/${store.slug}/${page.slug}`)).body;
  assert.equal(events.filter((event) => event.eventId === "VIEW-ONE-123").length, 1);
  assert.equal(activity.filter((item) => item.eventId === "VIEW-ONE-123").length, 3);
  assert.ok(activity.every((item) => item.status === "success"));
  assert.deepEqual(
    dashboard.pixels.configurations.find((item) => item.id === custom.id).configuredCredentials,
    ["authorizationHeader"],
  );
  assert.doesNotMatch(JSON.stringify(dashboard), /never-render-this-secret/);
  assert.doesNotMatch(livePage, /never-render-this-secret/);
});

test("event mappings are connection-specific and invalid signed-event scope cannot cross stores", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    first = await publishedStore(base, "-a"),
    second = await publishedStore(base, "-b");
  let result = await call(base, `/api/stores/${first.store.id}/pixels`, "POST", {
    name: "Scoped Meta",
    platform: "meta",
    trackingId: "123456789012345",
    browserEnabled: true,
    serverEnabled: false,
    scopeType: "specific_product_pages",
    scopeIds: [first.page.id],
  });
  const pixel = result.body;
  await call(base, `/api/stores/${first.store.id}/pixels/${pixel.id}/verify`, "POST", {});
  await call(base, `/api/stores/${first.store.id}/pixels/${pixel.id}/enable`, "POST", {});
  const current = (
    await call(base, `/api/stores/${first.store.id}/pixels/${pixel.id}/mappings`)
  ).body;
  result = await call(
    base,
    `/api/stores/${first.store.id}/pixels/${pixel.id}/mappings`,
    "PATCH",
    {
      mappings: current.map((item) => ({
        internalEvent: item.internalEvent,
        providerEventName: item.providerEventName,
        enabled: item.internalEvent === "order_created",
      })),
    },
  );
  assert.equal(
    result.body.find((item) => item.internalEvent === "product_view").enabled,
    false,
  );

  result = await call(
    base,
    `/api/public/stores/${second.store.id}/tracking-events`,
    "POST",
    {
      eventName: "product_view",
      eventId: "CROSS-STORE-EVENT",
      source: "browser",
      sessionId: "cross-store-session",
      pageSlug: second.page.slug,
      visitorToken: first.token,
      pageId: second.page.id,
      productId: second.product.id,
      consentGranted: true,
    },
  );
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /token/i);
  assert.equal(
    (await call(base, `/api/stores/${second.store.id}/tracking-events`)).body.length,
    0,
  );
});

test("failed server deliveries are visible and a safe retry restores the connection", async (t) => {
  let attempts = 0;
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    pixelCredentialSecret: "retry-test-secret",
    pixelAdapters: {
      custom: {
        async verify() {
          return { connected: true };
        },
        async send() {
          attempts += 1;
          if (attempts === 1) throw new Error("Authentication failed");
          return { accepted: true };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, page, token } = await publishedStore(base, "-retry");
  let result = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Retry Feed",
    platform: "custom",
    trackingId: "https://events.example.test/retry",
    browserEnabled: false,
    serverEnabled: true,
    credentials: { authorizationHeader: "Bearer retry-secret" },
  });
  const pixel = result.body;
  await call(base, `/api/stores/${store.id}/pixels/${pixel.id}/verify`, "POST", {});
  await call(base, `/api/stores/${store.id}/pixels/${pixel.id}/enable`, "POST", {});

  result = await call(base, `/api/stores/${store.id}/tracking-events`, "GET");
  assert.equal(result.body.length, 0);
  // A signed browser page_view is sufficient to exercise provider delivery
  // without inventing an order or Purchase conversion.
  result = await call(base, `/api/public/stores/${store.id}/pixel-events`, "POST", {
    eventName: "page_view",
    eventId: "SERVER-FAIL-1",
    pageSlug: page.slug,
    visitorToken: token,
    consentGranted: true,
  });
  assert.equal(result.response.status, 201);
  let activity = (await call(base, `/api/stores/${store.id}/pixel-deliveries`)).body;
  assert.equal(activity[0].status, "failed");
  assert.match(activity[0].error, /Authentication failed/);

  result = await call(
    base,
    `/api/stores/${store.id}/pixel-deliveries/${activity[0].id}/retry`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 200);
  activity = (await call(base, `/api/stores/${store.id}/pixel-deliveries`)).body;
  assert.equal(activity[0].status, "success");
  const refreshed = (await call(base, `/api/stores/${store.id}/pixels`)).body[0];
  assert.equal(refreshed.status, "active");
  assert.equal(refreshed.lastError, "");
});

test("custom pixel verification rejects endpoints that resolve to private networks", async (t) => {
  let fetchCalls = 0;
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    pixelCredentialSecret: "ssrf-test-secret",
    pixelDnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
    pixelFetch: async () => {
      fetchCalls += 1;
      throw new Error("The protected endpoint must not be called");
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await publishedStore(base, "-ssrf");
  let result = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Private DNS Target",
    platform: "custom",
    trackingId: "https://events.example.test/private",
    browserEnabled: false,
    serverEnabled: true,
    credentials: { authorizationHeader: "Bearer secret" },
  });
  assert.equal(result.response.status, 201);

  result = await call(
    base,
    `/api/stores/${store.id}/pixels/${result.body.id}/verify`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /public network address/i);
  assert.equal(fetchCalls, 0);
});

test("order_created is emitted by the backend only after one valid COD order exists", async (t) => {
  const sent = [];
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    pixelCredentialSecret: "order-event-secret",
    pixelAdapters: {
      custom: {
        async verify() {
          return { connected: true };
        },
        async send({ event }) {
          sent.push(event);
          return { accepted: true };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, page, token } = await publishedStore(base, "-order");
  let result = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Order Feed",
    platform: "custom",
    trackingId: "https://events.example.test/orders",
    browserEnabled: false,
    serverEnabled: true,
    credentials: { authorizationHeader: "Bearer order-secret" },
  });
  const pixel = result.body;
  await call(base, `/api/stores/${store.id}/pixels/${pixel.id}/verify`, "POST", {});
  await call(base, `/api/stores/${store.id}/pixels/${pixel.id}/enable`, "POST", {});
  result = await call(base, `/api/public/${store.slug}/${page.slug}/checkouts`, "POST", {
    intent: "open",
    quantity: 1,
    visitorSessionId: "order-visitor-session",
    checkoutToken: token,
    deviceId: "order-device-123",
    consentGranted: true,
    behavior: { timeOnPageMs: 3000, pointerEvents: 2 },
  });
  assert.equal(result.response.status, 201);
  const checkout = result.body;
  assert.equal(sent.some((event) => event.eventName === "order_created"), false);
  result = await call(base, `/api/public/checkouts/${checkout.id}`, "PATCH", {
    storeId: store.id,
    intent: "submit",
    visitorSessionId: "order-visitor-session",
    quantity: 1,
    name: "Riya Sharma",
    phone: "9876543210",
    address: "12 Green Park Main Road",
    city: "Delhi",
    state: "Delhi",
    country: "India",
    pincode: "110001",
    termsAccepted: true,
    paymentMethod: "cod",
    consentGranted: true,
  });
  assert.equal(result.response.status, 200);
  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: "order-visitor-session",
    consentGranted: true,
  });
  assert.equal(result.response.status, 201);
  const orderId = result.body.id,
    orderEvents = (
      await call(base, `/api/stores/${store.id}/tracking-events?event=order_created`)
    ).body;
  assert.equal(orderEvents.length, 1);
  assert.equal(orderEvents[0].eventId, `ORDER-${orderId}`);
  assert.equal(orderEvents[0].source, "server");
  assert.equal(sent.filter((event) => event.eventName === "order_created").length, 1);
  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: "order-visitor-session",
    consentGranted: true,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.completed, true);
  assert.match(result.body.thankYouUrl, /\/thank-you\//);
  assert.equal(
    (await call(base, `/api/stores/${store.id}/tracking-events?event=order_created`)).body.length,
    1,
  );
});
