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
    name: "Secure Store",
    slug: "secure-store",
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
    title: "Hair Oil Offer",
    slug: "offer",
    body: "Daily care",
  });
  const page = result.body;
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  const html = (await call(base, "/s/secure-store/offer")).body;
  const token = html.match(/VISITOR_TOKEN="([^"]+)"/)?.[1];
  assert.ok(token, "published page must issue a signed checkout token");
  return { store, token };
}

const buyer = {
  quantity: 1,
  name: "Riya Sharma",
  phone: "9876543210",
  alternatePhone: "",
  email: "riya@example.com",
  address: "12 Green Park Main Road",
  addressLine2: "Floor 2",
  landmark: "Near Temple",
  city: "Delhi",
  state: "Delhi",
  country: "India",
  pincode: "110001",
  termsAccepted: true,
  paymentMethod: "cod",
  intent: "submit",
  deviceId: "browser-device-1",
  visitorSessionId: "visitor-session-1",
  behavior: {
    timeOnPageMs: 8000,
    pointerEvents: 3,
    scrollEvents: 2,
    focusEvents: 6,
  },
};

test("OTP gates COD order creation, stores only a hash, and persists verification", async (t) => {
  const db = createDatabase(":memory:");
  let deliveredOtp = "";
  const app = createApp({
    db,
    port: 0,
    otpSecret: "integration-test-secret",
    otpProviders: {
      test: {
        async send({ otp }) {
          deliveredOtp = otp;
          return { delivered: true };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, token } = await setup(base);

  let result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: {
      enabled: true,
      requiredForCod: true,
      provider: "test",
      length: 6,
      expiryMinutes: 5,
      resendDelaySeconds: 30,
      maxAttempts: 5,
      maxResends: 3,
      allowPhoneChange: true,
      verificationPosition: "before_order",
    },
    protection: { botProtection: { checkoutToken: true } },
  });
  assert.equal(result.response.status, 200);

  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    ...buyer,
    checkoutToken: token,
  });
  assert.equal(result.response.status, 201);
  const checkout = result.body;
  assert.equal(checkout.phoneVerificationStatus, "UNVERIFIED");

  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: buyer.visitorSessionId,
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.otpRequired, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM orders").get().count, 0);

  result = await call(base, "/api/public/otp/send", "POST", {
    storeId: store.id,
    checkoutSessionId: checkout.id,
    phone: buyer.phone,
  });
  assert.equal(result.response.status, 201);
  assert.equal("testOtp" in result.body, false);
  assert.match(deliveredOtp, /^\d{6}$/);
  const otp = deliveredOtp;
  const stored = db.prepare("SELECT otp_hash FROM otp_verifications").get();
  assert.ok(stored.otp_hash.includes(":"));
  assert.equal(stored.otp_hash.includes(otp), false);

  result = await call(base, "/api/public/otp/verify", "POST", {
    storeId: store.id,
    checkoutSessionId: checkout.id,
    phone: buyer.phone,
    otp: "000000",
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /Incorrect OTP/);

  result = await call(base, "/api/public/otp/verify", "POST", {
    storeId: store.id,
    checkoutSessionId: checkout.id,
    phone: buyer.phone,
    otp,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "VERIFIED");

  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: buyer.visitorSessionId,
  });
  assert.equal(result.response.status, 201);
  const order = result.body;
  assert.equal(order.phoneVerificationStatus, "VERIFIED");
  assert.ok(order.phoneVerifiedAt);

  result = await call(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.orders[0].phoneVerificationStatus, "VERIFIED");
  assert.equal(result.body.orders[0].botRiskLevel, "low");

  const changedBuyer = {
    ...buyer,
    phone: "9123456789",
    deviceId: "browser-device-2",
    visitorSessionId: "visitor-session-2",
    checkoutToken: token,
  };
  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", changedBuyer);
  assert.equal(result.response.status, 201);
  const changedCheckout = result.body;
  result = await call(base, "/api/public/otp/send", "POST", {
    storeId: store.id,
    checkoutSessionId: changedCheckout.id,
    phone: changedBuyer.phone,
  });
  assert.equal("testOtp" in result.body, false);
  const changedOtp = deliveredOtp;
  result = await call(base, "/api/public/otp/verify", "POST", {
    storeId: store.id,
    checkoutSessionId: changedCheckout.id,
    phone: changedBuyer.phone,
    otp: changedOtp,
  });
  assert.equal(result.body.status, "VERIFIED");
  result = await call(base, `/api/public/checkouts/${changedCheckout.id}`, "PATCH", {
    storeId: store.id,
    phone: "9234567890",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.phoneVerificationStatus, "UNVERIFIED");
  assert.equal(result.body.phoneVerifiedAt, null);

  await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { verificationPosition: "before_checkout" },
  });
  result = await call(base, `/api/public/stores/${store.id}/otp-config`);
  assert.deepEqual(
    {
      enabled: result.body.enabled,
      position: result.body.verificationPosition,
      length: result.body.length,
    },
    { enabled: true, position: "before_checkout", length: 6 },
  );
});

test("turning OTP off overrides stale checkout and adaptive OTP requirements", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({
      db,
      port: 0,
      otpProviders: {
        test: {
          async send() {
            return { delivered: true };
          },
        },
      },
    });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, token } = await setup(base);

  let result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { enabled: true, requiredForCod: true, provider: "test" },
  });
  assert.equal(result.response.status, 200);
  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    ...buyer,
    checkoutToken: token,
  });
  assert.equal(result.response.status, 201);
  const checkout = result.body;
  assert.equal(Boolean(checkout.otpRequired), true);

  result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { enabled: false },
  });
  assert.equal(result.body.otp.enabled, false);
  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: buyer.visitorSessionId,
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.phoneVerificationStatus, "NOT_REQUIRED");
  const storedCheckout = db
    .prepare(
      "SELECT otp_required,phone_verification_status FROM checkout_sessions WHERE id=?",
    )
    .get(checkout.id);
  assert.equal(storedCheckout.otp_required, 0);
  assert.equal(storedCheckout.phone_verification_status, "NOT_REQUIRED");
});

test("adaptive protection skips require_otp when the OTP master switch is off", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({ db, port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store } = await setup(base);
  let result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { enabled: false },
    protection: {
      botTraffic: true,
      botProtection: {
        enabled: true,
        ipCheckoutLimit: 1,
        otpSuspiciousTraffic: true,
      },
    },
  });
  assert.equal(result.response.status, 200);

  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    intent: "open",
    quantity: 1,
  });
  assert.equal(result.response.status, 201);
  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    intent: "open",
    quantity: 1,
  });
  assert.equal(result.response.status, 201);
  assert.equal(Boolean(result.body.otpRequired), false);
  assert.equal(result.body.botAction, "allow");
  const normalizedAttempt = db
    .prepare("SELECT action,signals_json FROM cod_bot_attempts")
    .all()
    .find((attempt) =>
      JSON.parse(attempt.signals_json).some(
        (signal) => signal.code === "otp_disabled",
      ),
    );
  assert.ok(normalizedAttempt);
  assert.equal(normalizedAttempt.action, "allow");
});

test("bot protection blocks invalid tokens and honeypots before checkout persistence", async (t) => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, token } = await setup(base);

  let result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    protection: {
      botTraffic: true,
      botProtection: { enabled: true, checkoutToken: true, honeypot: true },
    },
  });
  assert.equal(result.response.status, 200);

  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", buyer);
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /blocked by COD protection/i);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM checkout_sessions").get().count, 0);

  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    ...buyer,
    checkoutToken: token,
    website: "filled-by-script",
  });
  assert.equal(result.response.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM checkout_sessions").get().count, 0);
  const attempts = db
    .prepare("SELECT risk_score,risk_level,action,blocked FROM cod_bot_attempts ORDER BY created_at,id")
    .all();
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((attempt) => attempt.action === "block" && attempt.blocked === 1));
  const honeypotAttempt = attempts.find((attempt) => attempt.risk_score === 100);
  assert.equal(honeypotAttempt.risk_level, "critical");

  result = await call(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.codProtection.botAttempts.length, 2);
});

test("merchant UI exposes OTP, adaptive bot controls, and verification status", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const script = (await call(base, "/app.js")).body;
  for (const label of [
    "OTP Verification",
    "Send test OTP",
    "Require signed checkout token",
    "Behavior detection",
    "Critical-risk action",
    "Phone verification",
    "OTP STATUS",
  ])
    assert.match(script, new RegExp(label, "i"));
  const checkoutScript = (await call(base, "/otp-checkout.js")).body;
  assert.match(checkoutScript, /Verify your mobile number/);
  assert.match(checkoutScript, /Verify &amp; confirm order/);
});

test("OTP enabled/disabled flags accept string boolean payloads", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    otpProviders: {
      test: {
        async send() {
          return { delivered: true };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    { store, token } = await setup(base);

  let result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: {
      enabled: "true",
      requiredForCod: "true",
      provider: "test",
      length: 6,
      expiryMinutes: 5,
      resendDelaySeconds: 30,
      maxAttempts: 5,
      maxResends: 3,
      allowPhoneChange: true,
      verificationPosition: "before_order",
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.otp.enabled, true);

  result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { enabled: "false" },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.otp.enabled, false);

  result = await call(base, "/api/public/secure-store/offer/checkouts", "POST", {
    ...buyer,
    checkoutToken: token,
  });
  assert.equal(result.response.status, 201);
  const checkout = result.body;
  result = await call(base, `/api/public/checkouts/${checkout.id}/order`, "POST", {
    storeId: store.id,
    visitorSessionId: buyer.visitorSessionId,
  });
  assert.equal(result.response.status, 201);

  result = await call(base, `/api/stores/${store.id}/settings/cod-form`, "PATCH", {
    otp: { enabled: "true", provider: "custom" },
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /Connect the selected OTP provider before enabling OTP verification/i);
});
