import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { createApp } from "../src/server.js";

function setup() {
  const service = new CommerceService(createDatabase(":memory:"));
  const store = service.createStore({ name: "Nivkara", slug: "nivkara" });
  const product = service.createProduct(store.id, {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 5,
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

function validInput(product, page, overrides = {}) {
  return {
    pageId: page.id,
    productId: product.id,
    quantity: 1,
    paymentMethod: "cod",
    name: "Meera Sharma",
    phone: "9876543210",
    alternatePhone: "8765432109",
    email: "meera@example.com",
    address: "12 MG Road, Indiranagar",
    addressLine2: "Near Metro Station",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560038",
    termsAccepted: true,
    ...overrides,
  };
}

test("Indian COD form fields persist from checkout to the customer record", () => {
  const { service, store, product, page } = setup();
  const draft = service.saveCheckoutDraft(store.id, validInput(product, page));
  const order = service.placeCodOrder(store.id, { sessionId: draft.id });
  const customer = service.listCustomers(store.id)[0];

  assert.equal(order.paymentMethod, "cod");
  assert.equal(customer.alternatePhone, "8765432109");
  assert.equal(customer.email, "meera@example.com");
  assert.equal(customer.addressLine2, "Near Metro Station");
  assert.equal(customer.city, "Bengaluru");
  assert.equal(customer.state, "Karnataka");
  assert.equal(customer.pincode, "560038");
});

test("Indian COD validation rejects invalid customer and delivery fields", () => {
  const cases = [
    ["name", "M2", /valid customer name/i],
    ["phone", "5123456789", /valid 10-digit Indian mobile/i],
    ["alternatePhone", "9876543210", /alternate mobile.*different/i],
    ["email", "not-an-email", /valid email/i],
    ["address", "Short", /complete delivery address/i],
    ["city", "City 2", /valid city/i],
    ["state", "Unknown State", /valid Indian state/i],
    ["pincode", "012345", /valid 6-digit Indian pincode/i],
    ["termsAccepted", false, /terms and conditions/i],
  ];

  for (const [field, value, expected] of cases) {
    const { service, store, product, page } = setup();
    const draft = service.saveCheckoutDraft(
      store.id,
      validInput(product, page, { [field]: value }),
    );
    assert.throws(
      () => service.placeCodOrder(store.id, { sessionId: draft.id }),
      expected,
      field,
    );
  }
});

test("Buy Now opens a dedicated checkout with the complete COD form and browser validation", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const service = app.service;
  const store = service.createStore({ name: "Nivkara", slug: "nivkara" });
  const product = service.createProduct(store.id, {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 5,
  });
  const page = service.createProductPage(store.id, {
    productId: product.id,
    title: "Hair Ritual",
    slug: "ritual",
    body: "Daily ritual",
  });
  service.publishPage(store.id, page.id);

  const response = await fetch(`http://127.0.0.1:${app.port}/s/nivkara/ritual`);
  const html = await response.text();
  assert.doesNotMatch(html, /id="cod-form"/);
  assert.match(html, /data-direct-checkout="true"/);
  const opened = await fetch(
    `http://127.0.0.1:${app.port}/api/public/nivkara/ritual/checkouts`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "open", quantity: 1 }) },
  );
  const draft = await opened.json();
  assert.equal(opened.status, 201);
  const checkoutHtml = await (
    await fetch(`http://127.0.0.1:${app.port}/s/nivkara/checkout/${draft.id}`)
  ).text();
  for (const field of [
    "alternatePhone",
    "email",
    "address",
    "addressLine2",
    "city",
    "state",
    "pincode",
    "termsAccepted",
  ])
    assert.match(checkoutHtml, new RegExp(`name="${field}"`));
  assert.match(checkoutHtml, /<input\b[^>]*name="address"[^>]*type="text"/);
  assert.match(
    checkoutHtml,
    /<input\b[^>]*name="addressLine2"[^>]*type="text"/,
  );
  assert.doesNotMatch(
    checkoutHtml,
    /<textarea\b[^>]*name="(?:address|addressLine2)"/,
  );
  assert.match(checkoutHtml, /pattern="[^"]*6-9/);
  assert.match(checkoutHtml, /Cash on Delivery \(COD\)/);
  assert.match(checkoutHtml, /Terms &amp; Conditions/);
  assert.match(
    checkoutHtml,
    /<input\b[^>]*name="termsAccepted"[^>]*checked/,
  );
  assert.match(checkoutHtml, /Hair Oil/);
  assert.match(checkoutHtml, />Contact<\/strong>/);
  assert.match(checkoutHtml, /aria-current="step">Delivery/);
  assert.match(checkoutHtml, />Confirm<\/strong>/);
  assert.match(checkoutHtml, /checkout-secondary-contact/);
  assert.match(checkoutHtml, /Add more contact information/);
  assert.match(checkoutHtml, /checkout-summary-toggle/);
  assert.match(checkoutHtml, /checkout-trust/);
  assert.match(checkoutHtml, /data-error-for="phone"/);
  assert.doesNotMatch(checkoutHtml, /<fieldset class="payment-option">/);

  const checkoutCss = await (
    await fetch(`http://127.0.0.1:${app.port}/store.css`)
  ).text();
  assert.match(checkoutCss, /Dedicated checkout: calm, high-trust commerce layout/);
  assert.match(checkoutCss, /width: min\(calc\(100% - 48px\), 1080px\)/);
  assert.match(checkoutCss, /position: sticky/);
  assert.match(checkoutCss, /\.checkout-summary\.is-collapsed \.checkout-summary-body/);

  const appScript = await (
    await fetch(`http://127.0.0.1:${app.port}/app.js`)
  ).text();
  assert.match(appScript, /Customer Fields/);
  assert.match(appScript, /fieldRows/);
  assert.match(appScript, /VISIBLE/);
  assert.match(appScript, /REQUIRED/);
});
