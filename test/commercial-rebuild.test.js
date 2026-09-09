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
  return {
    response,
    body: (response.headers.get("content-type") || "").includes("json")
      ? await response.json()
      : await response.text(),
  };
}

async function setup(base) {
  let result = await call(base, "/api/stores", "POST", {
    name: "Commercial Store",
    slug: "commercial-store",
    currency: "INR",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Universal Product",
    slug: "universal-product",
    pricePaise: 75000,
    stock: 20,
  });
  const product = result.body;
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Universal Offer",
    slug: "universal-offer",
    body: "A universal product offer.",
  });
  const page = result.body;
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  return { store, product, page };
}

test("commercial navigation keeps abandoned checkout inside Orders and groups live visitors under Analytics", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    index = await call(base, "/"),
    script = await call(base, "/app.js");
  assert.doesNotMatch(index.body, /data-view="abandoned"/);
  assert.match(index.body, /Analytics[\s\S]*data-view="visitors"/);
  assert.match(script.body, /Abandoned Checkouts/);
  assert.match(script.body, /Live visitors/);
  assert.match(script.body, /Customer funnel/);
  assert.match(script.body, /Save before leaving\?/);
  assert.match(script.body, /#back-pages"\)\.onclick = \(\) => navigateTo\("\/product-pages"\)/);
  assert.match(script.body, /status\.textContent = "Unsaved changes"/);
  assert.match(script.body, /commera2-page-templates-\$\{storeId\}/);
});

test("customer detail and inactive checkout APIs return connected commercial context", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({ db, port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store } = await setup(base),
    buyer = {
      quantity: 1,
      name: "Riya Sharma",
      phone: "9876543210",
      email: "riya@example.com",
      address: "12 Green Park Main Road",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      termsAccepted: true,
      paymentMethod: "cod",
      intent: "submit",
    };
  let result = await call(
    base,
    "/api/public/commercial-store/universal-offer/checkouts",
    "POST",
    buyer,
  );
  const completedCheckout = result.body;
  result = await call(
    base,
    `/api/public/checkouts/${completedCheckout.id}/order`,
    "POST",
    { storeId: store.id },
  );
  assert.equal(result.response.status, 201);
  let dashboard = await call(base, `/api/stores/${store.id}/dashboard`),
    customer = dashboard.body.customers[0];
  result = await call(
    base,
    `/api/stores/${store.id}/customers/${customer.id}`,
  );
  assert.equal(result.body.orders.length, 1);
  assert.equal(result.body.checkouts[0].status, "completed");
  assert.equal(result.body.codHistory.totalSpentPaise, 75000);

  result = await call(
    base,
    "/api/public/commercial-store/universal-offer/checkouts",
    "POST",
    { intent: "open", quantity: 2 },
  );
  db.prepare(
    "UPDATE checkout_sessions SET current_stage='phone_entered',updated_at=datetime('now','-31 minutes') WHERE id=?",
  ).run(result.body.id);
  dashboard = await call(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(dashboard.body.abandoned.length, 1);
  assert.equal(dashboard.body.abandoned[0].productName, "Universal Product");
  assert.equal(dashboard.body.abandoned[0].checkoutValuePaise, 150000);
  assert.equal(dashboard.body.abandoned[0].currentStage, "phone_entered");
});
