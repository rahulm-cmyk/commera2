import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:4190";

async function request(path, {
  method = "GET",
  body,
  cookie = "",
  csrfToken = "",
} = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  return {
    response,
    body: contentType.includes("json")
      ? await response.json()
      : await response.text(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

const checks = [];
async function check(name, run) {
  await run();
  checks.push({ name, status: "PASS" });
}

let ownerCookie = "";
let ownerCsrf = "";
let storeA;
let storeB;
let product;
let addOn;
let page;
let checkout;
let order;

await check("health and security headers", async () => {
  const result = await request("/healthz");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { status: "ok" });
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  assert.match(result.response.headers.get("x-frame-options") || "", /^(DENY|SAMEORIGIN)$/);
});

await check("logged-out merchant APIs are rejected", async () => {
  const result = await request("/api/stores");
  assert.equal(result.response.status, 401);
});

await check("fresh merchant registration creates a protected session", async () => {
  const result = await request("/api/auth/register", {
    method: "POST",
    body: {
      displayName: "Commercial QA Owner",
      email: "qa-owner@local.test",
      password: "CommercialQA2026",
    },
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.cookie.startsWith("commera2_session="));
  assert.ok(result.body.csrfToken);
  ownerCookie = result.cookie;
  ownerCsrf = result.body.csrfToken;
});

await check("merchant writes require CSRF", async () => {
  const result = await request("/api/stores", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Missing CSRF", slug: "missing-csrf" },
  });
  assert.equal(result.response.status, 403);
});

await check("fresh Store A and Store B are created and persisted", async () => {
  let result = await request("/api/stores", {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: { name: "Commercial QA Store A", slug: "commercial-qa-a", currency: "INR" },
  });
  assert.equal(result.response.status, 201);
  storeA = result.body;
  result = await request("/api/stores", {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: { name: "Commercial QA Store B", slug: "commercial-qa-b", currency: "INR" },
  });
  assert.equal(result.response.status, 201);
  storeB = result.body;
  result = await request("/api/stores", { cookie: ownerCookie });
  assert.deepEqual(result.body.map((item) => item.id), [storeA.id, storeB.id]);
});

await check("fresh catalog, page, and post-purchase upsell are created", async () => {
  let result = await request(`/api/stores/${storeA.id}/products`, {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {
      name: "Commercial QA Product",
      slug: "qa-product",
      description: "Generic isolated product used for the commercial audit.",
      pricePaise: 79900,
      comparePricePaise: 99900,
      stock: 10,
    },
  });
  assert.equal(result.response.status, 201);
  product = result.body;
  result = await request(`/api/stores/${storeA.id}/products`, {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {
      name: "Commercial QA Add-on",
      slug: "qa-addon",
      description: "Generic add-on for the same-order upsell test.",
      pricePaise: 39900,
      stock: 8,
    },
  });
  assert.equal(result.response.status, 201);
  addOn = result.body;
  result = await request(`/api/stores/${storeA.id}/pages`, {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {
      productId: product.id,
      title: "Commercial QA Offer",
      slug: "qa-offer",
      body: "A generic commercial audit storefront.",
    },
  });
  assert.equal(result.response.status, 201);
  page = result.body;
  result = await request(`/api/stores/${storeA.id}/upsells`, {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {
      productId: product.id,
      upsellProductId: addOn.id,
      name: "Commercial QA same-order offer",
      headline: "Add the QA add-on",
      pricePaise: 29900,
      quantity: 1,
      status: "active",
    },
  });
  assert.equal(result.response.status, 201);
  result = await request(`/api/stores/${storeA.id}/pages/${page.id}/publish`, {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {},
  });
  assert.equal(result.response.status, 200);
});

await check("OTP master switch accepts string false and does not gate checkout", async () => {
  const result = await request(`/api/stores/${storeA.id}/settings/cod-form`, {
    method: "PATCH",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: { otp: { enabled: "false", requiredForCod: "false" } },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.otp.enabled, false);
  assert.equal(result.body.otp.requiredForCod, false);
});

await check("store data remains isolated by resource scope", async () => {
  let result = await request(`/api/stores/${storeB.id}/products/${product.id}`, {
    cookie: ownerCookie,
  });
  assert.equal(result.response.status, 404);
  result = await request(`/api/stores/${storeB.id}/pages/${page.id}`, {
    cookie: ownerCookie,
  });
  assert.equal(result.response.status, 404);
});

await check("a second merchant cannot read Store A", async () => {
  let result = await request("/api/auth/register", {
    method: "POST",
    body: {
      displayName: "Commercial QA Intruder",
      email: "qa-intruder@local.test",
      password: "CommercialQA2026",
    },
  });
  assert.equal(result.response.status, 201);
  const intruderCookie = result.cookie;
  result = await request(`/api/stores/${storeA.id}/dashboard`, {
    cookie: intruderCookie,
  });
  assert.equal(result.response.status, 403);
  assert.doesNotMatch(JSON.stringify(result.body), /Commercial QA Product/);
});

await check("published storefront and dedicated checkout render", async () => {
  let result = await request("/s/commercial-qa-a/qa-offer");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Commercial QA Offer/);
  assert.match(result.body, /₹799/);
  result = await request("/api/public/commercial-qa-a/qa-offer/checkouts", {
    method: "POST",
    body: {
      intent: "submit",
      quantity: 1,
      name: "Riya Sharma",
      phone: "9876543210",
      email: "qa-buyer@local.test",
      address: "12 Green Park Main Road",
      addressLine2: "Floor 2",
      city: "Delhi",
      state: "Delhi",
      country: "India",
      pincode: "110001",
      termsAccepted: true,
      paymentMethod: "cod",
      pricePaise: 1,
      discountPaise: 999999,
      totalPaise: 1,
    },
  });
  assert.equal(result.response.status, 201);
  checkout = result.body;
  assert.equal(checkout.subtotalPaise, 79900);
  assert.equal(checkout.totalPaise, 79900);
  result = await request(`/s/commercial-qa-a/checkout/${checkout.id}`);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Delivery Details/);
  assert.doesNotMatch(result.body, /requires OTP, but OTP is not configured/i);
});

await check("server ignores order price tampering and creates exactly one order", async () => {
  let result = await request(`/api/public/checkouts/${checkout.id}/order`, {
    method: "POST",
    body: {
      storeId: storeA.id,
      pricePaise: 1,
      discountPaise: 999999,
      shippingPaise: 1,
      totalPaise: 1,
    },
  });
  assert.equal(result.response.status, 201);
  order = result.body;
  assert.equal(order.totalPaise, 79900);
  assert.match(order.nextUrl, /^\/s\/commercial-qa-a\/upsell\//);
  result = await request(`/api/stores/${storeA.id}/dashboard`, {
    cookie: ownerCookie,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.orders.length, 1);
});

await check("post-purchase upsell updates the same order once and ignores tampering", async () => {
  const offerUrl = new URL(base + order.nextUrl);
  const offerId = offerUrl.searchParams.get("offer");
  const token = offerUrl.searchParams.get("token");
  let result = await request(order.nextUrl);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Add the QA add-on/);
  result = await request(`/api/public/upsells/${offerId}/accept`, {
    method: "POST",
    body: {
      storeSlug: storeA.slug,
      checkoutSessionId: checkout.id,
      token,
      pricePaise: 1,
      quantity: 99,
      upsellProductId: product.id,
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.interaction.orderTotalPaise, 109800);
  result = await request(`/api/public/upsells/${offerId}/accept`, {
    method: "POST",
    body: {
      storeSlug: storeA.slug,
      checkoutSessionId: checkout.id,
      token,
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.interaction.orderTotalPaise, 109800);
  result = await request(`/api/stores/${storeA.id}/dashboard`, {
    cookie: ownerCookie,
  });
  assert.equal(result.body.orders.length, 1);
  assert.equal(result.body.orders[0].totalPaise, 109800);
  assert.equal(result.body.metrics.orders, 1);
  assert.equal(result.body.products.find((item) => item.id === product.id).stock, 9);
  assert.equal(result.body.products.find((item) => item.id === addOn.id).stock, 7);
});

await check("junk checkout is rejected without creating another order", async () => {
  let result = await request("/api/public/commercial-qa-a/qa-offer/checkouts", {
    method: "POST",
    body: {
      intent: "submit",
      quantity: 1,
      name: "1",
      phone: "123",
      address: "abc",
      city: "x",
      state: "y",
      pincode: "1",
      termsAccepted: true,
      paymentMethod: "cod",
    },
  });
  assert.equal(result.response.status, 201);
  const invalidCheckout = result.body;
  result = await request(`/api/public/checkouts/${invalidCheckout.id}/order`, {
    method: "POST",
    body: { storeId: storeA.id },
  });
  assert.equal(result.response.status, 400);
  result = await request(`/api/stores/${storeA.id}/dashboard`, {
    cookie: ownerCookie,
  });
  assert.equal(result.body.orders.length, 1);
});

console.log(JSON.stringify({
  status: "PASS",
  base,
  account: { email: "qa-owner@local.test", password: "CommercialQA2026" },
  storeA: { id: storeA.id, slug: storeA.slug },
  storeB: { id: storeB.id, slug: storeB.slug },
  productId: product.id,
  pageId: page.id,
  checkoutId: checkout.id,
  orderId: order.id,
  checks,
}, null, 2));
