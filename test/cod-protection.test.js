import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { createApp } from "../src/server.js";
import { SettingsService } from "../src/settings-service.js";

function setup(stock = 30) {
  const service = new CommerceService(createDatabase(":memory:"));
  const store = service.createStore({ name: "Nivkara", slug: "nivkara" });
  const product = service.createProduct(store.id, {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock,
  });
  const page = service.createProductPage(store.id, {
    productId: product.id,
    title: "Hair Ritual",
    slug: "ritual",
    body: "Daily ritual",
  });
  service.publishPage(store.id, page.id);
  return { service, store, product, page };
}

function draft(
  service,
  store,
  product,
  page,
  {
    phone = "9876543210",
    address = "12 MG Road Bengaluru",
    ipAddress = "127.0.0.1",
  } = {},
) {
  return service.saveCheckoutDraft(store.id, {
    pageId: page.id,
    productId: product.id,
    quantity: 1,
    paymentMethod: "cod",
    name: "Meera Sharma",
    phone,
    address,
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    termsAccepted: true,
    ipAddress,
  });
}

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

test("COD protection rejects a duplicate order for the same buyer, product and address", () => {
  const { service, store, product, page } = setup();
  service.placeCodOrder(store.id, {
    sessionId: draft(service, store, product, page).id,
  });
  const duplicate = draft(service, store, product, page);
  assert.throws(
    () => service.placeCodOrder(store.id, { sessionId: duplicate.id }),
    /duplicate order detected/i,
  );
  assert.equal(service.listOrders(store.id).length, 1);
  assert.equal(
    service.listCodRiskEvents(store.id)[0].eventType,
    "duplicate_order",
  );
});

test("merchant blocklist rejects blacklisted COD phone numbers and stays store-isolated", () => {
  const { service, store, product, page } = setup();
  const other = service.createStore({ name: "Other", slug: "other" });
  const blocked = service.blockCodPhone(store.id, {
    phone: "9876543210",
    reason: "Repeated RTO / black order",
  });
  assert.equal(blocked.phone, "9876543210");
  assert.equal(service.listCodBlocklist(store.id).length, 1);
  assert.equal(service.listCodBlocklist(other.id).length, 0);

  const checkout = draft(service, store, product, page);
  assert.throws(
    () => service.placeCodOrder(store.id, { sessionId: checkout.id }),
    /blocked for COD/i,
  );
  assert.equal(service.listOrders(store.id).length, 0);
  assert.equal(
    service.listCodRiskEvents(store.id)[0].eventType,
    "blacklisted_phone",
  );
});

test("COD protection rejects multiple pending fake-order patterns from one phone", () => {
  const { service, store, product, page } = setup();
  new SettingsService(service.db).update(store.id, "codForm", {
    protection: { duplicateOrders: false },
  });
  service.placeCodOrder(store.id, {
    sessionId: draft(service, store, product, page, {
      address: "Address One Bengaluru",
    }).id,
  });
  service.placeCodOrder(store.id, {
    sessionId: draft(service, store, product, page, {
      address: "Address Two Bengaluru",
    }).id,
  });
  const third = draft(service, store, product, page, {
    address: "Address Three Bengaluru",
  });
  assert.throws(
    () => service.placeCodOrder(store.id, { sessionId: third.id }),
    /multiple pending COD orders/i,
  );
  assert.equal(service.listOrders(store.id).length, 2);
  assert.equal(
    service.listCodRiskEvents(store.id)[0].eventType,
    "multiple_fake_orders",
  );
});

test("honeypot and IP velocity checks reject bot traffic before order creation", () => {
  const { service, store, product, page } = setup();
  assert.throws(
    () =>
      service.saveCheckoutDraft(store.id, {
        pageId: page.id,
        productId: product.id,
        website: "https://spam.example",
        ipAddress: "10.0.0.9",
      }),
    /bot traffic detected/i,
  );

  for (let attempt = 0; attempt < 10; attempt++)
    draft(service, store, product, page, {
      phone: `98765432${String(attempt).padStart(2, "0")}`,
      ipAddress: "10.0.0.10",
    });
  assert.throws(
    () =>
      draft(service, store, product, page, {
        phone: "9876543299",
        ipAddress: "10.0.0.10",
      }),
    /too many checkout attempts/i,
  );
  assert.equal(
    service.listCodRiskEvents(store.id)[0].eventType,
    "bot_velocity",
  );
});

test("COD Protection API remains operational and is configured inside COD Form settings", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let result = await request(base, "/api/stores", "POST", {
    name: "Nivkara",
    slug: "nivkara",
  });
  const store = result.body;
  result = await request(
    base,
    `/api/stores/${store.id}/cod-blocklist`,
    "POST",
    { phone: "9876543210", reason: "Known fake orders" },
  );
  assert.equal(result.response.status, 201);
  result = await request(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.codProtection.blocklist[0].phone, "9876543210");
  assert.ok(Array.isArray(result.body.codProtection.riskEvents));

  result = await request(base, "/app.js");
  assert.match(result.body, /COD Protection/);
  assert.match(result.body, /\["protection", "COD Protection"\]/);
  assert.doesNotMatch(result.body, /Block phone/);
  assert.doesNotMatch(result.body, /Duplicate Order Protection/);
  assert.doesNotMatch(result.body, /Bot Traffic Protection/);
  result = await request(base, "/store.css");
  assert.equal(result.response.status, 200);
});
