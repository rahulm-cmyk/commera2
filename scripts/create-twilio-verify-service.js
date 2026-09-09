if (!process.env.TWILIO_API_KEY_SID && !process.env.TWILIO_ACCOUNT_SID && process.loadEnvFile) process.loadEnvFile(".env.otp");

const key = String(process.env.TWILIO_API_KEY_SID || "").trim();
const secret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();
const account = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const apiKeyConfigured = /^SK[0-9a-f]{32}$/i.test(key) && secret;
const accountConfigured = /^AC[0-9a-f]{32}$/i.test(account) && token;
if (!apiKeyConfigured && !accountConfigured) throw new Error("Twilio credentials are not configured");
const username = apiKeyConfigured ? key : account;
const password = apiKeyConfigured ? secret : token;

const response = await fetch("https://verify.twilio.com/v2/Services", {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    FriendlyName: "Commera2 OTP",
    CodeLength: "6",
    CustomCodeEnabled: "true",
    DoNotShareWarningEnabled: "true",
  }).toString(),
});
const payload = await response.json();
if (!response.ok || !/^VA[0-9a-f]{32}$/i.test(String(payload.sid || "")))
  throw new Error(String(payload.message || `Twilio service creation failed (${response.status})`));
process.stdout.write(String(payload.sid));
