import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { createApp } from "../src/server.js";

function createOrder(
  service,
  store,
  product,
  page,
  name = "Meera Sharma",
  phone = "9876543210",
) {
  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id,
    productId: product.id,
    quantity: 2,
    name,
    phone,
    address: `12 ${name} Delivery Road, Bengaluru 560001`,
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    termsAccepted: true,
  });
  return service.placeCodOrder(store.id, { sessionId: draft.id });
}

function setup() {
  const service = new CommerceService(createDatabase(":memory:"));
  const store = service.createStore({ name: "Nivkara", slug: "nivkara" });
  const product = service.createProduct(store.id, {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 20,
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

test("orders expose every required column and persist custom tags", () => {
  const { service, store, product, page } = setup();
  const order = createOrder(service, store, product, page);
  const tagged = service.setOrderTags(store.id, order.id, [
    "VIP",
    "COD",
    "VIP",
  ]);

  assert.deepEqual(tagged.tags, ["VIP", "COD"]);
  const listed = service.listOrders(store.id)[0];
  assert.equal(listed.orderNumber, order.orderNumber);
  assert.ok(listed.createdAt);
  assert.equal(listed.customerName, "Meera Sharma");
  assert.equal(listed.customerPhone, "9876543210");
  assert.equal(listed.channel, "product_page");
  assert.equal(listed.totalPaise, 159800);
  assert.equal(listed.paymentStatus, "pending");
  assert.equal(listed.fulfillmentStatus, "unfulfilled");
  assert.equal(listed.itemCount, 2);
  assert.match(listed.itemSummary, /2× Hair Oil/);
  assert.equal(listed.deliveryStatus, "not_shipped");
  assert.equal(listed.deliveryMethod, "cod");
  assert.deepEqual(listed.tags, ["VIP", "COD"]);
});

test("manual draft conversion connects orders, customers, inventory, and metrics", () => {
  const { service, store, product } = setup();
  const draft = service.createDraftOrder(store.id, {
    customerName: "Kavya Iyer",
    customerPhone: "9876543299",
    customerEmail: "kavya@example.com",
    customerAddress: "18 Lake Road",
    customerCity: "Bengaluru",
    customerState: "Karnataka",
    customerPincode: "560001",
    items: [{ productId: product.id, quantity: 3 }],
    discountPaise: 10000,
    shippingPaise: 5000,
    shippingMethod: "Express Shipping",
  }, "merchant-1");
  assert.equal(service.listDraftOrders(store.id).length, 1);
  assert.equal(service.listOrders(store.id).length, 0);
  const order = service.convertDraftOrder(store.id, draft.id, "merchant-1");
  assert.match(order.orderNumber, /^#\d{6}$/);
  assert.equal(order.channel, "manual");
  assert.equal(order.totalPaise, 234700);
  assert.equal(service.listDraftOrders(store.id).length, 0);
  assert.equal(service.getProduct(store.id, product.id).stock, 17);
  assert.equal(service.listCustomers(store.id)[0].name, "Kavya Iyer");
  const metrics = service.getOrderMetrics(store.id, "today");
  assert.equal(metrics.orders, 1);
  assert.equal(metrics.itemsOrdered, 3);
});

test("order workspace persists preferences and archived query visibility", () => {
  const { service, store, product, page } = setup();
  const first = createOrder(service, store, product, page);
  service.saveOrderPreferences(store.id, "merchant-1", {
    columnOrder: ["customer", "total", "date"],
    visibleColumns: ["customer", "total"],
    sortField: "total",
    sortDirection: "asc",
    hideArchived: true,
  });
  service.archiveOrders(store.id, [first.id], true);
  assert.equal(service.listOrders(store.id).length, 0);
  assert.equal(service.listOrders(store.id, { hideArchived: false }).length, 1);
  const workspace = service.getOrdersWorkspace(store.id, "merchant-1");
  assert.equal(workspace.orderCount, 1);
  assert.deepEqual(workspace.preferences.visibleColumns, ["customer", "total"]);
  assert.equal(workspace.preferences.sortField, "total");
});

test("bulk order tagging is store-isolated and supports multiple selected orders", () => {
  const { service, store, product, page } = setup();
  const first = createOrder(
    service,
    store,
    product,
    page,
    "Meera Sharma",
    "9876543210",
  );
  const second = createOrder(
    service,
    store,
    product,
    page,
    "Anita Rao",
    "9876543211",
  );
  const other = service.createStore({ name: "Other", slug: "other" });

  const updated = service.bulkSetOrderTags(
    store.id,
    [first.id, second.id],
    ["Priority", "Hair Oil"],
  );
  assert.equal(updated.length, 2);
  assert.deepEqual(
    service.listOrders(store.id).map((order) => order.id),
    [second.id, first.id],
  );
  assert.deepEqual(
    service.listOrders(store.id).map((order) => order.tags),
    [
      ["Priority", "Hair Oil"],
      ["Priority", "Hair Oil"],
    ],
  );
  assert.throws(
    () => service.bulkSetOrderTags(other.id, [first.id], ["Leaked"]),
    /order not found/i,
  );
});

test("order detail records lifecycle changes and cancellation restores stock once", () => {
  const { service, store, product, page } = setup();
  const locationId = Number(
    service.db
      .prepare(
        "INSERT INTO locations (store_id,name,is_default) VALUES (?,?,'1')",
      )
      .run(store.id, "Primary").lastInsertRowid,
  );
  service.db
    .prepare(
      "INSERT INTO inventory_levels (store_id,product_id,location_id,quantity) VALUES (?,?,?,?)",
    )
    .run(store.id, product.id, locationId, 20);
  const order = createOrder(service, store, product, page);
  let detail = service.getOrderDetails(store.id, order.id);
  assert.equal(detail.customerName, "Meera Sharma");
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].quantity, 2);
  assert.equal(detail.events[0].eventType, "order_placed");
  assert.equal(service.getProduct(store.id, product.id).stock, 18);

  detail = service.setOrderPaymentStatus(store.id, order.id, "paid");
  assert.equal(detail.paymentStatus, "paid");
  assert.throws(
    () => service.cancelOrder(store.id, order.id),
    /refund the payment/i,
  );
  service.setOrderPaymentStatus(store.id, order.id, "pending");
  detail = service.cancelOrder(store.id, order.id, {
    reason: "Customer requested cancellation",
  });
  assert.equal(detail.paymentStatus, "cancelled");
  assert.equal(detail.fulfillmentStatus, "cancelled");
  assert.equal(detail.deliveryStatus, "cancelled");
  assert.equal(service.getProduct(store.id, product.id).stock, 20);
  assert.equal(detail.events[0].eventType, "order_cancelled");
  assert.throws(
    () => service.cancelOrder(store.id, order.id),
    /already cancelled/i,
  );
  assert.equal(service.getProduct(store.id, product.id).stock, 20);
  const restored = service.db
    .prepare(
      "SELECT delta FROM inventory_movements WHERE store_id=? AND reference_id=? AND reason='order_cancelled'",
    )
    .all(store.id, order.id);
  assert.deepEqual(restored.map((item) => item.delta), [2]);
});

test("Orders API and merchant UI expose selection, separate delivery fields and tags", async (t) => {
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
  result = await request(base, "/api/public/nivkara/ritual/checkouts", "POST", {
    quantity: 1,
    name: "Meera",
    phone: "9876543210",
    address: "12 MG Road Bengaluru",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    termsAccepted: true,
  });
  result = await request(
    base,
    `/api/public/checkouts/${result.body.id}/order`,
    "POST",
    { storeId: store.id },
  );
  const order = result.body;

  result = await request(base, `/api/stores/${store.id}/orders/tags`, "PATCH", {
    orderIds: [order.id],
    tags: ["VIP"],
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body[0].tags, ["VIP"]);

  result = await request(
    base,
    `/api/stores/${store.id}/orders/${order.id}`,
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.customerName, "Meera");
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.events[0].eventType, "order_placed");

  result = await request(
    base,
    `/api/stores/${store.id}/orders/${order.id}/payment-status`,
    "PATCH",
    { status: "paid" },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.paymentStatus, "paid");

  result = await request(base, "/app.js");
  assert.match(result.body, /select-all-orders/);
  assert.match(result.body, /order-checkbox/);
  assert.match(result.body, /Delivery: All/);
  assert.match(result.body, /Delivery method/);
  assert.match(result.body, /Add Tags/);
  assert.match(result.body, /function orderMobileCard/);
  assert.match(result.body, /class="order-mobile-list"/);
  assert.match(result.body, /orders-table-selectable/);
  assert.match(result.body, /orders-table-summary/);
  assert.match(result.body, /id="order-filter-button"/);
  assert.match(result.body, /function showOrderMobileFilters/);
  assert.match(result.body, /class="row-menu order-row-menu"/);
  assert.match(result.body, /orderStatusLabel/);
  assert.match(result.body, /!tagInput\.value\.trim\(\)/);
  assert.match(result.body, /visibleTableBoxes/);
  assert.match(result.body, /function orderDetailView/);
  assert.match(result.body, /function wireOrderDetailLinks/);
  assert.match(result.body, /function homeView[\s\S]*?wireOrderDetailLinks\(content\)/);
  assert.match(result.body, /Mark paid/);
  assert.match(result.body, /Cancel order/);
  assert.match(result.body, /\/orders\/\$\{Number\(button\.dataset\.orderId\)\}/);
});
