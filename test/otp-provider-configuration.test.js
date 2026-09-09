import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function call(base, path, method = "GET", input) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  return { response, body: await response.json() };
}

test("merchant configures a store-scoped encrypted Twilio provider without exposing credentials", async (t) => {
  const db = createDatabase(":memory:"),
    accountSid = `AC${"a".repeat(32)}`,
    authToken = "server-only-twilio-auth-token",
    serviceSid = `VA${"b".repeat(32)}`,
    verificationSid = `VE${"c".repeat(32)}`;
  const app = createApp({
    db,
    port: 0,
    otpCredentialSecret: "test-otp-credential-encryption-secret",
    otpFetch: async (url) => {
      if (url.includes("/2010-04-01/Accounts/"))
        return new Response(JSON.stringify({ status: "active", type: "Trial" }), {
          status: 200,
        });
      if (url.endsWith("/Services"))
        return new Response(JSON.stringify({ sid: serviceSid }), { status: 201 });
      if (url.endsWith("/Verifications"))
        return new Response(
          JSON.stringify({ sid: verificationSid, status: "pending" }),
          { status: 201 },
        );
      throw new Error(`Unexpected Twilio URL: ${url}`);
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    store = (await call(base, "/api/stores", "POST", {
      name: "OTP Store",
      slug: "otp-store",
    })).body;

  let result = await call(base, `/api/stores/${store.id}/otp/provider`, "POST", {
    provider: "twilio",
    region: "US1",
    accountSid,
    authToken,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.configured, true);
  assert.equal(result.body.accountSidHint, "AC••••••••aaaa");
  assert.equal(result.body.serviceSidHint, "VA••••••••bbbb");
  assert.equal(JSON.stringify(result.body).includes(authToken), false);
  assert.equal(JSON.stringify(result.body).includes(accountSid), false);

  result = await call(base, `/api/stores/${store.id}/otp/provider`, "POST", {
    provider: "twilio",
    region: "US1",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.source, "store");

  const stored = db
    .prepare("SELECT * FROM otp_provider_connections WHERE store_id=?")
    .get(store.id);
  assert.match(stored.credentials_json, /^v1:/);
  assert.equal(stored.credentials_json.includes(authToken), false);

  result = await call(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.otpProvider.configured, true);
  assert.equal(result.body.settings.codForm.otp.provider, "twilio");
  const dashboard = JSON.stringify(result.body);
  assert.equal(dashboard.includes(authToken), false);
  assert.equal(dashboard.includes(accountSid), false);
  assert.equal(dashboard.includes(serviceSid), false);

  result = await call(base, `/api/stores/${store.id}/otp/test`, "POST", {
    phone: "9876543210",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.delivered, true);
  assert.equal(result.body.maskedPhone, "+91 ••••••3210");
});

test("OTP cannot be enabled until the selected provider is connected", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({ db, port: 0, otpProviders: {} });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    store = (await call(base, "/api/stores", "POST", {
      name: "Unconfigured Store",
      slug: "unconfigured-store",
    })).body,
    result = await call(
      base,
      `/api/stores/${store.id}/settings/cod-form`,
      "PATCH",
      { otp: { enabled: true, provider: "twilio" } },
    );
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /Connect the selected OTP provider/i);
});

test("OTP panel contains in-place Twilio connection and verified-recipient testing controls", () => {
  const source = readFileSync("public/app.js", "utf8");
  assert.match(source, /Twilio Verify configuration/);
  assert.match(source, /id="twilio-account-sid"/);
  assert.match(source, /id="twilio-auth-token" type="password"/);
  assert.match(source, /id="connect-otp-provider"/);
  assert.match(source, /Verified tester mobile number/);
  assert.match(source, /credentials are encrypted/i);
});
