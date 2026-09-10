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

async function createOrder(base, storeSlug = "nivkara") {
  let result = await request(base, "/api/stores", "POST", {
    name: storeSlug === "nivkara" ? "Nivkara" : "Other",
    slug: storeSlug,
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
  result = await request(
    base,
    `/api/public/${storeSlug}/ritual/checkouts`,
    "POST",
    {
      quantity: 1,
      name: "Meera Sharma",
      phone: "9876543210",
      address: "12 MG Road Bengaluru",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      termsAccepted: true,
    },
  );
  result = await request(
    base,
    `/api/public/checkouts/${result.body.id}/order`,
    "POST",
    { storeId: store.id },
  );
  return { store, order: result.body };
}

test("merchant configures a delivery partner, dispatches an order, and tracks status", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, order } = await createOrder(base);
  let result = await request(
    base,
    `/api/stores/${store.id}/delivery-partners`,
    "POST",
    {
      name: "Local Express",
      code: "local-express",
      trackingUrlTemplate: "https://track.example/{trackingNumber}",
    },
  );
  assert.equal(result.response.status, 201);
  const partner = result.body;

  result = await request(
    base,
    `/api/stores/${store.id}/orders/${order.id}/shipments`,
    "POST",
    {
      partnerId: partner.id,
      trackingNumber: "BAD",
      trackingUrl: "javascript:alert(1)",
    },
  );
  assert.equal(result.response.status, 400);

  result = await request(
    base,
    `/api/stores/${store.id}/orders/${order.id}/shipments`,
    "POST",
    { partnerId: partner.id, trackingNumber: "AWB123" },
  );
  assert.equal(result.response.status, 201);
  const shipment = result.body;
  assert.equal(shipment.trackingNumber, "AWB123");
  assert.equal(shipment.trackingUrl, "https://track.example/AWB123");
  assert.equal(shipment.status, "shipped");

  result = await request(
    base,
    `/api/stores/${store.id}/shipments/${shipment.id}/status`,
    "PATCH",
    { status: "in_transit" },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "in_transit");
  result = await request(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.orders[0].deliveryStatus, "in_transit");
  assert.equal(result.body.orders[0].deliveryMethod, "Local Express");
  assert.equal(result.body.delivery.shipments[0].trackingNumber, "AWB123");

  const other = await request(base, "/api/stores", "POST", {
    name: "Other",
    slug: "other",
  });
  result = await request(
    base,
    `/api/stores/${other.body.id}/orders/${order.id}/shipments`,
    "POST",
    { partnerId: partner.id, trackingNumber: "LEAK" },
  );
  assert.equal(result.response.status, 404);

  const index = await request(base, "/");
  assert.match(index.body, /data-view="settings"><img[^>]*>Settings/);
  assert.doesNotMatch(index.body, /data-view="delivery">Delivery/);
  const script = await request(base, "/app.js");
  assert.match(
    script.body,
    /\[\s*["']shipping["']\s*,\s*["']Shipping and Delivery["']\s*\]/,
  );
  assert.match(script.body, /Delivery Partner List/);
  assert.match(script.body, /Add delivery partner/);
  assert.match(script.body, /Dispatch order/);
});

test("configured adapter creates the carrier shipment and returns authoritative tracking", async (t) => {
  const calls = [];
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    deliveryAdapters: {
      shiprocket: {
        async createShipment(payload) {
          calls.push(payload);
          return {
            trackingNumber: "SR-9001",
            trackingUrl: "https://shiprocket.example/SR-9001",
            status: "ready_to_ship",
            externalId: "shipment-9001",
          };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, order } = await createOrder(base, "nivkara");
  let result = await request(
    base,
    `/api/stores/${store.id}/delivery-partners`,
    "POST",
    {
      name: "Shiprocket",
      code: "shiprocket",
      trackingUrlTemplate: "https://shiprocket.example/{trackingNumber}",
    },
  );
  const partner = result.body;
  result = await request(
    base,
    `/api/stores/${store.id}/orders/${order.id}/shipments`,
    "POST",
    { partnerId: partner.id },
  );
  assert.equal(result.response.status, 201);
  assert.equal(result.body.trackingNumber, "SR-9001");
  assert.equal(result.body.externalId, "shipment-9001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].order.orderNumber, order.orderNumber);
  assert.equal(calls[0].customer.phone, "9876543210");
  assert.equal(calls[0].items[0].name, "Hair Oil");
});
