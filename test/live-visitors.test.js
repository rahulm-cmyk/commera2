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

async function setup(base) {
  let result = await call(base, "/api/stores", "POST", {
    name: "Live Store",
    slug: "live-store",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 20,
  });
  const product = result.body;
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Hair Oil Page",
    slug: "hair-oil-page",
    body: "Product page",
  });
  const page = result.body;
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  const published = await call(base, "/s/live-store/hair-oil-page"),
    visitorToken = published.body.match(/VISITOR_TOKEN="([^"]+)"/)?.[1];
  assert.ok(visitorToken);
  return { store, product, page, visitorToken };
}

test("one live visitor session moves through product view, add to cart, and checkout", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, visitorToken } = await setup(base),
    sessionId = "visitor-session-a102";
  for (const event of [
    { eventName: "product_page_view" },
    { eventName: "add_to_cart", quantity: 2 },
    {
      eventName: "checkout_started",
      quantity: 2,
      checkoutProgress: "phone_entered",
    },
  ]) {
    const result = await call(
      base,
      `/api/public/stores/${store.id}/visitor-events`,
      "POST",
      { ...event, sessionId, pageSlug: "hair-oil-page", visitorToken },
    );
    assert.equal(result.response.status, 201);
  }
  let result = await call(base, `/api/stores/${store.id}/live-visitors`);
  assert.equal(result.body.count, 1);
  assert.deepEqual(result.body.counts, {
    all: 1,
    viewingProduct: 0,
    addToCart: 0,
    checkout: 1,
  });
  assert.equal(result.body.visitors[0].status, "checkout");
  assert.equal(result.body.visitors[0].quantity, 2);
  assert.equal(result.body.visitors[0].cartValuePaise, 159800);
  result = await call(
    base,
    `/api/stores/${store.id}/live-visitors/${sessionId}`,
  );
  assert.equal(result.body.deviceType, "Desktop");
  assert.deepEqual(
    result.body.events.map((event) => event.eventName),
    ["product_page_view", "add_to_cart", "checkout_started"],
  );
  result = await call(base, "/live-visitors");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /data-view="visitors"><img[^>]*>Live visitors/);
});

test("visitor privacy setting prevents new live sessions", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, visitorToken } = await setup(base);
  await call(base, `/api/stores/${store.id}/settings/privacy`, "PATCH", {
    allowVisitorTracking: false,
  });
  const result = await call(
    base,
    `/api/public/stores/${store.id}/visitor-events`,
    "POST",
    {
      eventName: "product_page_view",
      sessionId: "privacy-disabled-session",
      pageSlug: "hair-oil-page",
      visitorToken,
    },
  );
  assert.equal(result.response.status, 201);
  assert.equal(result.body.recorded, false);
  assert.equal(
    (await call(base, `/api/stores/${store.id}/live-visitors`)).body.count,
    0,
  );
});

test("visitor events require the signed token issued by the published page", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store } = await setup(base),
    result = await call(
      base,
      `/api/public/stores/${store.id}/visitor-events`,
      "POST",
      {
        eventName: "product_page_view",
        sessionId: "direct-scripted-session",
        pageSlug: "hair-oil-page",
        visitorToken: "invalid",
      },
    );
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /visitor session token/i);
});

test("live journey events are idempotent and heartbeats do not add timeline steps", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, visitorToken } = await setup(base),
    sessionId = "visitor-idempotent-102",
    payload = {
      eventName: "product_page_view",
      eventId: "product-view-fixed-102",
      sessionId,
      pageSlug: "hair-oil-page",
      visitorToken,
    };
  const first = await call(
      base,
      `/api/public/stores/${store.id}/visitor-events`,
      "POST",
      payload,
    ),
    duplicate = await call(
      base,
      `/api/public/stores/${store.id}/visitor-events`,
      "POST",
      payload,
    );
  assert.equal(first.body.recorded, true);
  assert.equal(duplicate.body.duplicate, true);
  const heartbeat = await call(
    base,
    `/api/public/stores/${store.id}/live/heartbeat`,
    "POST",
    { sessionId, pageSlug: "hair-oil-page", visitorToken },
  );
  assert.equal(heartbeat.body.heartbeat, true);
  const detail = await call(
    base,
    `/api/stores/${store.id}/live-visitors/${sessionId}`,
  );
  assert.equal(detail.body.events.length, 1);
  assert.equal(detail.body.events[0].eventId, "product-view-fixed-102");
});

test("merchant live visitor stream pushes a fresh snapshot after storefront activity", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, visitorToken } = await setup(base),
    controller = new AbortController(),
    response = await fetch(
      `${base}/api/stores/${store.id}/live-visitors/stream`,
      { signal: controller.signal },
    ),
    reader = response.body.getReader(),
    decoder = new TextDecoder();
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const nextFrame = async () => {
    let text = "";
    while (!text.includes("\n\n")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
  };
  assert.match(await nextFrame(), /"count":0/);
  await call(base, `/api/public/stores/${store.id}/visitor-events`, "POST", {
    eventName: "product_page_view",
    eventId: "stream-product-view-102",
    sessionId: "visitor-stream-session-102",
    pageSlug: "hair-oil-page",
    visitorToken,
  });
  const update = await nextFrame();
  assert.match(update, /event: snapshot/);
  assert.match(update, /"count":1/);
  controller.abort();
});

test("direct Buy Now does not manufacture an add-to-cart event", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  await setup(base);
  const page = await call(base, "/s/live-store/hair-oil-page");
  assert.doesNotMatch(page.body, /trackCommerceEvent\('add_to_cart'/);
  assert.match(page.body, /sendVisitorHeartbeat/);
});
