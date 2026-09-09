import test from "node:test";
import assert from "node:assert/strict";
import { createTwilioVerifyProvider, configuredOtpProviders } from "../src/otp-providers.js";

const key = `SK${"a".repeat(32)}`;
const account = `AC${"d".repeat(32)}`;
const service = `VA${"b".repeat(32)}`;

test("Twilio Verify adapter uses provider-managed codes with safe API-key authentication", async () => {
  let request;
  const provider = createTwilioVerifyProvider({
    apiKeySid: key,
    apiKeySecret: "server-only-secret",
    serviceSid: service,
    fetchImpl: async (url, options) => {
      request = { url, options };
      if (url.endsWith("/VerificationCheck"))
        return new Response(JSON.stringify({ sid: `VE${"c".repeat(32)}`, status: "approved" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ sid: `VE${"c".repeat(32)}`, status: "pending" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await provider.send({ phone: "9876543210", otp: "420816" });
  assert.equal(result.delivered, true);
  assert.equal(request.url, `https://verify.twilio.com/v2/Services/${service}/Verifications`);
  assert.match(request.options.headers.authorization, /^Basic /);
  assert.doesNotMatch(request.options.headers.authorization, /server-only-secret/);
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get("To"), "+919876543210");
  assert.equal(body.get("Channel"), "sms");
  assert.equal(body.get("CustomCode"), null);
  assert.equal((await provider.verify({ phone: "9876543210", otp: "420816" })).verified, true);
  assert.match(request.url, /\/VerificationCheck$/);
  const checkBody = new URLSearchParams(request.options.body);
  assert.equal(checkBody.get("To"), "+919876543210");
  assert.equal(checkBody.get("Code"), "420816");
});

test("Twilio provider remains unavailable until every server credential is present", () => {
  assert.deepEqual(configuredOtpProviders({}), {});
  assert.deepEqual(configuredOtpProviders({ TWILIO_API_KEY_SID: key }), {});
});

test("Twilio Verify adapter supports US1 Account SID and Auth Token credentials", async () => {
  let authorization = "";
  const provider = createTwilioVerifyProvider({
    accountSid: account,
    authToken: "test-auth-token",
    serviceSid: service,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization;
      return new Response(JSON.stringify({ sid: `VE${"e".repeat(32)}`, status: "pending" }), { status: 201 });
    },
  });
  assert.equal((await provider.send({ phone: "9876543210", otp: "123456" })).delivered, true);
  assert.equal(Buffer.from(authorization.slice(6), "base64").toString(), `${account}:test-auth-token`);
});
