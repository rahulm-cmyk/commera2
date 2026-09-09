import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

const db = createDatabase(":memory:"),
  app = createApp({ db, port: 4188, merchantAuth: false, domainOptions: { cnameTarget: 'edge.example.com' } }),
  store = app.service.createStore({
    name: "Responsive Test Store",
    slug: "responsive-test-store",
  }),
  product = app.service.createProduct(store.id, {
    name: "Universal Test Product",
    slug: "universal-test-product",
    description: "Fixture data used only for browser regression testing.",
    pricePaise: 79900,
    stock: 20,
  }),
  addOn = app.service.createProduct(store.id, {
    name: "Neem Wooden Comb",
    slug: "neem-wooden-comb",
    description: "A browser-only fixture for the post-purchase offer.",
    pricePaise: 39900,
    stock: 12,
  }),
  page = app.service.createProductPage(store.id, {
    productId: product.id,
    title: "Universal Product Page",
    slug: "universal-product-page",
    body: "Browser regression fixture",
  });

app.service.publishPage(store.id, page.id);
const upsell = app.service.createUpsell(store.id, {
  productId: product.id,
  upsellProductId: addOn.id,
  name: "Browser Test Comb Offer",
  headline: "Add a Neem Wooden Comb",
  subheadline: "Complete your daily hair ritual",
  description: "Add it to the same confirmed COD order with one click.",
  quantity: 1,
  pricePaise: 29900,
  status: "active",
});
db.prepare(
  `INSERT INTO reviews
    (store_id, product_id, customer_name, rating, title, review_text, source, status)
   VALUES (?, ?, ?, ?, ?, ?, 'consumer', 'approved')`,
).run(
  store.id,
  product.id,
  "Asha Patel",
  5,
  "Visible improvement",
  "The product page was clear and the checkout experience was easy to use.",
);
db.prepare(
  `INSERT INTO reviews
    (store_id, product_id, customer_name, rating, title, review_text, source, status, review_date)
   VALUES (?, ?, ?, ?, ?, ?, 'manual', 'approved', ?)`,
).run(store.id, product.id, "iou", 5, ";l", ";;;;;/", "8999-09-08");
const checkout = app.service.saveCheckoutDraft(store.id, {
  pageId: page.id,
  productId: product.id,
  quantity: 2,
  name: "Browser Test Customer",
  phone: "9876543210",
  address: "12 Browser Test Road, Bengaluru",
  city: "Bengaluru",
  state: "Karnataka",
  country: "India",
  pincode: "560001",
  termsAccepted: true,
});
const order = app.service.placeCodOrder(store.id, { sessionId: checkout.id });

await app.start();
const base = `http://127.0.0.1:${app.port}`,
  pixel = await fetch(`${base}/api/stores/${store.id}/pixels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Browser Test Meta",
      platform: "meta",
      trackingId: "123456789012345",
      browserEnabled: true,
      serverEnabled: false,
      enabled: false,
    }),
  }).then((response) => response.json());
await fetch(`${base}/api/stores/${store.id}/pixels/${pixel.id}/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
await fetch(`${base}/api/stores/${store.id}/pixels/${pixel.id}/enable`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
await fetch(`${base}/api/public/stores/${store.id}/pixel-events`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    eventName: "product_page_view",
    eventId: "BROWSER-SMOKE-VIEW",
    pageSlug: page.slug,
    consentGranted: true,
  }),
});
console.log(
  JSON.stringify({
    ready: true,
    port: app.port,
    storeId: store.id,
    orderId: order.id,
    checkoutSessionId: checkout.id,
    upsellEventId: order.postPurchaseUpsell?.id,
    upsellToken: order.postPurchaseUpsell?.token,
    upsellId: upsell.id,
  }),
);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
