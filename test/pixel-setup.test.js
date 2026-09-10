import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function request(base, path, method = "GET", data) {
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
async function storefront(base) {
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
  return { store, product, page };
}

test("merchant adds, saves, verifies, enables, disables, and deletes supported pixels", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await storefront(base);
  const inputs = [
    ["meta", "123456789012345"],
    ["google", "G-AB12CD34EF"],
    ["tiktok", "C1234567890ABCDE"],
  ];
  for (const [platform, trackingId] of inputs) {
    let result = await request(base, `/api/stores/${store.id}/pixels`, "POST", {
      platform,
      trackingId,
      enabled: false,
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.status, "configured");
    const pixel = result.body;
    result = await request(
      base,
      `/api/stores/${store.id}/pixels/${pixel.id}/verify`,
      "POST",
      {},
    );
    assert.equal(result.body.verified, true);
    result = await request(
      base,
      `/api/stores/${store.id}/pixels/${pixel.id}`,
      "PATCH",
      { trackingId, enabled: true },
    );
    assert.equal(result.body.status, "active");
    result = await request(
      base,
      `/api/stores/${store.id}/pixels/${pixel.id}/disable`,
      "POST",
      {},
    );
    assert.equal(result.body.status, "disabled");
    result = await request(
      base,
      `/api/stores/${store.id}/pixels/${pixel.id}/enable`,
      "POST",
      {},
    );
    assert.equal(result.body.status, "active");
  }
  let result = await request(base, `/api/stores/${store.id}/pixels`);
  assert.equal(result.body.length, 3);
  result = await request(
    base,
    `/api/stores/${store.id}/pixels/${result.body[0].id}`,
    "DELETE",
  );
  assert.equal(result.response.status, 200);
  assert.equal(
    (await request(base, `/api/stores/${store.id}/pixels`)).body.length,
    2,
  );
});

test("active pixels affect published pages and event records while disabled and cross-store pixels do not", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product, page } = await storefront(base);
  const other = (
    await request(base, "/api/stores", "POST", { name: "Other", slug: "other" })
  ).body;
  let meta = (
    await request(base, `/api/stores/${store.id}/pixels`, "POST", {
      platform: "meta",
      trackingId: "123456789012345",
      enabled: true,
    })
  ).body;
  let google = (
    await request(base, `/api/stores/${store.id}/pixels`, "POST", {
      platform: "google",
      trackingId: "G-AB12CD34EF",
      enabled: false,
    })
  ).body;
  let result = await request(base, "/s/nivkara/ritual");
  const visitorToken = JSON.parse(
    result.body.match(/VISITOR_TOKEN=("[^"]+")/)?.[1] || '""',
  );
  assert.ok(visitorToken);
  assert.match(result.body, /connect\.facebook\.net/);
  assert.match(result.body, /123456789012345/);
  assert.doesNotMatch(result.body, /G-AB12CD34EF/);
  for (const eventName of [
    "page_view",
    "product_page_view",
    "add_to_cart",
    "checkout_start",
    "purchase",
  ])
    assert.match(result.body, new RegExp(eventName));
  result = await request(
    base,
    `/api/public/stores/${store.id}/pixel-events`,
    "POST",
    {
      eventName: "checkout_start",
      pageSlug: "ritual",
      visitorToken,
      eventId: "evt-1",
      productId: product.id,
      pageId: page.id,
      checkoutSessionId: "checkout-compatibility-test",
    },
  );
  assert.equal(result.response.status, 201);
  result = await request(base, `/api/stores/${store.id}/pixel-events`);
  assert.equal(result.body[0].eventName, "checkout_start");
  assert.equal(result.body[0].platform, "meta");
  result = await request(
    base,
    `/api/stores/${other.id}/pixels/${meta.id}/disable`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 404);
  assert.ok(google.id);
});

test("pixel IDs are platform-validated and merchant UI exposes fields, statuses, events, and actions", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await storefront(base);
  let result = await request(base, `/api/stores/${store.id}/pixels`, "POST", {
    platform: "meta",
    trackingId: "<script>alert(1)</script>",
    enabled: true,
  });
  assert.equal(result.response.status, 400);
  result = await request(base, `/api/stores/${store.id}/pixels`, "POST", {
    platform: "custom",
    trackingId: "https://127.0.0.1/internal-events",
    enabled: true,
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /public HTTPS host|valid Custom/i);
  result = await request(base, "/");
  assert.match(result.body, /data-view="settings"><img[^>]*>Settings/);
  assert.doesNotMatch(result.body, /data-view="pixels">Pixel Setup/);
  result = await request(base, "/app.js");
  assert.match(result.body, /\[\s*["']pixel["']\s*,\s*["']Pixel["']\s*\]/);
  for (const text of [
    "Platform",
    "Pixel / Tracking ID",
    "Enable Tracking",
    "Meta",
    "Google",
    "TikTok",
    "Not Configured",
    "Configured",
    "Active",
    "Error",
    "No Events Yet",
    "Page View",
    "Product Page View",
    "Add To Cart",
    "Checkout Start",
    "Order / Purchase",
    "Add",
    "Save",
    "Test / Verify",
    "Enable",
    "Disable",
    "Delete",
  ])
    assert.match(
      result.body,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
});
